import UIKit
import AVFoundation
import AVKit
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
    /**
     * **입력칸 아래 홈 인디케이터 자리의 바탕칠**(사용자 요청 —
     * `메시 입력창 아래 흰색배경은 카톡처럼 삭제해줘`).
     *
     * 그 34px은 **바 밖이다** — 바 아래는 언제나 안전 영역 위에 묶이므로
     * (`composerBottom`의 `keyboardLayoutGuide`는 기본값이 안전 영역까지다)
     * 바 안에 칸을 만들어 칠하면 높이가 0이라 **아무것도 안 그려진다**
     * (그렇게 한 판을 태웠다 — `ComposerBar`의 그 자리 주석을 볼 것).
     * 드러나던 크림색은 `view.backgroundColor`였다.
     *
     * **`view.backgroundColor`를 보라로 바꾸는 길로 가지 말 것** — 그 색은
     * 머리말 위(노치 자리)가 같이 쓴다. 거기는 밝아야 한다.
     */
    private let footPad = UIView()
    private let header = UIStackView()
    /// 창을 붙일 자리(공유·사진 첨부의 팝오버). **제목은 없앴으므로**
    /// ☰이 그 몫이다 — 아래 `viewDidLoad`의 `전체 대화` 꼭지를 볼 것.
    private var menuBtn = UIButton(type: .system)
    /// 길게 누른 창 — **누른 말풍선 옆에 뜬다**(웹의 `.chat-menu`와 같은 값).
    private let hold = HoldMenu()
    /// 서랍(☰)과 전체화면 프로필. **따로 띄우는 화면이 아니라 여기 얹는다** —
    /// 그래야 네이티브 글칸 바와 말풍선 목록을 그대로 덮는다.
    private let drawer = ChatDrawer()
    /// 서랍의 `더보기`가 여는 격자 화면. 사진만 모아 본다.
    private let gallery = ChatGallery()
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
    /** 화면 틀에 얹었을 때 뒤에 깔린 그림 — 플러그인이 넣어 준다.
        끌 때 `BackDrag`가 이것을 뒤로 민다(웹뷰가 화면에 없기 때문이다). */
    weak var backdrop: UIView?
    /** 머리말에서 오른쪽으로 미는 손짓 — 가장자리 끌기에 자리를 내준다. */
    private weak var headerBack: UIPanGestureRecognizer?
    /** 가장자리 끌기에 `require(toFail:)`을 이미 걸었는가. */
    private var edgeLinked = false
    private var exitSettled = true
    private var exitWaiters: [() -> Void] = []
    private let context = UIStackView()
    /// 댓글(답장)을 달 때 입력칸 위에 물리는 라벤더 카드(`ReplyBox`).
    private let reply = ReplyBox()
    /// `@`를 치면 입력칸 위에 뜨는 흰 카드(`MentionList`).
    private let mentions = MentionList()
    /// 치는 글에 어울리는 이모티콘 줄(카톡의 그것). 규칙은 웹에 있다.
    private let suggest = SuggestBar()
    /// 고른 이모티콘을 대화 위에 크게 띄우는 카드(카톡의 그것 — `StickerPeek`).
    private let peek = StickerPeek()
    /* ── 축하 폭죽(`ChatCheer.swift`) ───────────────────────
     * `ㅊㅋ`·`축하`·`추카`가 오가면 입력칸 위에 단추가 뜨고, 누르면 이
     * 화면에서만 폭죽이 터진다. 웹(`lib/cheer.ts`·`Fireworks.tsx`)과
     * **한 벌이니 한쪽만 고치지 말 것.** */
    private let cheer = CheerBar()
    /// 마지막으로 본 글의 시각 — **첫 판에는 적어 두기만 하고 지나간다**
    /// (들어오자마자 어제 축하로 단추가 뜨면 안 된다. 웹과 같은 문지기다).
    private var cheerMark = ""
    /// 단추를 스스로 걷는 예약(`ChatCheer.window`).
    private var cheerHide: DispatchWorkItem?
    /// 이모티콘 서랍 — **입력칸 아래, 키보드가 서던 자리다**(카톡과 같다).
    private let tray = StickerTray()
    /* ── 검색(🔍) — 카톡과 같은 짜임 ───────────────────────
     * 머리말이 **검색칸 + `취소`**로 바뀌고 대화는 그대로 보이며,
     * 입력칸 자리에는 찾은 글 사이를 오가는 바(`FindBar`)가 선다.
     * 자세한 것은 `showSearch()` 머리말을 볼 것. */
    private let searchBox = UIView()
    private let searchField = UITextField()
    private let searchCancel = UIButton(type: .system)
    private let findBar = FindBar()
    private var searching = false
    private var hits: [NativeChatMessage] = []
    private var hitAt = 0
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
    /// 골라 둔 사진·동영상 한 개(`PickedMedia`). 보내기를 누를 때 올린다.
    private var picked: PickedMedia?
    /**
     * **고르고 나서 아직 못 읽어 온 것**(`동영상`/`사진`). 사진첩에서
     * 파일을 꺼내 오는 데 동영상은 몇 초가 걸리는데, 그동안 화면에 아무
     * 일도 안 일어나 **멈춘 줄 안다**(사용자 제보 — `동영상선택하고
     * 확인을 누르면 아무반응이없다가 갑자기 나타나서 순간 안되는건가?`).
     * 이 값이 있으면 입력칸 위에 `동영상 불러오는 중…`이 먼저 선다.
     */
    private var loadingWhat: String?
    /**
     * **여러 개를 고르면 아직 안 올린 것들이 여기 줄을 선다**(사용자 요청 —
     * `사진동영상 올릴때 여러개를 선택해서 올릴수있도록해줘`).
     *
     * **한 개씩 차례로 올린다** — 앞엣것이 끝나야 다음 것을 읽어 온다
     * (`sendMedia`의 `then`). 한꺼번에 읽으면 **원본 그대로 올리는**
     * 우리 규칙에서 동영상 열 개가 곧 수백 MB라 폰이 주저앉는다.
     * 차례로 두면 손에 들고 있는 파일이 늘 하나뿐이다.
     */
    private var pickQueue: [NSItemProvider] = []
    /// 이번에 고른 개수와 그 가운데 몇 번째인가 — `사진 불러오는 중… (2/5)`.
    private var pickTotal = 0
    private var pickDone = 0
    /// `더보기` 화면이 받아 둔 사진들(이어 받으려고 시각까지 들고 있다).
    private var galleryRows: [(id: String, url: String, at: String)] = []
    private var galleryMore = true
    private var galleryBusy = false
    /**
     * **지금 대화방에 먼저 그려 놓고 올라가는 중인 줄**(임시 id → 진행률).
     *
     * 카톡처럼 **고르는 순간 그림이 대화방에 뜨고** 그 위에서 고리가
     * 찬다(사용자 요청 — `사진이나 동영상 선택하고 확인누르면 채팅창에
     * 사진이나 동영상이 뜨고 내가 올린사진처럼 용량표시되게끔해줘`).
     */
    private var uploads: [String: (sent: Int64, total: Int64)] = [:]
    /// 그 줄을 올리고 있는 일. 가운데 `✕`를 누르면 이걸 끊는다.
    private var jobs: [String: Task<Void, Never>] = [:]
    /// 골라 둔 것의 미리보기 열쇠(임시 id → `local:…`). 끝나면 지운다.
    private var previews: [String: String] = [:]
    /// 보내는 일(글). 화면을 떠날 때 끊지 않는다 — 보내다 만 글이 사라진다.
    private var sendTask: Task<Void, Never>?
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
        /* **입력칸 뒤에 판을 깔지 않는다 — 대화 바탕색 그대로다**(사용자
           요청 — `메시지입력하는 창 뒷배경을 카톡처럼 삭제해줘` · 카톡
           오픈톡 화면을 받아 맞췄다). 예전에는 화면 바탕(크림색)이라
           목록 아래에 **판이 하나 더 깔린 것처럼** 보였다 — 카톡의 그
           줄은 글칸 알약 하나만 대화 바탕 위에 떠 있다.
           웹 `Chat.css`의 `.chat-input`·`lib/composer.ts`의
           `chatBarSkin()`과 **같은 값이라 한쪽만 고치지 말 것.**
           위쪽 선은 같은 색으로 덮어 없애고, 글칸은 말풍선과 같은 흰
           알약이며, `+`의 획만 흰색이다(글자는 그 알약 위라 먹색 그대로). */
        composer.cBg = ChatSkin().bg; composer.cLine = ChatSkin().bg
        composer.cField = ChatSkin().bubble
        composer.cIcon = ChatSkin().on
        composer.cBrand = UIColor(red: 0.91, green: 0.29, blue: 0.50, alpha: 1)
        /* **글칸 한 줄 높이는 카톡 화면을 픽셀로 재서 맞춘 값이다**(사용자
           요청 — `메시지입력창 크기를 카톡하고 똑같이해주고`). 1206×2622 ·
           배율 3.0에서 카톡 알약이 **145픽셀 = 48px**이었고 우리 것은
           114픽셀 = 38px이라 그만큼 납작해 보였다. 꽉 둥근 알약이라
           반지름은 그 절반이다. **눈대중으로 고치지 말 것.**
           웹 `Chat.css`의 `.chat-input .textarea`·`lib/composer.ts`의
           `chatBarSkin()`과 **같은 값이라 한쪽만 고치지 말 것.**
           (댓글 바는 38px 그대로다 — 밝은 화면 위에 잠깐 뜨는 줄이다.) */
        composer.minH = 48; composer.radius = 24
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
        buildSearch()
        header.addArrangedSubview(searchBox); header.addArrangedSubview(searchCancel)
        findBar.onUp = { [weak self] in self?.step(1) }
        findBar.onDown = { [weak self] in self?.step(-1) }
        context.axis = .vertical; context.spacing = 4; context.isHidden = true
        /* 입력칸 위에 쌓이는 것들의 **뒤는 대화 바탕색**이다(웹의 `.chat-over`).
           안 깔면 화면 바탕(크림색)이 비쳐 판이 하나 더 있는 것처럼 보인다 —
           `MentionList`·`ReplyBox` 머리말의 그 자리다. */
        context.backgroundColor = ChatSkin().bg
        reply.onJump = { [weak self] in if let q = self?.quoted { self?.jumpToID(q.id) } }
        reply.onClose = { [weak self] in self?.quoted = nil; self?.retryRow = nil; self?.updateContext() }
        mentions.onPick = { [weak self] name in self?.mentionPicked(name) }
        suggest.onPick = { [weak self] item in self?.stickerPicked(item) }
        tray.onPick = { [weak self] item in self?.stickerPicked(item) }
        /* 카드를 누르면 **그 이모티콘만** 나간다(글은 입력칸에 남는다 —
           웹의 미리보기와 같은 규칙). `✕`는 고른 것을 뗀다. */
        peek.onSend = { [weak self] in self?.composerSend(text: "") }
        peek.onClose = { [weak self] in
            self?.sticker = nil; self?.retryRow = nil; self?.updateContext()
        }
        /* **폭죽 단추는 맨 위다**(웹 `.chat-over`와 같은 차례) — 언급 목록과
           인용은 입력칸에 가까이 붙어 있어야 무엇에 딸린 것인지 읽힌다. */
        cheer.onTap = { [weak self] in self?.fireCheer() }
        /* **이모티콘 줄은 폭죽 바로 아래다**(웹 `.chat-over`와 같은 차례) —
           언급 목록과 인용은 입력칸에 가까이 붙어 있어야 무엇에 딸린
           것인지 읽힌다. */
        let input = UIStackView(arrangedSubviews: [cheer, suggest, mentions, reply, context, composer, findBar]); input.axis = .vertical
        /* `footPad`가 맨 뒤다 — 서랍(`tray`)이 열리면 그 자리를 덮어야 한다. */
        footPad.backgroundColor = ChatSkin().bg
        footPad.isUserInteractionEnabled = false
        for child in [footPad, header, list, input, tray, status] { child.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(child) }
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
            /* 입력칸 아래부터 화면 끝까지 — 키보드가 올라와 있으면 그 자리는
               키보드가 덮으므로 눈에 안 띈다. */
            footPad.topAnchor.constraint(equalTo: input.bottomAnchor),
            footPad.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            footPad.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            footPad.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tray.topAnchor.constraint(equalTo: input.bottomAnchor), trayH,
            tray.leadingAnchor.constraint(equalTo: view.leadingAnchor), tray.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            list.topAnchor.constraint(equalTo: header.bottomAnchor), list.leadingAnchor.constraint(equalTo: safe.leadingAnchor),
            list.trailingAnchor.constraint(equalTo: safe.trailingAnchor), list.bottomAnchor.constraint(equalTo: input.topAnchor),
            status.centerXAnchor.constraint(equalTo: list.centerXAnchor), status.centerYAnchor.constraint(equalTo: list.centerYAnchor),
            status.widthAnchor.constraint(lessThanOrEqualTo: list.widthAnchor, constant: -32)
        ])
        /* **고른 이모티콘 카드는 목록 위, 입력칸 묶음 바로 위에 뜬다** — 추천
           줄이 떠 있으면 그 줄 위다(줄이 `input` 안에 있다). 가운데에 선다.
           뒤에 얹는 길게 누른 창·서랍·프로필보다는 아래다(그것들이 다 덮는다). */
        peek.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(peek)
        NSLayoutConstraint.activate([
            peek.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            peek.bottomAnchor.constraint(equalTo: input.topAnchor, constant: -9),
            peek.widthAnchor.constraint(equalToConstant: StickerPeek.size.width),
            peek.heightAnchor.constraint(equalToConstant: StickerPeek.size.height),
        ])
        status.titleLabel?.numberOfLines = 0; status.titleLabel?.textAlignment = .center
        status.setTitleColor(.white, for: .normal); status.setTitle("대화를 불러오는 중…", for: .normal)
        status.accessibilityIdentifier = "native-chat-status"
        status.addAction(UIAction { [weak self] _ in self?.startLoad() }, for: .touchUpInside)

        /* 길게 누른 창 · 서랍 · 프로필은 **맨 위에 얹는다** — 이 셋이
           입력칸(네이티브 바)까지 덮어야 한다. */
        for v in [hold, drawer, gallery, profile] as [UIView] {
            v.frame = view.bounds
            v.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            view.addSubview(v)
        }
        hold.onPick = { [weak self] kind, value in self?.holdPicked(kind, value) }
        drawer.onClose = { [weak self] in self?.drawer.hide() }
        drawer.onPerson = { [weak self] id in self?.drawer.hide(); self?.showProfile(id) }
        drawer.onPhoto = { [weak self] url in self?.showPhoto(url) }
        drawer.onMore = { [weak self] in self?.showGallery() }
        /* **서랍은 안 닫는다** — 닫으면 이 화면을 닫았을 때 돌아올 데가
           없다(썸네일을 눌러 사진을 크게 볼 때와 같은 까닭이다). */
        gallery.onClose = { [weak self] in self?.gallery.hide() }
        gallery.onPhoto = { [weak self] url in self?.showPhoto(url) }
        gallery.onMore = { [weak self] in self?.loadGallery(reset: false) }
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
        headerBack = back
        observers.append(NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self = self, self.visible else { return }; self.realtime?.start(); self.sync()
            }
        })
        observers.append(NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in self?.realtime?.stop() }
        })
        /* 서랍을 열기 전에 첫 묶음을 미리 풀어 둔다 — 대화가 한 번 그려진
           뒤에 시작한다(그 전에 하면 지금 보고 있는 것과 다툰다). */
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in self?.warmStickers() }
    }

    /**
     * **첫 묶음의 멈춘 그림을 미리 풀어 둔다**(`ImageStore.warm` 주석).
     *
     * 서랍은 늘 첫 묶음으로 열리고(`고른 묶음을 기억해 두지 않는다`)
     * 그 묶음이 통째로 움직이는 판이라 **여는 그 자리에서 열대여섯 장을
     * 풀기 시작해 칸이 비어 있었다.** 멈춘 그림(`<id>.png`)은 늘 함께
     * 있으므로(`lib/stickers.ts`) 그것만 미리 담아 둔다.
     *
     * **움직이는 판(`.webp`)은 미리 풀지 말 것** — 서른 장이 94MB라
     * 캐시 한도(48MB)를 넘겨 서로를 밀어낸다.
     */
    private func warmStickers() {
        guard let first = service.config.stickers.first,
              let list = first["stickers"] as? [ChatJSON] else { return }
        let stills = list.compactMap { item -> String? in
            guard let src = item["src"] as? String, src.hasSuffix(".webp") else { return nil }
            return String(src.dropLast(4)) + "png"
        }
        guard !stills.isEmpty else { return }
        ImageStore.warm(stills)
    }

    /**
     * **왼쪽 가장자리에서는 iOS의 뒤로 가기가 이긴다**(`EdgeBack`).
     *
     * 그 길로 가야 **키보드가 화면과 한 몸으로 밀려 나간다** — 우리가 손으로
     * 미는 `BackDrag`는 키보드를 못 데려간다(딴 창이라 그림에 안 담긴다).
     * 우리 손짓 둘에 `require(toFail:)`을 걸어 두면 가장자리에서는 저쪽이
     * 먼저 서고, **가장자리가 아닌 자리에서는 저 손짓이 그 자리에서 실패해**
     * 예전처럼 우리가 끈다(늦어지는 것이 없다).
     *
     * 화면이 틀에 얹힌 뒤라야 그 손짓을 찾을 수 있어 여기서 건다.
     */
    private func linkEdge() {
        guard !edgeLinked, let edge = navigationController?.interactivePopGestureRecognizer
        else { return }
        edgeLinked = true
        headerBack?.require(toFail: edge)
        list.requireFail(edge)
    }

    /// Clear the previous keyboard/geometry state before reattaching this view.
    /// Once UIKit starts pushing, its root frame/layer must not be reset by us.
    func prepareForEntry(in bounds: CGRect) {
        loadViewIfNeeded()
        UIView.performWithoutAnimation {
            dropKeyboard(); backDrag.end()
            view.layer.removeAllAnimations(); view.transform = .identity
            view.frame = bounds
            view.layoutIfNeeded()
        }
    }

    private var entering = false
    func beginNavigationEntry() { entering = true; composer.acceptsFocus = false }
    func finishNavigationEntry(_ done: @escaping () -> Void = {}) {
        // Let UIKit finish responder restoration before accepting a fresh tap.
        DispatchQueue.main.async { [weak self] in
            self?.entering = false
            self?.composer.acceptsFocus = true
            done()
        }
    }

    override func didMove(toParent parent: UIViewController?) {
        super.didMove(toParent: parent)
        if parent != nil { linkEdge() }
        else if visible && !navigating { leftByIOS() }
    }

    func resume() {
        loadViewIfNeeded(); visible = true; navigating = false; leaving = false
        linkEdge()
        if loaded {
            _ = list.beginSession("native:\(me):\(room)"); view.layoutIfNeeded(); list.restoreSession()
            render(); realtime?.start(); sync()
        } else { startLoad() }
    }
    func pause() {
        visible = false; list.pauseSession(); dropKeyboard(); setTray(false)
        backDrag.end()
        /* 덮는 창은 화면을 떠날 때 함께 걷는다 — 남으면 다시 들어왔을 때
           엉뚱한 창이 떠 있는 꼴이 된다(토스트도 같다). */
        hold.hide(); drawer.hide(); gallery.hide(); profile.hide(); ToastHUD.clear()
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
        composer.setTray(on)
        view.layoutIfNeeded()
        /* **그림 칸을 다시 그리는 것은 높이가 정해진 _뒤_다.** 서랍이 닫혀
           있는 동안 그 칸은 **폭은 제 폭인데 높이가 0**이라(좌우가 화면에
           묶여 있다), 그 상태에서 `reloadData()`를 부르면 보이는 자리가
           없어 **한 칸도 안 만들어지고**, 그다음 높이가 자라도 다시 묻지
           않는다 — 탭을 한 번 눌러야(`choose`가 그때 다시 그린다) 그제야
           떴다(사용자 제보 — `앱을 처음켜서 … 이모티콘버튼을 누르면 몇분이
           지나도 … 다른 이모티콘탭을 누르지않는이상`).
           **`layoutIfNeeded()` 앞으로 도로 옮기지 말 것** — 폭은 안 바뀌므로
           `layoutSubviews`의 폭 검사에도 안 걸린다. */
        if on { tray.mark(sticker?["id"] as? String ?? ""); tray.refresh() }
        if bottom { list.scrollToBottom(animated: false) }
    }

    private func stickerPicked(_ item: ChatJSON) {
        sticker = item; picked = nil; retryRow = nil; updateContext()
        /* **추천 줄은 그대로 둔다**(카톡과 같다 — 사용자 요청). 고른 것은
           그 위의 카드(`peek`)가 크게 보여 주므로 흐려질 일이 없고, 줄이
           남아 있어야 **옆의 것을 눌러 바로 바꿀 수 있다.** 예전에는 걷었다가
           다른 것을 고르려면 글을 다시 쳐야 했다. */
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
            }
        default:
            break
        }
    }

    /**
     * **iOS가 화면을 내렸을 때도 웹에 알린다**(가장자리 끌기 · `EdgeBack`).
     *
     * 그 길에서는 `goBack`이 아예 안 불리므로, 이 한 곳이 없으면 **화면은
     * 사라졌는데 웹의 주소는 대화방에 그대로 남는다.**
     *
     * **우리가 내리는 길과는 갈린다** — `goBack`은 `navigating`을 미리
     * 세우고 `pause()`(플러그인의 `remove`가 부른다)는 `visible`을 내리므로,
     * 둘 다 여기서 그냥 지나간다.
     */
    // willMove(nil) can precede creation of UIKit's interactive coordinator.
    // didMove(nil), above, is the completed removal; cancellation keeps its parent.

    /**
     * **키보드를 내린다 — `holdFocus`를 먼저 푼다.**
     *
     * 초점을 준 뒤 0.8초는 글칸이 놓기를 거절하므로(3판의 `holdFocus`)
     * 안 풀면 우리가 내리는 것까지 막힌다. 화면을 훑는 `endEditing`만으로는
     * 초점이 이 화면 밖(검색칸 등)에 있는 판을 놓치므로 둘 다 부른다.
     */
    private func dropKeyboard() {
        composer.holdFocus = false
        composer.textView.resignFirstResponder()
        searchField.resignFirstResponder()
        view.endEditing(true)
    }

    /// All close callers wait for the actual navigation completion, not a guessed
    /// 0.42 seconds (which can be shorter than UIKit's keyboard transition).
    func whenExitFinishes(_ done: @escaping () -> Void) {
        if exitSettled { done() } else { exitWaiters.append(done) }
    }

    private func settleAfterPop(_ coordinator: UIViewControllerTransitionCoordinator?) {
        composer.holdFocus = false
        exitSettled = false
        if let coordinator = coordinator,
           coordinator.animate(alongsideTransition: nil, completion: { [weak self] context in
               guard !context.isCancelled else { return }
               self?.afterPop()
           }) { return }
        afterPop()
    }

    private func afterPop() {
        guard navigating else { return }
        // UIKit has finished; keyboard callbacks must not animate an offscreen view.
        UIView.performWithoutAnimation { dropKeyboard() }
        exitSettled = true
        let waiters = exitWaiters; exitWaiters.removeAll()
        waiters.forEach { $0() }
    }

    /// iOS가 화면을 내렸다 — 웹의 주소만 되돌린다.
    private func leftByIOS() {
        guard visible, !navigating else { return }
        navigating = true; leaving = true
        if searching { setSearch(false) }
        list.pauseSession(); setTray(false)
        /* 이 길에는 `goBack`이 아예 안 불린다 — 깔아 둔 그림을 걷고
           키보드를 내리는 일도 여기서 함께 한다. */
        backdrop?.removeFromSuperview(); backdrop = nil
        backDrag.end()
        settleAfterPop(navigationController?.transitionCoordinator)
        /* **`plain`이다 — `commit`이 아니다.** `commit`은 `BackDrag`가 깔아 둔
           앞 화면 그림을 걷는 갈래라(`nativeBackEnd`) 시작한 적이 없는 여기서
           부르면 짝이 안 맞는다. 화면을 옮기는 일은 이미 iOS가 다 했으므로
           웹은 `←`로 나갈 때와 똑같이 주소만 되돌리면 된다. */
        event?("back", ["phase": "plain"])
    }

    /**
     * 뒤로 간다 — **어디로 갈지는 웹이 안다**(히스토리가 비었으면 홈으로).
     * `drag`면 이미 화면을 다 내보낸 뒤라 웹이 곧바로 옮긴다.
     */
    private func goBack(drag: Bool) {
        guard !navigating, !entering else { return }; navigating = true
        /* **화면은 다시 쓰인다**(`NativeChatPlugin.open`이 한 번 만든 것을
           들고 있다) — 검색 중에 나가면 다음에 들어올 때 검색칸이 그대로
           남는다. 나가는 길 넷(화살표·끌기·카드·알림)이 다 여기를 지난다. */
        if searching { setSearch(false) }
        list.pauseSession(); setTray(false)
        /* ── 화면 틀이 내려 준다 ───────────────────────────────────
         *
         * **여기서 키보드를 먼저 내리지 말 것.** 카톡처럼 키보드가 화면과
         * **한 몸으로** 밀려 나가는 것이 이 틀에 얹은 까닭이라(실기기에서
         * 확인했다 — `AppDelegate`의 `wrapInNavigation` 주석), 우리가 먼저
         * 내려 버리면 그 자리가 없어진다. 대신 **다 내려간 뒤에** 내린다
         * (`settleAfterPop`) — 안 내리면 글칸이 초점을 쥔 채 떠나
         * 다음에 들어올 때 키보드가 그대로 올라온다.
         *
         * 끌어서 넘어온 판(`drag`)은 `BackDrag`가 이미 다 보여 줬으므로
         * 움직임 없이 내리기만 한다. */
        if let nav = navigationController, nav.topViewController === self {
            leaving = true
            backdrop?.removeFromSuperview(); backdrop = nil
            nav.popViewController(animated: !drag)
            settleAfterPop(nav.transitionCoordinator)
            event?("back", ["phase": drag ? "commit" : "plain"])
            return
        }
        view.endEditing(true)
        /* **화살표로 나갈 때도 오른쪽으로 빠져나간다** — 끌어서 나가는
           길에는 이미 앱이 그림을 내보내고 있지만(`BackDrag`), 눌러서
           나가는 길에는 아무것도 없어 화면이 그 자리에서 툭 사라졌다.
           **플러그인이 이만큼 기다렸다 걷는다**(`leaving`) — 먼저 걷으면
           움직임이 한가운데서 잘린다. */
        if !drag {
            leaving = true; exitSettled = false
            UIView.animate(withDuration: Self.exitMS, delay: 0,
                           options: [.curveEaseOut, .beginFromCurrentState]) {
                self.view.transform = CGAffineTransform(translationX: self.view.bounds.width, y: 0)
            } completion: { [weak self] _ in self?.afterPop() }
        }
        event?("back", ["phase": drag ? "commit" : "plain"])
    }

    private func navigate(_ path: String) {
        guard !navigating else { return }; navigating = true
        if searching { setSearch(false) }
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
                self.refreshMentionPaint()
                let latest = try await self.service.messages(self.room, limit: 100)
                try Task.checkCancellation()
                self.messages = latest.reversed(); self.hasMore = latest.count == 100
                /* **얼굴을 목록보다 먼저 담아 둔다**(`FaceStore` 머리말) — 안 그러면
                   처음 그릴 때 얼굴이 이름 두 글자로 떴다가 사진으로 바뀐다.
                   읽음·반응을 받는 동안 함께 받고, 그리기 직전에 조금만 더 기다린다. */
                let faces = self.recentFaces()
                FaceStore.shared.warm(faces, timeout: 0) {}
                self.reads = (try? await self.service.reads(self.room)) ?? [:]
                self.reactions = (try? await self.service.reactions(self.messages.map { $0.id })) ?? []
                await FaceStore.shared.warm(faces, timeout: 0.3)
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
    /// 첫 화면에 보일 만한 줄(맨 아래 마흔)의 글쓴이 얼굴 주소.
    private func recentFaces() -> [String] {
        let who = Set(messages.suffix(40).filter { !$0.system }.map { $0.user })
        return people.compactMap { p in
            guard let id = p["id"] as? String, who.contains(id),
                  let u = p["avatar_url"] as? String, !u.isEmpty else { return nil }
            return u
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
        checkCheer()
    }

    /**
     * 축하하는 말이 새로 들어왔으면 폭죽 단추를 띄운다.
     *
     * **글이 모이는 자리가 여기 하나라 여기서 본다** — 실시간으로 들어온
     * 것도, 다시 받아 온 것도, 내가 보낸 것도 다 `merge`를 지난다.
     *
     * **첫 판은 적어 두기만 한다**(`cheerMark`가 비었을 때). 그러지 않으면
     * 대화방에 들어가자마자 **어제 축하로 단추가 뜬다** — 웹의 그 문지기와
     * 같은 자리다. 시각도 함께 봐서(`ChatCheer.window`) 밀린 글을 한꺼번에
     * 받아 올 때 지난 축하가 걸리지 않게 한다.
     */
    private func checkCheer() {
        guard let last = messages.last else { return }
        let mark = cheerMark
        cheerMark = last.at
        guard !mark.isEmpty else { return }
        let now = Date()
        let hit = messages.contains { m in
            m.at > mark && ChatCheer.isCheer(m.body)
                && now.timeIntervalSince(NativeChatRows.date(m.at)) < ChatCheer.window
        }
        guard hit else { return }
        showCheer()
    }

    /// 단추를 띄우고 `ChatCheer.window`가 지나면 스스로 걷는다.
    private func showCheer() {
        guard isViewLoaded else { return }
        cheer.isHidden = false
        cheerHide?.cancel()
        let job = DispatchWorkItem { [weak self] in self?.cheer.isHidden = true }
        cheerHide = job
        DispatchQueue.main.asyncAfter(deadline: .now() + ChatCheer.window, execute: job)
    }

    /**
     * 눌렀다 — **내 화면에서만** 터진다(남의 화면을 우리가 건드리지 않는다).
     * 단추는 그 자리에서 걷는다(웹과 같다 — 터뜨리고 나면 할 일이 없다).
     */
    private func fireCheer() {
        cheerHide?.cancel(); cheerHide = nil
        cheer.isHidden = true
        CheerBurst.fire(over: view)
    }
    private func render() {
        guard isViewLoaded else { return }
        list.apply(rows: NativeChatRows.make(messages, user: me, people: people, reads: reads,
                                            reactions: reactions, unread: unread,
                                            uploads: uploads), stickBottom: true)
        status.isHidden = !messages.isEmpty
        if messages.isEmpty { status.setTitle("첫 마디를 남겨 보세요.", for: .normal) }
        composer.sendBtn.isEnabled = !busy; composer.plusBtn.isEnabled = !busy
    }
    private func sync() {
        guard visible, loaded, syncTask == nil else { return }
        /* **올라가는 중인 임시 줄은 기준이 못 된다** — 그 시각 뒤엣것만
           받으면 진짜 새 글을 통째로 건너뛴다. */
        let catchUpFrom = messages.last { !$0.id.hasPrefix("tmp:") }
        syncTask = Task { [weak self] in
            guard let self = self else { return }; defer { self.syncTask = nil }
            do {
                // Reconcile loaded IDs, including edits/deletions while the screen was away.
                let ids = self.realIDs
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
                self.reactions = try await self.service.reactions(self.realIDs)
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
                self.reactions = try await self.service.reactions(self.realIDs)
                try Task.checkCancellation(); self.render()
            } catch { /* The reconnect sync also refreshes metadata. */ }
        }
    }
    private func markRead() {
        guard visible, !windowed, bottom,
              let newest = messages.last(where: { !$0.id.hasPrefix("tmp:") })?.at,
              newest != lastRead else { return }
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
                let temps = self.messages.filter { $0.id.hasPrefix("tmp:") }
                self.messages = try await self.service.messages(self.room).reversed()
                self.windowed = false; self.hasMore = self.messages.count == 50
                /* 올라가는 중인 줄은 남긴다 — 목록을 갈아 끼웠다고 올리던
                   것이 화면에서 사라지면 멈춘 줄 안다. */
                self.merge(temps)
                self.render(); self.list.scrollToBottom(animated: false); self.markRead()
            } catch { self.notice(error.localizedDescription) }
        }
    }

    // MARK: Native input and attachments
    func composerSend(text: String) {
        /* **사진·동영상은 제 길로 간다** — 고른 순간 이미 대화방에 떠서
           올라가고 있고(`sendMedia`), 여기 `picked`가 남아 있는 것은
           **올리다 실패해 물려 둔 것**뿐이다(다시 보내기). */
        if let media = picked, retryRow == nil {
            picked = nil; updateContext(); sendMedia(media); return
        }
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !busy, loaded, !body.isEmpty || sticker != nil || retryRow != nil else { return }
        guard body.count <= 1000 else { notice("메시지는 1,000자까지 보낼 수 있습니다."); return }
        busy = true; composer.sendBtn.isEnabled = false; composer.plusBtn.isEnabled = false
        let chosen = sticker, quote = quoted
        // Keep the first responder (and Korean composition/keyboard) alive during I/O.
        context.isUserInteractionEnabled = false
        self.reply.isUserInteractionEnabled = false
        sendTask = Task { [weak self] in
            guard let self = self else { return }
            defer {
                self.busy = false; self.context.isUserInteractionEnabled = true
                self.reply.isUserInteractionEnabled = true
                self.composer.sendBtn.isEnabled = true; self.composer.plusBtn.isEnabled = true
                self.sendTask = nil
            }
            do {
                var row: ChatJSON
                if let retry = self.retryRow { row = retry }
                else {
                    row = ["id": UUID().uuidString.lowercased(), "room_id": self.room, "user_id": self.me, "body": body]
                    if let quote = quote { row["reply_to"] = quote.id }
                    if let id = chosen?["id"] as? String { row["image_url"] = "sticker:\(id)" }
                    self.retryRow = row
                }
                let sent = try await self.service.send(row)
                self.retryRow = nil; self.quoted = nil; self.sticker = nil
                if self.composer.text == text {
                    self.composer.text = ""; self.suggest.clear(); self.composer.suggestHits = []
                }
                self.updateContext()
                if self.windowed {
                    let temps = self.messages.filter { $0.id.hasPrefix("tmp:") }
                    self.messages = try await self.service.messages(self.room).reversed()
                    self.windowed = false; self.merge(temps)
                }
                self.merge([sent]); self.render(); self.list.scrollToBottom(animated: false)
                self.markRead()
            } catch {
                self.notice("\(error.localizedDescription)\n내용은 보관했습니다. 보내기를 눌러 다시 시도하세요.")
            }
        }
    }

    /**
     * **고른 사진·동영상을 그 자리에서 대화방에 띄우고 올린다.**
     *
     * 사용자 요청 — `사진이나 동영상 선택하고 확인누르면 채팅창에 사진이나
     * 동영상이 뜨고 내가 올린사진처럼 용량표시되게끔해줘`(카톡 화면을 받아
     * 맞췄다). 예전에는 입력칸 위에 물려 두고 **보내기를 눌러야** 올라갔는데,
     * 올리는 데 몇십 초가 걸리는 동영상에서는 그 작은 칸이 지금 무슨 일이
     * 벌어지는지 말해 주기에 너무 작았다.
     *
     * 규칙 넷:
     * - **임시 줄은 `tmp:`로 시작한다**(웹의 `TEMP_ID`와 같은 결이다) —
     *   아직 서버에 없는 id라 **어느 조회에도 실어 보내면 안 된다**
     *   (`realIDs`가 그 문지기다. 한 줄만 섞여도 그 조회가 400으로 막힌다).
     * - **보여 줄 그림은 `local-preview/…` 열쇠로 `ImageStore`에 담는다** —
     *   아직 아무 주소에도 없는 그림이다. 끝나면 지운다.
     * - **글은 함께 안 실린다**(카톡과 같다). 치던 글은 글칸에 그대로
     *   남아 따로 보내진다 — 고르자마자 올라가므로 덧붙일 틈이 없다.
     * - **실패하면 입력칸 위에 도로 물려 둔다**(`picked`) — 파일이
     *   사라지면 다시 고르러 가야 한다. `✕`로 버릴 수도 있다.
     */
    private func sendMedia(_ media: PickedMedia, then: (() -> Void)? = nil) {
        guard loaded else { then?(); return }
        let temp = "tmp:" + UUID().uuidString.lowercased()
        /* **`local:`처럼 스킴을 붙이지 말 것** — `URL(string:)`이 그것을
           비계층 주소로 보아 `path`가 빈 글자가 되고, 그러면 주소 끝으로
           동영상을 가리는 `ChatMedia`가 헛돈다. 그냥 경로 모양으로 둔다. */
        let key = "local-preview/\(UUID().uuidString.lowercased()).\(media.ext)"
        ImageStore.hold(key, media.preview)
        previews[temp] = key
        let quote = quoted
        var raw: ChatJSON = ["id": temp, "room_id": room, "user_id": me, "body": "",
                             "created_at": NativeChatRows.now(), "image_url": key]
        if let quote = quote { raw["reply_to"] = quote.id }
        quoted = nil; updateContext()
        let size = Int64(media.data.count)
        uploads[temp] = (0, size)
        merge([NativeChatMessage(raw: raw)])
        render(); list.scrollToBottom(animated: false)
        jobs[temp] = Task { [weak self] in
            guard let self = self else { then?(); return }
            /* **끝나면 줄 선 다음 것을 읽어 온다** — 성공이든 실패든
               그만둔 것이든 한 번만 부른다. */
            defer { self.jobs[temp] = nil; then?() }
            do {
                let url = try await self.service.upload(
                    media.data, room: self.room, ext: media.ext, type: media.type,
                    progress: { [weak self] sent, total in
                        guard let self = self, self.uploads[temp] != nil else { return }
                        let all = total > 0 ? total : size
                        self.uploads[temp] = (min(sent, all), all)
                        /* **줄을 통째로 다시 만들지 않는다** — 초에 수십 번
                           오는 값이라 그때마다 높이를 다시 잰다. */
                        self.list.markUpload(temp, sent: min(sent, all), total: all)
                    })
                var row: ChatJSON = ["id": UUID().uuidString.lowercased(), "room_id": self.room,
                                     "user_id": self.me, "body": "", "image_url": url]
                if let quote = quote { row["reply_to"] = quote.id }
                let sent = try await self.service.send(row)
                self.drop(temp)
                if self.windowed {
                    let temps = self.messages.filter { $0.id.hasPrefix("tmp:") }
                    self.messages = try await self.service.messages(self.room).reversed()
                    self.windowed = false; self.merge(temps)
                }
                self.merge([sent]); self.render(); self.list.scrollToBottom(animated: false)
                self.markRead()
            } catch {
                self.drop(temp)
                /* **그만둔 것은 고장이 아니다** — 사람이 `✕`를 누른 자리라
                   오류 문구를 띄우면 무엇이 잘못된 줄 안다. */
                if Task.isCancelled || (error as NSError).code == NSURLErrorCancelled {
                    self.render(); self.notice("올리기를 그만뒀습니다.")
                    return
                }
                /* **한 장이 실패하면 줄 선 나머지는 멈춘다** — 대개 통신이
                   끊긴 것이라 줄줄이 실패하고, 무엇보다 다음 것을 읽어 오면
                   `took()`이 방금 물려 둔 `picked`를 덮어써 **다시 보낼
                   길이 없어진다.** 오류 문구는 `보내기를 눌러 다시`라고
                   말하는데 그 파일이 사라지는 셈이다. */
                self.pickQueue.removeAll()
                /* 파일은 물려 둔다 — 다시 고르러 가지 않게. */
                self.picked = media; self.updateContext(); self.render()
                self.notice("\(error.localizedDescription)\n\(media.isVideo ? "동영상" : "사진")을 보관했습니다. 보내기를 눌러 다시 시도하세요.")
            }
        }
    }

    /// 임시 줄을 목록과 표 셋에서 함께 걷는다. **한 곳만 지우지 말 것** —
    /// 남으면 그 줄이 영영 올라가는 중으로 보이거나 그림이 안 걷힌다.
    private func drop(_ temp: String) {
        messages.removeAll { $0.id == temp }
        uploads[temp] = nil
        if let key = previews.removeValue(forKey: temp) { ImageStore.drop(key) }
    }

    /// 올리는 중인 그림 가운데의 `✕`를 눌렀다 — 그 줄을 통째로 걷는다.
    private func cancelUpload(_ temp: String) {
        jobs[temp]?.cancel()
    }

    /// **서버에 있는 글만**. `tmp:` 줄을 조회에 실어 보내면 그 조회가
    /// 통째로 400으로 막힌다(웹의 `TEMP_ID`와 같은 자리다).
    private var realIDs: [String] { messages.map { $0.id }.filter { !$0.hasPrefix("tmp:") } }
    func composerChanged(text: String, sel: Int) {
        // Changing a failed draft is an explicit new message, never reuse its UUID.
        if let row = retryRow, row["body"] as? String != text.trimmingCharacters(in: .whitespacesAndNewlines) { retryRow = nil }
        updateMention(text: text, sel: sel)
        updateSuggest(text)
    }
    private func updateMention(text: String, sel: Int) {
        let ns = text as NSString; let before = ns.substring(to: min(sel, ns.length)) as NSString
        let range = before.range(of: "@", options: .backwards)
        mentions.clear(); mentionRange = nil
        guard range.location != NSNotFound else { return }
        let query = before.substring(from: range.location + 1)
        guard !query.contains(" "), !query.contains("\n"), query.count <= 12 else { return }
        mentionRange = NSRange(location: range.location, length: before.length - range.location)
        mentions.show(mentionItems(query), picked: mentioned())
    }

    /**
     * 치는 글에 어울리는 이모티콘 줄 — 카톡의 그것이다(사용자 요청 —
     * `굿모닝하면 관련 이모티콘이뜨는거말이야`).
     *
     * **고르는 규칙은 웹에만 있다**(`src/lib/suggest.ts`). 열 때 표를 통째로
     * 받아 오므로(`config.suggest`) 여기서 하는 일은 **글에 그 말이
     * 들었는지**를 보는 것뿐이다 — 서른 꼭지에 이백 줄이라 앱에 또 적으면
     * 반드시 어긋난다(축하 폭죽은 말이 셋뿐이라 양쪽에 적어 두었다).
     *
     * **이미 골라 둔 것이 있으면 접는다** — 그 자리에 미리보기가 이미 서
     * 있다. **`@`를 치는 동안에도 접는다** — 입력칸 위에 두 줄이 겹쳐
     * 쌓이면 말풍선이 통째로 가린다(부르는 일이 먼저다).
     */
    private func updateSuggest(_ text: String) {
        guard mentionRange == nil else {
            suggest.clear(); composer.suggestHits = []; return
        }
        let found = suggestFind(text)
        suggest.show(found.items)
        /* **줄이 떠 있을 때만 칠한다** — 그래야 `이 글자 때문에 이 줄이
           떴다`가 그대로 읽힌다(카톡도 그 자리에서만 파랗다). */
        composer.suggestHits = found.items.isEmpty ? [] : found.hits
    }

    /**
     * 깎은 글과 **그 글자가 원문 어디였는지**. 깎으면서 공백·문장부호가
     * 빠지므로, 되짚어 칠하려면 자리를 함께 들고 있어야 한다.
     * 자리는 **UTF-16 기준**이라 그대로 `NSRange`로 쓴다.
     */
    private struct NormText {
        let scalars: [Unicode.Scalar]
        /// `scalars[i]`가 원문에서 시작·끝나는 UTF-16 자리.
        let from: [Int]
        let to: [Int]
    }

    /**
     * **글자를 깎는 자리가 웹과 같아야 한다**(공백·문장부호를 지우고
     * 소문자로) — 표의 말은 웹이 이미 그렇게 깎아 보낸 값이다.
     */
    private func normalize(_ text: String) -> NormText {
        let drop = CharacterSet(charactersIn: " \t\n!?~.,…'\"“”()·:;-_/")
        var kept: [Unicode.Scalar] = [], from: [Int] = [], to: [Int] = []
        var at = 0
        for u in text.unicodeScalars {
            let w = UTF16.width(u)
            if !drop.contains(u) {
                for low in String(u).lowercased().unicodeScalars {
                    kept.append(low); from.append(at); to.append(at + w)
                }
            }
            at += w
        }
        return NormText(scalars: kept, from: from, to: to)
    }

    /**
     * 표에서 고른다 — **차례는 이모티콘 목록 그대로**이고(웹의 `suggestFor`와
     * 같은 잣대), 움직이는 것은 `suggestAnim`장까지만 섞는다. 한 장이
     * 256px·열두 프레임이라 여덟을 다 움짤로 채우면 글자를 칠 때마다 폰이
     * 주저앉는다(멈춘 것은 7KB다).
     *
     * **걸린 말의 자리도 함께 돌려준다** — 글칸에서 그 글자만 파랗게
     * 칠하는 데 쓴다(`ComposerBar.suggestHits`).
     */
    private func suggestFind(_ text: String) -> (items: [ChatJSON], hits: [NSRange]) {
        let none: (items: [ChatJSON], hits: [NSRange]) = ([], [])
        let flat = service.config.stickers.flatMap { ($0["stickers"] as? [ChatJSON]) ?? [] }
        guard !flat.isEmpty, !service.config.suggest.isEmpty else { return none }
        let norm = normalize(text)
        /* 두 글자부터 본다 — 웹의 `SUGGEST_MIN`과 같은 값이다. */
        guard norm.scalars.count >= 2 else { return none }
        var hit = Set<String>()
        var spots: [NSRange] = []
        for rule in service.config.suggest {
            guard let words = rule["words"] as? [String], let ids = rule["ids"] as? [String] else { continue }
            var any = false
            for word in words where !word.isEmpty {
                let found = places(of: word, in: norm)
                if !found.isEmpty { any = true; spots.append(contentsOf: found) }
            }
            guard any else { continue }
            for id in ids { hit.insert(id) }
        }
        guard !hit.isEmpty else { return none }
        var out: [ChatJSON] = []
        var anim = 0
        for item in flat {
            guard let id = item["id"] as? String, hit.contains(id) else { continue }
            if (item["src"] as? String)?.hasSuffix(".webp") == true {
                if anim >= service.config.suggestAnim { continue }
                anim += 1
            }
            out.append(item)
            if out.count >= service.config.suggestMax { break }
        }
        return (out, merged(spots))
    }

    /// 깎은 글에서 `word`가 나온 자리를 **원문 UTF-16 범위**로 돌려준다.
    private func places(of word: String, in norm: NormText) -> [NSRange] {
        let w = Array(word.unicodeScalars)
        guard !w.isEmpty, norm.scalars.count >= w.count else { return [] }
        var out: [NSRange] = []
        var i = 0
        while i + w.count <= norm.scalars.count {
            var same = true
            for k in 0..<w.count where norm.scalars[i + k] != w[k] { same = false; break }
            if same {
                let a = norm.from[i], b = norm.to[i + w.count - 1]
                out.append(NSRange(location: a, length: b - a))
                i += w.count
            } else {
                i += 1
            }
        }
        return out
    }

    /// 겹치거나 맞닿은 자리를 합친다 — 한 말이 여러 꼭지에 걸리면 같은
    /// 자리가 여러 번 나온다.
    private func merged(_ spots: [NSRange]) -> [NSRange] {
        guard spots.count > 1 else { return spots }
        let sorted = spots.sorted { $0.location < $1.location }
        var out: [NSRange] = [sorted[0]]
        for r in sorted.dropFirst() {
            let last = out[out.count - 1]
            if r.location <= NSMaxRange(last) {
                let end = max(NSMaxRange(last), NSMaxRange(r))
                out[out.count - 1] = NSRange(location: last.location, length: end - last.location)
            } else {
                out.append(r)
            }
        }
        return out
    }
    /**
     * 언급 목록 한 줄 — **보이는 것은 이름표(`83/악마제리/광산구`),
     * 넣는 것은 닉네임이다**(`MentionList.Item` 머리말을 볼 것).
     *
     * **찾는 글자도 이름표로 거른다** — 목록에 적힌 그대로라 `83`이나
     * `광산`으로도 찾아지고, 닉네임은 그 안에 들어 있어 예전 길이 그대로 산다.
     */
    private func mentionItems(_ query: String) -> [MentionList.Item] {
        var out = members.compactMap { p -> MentionList.Item? in
            guard let name = p["name"] as? String, !name.isEmpty else { return nil }
            let label = NativeChatRows.label(p)
            return MentionList.Item(name: name, label: label.isEmpty ? name : label)
        }
        if !query.isEmpty { out = out.filter { $0.label.localizedCaseInsensitiveContains(query) } }
        /* `@전체`는 **운영진만** 쓴다 — 대화 알림을 꺼 둔 기기까지 다
           울리므로 아무나 쓰면 그 스위치가 있으나 마나가 된다. */
        if isAdmin && (query.isEmpty || ChatMentions.all.contains(query)) {
            out.insert(MentionList.Item(name: ChatMentions.all, label: ChatMentions.all), at: 0)
        }
        return out
    }
    /**
     * 글칸에서 칠할 이름들을 넘긴다 — 명단을 받은 뒤에 한 번이면 된다.
     * 나를 부른 자리와 `@전체`만 분홍이고 나머지는 파랑이다(웹 `.mention.me`).
     */
    /// 부를 수 있는 이름들. 칠하기·체크·빼기가 **같은 목록**을 봐야 한다.
    private func mentionNames() -> [String] {
        var names = members.compactMap { $0["name"] as? String }
        if isAdmin { names.append(ChatMentions.all) }
        return names
    }
    private func refreshMentionPaint() {
        let names = mentionNames()
        composer.mentionNames = names
        let myName = people.first { $0["id"] as? String == me }?["name"] as? String ?? ""
        composer.mentionMine = Set([myName, ChatMentions.all].filter { !$0.isEmpty })
    }
    /**
     * 글에 이미 들어간 이름 — 목록에서 그 줄에만 체크가 붙는다.
     *
     * **자르는 규칙은 말풍선 칠하기와 같은 것을 쓴다**(`ChatMentions.ranges`) —
     * 글자만 훑으면 `@김지명`에서 `김지`가 걸려 **안 부른 사람에게 체크가
     * 붙고, 다시 눌렀을 때 엉뚱한 자리가 지워진다.**
     */
    private func mentioned() -> Set<String> {
        Set(ChatMentions.ranges(composer.text, names: mentionNames()).map { $0.name })
    }
    /**
     * 목록에서 골랐다 — 친 `@…`를 이름으로 갈아 끼우고 커서를 뒤에 둔다.
     *
     * **고르고 나서도 목록을 남긴다**(사용자 요청 — `@눌러서 회원선택시
     * 다중선택기능 넣어줘`). 커서 자리에 길이 0짜리 자리를 잡아 두면
     * 다음에 고른 이름이 **그 자리에 이어 붙는다** — 한 사람만 부를
     * 때는 예전과 똑같이 한 번만 누르면 된다.
     *
     * **다시 여는 것은 `composer.caret`을 준 뒤에 한다** — 커서를 옮기면
     * `textViewDidChangeSelection`이 `composerChanged`를 불러 목록을
     * 걷어 내므로, 그 앞에서 열어 두면 조용히 닫힌다.
     *
     * **이미 부른 사람을 다시 누르면 뺀다**(사용자 요청 — `선택했던 사람을
     * 다시 누르게 되면 또 선택되는 게 아니고 선택 해제 될수 있게`).
     * 넣든 빼든 목록은 그대로 남으므로 이어서 고칠 수 있다.
     */
    private func mentionPicked(_ name: String) {
        guard mentionRange != nil else { return }
        if let hit = ChatMentions.ranges(composer.text, names: mentionNames())
            .first(where: { $0.name == name }) {
            let ns = composer.text as NSString
            var cut = hit.range
            /* 뒤에 붙여 둔 공백 하나까지 걷어낸다 — 안 걷으면 뺀 자리에
               빈칸이 남아 다음에 친 글자가 한 칸 밀려 적힌다. */
            if NSMaxRange(cut) < ns.length,
               ns.substring(with: NSRange(location: NSMaxRange(cut), length: 1)) == " " {
                cut.length += 1
            }
            /* **치던 `@…` 조각도 함께 걷는다** — 안 걷으면 `@김`이 덩그러니
               남아 그대로 보내진다. **겹치면 한 번만 자른다**(같은 자리를
               두 번 자르면 범위가 글 밖으로 나가 그 자리에서 죽는다). */
            var cuts = [cut]
            let typed = mentionRange ?? NSRange(location: 0, length: 0)
            if typed.length > 0, NSIntersectionRange(typed, cut).length == 0 { cuts.append(typed) }
            var out = ns as String
            for c in cuts.sorted(by: { $0.location > $1.location }) {
                out = (out as NSString).replacingCharacters(in: c, with: "")
            }
            composer.text = out
            let back = typed.length > 0 && cut.location < typed.location ? cut.length : 0
            composer.caret = typed.length > 0 ? typed.location - back : cut.location
        } else if let r = mentionRange {
            let replacement = "@\(name) "
            composer.text = (composer.text as NSString).replacingCharacters(in: r, with: replacement)
            composer.caret = r.location + (replacement as NSString).length
        }
        composer.textView.becomeFirstResponder()
        mentionRange = NSRange(location: composer.caret, length: 0)
        mentions.show(mentionItems(""), picked: mentioned())
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
        let menu = UIAlertController(title: "사진·동영상 첨부", message: nil, preferredStyle: .actionSheet)
        menu.addAction(UIAlertAction(title: "사진 보관함", style: .default) { [weak self] _ in self?.pickPhoto() })
        if UIImagePickerController.isSourceTypeAvailable(.camera) {
            menu.addAction(UIAlertAction(title: "사진 찍기", style: .default) { [weak self] _ in
                guard let self = self else { return }
                let camera = UIImagePickerController(); camera.sourceType = .camera; camera.delegate = self
                /* 카메라에서 **동영상 칸으로도 넘길 수 있게** 둘 다 받는다. */
                camera.mediaTypes = ["public.image", "public.movie"]
                camera.videoQuality = .typeHigh
                self.present(camera, animated: true)
            })
        }
        menu.addAction(UIAlertAction(title: "취소", style: .cancel)); presentMenu(menu)
    }
    /// **사진과 동영상을 함께, 여러 개 고른다**(사용자 요청 — `여러개를
    /// 선택해서 올릴수있도록해줘`). 한 번에 `PICK_MAX`개까지이고, 고른
    /// 것은 **한 개씩 차례로** 올라간다(`pickQueue`).
    private static let pickMax = 10
    private func pickPhoto() {
        var config = PHPickerConfiguration()
        config.filter = .any(of: [.images, .videos])
        config.selectionLimit = Self.pickMax
        /* 고른 차례대로 올린다 — 사진첩이 늘어놓는 차례가 아니라
           **사람이 누른 차례**여야 보낸 것이 생각한 순서로 선다. */
        config.selection = .ordered
        /* **줄이지 말고 원본 파일을 달라**는 뜻이다(사용자 요청) — 이게
           없으면 아이폰이 제 나름대로 변환해 준다. */
        config.preferredAssetRepresentationMode = .current
        let picker = PHPickerViewController(configuration: config); picker.delegate = self; present(picker, animated: true)
    }
    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard !results.isEmpty else { return }
        picked = nil; sticker = nil; retryRow = nil
        pickQueue = results.map { $0.itemProvider }
        pickTotal = pickQueue.count
        pickDone = 0
        nextPick()
    }

    /**
     * 줄 선 것 가운데 **하나를 읽어 온다.** 다 읽으면 `took()`이
     * `sendMedia`로 넘기고, 그 올리기가 끝나면 여기가 다시 불린다.
     *
     * **비었으면 `불러오는 중` 줄만 걷고 끝낸다** — 실패로 물려 둔
     * `picked`가 있으면 그것이 그대로 입력칸 위에 남는다.
     */
    private func nextPick() {
        guard !pickQueue.isEmpty else {
            pickTotal = 0; pickDone = 0
            if loadingWhat != nil { loadingWhat = nil; updateContext() }
            return
        }
        let item = pickQueue.removeFirst()
        pickDone += 1
        /* 동영상이 먼저다 — 움짤(`.mov`)은 그림으로도 읽혀서, 사진부터
           물어보면 첫 장면만 올라간다. */
        let movie = item.hasItemConformingToTypeIdentifier("public.movie")
        /* **고른 그 자리에서 먼저 알린다**(사용자 제보 — `확인을 누르면
           아무반응이없다가 갑자기 나타나서`). 사진첩에서 꺼내 오는 데
           동영상은 몇십 MB라 몇 초가 걸리는데, 그동안 화면이 조용하면
           안 눌린 줄 알고 다시 고르러 간다. `took()`이 이 값을 내린다. */
        loadingWhat = movie ? "동영상" : "사진"
        updateContext()
        if movie {
            _ = item.loadFileRepresentation(forTypeIdentifier: "public.movie") { [weak self] url, _ in
                /* **이 자리를 벗어나면 그 파일은 사라진다** — 여기서 읽어
                   담는다(`PickedMedia.video`). */
                let media = url.flatMap { PickedMedia.video($0) }
                DispatchQueue.main.async { self?.took(media, what: "동영상") }
            }
            return
        }
        _ = item.loadFileRepresentation(forTypeIdentifier: "public.image") { [weak self] url, _ in
            let media = url.flatMap { u -> PickedMedia? in
                guard let data = try? Data(contentsOf: u) else { return nil }
                return PickedMedia.photo(data, ext: u.pathExtension)
            }
            DispatchQueue.main.async { self?.took(media, what: "사진") }
        }
    }
    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        picker.dismiss(animated: true)
        if let movie = info[.mediaURL] as? URL {
            /* **여기서도 먼저 알리고 뒤에서 읽는다**(위 `didFinishPicking`과
               같은 자리다). 찍은 동영상을 메인 갈래에서 통째로 읽으면 그동안
               화면이 아예 안 움직인다. */
            loadingWhat = "동영상"; picked = nil; sticker = nil; retryRow = nil; updateContext()
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                let media = PickedMedia.video(movie)
                DispatchQueue.main.async { self?.took(media, what: "동영상") }
            }
            return
        }
        took((info[.originalImage] as? UIImage).flatMap { PickedMedia.jpeg($0) }, what: "사진")
    }

    /// 고른 것을 입력칸 위에 물린다. **너무 크면 여기서 잡는다** — 올리다
    /// 막히면 사람 말이 아닌 오류가 뜨고 그때는 이미 몇십 초를 기다린 뒤다.
    private func took(_ media: PickedMedia?, what: String) {
        /* **먼저 `불러오는 중`을 내린다** — 실패로 돌아서는 갈래에도
           걸려 있어야 그 줄이 화면에 남지 않는다. */
        let was = loadingWhat != nil
        loadingWhat = nil
        /* **한 개가 잘못돼도 나머지는 올린다** — 열 장 가운데 하나가
           50MB를 넘었다고 나머지 아홉을 버릴 이유가 없다. 알리고 다음
           것으로 넘어간다. */
        guard let media = media else {
            if was { updateContext() }
            notice("\(what)을 불러오지 못했습니다.")
            nextPick(); return
        }
        guard media.data.count <= PickedMedia.limit else {
            if was { updateContext() }
            notice("\(what)이 너무 큽니다(\(media.data.count / 1024 / 1024)MB).\n50MB까지 올릴 수 있습니다.")
            nextPick(); return
        }
        /* **고른 그 자리에서 올린다**(사용자 요청 — 카톡처럼). 입력칸 위에
           물려 두지 않고 대화방에 먼저 그린다 — `sendMedia`를 볼 것.
           **다 올라가야 다음 것을 읽어 온다**(`then`) — 손에 들고 있는
           파일을 늘 하나로 두려는 것이다. */
        picked = nil; sticker = nil; retryRow = nil; updateContext()
        sendMedia(media) { [weak self] in self?.nextPick() }
    }
    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { picker.dismiss(animated: true) }

    /// 입력칸 위의 `사진 불러오는 중…` 한 줄. **여러 개를 골랐으면 몇
    /// 번째인지 함께 적는다** — 다섯 장을 골랐는데 말풍선이 하나만 뜨면
    /// 나머지가 안 간 줄 알고 다시 고르러 간다.
    private func loadingLabel() -> String {
        let what = loadingWhat ?? "파일"
        guard pickTotal > 1 else { return "\(what) 불러오는 중…" }
        return "\(what) 불러오는 중… (\(pickDone)/\(pickTotal))"
    }

    private func updateContext() {
        context.arrangedSubviews.forEach { $0.removeFromSuperview() }
        if let quote = quoted {
            reply.show(who: personName(quote.user), text: String(quote.preview.prefix(80)))
        } else {
            reply.isHidden = true
        }
        /* **이모티콘은 이 줄이 아니라 대화 위 카드(`peek`)가 보여 준다.**
           여기 남는 것은 사진·동영상을 불러오거나 다시 보내려고 물려 둔 것뿐이다. */
        if let s = sticker { peek.show(s) } else { peek.hide() }
        if picked != nil || loadingWhat != nil {
            let row = UIStackView(); row.alignment = .center; row.distribution = .fill; row.spacing = 8
            /* 그림 칸은 **상자 안에** 둔다 — 아직 읽어 오는 중이면 그 위에
               도는 표시가 겹쳐 앉는다(`UIImageView`는 손짓도 겹판도
               기본으로 안 받는다).
               **올리는 동안의 고리와 `0.24 / 4.15MB`는 여기 없다** —
               그건 이제 대화방의 그 말풍선 위에 있다(`sendMedia`). */
            let box = UIView()
            box.widthAnchor.constraint(equalToConstant: 76).isActive = true
            box.heightAnchor.constraint(equalToConstant: 76).isActive = true
            let image = UIImageView(); image.contentMode = .scaleAspectFit; image.image = picked?.preview
            image.translatesAutoresizingMaskIntoConstraints = false
            box.addSubview(image)
            NSLayoutConstraint.activate([
                image.leadingAnchor.constraint(equalTo: box.leadingAnchor),
                image.trailingAnchor.constraint(equalTo: box.trailingAnchor),
                image.topAnchor.constraint(equalTo: box.topAnchor),
                image.bottomAnchor.constraint(equalTo: box.bottomAnchor),
            ])
            let label = UILabel(); label.font = .systemFont(ofSize: 14)
            label.textColor = ChatSkin().on
            label.text = picked?.label ?? loadingLabel()
            row.addArrangedSubview(box); row.addArrangedSubview(label)

            if loadingWhat != nil {
                /* 아직 읽어 오는 중이라 보여 줄 그림이 없다 — 도는 것만
                   둔다. 이 자리가 비어 있으면 그것대로 고장으로 보인다. */
                let spin = UIActivityIndicatorView(style: .medium)
                spin.color = ChatSkin().on
                spin.translatesAutoresizingMaskIntoConstraints = false
                spin.startAnimating(); box.addSubview(spin)
                NSLayoutConstraint.activate([
                    spin.centerXAnchor.constraint(equalTo: box.centerXAnchor),
                    spin.centerYAnchor.constraint(equalTo: box.centerYAnchor),
                ])
            }
            let remove = button("xmark", "첨부 취소", "native-attachment-cancel") { [weak self] in
                self?.sticker = nil; self?.picked = nil; self?.retryRow = nil
                self?.loadingWhat = nil
                /* **줄 서 있던 나머지도 함께 그만둔다** — 여기서 `✕`는
                   `이번에 고른 것을 안 보낸다`는 뜻이다. */
                self?.pickQueue.removeAll(); self?.pickTotal = 0; self?.pickDone = 0
                self?.updateContext()
            }
            /* 이 줄 뒤는 대화 바탕색(보라)이라 `.label`(먹색)로 두면
               안 보인다 — `context.backgroundColor`와 한 쌍이다. */
            remove.tintColor = ChatSkin().on
            row.addArrangedSubview(remove)
            context.addArrangedSubview(row)
        }
        context.isHidden = context.arrangedSubviews.isEmpty
        composer.forceSend = sticker != nil || picked != nil
        tray.mark(sticker?["id"] as? String ?? "")
    }
    /// 글칸에 초점이 가면 서랍을 닫는다 — 키보드와 자리를 맞바꾸는 그 규칙이다.
    func composerFocus(_ on: Bool) { if on { setTray(false) } }
    func composerResized(_ height: Double, y: Double, fr: Bool, kb: Bool) {}
    func composerKeyboard(on: Bool, dur: Double, at: Double, chatH: Double, pad: Double, s: Double, slide: Bool) {
        guard visible, !navigating, view.window != nil,
              navigationController?.transitionCoordinator == nil else { return }
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
     *
     * **키보드는 안 건드린다.** 여기서 함께 밀려던 길은 막다른 길이었고
     * (`BackDrag.begin`의 `키보드는 건드리지 않는다` 꼭지) 그 일은 이제
     * **왼쪽 가장자리 끌기**가 맡는다 — 거기서는 iOS가 키보드를 화면과
     * 한 몸으로 옮겨 준다.
     */
    func chatListBackBegan() -> Bool {
        guard service.config.back, !navigating, !entering,
              navigationController?.transitionCoordinator == nil,
              !backDrag.live, hold.isHidden, drawer.isHidden,
              gallery.isHidden, profile.isHidden,
              /* 화면 틀에 얹은 판에서는 웹뷰가 화면에 없다 — 그때 뒤에서
                 1/4만큼 따라 나오는 것은 플러그인이 깔아 둔 그림이다. */
              let web = backdrop ?? view.superview else { return false }
        guard backDrag.begin(root: view, web: web, cover: [view]) else { return false }
        event?("back", ["phase": "start"])
        return true
    }

    func chatListBackMoved(dx: CGFloat) { backDrag.move(dx: dx) }

    func chatListBackEnded(dx: CGFloat, vx: CGFloat, cancelled: Bool) {
        let go = !cancelled && backDrag.wants(dx: dx, vx: vx)
        backDrag.finish(go: go) { [weak self] in
            guard let self = self else { return }
            if go {
                // The close lifecycle removes this snapshot after navigation.
                self.goBack(drag: true)
            } else {
                // Restore now, while the returned snapshot still covers the view.
                // A delayed cleanup could otherwise erase the NEXT swipe.
                self.backDrag.end()
                self.event?("back", ["phase": "cancel"])
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
        /* 올리는 중인 그림 가운데의 `✕` — 그만두면 그 줄이 통째로 걷힌다. */
        case "cancel": cancelUpload(id)
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
    /// **동영상이면 재생기를 띄운다**(`AVPlayerViewController` — 아이폰이
    /// 늘 쓰는 그 화면이라 손에 익은 대로 움직인다).
    private func showPhoto(_ url: String) {
        view.endEditing(true)
        guard ChatMedia.isVideo(url), let u = URL(string: url) else {
            present(NativeChatPhoto(url), animated: true); return
        }
        let player = AVPlayer(url: u)
        let screen = AVPlayerViewController()
        screen.player = player
        screen.modalPresentationStyle = .fullScreen
        present(screen, animated: true) { player.play() }
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
     * 서랍의 `더보기` — **사진만 격자로 모아 본다**(`ChatGallery`).
     *
     * 서랍의 가로 줄은 마지막 서른 장뿐이라 그보다 앞엣것을 되짚을 길이
     * 없었다. 여기서는 **끝에 닿을 때마다** 한 묶음씩 더 받아 온다.
     */
    private static let galleryPage = 60
    private func showGallery() {
        view.bringSubviewToFront(gallery)
        gallery.show()
        if galleryRows.isEmpty { loadGallery(reset: true) }
    }

    /**
     * 한 묶음을 받아 온다. **거르는 잣대는 서랍(`loadShots`)과 같아야
     * 한다** — 한쪽만 고치면 줄에는 있는데 격자에는 없는 사진이 생긴다.
     *
     * **이어 받는 자리는 마지막 줄의 시각·id다**(`older()`와 같은 셈).
     * **오류는 그냥 삼킨다** — 못 받으면 그만큼 안 그릴 뿐이다.
     */
    private func loadGallery(reset: Bool) {
        if galleryBusy { return }
        if reset { galleryRows = []; galleryMore = true }
        guard galleryMore else { return }
        galleryBusy = true
        let last = galleryRows.last
        Task { [weak self] in
            guard let self = self else { return }
            defer { self.galleryBusy = false }
            var filters: [(String, String)] = [
                ("image_url", "not.is.null"), ("image_url", "not.ilike.sticker:%"), ("hidden_at", "is.null"),
            ]
            if let last = last {
                filters.append(("or", "(created_at.lt.\(last.at),and(created_at.eq.\(last.at),id.lt.\(last.id)))"))
            }
            let rows = (try? await self.service.messages(
                self.room, filters: filters, limit: Self.galleryPage)) ?? []
            self.galleryMore = rows.count == Self.galleryPage
            self.galleryRows += rows.compactMap { m in
                m.image.map { (id: m.id, url: $0, at: m.at) }
            }
            self.gallery.setPhotos(self.galleryRows.map { (id: $0.id, url: $0.url) },
                                   more: self.galleryMore)
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
    /* ── 검색(🔍) ─────────────────────────────────────────
     *
     * **카톡과 같은 짜임이다**(사용자 요청 — `검색 눌렀을때 카톡처럼
     * 나오게해줘` · 사진을 받아 맞췄다):
     *
     * ```
     * [🔍 대화내용 검색            ]  취소   ← 머리말이 통째로 바뀐다
     *   … 대화가 그대로 보인다 …
     * [        3 / 12        (^) (⌄) ]      ← 입력칸 자리에 서는 바
     * ```
     *
     * **화면을 덮는 목록창으로 되돌리지 말 것.** 예전에는 찾은 것을
     * 목록으로 내놓고 눌러야 그 자리로 갔는데, 그러면 앞뒤 대화를 못 보고
     * 되짚을 때마다 목록을 다시 열어야 했다. 지금은 **찾자마자 가장 최근
     * 것으로 옮겨 놓고** 바의 `^`(더 지난 것) · `⌄`(더 최근 것)로 오간다.
     *
     * 나가는 길은 `취소` 하나다(카톡과 같다) — `←`는 그동안 안 보인다.
     */
    private func showSearch() { setSearch(true) }

    private func buildSearch() {
        searchBox.backgroundColor = UIColor(white: 0, alpha: 0.06)
        searchBox.layer.cornerRadius = 18
        searchBox.layer.cornerCurve = .continuous
        searchBox.isHidden = true
        /* 칸이 남는 자리를 다 먹고 `취소`만 제 너비를 지킨다(카톡과 같다). */
        searchBox.setContentHuggingPriority(.defaultLow, for: .horizontal)
        searchBox.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        /* **돋보기는 크기를 못박는다.** 안 박으면 글래스와 글칸이 둘 다
           `hugging 250`이라 **가로가 애매해져** 레이아웃 엔진이 아무 쪽이나
           늘리는데, 하필 그림칸이 늘어나면 `scaleToFill`이라 **돋보기가
           칸 폭만큼 쭉 늘어난 회색 덩어리**가 된다(사용자 제보 · 사진 —
           `검색 돋보기가 이상해`). 크기를 주고 비율을 지키게 하고
           **글칸보다 먼저 제 몫을 챙기게**(hugging·compression을 올린다)
           하면 셋이 다 막힌다. */
        let glass = UIImageView(image: UIImage(systemName: "magnifyingglass",
            withConfiguration: UIImage.SymbolConfiguration(pointSize: 15, weight: .regular)))
        glass.tintColor = .secondaryLabel
        glass.contentMode = .scaleAspectFit
        glass.setContentHuggingPriority(.required, for: .horizontal)
        glass.setContentCompressionResistancePriority(.required, for: .horizontal)
        searchField.font = .systemFont(ofSize: 16)
        searchField.returnKeyType = .search
        searchField.clearButtonMode = .whileEditing
        searchField.autocorrectionType = .no
        searchField.accessibilityIdentifier = "native-chat-search-field"
        /* **안내 글씨는 그냥 `placeholder`다** — 웹에서 한글 조합 중에
           번쩍이던 그 자리는 **웹 글칸(WebKit)의 일**이고, 여기는
           네이티브 칸(`UITextField`)이라 조합 중에도 값이 안 빈다. */
        searchField.placeholder = "대화내용 검색"
        searchField.addTarget(self, action: #selector(searchTyped), for: .editingChanged)
        for v in [glass, searchField] as [UIView] { v.translatesAutoresizingMaskIntoConstraints = false; searchBox.addSubview(v) }
        NSLayoutConstraint.activate([
            searchBox.heightAnchor.constraint(equalToConstant: 36),
            glass.leadingAnchor.constraint(equalTo: searchBox.leadingAnchor, constant: 10),
            glass.centerYAnchor.constraint(equalTo: searchBox.centerYAnchor),
            searchField.leadingAnchor.constraint(equalTo: glass.trailingAnchor, constant: 8),
            searchField.trailingAnchor.constraint(equalTo: searchBox.trailingAnchor, constant: -10),
            searchField.centerYAnchor.constraint(equalTo: searchBox.centerYAnchor),
        ])
        searchCancel.setTitle("취소", for: .normal)
        searchCancel.titleLabel?.font = .systemFont(ofSize: 16)
        searchCancel.tintColor = .label
        searchCancel.isHidden = true
        searchCancel.accessibilityIdentifier = "native-chat-search-cancel"
        searchCancel.setContentHuggingPriority(.required, for: .horizontal)
        searchCancel.addAction(UIAction { [weak self] _ in self?.setSearch(false) }, for: .touchUpInside)
    }

    /// 머리말과 입력칸 자리를 통째로 바꾼다. **한쪽만 바꾸지 말 것** —
    /// 검색 중에 글칸이 남아 있으면 무엇을 치는 자리인지 흐려진다.
    private func setSearch(_ on: Bool) {
        guard searching != on else { return }
        searching = on
        for v in header.arrangedSubviews where v !== searchBox && v !== searchCancel { v.isHidden = on }
        searchBox.isHidden = !on; searchCancel.isHidden = !on
        composer.isHidden = on; findBar.isHidden = !on
        /* 나가면 파랗게 칠한 것도 함께 걷는다. */
        if !on { list.find = "" }
        if on {
            setTray(false)
            hits = []; hitAt = 0
            findBar.set(at: 0, of: 0, hint: "두 글자 이상")
            searchField.text = ""
            searchField.becomeFirstResponder()
        } else {
            searchTask?.cancel()
            hits = []
            view.endEditing(true)
        }
        list.apply(jump: !bottom || windowed)
    }

    @objc private func searchTyped() {
        searchTask?.cancel()
        let query = (searchField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        /* **친 글자는 곧바로 파랗게 칠한다**(사용자 요청) — 서버 답을
           기다리지 않는다. 이미 화면에 있는 줄에서 그 자리를 찾는 일이라
           다녀올 것이 없고, 치는 대로 따라 칠해져야 찾는 맛이 난다. */
        list.find = query
        guard query.count >= 2 else {
            hits = []; hitAt = 0; findBar.set(at: 0, of: 0, hint: "두 글자 이상"); return
        }
        searchTask = Task { [weak self] in
            guard let self = self else { return }
            do {
                /* 치는 동안 300ms 쉬면 그때 한 번 간다 — 글자마다 물어보지
                   않는다(웹의 검색과 같은 잣대다). */
                try await Task.sleep(nanoseconds: 300_000_000)
                let safe = query.replacingOccurrences(of: "\\", with: "\\\\")
                    .replacingOccurrences(of: "%", with: "\\%")
                    .replacingOccurrences(of: "_", with: "\\_")
                let found = try await self.service.messages(
                    self.room, filters: [("body", "ilike.%\(safe)%"), ("hidden_at", "is.null")], limit: 100)
                try Task.checkCancellation()
                self.hits = found          // 최근 것이 앞이다(내림차순).
                self.hitAt = 0
                if found.isEmpty { self.findBar.set(at: 0, of: 0, hint: "찾은 글 없음"); return }
                self.findBar.set(at: 1, of: found.count, hint: "")
                self.jump(found[0])
            } catch {
                if !Task.isCancelled { self.findBar.set(at: 0, of: 0, hint: "찾지 못했습니다") }
            }
        }
    }

    /// `+1`이면 더 지난 글, `-1`이면 더 최근 글이다(목록이 내림차순이라
    /// 번호가 클수록 옛날이다).
    private func step(_ d: Int) {
        guard !hits.isEmpty else { return }
        let next = hitAt + d
        guard next >= 0, next < hits.count else { return }
        hitAt = next
        findBar.set(at: next + 1, of: hits.count, hint: "")
        jump(hits[next])
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

/**
 * 골라 둔 사진·동영상 한 개.
 *
 * **사진은 원본 그대로 올린다**(사용자 요청 — `사진과 동영상을 원본으로
 * 올릴수있게해주고`). 예전에는 긴 변 2560px·JPEG 82%로 줄여 올렸는데,
 * 이제 **줄이지 않는다.**
 *
 * - **JPEG·PNG는 파일 바이트를 그대로 올린다** — 다시 굽지 않으므로
 *   화질이 한 번도 안 깎인다.
 * - **HEIC만 JPEG으로 바꾼다**(해상도는 원본 그대로 · 화질 95%).
 *   아이폰 기본 형식이 HEIC인데 **안드로이드와 PC 브라우저는 그걸 못
 *   연다** — 그대로 올리면 우리 대화방 절반이 빈 네모를 보게 된다.
 *   `웹에서 되니까 괜찮다`의 정반대 자리라 여기서 막는다.
 * - **동영상은 손대지 않는다** — 다시 굽는 순간 원본이 아니다.
 *
 * **그 대가는 저장 공간이다.** 무료 통이 1GB인데 원본 사진이 한 장
 * 3~5MB, 동영상은 한 개에 수십 MB다 — 그래서 **저장 기간을 90일 → 2주 →
 * 일주일로 줄여 왔다**(사용자가 정했다. `lib/photos.ts`의 `PHOTO_DAYS`).
 */
struct PickedMedia {
    let data: Data
    let ext: String
    let type: String
    /// 입력칸 위 미리보기(동영상은 첫 장면).
    let preview: UIImage?
    var isVideo: Bool { ChatMedia.videoExts.contains(ext) }
    var label: String { isVideo ? "보낼 동영상" : "보낼 사진" }

    /// **무료 통의 한 건 한도가 50MB다**(Supabase 무료 판). 넘으면 올리다
    /// 막히는데 그 오류는 사람 말이 아니라, 고르는 자리에서 미리 잡는다.
    static let limit = 50 * 1024 * 1024

    /// 사진 파일 하나를 원본대로 담는다. HEIC만 JPEG으로 바꾼다(위 참고).
    static func photo(_ data: Data, ext raw: String) -> PickedMedia? {
        let ext = raw.lowercased()
        if ext == "jpg" || ext == "jpeg" {
            return PickedMedia(data: data, ext: "jpg", type: "image/jpeg",
                               preview: UIImage(data: data))
        }
        if ext == "png" {
            return PickedMedia(data: data, ext: "png", type: "image/png",
                               preview: UIImage(data: data))
        }
        guard let image = UIImage(data: data) else { return nil }
        return jpeg(image)
    }

    /// 카메라로 찍은 것과 HEIC — **크기는 그대로 두고** 화질만 95%로 굽는다.
    static func jpeg(_ image: UIImage) -> PickedMedia? {
        guard let data = image.jpegData(compressionQuality: 0.95) else { return nil }
        return PickedMedia(data: data, ext: "jpg", type: "image/jpeg", preview: image)
    }

    /// 동영상 파일 하나 — **바이트를 그대로 싣는다.**
    static func video(_ url: URL) -> PickedMedia? {
        guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { return nil }
        let ext = url.pathExtension.lowercased()
        let use = ChatMedia.videoExts.contains(ext) ? ext : "mp4"
        let type = use == "mov" ? "video/quicktime" : "video/mp4"
        return PickedMedia(data: Data(data), ext: use, type: type, preview: firstFrame(url))
    }

    /// 미리보기로 쓸 첫 장면. 못 떠 와도 그만이다(칸이 비어 보일 뿐이다).
    private static func firstFrame(_ url: URL) -> UIImage? {
        let gen = AVAssetImageGenerator(asset: AVURLAsset(url: url))
        gen.appliesPreferredTrackTransform = true
        gen.maximumSize = CGSize(width: 240, height: 240)
        let at = CMTime(seconds: 0.1, preferredTimescale: 600)
        return (try? gen.copyCGImage(at: at, actualTime: nil)).map { UIImage(cgImage: $0) }
    }
}

/**
 * 올리는 동안 그림 위에 얹히는 **어두운 막과 진행률 고리.**
 *
 * 카톡이 동영상을 올릴 때 그리는 그 자리다(사용자 요청 — `동영상
 * 업로드할때 카톡처럼 저렇게 용량나오고 업로드되는 화면이 있었으면좋겠어`).
 * 가운데의 `✕`(그만두기)는 **이 뷰가 아니라 형제로** 얹는다 — 여기에
 * 넣으면 손짓을 받아야 해서 막과 고리가 눌림을 가로챈다.
 *
 * **`transform`·`strokeEnd`만 움직인다** — 그림자도 `filter`도 안 쓴다.
 */
final class MediaRing: UIView {
    private let track = CAShapeLayer()
    private let bar = CAShapeLayer()
    /// 고리를 바깥에서 얼마나 안으로 들일지. 말풍선 위의 작은 동그라미
    /// (`BubbleCell`)는 테두리를 거의 다 쓰므로 3, 입력칸 위 미리보기는 9다.
    var inset: CGFloat = 9 { didSet { setNeedsLayout() } }
    /// 0~1. 값이 들어오면 그 자리에서 고리가 찬다.
    var value: CGFloat = 0 {
        didSet {
            /* 암시 애니메이션을 끈다 — 초에 수십 번 오는 값이라 그때마다
               0.25초짜리가 겹치면 고리가 뒤처져 보인다. */
            CATransaction.begin(); CATransaction.setDisableActions(true)
            bar.strokeEnd = max(0, min(1, value))
            CATransaction.commit()
        }
    }
    override init(frame: CGRect) { super.init(frame: frame); build() }
    required init?(coder: NSCoder) { super.init(coder: coder); build() }
    private func build() {
        backgroundColor = UIColor(white: 0, alpha: 0.45)
        isUserInteractionEnabled = false
        layer.cornerRadius = 8; layer.masksToBounds = true
        for shape in [track, bar] {
            shape.fillColor = nil
            shape.lineWidth = 2.5
            shape.lineCap = .round
            layer.addSublayer(shape)
        }
        track.strokeColor = UIColor(white: 1, alpha: 0.3).cgColor
        bar.strokeColor = UIColor.white.cgColor
        bar.strokeEnd = 0
    }
    override func layoutSubviews() {
        super.layoutSubviews()
        let radius = max(min(bounds.width, bounds.height) / 2 - inset, 1)
        let center = CGPoint(x: bounds.midX, y: bounds.midY)
        /* 12시에서 시작해 시계 방향으로 찬다(카톡과 같다). */
        let path = UIBezierPath(arcCenter: center, radius: radius, startAngle: -.pi / 2,
                                endAngle: .pi * 1.5, clockwise: true).cgPath
        for shape in [track, bar] { shape.frame = bounds; shape.path = path }
    }
}
