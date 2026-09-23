import UIKit
import Capacitor

@objc(NativeChatPlugin)
public class NativeChatPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeChatPlugin"
    public let jsName = "NativeChat"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "session", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reset", returnType: CAPPluginReturnPromise)
    ]
    private var chat: NativeChatViewController?
    private var screen = ""
    /* **화면 틀에 얹었을 때 뒤에 까는 그림**(아래 `open` 참고).
       `UINavigationController`는 밀어 올린 화면 아래의 웹뷰를 **화면에서
       빼 버리므로**, 끌 때 뒤에 드러날 것이 한 장도 없다. 들어오기
       직전의 웹뷰를 찍어 그 자리에 깔아 둔다. */
    private var backdrop: UIView?

    @objc func open(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let config = NativeChatConfig(call.options as? ChatJSON ?? [:]), let screen = call.getString("screen"),
                  let root = self.bridge?.viewController else { call.reject("채팅을 열 수 없습니다."); return }
            if self.chat?.service.config.user != config.user { self.remove(clear: true) }
            let chat = self.chat ?? NativeChatViewController(service: NativeChatService(config))
            /* **다시 열 때 설정을 갈아 끼운다.** 화면은 한 번 만들면 다시
               쓰는데(글칸·굴린 자리를 지키려는 것이다) 예전에는 토큰만
               갱신해서 **맨 처음 열 때의 값이 그대로 굳었다** — 뒤에 깔
               앞 화면이 있는가(`back`)·어디까지 읽었나(`seen`)·남은
               움직임(`slide`)이 다 그때 것이라, 알림을 눌러 곧바로 들어온
               판에서 한 번 `back: false`가 되면 **그 뒤로 영영 끌리는 것
               없이 넘어갔다**(사용자 제보 — `끌기할때 뒷배경 안보임`). */
            self.chat = chat; self.screen = screen
            chat.service.config = config; chat.updateToken(config.token)
            chat.event = { [weak self] type, data in
                guard let self = self else { return }
                self.notifyListeners("event", data: ["screen": self.screen, "type": type, "data": data])
            }
            chat.service.authNeeded = { [weak self] in
                guard let self = self else { return }
                self.notifyListeners("event", data: ["screen": self.screen, "type": "auth", "data": [:]])
            }
            let fresh = chat.parent == nil
            let ms = call.getDouble("slide") ?? 0
            let pop = call.getDouble("pop") ?? 0
            /* **떠나는 화면은 대화 화면을 붙이기 _전에_ 찍는다.**
               `root.view`가 곧 웹뷰이고 대화 화면은 그 자식이라, 붙여 놓고
               찍으면 **그림 안에 대화 화면이 함께 들어간다** — 뒤로 오는데
               뒤에서 빠져나가는 것이 방금 들어온 화면이 되어 **엉뚱한
               화면이 보인다**(사용자 제보 — `되돌아올 때 뒷배경이 엉뚱한
               화면이 보이고`). 웹이 `.exit-ghost`로 깔아 둔 라운드·투표
               화면이 아직 혼자 있는 이 자리가 찍을 수 있는 유일한 때다. */
            let leaving = fresh && pop > 40 ? root.view.snapshotView(afterScreenUpdates: false) : nil
            /* **화면 틀(`UINavigationController`)이 있으면 거기에 밀어 올린다.**
               까닭은 하나다 — **키보드가 올라온 채로 뒤로 갈 때 키보드까지
               함께 옮기는 일을 iOS에게 맡기려는 것**이다(`AppDelegate`의
               `wrapInNavigation` 주석을 볼 것). 틀이 없는 판(옛 껍데기)에서는
               예전처럼 웹뷰 화면의 자식으로 붙는다. */
            let nav = root.navigationController
            let under = fresh && nav != nil ? root.view.snapshotView(afterScreenUpdates: false) : nil
            if fresh {
                root.view.endEditing(true)
                if let nav = nav {
                    nav.pushViewController(chat, animated: false)
                    nav.view.layoutIfNeeded()
                    /* **뒤에 깔 그림은 밀어 올리기 _전에_ 찍는다** — 밀고 나면
                       웹뷰가 화면에서 빠져 빈손이 된다. 틀의 맨 아래(0번)에
                       깔아 두고, 끌 때 `BackDrag`가 이것을 움직인다. */
                    if let under = under {
                        under.frame = nav.view.bounds
                        under.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                        under.isUserInteractionEnabled = false
                        nav.view.insertSubview(under, at: 0)
                        self.backdrop = under; chat.backdrop = under
                    }
                } else {
                    root.addChild(chat); chat.view.translatesAutoresizingMaskIntoConstraints = false
                    root.view.addSubview(chat.view)
                    NSLayoutConstraint.activate([
                        chat.view.topAnchor.constraint(equalTo: root.view.topAnchor),
                        chat.view.bottomAnchor.constraint(equalTo: root.view.bottomAnchor),
                        chat.view.leadingAnchor.constraint(equalTo: root.view.leadingAnchor),
                        chat.view.trailingAnchor.constraint(equalTo: root.view.trailingAnchor)
                    ])
                    chat.didMove(toParent: root)
                }
            }
            if nav == nil { root.view.bringSubviewToFront(chat.view) }
            (nav?.view ?? root.view).layoutIfNeeded(); chat.resume()
            /* **오른쪽에서 통째로 밀려 들어온다**(웹의 `screen-in`과 같은
               움직임이다). **남은 시간만큼만 간다** — 이 화면은 웹이 먼저
               그려진 뒤에 서므로 제 시간을 다 쓰면 머리말보다 늦게 끝나
               두 단계로 보인다(웹의 `slideLeft()`가 그 값이다). */
            if fresh, pop > 40, self.runPop(chat: chat, root: root, ms: pop, shot: leaving) {
                // 뒤로 온 길 — 아래 `runPop`이 자리를 다 잡았다.
            } else if fresh, ms > 40 {
                chat.view.transform = CGAffineTransform(translationX: root.view.bounds.width, y: 0)
                UIView.animate(withDuration: ms / 1000, delay: 0,
                               options: [.curveEaseOut, .beginFromCurrentState]) {
                    chat.view.transform = .identity
                }
            } else {
                chat.view.transform = .identity
            }
            call.resolve(["ok": true])
        }
    }
    /**
     `라운드·투표 → 대화방`으로 **뒤로** 올 때의 움직임.

     들어갈 때와 **반대**다 — 떠나는 화면이 오른쪽으로 빠져나가고 대화
     화면이 그 밑에서 `PARALLAX`(0.25)만큼 왼쪽에서 따라 들어온다.
     웹의 `runPop`과 같은 그림이고 값도 같다(`lib/tabs.ts` — **한쪽만
     고치지 말 것**).

     **떠나는 화면은 웹뷰를 그 자리에서 찍은 것이다.** 웹이 그 화면을
     `.exit-ghost`로 깔아 두고(`nativeChatPop`) 우리가 찍는다 — 웹이
     직접 내보낼 수는 없다. 대화 화면이 **웹뷰의 자식**이라(Capacitor는
     웹뷰를 화면 그 자체로 쓴다) 웹 DOM을 통째로 덮기 때문이다.

     **그 그림은 `open`이 대화 화면을 붙이기 _전에_ 찍어 넘겨준다**(`shot`) —
     여기서 찍으면 이미 대화 화면이 얹혀 있어 **그것까지 함께 찍힌다.**

     **찍은 그림은 창(`UIWindow`)에 얹는다.** 화면 안에 얹으면 그것도
     웹뷰의 자식이 되어 대화 화면 밑에 깔린다.

     - Returns: 찍지 못했으면 false — 그때는 부르는 쪽이 여느 길로 간다.
     */
    @MainActor private func runPop(chat: NativeChatViewController, root: UIViewController,
                                   ms: Double, shot: UIView?) -> Bool {
        /* **창은 대화 화면에서 찾는다.** 화면 틀에 얹은 판에서는 웹뷰가
           화면에서 빠져 `root.view.window`가 비어 있다. */
        guard let win = chat.view.window ?? root.view.window, let shot = shot else { return false }
        let W = chat.view.bounds.width
        shot.frame = win.bounds
        let dim = UIView(frame: win.bounds)
        dim.backgroundColor = UIColor(white: 0, alpha: 0.18)
        dim.isUserInteractionEnabled = false
        shot.isUserInteractionEnabled = false
        win.addSubview(dim); win.addSubview(shot)
        chat.view.transform = CGAffineTransform(translationX: -W * 0.25, y: 0)
        UIView.animate(withDuration: ms / 1000, delay: 0,
                       options: [.curveEaseOut, .beginFromCurrentState]) {
            shot.transform = CGAffineTransform(translationX: win.bounds.width, y: 0)
            dim.alpha = 0
            chat.view.transform = .identity
        } completion: { _ in
            shot.removeFromSuperview(); dim.removeFromSuperview()
        }
        /* **걷는 일을 한 곳에만 매달지 말 것** — 이 그림이 남으면 죽은
           사진이 앱을 통째로 덮어 아무것도 안 눌린다(웹에서 겪은 그
           자리다). 두 번 걷어도 탈이 없다. */
        DispatchQueue.main.asyncAfter(deadline: .now() + ms / 1000 + 0.6) {
            shot.removeFromSuperview(); dim.removeFromSuperview()
        }
        return true
    }

    @objc func close(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard call.getString("screen") == self.screen else { call.resolve(); return }
            /* **빠져나가는 중이면 그것이 끝난 뒤에 걷는다**(`goBack`의
               `leaving`). 먼저 걷으면 화면이 한가운데서 툭 사라진다.
               **그 사이에 다시 열렸으면 손대지 않는다** — 그때는 `screen`이
               새 것으로 바뀌어 있어, 그대로 걷으면 방금 연 화면을 걷는다. */
            guard self.chat?.leaving == true else { self.remove(clear: false); call.resolve(); return }
            let mine = self.screen
            /* 화면 틀이 내리는 움직임은 우리 것보다 길다 — 그만큼 기다린다
               (`exitWait`). 먼저 걷으면 내려가는 도중에 화면이 툭 사라진다. */
            DispatchQueue.main.asyncAfter(deadline: .now() + (self.chat?.exitWait ?? NativeChatViewController.exitMS)) {
                guard self.screen == mine else { return }
                self.remove(clear: false)
            }
            call.resolve()
        }
    }
    @objc func session(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if call.getString("user") == self.chat?.service.config.user, let token = call.getString("token") {
                self.chat?.updateToken(token)
            }
            call.resolve()
        }
    }
    @objc func reset(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.remove(clear: true); call.resolve() }
    }
    @MainActor private func remove(clear: Bool) {
        chat?.pause()
        chat?.dismiss(animated: false)
        /* 화면 틀에 얹었으면 **내려야** 한다 — 손으로 떼면 틀이 그 화면을
           그대로 들고 있어 다음에 들어올 때 두 겹이 된다. `←`로 이미
           내려간 판에서는 `navigationController`가 비어 아무 일도 안 한다. */
        if let c = chat, let nav = c.navigationController {
            if nav.topViewController === c { nav.popViewController(animated: false) }
        } else {
            chat?.willMove(toParent: nil); chat?.view.removeFromSuperview(); chat?.removeFromParent()
        }
        backdrop?.removeFromSuperview(); backdrop = nil; chat?.backdrop = nil
        screen = ""
        if clear { chat = nil }
    }
}
