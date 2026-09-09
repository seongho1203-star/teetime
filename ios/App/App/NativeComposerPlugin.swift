import Foundation
import UIKit
import PhotosUI
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
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickPhoto", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "savePhoto", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sharePhoto", returnType: CAPPluginReturnPromise)
    ]

    /// 이 판의 번호. 바를 세우는 방식이 바뀌면 올린다(웹이 `html.nc2`로 가른다).
    /// 3판 — 초점을 붙들어 두기(`holdFocus`)와 키보드 시각 알림(`kb`)이 들어갔다.
    /// 4판 — 바가 그려지는 자리를 프레임마다 알린다(`frame`).
    /// 5판 — 그 신호에 화면 높이·여백을 자리 하나에서 셈해 실어 보낸다(`chatH`·`pad`).
    /// 6판 — 그 신호를 **늘** 보낸다(웹이 다른 셈을 아예 안 쓴다) · 바를 살려 두어
    ///       다시 세우는 것이 빠르다.
    /// 7판 — 감춰 둘 수 있다(`hidden`). 댓글이 바를 미리 세워 두는 데 쓴다.
    /// 8판 — 사진을 앱이 고르고·저장하고·공유한다(`pickPhoto`·`savePhoto`·`sharePhoto`).
    /// 9판 — 고르는 창을 `+` 옆에 작게 붙이고, 저장은 **끝난 뒤에** 답한다.
    /// 10판 — 사진을 곱게 줄인다(`interpolationQuality = .high`).
    /// 11판 — 크기를 1600px으로 되돌렸다. 2560px으로 키웠더니 **사진이
    ///        아예 안 올라갔다**(사용자 제보). 웹도 같은 값이다.
    /// 12판 — 고르는 창이 **닫힌 뒤에** 보관함·카메라를 띄운다(`afterSheet`).
    ///        9~11판에서는 닫히는 중에 띄워 iOS가 조용히 무시했고,
    ///        **보관함도 카메라도 아무 일이 안 일어났다**(사용자 제보).
    ///        막히면 까닭(`why`)을 실어 답하므로 웹이 알릴 수 있다.
    ///        **웹은 12판부터만 앱 창을 쓴다** — 그 사이 판은 웹 칸으로
    ///        물러난다(`Chat.tsx`의 `photo`).
    ///
    /// **기능을 더하면 반드시 올릴 것.** `hidden`을 6판에 슬쩍 더했다가,
    /// 그 값을 모르는 옛 6판 앱에도 웹이 `감춰라`를 보내 **바가 그냥 보였다.**
    /// 웹은 이 번호 하나로 앱이 무엇을 아는지 가린다.
    private static let version = 12

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

    // ── 사진 (8판) ───────────────────────────────────────
    //
    // **왜 앱이 맡는가.** 예전에는 웹의 `<input type="file">`을 눌러
    // 열었는데, `+`가 **앱의 단추**라 웹에는 누른 자리가 없다 — iOS는
    // 고르는 창을 '그 칸이 있는 자리'에 붙이므로 붙일 데를 못 찾고
    // **화면 아무 데나 띄웠다**(사용자 제보 · 사진 두 장. 칸을 화면 아래에
    // 44px로 두어도 안 봤다). 앱이 직접 띄우면 그런 자리가 아예 없다.
    //
    // 덤으로 **사진 저장·공유**도 여기서 한다. 웹으로는 `<a download>`가
    // 앱 안에서 안 먹고 새 창은 사파리로 나가 버린다.

    /// 사진을 고르는 동안 들고 있는 약속. 한 번에 하나뿐이다.
    private var pickCall: CAPPluginCall?
    /// 보관함·카메라를 띄우는 중인가. 고르는 창이 닫히는 것을 **취소로 잘못
    /// 읽지 않으려고** 둔 표다(아래 `...DidDismissPopover` 참고).
    private var pickGoing = false

    /**
     * 사진을 고른다 — **아래에서 올라오는 앱 창**이라 자리가 어긋날 수 없다.
     *
     * 사진 보관함은 `PHPickerViewController`다. **권한을 안 묻는 것이
     * 이것을 고른 까닭이다** — 앱 밖에서 도는 창이라 고른 한 장만 건네준다.
     * 사진 찍기만 `NSCameraUsageDescription`이 필요하다(Info.plist).
     *
     * 돌려주는 것은 **이미 줄인 JPEG**(긴 변 1600 · 품질 0.82)를 base64로
     * 담은 것이다 — 웹의 `lib/image.ts`와 같은 값이라 받는 쪽이 그대로 올린다.
     */
    @objc func pickPhoto(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else { call.reject("no vc"); return }
            self.pickCall?.resolve(["ok": false])      // 겹쳐 불리면 앞엣것은 닫는다
            self.pickCall = call
            self.pickGoing = false

            let sheet = UIAlertController(title: nil, message: nil, preferredStyle: .actionSheet)
            sheet.addAction(UIAlertAction(title: "사진 보관함", style: .default) { _ in
                self.pickGoing = true
                self.afterSheet(vc) { self.openLibrary(vc) }
            })
            if UIImagePickerController.isSourceTypeAvailable(.camera) {
                sheet.addAction(UIAlertAction(title: "사진 찍기", style: .default) { _ in
                    self.pickGoing = true
                    self.afterSheet(vc) { self.openCamera(vc) }
                })
            }
            sheet.addAction(UIAlertAction(title: "취소", style: .cancel) { _ in
                self.finishPick(nil)
            })
            /* **`+` 바로 위에 조그맣게 띄운다**(9판 · 사용자 요청 —
               `좌측하단으로 옮겨주고 버튼 크기도 좀 작게`). 그냥 두면
               아이폰에서 화면 아래를 가로지르는 큰 창이 된다.
               팝오버로 붙이면 누른 자리에 작은 카드로 서는데, 아이폰은
               기본으로 그걸 다시 큰 창으로 바꾸므로 **`delegate`가
               `.none`을 돌려줘야** 작은 채로 남는다.
               붙일 자리가 없으면 그대로 죽으므로 바가 없을 때의 예비
               자리(왼쪽 아래)도 함께 둔다. */
            if let pop = sheet.popoverPresentationController {
                if let bar = self.bar, bar.superview != nil {
                    pop.sourceView = bar
                    pop.sourceRect = bar.plusBtn.frame
                } else {
                    pop.sourceView = vc.view
                    pop.sourceRect = CGRect(x: 16, y: vc.view.bounds.maxY - 96,
                                            width: 44, height: 44)
                }
                pop.permittedArrowDirections = .down
                pop.delegate = self
            }
            vc.present(sheet, animated: true)
        }
    }

    /**
     * 고르는 창이 **완전히 닫힌 뒤에** 다음 창을 띄운다.
     *
     * **9판에서 사진이 통째로 안 올라가던 자리다**(사용자 제보 —
     * `보관함하고 찍는 것도 둘 다 안돼`). 그 창을 팝오버로 바꾸면서
     * 닫히는 방식이 달라졌는데, **아직 닫히는 중인 화면 위에
     * `present`를 부르면 iOS가 조용히 무시한다** — 창은 떴고 눌리기도
     * 하는데 그다음에 아무 일도 안 일어나므로, 밖에서는 고장 난 데를
     * 짚을 수가 없다.
     *
     * 닫힐 때까지 몇 프레임 기다렸다 띄우고, **1초를 기다려도 안 닫히면
     * 까닭을 실어 약속을 닫는다** — 열어 둔 채 두면 웹은 영영 기다린다.
     */
    private func afterSheet(_ vc: UIViewController, tries: Int = 20,
                            _ go: @escaping () -> Void) {
        if vc.presentedViewController == nil { go(); return }
        guard tries > 0 else {
            finishPick(nil, why: "고르는 창을 못 띄웠습니다")
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            self.afterSheet(vc, tries: tries - 1, go)
        }
    }

    private func openLibrary(_ vc: UIViewController) {
        var cfg = PHPickerConfiguration()
        cfg.filter = .images
        cfg.selectionLimit = 1
        let p = PHPickerViewController(configuration: cfg)
        p.delegate = self
        vc.present(p, animated: true)
    }

    private func openCamera(_ vc: UIViewController) {
        let p = UIImagePickerController()
        p.sourceType = .camera
        p.delegate = self
        vc.present(p, animated: true)
    }

    /**
     * 고르기가 끝났다(취소도 여기로 온다). **약속은 반드시 한 번 닫는다.**
     *
     * **`why`가 붙어 오면 고장이다** — 취소는 까닭 없이 온다. 웹이 그 둘을
     * 갈라, 고장일 때만 문구를 띄우고 웹 칸으로 물러난다(`Chat.tsx`의 `photo`).
     */
    fileprivate func finishPick(_ image: UIImage?, why: String? = nil) {
        pickGoing = false
        guard let call = pickCall else { return }
        pickCall = nil
        guard let image = image else {
            var out: [String: Any] = ["ok": false]
            if let why = why { out["why"] = why }
            call.resolve(out)
            return
        }
        guard let b64 = NativeComposerPlugin.jpegBase64(image) else {
            call.resolve(["ok": false, "why": "사진을 못 읽었습니다"])
            return
        }
        call.resolve(["ok": true, "data": b64])
    }

    /**
     * 줄여서 JPEG base64로. **웹의 `lib/image.ts`와 같은 값이다**
     * (긴 변 1600 · 품질 0.82) — 한쪽만 고치면 **어느 길로 올렸느냐에
     * 따라 사진 화질이 갈린다**(8판부터 앱에서 고른 사진은 이리로 온다).
     * `UIImage.draw`가 사진의 방향까지 바로잡아 그린다.
     *
     * **`interpolationQuality = .high`를 빼지 말 것** — 크게 줄일 때
     * 계단이 지고 잔무늬가 생긴다. 웹 쪽 `imageSmoothingQuality`와
     * 같은 몫이고, 거기서는 그 잡티 때문에 **파일이 되레 커졌다.**
     */
    fileprivate static func jpegBase64(_ image: UIImage,
                                       maxEdge: CGFloat = 1600,
                                       quality: CGFloat = 0.82) -> String? {
        let w = image.size.width, h = image.size.height
        guard w > 0, h > 0 else { return nil }
        let k = min(1, maxEdge / max(w, h))
        let size = CGSize(width: floor(w * k), height: floor(h * k))
        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.scale = 1
        let out = UIGraphicsImageRenderer(size: size, format: fmt).image { ctx in
            ctx.cgContext.interpolationQuality = .high
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        return out.jpegData(compressionQuality: quality)?.base64EncodedString()
    }

    /// 주소에서 사진을 받아 온다. 저장·공유가 같이 쓴다.
    private func fetch(_ call: CAPPluginCall, _ done: @escaping (UIImage) -> Void) {
        guard let s = call.getString("url"), let url = URL(string: s) else {
            call.reject("no url"); return
        }
        URLSession.shared.dataTask(with: url) { data, _, _ in
            guard let data = data, let img = UIImage(data: data) else {
                DispatchQueue.main.async { call.resolve(["ok": false]) }
                return
            }
            DispatchQueue.main.async { done(img) }
        }.resume()
    }

    /// 저장이 끝나기를 기다리는 약속. 한 번에 하나뿐이다.
    private var saveCall: CAPPluginCall?

    /**
     * 사진첩에 저장한다. `NSPhotoLibraryAddUsageDescription`이 필요하다.
     *
     * **끝난 뒤에 답한다** — 예전에는 넣자마자 `ok`로 답했는데, 그러면
     * 권한을 거절당해 **정말로 안 저장된 때도 `저장했습니다`가 떴다.**
     * 저장은 몇 초가 걸리기도 해서 이 기다림이 곧 화면의 `저장 중…`이다.
     */
    @objc func savePhoto(_ call: CAPPluginCall) {
        fetch(call) { img in
            self.saveCall?.resolve(["ok": false])   // 겹쳐 불리면 앞엣것은 닫는다
            self.saveCall = call
            UIImageWriteToSavedPhotosAlbum(
                img, self,
                #selector(self.image(_:didFinishSavingWithError:contextInfo:)), nil)
        }
    }

    @objc private func image(_ image: UIImage,
                             didFinishSavingWithError error: Error?,
                             contextInfo: UnsafeRawPointer?) {
        let call = saveCall
        saveCall = nil
        call?.resolve(["ok": error == nil])
    }

    /// 폰이 띄워 주는 공유창에 넘긴다.
    @objc func sharePhoto(_ call: CAPPluginCall) {
        fetch(call) { img in
            guard let vc = self.bridge?.viewController else { call.resolve(["ok": false]); return }
            let av = UIActivityViewController(activityItems: [img], applicationActivities: nil)
            if let pop = av.popoverPresentationController {
                pop.sourceView = vc.view
                pop.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.maxY - 1,
                                        width: 1, height: 1)
                pop.permittedArrowDirections = []
            }
            vc.present(av, animated: true)
            call.resolve(["ok": true])
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

/**
 * 사진 고르는 창들이 답을 주는 자리(8판).
 *
 * **어느 길이든 `finishPick`으로 모인다** — 취소도 거기로 온다. 약속을
 * 한 번은 반드시 닫아야 웹 쪽 `await`가 안 걸린다.
 */
extension NativeComposerPlugin: PHPickerViewControllerDelegate,
                                UIImagePickerControllerDelegate,
                                UINavigationControllerDelegate {

    public func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let item = results.first?.itemProvider,
              item.canLoadObject(ofClass: UIImage.self) else {
            finishPick(nil)
            return
        }
        item.loadObject(ofClass: UIImage.self) { obj, _ in
            DispatchQueue.main.async { self.finishPick(obj as? UIImage) }
        }
    }

    public func imagePickerController(_ picker: UIImagePickerController,
                                      didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        picker.dismiss(animated: true)
        finishPick(info[.originalImage] as? UIImage)
    }

    public func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true)
        finishPick(nil)
    }
}

