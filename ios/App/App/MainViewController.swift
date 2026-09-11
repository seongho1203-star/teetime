import UIKit
import Capacitor
import UserNotifications

/*
 * **우리가 만든 플러그인을 손으로 등록하는 자리.**
 *
 * Capacitor 7은 **런타임을 훑어 플러그인을 찾지 않는다.** `npx cap sync`가
 * `capacitor.config.json`에 적어 둔 `packageClassList`만 읽어 등록한다
 * (`CapacitorBridge.registerPlugins`). 그 목록은 **npm으로 깐 플러그인
 * 꾸러미**에서 나오므로, 앱 안에 그냥 넣어 둔 Swift 파일은 아무리
 * `CAPBridgedPlugin`을 따라도 **영영 안 불린다.**
 *
 * 실제로 첫판이 여기서 통째로 막혔다 — 앱은 멀쩡히 빌드돼 올라갔는데
 * 웹이 `ready()`를 부르면 `not implemented`가 나서, 되물러남 규칙대로
 * **예전 웹 글칸이 그대로 쓰였다.** 그래서 폰에서는 고친 것이 하나도
 * 없어 보였다(천지인 깜빡임도 키보드 엇박자도 그대로).
 *
 * `capacitorDidLoad()`는 다리가 만들어진 **직후, 웹 화면을 열기 전에**
 * 불린다 — 여기서 등록하면 첫 화면부터 플러그인이 있다.
 *
 * **`Main.storyboard`가 이 클래스를 가리켜야 한다**(`customClass`).
 * 둘은 한 쌍이라 한쪽만 고치면 다시 조용히 안 불린다.
 */
class MainViewController: CAPBridgeViewController {
    /** 라우터가 **약하게** 들고 있으므로 여기서 붙잡아 둔다(아래 참고). */
    private var quiet: QuietChatPush?

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(NativeComposerPlugin())
        hushChatBanner()
    }

    /**
     * **앱을 보고 있는 동안 오는 대화 알림은 배너를 안 띄운다.**
     *
     * 사용자 제보 — `화면을 보면서 채팅을 하고 있는데 채팅이 올라오면
     * 배너 알림이 계속 떠`. 대화방을 열어 놓고 주고받는 내내 제 화면 위로
     * 배너가 덮였다.
     *
     * **웹에서는 못 하던 일이다.** 웹푸시는 밀어 준 건마다 **눈에 보이는
     * 알림을 하나 띄우기로 되어 있어** `sw.js`가 할 수 있는 것은 소리를
     * 죽이는 것(`silent`)까지였고, 그나마 아이폰은 그것도 무시했다.
     * 네이티브에는 그 강제가 없어 **띄울지 말지를 앱이 정한다.**
     *
     * **대화만 막는다.** `💰 정산`·`🚩 조 편성`·`🎉 자리가 났습니다`는
     * 그대로 뜬다 — 한동안 `presentationOptions`를 빈 배열로 두어 통째로
     * 안 띄웠다가 **그 알림들이 알림창에도 안 남아 그냥 사라지는** 일을
     * 겪었다(CLAUDE.md의 그 자리). 대화는 다르다: **대화방이 곧 목록이라**
     * 배너를 안 띄워도 잃는 것이 없고, 알림함에도 원래 안 들어간다.
     *
     * **탭을 가리지 않는다.** 다른 탭을 보는 중에 와도 안 띄우는데,
     * 그때는 `까꿍` 소리(`lib/sound.ts`)와 **탭바의 빨간 숫자**가 이미
     * 알려 준다 — 앱을 보고 있는 사람에게 그 위에 배너까지 덮을 이유가 없다.
     *
     * **어떻게 끼어드는가** — `willPresent`는 앱이 앞에 떠 있을 때만 불리는
     * 자리이고, 그 답을 정하는 것이 Capacitor의 `notificationRouter`다.
     * 그 자리를 우리 것으로 바꾸되 **원래 것을 그대로 감싼다**(`inner`) —
     * 안 감싸면 `pushNotificationReceived`·`pushNotificationActionPerformed`가
     * 안 가서 **알림을 눌러도 그 화면으로 안 옮겨진다**(`lib/native-push.ts`).
     *
     * **라우터가 약하게(weak) 들고 있다**(`NotificationRouter.swift`) —
     * 그래서 `quiet`으로 여기서 붙잡아 두지 않으면 그 자리에서 사라져
     * 아무 일도 안 한 것이 된다.
     */
    private func hushChatBanner() {
        guard let router = bridge?.notificationRouter,
              let inner = router.pushNotificationHandler else {
            /* 플러그인이 아직 안 실린 판(알림 없는 앱)이면 그냥 둔다 —
               배너가 예전처럼 뜰 뿐 아무것도 안 깨진다. */
            return
        }
        let wrap = QuietChatPush(inner: inner)
        quiet = wrap
        router.pushNotificationHandler = wrap
    }
}

/** 위 `hushChatBanner()`가 씌우는 껍데기. 대화만 조용히 하고 나머지는 그대로. */
final class QuietChatPush: NSObject, NotificationHandlerProtocol {
    private let inner: NotificationHandlerProtocol

    init(inner: NotificationHandlerProtocol) { self.inner = inner }

    func willPresent(notification: UNNotification) -> UNNotificationPresentationOptions {
        /* **먼저 원래 것을 부른다** — 여기서 웹으로 가는
           `pushNotificationReceived`가 나간다. 답만 우리가 고른다. */
        let opts = inner.willPresent(notification: notification)
        return isChat(notification) ? [] : opts
    }

    func didReceive(response: UNNotificationResponse) {
        /* 누른 것은 손대지 않는다 — 그대로 그 화면으로 옮겨져야 한다. */
        inner.didReceive(response: response)
    }

    /**
     * 발송기가 실어 보내는 표(`chat`)를 본다(`supabase/functions/notify`).
     *
     * **예비로 `thread-id`도 본다** — 앱은 새로 깔아야 바뀌고 발송기는
     * 밀면 바로 올라가므로 둘이 어긋나는 사이가 늘 있는데, 대화 알림의
     * `tag`는 예나 지금이나 `chat` 하나다. 그 표가 없는 판에서도 먹는다.
     */
    private func isChat(_ n: UNNotification) -> Bool {
        let info = n.request.content.userInfo
        if let b = info["chat"] as? Bool { return b }
        if let s = info["chat"] as? String { return s == "1" || s == "true" }
        return n.request.content.threadIdentifier == "chat"
    }
}
