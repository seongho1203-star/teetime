import UIKit
import Capacitor
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        wrapInNavigation()
        return true
    }

    /// 가장자리 끌기를 살려 두는 문지기 — 아래 `wrapInNavigation` 참고.
    private let edgeBack = EdgeBack()

    /**
     * **화면 틀(`UINavigationController`)에 앱을 얹는다.**
     *
     * 까닭은 하나다 — **키보드가 올라온 채로 뒤로 갈 때 키보드까지 함께
     * 옮기는 일을 iOS에게 맡기려는 것**이다(카톡이 그 길이다).
     * 우리가 손으로 그림을 찍어 미는 길(`BackDrag`의 `liftKeyboard`)은
     * **`UIScreen.snapshotView`가 키보드를 못 담아** 막혔다 — iOS는
     * 키보드를 딴 프로세스로 그리므로 앱이 그 픽셀을 가져갈 길이 없다.
     *
     * **실기기에서 확인했다**(사용자 — `잘 돼`). `←`를 누르면 키보드가
     * 화면과 한 몸으로 오른쪽으로 밀려 나간다. 그래서 **손가락 끌기도
     * 이 틀에 넘긴다** — 아래 `EdgeBack`이 그 자리다.
     *
     * **막대는 감춘다** — 우리 화면은 저마다 제 머리말을 그린다.
     * 그런데 막대를 감추면 iOS가 가장자리 끌기를 **스스로 꺼 버리므로**
     * (그 대리자가 막대를 보고 거절한다) 우리 문지기를 대신 세운다.
     */
    private func wrapInNavigation() {
        guard let win = window, let root = win.rootViewController,
              !(root is UINavigationController) else { return }
        let nav = UINavigationController(rootViewController: root)
        nav.isNavigationBarHidden = true
        nav.view.backgroundColor = root.view.backgroundColor ?? .systemBackground
        edgeBack.nav = nav
        nav.interactivePopGestureRecognizer?.delegate = edgeBack
        win.rootViewController = nav
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // ── 아이콘 위 빨간 숫자를 지운다 ──────────────────────────
        //
        // **앱 안에는 서비스워커가 없다.** 웹에서 그 숫자를 세고 지우던
        // `sw.js`의 `bumpBadge`·`lib/badge.ts`가 여기서는 아예 안 돈다 —
        // 그래서 앱은 숫자가 **붙지도 지워지지도** 않았다.
        //
        // 붙이는 쪽은 발송기가 맡고(`aps.badge`), **지우는 쪽이 여기다.**
        // 앱을 열었다는 것이 곧 봤다는 뜻이라 그 자리에서 0으로 되돌린다
        // (웹에서 보고 있는 창이 있으면 0으로 맞추는 것과 같은 잣대다).
        //
        // **`setBadgeCount`는 iOS 16부터다** — 그 아래에서는 예전 길로
        // 간다. 앱의 최소 판이 낮아도 안 깨지게 갈라 두었다.
        if #available(iOS 16.0, *) {
            UNUserNotificationCenter.current().setBadgeCount(0)
        } else {
            application.applicationIconBadgeNumber = 0
        }
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    // ── 알림 등록의 답을 플러그인에 넘긴다 ────────────────────────
    //
    // **이 둘이 없으면 알림이 통째로 안 붙는다.** 애플에 등록을 신청하면
    // (`PushNotifications.register()`) 답이 여기 앱 대리자로 오는데, 그걸
    // 넘겨 주지 않으면 플러그인의 `registration` 이벤트가 **영영 안 온다** —
    // 웹 쪽에서는 `애플에서 답이 없습니다`로만 보이고 까닭을 알 길이 없다.
    //
    // Capacitor 기본 틀에는 들어 있는데 **우리 파일에는 없었다**(이 앱을
    // 만들 때는 알림을 안 쓰고 있었다). `lib/native-push.ts`와 한 벌이니
    // 한쪽만 지우지 말 것.
    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(
            name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(
            name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

/**
 * **왼쪽 가장자리에서 끌면 iOS가 뒤로 보내 준다.**
 *
 * `UINavigationController`는 막대를 감추면 그 손짓을 스스로 꺼 버린다
 * (기본 대리자가 막대를 보고 거절한다). 우리 화면은 저마다 머리말을
 * 그리므로 막대는 감춘 채로 손짓만 되살리는 것이 이 클래스의 전부다.
 *
 * **이 길로 가면 키보드가 화면과 한 몸으로 밀려 나간다** — 우리가 손으로
 * 미는 `BackDrag`로는 못 하는 일이다(키보드는 딴 창이라 우리 그림에
 * 안 담긴다). 그래서 **가장자리에서는 이쪽이 이긴다**:
 * `NativeChatViewController.linkEdge()`가 우리 손짓들에
 * `require(toFail:)`을 걸어 비켜 준다. 가장자리가 아닌 자리에서는 이
 * 손짓이 곧바로 실패하므로 `BackDrag`가 예전 그대로 돈다.
 *
 * **대리자는 약하게 잡히므로** `AppDelegate`가 이 객체를 들고 있어야 한다.
 */
final class EdgeBack: NSObject, UIGestureRecognizerDelegate {
    weak var nav: UINavigationController?

    func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
        guard let nav = nav else { return false }
        /* 돌고 있는 전환 위에 또 시작하면 화면이 반쯤 겹친 채로 굳는다. */
        return nav.viewControllers.count > 1 && nav.transitionCoordinator == nil
    }
}
