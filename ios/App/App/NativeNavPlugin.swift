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
            l.push(ms: call.getDouble("ms") ?? 0, native: call.getBool("native") ?? false) { call.resolve() }
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

/// 위 주석의 그 층. `root`는 웹뷰를 화면으로 쓰는 Capacitor 화면이다.
final class NavLayer: NSObject, UIGestureRecognizerDelegate {
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
    /** 뒤에 깔린 앞 화면들 — 히스토리 한 칸에 하나. 탭으로 간 자리는 nil이다. */
    private var stack: [UIView?] = []
    private let maxStack = 5
    var armed = false { didSet { armPan() } }
    var free = true
    var onBack: ((String) -> Void)?

    init(root: UIViewController) { self.root = root; super.init() }

    /** 판을 까는 자리 — 화면 틀의 뷰. 틀이 없는 옛 껍데기에서는 웹뷰의 부모다. */
    private var host: UIView? { root?.navigationController?.view ?? root?.view.superview }
    private var web: UIView? { root?.view }
    private var chatUp: Bool { (root?.navigationController?.viewControllers.count ?? 1) > 1 }

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
    func push(ms: Double, native: Bool, done: @escaping () -> Void) {
        guard ms > 0 || native else { pushPlate(nil); done(); return }
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
        return free || edge
    }

    /** 손짓을 이번 손에서 통째로 접는다 — 껐다 켜면 그 자리에서 `.cancelled`가 온다. */
    private func dropPan(_ p: UIPanGestureRecognizer) { p.isEnabled = false; p.isEnabled = true }

    /**
     * 끌기를 시작한다. 지금 웹뷰를 찍어 맨 위에 얹고, 뒤에 깔린 앞 화면 판을
     * **웹뷰 위에** 깐다 — 웹뷰는 아직 이 화면을 그리고 있어서 판이 위에
     * 있어야 목적지가 보인다.
     */
    private func beginDrag() -> Bool {
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
                    guard canDrag(), beginDrag(), let nd = drag else { dropPan(p); return }
                    lastX = x; lastT = now; vx = 0
                    paint(nd, dx)
                } else if dy >= Self.WAKE, dy > dx {
                    dropPan(p)   /* 세로로 갔다 — 굴리기 몫이다 */
                }
                return
            }
            let dt = now - lastT
            if dt > 0 { vx = (x - lastX) / CGFloat(dt * 1000) }
            lastX = x; lastT = now
            paint(d, max(0, x - x0))
        case .ended:
            guard let d = drag else { return }
            let still = now - lastT > Self.STALE
            let flick = !still && vx > Self.FLICK && d.dx > Self.FLICK_MIN
            endDrag(go: d.dx > d.w * Self.TAKE || flick)
        case .cancelled, .failed:
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
        guard let d = settling else { return }
        settling = nil
        d.under.removeFromSuperview(); d.dim.removeFromSuperview()
    }
}
