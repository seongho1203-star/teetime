import UIKit

/*
 * **앱 껍데기 — 홈·탭바**(사용자 요청 — `그냥 지금 바로 홈·탭바까지 앱으로
 * 만들어줘`). 웹과 앱 화면이 맞닿는 자리마다 자국이 나서(앱 알림함 → 웹
 * 라운드 → 다시 앱 알림함) **경계 자체를 없애는 쪽**으로 갔다.
 *
 * 로그인이 끝나면 웹이 `NativeApp.shell()`을 불러 이 화면을 화면 틀에
 * 세운다(`[뿌리(웹뷰), 껍데기]`). 그 뒤로 사람이 보는 것은 전부 앱 화면이다:
 *   - 탭 넷은 앱이 그린다(홈 · 공지 · 라운드 · 투표). **차례는 사용자가 정한
 *     것이다**(`TabBar.tsx`와 같다).
 *   - `대화` 탭은 화면을 바꾸지 않고 **웹에 `/chat`을 열라고 한다** — 대화
 *     플러그인이 대화 화면을 이 위에 밀어 올린다(지금까지의 길 그대로).
 *   - 앱이 그리는 상세(공지 · 알림함 · 회원 명단)는 **웹을 거치지 않고** 이
 *     틀에 바로 밀어 올린다(`push`).
 *   - 아직 웹인 화면(라운드·투표 상세 · 쓰는 화면 · 내 정보)은 웹에 그 주소를
 *     열라고 한다 → 웹의 `pushState` → `NativeNav.push` → 웹뷰를 든 page가
 *     이 위에 선다(iOS 26 시스템 웹 전환). 돌아오면 `NavLayer`가 웹뷰를
 *     뿌리로 되돌린다.
 *
 * **웹 화면이 뒤에 살아 있어야 한다** — 로그인·알림·`까꿍` 소리·아직 안 옮긴
 * 화면이 거기 있다. 뿌리(웹뷰)는 늘 틀의 맨 아래에 있고 안 보일 뿐이다.
 *
 * 규칙은 웹 화면(`Home.tsx`·`Rounds.tsx`·`Polls.tsx`·`Board.tsx`)과 같아야
 * 한다 — 지난 것은 열 개만 · 진행중은 전부 · 대기 번호는 대기 줄에서의 차례 ·
 * 동점이면 다 적기 · 자리가 다 차면 `모집 마감`.
 */
final class ShellController: UITabBarController, UITabBarControllerDelegate {
    static weak var current: ShellController?
    let service: NativeChatService
    /// 웹에 주소를 열라고 — 대화방과 아직 웹인 화면이 이 길로 간다.
    var onWeb: ((String) -> Void)?
    private(set) var me: AppProfile?
    private(set) var people: [String: AppProfile] = [:]
    var isAdmin: Bool { AppRole.isAdmin(me?.role ?? "member") }

    let homeTab: HomeTabController
    let boardTab: BoardTabController
    let roundsTab: RoundsTabController
    let pollsTab: PollsTabController
    private let chatTab = UIViewController()

