import Foundation
import UIKit
import Capacitor

/*
 * 네이티브 글칸을 웹에 이어 주는 다리. 하는 일이 넷뿐이다 —
 * **바를 세우고 · 글을 주고받고 · 초점을 여닫고 · 높이를 알린다.**
 * 무엇을 어떻게 그릴지는 전부 웹이 정한다(`src/lib/composer.ts`).
 *
 * **바는 `inputAccessoryView`다.** 그래야 iOS가 키보드와 **한 번의
 * 움직임으로 함께** 옮긴다 — 카톡이 부드러운 까닭이 이것이고, 웹뷰
 * 안에서는 아무리 맞춰도 안 되던 자리다.
 *
 * 키보드가 내려가 있을 때도 바가 화면 아래에 그대로 서 있어야 하므로,
 * **눈에 안 보이는 `ComposerHost`가 늘 first responder를 쥐고 있다가**
 * 글칸이 초점을 놓으면 도로 받는다. 이 되받기가 없으면 키보드를 내릴
 * 때마다 바가 함께 사라진다.
 *
 * **웹의 다른 칸(대화 검색 등)이 초점을 가져가면 잠시 물러난다**
 * (`pause`/`resume`) — 그때는 웹뷰가 first responder라 우리 바가 저절로
 * 사라지는데, 물러나 두지 않으면 서로 first responder를 뺏느라 다툰다.
 *
 * **손으로 등록해야 불린다 — `MainViewController.swift`가 그 자리다.**
 * Capacitor 7은 런타임을 훑지 않고 `capacitor.config.json`의
 * `packageClassList`(npm 꾸러미에서 나온 목록)만 읽는다. 앱 안에 넣어 둔
 * Swift는 거기 없으므로 **등록 줄이 없으면 영영 안 불린다** — 첫판이
 * 실제로 여기서 통째로 막혔다. 그래서 `CAPPlugin`이 아니라
 * `CAPInstancePlugin`이다(다리가 스스로 만들지 않는 갈래).
 *
 * **플러그인이 없는 판에서도 앱은 그대로 돈다.** 웹이 `ready()`를 한 번
 * 불러 보고 안 되면 예전 웹 글칸을 그대로 쓴다 — 앱은 새로 만들어 깔기까지
 * 시간이 걸리는데 웹은 밀면 바로 올라가므로, 그 사이가 늘 생긴다.
 */
@objc(NativeComposerPlugin)
public class NativeComposerPlugin: CAPInstancePlugin, CAPBridgedPlugin, ComposerBarDelegate {

