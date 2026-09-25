import UIKit
import Capacitor

/*
 * **앱이 통째로 그리는 화면들의 문** — 대화(`NativeChatPlugin`) 다음 걸음이다
 * (사용자 요청 — `까꿍앱을 완전한 네이티브앱으로 바꿔줘. 일단 아이폰만`).
 * 단계와 켜는 법은 `docs/아이폰-네이티브.md`에 있다.
 *
 * 웹과 오가는 말은 대화 플러그인과 같은 꼴이다(`src/lib/native-app.ts`):
 *  - `open({screen, path, user, token, url, key, slide})` — 그 주소의 화면을
 *    화면 틀(`UINavigationController`)에 밀어 올린다. 모르는 주소면 거절한다 —
 *    웹은 그때 오류 안내를 띄우고 스위치를 끄면 웹 화면으로 돌아간다.
 *  - `close({screen})` — 웹이 그 화면을 떠났다. 아직 위에 있으면 내린다.
 *  - `session({user, token})` — 새 토큰.
 *  - `event` — `back`(`plain`) · `navigate`(`path`) · `auth`.
 *
 * **화면은 매번 새로 만든다**(대화와 다르다). 대화는 글칸·굴린 자리를
 * 지키려고 한 번 만든 것을 들고 있지만, 명단 같은 화면은 들어올 때 다시
 * 받아 오는 것이 맞다.
 *
 * **통신은 `NativeChatService`를 그대로 쓴다** — 이름에 `Chat`이 붙어 있지만
 * 하는 일은 REST 한 번 부르기(+ 401이면 웹에 토큰을 다시 달라고 하기)라
 * 두 벌로 만들 이유가 없다. 화면마다 필요한 조회는 `NativeAppData.swift`에
 * extension으로 얹는다.
 */
@objc(NativeAppPlugin)
public class NativeAppPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeAppPlugin"
    public let jsName = "NativeApp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "ready", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "session", returnType: CAPPluginReturnPromise)
    ]
    /// 앱 쪽 판 번호 — 화면을 더하면 올린다(웹이 무엇을 아는지 가리는 값).
    static let version = 2
    /// **앱이 그릴 줄 아는 주소.** 웹의 `NATIVE_SCREENS`와 같아야 한다.
    /// `:id`는 uuid 한 조각이다 — `/board/new`·`/board/<id>/edit`(쓰는 화면)는 아직 웹이다.
    static let screens: [String] = ["/members", "/alerts", "/board/:id"]

    private var screen: NativeScreenController?
    private var id = ""

    @objc func ready(_ call: CAPPluginCall) {
        call.resolve(["v": Self.version, "screens": Self.screens])
    }

    /// 주소 → 화면. 새 화면을 만들면 여기와 `screens`에 함께 더한다.
    @MainActor static func make(_ path: String, service: NativeChatService) -> NativeScreenController? {
        switch path {
        case "/members": return MembersViewController(service: service)
        case "/alerts": return AlertsViewController(service: service)
        default:
            /* `/board/<uuid>` — 그 뒤에 무엇이 더 붙으면(`/edit`) uuid가 아니라 걸러진다. */
            if path.hasPrefix("/board/"), let id = UUID(uuidString: String(path.dropFirst("/board/".count))) {
                return PostViewController(service: service, id: id.uuidString.lowercased())
            }
            return nil
        }
    }

    @objc func open(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let config = NativeChatConfig(call.options as? ChatJSON ?? [:]),
                  let id = call.getString("screen"), let path = call.getString("path"),
                  let root = self.bridge?.viewController, let nav = root.navigationController
            else { call.reject("화면을 열 수 없습니다."); return }
            guard let vc = Self.make(path, service: NativeChatService(config)) else {
                call.reject("앱이 아직 모르는 화면입니다: \(path)"); return
            }
            self.remove()
            self.screen = vc; self.id = id
            vc.event = { [weak self] type, data in
                guard let self = self else { return }
                self.notifyListeners("event", data: ["screen": self.id, "type": type, "data": data])
            }
            vc.service.authNeeded = { [weak self] in
                guard let self = self else { return }
                self.notifyListeners("event", data: ["screen": self.id, "type": "auth", "data": [:]])
            }
            root.view.endEditing(true)
            /* **오른쪽에서 밀려 들어온다** — 웹이 남은 시간(`slideLeft()`)을
               실어 보낸다. 40ms 아래면 그냥 툭 선다(대화와 같은 잣대). */
            let ms = call.getDouble("slide") ?? 0
            vc.loadViewIfNeeded()
            nav.pushViewController(vc, animated: ms > 40)
            if let co = nav.transitionCoordinator,
               co.animate(alongsideTransition: nil, completion: { _ in call.resolve(["ok": true]) }) { return }
            call.resolve(["ok": true])
        }
    }

    @objc func close(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if call.getString("screen") == self.id { self.remove() }
            call.resolve()
        }
    }

    @objc func session(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let vc = self.screen, call.getString("user") == vc.service.config.user,
               let token = call.getString("token") {
                vc.service.config.token = token
            }
            call.resolve()
        }
    }

    /// 화면을 내린다. **`←`나 가장자리 끌기로 이미 내려갔으면** 틀의 맨 위가
    /// 아니라 아무 일도 안 한다(두 번 내리면 엉뚱한 화면이 빠진다).
    @MainActor private func remove() {
        guard let vc = screen else { return }
        vc.leaveQuietly()
        if let nav = vc.navigationController, nav.topViewController === vc {
            nav.popViewController(animated: false)
        }
        screen = nil; id = ""
    }
}