/**
 * 고르는 창을 **`+` 옆에 작게** 붙여 두는 자리(9판).
 *
 * 아이폰은 팝오버를 기본으로 큰 창(`.fullScreen`)으로 바꿔 버린다 —
 * `.none`을 돌려줘야 누른 자리에 작은 카드로 남는다.
 *
 * **작은 카드에서는 iOS가 `취소` 줄을 스스로 뺀다.** 바탕을 눌러 닫는
 * 것이 그 자리를 대신하는데, 그때는 아무 손잡이도 안 불려 **약속이 영영
 * 안 닫힌다** — 그래서 닫히는 것을 여기서 받아 `finishPick(nil)`을 부른다.
 *
 * **다만 '보관함·카메라를 누른 것'과 갈라야 한다**(12판). 그때도 이 창은
 * 닫히는데, 그걸 취소로 읽어 약속을 닫아 버리면 **정작 고른 사진이 갈
 * 데가 없어진다** — 아무 일도 안 일어난 것처럼 보인다. `pickGoing`이
 * 그 둘을 가른다.
 */
extension NativeComposerPlugin: UIPopoverPresentationControllerDelegate {

    public func adaptivePresentationStyle(for controller: UIPresentationController)
        -> UIModalPresentationStyle { return .none }

    public func popoverPresentationControllerDidDismissPopover(
        _ popoverPresentationController: UIPopoverPresentationController) {
        if pickGoing { return }     // 다음 창을 띄우는 중이다 — 취소가 아니다
        finishPick(nil)
    }
}
