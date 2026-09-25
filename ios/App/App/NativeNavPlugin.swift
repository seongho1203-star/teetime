import UIKit
import WebKit
import Capacitor

/**
 * **화면 전환과 뒤로 끌기를 맡는 층**(`src/lib/native-nav.ts`).
 *
 * 웹 화면은 그대로 웹이 그리고, **밀려 들어오고 나가는 움직임과 손가락으로
 * 끌어 뒤로 가는 일만** 여기서 한다. 안드로이드의 `nav/NavLayer.kt`와 같은
 * 짜임·같은 값이다 — **한쪽만 고치지 말 것.**
 *
 * ```
 * [판(prev)]  ← 화면 틀(nav.view)의 맨 아래. 들어갈 때 1/4만큼 따라 나가며 어두워진다
 * [막(dim)]
 * [웹뷰]      ← root.view. 들어갈 때 오른쪽 끝에서 제자리로 온다
 * [떠남(exit)]← 뒤로 갈 때·끌 때 맨 위에서 오른쪽으로 빠져나가는 지금 화면
 * ```
 *
 * - **찍는 것은 `snapshotView(afterScreenUpdates: false)`다** — 그 순간
 *   그려져 있는 층을 그대로 떠서 값이 싸다. 웹이 `push`·`pop`을 부를 때
 *   웹뷰에는 아직 옛 화면이 덮여 있으므로(`lib/tabs.ts`의 `holdScreen`)
 *   여기서 찍는 것이 곧 앞 화면이다.
 * - **대화방은 손대지 않는다.** 그 화면은 화면 틀(`UINavigationController`)에
 *   밀어 올려 iOS가 키보드까지 함께 옮긴다(`AppDelegate.wrapInNavigation`).
 *   웹이 `native: true`로 부르면 판만 쌓고·버린다. 대화방이 떠 있는 동안
 *   (`viewControllers.count > 1`) 이 층의 손짓은 서지 않는다.
 * - **끄는 손짓은 `UIPanGestureRecognizer`다** — 화면 틀의 뷰에 걸어 아무
 *   데서나 오른쪽으로 그으면 선다. 손을 댄 자리가 다른 손짓의 임자인지는
 *   웹이 `touch({free})`로 알려 준다(앱은 DOM을 모른다). 서는 순간 웹뷰의
 *   굴리기를 끊는다. **`gestureRecognizerShouldBegin`에서는 방향만 보고
 *   거리(`WAKE`)는 `onPan`에서 잰다** — 그 물음은 손짓당 한 번뿐이라 거기서
 *   거리를 요구하면 손짓이 통째로 실패한다(1.195에서 실제로 그랬다).
 * - **값은 웹과 같다**: `TAKE` 0.34 · `FLICK` 0.8pt/ms · `FLICK_MIN` 40 ·
 *   `STALE` 120 · `WAKE` 12 · `SLOPE` 1.2 · `PARALLAX` 0.25 · `DIM` 0.18 ·
 *   되돌아가는 230ms · 곡선 `cubic-bezier(.32,.72,0,1)`.
 */
@objc(NativeNavPlugin)
public class NativeNavPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeNavPlugin"
    public let jsName = "NativeNav"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "ready", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "push", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "back", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "touch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "rendered", returnType: CAPPluginReturnPromise)
    ]
    private var layer: NavLayer?

    @MainActor private func nav() -> NavLayer? {
        if let l = layer { return l }
        guard let root = bridge?.viewController else { return nil }
        let l = NavLayer(root: root)
        l.onBack = { [weak self] phase in
            self?.notifyListeners("nav", data: ["type": "back", "phase": phase])
        }
        layer = l
        return l
    }

    @objc func ready(_ call: CAPPluginCall) { call.resolve(["v": 1]) }

    @objc func push(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let l = self.nav() else { call.resolve(); return }
            let supplied = call.getString("shot").flatMap { NavLayer.plate(dataURL: $0) }
            l.push(ms: call.getDouble("ms") ?? 0,
                   native: call.getBool("native") ?? false,
                   supplied: supplied) { call.resolve() }
        }
    }
    @objc func pop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let l = self.nav() else { call.resolve(); return }
            l.pop(ms: call.getDouble("ms") ?? 0, native: call.getBool("native") ?? false) { call.resolve() }
        }
    }
    @objc func back(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.nav()?.armed = call.getBool("on") ?? false
            call.resolve()
        }
    }
    @objc func touch(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.nav()?.free = call.getBool("free") ?? true
            call.resolve()
        }
    }
    @objc func rendered(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.nav()?.rendered(); call.resolve() }
    }
}

/** iOS 26+ 웹 상세 화면 한 칸.
 * React 화면은 그대로 두고, 살아 있는 Capacitor WKWebView 하나만 현재 칸이 품는다.
 * 뒤 칸은 들어갈 때 떠 둔 픽셀만 가진다. UINavigationController가 실제 화면
 * 계층을 pop하므로 키보드도 시스템 interactive transition에 함께 붙는다.
 */