    init(service: NativeChatService) {
        self.service = service
        homeTab = HomeTabController(service: service)
        boardTab = BoardTabController(service: service)
        roundsTab = RoundsTabController(service: service)
        pollsTab = PollsTabController(service: service)
        super.init(nibName: nil, bundle: nil)
        for t in [homeTab, boardTab, roundsTab, pollsTab] { t.shell = self }
        homeTab.tabBarItem = UITabBarItem(title: "홈", image: UIImage(systemName: "house"), tag: 0)
        boardTab.tabBarItem = UITabBarItem(title: "공지", image: UIImage(systemName: "megaphone"), tag: 1)
        roundsTab.tabBarItem = UITabBarItem(title: "라운드", image: UIImage(systemName: "flag"), tag: 2)
        pollsTab.tabBarItem = UITabBarItem(title: "투표", image: UIImage(systemName: "chart.bar"), tag: 3)
        chatTab.tabBarItem = UITabBarItem(title: "대화", image: UIImage(systemName: "bubble.left"), tag: 4)
        viewControllers = [homeTab, boardTab, roundsTab, pollsTab, chatTab]
        delegate = self
        Self.current = self
    }
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = AppSkin.bg
        /* 탭바 — 웹 `.tabbar`와 같은 칠: 흰 바탕 · 켜진 탭은 분홍 · 나머지는 흐린 글자. */
        let ap = UITabBarAppearance()
        ap.configureWithOpaqueBackground()
        ap.backgroundColor = AppSkin.surface
        ap.shadowColor = AppSkin.line
        let item = ap.stackedLayoutAppearance
        item.selected.iconColor = AppSkin.brand
        item.selected.titleTextAttributes = [.foregroundColor: AppSkin.brand, .font: UIFont.systemFont(ofSize: 10.5, weight: .bold)]
        item.normal.iconColor = AppSkin.faint
        item.normal.titleTextAttributes = [.foregroundColor: AppSkin.faint, .font: UIFont.systemFont(ofSize: 10.5, weight: .semibold)]
        tabBar.standardAppearance = ap
        tabBar.scrollEdgeAppearance = ap
        tabBar.tintColor = AppSkin.brand
        Task { @MainActor [weak self] in await self?.refreshPeople() }
    }

    // ── 사람들 ───────────────────────────────────────────────────

    /// 명단(이름표·얼굴·내 직책) — 탭들이 같이 쓴다. 들어올 때와 당겨서 새로고침할 때 받는다.
    func refreshPeople() async {
        if let list = try? await service.peopleById() {
            people = list
            me = list[service.config.user]
        }
    }

    // ── 길 ───────────────────────────────────────────────────────

    static let tabPaths = ["/", "/board", "/rounds", "/polls"]

    /// 탭 주소면 그 탭을 켠다(다른 주소는 그대로 둔다).
    func select(_ path: String) {
        guard let i = Self.tabPaths.firstIndex(of: path) else { return }
        if let nav = navigationController, nav.topViewController !== self {
            nav.popToViewController(self, animated: false)
        }
        selectedIndex = i
    }

    /**
     * 어디로든 — **앱이 그리는 곳은 앱이, 아직 웹인 곳은 웹이.**
     * `replace`면 지금 맨 위 화면을 내리고 간다(지운 글에서 목록으로).
     */
    func go(_ path: String, replace: Bool = false) {
        AppLog.add("shell.go \(path)")
        if replace, let nav = navigationController, nav.topViewController !== self {
            nav.popViewController(animated: false)
        }
        if Self.tabPaths.contains(path) { select(path); return }
        if path == "/chat" { onWeb?(path); return }
        if let vc = NativeAppPlugin.make(path, service: service) {
            vc.path = path
            push(vc)
            return
        }
        onWeb?(path)
    }

    /// 앱 화면을 이 틀에 밀어 올린다 — 웹은 모른다. 그 화면의 `navigate`는 다시 `go`로 온다.
    func push(_ vc: NativeScreenController) {
        vc.shellOwned = true
        vc.event = { [weak self, weak vc] type, data in
            guard let self = self else { return }
            if type == "navigate", let path = data["path"] as? String {
                let replace = data["replace"] as? Bool ?? false
                if replace, let vc = vc, let nav = self.navigationController, nav.topViewController === vc {
                    nav.popViewController(animated: false)
                }
                self.go(path)
            }
            /* `back`은 그 화면이 이미 스스로 내렸다 — 웹에 알릴 것이 없다. */
        }
        navigationController?.pushViewController(vc, animated: true)
    }

    func tabBarController(_ tabBarController: UITabBarController, shouldSelect viewController: UIViewController) -> Bool {
        AppLog.add("탭 누름 \(viewController.tabBarItem.title ?? "")")
        if viewController === chatTab { onWeb?("/chat"); return false }
        return true
    }

    // ── 탭의 숫자 ────────────────────────────────────────────────

    /// 탭 위의 숫자 — 웹 `useLiveCounts`와 같은 뜻. 빨강은 **내가 안 본 것**(공지·대화·승인),
    /// 잔디는 **열려 있는 개수**(라운드·투표).
    func refreshBadges(rounds: Int? = nil, polls: Int? = nil) {
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            let chat = await self.service.unreadChatCount()
            let board = await self.service.newPostCount(since: self.boardSeen())
            let pending = self.isAdmin ? await self.service.pendingCount() : 0
            self.set(self.homeTab, pending, alert: true)
            self.set(self.boardTab, board, alert: true)
            self.set(self.chatTab, chat, alert: true)
            if let r = rounds { self.set(self.roundsTab, r, alert: false) }
            if let p = polls { self.set(self.pollsTab, p, alert: false) }
        }
    }
    private func set(_ vc: UIViewController, _ n: Int, alert: Bool) {
        vc.tabBarItem.badgeValue = n > 0 ? (n > 99 ? "99+" : String(n)) : nil
        vc.tabBarItem.badgeColor = alert ? AppSkin.danger : AppSkin.grass
    }
    /// 공지를 어디까지 봤나 — 이 기기에 남긴다(웹 `teetime:seen:board`와 같은 뜻, 값은 따로).
    private var boardSeenKey: String { "shell:seen:board:\(service.config.user)" }
    func boardSeen() -> String { UserDefaults.standard.string(forKey: boardSeenKey) ?? "1970-01-01T00:00:00Z" }
    func markBoardSeen() {
        UserDefaults.standard.set(NativeChatRows.now(), forKey: boardSeenKey)
        set(boardTab, 0, alert: true)
    }
}

