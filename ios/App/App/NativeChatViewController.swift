import UIKit
import PhotosUI
import SafariServices

/// A retained, opaque native chat screen. The web route supplies only account/config
/// and receives navigation/read events; it never renders chat or controls its layout.
final class NativeChatViewController: UIViewController, ChatListDelegate, ComposerBarDelegate,
    PHPickerViewControllerDelegate, UIImagePickerControllerDelegate, UINavigationControllerDelegate,
    UIPopoverPresentationControllerDelegate {
    let service: NativeChatService
    var event: ((String, ChatJSON) -> Void)?
    private let list = ChatList()
    private let composer = ComposerBar()
    private let header = UIStackView()
    /// 창을 붙일 자리(공유·사진 첨부의 팝오버). **제목은 없앴으므로**
    /// ☰이 그 몫이다 — 아래 `viewDidLoad`의 `전체 대화` 꼭지를 볼 것.
    private var menuBtn = UIButton(type: .system)
    /// 길게 누른 창 — **누른 말풍선 옆에 뜬다**(웹의 `.chat-menu`와 같은 값).
    private let hold = HoldMenu()
    /// 서랍(☰)과 전체화면 프로필. **따로 띄우는 화면이 아니라 여기 얹는다** —
    /// 그래야 네이티브 글칸 바와 말풍선 목록을 그대로 덮는다.
    private let drawer = ChatDrawer()
    private let profile = ChatProfile()
    /// 손가락을 따라 뒤로 가기(`ChatList.swift`의 `BackDrag`). 끄는 것은
    /// 앱이 맡고 **뒤에 깔 앞 화면은 웹이 그린다**(`nativeBackStart`).
    private let backDrag = BackDrag()
    /// 그 손짓의 문지기 — **오른쪽으로 그은 것만** 받는다.
    private let backGuard = BackGuard()
    private var backLive = false
    /// 화살표로 나갈 때 오른쪽으로 빠져나가는 데 걸리는 시간(초).
    /// **플러그인이 이만큼 기다렸다 화면을 걷는다**(`goBack` 주석).
    static let exitMS = 0.28
    /// 지금 빠져나가는 중인가 — 플러그인이 본다.
    private(set) var leaving = false
    private let context = UIStackView()
    /// `@`를 치면 입력칸 위에 뜨는 흰 카드(`MentionList`).
    private let mentions = MentionList()
    /// 이모티콘 서랍 — **입력칸 아래, 키보드가 서던 자리다**(카톡과 같다).
    private let tray = StickerTray()
    private var trayH: NSLayoutConstraint!
    private var trayBottom: NSLayoutConstraint!
    private let status = UIButton(type: .system)
    private var composerBottom: NSLayoutConstraint!
    private var room = ""
    private var messages: [NativeChatMessage] = []
    private var people: [ChatJSON] = []
    private var reads: [String: String] = [:]
    private var reactions: [ChatJSON] = []
    private var realtime: NativeChatRealtime?
    private var loadTask: Task<Void, Never>?
    private var syncTask: Task<Void, Never>?
    private var searchTask: Task<Void, Never>?
    private var metadataTask: Task<Void, Never>?
    private var offlineTask: Task<Void, Never>?
    private var readTask: Task<Void, Never>?
    private var hasMore = true
    private var loadingMore = false
    private var windowed = false
    private var visible = false
    private var loaded = false
    private var unread: String?
    private var bottom = true
    private var busy = false
    private var lastRead = ""
    private var quoted: NativeChatMessage?
    private var sticker: ChatJSON?
    private var pickedPhoto: UIImage?
    private var retryRow: ChatJSON?
    private var mentionRange: NSRange?
    /// 길게 눌러 창을 띄운 글. 고른 것이 돌아올 때 이 값으로 찾는다.
    private var holdId = ""
    private var observers: [NSObjectProtocol] = []
    private var navigating = false
    private var revision = 0
    private var changedAt: [String: Int] = [:]

    init(service: NativeChatService) { self.service = service; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError() }
    deinit { observers.forEach { NotificationCenter.default.removeObserver($0) } }
    private var me: String { service.config.user }
    private var isAdmin: Bool {
        people.contains { $0["id"] as? String == me && ["staff", "admin", "superadmin"].contains($0["role"] as? String ?? "") }
    }
    private var members: [ChatJSON] { people.filter { !["pending", "banned"].contains($0["role"] as? String ?? "pending") } }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.965, green: 0.975, blue: 0.94, alpha: 1)
        view.isOpaque = true; view.accessibilityIdentifier = "native-chat-screen"
        list.listDelegate = self; list.accessibilityIdentifier = "native-chat-messages"
        composer.barDelegate = self; composer.nativeViewport = true; composer.tabH = 0
        composer.cBg = view.backgroundColor!; composer.cBrand = UIColor(red: 0.91, green: 0.29, blue: 0.50, alpha: 1)
        composer.paint(); composer.watchKeyboard()
        composer.textView.accessibilityIdentifier = "native-chat-input"
        composer.sendBtn.accessibilityIdentifier = "native-chat-send"
        composer.plusBtn.accessibilityLabel = "사진 첨부"; composer.iconBtn.accessibilityLabel = "이모티콘"
        header.axis = .horizontal; header.alignment = .center; header.spacing = 8
        let home = button("chevron.left", "뒤로", "native-chat-back") { [weak self] in self?.goBack(drag: false) }
        home.widthAnchor.constraint(equalToConstant: 44).isActive = true
        /* **머리말에 `전체 대화`를 안 적는다**(사용자 요청 — `채팅 좌측상단
           전체대화 삭제해줘`). 방이 하나뿐이라 제목이 늘 같은 글자였고,
           사람 수는 서랍의 `참여자 N명`이 이미 맡는다. 되살리지 말 것 —
           빈자리는 `spacer`가 채워 누르는 것 둘을 오른쪽에 모아 둔다. */
        let spacer = UIView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        spacer.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        menuBtn = button("line.3.horizontal", "대화 메뉴", "native-chat-menu") { [weak self] in self?.showMenu() }
        header.addArrangedSubview(home); header.addArrangedSubview(spacer)
        header.addArrangedSubview(button("magnifyingglass", "대화 검색", "native-chat-search") { [weak self] in self?.showSearch() })
        header.addArrangedSubview(menuBtn)
        context.axis = .vertical; context.spacing = 4; context.isHidden = true
        mentions.onPick = { [weak self] name in self?.mentionPicked(name) }
        tray.onPick = { [weak self] item in self?.stickerPicked(item) }
        let input = UIStackView(arrangedSubviews: [mentions, context, composer]); input.axis = .vertical
        for child in [header, list, input, tray, status] { child.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(child) }
        let safe = view.safeAreaLayoutGuide
        composerBottom = input.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor)
        /* 서랍은 **입력칸 아래**에 서고 화면 끝까지(홈 인디케이터 자리까지)
           닿는다. 닫혀 있으면 높이가 0이라 아무 자리도 안 먹는다. */
        trayH = tray.heightAnchor.constraint(equalToConstant: 0)
        trayBottom = tray.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        trayBottom.isActive = false
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: safe.topAnchor), header.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 8),
            header.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -8), header.heightAnchor.constraint(equalToConstant: 52),
            input.leadingAnchor.constraint(equalTo: safe.leadingAnchor), input.trailingAnchor.constraint(equalTo: safe.trailingAnchor), composerBottom,
            tray.topAnchor.constraint(equalTo: input.bottomAnchor), trayH,
            tray.leadingAnchor.constraint(equalTo: view.leadingAnchor), tray.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            list.topAnchor.constraint(equalTo: header.bottomAnchor), list.leadingAnchor.constraint(equalTo: safe.leadingAnchor),
            list.trailingAnchor.constraint(equalTo: safe.trailingAnchor), list.bottomAnchor.constraint(equalTo: input.topAnchor),
            status.centerXAnchor.constraint(equalTo: list.centerXAnchor), status.centerYAnchor.constraint(equalTo: list.centerYAnchor),
            status.widthAnchor.constraint(lessThanOrEqualTo: list.widthAnchor, constant: -32)
        ])
        status.titleLabel?.numberOfLines = 0; status.titleLabel?.textAlignment = .center
        status.setTitleColor(.white, for: .normal); status.setTitle("대화를 불러오는 중…", for: .normal)
        status.accessibilityIdentifier = "native-chat-status"
        status.addAction(UIAction { [weak self] _ in self?.startLoad() }, for: .touchUpInside)

        /* 길게 누른 창 · 서랍 · 프로필은 **맨 위에 얹는다** — 이 셋이
           입력칸(네이티브 바)까지 덮어야 한다. */
        for v in [hold, drawer, profile] as [UIView] {
            v.frame = view.bounds
            v.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            view.addSubview(v)
        }
        hold.onPick = { [weak self] kind, value in self?.holdPicked(kind, value) }
        drawer.onClose = { [weak self] in self?.drawer.hide() }
        drawer.onPerson = { [weak self] id in self?.drawer.hide(); self?.showProfile(id) }
        drawer.onPhoto = { [weak self] url in self?.showPhoto(url) }
        profile.onClose = { [weak self] in self?.profile.hide() }
        profile.onMention = { [weak self] name in self?.mentionFrom(name) }

        /* **머리말에서도 오른쪽으로 밀면 뒤로 간다.** 말풍선 자리는
           `ChatList`가 제 손짓으로 잡아 같은 다리로 넘긴다
           (`chatListBackBegan`) — 한 화면에서 둘이 겹치지 않게
           **목록 밖에만** 붙인다. */
        let back = UIPanGestureRecognizer(target: self, action: #selector(backPan(_:)))
        back.delegate = backGuard
        back.cancelsTouchesInView = false
        header.addGestureRecognizer(back)
        observers.append(NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self = self, self.visible else { return }; self.realtime?.start(); self.sync()
            }
        })
        observers.append(NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in self?.realtime?.stop() }
        })
    }

    func resume() {
        loadViewIfNeeded(); visible = true; navigating = false; leaving = false
        if loaded {
            _ = list.beginSession("native:\(me):\(room)"); view.layoutIfNeeded(); list.restoreSession()
            render(); realtime?.start(); sync()
        } else { startLoad() }
    }
    func pause() {
        visible = false; list.pauseSession(); view.endEditing(true); setTray(false)
        /* 덮는 창은 화면을 떠날 때 함께 걷는다 — 남으면 다시 들어왔을 때
           엉뚱한 창이 떠 있는 꼴이 된다(토스트도 같다). */
        hold.hide(); drawer.hide(); profile.hide(); ToastHUD.clear()
        realtime?.stop(); syncTask?.cancel(); readTask?.cancel(); searchTask?.cancel(); metadataTask?.cancel()
        offlineTask?.cancel(); offlineTask = nil
        if !loaded { loadTask?.cancel(); loadTask = nil }
    }
    func updateToken(_ token: String) { service.config.token = token; realtime?.updateToken() }
    private func button(_ symbol: String, _ label: String, _ id: String, action: @escaping () -> Void) -> UIButton {
        let b = UIButton(type: .system); b.setImage(UIImage(systemName: symbol), for: .normal)
        b.tintColor = .label; b.accessibilityLabel = label; b.accessibilityIdentifier = id
        b.widthAnchor.constraint(equalToConstant: 44).isActive = true
        b.heightAnchor.constraint(equalToConstant: 44).isActive = true
        b.addAction(UIAction { _ in action() }, for: .touchUpInside); return b
    }
    // MARK: 이모티콘 서랍

    /**
     * **키보드와 자리를 맞바꾼다**(웹의 `toggleTray`와 같은 규칙).
     * 열 때 키보드를 내리고, 글칸에 초점이 가면 서랍을 닫는다
     * (`composerFocus`) — 둘이 함께 서면 대화가 한 줄도 안 남는다.
     *
     * **목록은 맨 아래에 붙여 둔다.** 서랍만큼 목록이 줄어들어 방금 읽던
     * 글이 위로 밀려나기 때문이다(웹에서 겪은 그 자리다).
     */
    private func setTray(_ on: Bool) {
        guard tray.isHidden == on else { return }
        if on {
            tray.load(service.config.stickers)
            view.endEditing(true)
            trayH.constant = StickerTray.height(for: view.bounds.height, safe: view.safeAreaInsets.bottom)
            composerBottom.isActive = false
            trayBottom.isActive = true
        } else {
            trayBottom.isActive = false
            composerBottom.isActive = true
            trayH.constant = 0
        }
        tray.isHidden = !on
        if on { tray.mark(sticker?["id"] as? String ?? "") }
        composer.setTray(on)
        view.layoutIfNeeded()
        if bottom { list.scrollToBottom(animated: false) }
    }

    private func stickerPicked(_ item: ChatJSON) {
        sticker = item; pickedPhoto = nil; retryRow = nil; updateContext()
    }

    /**
     * 오른쪽으로 밀어 뒤로 가기 — **손가락을 따라 앞 화면이 나온다.**
     *
     * **갈래가 둘이다.** 웹이 뒤에 깔 그림을 갖고 있으면(`config.back`)
     * 끌 준비를 하고 움직임마다 화면이 따라오고, 없으면 놓을 때 한 번만
     * 보고 **곧바로 넘어간다**(그때 끌면 빈 화면이 손을 따라 나온다).
     */
    @objc private func backPan(_ g: UIPanGestureRecognizer) {
        let t = g.translation(in: view)
        switch g.state {
        case .began:
            backLive = chatListBackBegan()
        case .changed:
            if backLive { chatListBackMoved(dx: max(0, t.x)) }
        case .ended, .cancelled, .failed:
            if backLive {
                backLive = false
                chatListBackEnded(dx: max(0, t.x), vx: g.velocity(in: view).x, cancelled: g.state != .ended)
            } else if g.state == .ended, t.x >= 60, t.x > abs(t.y) {
                goBack(drag: false)
            }
        default:
            break
        }
    }

    /**
     * 뒤로 간다 — **어디로 갈지는 웹이 안다**(히스토리가 비었으면 홈으로).
     * `drag`면 이미 화면을 다 내보낸 뒤라 웹이 곧바로 옮긴다.
     */
    private func goBack(drag: Bool) {
        guard !navigating else { return }; navigating = true
        list.pauseSession(); view.endEditing(true); setTray(false)
        /* **화살표로 나갈 때도 오른쪽으로 빠져나간다** — 끌어서 나가는
           길에는 이미 앱이 그림을 내보내고 있지만(`BackDrag`), 눌러서
           나가는 길에는 아무것도 없어 화면이 그 자리에서 툭 사라졌다.
           **플러그인이 이만큼 기다렸다 걷는다**(`leaving`) — 먼저 걷으면
           움직임이 한가운데서 잘린다. */
        if !drag {
            leaving = true
            UIView.animate(withDuration: Self.exitMS, delay: 0,
                           options: [.curveEaseOut, .beginFromCurrentState]) {
                self.view.transform = CGAffineTransform(translationX: self.view.bounds.width, y: 0)
            }
        }
        event?("back", ["phase": drag ? "commit" : "plain"])
    }

    private func navigate(_ path: String) {
        guard !navigating else { return }; navigating = true
        /* **나가기 전에 이 화면을 그림 한 장으로 떠서 함께 넘긴다.**
           라운드·투표에서 손가락으로 끌어 뒤로 올 때 **뒤에 깔 것**이다 —
           그 끌기는 웹이 하는데(`useBackSwipe`) 웹 쪽에는 대화 자리를
           지키는 스피너 한 장뿐이라 깔 그림이 없었다. 그래서 여태 그
           자리에서만 끌기를 통째로 넘겼다(`plainBack`의 `backIsChat`).
           **재는 것은 `endEditing` 앞이다** — 키보드를 내리면 목록이
           늘어나 방금 본 화면과 달라진다. */
        let shot = shotURL()
        list.pauseSession(); view.endEditing(true)
        event?("navigate", ["path": path, "shot": shot])
    }

    /**
     * 지금 화면을 `data:image/jpeg;base64,…` 한 줄로 만든다.
     *
     * **웹이 그릴 수 있는 것은 웹 DOM뿐이라 그림으로 넘기는 것 말고 길이
     * 없다** — 이 화면은 웹뷰 **위에 얹힌 앱 부품**이라 웹이 `transform`
     * 으로 밀어도 안 따라오고, 반대로 웹뷰 밑으로 내릴 수도 없다.
     *
     * **배율 2 · 품질 0.6**이다. 다리를 한 번 건너는 값이라(한 번에
     * 200KB 남짓) 3배로 뜨면 그만큼 더 드는데, 이 그림이 제 크기로
     * 보이는 것은 끌고 있는 0.2초뿐이다.
     */
    private func shotURL() -> String {
        let size = view.bounds.size
        guard size.width > 1, size.height > 1 else { return "" }
        let f = UIGraphicsImageRendererFormat.default()
        f.scale = 2; f.opaque = true
        let img = UIGraphicsImageRenderer(size: size, format: f).image { _ in
            view.drawHierarchy(in: CGRect(origin: .zero, size: size), afterScreenUpdates: false)
        }
        guard let data = img.jpegData(compressionQuality: 0.6) else { return "" }
        return "data:image/jpeg;base64," + data.base64EncodedString()
    }

    private func startLoad() {
        guard visible else { return }
        loadTask?.cancel(); status.isHidden = false; status.setTitle("대화를 불러오는 중…", for: .normal)
        loadTask = Task { [weak self] in
            guard let self = self else { return }
            do {
                async let r = self.service.room(); async let p = self.service.people()
                let (room, people) = try await (r, p); try Task.checkCancellation()
                self.room = room["id"] as? String ?? ""; self.people = people
                let latest = try await self.service.messages(self.room, limit: 100)
                try Task.checkCancellation()
                self.messages = latest.reversed(); self.hasMore = latest.count == 100
                self.reads = (try? await self.service.reads(self.room)) ?? [:]
                self.reactions = (try? await self.service.reactions(self.messages.map { $0.id })) ?? []
                try Task.checkCancellation()
                let seen = NativeChatRows.date(self.service.config.seen)
                if seen > NativeChatRows.date("1970-01-02T00:00:00Z"),
                   let first = self.messages.firstIndex(where: { NativeChatRows.date($0.at) > seen && $0.user != self.me }), first > 0 {
                    self.unread = self.messages[first].id
                }
                self.loaded = true
                _ = self.list.beginSession("native:\(self.me):\(self.room)")
                self.render(); self.view.layoutIfNeeded()
                if let unread = self.unread { _ = self.list.scrollTo(id: unread, place: "top", flash: false) }
                else { self.list.scrollToBottom(animated: false) }
                self.installRealtime(); self.markRead()
            } catch {
                if Task.isCancelled { return }
                self.status.setTitle("\(error.localizedDescription)\n눌러서 다시 시도", for: .normal)
            }
        }
    }
    private func installRealtime() {
        guard service.liveUpdates else { return }
        realtime?.stop(); offlineTask?.cancel(); offlineTask = nil
        let channel = NativeChatRealtime(service: service, room: room)
        channel.changed = { [weak self] d in self?.changed(d) }
        channel.connected = { [weak self] in self?.sync() }
        channel.status = { [weak self] connected in
            guard let self = self, self.loaded else { return }
            // A socket dropped by a lock screen or a tunnel is back in three seconds, and
            // saying so every time is noise. Speak up only when it stays down.
            self.offlineTask?.cancel(); self.offlineTask = nil
            guard !connected else { return }
            self.offlineTask = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 8_000_000_000)
                guard !Task.isCancelled, let self = self, self.visible else { return }
                self.notice("연결을 복구하고 있습니다…")
            }
        }
        realtime = channel; if visible { channel.start() }
    }
    private func merge(_ rows: [NativeChatMessage]) {
        var byID = Dictionary(messages.map { ($0.id, $0) }, uniquingKeysWith: { _, b in b })
        rows.forEach { byID[$0.id] = $0 }
        messages = byID.values.sorted { a, b in
            let x = NativeChatRows.date(a.at), y = NativeChatRows.date(b.at)
            return x == y ? a.id < b.id : x < y
        }
    }
    private func render() {
        guard isViewLoaded else { return }
        list.apply(rows: NativeChatRows.make(messages, user: me, people: people, reads: reads,
                                            reactions: reactions, unread: unread), stickBottom: true)
        status.isHidden = !messages.isEmpty
        if messages.isEmpty { status.setTitle("첫 마디를 남겨 보세요.", for: .normal) }
        composer.sendBtn.isEnabled = !busy; composer.plusBtn.isEnabled = !busy
    }
    private func sync() {
        guard visible, loaded, syncTask == nil else { return }
        let catchUpFrom = messages.last
        syncTask = Task { [weak self] in
            guard let self = self else { return }; defer { self.syncTask = nil }
            do {
                // Reconcile loaded IDs, including edits/deletions while the screen was away.
                let ids = self.messages.map { $0.id }
                for offset in stride(from: 0, to: ids.count, by: 50) {
                    let chunk = Array(ids[offset..<min(ids.count, offset + 50)])
                    let revision = self.revision
                    let fresh = try await self.service.messages(self.room, filters: [("id", "in.(\(chunk.joined(separator: ",")))")], limit: 50)
                    try Task.checkCancellation()
                    let returned = Set(fresh.map { $0.id })
                    self.messages.removeAll { chunk.contains($0.id) && !returned.contains($0.id) && (self.changedAt[$0.id] ?? 0) <= revision }
                    self.merge(fresh.filter { (self.changedAt[$0.id] ?? 0) <= revision })
                }
                if !self.windowed {
                    var more = true
                    var tail = catchUpFrom
                    while more {
                        let filters = tail.map { [("or", "(created_at.gt.\($0.at),and(created_at.eq.\($0.at),id.gt.\($0.id)))")] } ?? []
                        let add = try await self.service.messages(self.room, filters: filters, ascending: true, limit: 100)
                        try Task.checkCancellation(); self.merge(add); more = add.count == 100
                        tail = add.last ?? tail
                    }
                }
                self.reads = try await self.service.reads(self.room)
                self.reactions = try await self.service.reactions(self.messages.map { $0.id })
                try Task.checkCancellation(); self.render(); self.markRead()
            } catch { if !Task.isCancelled { self.notice(error.localizedDescription) } }
        }
    }
    private func changed(_ d: ChatJSON) {
        guard visible else { return }
        let table = d["table"] as? String
        if table == "messages" {
            let raw = d["record"] as? ChatJSON ?? [:]
            let old = d["old_record"] as? ChatJSON ?? [:]
            revision += 1
            if let id = (raw["id"] ?? old["id"]) as? String { changedAt[id] = revision }
            if d["type"] as? String == "DELETE" { messages.removeAll { $0.id == old["id"] as? String } }
            else if let id = raw["id"] as? String, raw["room_id"] as? String == room,
                    !windowed || messages.contains(where: { $0.id == id }) { merge([NativeChatMessage(raw: raw)]) }
            render(); markRead()
        }
        metadataTask?.cancel()
        metadataTask = Task { [weak self] in
            do {
                try await Task.sleep(nanoseconds: 250_000_000)
                guard let self = self else { return }
                self.reads = try await self.service.reads(self.room)
                self.reactions = try await self.service.reactions(self.messages.map { $0.id })
                try Task.checkCancellation(); self.render()
            } catch { /* The reconnect sync also refreshes metadata. */ }
        }
    }
    private func markRead() {
        guard visible, !windowed, bottom, let newest = messages.last?.at, newest != lastRead else { return }
        readTask?.cancel()
        readTask = Task { [weak self] in
            do {
                try await Task.sleep(nanoseconds: 700_000_000)
                guard let self = self, self.visible, self.bottom else { return }
                try await self.service.markRead(self.room); self.lastRead = newest
                self.event?("read", ["at": newest])
            } catch { /* Retry on the next scroll/message/reconnect. */ }
        }
    }
    private func loadMore() {
        guard visible, loaded, hasMore, !loadingMore, let first = messages.first else { return }
        loadingMore = true
        Task { [weak self] in
            guard let self = self else { return }; defer { self.loadingMore = false }
            do {
                let rows = try await self.service.messages(self.room, filters: [
                    ("or", "(created_at.lt.\(first.at),and(created_at.eq.\(first.at),id.lt.\(first.id)))")])
                self.hasMore = rows.count == 50; self.merge(rows); self.render()
            } catch { self.notice(error.localizedDescription) }
        }
    }
    private func latest() {
        Task { [weak self] in
            guard let self = self else { return }
            do {
                self.messages = try await self.service.messages(self.room).reversed()
                self.windowed = false; self.hasMore = self.messages.count == 50
                self.render(); self.list.scrollToBottom(animated: false); self.markRead()
            } catch { self.notice(error.localizedDescription) }
        }
    }

    // MARK: Native input and attachments
    func composerSend(text: String) {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !busy, loaded, !body.isEmpty || sticker != nil || pickedPhoto != nil || retryRow != nil else { return }
        guard body.count <= 1000 else { notice("메시지는 1,000자까지 보낼 수 있습니다."); return }
        busy = true; composer.sendBtn.isEnabled = false; composer.plusBtn.isEnabled = false
        // Keep the first responder (and Korean composition/keyboard) alive during I/O.
        context.isUserInteractionEnabled = false
        let image = pickedPhoto, chosen = sticker, reply = quoted
        Task { [weak self] in
            guard let self = self else { return }
            defer {
                self.busy = false; self.context.isUserInteractionEnabled = true
                self.composer.sendBtn.isEnabled = true; self.composer.plusBtn.isEnabled = true
            }
            do {
                var row: ChatJSON
                if let retry = self.retryRow { row = retry }
                else {
                    row = ["id": UUID().uuidString.lowercased(), "room_id": self.room, "user_id": self.me, "body": body]
                    if let reply = reply { row["reply_to"] = reply.id }
                    if let id = chosen?["id"] as? String { row["image_url"] = "sticker:\(id)" }
                    if let image = image {
                        /* **2560px · JPEG 82%** — 웹의 `lib/image.ts`와 같은
                           값이다(`MAX_EDGE`·`QUALITY`). **한쪽만 고치지 말 것** —
                           갈리면 어느 길로 올렸느냐에 따라 화질이 달라진다.
                           저장 공간이 곧 사진 장수라 **사용자에게 묻고 바꿀 것.** */
                        let size = image.size; let scale = min(1, 2560 / max(size.width, size.height))
                        let target = CGSize(width: max(1, size.width * scale), height: max(1, size.height * scale))
                        let fmt = UIGraphicsImageRendererFormat(); fmt.scale = 1
                        let jpg = UIGraphicsImageRenderer(size: target, format: fmt).image { _ in image.draw(in: CGRect(origin: .zero, size: target)) }.jpegData(compressionQuality: 0.82)
                        guard let jpg = jpg else { throw NativeChatError(message: "사진을 준비하지 못했습니다.") }
                        row["image_url"] = try await self.service.upload(jpg, room: self.room)
                    }
                    self.retryRow = row
                }
                let sent = try await self.service.send(row)
                self.retryRow = nil; self.quoted = nil; self.sticker = nil; self.pickedPhoto = nil
                if self.composer.text == text { self.composer.text = "" }
                self.updateContext()
                if self.windowed {
                    self.messages = try await self.service.messages(self.room).reversed(); self.windowed = false
                }
                self.merge([sent]); self.render(); self.list.scrollToBottom(animated: false)
                self.markRead()
            } catch { self.notice("\(error.localizedDescription)\n내용은 보관했습니다. 보내기를 눌러 다시 시도하세요.") }
        }
    }
    func composerChanged(text: String, sel: Int) {
        // Changing a failed draft is an explicit new message, never reuse its UUID.
        if let row = retryRow, row["body"] as? String != text.trimmingCharacters(in: .whitespacesAndNewlines) { retryRow = nil }
        let ns = text as NSString; let before = ns.substring(to: min(sel, ns.length)) as NSString
        let range = before.range(of: "@", options: .backwards)
        mentions.clear(); mentionRange = nil
        guard range.location != NSNotFound else { return }
        let query = before.substring(from: range.location + 1)
        guard !query.contains(" "), !query.contains("\n"), query.count <= 12 else { return }
        mentionRange = NSRange(location: range.location, length: before.length - range.location)
        var names = members.compactMap { $0["name"] as? String }.filter { query.isEmpty || $0.localizedCaseInsensitiveContains(query) }
        /* `@전체`는 **운영진만** 쓴다 — 대화 알림을 꺼 둔 기기까지 다
           울리므로 아무나 쓰면 그 스위치가 있으나 마나가 된다. */
        if isAdmin && (query.isEmpty || "전체".contains(query)) { names.insert("전체", at: 0) }
        mentions.show(names)
    }
    /// 목록에서 골랐다 — 친 `@…`를 이름으로 갈아 끼우고 커서를 뒤에 둔다.
    private func mentionPicked(_ name: String) {
        guard let r = mentionRange else { return }
        let replacement = "@\(name) "
        composer.text = (composer.text as NSString).replacingCharacters(in: r, with: replacement)
        composer.caret = r.location + (replacement as NSString).length
        mentions.clear(); mentionRange = nil
        composer.textView.becomeFirstResponder()
    }
    func composerTapped(_ name: String) {
        guard !busy else { return }
        if name == "sticker" {
            /* 열려 있으면 닫고 키보드를 도로 올린다 — 단추 그림이
               자판으로 바뀌어 있으므로 그 뜻대로 움직여야 한다. */
            if !tray.isHidden { setTray(false); composer.textView.becomeFirstResponder() }
            else { setTray(true) }
            return
        }
        view.endEditing(true)
        setTray(false)
        let menu = UIAlertController(title: "사진 첨부", message: nil, preferredStyle: .actionSheet)
        menu.addAction(UIAlertAction(title: "사진 보관함", style: .default) { [weak self] _ in self?.pickPhoto() })
        if UIImagePickerController.isSourceTypeAvailable(.camera) {
            menu.addAction(UIAlertAction(title: "사진 찍기", style: .default) { [weak self] _ in
                guard let self = self else { return }
                let camera = UIImagePickerController(); camera.sourceType = .camera; camera.delegate = self; self.present(camera, animated: true)
            })
        }
        menu.addAction(UIAlertAction(title: "취소", style: .cancel)); presentMenu(menu)
    }
    private func pickPhoto() {
        var config = PHPickerConfiguration(); config.filter = .images; config.selectionLimit = 1
        let picker = PHPickerViewController(configuration: config); picker.delegate = self; present(picker, animated: true)
    }
    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let item = results.first?.itemProvider, item.canLoadObject(ofClass: UIImage.self) else { return }
        item.loadObject(ofClass: UIImage.self) { [weak self] object, _ in
            DispatchQueue.main.async {
                guard let self = self, let image = object as? UIImage else { return }
                self.pickedPhoto = image; self.sticker = nil; self.retryRow = nil; self.updateContext()
            }
        }
    }
    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        pickedPhoto = info[.originalImage] as? UIImage; sticker = nil; retryRow = nil
        picker.dismiss(animated: true); updateContext()
    }
    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { picker.dismiss(animated: true) }
    private func updateContext() {
        context.arrangedSubviews.forEach { $0.removeFromSuperview() }
        if let quote = quoted {
            let b = UIButton(type: .system); b.setTitle("댓글 · \(quote.preview.prefix(55))    ✕", for: .normal)
            b.titleLabel?.lineBreakMode = .byTruncatingTail; b.heightAnchor.constraint(equalToConstant: 40).isActive = true
            b.addAction(UIAction { [weak self] _ in self?.quoted = nil; self?.retryRow = nil; self?.updateContext() }, for: .touchUpInside)
            context.addArrangedSubview(b)
        }
        if sticker != nil || pickedPhoto != nil {
            let row = UIStackView(); row.alignment = .center; row.distribution = .fill
            let image = UIImageView(); image.contentMode = .scaleAspectFit; image.image = pickedPhoto
            image.widthAnchor.constraint(equalToConstant: 76).isActive = true; image.heightAnchor.constraint(equalToConstant: 76).isActive = true
            if let src = sticker?["src"] as? String { ImageStore.shared.load(src) { shot in ImageStore.put(shot, into: image) } }
            let label = UILabel(); label.text = sticker?["label"] as? String ?? "보낼 사진"; label.font = .systemFont(ofSize: 14)
            let remove = button("xmark", "첨부 취소", "native-attachment-cancel") { [weak self] in
                self?.sticker = nil; self?.pickedPhoto = nil; self?.retryRow = nil; self?.updateContext()
            }
            row.addArrangedSubview(image); row.addArrangedSubview(label); row.addArrangedSubview(remove); context.addArrangedSubview(row)
        }
        context.isHidden = context.arrangedSubviews.isEmpty
        composer.forceSend = sticker != nil || pickedPhoto != nil
        tray.mark(sticker?["id"] as? String ?? "")
    }
    /// 글칸에 초점이 가면 서랍을 닫는다 — 키보드와 자리를 맞바꾸는 그 규칙이다.
    func composerFocus(_ on: Bool) { if on { setTray(false) } }
    func composerResized(_ height: Double, y: Double, fr: Bool, kb: Bool) {}
    func composerKeyboard(on: Bool, dur: Double, at: Double, chatH: Double, pad: Double, s: Double, slide: Bool) {
        UIView.animate(withDuration: dur, delay: 0, options: [.beginFromCurrentState, .curveEaseInOut]) { self.view.layoutIfNeeded() }
    }
    func composerFrame(bottom: Double, h: Double, p: Double, end: Bool, chatH: Double, pad: Double) {}

    // MARK: Native message interactions
    func chatListState(atBottom: Bool, atTop: Bool, far: Bool) {
        bottom = atBottom
        list.apply(jump: far || windowed)
        if atTop { loadMore() }; if atBottom { markRead() }
    }
    func chatListDismissKeyboard() { view.endEditing(true) }

    /* ── 손가락을 따라 뒤로 가기 ─────────────────────────────
     *
     * 짜임과 까닭은 `ChatList.swift`의 `BackDrag` 머리말에 있다 — 여기는
     * **화면과 웹뷰를 아는 다리**일 뿐이다.
     *
     * **이 화면은 웹뷰 위에 얹힌 앱 부품이다.** 그래서 찍은 그림은 창에
     * 얹고(그래야 웹뷰를 밀 때 같이 안 밀린다) 이 화면은 감춘다 —
     * 웹은 그 뒤에서 앞 화면 그림만 깔아 준다(`nativeBackStart`).
     */
    func chatListBackBegan() -> Bool {
        guard service.config.back, !navigating, hold.isHidden, drawer.isHidden, profile.isHidden,
              let web = view.superview else { return false }
        guard backDrag.begin(root: view, web: web, cover: [view]) else { return false }
        event?("back", ["phase": "start"])
        return true
    }

    func chatListBackMoved(dx: CGFloat) { backDrag.move(dx: dx) }

    func chatListBackEnded(dx: CGFloat, vx: CGFloat, cancelled: Bool) {
        let go = !cancelled && backDrag.wants(dx: dx, vx: vx)
        backDrag.finish(go: go) { [weak self] in
            guard let self = self else { return }
            if go { self.goBack(drag: true) } else { self.event?("back", ["phase": "cancel"]) }
            /* **웹이 손을 쓴 뒤에 걷는다.** 되돌아오는 판에서는 감춰 둔
               화면을 다시 내보이는 데 한 프레임이면 되고, 넘어가는 판에서는
               목적지가 그려질 때까지 기다린다 — 먼저 걷으면 옛 화면이
               새 화면 위에 잠깐 되살아난다. */
            DispatchQueue.main.asyncAfter(deadline: .now() + (go ? 0.4 : 0.05)) {
                self.backDrag.end()
            }
        }
    }

    func chatListTap(kind: String, id: String, to: String?) {
        switch kind {
        case "back": goBack(drag: false)
        case "jump": latest()
        case "card": if let to = to { navigate(to) }
        case "photo": if let to = to { showPhoto(to) }
        case "face": if let message = messages.first(where: { $0.id == id }) { showProfile(message.user) }
        case "reply": if let m = messages.first(where: { $0.id == id }), !m.hidden { quoted = m; updateContext(); composer.textView.becomeFirstResponder() }
        case "quote": if let to = to { jumpToID(to) }
        case "react": if let to = to { toggleReaction(id, to) }
        default: break
        }
    }
    /**
     * 말풍선을 길게 눌렀다 — **누른 자리에 카톡과 같은 창이 뜬다**
     * (화면 아래에서 올라오는 액션시트가 아니다. 사용자 요청 —
     * `누른 자리에서 나오도록해줘`).
     *
     * **줄 차례는 사용자가 정해 준 그대로다** — `복사 · 선택 복사 · 댓글 ·
     * 공유`, 그 뒤에 운영진의 `가리기`, 쓴 사람의 `삭제`.
     * **누구에게 무엇이 붙는지가 규칙의 전부다**: 앞 넷은 누구나,
     * `가리기`는 운영진, `삭제`는 쓴 사람(제 글에만) — **남의 글은
     * 운영진에게도 안 열었다**(되돌릴 수 없는 일이라 `가리기`로 끈다).
     * 가린 글에는 `복사`·`선택 복사`·`댓글`과 반응 알약을 안 붙인다 —
     * 덮어 둔 내용이 그리로 샌다.
     */
    func chatListHold(id: String, mine: Bool, rect: CGRect) {
        guard let m = messages.first(where: { $0.id == id }) else { return }
        var items: [HoldMenu.Item] = []
        func add(_ name: String, _ label: String, _ icon: String, danger: Bool = false) {
            if let it = HoldMenu.Item(["name": name, "label": label, "icon": icon, "danger": danger]) {
                items.append(it)
            }
        }
        if !m.hidden {
            if !m.body.isEmpty {
                add("copy", "복사", "copy")
                add("pick", "선택 복사", "pick")
            }
            add("reply", "댓글", "reply")
            add("share", "공유", "share")
        }
        if isAdmin { add("hide", m.hidden ? "가리기 풀기" : "가리기", "hide") }
        if m.user == me { add("trash", "삭제", "trash", danger: true) }
        holdId = m.id
        view.bringSubviewToFront(hold)
        /* 반응 알약은 **가린 글에는 안 붙인다.** 그림글자 다섯은 웹이 준다. */
        hold.show(at: rect, mine: mine, items: items,
                  reacts: m.hidden ? [] : service.config.reactions)
    }

    /// 창에서 고른 것 — `item`(줄) · `react`(알약) · `close`(바탕을 누름).
    private func holdPicked(_ kind: String, _ value: String) {
        hold.hide()
        guard kind != "close", let m = messages.first(where: { $0.id == holdId }) else { return }
        if kind == "react" { toggleReaction(m.id, value); return }
        switch value {
        case "copy": UIPasteboard.general.string = m.body; notice("복사했습니다.")
        case "pick": showPanel(NativeChatText(m.body))
        case "reply": quoted = m; updateContext(); composer.textView.becomeFirstResponder()
        case "share": share(m)
        case "hide": confirmChange(m, hide: true)
        case "trash": confirmChange(m, hide: false)
        default: break
        }
    }
    private func confirmChange(_ m: NativeChatMessage, hide: Bool) {
        let title = hide ? (m.hidden ? "가리기를 풀까요?" : "이 메시지를 가릴까요?") : "메시지를 삭제할까요?"
        let alert = UIAlertController(title: title, message: hide ? "모든 참여자에게 반영됩니다." : "삭제한 메시지는 되돌릴 수 없습니다.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "취소", style: .cancel))
        alert.addAction(UIAlertAction(title: "확인", style: .destructive) { [weak self] _ in
            guard let self = self else { return }
            Task {
                do {
                    let patch: ChatJSON? = hide ? ["hidden_at": m.hidden ? NSNull() : NativeChatRows.now() as Any,
                        "hidden_by": m.hidden ? NSNull() : self.me as Any] : nil
                    try await self.service.change(m, patch: patch)
                    if let patch = patch {
                        var changed = m.raw; patch.forEach { changed[$0.key] = $0.value }; self.merge([NativeChatMessage(raw: changed)])
                    } else { self.messages.removeAll { $0.id == m.id } }
                    self.render()
                } catch { self.notice(error.localizedDescription) }
            }
        }); present(alert, animated: true)
    }
    private func toggleReaction(_ id: String, _ emoji: String) {
        let mine = reactions.contains { $0["message_id"] as? String == id && $0["user_id"] as? String == me && $0["emoji"] as? String == emoji }
        Task {
            do {
                try await service.react(id, emoji: emoji, remove: mine)
                reactions = try await service.reactions(messages.map { $0.id }); render()
            } catch { notice(error.localizedDescription) }
        }
    }
    private func share(_ m: NativeChatMessage) {
        var items: [Any] = [m.preview]
        if let image = m.image, !image.hasPrefix("sticker:"), let url = URL(string: image) { items.append(url) }
        let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = menuBtn
        sheet.popoverPresentationController?.sourceRect = menuBtn.bounds
        present(sheet, animated: true)
    }
    /**
     사진 첨부 창 — **누른 `+` 바로 위에 작은 카드로 띄운다**(사용자 제보 —
     `파일 추가 눌렀을 때 누른 위치에서 뜨지 않고 화면 한가운데 위에 상단에서 떠`).

     예전에는 ☰(오른쪽 위)에 붙여서, 화면 맨 위에서 창이 떨어졌다 —
     누른 자리와 멀어 눈이 통째로 옮겨 간다. `NativeComposerPlugin`의
     9판이 이미 같은 자리를 이렇게 고쳤다(**한쪽만 고치지 말 것**):

     - 붙이는 곳은 **`composer.plusBtn`**이고 화살표는 아래(`.down`)다.
     - **`delegate`가 `.none`을 돌려주는 것이 한 쌍이다** — 아이폰은
       `.actionSheet`를 기본으로 화면 아래를 가로지르는 큰 창으로 되바꾼다.
       그 작은 카드에서는 iOS가 `취소` 줄을 스스로 빼고, 바탕을 누르면 닫힌다.
     - `+`가 아직 화면에 없으면(있을 수 없지만) 왼쪽 아래를 예비 자리로 둔다 —
       붙일 자리가 없으면 아이패드에서 그대로 죽는다.
     */
    private func presentMenu(_ menu: UIAlertController) {
        if let pop = menu.popoverPresentationController {
            pop.delegate = self
            pop.permittedArrowDirections = .down
            if composer.plusBtn.window != nil {
                pop.sourceView = composer.plusBtn
                pop.sourceRect = composer.plusBtn.bounds
            } else {
                pop.sourceView = view
                pop.sourceRect = CGRect(x: 16, y: view.bounds.maxY - 96, width: 44, height: 44)
            }
        }
        present(menu, animated: true)
    }
    /// 위 `presentMenu`의 한 쌍 — 아이폰이 팝오버를 큰 창으로 되바꾸는 것을 막는다.
    func adaptivePresentationStyle(for controller: UIPresentationController)
        -> UIModalPresentationStyle { return .none }
    /// 사진은 **머리말 없이 통째로** 띄운다 — 검은 바탕에 `✕`와 알약 둘뿐이다.
    private func showPhoto(_ url: String) {
        view.endEditing(true)
        present(NativeChatPhoto(url), animated: true)
    }
    private func showPanel(_ panel: UIViewController) {
        view.endEditing(true)
        let nav = UINavigationController(rootViewController: panel); nav.modalPresentationStyle = .fullScreen
        present(nav, animated: true)
    }
    /**
     * 안내창(토스트) — **입력칸 바로 위**다(`ToastHUD`).
     *
     * 화면 맨 위에 두었더니 **눈에 잘 안 띈다**고 했다(사용자 제보) —
     * 대화방에서 눈이 가 있는 곳은 방금 누른 말풍선과 입력칸 언저리이지
     * 화면 맨 위가 아니다. **되돌리지 말 것.**
     */
    private func notice(_ message: String) {
        guard visible else { return }
        ToastHUD.show(message, skin: ToastHUD.Skin(), in: view, above: composer)
    }

    // MARK: 서랍 · 프로필 · 검색

    /**
     * ☰ — **서랍이 옆에서 나온다**(액션시트가 아니다). 위에서부터
     * `최근 사진` · `참여자 N명`이고 맨 윗줄에는 `닫기` 하나만 둔다.
     */
    private func showMenu() {
        view.endEditing(true)
        view.bringSubviewToFront(drawer)
        drawer.show(people: members, me: me)
        loadShots()
    }

    /**
     * 최근 사진 — **서랍을 열 때만 나가는 조회다.** 대화 화면이 늘 들고
     * 있을 값이 아니고(통신량 규칙) 여는 일이 드물어 그때 한 번 물어보는
     * 값이 싸다. 마지막 서른 장만 받는다.
     *
     * **이모티콘은 서버에서 걸러 낸다**(`not.ilike.sticker:%`) — 사진과
     * 같은 칸을 쓰므로 안 거르면 서른 칸이 죄다 이모티콘으로 찬다.
     * **오류는 그냥 삼킨다** — 못 받으면 이 묶음만 안 그린다.
     */
    private func loadShots() {
        Task { [weak self] in
            guard let self = self else { return }
            let rows = (try? await self.service.messages(self.room, filters: [
                ("image_url", "not.is.null"), ("image_url", "not.ilike.sticker:%"), ("hidden_at", "is.null"),
            ], limit: 30)) ?? []
            self.drawer.setPhotos(rows.compactMap { m in m.image.map { (id: m.id, url: $0) } })
        }
    }

    /**
     * 프로필은 **전체화면이고 아래로 내리면 사라진다**(사용자 요청).
     * 아래에서 올라오는 작은 카드로 되돌리지 말 것 — 100명 방에서 얼굴을
     * 누르는 까닭은 누군지 안 떠올라서인데, 사진이 작으면 답이 안 된다.
     *
     * **참석 횟수는 운영진에게만 적는다.** 못 받았으면 그 줄을 아예 안
     * 그린다 — 0으로 적으면 모두가 `올해 0회`가 되어 거짓말이 된다.
     */
    private func showProfile(_ id: String) {
        guard let p = people.first(where: { $0["id"] as? String == id }) else { return }
        view.endEditing(true)
        view.bringSubviewToFront(profile)
        profile.show(p, attend: nil)
        guard isAdmin else { return }
        Task { [weak self] in
            guard let self = self else { return }
            let since = Calendar.current.date(from: Calendar.current.dateComponents([.year], from: Date())) ?? Date()
            let f = ISO8601DateFormatter()
            if let counts = try? await self.service.request("rest/v1/rpc/attendance_counts", method: "POST",
                                                            body: ["p_since": f.string(from: since)]) as? [ChatJSON],
               let count = counts.first(where: { $0["user_id"] as? String == id }),
               !self.profile.isHidden {
                self.profile.setAttend(count["n"] as? Int ?? 0)
            }
        }
    }

    /// 프로필에서 `@언급하기` — 창을 닫고 글칸에 이름을 넣는다.
    private func mentionFrom(_ name: String) {
        profile.hide()
        guard !name.isEmpty else { return }
        composer.text += "@\(name) "
        composer.textView.becomeFirstResponder()
    }
    private func showSearch() {
        let panel = NativeChatPicker(title: "대화 검색")
        panel.items = [NativeChatPicker.Item(title: "두 글자 이상 입력해 주세요.", detail: "", choose: {})]
        panel.searchChanged = { [weak self, weak panel] query in
            guard let self = self else { return }; self.searchTask?.cancel()
            let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
            guard query.count >= 2 else { panel?.items = []; return }
            self.searchTask = Task {
                do {
                    try await Task.sleep(nanoseconds: 300_000_000)
                    let safe = query.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "%", with: "\\%").replacingOccurrences(of: "_", with: "\\_")
                    let hits = try await self.service.messages(self.room, filters: [("body", "ilike.%\(safe)%"), ("hidden_at", "is.null")], limit: 100)
                    try Task.checkCancellation()
                    panel?.items = hits.isEmpty ? [NativeChatPicker.Item(title: "검색 결과가 없습니다.", detail: "", choose: {})] : hits.map { m in
                        NativeChatPicker.Item(title: m.preview, detail: self.personName(m.user) + " · " + m.at.prefix(16)) { [weak self, weak panel] in
                            panel?.dismiss(animated: true) { self?.jump(m) }
                        }
                    }
                } catch { if !Task.isCancelled { panel?.items = [NativeChatPicker.Item(title: error.localizedDescription, detail: "검색어를 다시 입력해 주세요.", choose: {})] } }
            }
        }; showPanel(panel)
    }
    private func personName(_ id: String) -> String { people.first { $0["id"] as? String == id }?["name"] as? String ?? "안내" }
    private func jumpToID(_ id: String) {
        if let message = messages.first(where: { $0.id == id }) { jump(message); return }
        Task {
            do {
                guard let m = try await service.messages(room, filters: [("id", "eq.\(id)")], limit: 1).first else {
                    notice("삭제됐거나 볼 수 없는 메시지입니다."); return
                }
                jump(m)
            } catch { notice(error.localizedDescription) }
        }
    }
    private func jump(_ message: NativeChatMessage) {
        if list.scrollTo(id: message.id, place: "center", flash: true) { return }
        Task {
            do {
                async let before = service.messages(room, filters: [("created_at", "lte.\(message.at)")])
                async let after = service.messages(room, filters: [("created_at", "gt.\(message.at)")], ascending: true, limit: 30)
                let (a, b) = try await (before, after)
                messages = []; merge(a + b); windowed = true; hasMore = a.count == 50
                render(); _ = list.scrollTo(id: message.id, place: "center", flash: true)
                list.apply(jump: true)
            } catch { notice(error.localizedDescription) }
        }
    }
}
