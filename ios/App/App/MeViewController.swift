import UIKit
import PhotosUI

/*
 * **내 정보** — 웹 `screens/Me.tsx`를 Swift로 옮긴 것이다
 * (`docs/아이폰-네이티브.md` 3단계). 주소는 `/me`.
 *
 * **이 화면만 반은 웹에 부탁한다.** 알림 켜기(`enablePush` — 푸시 플러그인·
 * 토큰·구독 줄) · 로그아웃·탈퇴(웹이 든 로그인 세션)는 **웹이 쥐고 있는 것**이라, 앱이 두 벌을 만들면 반드시
 * 어긋난다. 그래서 그 일은 `action` 이벤트로 웹에 넘기고 답(`reply`)을 받는다
 * (`NativeScreen.tsx`의 `MeRoute`). 앱이 직접 하는 것은 **보이는 것 전부 ·
 * 프로필 사진 · 프로필 수정**이다.
 *
 * 그래서 **웹이 열어야만 뜬다** — `make`는 웹이 실어 보낸 알림 상태(`push`)가
 * 없으면 `nil`이다(껍데기가 직접 부르면 웹에 맡기고, 웹이 곧 연다).
 *
 * **규칙은 웹과 같다 — 한쪽만 고치지 말 것:**
 *  - 사진은 누르면 바로 바꾼다 · 400px로 줄여 `avatars/<내 id>/<시각>.jpg`
 *    (시각을 넣어 주소가 매번 달라지게 한다 — 같은 주소면 옛 사진이 남는다).
 *  - 차량번호는 머리말에 안 적는다(프로필 수정 안에만).
 *  - 생일은 내 것만 보인다 · 음력이면 올해 양력 며칠인지 함께(웹이 셈해 준다).
 *  - 대화 알림 줄은 이 기기가 받고 있을 때만 · 꺼도 `@언급`과 답장은 온다.
 *  - 회원 탈퇴는 로그아웃 바로 아래 · 앱관리자에게는 안 보인다.
 *  - 시험 스위치(`🧪 시험 중: 앱 화면` · `앱이 화면을 밀고 끌기`)와 기록 줄은
 *    걷어냈다 — 아이폰 앱이 다 됐다(사용자 요청 — `프로필에 필요없는거 이제 지워줘`).
 */
final class MeViewController: NativeScreenController, PHPickerViewControllerDelegate {
    private let info: ChatJSON
    private let scroll = UIScrollView()
    private let stack = UIStackView()
    private let spinner = UIActivityIndicatorView(style: .medium)

    private var profile: AppProfile?
    private var contact: AppContact?
    private var push: String
    private var chat: Bool
    private var pushBusy = false
    private var chatBusy = false
    private var photoBusy = false
    private var leaving = false
    private var step = ""
    private var why = ""