// ── 탭 화면의 뼈대 ─────────────────────────────────────────────

/**
 * 탭 하나의 뼈대 — 머리말(제목 + 오른쪽 단추)과 표. 화면이 보일 때마다
 * 다시 받는다(1초 안에 두 번은 안 받는다). 당겨서도 새로고침된다.
 * 실시간은 5단계에서 붙인다.
 */
class ShellTabController: UIViewController, UITableViewDataSource, UITableViewDelegate {
    let service: NativeChatService
    weak var shell: ShellController?
    let header = UIView()
    let titleLabel = UILabel()
    let rightButton = UIButton(type: .system)
    let table = UITableView(frame: .zero, style: .plain)
    let refresh = UIRefreshControl()
    let spinner = UIActivityIndicatorView(style: .medium)
    let emptyLabel = UILabel()
    private var lastLoad = Date.distantPast
    private(set) var loadedOnce = false

    init(service: NativeChatService, title: String) {
        self.service = service
        super.init(nibName: nil, bundle: nil)
        titleLabel.text = title
        /* 오른쪽 단추는 화면이 켠다(`viewDidLoad`에서 끄면 화면이 켜 둔 것이 도로 꺼진다). */
        rightButton.isHidden = true
    }
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = AppSkin.bg
        header.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.font = .systemFont(ofSize: 22, weight: .bold)
        titleLabel.textColor = AppSkin.text
        rightButton.translatesAutoresizingMaskIntoConstraints = false
        rightButton.titleLabel?.font = .systemFont(ofSize: 14, weight: .bold)
        rightButton.setTitleColor(.white, for: .normal)
        rightButton.backgroundColor = AppSkin.brand
        rightButton.layer.cornerRadius = 17
        rightButton.contentEdgeInsets = UIEdgeInsets(top: 8, left: 14, bottom: 8, right: 14)
        rightButton.addTarget(self, action: #selector(rightTapped), for: .touchUpInside)
        table.translatesAutoresizingMaskIntoConstraints = false
        table.dataSource = self; table.delegate = self
        table.backgroundColor = AppSkin.bg
        table.separatorStyle = .none
        table.rowHeight = UITableView.automaticDimension
        table.estimatedRowHeight = 90
        table.contentInset = UIEdgeInsets(top: 0, left: 0, bottom: 24, right: 0)
        table.keyboardDismissMode = .onDrag
        refresh.addTarget(self, action: #selector(pulled), for: .valueChanged)
        table.refreshControl = refresh
        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.hidesWhenStopped = true
        emptyLabel.translatesAutoresizingMaskIntoConstraints = false
        emptyLabel.font = .systemFont(ofSize: 14)
        emptyLabel.textColor = AppSkin.dim
        emptyLabel.textAlignment = .center
        emptyLabel.numberOfLines = 0
        emptyLabel.isHidden = true
        view.addSubview(header); header.addSubview(titleLabel); header.addSubview(rightButton)
        view.addSubview(table); view.addSubview(emptyLabel); view.addSubview(spinner)
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            header.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            header.heightAnchor.constraint(equalToConstant: 52),
            titleLabel.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 16),
            titleLabel.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            rightButton.trailingAnchor.constraint(equalTo: header.trailingAnchor, constant: -16),
            rightButton.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            rightButton.heightAnchor.constraint(equalToConstant: 34),
            table.topAnchor.constraint(equalTo: header.bottomAnchor),
            table.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            table.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            table.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            emptyLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            emptyLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -40),
            emptyLabel.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, constant: -48),
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        if Date().timeIntervalSince(lastLoad) > 1 {
            if !loadedOnce { spinner.startAnimating() }
            load()
        }
    }

    /// 화면마다 받아 온다 — 끝나면 `finished()`를 부른다.
    func load() { finished() }
    func finished() {
        loadedOnce = true
        lastLoad = Date()
        spinner.stopAnimating()
        refresh.endRefreshing()
    }
    @objc private func pulled() {
        Task { @MainActor [weak self] in
            await self?.shell?.refreshPeople()
            self?.load()
        }
    }
    @objc func rightTapped() {}

    func go(_ path: String) { shell?.go(path) }

    /// 짧은 안내 — 화면 아래 알약(`NativeScreenController.flash`와 같은 모양).
    func flash(_ text: String, error: Bool = false) {
        ShellPill.show(in: view, text, error: error)
    }
    func confirm(title: String, detail: String, ok: String, danger: Bool, then: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: title, message: detail, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "취소", style: .cancel) { _ in then(false) })
        a.addAction(UIAlertAction(title: ok, style: danger ? .destructive : .default) { _ in then(true) })
        present(a, animated: true)
    }

    // 표 — 화면이 채운다.
    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { 0 }
    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell { UITableViewCell() }
}

