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
    /// 탭 사이를 좌우로 밀어 옮기는 손짓(`TabSwipe`) — 대리자가 약하게 잡히므로 여기서 들고 있는다.
    private let swipe = TabSwipe()

    init(service: NativeChatService) {
        self.service = service
        homeTab = HomeTabController(service: service)
        boardTab = BoardTabController(service: service)
        roundsTab = RoundsTabController(service: service)
        pollsTab = PollsTabController(service: service)
        super.init(nibName: nil, bundle: nil)
        for t in [homeTab, boardTab, roundsTab, pollsTab] { t.shell = self }
        /* 탭 아이콘은 SF Symbol이 아니라 **우리가 넣은 선 그림**이다(사용자가 고른 것 —
           Lucide의 house·megaphone·flag·chart-column·message-circle, 선 1.75).
           원본 SVG는 `docs/탭-아이콘/`에 있고 `Assets.xcassets/tab-*`는 거기서 뽑은
           템플릿 PNG라 탭바 색(흐림·분홍)을 그대로 받는다. 못 찾으면 옛 SF Symbol로. */
        func icon(_ name: String, _ fallback: String) -> UIImage? {
            UIImage(named: "tab-\(name)")?.withRenderingMode(.alwaysTemplate) ?? UIImage(systemName: fallback)
        }
        homeTab.tabBarItem = UITabBarItem(title: "홈", image: icon("house", "house"), tag: 0)
        boardTab.tabBarItem = UITabBarItem(title: "공지", image: icon("megaphone", "megaphone"), tag: 1)
        roundsTab.tabBarItem = UITabBarItem(title: "라운드", image: icon("flag", "flag"), tag: 2)
        pollsTab.tabBarItem = UITabBarItem(title: "투표", image: icon("chart-column", "chart.bar"), tag: 3)
        chatTab.tabBarItem = UITabBarItem(title: "대화", image: icon("message-circle", "bubble.left"), tag: 4)
        viewControllers = [homeTab, boardTab, roundsTab, pollsTab, chatTab]
        delegate = self
        Self.current = self
        let c = NotificationCenter.default
        c.addObserver(self, selector: #selector(liveChanged(_:)), name: AppLive.changed, object: nil)
        c.addObserver(self, selector: #selector(cameBack), name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    /* **실시간(5단계)** — 탭의 숫자를 따라 맞춘다. 화면 자체는 저마다 다시 받는다. */
    @objc private func liveChanged(_ n: Notification) {
        guard let t = n.userInfo?["tables"] as? Set<String>,
              !t.isDisjoint(with: ["messages", "posts", "profiles"]) else { return }
        refreshBadges()
    }
    /// 접어 둔 앱으로 돌아왔다 — 끊겼던 동안의 것을 한 번에 다시 받는다.
    @objc private func cameBack() { AppLive.post(AppLive.all) }
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
        swipe.attach(to: self)
        putCover()
        Task { @MainActor [weak self] in await self?.refreshPeople() }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        if let c = cover { view.bringSubviewToFront(c) }
    }

    // ── 첫 화면 가리개 ───────────────────────────────────────────

    /*
     * **홈이 다 받아질 때까지 까꿍 첫 화면을 그대로 둔다**(사용자 요청 — `처음
     * 접속할때 까꿍로고가 전체화면으로 뜨는데 그때 백그라운드에서 미리 로딩하고
     * 띄우면 어떨까?`). 예전에는 껍데기가 서자마자 머리말만 있고 가운데에
     * 스피너가 도는 빈 홈이 보였다 — 그 사이를 첫 화면이 덮는다.
     *
     *   - **웹 `.boot`(index.html)와 같은 그림이다** — 흰 바탕 · 가운데 200pt
     *     (좁으면 화면 폭의 52%). 그래야 웹 첫 화면에서 이것으로 넘어갈 때
     *     아무것도 안 바뀐 것처럼 이어진다. 그림은 `boot-logo`(앱 아이콘에서 뽑은 것) —
     *     **아이콘을 바꾸면 이것도 다시 뽑을 것.**
     *   - 걷는 신호는 **보이는 탭이 처음 다 받았을 때**다(`onFirstLoad` — 알림으로
     *     공지 탭부터 열리는 판도 있다). 실패해도 `finished()`는 불리므로 걷힌다.
     *   - **그래도 `coverMax`(4초) 뒤에는 무조건 걷는다** — 통신이 막혀 영영
     *     첫 화면에 갇히면 앱이 죽은 것처럼 보인다.
     *   - 걷을 때만 살짝 사라진다(0.2초). 나타나는 연출은 없다 — 첫 프레임부터
     *     있어야 가리는 뜻이 있다.
     */
    private var cover: UIView?
    private static let coverMax: TimeInterval = 4

    private func putCover() {
        let c = UIView()
        c.backgroundColor = .white
        c.frame = view.bounds
        c.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        let logo = UIImageView(image: UIImage(named: "boot-logo"))
        logo.contentMode = .scaleAspectFit
        logo.translatesAutoresizingMaskIntoConstraints = false
        logo.isAccessibilityElement = true
        logo.accessibilityLabel = "까꿍"
        c.addSubview(logo)
        let want = logo.widthAnchor.constraint(equalToConstant: 200)
        want.priority = .defaultHigh
        NSLayoutConstraint.activate([
            logo.centerXAnchor.constraint(equalTo: c.centerXAnchor),
            logo.centerYAnchor.constraint(equalTo: c.centerYAnchor),
            want,
            logo.widthAnchor.constraint(lessThanOrEqualToConstant: 200),
            logo.widthAnchor.constraint(lessThanOrEqualTo: c.widthAnchor, multiplier: 0.52),
            logo.heightAnchor.constraint(equalTo: logo.widthAnchor)
        ])
        view.addSubview(c)
        cover = c
        for t in [homeTab, boardTab, roundsTab, pollsTab] as [ShellTabController] {
            t.onFirstLoad = { [weak self] in self?.dropCover() }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.coverMax) { [weak self] in
            if self?.cover != nil { AppLog.add("첫 화면 가리개 — 시간이 다 돼 걷음") }
            self?.dropCover()
        }
    }

    func dropCover() {
        guard let c = cover else { return }
        cover = nil
        for t in [homeTab, boardTab, roundsTab, pollsTab] as [ShellTabController] { t.onFirstLoad = nil }
        UIView.animate(withDuration: 0.2, animations: { c.alpha = 0 }, completion: { _ in c.removeFromSuperview() })
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
        /* 대화방 위에 얹힌 화면에서 대화로 가라면 **아래 있는 대화방으로 돌아간다** —
           웹은 아직 `/chat`에 있어 다시 열라고 하면 두 겹이 된다. */
        if path == "/chat", let nav = navigationController,
           let chat = nav.viewControllers.last(where: { $0 is NativeChatViewController }) {
            if nav.topViewController !== chat { nav.popToViewController(chat, animated: true) }
            return
        }
        if path == "/chat" { askWeb(path); return }
        if let vc = NativeAppPlugin.make(path, service: service) {
            vc.path = path
            push(vc)
            return
        }
        askWeb(path)
    }

    /**
     * 웹에 열어 달라고 한다 — **웹이 아직 열고 있는 동안 같은 주소를 또 보내지 않는다.**
     * 홈의 얼굴(→ `내 정보`)은 웹이 알림 상태를 물어보고 여느라 한 박자 늦는데, 그 사이
     * 한 번 더 누르면 웹 기록에 `/me`가 두 칸 쌓여 **뒤로 와도 웹은 `/me`에 남고,
     * 다음에 누르면 아무 일도 안 일어났다**(사용자 제보 — `홈에서 프로필이 터치가
     * 됐다안됐다해`). 껍데기가 맨 위가 아니면(=이미 열렸으면) 거르지 않는다.
     */
    private var webAsked: (path: String, at: Date)?
    private func askWeb(_ path: String) {
        if let a = webAsked, a.path == path, Date().timeIntervalSince(a.at) < 1.5,
           navigationController?.topViewController === self {
            AppLog.add("같은 주소 또 누름 — 무시 \(path)")
            return
        }
        webAsked = (path, Date())
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

    /* 탭을 **누를 때는 그대로 툭 바뀐다** — 미끄러지는 것은 밀 때뿐이다(`swipe.active`).
       누르는 것까지 미끄러지게 하면 웹에서 두 번 걷어낸 그 모양이 된다. */
    func tabBarController(_ tabBarController: UITabBarController,
                          animationControllerForTransitionFrom fromVC: UIViewController,
                          to toVC: UIViewController) -> UIViewControllerAnimatedTransitioning? {
        swipe.active ? swipe : nil
    }
    func tabBarController(_ tabBarController: UITabBarController,
                          interactionControllerFor animationController: UIViewControllerAnimatedTransitioning) -> UIViewControllerInteractiveTransitioning? {
        swipe.interactive
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

// ── 탭 사이를 밀어 옮기기 ──────────────────────────────────────

/**
 * **탭 사이를 좌우로 밀어 옮긴다**(사용자 요청 — `탭바 메뉴간 좌우슬라이드로
 * 이동할수있게해줘`). 왼쪽으로 밀면 오른쪽 탭, 오른쪽으로 밀면 왼쪽 탭이다.
 * 옮기는 것은 **홈 · 공지 · 라운드 · 투표 넷 사이**뿐이다 — `대화`는 탭이
 * 아니라 들어갔다 나오는 화면이라(CLAUDE.md) 밀어서 가지 않는다.
 *
 * **웹에서는 두 번 넣었다 걷어낸 자리다** — 거기서 막힌 것은 옆 탭을 그릴
 * 길이 없다는 것이었다(아직 안 그린 화면이라 끌고 나올 그림이 없다).
 * **앱 껍데기에서는 옆 탭이 진짜 화면**이라 그 걸림돌이 없다 — 한 번 연
 * 탭은 살아 있고, 처음 가는 탭은 누를 때와 똑같이 그때 받아 온다.
 *
 * - **손가락을 따라온다** — `UIPercentDrivenInteractiveTransition`.
 *   화면 폭의 34%를 넘기거나 튕기면(800pt/s) 넘어가고, 아니면 제자리로.
 *   값은 뒤로 끌기(`NavLayer`의 `TAKE`·`FLICK`)와 같다.
 * - **`gestureRecognizerShouldBegin`에서는 방향만 본다** — 거리를 보면
 *   거의 늘 거짓이 되어 손짓이 통째로 안 선다(`NavLayer`에서 겪은 자리).
 * - **가로로 미는 손짓에 임자가 있는 자리는 넘긴다** — 실제로 가로로
 *   넘치는 굴림 칸 · 고르는 칸(`UISegmentedControl`)·밀대·스위치.
 * - **서는 순간 목록의 굴리기를 끊는다** — 안 끊으면 옆으로 미는 동안
 *   손끝이 조금만 흘러도 목록이 같이 굴러간다(대화방 `lockList`의 그 자리).
 * - **탭 화면이 맨 위일 때만** — 상세가 얹혀 있거나 창이 떠 있으면 안 선다.
 * - 움직임을 줄여 달라고 해 둔 기기에서는 끌리는 것 없이 곧바로 바뀐다.
 */
final class TabSwipe: NSObject, UIGestureRecognizerDelegate, UIViewControllerAnimatedTransitioning {
    static let TAKE: CGFloat = 0.34
    static let FLICK: CGFloat = 800
    static let SLOPE: CGFloat = 1.2
    /// 밀 수 있는 탭 수 — 홈·공지·라운드·투표(`ShellController.tabPaths`).
    private var count: Int { ShellController.tabPaths.count }

    private weak var shell: ShellController?
    private let pan = UIPanGestureRecognizer()
    /// 미는 중인가 — 이때만 탭 전환에 움직임을 붙인다(누를 때는 툭).
    private(set) var active = false
    private(set) var interactive: UIPercentDrivenInteractiveTransition?
    /// true면 오른쪽 탭으로(손가락은 왼쪽으로).
    private var forward = true
    /// 이 손짓과 함께 선 목록의 굴리기 — 서는 순간 끊는다.
    private var scrolls = NSHashTable<UIGestureRecognizer>.weakObjects()

    func attach(to shell: ShellController) {
        self.shell = shell
        pan.addTarget(self, action: #selector(onPan(_:)))
        pan.maximumNumberOfTouches = 1
        pan.delegate = self
        shell.view.addGestureRecognizer(pan)
    }

    // ── 손짓 ──

    func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
        guard g === pan, let shell = shell, let v = pan.view, !active,
              shell.presentedViewController == nil,
              shell.transitionCoordinator == nil,
              shell.selectedIndex < count else { return false }
        if let nav = shell.navigationController, nav.topViewController !== shell { return false }
        let t = pan.translation(in: v)
        let vel = pan.velocity(in: v)
        let dx: CGFloat, dy: CGFloat
        if abs(vel.x) < 1, abs(vel.y) < 1 { dx = t.x; dy = t.y } else { dx = vel.x; dy = vel.y }
        guard dx != 0, abs(dx) >= abs(dy) * Self.SLOPE else { return false }
        let fwd = dx < 0
        let target = shell.selectedIndex + (fwd ? 1 : -1)
        guard target >= 0, target < count else { return false }
        if taken(at: pan.location(in: v), in: v) { return false }
        forward = fwd
        return true
    }

    /// 누른 자리가 가로 손짓의 임자인가 — 가로로 넘치는 굴림 칸, 고르는 칸·밀대·스위치.
    private func taken(at p: CGPoint, in v: UIView) -> Bool {
        var cur = v.hitTest(p, with: nil)
        while let c = cur, c !== v {
            if c is UISegmentedControl || c is UISlider || c is UISwitch { return true }
            if let sv = c as? UIScrollView, !(sv is UITableView),
               sv.contentSize.width > sv.bounds.width + 1 { return true }
            cur = c.superview
        }
        return false
    }

    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        /* 목록의 굴리기와는 나란히 선다 — 누가 먼저 서느냐로 갈리지 않게.
           우리가 서면 그 자리에서 목록 쪽을 끊는다(`.began`). */
        if g === pan, other.view is UIScrollView { scrolls.add(other); return true }
        return false
    }

    @objc private func onPan(_ p: UIPanGestureRecognizer) {
        guard let shell = shell, let v = p.view else { return }
        let w = max(v.bounds.width, 1)
        let dx = p.translation(in: v).x
        let progress = max(0, min(0.99, (forward ? -dx : dx) / w))
        switch p.state {
        case .began:
            for s in scrolls.allObjects { s.isEnabled = false; s.isEnabled = true }
            scrolls.removeAllObjects()
            v.endEditing(true)
            let target = shell.selectedIndex + (forward ? 1 : -1)
            guard target >= 0, target < count else { return }
            AppLog.add("탭 밀기 \(shell.selectedIndex) → \(target)")
            if UIAccessibility.isReduceMotionEnabled {
                shell.selectedIndex = target
                p.isEnabled = false; p.isEnabled = true
                return
            }
            let it = UIPercentDrivenInteractiveTransition()
            it.completionCurve = .easeOut
            interactive = it
            active = true
            shell.selectedIndex = target
        case .changed:
            interactive?.update(progress)
        case .ended, .cancelled, .failed:
            guard let it = interactive else { active = false; return }
            let vx = p.velocity(in: v).x
            let along = forward ? -vx : vx
            let go = p.state == .ended && (along > Self.FLICK || (progress > Self.TAKE && along > -Self.FLICK))
            it.completionSpeed = 1
            if go { it.finish() } else { it.cancel() }
            interactive = nil
            active = false
        default: break
        }
    }

    // ── 움직임 ──

    func transitionDuration(using ctx: UIViewControllerContextTransitioning?) -> TimeInterval { 0.3 }

    /* 두 화면이 한 장처럼 나란히 밀린다 — 떠나는 탭이 한 폭 밀려 나가고 가는 탭이
       반대쪽 끝에서 들어온다. 탭바는 이 그릇 밖이라 그대로 있다(누르는 자리니까).
       `.allowUserInteraction` — 없으면 움직이는 동안 손짓이 통째로 꺼진다
       (전체화면 프로필에서 겪은 자리다). */
    func animateTransition(using ctx: UIViewControllerContextTransitioning) {
        guard let from = ctx.view(forKey: .from), let to = ctx.view(forKey: .to),
              let toVC = ctx.viewController(forKey: .to) else {
            ctx.completeTransition(!ctx.transitionWasCancelled)
            return
        }
        let c = ctx.containerView
        let w = c.bounds.width
        let s: CGFloat = forward ? 1 : -1
        to.frame = ctx.finalFrame(for: toVC)
        to.transform = CGAffineTransform(translationX: s * w, y: 0)
        c.addSubview(to)
        UIView.animate(withDuration: transitionDuration(using: ctx), delay: 0,
                       options: [.curveLinear, .allowUserInteraction], animations: {
            from.transform = CGAffineTransform(translationX: -s * w, y: 0)
            to.transform = .identity
        }, completion: { _ in
            /* 되돌아간 판에도 자리를 반드시 되돌린다 — 남으면 탭 화면이 옆으로 밀린 채 굳는다. */
            from.transform = .identity
            to.transform = .identity
            let done = !ctx.transitionWasCancelled
            if !done { to.removeFromSuperview() }
            ctx.completeTransition(done)
        })
    }
}

// ── 탭 화면의 뼈대 ─────────────────────────────────────────────

/**
 * 탭 하나의 뼈대 — 머리말(제목 + 오른쪽 단추)과 표. 화면이 보일 때마다
 * 다시 받는다(1초 안에 두 번은 안 받는다). 당겨서도 새로고침된다.
 * 실시간은 `liveTables`에 적은 표가 바뀌면 보일 때만 다시 받는다(5단계).
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
    /// 이 탭이 다시 받는 표(5단계 — 실시간). 보일 때만 받는다.
    var liveTables: Set<String> { [] }
    private var livePending: Set<String> = []
    private var liveWork: DispatchWorkItem?

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
        NotificationCenter.default.addObserver(self, selector: #selector(liveChanged(_:)), name: AppLive.changed, object: nil)
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
    /// 처음 한 번 다 받았을 때 — 껍데기가 첫 화면 가리개를 걷는 신호(`dropCover`).
    var onFirstLoad: (() -> Void)?
    func finished() {
        loadedOnce = true
        if let f = onFirstLoad { onFirstLoad = nil; f() }
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

    // ── 실시간(5단계) ────────────────────────────────────────────
    @objc private func liveChanged(_ n: Notification) {
        guard let t = n.userInfo?["tables"] as? Set<String> else { return }
        let hit = t.intersection(liveTables)
        guard !hit.isEmpty else { return }
        livePending.formUnion(hit)
        liveSoon(0.4)
    }
    private func liveSoon(_ delay: Double) {
        liveWork?.cancel()
        let w = DispatchWorkItem { [weak self] in self?.liveFire() }
        liveWork = w
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: w)
    }
    /// 안 보이는 탭은 버린다 — 보일 때 어차피 다시 받는다. 찾는 칸을 치는 중이면 조금 뒤에.
    private func liveFire() {
        guard viewIfLoaded?.window != nil, presentedViewController == nil else { livePending = []; return }
        if view.appHoldsFocus { liveSoon(2); return }
        let t = livePending
        livePending = []
        liveReload(t)
    }
    /// 무엇이 바뀌었는지 보고 다시 받는다 — 기본은 통째로(`load`). 홈은 대화·알림만이면 숫자만 고친다.
    func liveReload(_ tables: Set<String>) { load() }

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
