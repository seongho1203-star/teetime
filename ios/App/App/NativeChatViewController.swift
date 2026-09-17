import UIKit
import PhotosUI
import SafariServices

/// A retained, opaque native chat screen. The web route supplies only account/config
/// and receives navigation/read events; it never renders chat or controls its layout.
final class NativeChatViewController: UIViewController, ChatListDelegate, ComposerBarDelegate,
    PHPickerViewControllerDelegate, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    let service: NativeChatService
    var event: ((String, ChatJSON) -> Void)?
    private let list = ChatList()
    private let composer = ComposerBar()
    private let header = UIStackView()
    private let titleButton = UIButton(type: .system)
    private let context = UIStackView()
    private let mentions = UIStackView()
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
        let home = button("chevron.left", "홈으로", "native-chat-back") { [weak self] in self?.navigate("/") }
        home.widthAnchor.constraint(equalToConstant: 44).isActive = true
        titleButton.titleLabel?.font = .boldSystemFont(ofSize: 21); titleButton.contentHorizontalAlignment = .left
        titleButton.setTitle("전체 대화", for: .normal); titleButton.setTitleColor(.label, for: .normal)
        titleButton.addAction(UIAction { [weak self] _ in self?.showPeople() }, for: .touchUpInside)
        header.addArrangedSubview(home); header.addArrangedSubview(titleButton)
        header.addArrangedSubview(button("magnifyingglass", "대화 검색", "native-chat-search") { [weak self] in self?.showSearch() })
        header.addArrangedSubview(button("line.3.horizontal", "대화 메뉴", "native-chat-menu") { [weak self] in self?.showMenu() })
        context.axis = .vertical; context.spacing = 4; context.isHidden = true
        mentions.axis = .vertical; mentions.isHidden = true
        let input = UIStackView(arrangedSubviews: [mentions, context, composer]); input.axis = .vertical
        for child in [header, list, input, status] { child.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(child) }
        let safe = view.safeAreaLayoutGuide
        composerBottom = input.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor)
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: safe.topAnchor), header.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 8),
            header.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -8), header.heightAnchor.constraint(equalToConstant: 52),
            input.leadingAnchor.constraint(equalTo: safe.leadingAnchor), input.trailingAnchor.constraint(equalTo: safe.trailingAnchor), composerBottom,
            list.topAnchor.constraint(equalTo: header.bottomAnchor), list.leadingAnchor.constraint(equalTo: safe.leadingAnchor),
            list.trailingAnchor.constraint(equalTo: safe.trailingAnchor), list.bottomAnchor.constraint(equalTo: input.topAnchor),
            status.centerXAnchor.constraint(equalTo: list.centerXAnchor), status.centerYAnchor.constraint(equalTo: list.centerYAnchor),
            status.widthAnchor.constraint(lessThanOrEqualTo: list.widthAnchor, constant: -32)
        ])
        status.titleLabel?.numberOfLines = 0; status.titleLabel?.textAlignment = .center
        status.setTitleColor(.white, for: .normal); status.setTitle("대화를 불러오는 중…", for: .normal)
        status.accessibilityIdentifier = "native-chat-status"
        status.addAction(UIAction { [weak self] _ in self?.startLoad() }, for: .touchUpInside)
        let edge = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(backSwipe(_:)))
        edge.edges = .left; view.addGestureRecognizer(edge)
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
        loadViewIfNeeded(); visible = true; navigating = false
        if loaded {
            _ = list.beginSession("native:\(me):\(room)"); view.layoutIfNeeded(); list.restoreSession()
            render(); realtime?.start(); sync()
        } else { startLoad() }
    }
    func pause() {
        visible = false; list.pauseSession(); view.endEditing(true)
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
    @objc private func backSwipe(_ gesture: UIScreenEdgePanGestureRecognizer) {
        if gesture.state == .ended && (gesture.translation(in: view).x > 60 || gesture.velocity(in: view).x > 600) { navigate("/") }
    }
    private func navigate(_ path: String) {
        guard !navigating else { return }; navigating = true
        list.pauseSession(); view.endEditing(true); event?("navigate", ["path": path])
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
                self.titleButton.setTitle("\(room["name"] as? String ?? "전체 대화") \(self.members.count)", for: .normal)
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
                        let size = image.size; let scale = min(1, 1600 / max(size.width, size.height))
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
        mentions.arrangedSubviews.forEach { $0.removeFromSuperview() }; mentions.isHidden = true; mentionRange = nil
        guard range.location != NSNotFound else { return }
        let query = before.substring(from: range.location + 1)
        guard !query.contains(" "), !query.contains("\n"), query.count <= 12 else { return }
        mentionRange = NSRange(location: range.location, length: before.length - range.location)
        var names = members.compactMap { $0["name"] as? String }.filter { query.isEmpty || $0.localizedCaseInsensitiveContains(query) }
        if isAdmin && (query.isEmpty || "전체".contains(query)) { names.insert("전체", at: 0) }
        for name in names.prefix(3) {
            let b = UIButton(type: .system); b.setTitle("@\(name)", for: .normal); b.heightAnchor.constraint(equalToConstant: 36).isActive = true
            b.addAction(UIAction { [weak self] _ in
                guard let self = self, let r = self.mentionRange else { return }
                let replacement = "@\(name) "
                self.composer.text = (self.composer.text as NSString).replacingCharacters(in: r, with: replacement)
                self.composer.caret = r.location + (replacement as NSString).length
                self.mentions.isHidden = true; self.composer.textView.becomeFirstResponder()
            }, for: .touchUpInside); mentions.addArrangedSubview(b)
        }
        mentions.isHidden = mentions.arrangedSubviews.isEmpty
    }
    func composerTapped(_ name: String) {
        guard !busy else { return }
        view.endEditing(true)
        if name == "sticker" {
            let picker = NativeStickerPicker(service.config.stickers)
            picker.selected = { [weak self] item in
                self?.sticker = item; self?.pickedPhoto = nil; self?.retryRow = nil; self?.updateContext()
            }; showPanel(picker)
        } else {
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
    }
    func composerFocus(_ on: Bool) {}
    func composerResized(_ height: Double, y: Double, fr: Bool, kb: Bool) {}
    func composerKeyboard(on: Bool, dur: Double, at: Double, chatH: Double, pad: Double, s: Double, slide: Bool) {
        UIView.animate(withDuration: dur, delay: 0, options: [.beginFromCurrentState, .curveEaseInOut]) { self.view.layoutIfNeeded() }
    }
    func composerFrame(bottom: Double, h: Double, p: Double, end: Bool, chatH: Double, pad: Double) {}

    // MARK: Native message interactions
    func chatListState(atBottom: Bool, atTop: Bool, far: Bool) {
        bottom = atBottom
        list.apply(jump: far || windowed ? ["name": "", "text": "최근 대화로"] : nil)
        if atTop { loadMore() }; if atBottom { markRead() }
    }
    func chatListDismissKeyboard() { view.endEditing(true) }
    func chatListBackBegan() -> Bool { false }
    func chatListBackMoved(dx: CGFloat) {}
    func chatListBackEnded(dx: CGFloat, vx: CGFloat, cancelled: Bool) {}
    func chatListTap(kind: String, id: String, to: String?) {
        switch kind {
        case "back": navigate("/")
        case "jump": latest()
        case "card": if let to = to { navigate(to) }
        case "photo": if let to = to { showPanel(NativeChatPhoto(to)) }
        case "face": if let message = messages.first(where: { $0.id == id }) { showProfile(message.user) }
        case "reply": if let m = messages.first(where: { $0.id == id }), !m.hidden { quoted = m; updateContext(); composer.textView.becomeFirstResponder() }
        case "quote": if let to = to { jumpToID(to) }
        case "react": if let to = to { toggleReaction(id, to) }
        default: break
        }
    }
    func chatListHold(id: String, mine: Bool, rect: CGRect) {
        guard let m = messages.first(where: { $0.id == id }) else { return }
        let menu = UIAlertController(title: m.hidden ? "가려진 메시지" : String(m.preview.prefix(80)), message: nil, preferredStyle: .actionSheet)
        if !m.hidden {
            if !m.body.isEmpty {
                menu.addAction(UIAlertAction(title: "복사", style: .default) { _ in UIPasteboard.general.string = m.body })
                menu.addAction(UIAlertAction(title: "선택 복사", style: .default) { [weak self] _ in self?.showPanel(NativeChatText(m.body)) })
            }
            menu.addAction(UIAlertAction(title: "댓글", style: .default) { [weak self] _ in self?.quoted = m; self?.updateContext(); self?.composer.textView.becomeFirstResponder() })
            menu.addAction(UIAlertAction(title: "공유", style: .default) { [weak self] _ in self?.share(m) })
            menu.addAction(UIAlertAction(title: "반응 남기기", style: .default) { [weak self] _ in self?.reactionMenu(m.id) })
        }
        if isAdmin {
            menu.addAction(UIAlertAction(title: m.hidden ? "가리기 풀기" : "가리기", style: .default) { [weak self] _ in self?.confirmChange(m, hide: true) })
        }
        if m.user == me { menu.addAction(UIAlertAction(title: "삭제", style: .destructive) { [weak self] _ in self?.confirmChange(m, hide: false) }) }
        menu.addAction(UIAlertAction(title: "취소", style: .cancel)); presentMenu(menu)
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
    private func reactionMenu(_ id: String) {
        let alert = UIAlertController(title: "반응", message: nil, preferredStyle: .actionSheet)
        for emoji in ["👍", "❤️", "😂", "😮", "😢", "🙏"] {
            alert.addAction(UIAlertAction(title: emoji, style: .default) { [weak self] _ in self?.toggleReaction(id, emoji) })
        }
        alert.addAction(UIAlertAction(title: "취소", style: .cancel)); presentMenu(alert)
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
        sheet.popoverPresentationController?.sourceView = titleButton; present(sheet, animated: true)
    }
    private func presentMenu(_ menu: UIAlertController) {
        menu.popoverPresentationController?.sourceView = titleButton
        menu.popoverPresentationController?.sourceRect = titleButton.bounds
        present(menu, animated: true)
    }
    private func showPanel(_ panel: UIViewController) {
        view.endEditing(true)
        let nav = UINavigationController(rootViewController: panel); nav.modalPresentationStyle = .fullScreen
        present(nav, animated: true)
    }
    private func notice(_ message: String) {
        guard visible else { return }
        let label = UILabel(); label.text = message; label.numberOfLines = 0; label.textAlignment = .center
        label.font = .systemFont(ofSize: 14); label.textColor = .white; label.backgroundColor = UIColor.black.withAlphaComponent(0.82)
        label.layer.cornerRadius = 12; label.clipsToBounds = true; label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([label.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 22),
            label.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -22),
            label.bottomAnchor.constraint(equalTo: header.bottomAnchor, constant: 72), label.heightAnchor.constraint(greaterThanOrEqualToConstant: 50)])
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { label.removeFromSuperview() }
    }

    // MARK: Search, members, profile, and gallery
    private func showMenu() {
        let menu = UIAlertController(title: "대화", message: nil, preferredStyle: .actionSheet)
        menu.addAction(UIAlertAction(title: "참여자 \(members.count)명", style: .default) { [weak self] _ in self?.showPeople() })
        menu.addAction(UIAlertAction(title: "사진 모아보기", style: .default) { [weak self] _ in self?.showGallery() })
        menu.addAction(UIAlertAction(title: "최근 대화로", style: .default) { [weak self] _ in self?.latest() })
        menu.addAction(UIAlertAction(title: "취소", style: .cancel)); presentMenu(menu)
    }
    private func showPeople() {
        let panel = NativeChatPicker(title: "참여자 \(members.count)명")
        panel.items = members.map { p in
            NativeChatPicker.Item(title: NativeChatRows.label(p), detail: roleName(p["role"] as? String), image: p["avatar_url"] as? String) { [weak self, weak panel] in
                panel?.dismiss(animated: true) { self?.showProfile(p["id"] as? String ?? "") }
            }
        }; showPanel(panel)
    }
    private func roleName(_ role: String?) -> String {
        ["superadmin": "앱관리자", "admin": "운영자", "staff": "부운영자", "treasurer": "총무"][role ?? ""] ?? "회원"
    }
    private func showProfile(_ id: String) {
        guard let p = people.first(where: { $0["id"] as? String == id }) else { return }
        let panel = NativeChatPicker(title: NativeChatRows.label(p), searchable: false)
        var items = [NativeChatPicker.Item(title: NativeChatRows.label(p), detail: roleName(p["role"] as? String), image: p["avatar_url"] as? String, choose: {})]
        if let image = p["avatar_url"] as? String {
            items.append(NativeChatPicker.Item(title: "프로필 사진", detail: "크게 보기") { [weak self, weak panel] in
                panel?.dismiss(animated: true) { self?.showPanel(NativeChatPhoto(image)) }
            })
        }
        items.append(NativeChatPicker.Item(title: "언급하기", detail: "@\(p["name"] as? String ?? "")") { [weak self, weak panel] in
            panel?.dismiss(animated: true) {
                guard let self = self else { return }
                self.composer.text += "@\(p["name"] as? String ?? "") "; self.composer.textView.becomeFirstResponder()
            }
        })
        panel.items = items; showPanel(panel)
        guard isAdmin else { return }
        Task { [weak panel] in
            let since = Calendar.current.date(from: Calendar.current.dateComponents([.year], from: Date())) ?? Date()
            let f = ISO8601DateFormatter()
            if let counts = try? await service.request("rest/v1/rpc/attendance_counts", method: "POST", body: ["p_since": f.string(from: since)]) as? [ChatJSON],
               let count = counts.first(where: { $0["user_id"] as? String == id }) {
                panel?.items.append(NativeChatPicker.Item(title: "올해 라운드", detail: "\(count["n"] ?? 0)회", choose: {}))
            }
        }
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
                list.apply(jump: ["name": "", "text": "최근 대화로"])
            } catch { notice(error.localizedDescription) }
        }
    }
    private func showGallery() {
        let panel = NativeChatPicker(title: "사진 모아보기", searchable: false)
        var cursor: NativeChatMessage?
        var fetching = false
        var done = false
        let fetch: () -> Void = { [weak self, weak panel] in
            guard let self = self, let panel = panel, !fetching, !done else { return }; fetching = true
            Task {
                defer { fetching = false }
                do {
                    var filters = [("image_url", "not.is.null"), ("image_url", "not.like.sticker:*"), ("hidden_at", "is.null")]
                    if let last = cursor { filters.append(("or", "(created_at.lt.\(last.at),and(created_at.eq.\(last.at),id.lt.\(last.id)))")) }
                    let photos = try await self.service.messages(self.room, filters: filters, limit: 30)
                    done = photos.count < 30; cursor = photos.last
                    panel.items += photos.map { m in
                        NativeChatPicker.Item(title: self.personName(m.user), detail: m.at, image: m.image) { [weak self, weak panel] in
                            guard let image = m.image else { return }
                            panel?.dismiss(animated: true) { self?.showPanel(NativeChatPhoto(image)) }
                        }
                    }
                    if panel.items.isEmpty { panel.items = [NativeChatPicker.Item(title: "사진이 없습니다.", detail: "", choose: {})] }
                } catch { self.notice(error.localizedDescription) }
            }
        }
        panel.loadNext = fetch; showPanel(panel); fetch()
    }
}
