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
    /// 3판 — 초점을 붙들어 두기(`holdFocus`)와 키보드 시각 알림(`kb`)이 들어갔다.
    /// 4판 — 바가 그려지는 자리를 프레임마다 알린다(`frame`).
    /// 5판 — 그 신호에 화면 높이·여백을 자리 하나에서 셈해 실어 보낸다(`chatH`·`pad`).
    /// 6판 — 그 신호를 **늘** 보낸다(웹이 다른 셈을 아예 안 쓴다) · 바를 살려 두어
    ///       다시 세우는 것이 빠르다.
    private static let version = 6

    /// 초점을 준 뒤 **놓지 않고 붙들어 두는 시간**(`ComposerBar.holdFocus`).
    /// 웹뷰가 도로 가져가는 것은 손을 떼는 그 순간이라 이만큼이면 넉넉하다.
    private static let holdFor = 0.8

    private var bar: ComposerBar?
    /// 붙어 있는가. 떼어 낸 뒤에 오는 신호를 흘려보내는 데 쓴다.
    private var live = false
    /// 붙들어 두기가 몇 번째인가. 겹쳐 불려도 **늦게 부른 쪽**이 이긴다.
    private var holdSeq = 0

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
            bar.announce()          // 지난번과 높이가 같아도 한 번은 알린다
            /* `focus: true`면 세우면서 바로 글칸에 초점을 준다 — 댓글 칸이
               그렇게 쓴다(누른 그 순간 키보드가 올라와야 한다). */
            if call.getBool("focus") == true { self.grabFocus(tries: 10) }
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
            self.release()
            _ = self.bar?.textView.resignFirstResponder()
            self.bar?.removeFromSuperview()
            /* **바는 버리지 않는다 — 다음에 다시 쓴다.**
               `UITextView`를 만드는 것이 만만치 않아서, 댓글 칸을 누를
               때마다 새로 만들면 바가 뜨기까지 50ms가 걸렸다(실기기 진단 —
               `누름 0` → `바 51`). 화면에서 떼어 두기만 하면 다음 `attach`는
               다시 붙이고 값만 갈아 끼우면 된다.
               `barDelegate`는 그대로 둔다 — 떼어 낸 뒤 오는 신호는 `live`가
               막는다(그러라고 있는 값이다). */
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
            /* `focus: true`면 여기서도 초점을 준다 — 댓글 칸이 미리 세워 둔
               바를 내보이면서 한 번에 쓴다(다리를 한 번만 건넌다). */
            if call.getBool("focus") == true {
                bar.announce()
                self.grabFocus(tries: 10)
            }
            call.resolve()
        }
    }

    @objc func focus(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.grabFocus(tries: 10)
            call.resolve()
        }
    }

    /**
     * 초점을 준다 — **주고 나서 잠깐 붙들어 둔다.**
     *
     * 바가 보통 뷰라 세우자마자 창에 붙어 있어 `becomeFirstResponder()`는
     * 대개 한 번에 되는데, **아이폰은 손을 떼는 순간 웹뷰가 first
     * responder를 도로 가져간다.** 웹 칸을 누른 것이 아니어도 그렇고,
     * 웹의 `preventDefault`는 그 요소의 초점만 막지 웹뷰가 가져가는 것은
     * 못 막는다.
     *
     * **뺏긴 뒤에 되찾는 길로 가지 말 것.** 처음에는 0.08초마다 살펴보다
     * 없으면 다시 잡게 두었는데, 그러면 키보드가 **올라오다 내려갔다 다시
     * 올라온다**(실기기 제보 — `키보드가 나오다 중간에 다시 내려갔다가
     * 다시 올라와`). 지금은 `holdFocus`로 **놓는 것 자체를 막는다**
     * (`ComposerBar.textViewShouldEndEditing`) — 뺏길 일이 없으니
     * 되찾을 일도 없다.
     *
     * 되풀이가 남아 있는 것은 **주는 쪽**뿐이다 — 다른 것이 놓아 주는 중이라
     * `becomeFirstResponder()`가 한 번 거절하는 판이 있다.
     * (`Comments.tsx`의 `openBar`가 웹에서도 같은 일을 한다 — `holdFocus`가
     * 없는 옛 앱 몫이다. **한쪽만 고치지 말 것.**)
     */
    private func grabFocus(tries: Int) {
        guard self.live, let bar = self.bar else { return }
        holdSeq += 1
        let mine = holdSeq
        bar.holdFocus = true
        DispatchQueue.main.asyncAfter(deadline: .now() + NativeComposerPlugin.holdFor) {
            // 그 사이 또 불렸으면 그쪽이 풀 몫이다.
            guard mine == self.holdSeq else { return }
            self.bar?.holdFocus = false
        }
        tryFocus(tries: tries)
    }

    /// 초점이 갈 때까지 몇 번 더 해 본다. **이미 있으면 아무 일도 안 한다.**
    private func tryFocus(tries: Int) {
        guard self.live, let bar = self.bar else { return }
        if bar.textView.isFirstResponder { return }
        _ = bar.textView.becomeFirstResponder()
        guard tries > 0 else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            self.tryFocus(tries: tries - 1)
        }
    }

    /// 붙들어 두기를 푼다. **우리가 초점을 뗄 때는 반드시 먼저 부른다** —
    /// 안 풀면 `textViewShouldEndEditing`이 우리 것까지 막는다.
    private func release() {
        holdSeq += 1
        bar?.holdFocus = false
    }

    /// 키보드만 내린다. 바는 보통 뷰라 그대로 서 있다.
    @objc func blur(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.release()
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

        /* **감춰 둘 수 있다**(6판). 댓글 칸은 화면이 뜰 때 바를 미리 세워
           감춰 두었다가, 누를 때 이 값만 뒤집는다 — 그때 만들면 바가 서기까지
           50ms가 걸린다(진단 — `누름 0` → `바 51`). 감춘 뷰는 초점을 못 받으므로
           **여기서 먼저 내보이고 그다음에 초점을 준다**(부르는 차례가 곧 그것이다). */
        if let v = call.getBool("hidden") { bar.isHidden = v }

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

    func composerResized(_ height: Double, y: Double, fr: Bool, kb: Bool) {
        guard live else { return }
        notifyListeners("height", data: ["height": height, "y": y, "fr": fr, "kb": kb])
    }

    /// 키보드가 움직이기 시작했다. **시각을 함께 보낸다** — 웹이 얼마나 늦게
    /// 받았는지를 재서 남은 시간만큼만 움직이게 하려는 것이다
    /// (`ComposerBar.composerKeyboard` 주석 · `Chat.tsx`의 `kb` 듣기).
    func composerKeyboard(on: Bool, dur: Double, at: Double) {
        guard live else { return }
        notifyListeners("kb", data: ["on": on, "dur": dur, "at": at])
    }

    /// 키보드가 움직이는 동안 바가 그려지는 자리(프레임마다 · 4판).
    func composerFrame(bottom: Double, h: Double, p: Double, end: Bool,
                       chatH: Double, pad: Double) {
        guard live else { return }
        notifyListeners("frame", data: ["bottom": bottom, "h": h, "p": p, "end": end,
                                        "chatH": chatH, "pad": pad])
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