/**
 * **앱 화면의 색** — `src/styles/tokens.css`의 값 그대로다. **눈대중으로
 * 바꾸지 말 것**, 그리고 뜻이 있는 색의 규칙도 그대로다(분홍은 '지금
 * 눌러야 할 것' · 잔디는 좋은 상태 · 노랑은 기다리는 것 · 빨강은 안 본 것).
 * 대화 화면의 보라 팔레트는 `ChatSkin`(ChatList.swift)이 따로 든다.
 */
enum AppSkin {
    static let bg = UIColor(hexString: "#f5f7f1") ?? .systemBackground
    static let surface = UIColor(hexString: "#ffffff") ?? .white
    static let surface2 = UIColor(hexString: "#eff2e9") ?? .secondarySystemBackground
    static let line = UIColor(hexString: "#dde3d1") ?? .separator
    static let text = UIColor(hexString: "#1b1f19") ?? .label
    static let dim = UIColor(hexString: "#5b6455") ?? .secondaryLabel
    static let faint = UIColor(hexString: "#8b9486") ?? .tertiaryLabel
    static let brand = UIColor(hexString: "#d92b8e") ?? .systemPink
    static let brandDeep = UIColor(hexString: "#b41f72") ?? .systemPink
    static let grass = UIColor(hexString: "#7cb828") ?? .systemGreen
    static let warn = UIColor(hexString: "#b97c00") ?? .systemOrange
    static let danger = UIColor(hexString: "#e2402a") ?? .systemRed
    static let info = UIColor(hexString: "#2c7bd4") ?? .systemBlue
    static let male = UIColor(hexString: "#2f8fd6") ?? .systemBlue
    static let female = UIColor(hexString: "#ef6ba8") ?? .systemPink
    /// 모서리 — 스티커처럼 통통하게(`--r` 18 · `--r-sm` 11).
    static let radius: CGFloat = 18
    static let radiusSm: CGFloat = 11
}

/**
 * **앱 화면의 뼈대** — 머리말(`←` + 제목)과 그 아래 본문 자리(`body`), 그리고
 * 웹에 뒤로 갔다고 알리는 일. 화면마다 이것을 물려받아 `body`에 내용을 얹는다.
 *
 * **뒤로 가는 길이 둘이고 둘 다 웹에 `back`(`plain`)을 보낸다:**
 *  1. `←` — 우리가 틀에서 내리고 알린다(`goBack`).
 *  2. 왼쪽 가장자리 끌기 — iOS가 내린다(`EdgeBack` · AppDelegate). 그때는
 *     `didMove(toParent: nil)`에서 안다. **웹이 먼저 떠나서 플러그인이
 *     내리는 판(`leaveQuietly`)과 갈라야 한다** — 안 가르면 웹이 한 번 더
 *     뒤로 간다.
 * 어디로 갈지는 웹이 안다(히스토리가 비었으면 홈 — 대화의 `goBack`과 같다).
 *
 * 머리말 모양은 웹의 `TopBar`와 같은 자리다 — 44px 단추 · 굵은 제목.
 */
class NativeScreenController: UIViewController {
    let service: NativeChatService
    var event: ((String, ChatJSON) -> Void)?
    private(set) var navigating = false
    private var closing = false
    let header = UIView()
    let titleLabel = UILabel()
    let backButton = UIButton(type: .system)
    /// 머리말 오른쪽 단추(웹 `TopBar`의 `right` — `수정` 같은 것). 기본은 감춰져 있다.
    let rightButton = UIButton(type: .system)
    /// 머리말 아래 본문 자리. 화면이 여기에 제 뷰를 얹는다.
    let body = UIView()
    private var flashLabel: UILabel?
    private var loadedOnce = false

