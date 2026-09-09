import UIKit
import Capacitor

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
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(NativeComposerPlugin())
    }
}
