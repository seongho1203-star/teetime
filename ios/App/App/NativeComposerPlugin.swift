import Foundation
import UIKit
import Capacitor

/*
 * 네이티브 글칸을 웹에 이어 주는 다리. 하는 일이 넷뿐이다 —
 * **바를 세우고 · 글을 주고받고 · 초점을 여닫고 · 높이를 알린다.**
 * 무엇을 어떻게 그릴지는 전부 웹이 정한다(`src/lib/composer.ts`).
 *
 * **바는 화면 아래에 늘 서 있는 보통 뷰이고, 아래를 `keyboardLayoutGuide`에
 * 묶는다.** 키보드가 오르내리면 iOS가 그 안내선을 **키보드와 같은
 * 움직임으로** 옮기므로 바가 키보드에 붙어 함께 간다 — 카톡이 부드러운
 * 까닭이 이것이다.
 *
 * **처음에는 `inputAccessoryView`였다. 되돌리지 말 것.** 그 방식은
 * first responder가 곧 생명줄이라, 눈에 안 보이는 `ComposerHost`가 늘
 * 그 자리를 쥐고 있어야 했다. 그런데 **대화 바탕을 한 번 누르기만 해도
 * 웹뷰가 first responder를 가져가** 바가 통째로 사라졌고(실기기 제보 —
 * `채팅 배경을 누르면 아예 사라져`), 되받으면 이번엔 **탭바 밑에서 다시
 * 솟아오르는 것**이 그대로 보였다(`탭바를 덮으면서 올라와`). 게다가 세운
 * 직후에는 바가 창에 아직 안 붙어 있어 `becomeFirstResponder()`가 조용히
 * 실패했다(댓글 칸에서 키보드가 안 뜬 자리). 보통 뷰로 세우면 셋이 다
 * 없다 — 누가 first responder든 바는 그 자리에 있고, 세우자마자 초점도 준다.
 *
 * `pause`/`resume`은 그때의 자국이라 **이제 아무 일도 안 한다.** 옛 웹이
 * 아직 부르므로 이름만 남겨 둔다.
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
 * `ready()`가 돌려주는 `v`가 이 판의 번호다 — 웹이 그걸 보고 옛 판
 * (`inputAccessoryView`)과 새 판의 여백 셈을 가른다(`html.nc2`).
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

    /// 이 판의 번호. 바를 세우는 방식이 바뀌면 올린다(웹이 `html.nc2`로 가른다).
    private static let version = 2

    private var bar: ComposerBar?
    /// 붙어 있는가. 떼어 낸 뒤에 오는 신호를 흘려보내는 데 쓴다.
    private var live = false

    // ── 웹이 부르는 것들 ──────────────────────────────────

    /// 플러그인이 있는지 물어보는 자리. `v`는 판 번호다.
    @objc func ready(_ call: CAPPluginCall) {
        call.resolve(["ok": true, "v": NativeComposerPlugin.version])
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

            if bar.superview !== root {
                bar.removeFromSuperview()
                root.addSubview(bar)
                self.pin(bar, to: root)
            }

            self.apply(call, on: bar)
            self.live = true
            /* 세우자마자 자리를 잡아 둔다 — 그래야 `height`가 곧바로 웹에
               가고, 아래 초점 주기도 창에 붙은 바에서 돈다. */
            root.layoutIfNeeded()
            /* `focus: true`면 세우면서 바로 글칸에 초점을 준다 — 댓글 칸이
               그렇게 쓴다(누른 그 순간 키보드가 올라와야 한다). */
            if call.getBool("focus") == true { self.grabFocus(tries: 8) }
            call.resolve()
        }
    }

    /**
     * 바를 화면에 묶는다 — 가로는 꽉 채우고, **아래는 키보드 위**다.
     *
     * iOS 15부터는 `keyboardLayoutGuide`가 그 자리를 안다. 키보드가 없으면
     * 그 윗선이 안전 영역 아래와 같고, 올라오면 키보드 윗선이 되며,
     * 오르내릴 때 iOS가 키보드와 **같은 움직임으로** 옮긴다.
     * 그 아래 판에서는 안전 영역에 묶고 키보드 알림을 듣고 손으로 올린다
     * (`ComposerBar.bottomC`).
     */
    private func pin(_ bar: ComposerBar, to root: UIView) {
        var cs = [
            bar.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: root.trailingAnchor),
        ]
        if #available(iOS 15.0, *) {
            cs.append(bar.bottomAnchor.constraint(equalTo: root.keyboardLayoutGuide.topAnchor))
        } else {
            let c = bar.bottomAnchor.constraint(equalTo: root.safeAreaLayoutGuide.bottomAnchor)
            bar.bottomC = c
            cs.append(c)
        }
        NSLayoutConstraint.activate(cs)
    }

    @objc func detach(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.live = false
            _ = self.bar?.textView.resignFirstResponder()
            self.bar?.removeFromSuperview()
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
            self.grabFocus(tries: 8)
            call.resolve()
        }
    }

    /**
     * 초점을 준다. 바가 보통 뷰라 세우자마자 창에 붙어 있으므로 대개
     * 한 번에 되는데, `becomeFirstResponder()`가 거절하는 판(다른 것이
     * 놓아 주는 중)이 있어 값이 싼 되풀이를 남겨 둔다.
     */
    private func grabFocus(tries: Int) {
        guard self.live, let bar = self.bar else { return }
        if bar.textView.isFirstResponder { return }
        if bar.textView.becomeFirstResponder() { return }
        guard tries > 0 else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            self.grabFocus(tries: tries - 1)
        }
    }

    /// 키보드만 내린다. 바는 보통 뷰라 그대로 서 있다.
    @objc func blur(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            _ = self.bar?.textView.resignFirstResponder()
            call.resolve()
        }
    }

    /// 옛 웹이 부르던 것. 이제 할 일이 없다(머리말 참고).
    @objc func pause(_ call: CAPPluginCall) { call.resolve() }
    @objc func resume(_ call: CAPPluginCall) { call.resolve() }

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
        /* **글자 색은 `fg`다. `text`가 아니다.** 예전에는 색도 `text`로
           받았는데 그 이름은 **글 내용**이 이미 쓰고 있어서, 겉모습만
           보내는 `attach`가 **글칸에 색 코드(`#1b1f19`)를 써 넣었다**
           (실기기에서 그대로 보였다). 이름을 갈라 두 번 다시 안 겹치게
           했다 — `src/lib/composer.ts`의 `composerSkin()`과 한 쌍이다. */
        if let v = c("fg") { bar.cText = v }
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
        /* 글 내용. 댓글 칸이 바를 세울 때 적어 둔 글을 실어 보낸다
           (대화는 안 보내므로 그대로 남는다). 위 `fg` 주석 참고. */
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
        notifyListeners("focus", data: ["on": on])
    }

    func composerResized(_ height: Double) {
        guard live else { return }
        notifyListeners("height", data: ["height": height])
    }
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