    public let identifier = "NativeComposerPlugin"
    public let jsName = "NativeComposer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "ready", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "attach", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "detach", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setText", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getText", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "focus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "blur", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise)
    ]

    private var host: ComposerHost?
    private var bar: ComposerBar?
    /// 붙어 있는가. 떼어 낸 뒤에 오는 신호를 흘려보내는 데 쓴다.
    private var live = false
    /// 웹의 다른 칸에 자리를 내주고 물러나 있는가(`pause`/`resume`).
    private var paused = false

    // ── 웹이 부르는 것들 ──────────────────────────────────

    /// 플러그인이 있는지 물어보는 자리. 값은 아무 뜻이 없다.
    @objc func ready(_ call: CAPPluginCall) {
        call.resolve(["ok": true])
    }

    @objc func attach(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let root = self.bridge?.viewController?.view else {
                call.reject("no view")
                return
            }
            let bar = self.bar ?? ComposerBar(frame: CGRect(x: 0, y: 0, width: root.bounds.width, height: 58))
            bar.barDelegate = self
            self.bar = bar

            let host = self.host ?? ComposerHost(frame: .zero)
            host.bar = bar
            if host.superview == nil { root.addSubview(host) }
            self.host = host

            self.apply(call, on: bar)
            self.live = true
            _ = host.becomeFirstResponder()
            call.resolve()
        }
    }

    @objc func detach(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.live = false
            _ = self.bar?.textView.resignFirstResponder()
            _ = self.host?.resignFirstResponder()
            self.host?.removeFromSuperview()
            self.host = nil
            self.bar?.barDelegate = nil
            self.bar = nil
            call.resolve()
        }
    }

    @objc func setText(_ call: CAPPluginCall) {
        let t = call.getString("text") ?? ""
        let sel = call.getInt("sel")
        DispatchQueue.main.async {
            guard let bar = self.bar else { call.resolve(); return }
            bar.text = t
            if let sel = sel { bar.caret = sel }
            call.resolve()
        }
    }

    @objc func getText(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["text": self.bar?.text ?? ""])
        }
    }

    /// 겉모습과 켜짐만 바꾼다. 보낸 칸만 고친다 — 안 보낸 것은 그대로다.
    @objc func setState(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let bar = self.bar else { call.resolve(); return }
            self.apply(call, on: bar)
            call.resolve()
        }
    }

    @objc func focus(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            _ = self.bar?.textView.becomeFirstResponder()
            call.resolve()
        }
    }

    /// 키보드만 내린다. **바는 그대로 서 있어야 하므로** 곧바로
    /// host가 first responder를 되받는다.
    @objc func blur(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            _ = self.bar?.textView.resignFirstResponder()
            if self.live { _ = self.host?.becomeFirstResponder() }
            call.resolve()
        }
    }

    /// 웹의 다른 칸이 초점을 가져갈 때. 바가 사라지고 우리는 손을 뗀다.
    @objc func pause(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.paused = true
            _ = self.bar?.textView.resignFirstResponder()
            _ = self.host?.resignFirstResponder()
            call.resolve()
        }
    }

    @objc func resume(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.paused = false
            if self.live { _ = self.host?.becomeFirstResponder() }
            call.resolve()
        }
    }

    // ── 값 옮겨 담기 ─────────────────────────────────────

    /**
     * 웹이 보낸 값을 바에 옮겨 담는다. **보낸 칸만 고친다** — 안 보낸
     * 것은 그대로 남는다(그래서 `setState`로 하나만 바꿀 수 있다).
     *
     * 하나씩 `call.getXxx`로 꺼낸다 — `options`를 통째로 형변환하면
     * Capacitor 판이 바뀔 때 조용히 깨진다.
     */
    private func apply(_ call: CAPPluginCall, on bar: ComposerBar) {
        func n(_ k: String) -> CGFloat? {
            guard let v = call.getDouble(k) else { return nil }
            return CGFloat(v)
        }
        func c(_ k: String) -> UIColor? {
            guard let s = call.getString(k) else { return nil }
            return UIColor(hexString: s)
        }

        if let v = n("padV") { bar.padV = v }
        if let v = n("padH") { bar.padH = v }
        if let v = n("gap") { bar.gap = v }
        if let v = n("tabH") { bar.tabH = v }
        if let v = n("minH") { bar.minH = v }
        if let v = n("maxH") { bar.maxH = v }
        if let v = n("plusW") { bar.plusW = v }
        if let v = n("sendW") { bar.sendW = v }
        if let v = n("iconW") { bar.iconW = v }
        if let v = n("fontSize") { bar.fontSize = v }
        if let v = n("radius") { bar.radius = v }

        if let v = c("bg") { bar.cBg = v }
        if let v = c("field") { bar.cField = v }
        if let v = c("text") { bar.cText = v }
        if let v = c("hint") { bar.cHint = v }
        if let v = c("dim") { bar.cDim = v }
        if let v = c("brand") { bar.cBrand = v }
        if let v = c("onBrand") { bar.cOnBrand = v }
        if let v = c("offBg") { bar.cOffBg = v }
        if let v = c("offFg") { bar.cOffFg = v }
        if let v = c("line") { bar.cLine = v }

        if let v = call.getString("hintText") { bar.setHint(v) }
        if let v = call.getBool("showIcon") { bar.showIcon = v }
        if let v = call.getBool("showPlus") { bar.showPlus = v }
        if let v = call.getBool("tray") { bar.setTray(v) }
        if let v = call.getBool("forceSend") { bar.forceSend = v }
        if let v = call.getString("text") { bar.text = v }

        bar.paint()
        bar.setNeedsLayout()
        bar.invalidateIntrinsicContentSize()
    }

    // ── 바가 알려 오는 것들 ───────────────────────────────

    func composerChanged(text: String, sel: Int) {
        guard live else { return }
        notifyListeners("change", data: ["text": text, "sel": sel])
    }

    func composerSend(text: String) {
        guard live else { return }
        notifyListeners("send", data: ["text": text])
    }

    func composerTapped(_ name: String) {
        guard live else { return }
        notifyListeners("action", data: ["name": name])
    }

    func composerFocus(_ on: Bool) {
        guard live else { return }
        /* 글칸이 초점을 놓으면 **host가 도로 받아** 바를 화면에 남긴다.
         *
         * **조금 기다렸다 받는다.** 웹의 다른 칸(대화 검색)을 눌렀을 때도
         * 이 신호가 먼저 오는데, 그때 곧바로 받아 버리면 **방금 초점이 간
         * 웹 칸에서 도로 뺏는다.** 웹이 `pause()`를 부르는 것은 그다음이라,
         * 그것이 닿을 만큼만 기다렸다가 물러나 있으면 그만둔다. */
        if !on {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                guard self.live, !self.paused, let host = self.host else { return }
                if !host.isFirstResponder { _ = host.becomeFirstResponder() }
            }
        }
        notifyListeners("focus", data: ["on": on])
    }

    func composerResized(_ height: Double) {
        guard live else { return }
        notifyListeners("height", data: ["height": height])
    }
}

/*
 * 눈에 안 보이는 자리 지킴이. **`inputAccessoryView`를 내놓는 것이
 * 이 뷰가 하는 일의 전부다** — 키보드가 내려가 있어도 바가 화면 아래에
 * 남아 있으려면 누군가는 first responder를 쥐고 있어야 한다.
 */
final class ComposerHost: UIView {
    var bar: ComposerBar?

    override var canBecomeFirstResponder: Bool { return true }
    override var inputAccessoryView: UIView? { return bar }

    /// 자리만 차지하고 눌리지 않는다.
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? { return nil }
}

extension UIColor {
    /// `#rrggbb` · `#rrggbbaa` · `#rgb`을 받는다. 못 알아보면 nil이다 —
    /// 그때는 예비 색이 그대로 남는다.
    convenience init?(hexString: String) {
        var s = hexString.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        if s.count == 3 {
            s = s.map { "\($0)\($0)" }.joined()
        }
        guard s.count == 6 || s.count == 8, let n = UInt64(s, radix: 16) else { return nil }
        let has = s.count == 8
        let r = CGFloat((n >> (has ? 24 : 16)) & 0xff) / 255
        let g = CGFloat((n >> (has ? 16 : 8)) & 0xff) / 255
        let b = CGFloat((n >> (has ? 8 : 0)) & 0xff) / 255
        let a = has ? CGFloat(n & 0xff) / 255 : 1
        self.init(red: r, green: g, blue: b, alpha: a)
    }
}