@available(iOS 26.0, *)
fileprivate final class WebRoutePageController: UIViewController {
    weak var owner: NavLayer?
    private(set) var cover: UIView?

    init(owner: NavLayer) { self.owner = owner; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func loadView() {
        let v = UIView()
        v.backgroundColor = .systemBackground
        view = v
    }

    func freeze(_ shot: UIView?) {
        view.subviews.forEach { $0.removeFromSuperview() }
        guard let shot = shot else { return }
        shot.frame = view.bounds
        shot.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        shot.isUserInteractionEnabled = false
        view.addSubview(shot)
        cover = shot
    }

    func attach(_ web: WKWebView, keepCover: Bool) {
        web.removeFromSuperview()
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        if web.frame.width < 1 || abs(web.frame.width - view.bounds.width) > 1 {
            web.frame = view.bounds
        } else {
            web.frame.origin = .zero
            web.frame.size.width = view.bounds.width
        }
        view.insertSubview(web, at: 0)
        if !keepCover { clearCover() }
    }

    func clearCover() {
        cover?.removeFromSuperview()
        cover = nil
    }

}

/// 위 주석의 그 층. root는 웹뷰를 화면으로 쓰는 Capacitor 화면이다.
final class NavLayer: NSObject, UIGestureRecognizerDelegate, UINavigationControllerDelegate {
    static let TAKE: CGFloat = 0.34
    static let FLICK: CGFloat = 0.8
    static let FLICK_MIN: CGFloat = 40
    static let STALE: TimeInterval = 0.12
    static let WAKE: CGFloat = 12
    static let SLOPE: CGFloat = 1.2
    static let PARALLAX: CGFloat = 0.25
    static let DIM: CGFloat = 0.18
    static let BACK_MS: TimeInterval = 0.23
    /// 왼쪽 가장자리 — 여기서 시작한 손짓은 웹이 뭐라 하든 우리 것이다.
    static let EDGE: CGFloat = 24
    static let EASE = (CGPoint(x: 0.32, y: 0.72), CGPoint(x: 0, y: 1))

    private weak var root: UIViewController?

    /* iOS 26+에서는 웹 상세 화면도 실제 UINavigationController 칸으로 쌓는다. */
    private weak var systemWeb: WKWebView?
    private var systemRootHolder: UIView?
    private weak var systemContentPop: UIGestureRecognizer?
    /** full-content swipe를 시작한 웹 page. UINavigationController.didShow에서
        성공/취소를 판별하는 표다. viewDidDisappear/isMovingFromParent는
        interactive pop 완료 신호가 아니어서 더 이상 쓰지 않는다. */
    private weak var systemInteractiveFrom: UIViewController?
    private var systemProgrammaticPop = false
    private var systemInstalled = false

    /** 키보드가 떠 있는 동안 웹뷰는 resize:native로 작아진다. 그 크기의
        snapshot을 화면 틀 크기로 늘리면 '확대된 화면 + 제자리에 남은 키보드'가
        된다. 그래서 그 상태에서는 끌기를 시작하지 않고 첫 손짓으로 키보드만
        내린다. 다음 손짓은 원래 크기로 돌아온 웹뷰를 정상적으로 끈다. */
    private var keyboardVisible = false
    /** 키보드를 내리는 동안에도 지금 UIPan을 살려 두고 손가락 거리를 기억한다. */
    private var keyboardWaiting = false
    private var keyboardDX: CGFloat = 0
    private var keyboardRelease: (dx: CGFloat, vx: CGFloat)?
    private var keyboardObservers: [NSObjectProtocol] = []
    /** 뒤에 깔린 앞 화면들 — 히스토리 한 칸에 하나. 탭으로 간 자리는 nil이다. */
    private var stack: [UIView?] = []
    private let maxStack = 5
    var armed = false { didSet { armPan() } }
    var free = true
    var onBack: ((String) -> Void)?

    init(root: UIViewController) {
        self.root = root
        super.init()
        let nc = NotificationCenter.default
        keyboardObservers.append(nc.addObserver(
            forName: UIResponder.keyboardWillShowNotification, object: nil, queue: .main
        ) { [weak self] _ in self?.keyboardVisible = true })
        keyboardObservers.append(nc.addObserver(
            forName: UIResponder.keyboardDidHideNotification, object: nil, queue: .main
        ) { [weak self] _ in
            guard let self = self else { return }
            self.keyboardVisible = false
            DispatchQueue.main.async {
                self.web?.layoutIfNeeded()
                self.resumeAfterKeyboard()
            }
        })
        installSystemWebNavigation()
    }

    private func installSystemWebNavigation() {
        guard #available(iOS 26.0, *),
              let root = root,
              let nav = root.navigationController,
              let web = root.view as? WKWebView else { return }

        let holder = UIView(frame: web.frame)
        holder.backgroundColor = web.backgroundColor ?? .systemBackground
        holder.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        root.view = holder
        web.removeFromSuperview()
        web.frame = holder.bounds
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        holder.addSubview(web)

        systemWeb = web
        systemRootHolder = holder
        systemInstalled = true
        /* didShow는 UIKit 문서상 push/pop 뒤 실제로 표시가 끝난 시점이다.
           interactive pop의 성공/취소를 화면 lifecycle 대신 여기서 확정한다. */
        nav.delegate = self

        let g = nav.interactiveContentPopGestureRecognizer
        /* iOS 26의 full-content pan은 nav.view 전체에 걸린다. 기본값 그대로면
           WKWebView의 <textarea>/<input>에 간 **짧은 탭도 pan이 실패할 때까지
           붙들어 둘 수 있고**, WebKit의 focus/user-gesture 판정이 끝난 뒤라
           키보드가 안 뜨는 경우가 생겼다(201 실기기 제보).
           
           뒤로끌기는 pan이 실제로 시작한 뒤에만 필요하므로, 평범한 탭은
           WebKit에 즉시 흘려 보낸다. pan이 시작해도 웹의 터치를 취소하지
           않고 UINavigationController transition과 나란히 처리한다. */
        g?.delaysTouchesBegan = false
        g?.delaysTouchesEnded = false
        g?.cancelsTouchesInView = false
        g?.delegate = self
        /* 이 recognizer는 nav.view **전체**에 설치된다. 웹 상세가 아닐 때까지
           켜 두면 채팅으로 pop한 직후에도 UIKit의 full-content recognizer가
           모든 터치를 먼저 본다. 204에서 채팅 상태만 resume해도 헤더 ←까지
           안 눌린 실기기 제보가 이 자리다. 웹 page가 top일 때만 켠다. */
        g?.isEnabled = false
        systemContentPop = g
    }

    private var usesSystemWebNavigation: Bool {
        if #available(iOS 26.0, *) { return systemInstalled }
        return false
    }

    /** iOS 26 full-content pop은 **웹 상세 화면 전용**이다.
        채팅·홈에서는 완전히 꺼서 그 화면의 버튼/카드가 UIKit recognizer와
        경쟁하지 않게 한다. false→true로 다시 켜는 것은 recognizer state도
        .possible로 초기화해 직전 interactive pop의 찌꺼기를 남기지 않는다. */
    @available(iOS 26.0, *)
    private func systemBackGesture(_ on: Bool) {
        guard let g = systemContentPop else { return }
        if on {
            g.isEnabled = false
            g.isEnabled = true
        } else {
            g.isEnabled = false
        }
    }

    @available(iOS 26.0, *)
    private func systemFreezeCurrent(_ shot: UIView?) {
        guard let nav = root?.navigationController else { return }
        if let page = nav.topViewController as? WebRoutePageController {
            page.freeze(shot)
        } else if nav.topViewController === root, let holder = systemRootHolder {
            holder.subviews.forEach { $0.removeFromSuperview() }
            if let shot = shot {
                shot.frame = holder.bounds
                shot.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                shot.isUserInteractionEnabled = false
                holder.addSubview(shot)
            }
        }
    }

    @available(iOS 26.0, *)
    private func systemAttachWeb(to vc: UIViewController, keepCover: Bool) {
        guard let web = systemWeb else { return }
        if let page = vc as? WebRoutePageController {
            page.attach(web, keepCover: keepCover)
            return
        }
        guard vc === root, let holder = systemRootHolder else { return }
        web.removeFromSuperview()
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.frame.origin = .zero
        web.frame.size.width = holder.bounds.width
        holder.insertSubview(web, at: 0)
        if !keepCover {
            holder.subviews.filter { $0 !== web }.forEach { $0.removeFromSuperview() }
        }
    }

    @available(iOS 26.0, *)
    private func systemClearCover() {
        guard let top = root?.navigationController?.topViewController else { return }
        if let page = top as? WebRoutePageController {
            page.clearCover()
        } else if top === root, let holder = systemRootHolder, let web = systemWeb {
            holder.subviews.filter { $0 !== web }.forEach { $0.removeFromSuperview() }
        }
    }

    @available(iOS 26.0, *)
    private func systemPush(ms: Double, supplied: UIView?, done: @escaping () -> Void) {
        systemInteractiveFrom = nil
        guard let root = root, let nav = root.navigationController, let web = systemWeb else {
            done(); return
        }
        let fromChat = nav.topViewController is NativeChatViewController
            || nav.topViewController is NativeScreenController
        if !fromChat {
            let shot = supplied ?? web.snapshotView(afterScreenUpdates: false)
            systemFreezeCurrent(shot)
        }
        let page = WebRoutePageController(owner: self)
        page.loadViewIfNeeded()
        page.attach(web, keepCover: false)
        nav.pushViewController(page, animated: ms > 40)
        /* page가 top이 된 뒤에만 화면 전체 뒤로끌기를 연다. */
        systemBackGesture(true)
        done()
    }

    @available(iOS 26.0, *)
    private func systemResetToRoot(done: @escaping () -> Void) {
        systemInteractiveFrom = nil
        guard let root = root, let nav = root.navigationController else { done(); return }
        systemBackGesture(false)
        systemAttachWeb(to: root, keepCover: false)
        systemWeb?.endEditing(true)
        nav.setViewControllers([root], animated: false)
        done()
    }

    @available(iOS 26.0, *)
    private func systemPop(ms: Double, done: @escaping () -> Void) {
        systemInteractiveFrom = nil
        guard let nav = root?.navigationController,
              nav.topViewController is WebRoutePageController else { done(); return }
        systemProgrammaticPop = true
        nav.popViewController(animated: ms > 40)
        let finish = { [weak self, weak nav] in
            guard let self = self, let dest = nav?.topViewController else { done(); return }
            if let chat = dest as? NativeChatViewController {
                /* full-content recognizer는 nav.view 전체를 덮으므로 **먼저 끈다**.
                   이게 남아 있으면 채팅 카드뿐 아니라 헤더 뒤로 버튼도 못 누른다. */
                self.systemBackGesture(false)
                if let root = self.root { self.systemAttachWeb(to: root, keepCover: false) }
                chat.view.isUserInteractionEnabled = true
                /* 채팅 카드로 웹 상세에 갈 때 chat.navigate()가 navigating=true로
                   잠그고 React cleanup이 pause()한다. 201 구조에서는 그 채팅 VC를
                   navigation stack에 **그대로 남겨 둔 채** 웹 page만 위에 얹는다.
                   따라서 pop으로 채팅이 다시 보이는 순간 UIKit 쪽에서 먼저
                   resume해야 한다. JS route가 다시 mount되기만 기다리면 그 사이
                   navigating=true라 카드 탭이 전부 무시되고, 경우에 따라 재-open
                   신호가 오기 전까지 홈에 나갔다 와야 풀렸다. */
                chat.resume()
            } else if dest is NativeScreenController {
                /* 앱이 그리는 다른 화면(`docs/아이폰-네이티브.md`)으로 돌아왔다 —
                   대화방과 같이 웹뷰는 뿌리로 되돌리고 화면 전체 뒤로끌기는 끈다. */
                self.systemBackGesture(false)
                if let root = self.root { self.systemAttachWeb(to: root, keepCover: false) }
            } else {
                self.systemAttachWeb(to: dest, keepCover: true)
                self.systemBackGesture(dest is WebRoutePageController)
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                self.systemClearCover()
                self.systemProgrammaticPop = false
                done()
            }
        }
        if let c = nav.transitionCoordinator {
            c.animate(alongsideTransition: nil) { _ in finish() }
        } else {
            DispatchQueue.main.async { finish() }
        }
    }

    /** full-content swipe가 **실제로 끝난 뒤** native/web history를 한 번만 맞춘다. */
    @available(iOS 26.0, *)
    private func systemInteractiveCompleted(to dest: UIViewController) {
        if let chat = dest as? NativeChatViewController {
            systemBackGesture(false)
            if let root = root { systemAttachWeb(to: root, keepCover: false) }
            chat.view.isHidden = false
            chat.view.alpha = 1
            chat.view.transform = .identity
            chat.view.isUserInteractionEnabled = true
            chat.resume()
        } else if dest is NativeScreenController {
            systemBackGesture(false)
            if let root = root { systemAttachWeb(to: root, keepCover: false) }
        } else {
            systemAttachWeb(to: dest, keepCover: true)
            systemBackGesture(dest is WebRoutePageController)
        }
        /* 이 신호가 React nav(-1)을 만든다. 이게 빠지면 화면은 채팅인데
           URL/route는 라운드·투표에 남아 NativeChatHost listener가 없고,
           카드·←가 모두 '무반응'이 된다. 사용자가 한 번 더 끌면 웹 history만
           홈으로 가던 206 증상이 정확히 그 상태였다. */
        onBack?("commit")
    }

    /** UINavigationController가 **실제로 표시를 끝낸 뒤** 호출한다.
        Apple의 didShow가 interactive pop 성공/취소를 가르는 단일 기준이다. */
    func navigationController(_ navigationController: UINavigationController,
                              didShow viewController: UIViewController,
                              animated: Bool) {
        guard #available(iOS 26.0, *) else { return }
        guard let from = systemInteractiveFrom else {
            /* **우리가 안 내린 pop** — 가장자리 끌기(`EdgeBack`)가 웹 page를
               내리면 아무도 웹뷰를 옮기지 않아 **웹뷰가 빠진 page 안에 갇힌
               채로 남는다.** 그러면 뿌리의 홀더는 비어 있어 **흰 화면**만 뜨고
               (실기기 제보 — `뒤로가기했을때 가끔 아무화면이 안떠`) 웹 주소도
               그대로다. 갇힌 것이 보이면 손가락으로 끌어 넘어간 것과 똑같이
               마무리한다 — 웹뷰를 보이는 화면으로 옮기고 웹에 `commit`을 보낸다. */
            guard !systemProgrammaticPop, let web = systemWeb,
                  let page = web.superview?.next as? WebRoutePageController,
                  !navigationController.viewControllers.contains(where: { $0 === page })
            else { return }
            systemInteractiveCompleted(to: viewController)
            return
        }
        systemInteractiveFrom = nil

        if viewController === from {
            /* 손을 놓고 원래 웹 page로 되돌아온 것 = 취소. history는 건드리지 않는다. */
            systemBackGesture(true)
            return
        }

        /* from이 stack에서 빠지고 다른 VC가 top이 됐다 = pop 성공.
           didShow 시점에는 transition container가 이미 정리되어 있으므로
           여기서 웹뷰를 옮기고 React history를 바꿔도 유령 hit-test 층이 없다. */
        systemInteractiveCompleted(to: viewController)
    }

    deinit {
        let nc = NotificationCenter.default
        keyboardObservers.forEach { nc.removeObserver($0) }
    }

    /** 키보드가 다 내려간 뒤 **같은 UIPan**을 현재 dx에서 이어 간다. */
    private func resumeAfterKeyboard() {
        guard keyboardWaiting else { return }
        keyboardWaiting = false
        let dx = keyboardDX
        let released = keyboardRelease
        keyboardDX = 0
        keyboardRelease = nil
        guard dx >= Self.WAKE, canDrag(), beginDrag(), let d = drag else { return }
        paint(d, dx)
        if let r = released {
            let flick = r.vx > Self.FLICK && r.dx > Self.FLICK_MIN
            endDrag(go: r.dx > d.w * Self.TAKE || flick)
        } else {
            lastX = x0 + dx
            lastT = CACurrentMediaTime()
            vx = 0
        }
    }

    /** 앱 대화 화면이 떠 준 JPEG를 뒤로끌기용 판으로 만든다.
        비동기 bridge보다 React unmount가 먼저 와 대화 VC가 사라져도 이 판은
        이미 JS 이벤트에 실려 있으므로 채팅 → 링크의 뒤로끌기가 끊기지 않는다. */
    static func plate(dataURL: String) -> UIView? {
        guard !dataURL.isEmpty,
              let comma = dataURL.firstIndex(of: ","),
              let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])),
              let image = UIImage(data: data) else { return nil }
        let v = UIImageView(image: image)
        v.contentMode = .scaleToFill
        v.clipsToBounds = true
        v.isUserInteractionEnabled = false
        return v
    }

    /** 판을 까는 자리 — 화면 틀의 뷰. 틀이 없는 옛 껍데기에서는 웹뷰의 부모다. */
    private var host: UIView? { root?.navigationController?.view ?? root?.view.superview }
    private var web: UIView? { systemWeb ?? root?.view }
    /** 앱이 통째로 그리는 화면이 위에 떠 있는가 — 대화방, 그리고 하나씩 옮겨
        가는 앱 화면(`NativeScreenController` · `docs/아이폰-네이티브.md`).
        그때 웹뷰는 화면 밖이라 이 층의 손짓도 찍기도 헛돈다. 이름은 대화만
        있던 때의 것이다. */
    private var chatUp: Bool {
        let top = root?.navigationController?.topViewController
        return top is NativeChatViewController || top is NativeScreenController
    }

    private func snap() -> UIView? { web?.snapshotView(afterScreenUpdates: false) }
    private func fill(_ v: UIView, in host: UIView) {
        v.frame = host.bounds
        v.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        v.isUserInteractionEnabled = false
    }
    private func dimView(in host: UIView) -> UIView {
        let d = UIView(); d.backgroundColor = .black; d.alpha = 0; fill(d, in: host); return d
    }
    private func animator(_ ms: Double) -> UIViewPropertyAnimator {
        UIViewPropertyAnimator(duration: ms / 1000, controlPoint1: Self.EASE.0, controlPoint2: Self.EASE.1)
    }

    // ── 들어가기 · 뒤로 가기(눌러서) ─────────────────────────────

    private var moving = false
    private var pending: (() -> Void)?
    private func endMove() { pending?(); pending = nil; moving = false }

    /**
     * **들어간다.** 지금 웹뷰를 찍어 뒤에 깔고, 웹뷰를 오른쪽 끝에서 제자리로
     * 민다. `native`면(목적지가 대화방) 찍어 두기만 한다 — 그 화면은 화면 틀이
     * 밀어 올린다. `ms`가 0이면(탭으로 가는 길) 자리만 하나 더한다.
     */
    func push(ms: Double, native: Bool, supplied: UIView? = nil, done: @escaping () -> Void) {
        if #available(iOS 26.0, *), usesSystemWebNavigation {
            if ms <= 0 && !native {
                systemResetToRoot(done: done)
                return
            }
            if !native {
                systemPush(ms: ms, supplied: supplied, done: done)
                return
            }
            done()
            return
        }
        /* 채팅 화면이 직접 떠 준 픽셀이 있으면 그것이 가장 확실한 앞 화면이다.
           bridge를 건너는 동안 UINavigationController가 먼저 pop되어도 안전하다. */
        if let supplied = supplied {
            pushPlate(supplied)
            done()
            return
        }
        guard ms > 0 || native else { pushPlate(nil); done(); return }
        /* **대화방에서 카드를 눌러 나가는 길** — 대화 화면이 아직 떠 있어
           웹뷰는 화면 밖이고, 찍어 봐야 빈손이다(사용자 제보 — `채팅에서
           링크를 눌러서 들어간곳은 뒤로끌기가 안돼`: 판이 비어 `canDrag`가
           늘 거짓이었다). **화면 틀을 통째로 찍으면 그것이 곧 대화 화면**이고,
           끌어서 뒤로 올 때 뒤에 깔린다. 움직임은 여기서 안 만든다 — 대화
           화면은 플러그인이 곧 움직임 없이 내리고(`NativeChatPlugin.remove`),
           웹이 예전 40px짜리로 물러난다(`useScreenSlide`의 `fromChat`). */
        if chatUp {
            pushPlate(host?.snapshotView(afterScreenUpdates: false))
            done()
            return
        }
        let shot = snap()
        pushPlate(shot)
        guard !native, ms > 40, let host = host, let web = web, let plate = shot else { done(); return }
        endMove()
        let w = host.bounds.width
        /* **판은 그대로 더미에도 든다** — 지금 뒤에 깔아 밀고, 끝나면 떼어 두었다가
           끌어서 뒤로 갈 때 다시 깐다(같은 그림이다). */
        fill(plate, in: host); plate.transform = .identity
        let dim = dimView(in: host)
        host.insertSubview(plate, at: 0)
        host.insertSubview(dim, aboveSubview: plate)
        web.transform = CGAffineTransform(translationX: w, y: 0)
        moving = true
        /* 웹이 덮어 둔 사본을 걷을 틈을 준다 — 답을 주고 한 프레임 뒤에 민다. */
        done()
        let a = animator(ms)
        a.addAnimations {
            web.transform = .identity
            plate.transform = CGAffineTransform(translationX: -w * Self.PARALLAX, y: 0)
            dim.alpha = Self.DIM
        }
        token += 1; let mine = token
        let finish = { [weak self] in
            plate.removeFromSuperview(); dim.removeFromSuperview()
            plate.transform = .identity
            web.transform = .identity
            self?.moving = false; self?.pending = nil
        }
        pending = finish
        a.addCompletion { [weak self] _ in if self?.token == mine, self?.pending != nil { finish() } }
        a.startAnimation(afterDelay: 0.032)
        DispatchQueue.main.asyncAfter(deadline: .now() + ms / 1000 + 0.7) { [weak self] in
            if self?.token == mine, self?.pending != nil { finish() }
        }
    }

    /**
     * **뒤로 간다.** 지금 웹뷰를 찍어 맨 위에 얹고 오른쪽으로 내보내며, 그 밑에서
     * 웹뷰가 1/4 자리에서 돌아온다. 뒤에 깔린 판은 웹뷰가 곧 그 화면을 그리므로
     * 버린다. `native`면(대화방에서 나오는 길) 판만 버린다.
     */
    func pop(ms: Double, native: Bool, done: @escaping () -> Void) {
        if #available(iOS 26.0, *), usesSystemWebNavigation,
           root?.navigationController?.topViewController is WebRoutePageController {
            systemPop(ms: ms > 40 ? ms : 230, done: done)
            return
        }
        let prev = popPlate()
        prev?.removeFromSuperview()
        guard !native, ms > 40, let host = host, let web = web, let exit = snap() else { done(); return }
        endMove()
        let w = host.bounds.width
        fill(exit, in: host)
        let dim = dimView(in: host)
        dim.alpha = Self.DIM
        host.addSubview(dim); host.addSubview(exit)
        web.transform = CGAffineTransform(translationX: -w * Self.PARALLAX, y: 0)
        moving = true
        done()
        let a = animator(ms)
        a.addAnimations {
            exit.transform = CGAffineTransform(translationX: w, y: 0)
            web.transform = .identity
            dim.alpha = 0
        }
        token += 1; let mine = token
        let finish = { [weak self] in
            exit.removeFromSuperview(); dim.removeFromSuperview()
            web.transform = .identity
            self?.moving = false; self?.pending = nil
        }
        pending = finish
        a.addCompletion { [weak self] _ in if self?.token == mine, self?.pending != nil { finish() } }
        a.startAnimation(afterDelay: 0.032)
        DispatchQueue.main.asyncAfter(deadline: .now() + ms / 1000 + 0.7) { [weak self] in
            if self?.token == mine, self?.pending != nil { finish() }
        }
    }

    /// 클로저는 견줄 수 없어 **번호**로 가른다 — 아직 그 이동이 도는 중인가.
    private var token = 0

    private func pushPlate(_ v: UIView?) {
        stack.append(v)
        while stack.count > maxStack { stack.removeFirst()?.removeFromSuperview() }
    }
    private func popPlate() -> UIView? { stack.isEmpty ? nil : stack.removeLast() }

    // ── 끌어서 뒤로 ───────────────────────────────────────────

    private final class Drag {
        let w: CGFloat; let exit: UIView; let under: UIView; let dim: UIView
        var dx: CGFloat = 0
        init(w: CGFloat, exit: UIView, under: UIView, dim: UIView) { self.w = w; self.exit = exit; self.under = under; self.dim = dim }
    }
    private var drag: Drag?
    /** 끌어서 넘어간 뒤 웹이 목적지를 다 그리기를 기다리는 동안 남겨 둔 것. */
    private var settling: Drag?
    private var pan: UIPanGestureRecognizer?
    private var lastX: CGFloat = 0, lastT: TimeInterval = 0, vx: CGFloat = 0, x0: CGFloat = 0, y0: CGFloat = 0
    private var edge = false

    /* `stack.last`는 이중 옵셔널이라 `?? nil`로 한 겹 벗겨야 **판이 정말 있는가**가 된다 —
       탭으로 간 자리는 nil 판이 들어 있다. */
    private func canDrag() -> Bool { armed && !moving && drag == nil && settling == nil && !chatUp && (stack.last ?? nil) != nil }

    /** 손짓은 처음 `back({on: true})`가 올 때 건다 — 그때는 화면 틀이 서 있다. */
    private func armPan() {
        if usesSystemWebNavigation { return }
        guard pan == nil, armed, let host = host else { return }
        let p = UIPanGestureRecognizer(target: self, action: #selector(onPan(_:)))
        p.maximumNumberOfTouches = 1
        p.delegate = self
        /* 대화방의 `backPan`(ChatList.swift)과 같다 — 웹뷰의 손짓을 끊지 않고
           나란히 선다. 굴리기는 서는 순간 `beginDrag`가 따로 끊는다. */
        p.cancelsTouchesInView = false
        p.delaysTouchesBegan = false
        host.addGestureRecognizer(p)
        pan = p
    }

    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

    /**
     * **여기서는 방향만 본다 — 거리(`WAKE`)를 보지 말 것.**
     *
     * 이 물음은 iOS가 **손짓당 한 번만** 던진다 — 손가락이 제 문턱(10pt쯤)을
     * 넘는 그 순간이다. 거기서 `12pt 이상 옮겼는가`를 함께 물었더니 거의
     * 늘 거짓이 되어 **손짓이 그 자리에서 실패하고 그 손이 떨어질 때까지
     * 다시는 안 물어봤다** — 아이폰에서 뒤로 끌기가 통째로 안 되던 까닭이다
     * (사용자 제보 — `아이폰에서 뒤로끌기가 아에 안돼는데???`).
     * 대화방의 `BackGuard`(ChatList.swift)가 하는 그대로, **빠르기의
     * 방향**(멈춰 있으면 옮긴 방향)만 본다. 깨어나는 거리는 `onPan`이
     * 움직이는 동안 잰다.
     */
    func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
        if #available(iOS 26.0, *), g === systemContentPop {
            guard armed, !moving, !systemProgrammaticPop,
                  let nav = root?.navigationController,
                  let page = nav.topViewController as? WebRoutePageController,
                  free else {
                systemInteractiveFrom = nil
                return false
            }
            /* 이 page를 기억해 두고 **didShow에서** 같은 page면 취소,
               다른 VC면 성공으로 확정한다. */
            systemInteractiveFrom = page
            return true
        }
        guard let p = g as? UIPanGestureRecognizer, let host = host, canDrag() else { return false }
        let t = p.translation(in: host)
        let at = p.location(in: host)
        edge = at.x - t.x < Self.EDGE
        let v = p.velocity(in: host)
        let right: Bool
        if abs(v.x) < 1, abs(v.y) < 1 {
            right = t.x > 0 && t.x >= abs(t.y) * Self.SLOPE
        } else {
            right = v.x > 0 && v.x >= abs(v.y) * Self.SLOPE
        }
        guard right else { return false }
        /* 웹이 `taken`이라 했으면 넘긴다 — 가장자리에서 시작한 것은 예외다. */
        guard free || edge else { return false }
        /* false를 돌려주면 iOS가 이 손짓을 실패시켜 한 번 더 끌어야 한다.
           손짓은 승인하고 키보드만 먼저 내린 뒤 didHide에서 그대로 잇는다. */
        if keyboardVisible {
            keyboardWaiting = true
            keyboardDX = 0
            keyboardRelease = nil
            web?.endEditing(true)
        }
        return true
    }

    /** 손짓을 이번 손에서 통째로 접는다 — 껐다 켜면 그 자리에서 `.cancelled`가 온다. */
    private func dropPan(_ p: UIPanGestureRecognizer) { p.isEnabled = false; p.isEnabled = true }

    /**
     * 끌기를 시작한다. 지금 웹뷰를 찍어 맨 위에 얹고, 뒤에 깔린 앞 화면 판을
     * **웹뷰 위에** 깐다 — 웹뷰는 아직 이 화면을 그리고 있어서 판이 위에
     * 있어야 목적지가 보인다.
     */
    private func beginDrag() -> Bool {
        /* shouldBegin 뒤와 실제 시작 사이에 키보드가 올라온 경우까지 막는다. */
        if keyboardVisible { web?.endEditing(true); return false }
        guard let host = host, let under = stack.last ?? nil, let exit = snap() else { return false }
        /* 여기서부터 우리 손짓이다 — 웹뷰의 굴리기를 끊는다. */
        if let sv = (root?.view as? WKWebView)?.scrollView {
            sv.panGestureRecognizer.isEnabled = false; sv.panGestureRecognizer.isEnabled = true
        }
        let w = host.bounds.width
        fill(under, in: host); fill(exit, in: host)
        let dim = dimView(in: host)
        dim.alpha = Self.DIM
        under.transform = CGAffineTransform(translationX: -w * Self.PARALLAX, y: 0)
        host.addSubview(under); host.addSubview(dim); host.addSubview(exit)
        drag = Drag(w: w, exit: exit, under: under, dim: dim)
        return true
    }

    private func paint(_ d: Drag, _ dx: CGFloat) {
        d.dx = dx
        let p = max(0, min(1, dx / d.w))
        d.exit.transform = CGAffineTransform(translationX: dx, y: 0)
        d.under.transform = CGAffineTransform(translationX: (p - 1) * d.w * Self.PARALLAX, y: 0)
        d.dim.alpha = Self.DIM * (1 - p)
    }

    /**
     * **끌기는 `WAKE`(12pt)를 넘는 순간 시작한다 — `.began`이 아니라 `.changed`에서.**
     * 손짓이 선 자리는 방향만 맞은 것이라(위 `gestureRecognizerShouldBegin`),
     * 그 뒤 세로로 흘러 버리면 여기서 접는다(`dropPan`). 웹의 `useBackSwipe`가
     * `gx >= WAKE`에서 깨어나는 것과 같은 자리다.
     */
    @objc private func onPan(_ p: UIPanGestureRecognizer) {
        guard let host = host else { return }
        let at = p.location(in: host)
        let x = at.x
        let now = CACurrentMediaTime()
        switch p.state {
        case .began:
            let t = p.translation(in: host)
            x0 = x - t.x; y0 = at.y - t.y
            lastX = x; lastT = now; vx = 0
        case .changed:
            guard let d = drag else {
                let dx = x - x0, dy = abs(at.y - y0)
                if dx >= Self.WAKE, dx >= dy * Self.SLOPE {
                    if keyboardVisible || keyboardWaiting {
                        /* 키보드가 내려가는 동안에도 손가락 진행률을 계속 받는다. */
                        keyboardWaiting = true
                        keyboardDX = max(0, dx)
                        let dt = now - lastT
                        if dt > 0 { vx = (x - lastX) / CGFloat(dt * 1000) }
                        lastX = x; lastT = now
                        web?.endEditing(true)
                        return
                    }
                    guard canDrag(), beginDrag(), let nd = drag else { dropPan(p); return }
                    lastX = x; lastT = now; vx = 0
                    paint(nd, dx)
                } else if dy >= Self.WAKE, dy > dx {
                    keyboardWaiting = false; keyboardDX = 0; keyboardRelease = nil
                    dropPan(p)
                }
                return
            }
            let dt = now - lastT
            if dt > 0 { vx = (x - lastX) / CGFloat(dt * 1000) }
            lastX = x; lastT = now
            paint(d, max(0, x - x0))
        case .ended:
            if let d = drag {
                let still = now - lastT > Self.STALE
                let flick = !still && vx > Self.FLICK && d.dx > Self.FLICK_MIN
                endDrag(go: d.dx > d.w * Self.TAKE || flick)
            } else if keyboardVisible || keyboardWaiting {
                /* 키보드보다 손이 먼저 떨어져도 이 한 번의 스와이프로 끝낸다. */
                let dx = max(keyboardDX, x - x0)
                keyboardDX = dx
                keyboardRelease = (dx, max(vx, p.velocity(in: host).x / 1000))
            }
        case .cancelled, .failed:
            keyboardWaiting = false; keyboardDX = 0; keyboardRelease = nil
            if drag != nil { endDrag(go: false) }
        default: break
        }
    }

    /** 손을 뗐다 — 넘어가거나 제자리로. */
    private func endDrag(go: Bool) {
        guard let d = drag else { return }
        drag = nil
        let a = animator(Self.BACK_MS * 1000)
        a.addAnimations { [weak self] in self?.paint(d, go ? d.w : 0) }
        a.addCompletion { [weak self] _ in
            guard let self = self else { return }
            if go {
                /* 넘어갔다 — 떠난 화면을 걷고, 목적지 판은 웹이 다 그릴 때까지
                   둔다(`rendered`). */
                _ = self.popPlate()
                d.exit.removeFromSuperview()
                self.settling = d
                self.onBack?("commit")
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                    if self?.settling === d { self?.rendered() }
                }
            } else {
                d.under.removeFromSuperview(); d.dim.removeFromSuperview(); d.exit.removeFromSuperview()
                /* 판은 도로 제자리로 — 다음 손짓에 또 쓴다. */
                d.under.transform = .identity
                self.onBack?("cancel")
            }
        }
        a.startAnimation()
    }

    /** 웹이 목적지를 다 그렸다 — 깔아 둔 판을 걷는다. */
    func rendered() {
        if #available(iOS 26.0, *), usesSystemWebNavigation {
            systemClearCover()
            return
        }
        guard let d = settling else { return }
        settling = nil
        d.under.removeFromSuperview(); d.dim.removeFromSuperview()
    }
}