/// 화면 아래 떴다 사라지는 알약 — 탭 화면과 앱 화면이 같이 쓴다.
enum ShellPill {
    static func show(in view: UIView, _ text: String, error: Bool) {
        let l = NativeScreenController.PillLabel()
        l.text = text
        l.font = .systemFont(ofSize: 14, weight: .semibold)
        l.textColor = .white
        l.textAlignment = .center
        l.numberOfLines = 2
        l.backgroundColor = error ? AppSkin.danger : UIColor(white: 0.12, alpha: 0.92)
        l.layer.cornerRadius = 14
        l.layer.masksToBounds = true
        l.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(l)
        NSLayoutConstraint.activate([
            l.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            l.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -72),
            l.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, constant: -32)
        ])
        l.alpha = 0
        UIView.animate(withDuration: 0.18) { l.alpha = 1 }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.2) { [weak l] in
            guard let l = l else { return }
            UIView.animate(withDuration: 0.25, animations: { l.alpha = 0 }) { _ in l.removeFromSuperview() }
        }
    }
}

// ── 카드·표 조각 ──────────────────────────────────────────────

/// 흰 카드(웹 `.card` — 흰 바탕 · 가는 테두리 · 모서리 18 · 안여백 11/14). 안에 세로 스택이 든다.
final class CardView: UIView {
    let content = UIStackView()
    init() {
        super.init(frame: .zero)
        backgroundColor = AppSkin.surface
        layer.cornerRadius = AppSkin.radius
        layer.cornerCurve = .continuous
        layer.borderWidth = 1
        layer.borderColor = AppSkin.line.cgColor
        content.axis = .vertical
        content.spacing = 8
        content.translatesAutoresizingMaskIntoConstraints = false
        content.isLayoutMarginsRelativeArrangement = true
        content.layoutMargins = UIEdgeInsets(top: 11, left: 14, bottom: 11, right: 14)
        addSubview(content)
        NSLayoutConstraint.activate([
            content.topAnchor.constraint(equalTo: topAnchor),
            content.bottomAnchor.constraint(equalTo: bottomAnchor),
            content.leadingAnchor.constraint(equalTo: leadingAnchor),
            content.trailingAnchor.constraint(equalTo: trailingAnchor)
        ])
    }
    required init?(coder: NSCoder) { fatalError() }
    func clear() { content.arrangedSubviews.forEach { $0.removeFromSuperview() } }
}

