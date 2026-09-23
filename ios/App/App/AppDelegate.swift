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

    /**
     * **화면 틀(`UINavigationController`)에 앱을 얹는다.**
     *
     * 까닭은 하나다 — **키보드가 올라온 채로 뒤로 갈 때 키보드까지 함께
     * 옮기는 일을 iOS에게 맡기려는 것**이다(카톡이 그 길이다).
     * 우리가 손으로 그림을 찍어 미는 길(`BackDrag`의 `liftKeyboard`)은
     * **`UIScreen.snapshotView`가 키보드를 못 담아** 막혔다 — iOS는
     * 키보드를 딴 프로세스로 그리므로 앱이 그 픽셀을 가져갈 길이 없다.
     *
     * **이 판은 재려고 만든 것이다.** 대화방에서 `←`를 누르는 길만
     * 이 틀의 `pop`으로 보내고(그때 **키보드를 안 내린다**), 나머지는
     * 예전 그대로다. 폰에서 볼 것은 하나 — **키보드가 화면과 함께
     * 오른쪽으로 밀려 나가는가.** 그 답이 다음 판을 정한다
     * (안 밀리면 글칸을 `inputAccessoryView`로 바꿔야 한다).
     *
     * **막대는 감춘다** — 우리 화면은 저마다 제 머리말을 그린다.
     * 그러면 iOS가 가장자리 끌기(`interactivePopGestureRecognizer`)를
     * 스스로 꺼 주므로 우리 `BackDrag`와 다툴 일도 없다.
     */
    private func wrapInNavigation() {
        guard let win = window, let root = win.rootViewController,
              !(root is UINavigationController) else { return }
        let nav = UINavigationController(rootViewController: root)
        nav.isNavigationBarHidden = true
        nav.view.backgroundColor = root.view.backgroundColor ?? .systemBackground
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