    init(service: NativeChatService, info: ChatJSON) {
        self.info = info
        push = info["push"] as? String ?? "off"
        chat = info["chat"] as? Bool ?? true
        super.init(service: service, title: "내 정보")
    }
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.alwaysBounceVertical = true
        stack.axis = .vertical
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.isLayoutMarginsRelativeArrangement = true
        stack.layoutMargins = UIEdgeInsets(top: 4, left: 16, bottom: 24, right: 16)
        scroll.addSubview(stack)
        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.hidesWhenStopped = true
        body.addSubview(scroll); body.addSubview(spinner)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: body.topAnchor),
            scroll.leadingAnchor.constraint(equalTo: body.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: body.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: body.bottomAnchor),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor),
            spinner.centerXAnchor.constraint(equalTo: body.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: body.centerYAnchor)
        ])
    }

    override func loadScreen() {
        if profile == nil { spinner.startAnimating() }
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            let me = self.service.config.user
            async let p = self.one("profiles", me)
            async let c = self.one("profile_private", me)
            if let row = await p { self.profile = AppProfile(raw: row) }
            if let row = await c { self.contact = AppContact(raw: row) }
            self.spinner.stopAnimating()
            self.render()
        }
    }

    /// 내 줄 하나 — 못 받으면 없는 것으로(칸이 없는 저장소에서 화면이 죽으면 안 된다).
    private func one(_ table: String, _ id: String) async -> ChatJSON? {
        (try? await service.rows(table, [("select", "*"), ("id", "eq.\(id)"), ("limit", "1")]))?.first
    }

    /// 웹이 부탁받은 일을 마치고 답했다(`NativeApp.reply`).
    override func onReply(_ data: ChatJSON) {
        let name = data["name"] as? String ?? ""
        let ok = data["ok"] as? Bool ?? false
        let said = data["why"] as? String ?? ""
        switch name {
        case "step":
            step = data["step"] as? String ?? ""
        case "push":
            pushBusy = false
            if let s = data["push"] as? String { push = s }
            if let c = data["chat"] as? Bool { chat = c }
            why = ok ? "" : said
            if ok {
                if push == "on" { flash("이 기기로 알림을 보냅니다.") }
                else if push == "denied" { flash("폰 설정에서 이 앱의 알림을 켜 주세요.", error: true) }
            } else { flash(said, error: true) }
        case "chat":
            chatBusy = false
            if ok { flash(chat ? "대화 알림을 켰습니다." : "대화 알림을 껐습니다.") }
            else { chat.toggle(); flash(said, error: true) }     // 저장이 안 됐으면 되돌린다
        case "leave":
            leaving = false
            if !ok { flash(said, error: true) }
        default:
            if !ok && !said.isEmpty { flash(said, error: true) }
        }
        render()
    }

    // ── 그리기 ───────────────────────────────────────────────────

    private func render() {
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        stack.addArrangedSubview(headView())
        stack.addArrangedSubview(menuCard())
        stack.addArrangedSubview(pushCard())

        let logout = UIButton(type: .system)
        appButton(logout, title: "로그아웃", color: AppSkin.text, filled: false)
        logout.addTarget(self, action: #selector(logoutTapped), for: .touchUpInside)
        stack.addArrangedSubview(logout)
        /* **찾기 쉬운 자리에 둔다**(애플 심사 5.1.1(v)) · 빨강 테두리 · 앱관리자에게는 안 보인다. */
        if profile?.role != "superadmin" {
            let leave = UIButton(type: .system)
            appButton(leave, title: leaving ? "탈퇴 중…" : "회원 탈퇴", color: AppSkin.danger, filled: false)
            leave.layer.borderColor = AppSkin.danger.withAlphaComponent(0.5).cgColor
            leave.isEnabled = !leaving
            leave.addTarget(self, action: #selector(leaveTapped), for: .touchUpInside)
            stack.addArrangedSubview(leave)
        }
        let foot = mkLabel("앱제작: 악마제리\n버전 \(info["version"] as? String ?? "")", size: 12, color: AppSkin.faint, lines: 0)
        foot.textAlignment = .center
        stack.addArrangedSubview(foot)
    }

    private func headView() -> UIView {
        let face = AvatarView()
        face.translatesAutoresizingMaskIntoConstraints = false
        face.show(url: profile?.avatar, letter: profile?.name ?? "", edge: profile?.edge, size: 64)
        let pick = UIControl()
        pick.translatesAutoresizingMaskIntoConstraints = false
        pick.accessibilityLabel = "프로필 사진 바꾸기"
        pick.accessibilityTraits = .button
        pick.isAccessibilityElement = true
        pick.addTarget(self, action: #selector(photoTapped), for: .touchUpInside)
        face.isUserInteractionEnabled = false
        let mark = mkLabel(photoBusy ? "…" : "＋", size: 13, weight: .heavy, color: .white)
        mark.textAlignment = .center
        mark.backgroundColor = AppSkin.brand
        mark.layer.cornerRadius = 11
        mark.layer.masksToBounds = true
        mark.translatesAutoresizingMaskIntoConstraints = false
        pick.addSubview(face); pick.addSubview(mark)
        NSLayoutConstraint.activate([
            pick.widthAnchor.constraint(equalToConstant: 64), pick.heightAnchor.constraint(equalToConstant: 64),
            face.topAnchor.constraint(equalTo: pick.topAnchor), face.bottomAnchor.constraint(equalTo: pick.bottomAnchor),
            face.leadingAnchor.constraint(equalTo: pick.leadingAnchor), face.trailingAnchor.constraint(equalTo: pick.trailingAnchor),
            mark.widthAnchor.constraint(equalToConstant: 22), mark.heightAnchor.constraint(equalToConstant: 22),
            mark.trailingAnchor.constraint(equalTo: pick.trailingAnchor, constant: 3),
            mark.bottomAnchor.constraint(equalTo: pick.bottomAnchor, constant: 3)
        ])
        let label = profile?.label ?? ""
        let texts = UIStackView(arrangedSubviews: [
            mkLabel(label.isEmpty ? "닉네임 없음" : label, size: 19, weight: .bold),
            mkLabel(AppRole.label[profile?.role ?? "member"] ?? "일반회원", size: 13, color: AppSkin.faint)
        ])
        texts.axis = .vertical
        texts.spacing = 2
        if let md = contact?.birthMd {
            var line = "🎂 " + AppDate.birthLabel(year: profile?.birthYear, md: md, cal: contact?.birthCal ?? "solar")
            if contact?.birthCal == "lunar", let y = info["birthdayThisYear"] as? String, !y.isEmpty { line += " · 올해 \(y)" }
            texts.addArrangedSubview(mkLabel(line, size: 13, color: AppSkin.faint, lines: 0))
        }
        let row = UIStackView(arrangedSubviews: [pick, texts])
        row.axis = .horizontal
        row.alignment = .center
        row.spacing = 14
        row.isLayoutMarginsRelativeArrangement = true
        row.layoutMargins = UIEdgeInsets(top: 8, left: 2, bottom: 8, right: 2)
        return row
    }

    private func menuCard() -> UIView {
        let c = CardView()
        c.content.spacing = 0
        func item(_ title: String, _ sub: String?, _ act: @escaping () -> Void) {
            let b = UIControl()
            /* 네 줄 다 같은 굵기다(사용자 제보 — `내정보 글씨가 다름`). 곁말이 있는 줄만
               굵었는데, 그러면 두 가지 글씨가 섞여 보인다. */
            let t = UIStackView(arrangedSubviews: [mkLabel(title, size: 16, weight: .semibold)])
            t.axis = .vertical
            t.spacing = 2
            if let sub = sub { t.addArrangedSubview(mkLabel(sub, size: 12, color: AppSkin.faint, lines: 0)) }
            let chev = mkLabel("›", size: 20, color: AppSkin.faint)
            chev.setContentHuggingPriority(.required, for: .horizontal)
            let row = UIStackView(arrangedSubviews: [t, chev])
            row.axis = .horizontal; row.alignment = .center; row.spacing = 8
            row.isUserInteractionEnabled = false
            row.translatesAutoresizingMaskIntoConstraints = false
            b.addSubview(row)
            NSLayoutConstraint.activate([
                row.topAnchor.constraint(equalTo: b.topAnchor, constant: 10),
                row.bottomAnchor.constraint(equalTo: b.bottomAnchor, constant: -10),
                row.leadingAnchor.constraint(equalTo: b.leadingAnchor),
                row.trailingAnchor.constraint(equalTo: b.trailingAnchor),
                b.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)
            ])
            b.isAccessibilityElement = true
            b.accessibilityLabel = title
            b.accessibilityTraits = .button
            b.addAction(UIAction { _ in act() }, for: .touchUpInside)
            if !c.content.arrangedSubviews.isEmpty {
                let rule = UIView(); rule.backgroundColor = AppSkin.line
                rule.heightAnchor.constraint(equalToConstant: 1).isActive = true
                c.content.addArrangedSubview(rule)
            }
            c.content.addArrangedSubview(b)
        }
        item("프로필 수정", nil) { [weak self] in self?.editTapped() }
        item("앱 사용자 가이드", "처음이시면 여기부터 보세요") { [weak self] in self?.navigate("/help") }
        item("회원 명단", nil) { [weak self] in self?.navigate("/members") }
        item("정산 현황", "내가 걷는 돈과 아직 안 내신 분을 한 번에 봅니다") { [weak self] in self?.navigate("/settle") }
        return c
    }

    /** 알림 칸의 첫 줄 — 켤 수 없으면 왜인지와 무엇을 하면 되는지(웹 `pushLine`). */
    private func pushLine() -> (hint: String, can: Bool) {
        switch push {
        case "on": return ("라운드 모집, 투표, 공지 알림을 받습니다.", true)
        case "off": return ("앱을 안 보고 있어도 소식이 옵니다", true)
        case "denied": return ("폰 설정 → 알림에서 까꿍을 켜 주세요", false)
        case "unsupported": return ("앱을 최신 판으로 받으면 켤 수 있습니다", false)
        default: return ("확인 중…", false)
        }
    }

    private func pushCard() -> UIView {
        let c = CardView()
        c.content.spacing = 12
        c.content.addArrangedSubview(mkLabel("알림", size: 16, weight: .bold))
        let line = pushLine()
        var desc = pushBusy ? "켜는 중… \(step)" : line.hint
        if !why.isEmpty && !pushBusy { desc += "\n" + (step.isEmpty ? "" : "\(step) — ") + why }
        let (row, sw) = appSwitchRow("이 기기로 받기", desc: desc, on: push == "on")
        sw.isEnabled = line.can && !pushBusy
        sw.accessibilityLabel = "이 기기로 알림 받기"
        sw.addTarget(self, action: #selector(pushToggled(_:)), for: .valueChanged)
        c.content.addArrangedSubview(row)
        /* 켜져 있을 때만 — 안 받는 기기에서 갈래를 나누는 칸은 누를 일이 없다. */
        if push == "on" {
            let (r2, s2) = appSwitchRow("💬 대화 알림",
                                     desc: chat ? "새 메시지가 올 때마다 알림을 받습니다." : "꺼짐 — @언급과 내 글에 온 답장은 그래도 옵니다",
                                     on: chat)
            s2.isEnabled = !chatBusy
            s2.addTarget(self, action: #selector(chatToggled(_:)), for: .valueChanged)
            c.content.addArrangedSubview(r2)
        }
        return c
    }

    // ── 웹에 부탁하는 일 ────────────────────────────────────────

    private func action(_ name: String, _ value: Any? = nil) {
        var d: ChatJSON = ["name": name]
        if let v = value { d["value"] = v }
        event?("action", d)
    }

    @objc private func pushToggled(_ s: UISwitch) {
        pushBusy = true; why = ""; step = ""
        action("push", push != "on")
        render()
    }
    @objc private func chatToggled(_ s: UISwitch) {
        /* 스위치는 먼저 움직인다 — 통신을 기다리면 눌러도 안 켜지는 것처럼 보인다. */
        chat = s.isOn; chatBusy = true
        action("chat", chat)
        render()
    }

    @objc private func logoutTapped() {
        confirm(title: "로그아웃할까요?", detail: "이 기기에서 로그아웃합니다.", ok: "로그아웃", danger: false) { [weak self] ok in
            if ok { self?.action("logout") }
        }
    }

    @objc private func leaveTapped() {
        let who = profile?.name.isEmpty == false ? profile!.name : "회원"
        let detail = "\(who)님의 계정이 지워집니다. 되돌릴 수 없습니다.\n\n· 프로필과 전화번호·차량번호\n· 신청해 둔 라운드와 던진 표\n· 프로필 사진과 알림 설정\n\n대화방에 남긴 글은 지워지지 않습니다. 다시 들어오시려면 처음처럼 가입 신청을 하셔야 합니다."
        confirm(title: "정말 탈퇴하시겠습니까?", detail: detail, ok: "탈퇴하기", danger: true) { [weak self] ok in
            guard ok, let self = self else { return }
            self.leaving = true
            self.render()
            self.action("leave")
        }
    }

    // ── 프로필 수정 ─────────────────────────────────────────────

    private func editTapped() {
        let vc = MeEditViewController(service: service, profile: profile, contact: contact) { [weak self] in
            self?.flash("저장했습니다.")
            self?.changed()
        }
        vc.modalPresentationStyle = .pageSheet
        present(vc, animated: true)
    }

    /// 내 값이 바뀌었다 — 다시 받고, 웹의 `useAuth`와 껍데기의 명단도 맞춘다.
    private func changed() {
        loadScreen()
        action("refresh")
        Task { await ShellController.current?.refreshPeople() }
    }

    // ── 프로필 사진 ─────────────────────────────────────────────

    @objc private func photoTapped() {
        guard !photoBusy else { return }
        var cfg = PHPickerConfiguration()
        cfg.filter = .images
        cfg.selectionLimit = 1
        let p = PHPickerViewController(configuration: cfg)
        p.delegate = self
        present(p, animated: true)
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let item = results.first?.itemProvider, item.canLoadObject(ofClass: UIImage.self) else { return }
        photoBusy = true; render()
        item.loadObject(ofClass: UIImage.self) { [weak self] obj, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                guard let img = obj as? UIImage, let data = Self.shrink(img, edge: 400) else {
                    self.photoBusy = false; self.render()
                    self.flash("사진을 못 불러왔습니다.", error: true)
                    return
                }
                self.upload(data)
            }
        }
    }

    /// 긴 변 `edge`까지 줄인 JPEG(웹 `shrinkImage(…, 400)`).
    private static func shrink(_ img: UIImage, edge: CGFloat) -> Data? {
        let s = img.size
        let k = min(1, edge / max(s.width, s.height, 1))
        let size = CGSize(width: max(1, (s.width * k).rounded()), height: max(1, (s.height * k).rounded()))
        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.scale = 1
        let out = UIGraphicsImageRenderer(size: size, format: fmt).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
        return out.jpegData(compressionQuality: 0.82)
    }

    private func upload(_ data: Data) {
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            let me = self.service.config.user
            /* **자기 폴더에만** — 저장소 정책이 그것만 허용한다. 시각을 넣어 주소를 매번 바꾼다. */
            let path = "\(me)/\(Int(Date().timeIntervalSince1970 * 1000)).jpg"
            do {
                _ = try await self.service.request("storage/v1/object/avatars/\(path)", method: "POST",
                                                   bytes: data, contentType: "image/jpeg", timeout: 60)
                let url = self.service.config.url.appendingPathComponent("storage/v1/object/public/avatars/\(path)").absoluteString
                try await self.service.patchRow("profiles", id: me, ["avatar_url": url])
                self.photoBusy = false
                self.flash("프로필 사진을 바꿨습니다.")
                self.changed()
            } catch {
                self.photoBusy = false
                self.render()
                self.flash(error.localizedDescription, error: true)
            }
        }
    }
}

/*
 * **프로필 수정** — `내 정보` 위에 뜨는 시트(웹에서도 그 화면 안에 펴지는 칸이라
 * 주소가 없다 — 정산 만들기와 같은 짜임). 받는 것은 여섯이고 다 필수다 —
 * 사용자가 정해 준 차례 그대로 **닉네임 · 전화번호 · 생년월일 · 성별 ·
 * 차량번호 · 거주지역**(웹 `GenderAge`와 같은 칸이다).
 *
 * **저장되는 곳이 갈린다** — 이름·성별·태어난 해·지역은 `profiles`(공개),
 * 전화·차량·달과 날·양력/음력은 `profile_private`(운영진만). **`profiles`를 먼저
 * 쓴다** — 첫 앱관리자를 가리는 트리거가 `profile_private`에 걸려 있고 이름은
 * `profiles`에서 읽는다(웹 `saveMyProfile`).
 */
final class MeEditViewController: FormScreenController {
    private let profile: AppProfile?
    private let contact: AppContact?
    private let onDone: () -> Void

    private static let birthMin = 1930, birthMax = 2020, regionMax = 8   // 웹 `BIRTH_MIN`·`BIRTH_MAX`·`REGION_MAX`

    private let nameField = FormTextField(max: 20)
    private let phoneField = FormTextField(hint: "010-0000-0000", max: 20)
    private let yearField = FormTextField(hint: "1975", max: 4)
    private let monthField = FormTextField(hint: "5", max: 2)
    private let dayField = FormTextField(hint: "10", max: 2)
    private let carField = FormTextField(hint: "12가 3456", max: 20)
    private let regionField = FormTextField(hint: "광산구", max: 8)
    private let solarBtn = OptButton(), lunarBtn = OptButton()
    private let maleBtn = OptButton(), femaleBtn = OptButton()
    private var cal = "solar"
    private var gender: String?

    init(service: NativeChatService, profile: AppProfile?, contact: AppContact?, onDone: @escaping () -> Void) {
        self.profile = profile
        self.contact = contact
        self.onDone = onDone
        super.init(service: service, title: "프로필 수정")
        isModalInPresentation = true
    }
    required init?(coder: NSCoder) { fatalError() }

    override func goBack() { view.endEditing(true); dismiss(animated: true) }

    override func loadScreen() {
        guard !built else { return }
        built = true
        nameField.text = profile?.name
        phoneField.text = contact?.phone
        phoneField.keyboardType = .phonePad
        for f in [yearField, monthField, dayField] { f.keyboardType = .numberPad }
        yearField.text = profile?.birthYear.map { String($0) }
        if let md = contact?.birthMd, md.count >= 5 {
            monthField.text = String(Int(md.prefix(2)) ?? 0)
            dayField.text = String(Int(md.suffix(2)) ?? 0)
        }
        cal = contact?.birthCal ?? "solar"
        gender = (profile?.gender == "m" || profile?.gender == "f") ? profile?.gender : nil
        carField.text = contact?.car
        regionField.text = profile?.region

        solarBtn.setTitle("양력"); lunarBtn.setTitle("음력")
        maleBtn.setTitle("남"); femaleBtn.setTitle("여")
        /* **양력/음력은 끌 수 없다** — 어느 달력인지 모르면 생일이 언제인지 알 길이 없다.
           성별은 누른 것을 다시 누르면 '안 정함'으로 돌아간다(저장할 때 막는다). */
        solarBtn.addAction(UIAction { [weak self] _ in self?.cal = "solar"; self?.paint() }, for: .touchUpInside)
        lunarBtn.addAction(UIAction { [weak self] _ in self?.cal = "lunar"; self?.paint() }, for: .touchUpInside)
        maleBtn.addAction(UIAction { [weak self] _ in self?.gender = self?.gender == "m" ? nil : "m"; self?.paint() }, for: .touchUpInside)
        femaleBtn.addAction(UIAction { [weak self] _ in self?.gender = self?.gender == "f" ? nil : "f"; self?.paint() }, for: .touchUpInside)
        paint()

        func pair(_ a: UIView, _ b: UIView) -> UIStackView {
            let r = UIStackView(arrangedSubviews: [a, b]); r.axis = .horizontal; r.spacing = 8; r.distribution = .fillEqually
            return r
        }
        func unit(_ t: String) -> UILabel {
            let l = mkLabel(t, size: 15, color: AppSkin.dim)
            l.setContentHuggingPriority(.required, for: .horizontal)
            return l
        }
        let birthRow = UIStackView(arrangedSubviews: [yearField, unit("년"), monthField, unit("월"), dayField, unit("일")])
        birthRow.axis = .horizontal
        birthRow.alignment = .center
        birthRow.spacing = 6
        yearField.widthAnchor.constraint(equalTo: monthField.widthAnchor, multiplier: 1.6).isActive = true
        monthField.widthAnchor.constraint(equalTo: dayField.widthAnchor).isActive = true
        let birth = UIStackView(arrangedSubviews: [pair(solarBtn, lunarBtn), birthRow])
        birth.axis = .vertical
        birth.spacing = 8

        card([field("닉네임", nameField),
              field("전화번호", phoneField),
              field("생년월일", birth),
              field("성별", pair(maleBtn, femaleBtn)),
              field("차량번호", carField),
              field("거주지역", regionField)])
        showForm(saveTitle: "저장")
    }

    private func paint() {
        solarBtn.on = cal == "solar"; lunarBtn.on = cal == "lunar"
        maleBtn.on = gender == "m"; femaleBtn.on = gender == "f"
    }

    private func t(_ f: UITextField) -> String { (f.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }

    override func saveTapped() {
        guard !saving else { return }
        let name = t(nameField), phone = t(phoneField), car = t(carField), region = t(regionField)
        if name.isEmpty { flash("닉네임을 적어 주세요.", error: true); return }
        if phone.isEmpty { flash("전화번호를 적어 주세요.", error: true); return }
        if car.isEmpty { flash("차량번호를 적어 주세요.", error: true); return }
        guard let g = gender else { flash("성별을 골라 주세요.", error: true); return }
        /* 웹 `birthValue`·`birthMd`와 같은 잣대다. */
        let yText = t(yearField)
        if yText.isEmpty { flash("태어난 해를 적어 주세요.", error: true); return }
        guard let year = Int(yText), year >= Self.birthMin, year <= Self.birthMax else {
            flash("태어난 해는 \(Self.birthMin)~\(Self.birthMax) 사이로 적어 주세요.", error: true); return
        }
        let mText = t(monthField), dText = t(dayField)
        if mText.isEmpty && dText.isEmpty { flash("생일의 달과 날을 적어 주세요.", error: true); return }
        guard let m = Int(mText), (1...12).contains(m), let d = Int(dText), (1...31).contains(d) else {
            flash("생일을 다시 확인해 주세요.", error: true); return
        }
        if region.isEmpty { flash("거주지역을 적어 주세요.", error: true); return }
        let md = String(format: "%02d-%02d", m, d)
        view.endEditing(true)
        setSave("저장", busy: true)
        let me = service.config.user
        let priv: ChatJSON = ["phone": phone, "car": car, "birth_md": md, "birth_cal": cal]
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            do {
                try await self.service.patchRow("profiles", id: me,
                                                ["name": name, "gender": g, "birth_year": year, "region": String(region.prefix(Self.regionMax))])
                /* `profile_private`는 줄이 없을 수 있다 — 고쳐 보고 없으면 넣는다(웹의 upsert와 같은 결과). */
                let r = try await self.service.request("rest/v1/profile_private", query: [("id", "eq.\(me)")],
                                                       method: "PATCH", body: priv) as? [ChatJSON]
                if r?.isEmpty != false {
                    var row = priv; row["id"] = me
                    _ = try await self.service.insertRows("profile_private", [row])
                }
                self.onDone()
                self.dismiss(animated: true)
            } catch {
                self.setSave("저장", busy: false)
                self.flash(error.localizedDescription, error: true)
            }
        }
    }
}