/// 표(`.badge`) — 색은 뜻으로 가른다(잔디=열림 · 회색=끝남 · 노랑=기다림 · 빨강=안 본 것 · 보라=대기).
final class BadgeLabel: NativeScreenController.PillLabel {
    enum Kind { case live, done, dim, warn, danger, wait, brand, field, screen }
    init(_ text: String, _ kind: Kind) {
        super.init(frame: .zero)
        self.text = text
        pad = UIEdgeInsets(top: 3, left: 8, bottom: 3, right: 8)
        font = .systemFont(ofSize: 11.5, weight: .heavy)
        layer.cornerRadius = 10
        layer.masksToBounds = true
        setContentHuggingPriority(.required, for: .horizontal)
        setContentCompressionResistancePriority(.required, for: .horizontal)
        switch kind {
        case .live: textColor = UIColor(hexString: "#5b8d18") ?? AppSkin.grass; backgroundColor = AppSkin.grass.withAlphaComponent(0.16)
        case .done: textColor = AppSkin.faint; backgroundColor = AppSkin.surface2
        case .dim: textColor = AppSkin.faint; backgroundColor = .clear; layer.borderWidth = 1; layer.borderColor = AppSkin.line.cgColor
        case .warn: textColor = AppSkin.warn; backgroundColor = AppSkin.warn.withAlphaComponent(0.14)
        case .danger: textColor = AppSkin.danger; backgroundColor = AppSkin.danger.withAlphaComponent(0.12)
        case .wait: textColor = UIColor(hexString: "#7a55d6") ?? AppSkin.info; backgroundColor = (UIColor(hexString: "#7a55d6") ?? AppSkin.info).withAlphaComponent(0.14)
        case .brand: textColor = AppSkin.brand; backgroundColor = AppSkin.brand.withAlphaComponent(0.12)
        case .field: textColor = .white; backgroundColor = AppSkin.grass
        case .screen: textColor = .white; backgroundColor = AppSkin.dim
        }
    }
    required init?(coder: NSCoder) { fatalError() }
}

/// 가로 한 줄 — 표들을 늘어놓을 때.
func hrow(_ views: [UIView], spacing: CGFloat = 6, fill: Bool = false) -> UIStackView {
    let s = UIStackView(arrangedSubviews: views)
    s.axis = .horizontal
    s.spacing = spacing
    s.alignment = .center
    if !fill { s.addArrangedSubview(UIView()) }
    return s
}

func mkLabel(_ text: String, size: CGFloat, weight: UIFont.Weight = .regular, color: UIColor = AppSkin.text, lines: Int = 1) -> UILabel {
    let l = UILabel()
    l.text = text
    l.font = .systemFont(ofSize: size, weight: weight)
    l.textColor = color
    l.numberOfLines = lines
    l.lineBreakMode = lines == 1 ? .byTruncatingTail : .byWordWrapping
    return l
}

/// 카드 한 장이 든 줄 — 좌우 16 · 위아래 5.
class CardCell: UITableViewCell {
    let card = CardView()
    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        backgroundColor = .clear
        contentView.backgroundColor = .clear
        selectionStyle = .none
        card.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(card)
        NSLayoutConstraint.activate([
            card.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 5),
            card.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -5),
            card.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            card.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16)
        ])
    }
    required init?(coder: NSCoder) { fatalError() }
}

/// 묶음 제목 줄(`.section-title`).
final class SectionCell: UITableViewCell {
    let l = UILabel()
    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        backgroundColor = .clear; contentView.backgroundColor = .clear; selectionStyle = .none
        l.font = .systemFont(ofSize: 13, weight: .bold)
        l.textColor = AppSkin.dim
        l.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(l)
        NSLayoutConstraint.activate([
            l.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            l.trailingAnchor.constraint(lessThanOrEqualTo: contentView.trailingAnchor, constant: -16),
            l.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 18),
            l.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -4)
        ])
    }
    required init?(coder: NSCoder) { fatalError() }
}

/// 한 줄짜리 단추(`.btn ghost block` — `지난 라운드 더 보기`).
final class ButtonCell: UITableViewCell {
    let button = UIButton(type: .system)
    var onTap: (() -> Void)?
    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        backgroundColor = .clear; contentView.backgroundColor = .clear; selectionStyle = .none
        button.translatesAutoresizingMaskIntoConstraints = false
        button.titleLabel?.font = .systemFont(ofSize: 14, weight: .semibold)
        button.setTitleColor(AppSkin.text, for: .normal)
        button.backgroundColor = AppSkin.surface
        button.layer.cornerRadius = 20
        button.layer.borderWidth = 1
        button.layer.borderColor = AppSkin.line.cgColor
        button.addTarget(self, action: #selector(tapped), for: .touchUpInside)
        contentView.addSubview(button)
        NSLayoutConstraint.activate([
            button.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            button.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
            button.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 8),
            button.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -8),
            button.heightAnchor.constraint(equalToConstant: 40)
        ])
    }
    required init?(coder: NSCoder) { fatalError() }
    @objc private func tapped() { onTap?() }
}