    init(service: NativeChatService, title: String) {
        self.service = service
        super.init(nibName: nil, bundle: nil)
        titleLabel.text = title
    }
    required init?(coder: NSCoder) { fatalError("storyboard로 만들지 않는다") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = AppSkin.bg
        header.backgroundColor = AppSkin.bg
        header.translatesAutoresizingMaskIntoConstraints = false
        body.translatesAutoresizingMaskIntoConstraints = false
        backButton.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        backButton.setImage(UIImage(systemName: "chevron.left"), for: .normal)
        backButton.tintColor = AppSkin.text
        backButton.accessibilityLabel = "뒤로"
        backButton.addTarget(self, action: #selector(backTapped), for: .touchUpInside)
        titleLabel.font = .systemFont(ofSize: 17, weight: .bold)
        titleLabel.textColor = AppSkin.text
        rightButton.translatesAutoresizingMaskIntoConstraints = false
        rightButton.titleLabel?.font = .systemFont(ofSize: 14, weight: .semibold)
        rightButton.setTitleColor(AppSkin.text, for: .normal)
        rightButton.contentEdgeInsets = UIEdgeInsets(top: 6, left: 12, bottom: 6, right: 12)
        rightButton.isHidden = true
        view.addSubview(header); view.addSubview(body)
        header.addSubview(backButton); header.addSubview(titleLabel); header.addSubview(rightButton)
        NSLayoutConstraint.activate([
            rightButton.trailingAnchor.constraint(equalTo: header.trailingAnchor, constant: -8),
            rightButton.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            rightButton.heightAnchor.constraint(equalToConstant: 44),
            header.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            header.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            header.heightAnchor.constraint(equalToConstant: 48),
            backButton.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 4),
            backButton.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            backButton.widthAnchor.constraint(equalToConstant: 44),
            backButton.heightAnchor.constraint(equalToConstant: 44),
            titleLabel.leadingAnchor.constraint(equalTo: backButton.trailingAnchor, constant: 2),
            titleLabel.trailingAnchor.constraint(lessThanOrEqualTo: rightButton.leadingAnchor, constant: -8),
            titleLabel.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            body.topAnchor.constraint(equalTo: header.bottomAnchor),
            body.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            body.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            body.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        if !loadedOnce { loadedOnce = true; loadScreen() }
    }

    /// 화면이 처음 보일 때 한 번 — 화면마다 여기서 받아 온다.
    func loadScreen() {}

    @objc private func backTapped() { goBack() }

    /// `←` — 틀에서 내리고 웹에 알린다.
    func goBack() {
        guard !navigating else { return }
        navigating = true
        view.endEditing(true)
        if let nav = navigationController, nav.topViewController === self {
            nav.popViewController(animated: true)
        }
        event?("back", ["phase": "plain"])
    }

    /// 웹이 먼저 떠났다(플러그인이 내린다) — 그때는 웹에 알리지 않는다.
    func leaveQuietly() { closing = true; navigating = true }

    override func didMove(toParent parent: UIViewController?) {
        super.didMove(toParent: parent)
        /* iOS가 내렸다(가장자리 끌기) — 웹의 주소만 되돌린다. */
        if parent == nil && !navigating && !closing {
            navigating = true
            event?("back", ["phase": "plain"])
        }
    }

    /// 카드를 눌러 다른 화면으로 — 어디로 갈지는 웹이 안다.
    /// `replace`면 이 화면의 자리를 그 화면이 대신한다(지운 글에서 목록으로 갈 때).
    func navigate(_ path: String, replace: Bool = false) {
        guard !navigating else { return }
        navigating = true
        event?("navigate", ["path": path, "replace": replace])
    }

    /// 짧은 안내 — 화면 아래 알약 하나가 떴다 사라진다(웹의 토스트 몫).
    func flash(_ text: String, error: Bool = false) {
        flashLabel?.removeFromSuperview()
        let l = PillLabel()
        l.text = text
        l.font = .systemFont(ofSize: 14, weight: .semibold)
        l.textColor = .white
        l.textAlignment = .center
        l.numberOfLines = 2
        l.backgroundColor = error ? AppSkin.danger : UIColor(white: 0.12, alpha: 0.92)
        l.layer.cornerRadius = 14
        l.layer.masksToBounds = true
        l.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(l)
        NSLayoutConstraint.activate([
            l.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            l.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -24),
            l.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, constant: -32),
            l.heightAnchor.constraint(greaterThanOrEqualToConstant: 40)
        ])
        flashLabel = l
        l.alpha = 0
        UIView.animate(withDuration: 0.18) { l.alpha = 1 }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.2) { [weak self, weak l] in
            guard let l = l else { return }
            UIView.animate(withDuration: 0.25, animations: { l.alpha = 0 }) { _ in
                l.removeFromSuperview()
                if self?.flashLabel === l { self?.flashLabel = nil }
            }
        }
    }

    /// 글자 둘레에 여백이 있는 알약 — `UILabel`은 안여백이 없어 글자가 모서리에 닿는다.
    final class PillLabel: UILabel {
        /// 안여백 — 토스트는 넉넉하게, 작은 표(`고정`)는 `pad`를 줄여 쓴다.
        var pad = UIEdgeInsets(top: 10, left: 16, bottom: 10, right: 16) { didSet { invalidateIntrinsicContentSize() } }
        override func drawText(in rect: CGRect) { super.drawText(in: rect.inset(by: pad)) }
        override var intrinsicContentSize: CGSize {
            let s = super.intrinsicContentSize
            return CGSize(width: s.width + pad.left + pad.right, height: s.height + pad.top + pad.bottom)
        }
    }

    /// 한 번 더 묻는 창(웹의 `Confirm`과 같은 자리).
    func confirm(title: String, detail: String, ok: String, danger: Bool, then: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: title, message: detail, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "취소", style: .cancel) { _ in then(false) })
        a.addAction(UIAlertAction(title: ok, style: danger ? .destructive : .default) { _ in then(true) })
        present(a, animated: true)
    }
}
