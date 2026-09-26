import UIKit

/*
 * **회원 명단** — 웹의 `screens/Members.tsx`를 Swift로 옮긴 것이다
 * (`docs/아이폰-네이티브.md` 1단계). 운영진에게는 **가입 승인 창구**이자
 * **임명 창구**다 — 카카오로 로그인만 하면 누구나 `pending`으로 들어오고,
 * 승인하지 않으면 아무것도 볼 수 없다.
 *
 * **규칙은 웹과 같다 — 한쪽만 고치지 말 것:**
 *  - 이름표는 `83/신성호/광산구`(`AppProfile.label`).
 *  - 차례는 이름·나이·지역·성별 넷, **모르는 값은 늘 뒤로**, 같은 값끼리는
 *    이름순. 기본은 이름순이고 기억해 두지 않는다.
 *  - **거른 뒤에 줄 세운다** — 반대로 하면 찾을 때마다 차례가 다시 잡히는
 *    것처럼 보인다.
 *  - 열둘(`findAt`)을 넘으면 찾기 칸이 나온다 — 이름·지역·차량번호·전화번호.
 *  - **전화번호·차량번호·생일·참석 횟수는 운영진에게만.** 회원에게는 애초에
 *    안 실려 오고(정책), 참석 횟수는 함수가 막으면 **줄째 안 적는다.**
 *  - 임명은 한 계단씩 — 앱관리자만 운영자를, 운영자 이상이 부운영자·총무를.
 *    DB가 같은 규칙을 다시 본다.
 *
 * 관리는 **그 줄을 누르면** 창(액션시트)이 뜬다 — 웹의 `관리` 단추 몫이다.
 */
final class MembersViewController: NativeScreenController, UITableViewDataSource, UITableViewDelegate {
    /// 실시간 — 이 표들이 바뀌면 보이는 동안 다시 받는다(5단계 · `AppLive`).
    override var liveTables: Set<String> { ["profiles"] }
    static let findAt = 12

    private enum Sort: Int { case name = 0, age, region, gender }

    private let table = UITableView(frame: .zero, style: .plain)
    private let search = UITextField()
    private let sortCtl = UISegmentedControl(items: ["이름", "나이", "지역", "성별"])
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let refresh = UIRefreshControl()
    private let controls = UIStackView()
    private var searchH: NSLayoutConstraint?

    private var all: [AppProfile] = []
    private var contacts: [String: AppContact] = [:]
    private var attend: [String: Int]?
    private var me: AppProfile?
    private var sections: [(title: String, color: UIColor, rows: [AppProfile])] = []
    private var busy = false

    private var myRole: String { me?.role ?? "member" }
    private var isAdmin: Bool { AppRole.isAdmin(myRole) }
    private var isOwner: Bool { AppRole.isOwner(myRole) }
    private var isSuper: Bool { AppRole.isSuper(myRole) }

    init(service: NativeChatService) { super.init(service: service, title: "회원 명단") }
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        controls.axis = .vertical
        controls.spacing = 8
        controls.translatesAutoresizingMaskIntoConstraints = false
        controls.isLayoutMarginsRelativeArrangement = true
        controls.layoutMargins = UIEdgeInsets(top: 4, left: 16, bottom: 8, right: 16)

        /* 찾기 칸 — 안내 글씨는 `placeholder`가 아니라 직접 그린다는 웹 규칙은
           iOS 조합 번쩍임 때문이었다. 네이티브 칸은 조합을 쓰므로 그 자국이
           없어 그대로 둔다. */
        search.placeholder = "이름 · 지역 · 차량번호 · 전화번호"
        search.font = .systemFont(ofSize: 16)
        search.textColor = AppSkin.text
        search.backgroundColor = AppSkin.surface
        search.layer.cornerRadius = AppSkin.radiusSm
        search.layer.borderWidth = 1
        search.layer.borderColor = AppSkin.line.cgColor
        search.clearButtonMode = .whileEditing
        search.returnKeyType = .search
        search.autocorrectionType = .no
        let pad = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 44))
        search.leftView = pad; search.leftViewMode = .always
        search.addTarget(self, action: #selector(searchChanged), for: .editingChanged)
        search.addTarget(self, action: #selector(searchDone), for: .editingDidEndOnExit)
        let h = search.heightAnchor.constraint(equalToConstant: 44)
        h.isActive = true
        searchH = h
        search.isHidden = true

        sortCtl.selectedSegmentIndex = 0
        sortCtl.selectedSegmentTintColor = AppSkin.surface
        sortCtl.setTitleTextAttributes([.foregroundColor: AppSkin.dim, .font: UIFont.systemFont(ofSize: 13, weight: .semibold)], for: .normal)
        sortCtl.setTitleTextAttributes([.foregroundColor: AppSkin.text, .font: UIFont.systemFont(ofSize: 13, weight: .bold)], for: .selected)
        sortCtl.addTarget(self, action: #selector(sortChanged), for: .valueChanged)

        controls.addArrangedSubview(search)
        controls.addArrangedSubview(sortCtl)

        table.translatesAutoresizingMaskIntoConstraints = false
        table.dataSource = self; table.delegate = self
        table.backgroundColor = AppSkin.bg
        table.separatorStyle = .none
        table.register(MemberCell.self, forCellReuseIdentifier: "m")
        table.rowHeight = UITableView.automaticDimension
        table.estimatedRowHeight = 64
        table.keyboardDismissMode = .onDrag
        table.contentInset = UIEdgeInsets(top: 0, left: 0, bottom: 24, right: 0)
        refresh.addTarget(self, action: #selector(pulled), for: .valueChanged)
        table.refreshControl = refresh

        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.hidesWhenStopped = true

        body.addSubview(controls); body.addSubview(table); body.addSubview(spinner)
        NSLayoutConstraint.activate([
            controls.topAnchor.constraint(equalTo: body.topAnchor),
            controls.leadingAnchor.constraint(equalTo: body.leadingAnchor),
            controls.trailingAnchor.constraint(equalTo: body.trailingAnchor),
            table.topAnchor.constraint(equalTo: controls.bottomAnchor),
            table.leadingAnchor.constraint(equalTo: body.leadingAnchor),
            table.trailingAnchor.constraint(equalTo: body.trailingAnchor),
            table.bottomAnchor.constraint(equalTo: body.bottomAnchor),
            spinner.centerXAnchor.constraint(equalTo: body.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: body.centerYAnchor)
        ])
    }

    // ── 받아 오기 ────────────────────────────────────────────────

    override func loadScreen() {
        if all.isEmpty { spinner.startAnimating() }
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            do {
                let list = try await self.service.profiles()
                self.me = list.first { $0.id == self.service.config.user }
                /* 표가 없는 저장소는 `contacts`가 빈 것으로 물러난다. */
                self.contacts = await self.service.contacts()
                /* 참석 횟수는 **운영진만 부른다** — 회원에게는 애초에 안 보이는
                   값이라 헛조회를 내보낼 이유가 없다(DB도 막혀 있다). */
                if self.isAdmin { self.attend = await self.service.attendance() }
                else { self.attend = nil }
                self.all = list
                self.rebuild()
            } catch {
                self.flash(error.localizedDescription, error: true)
            }
            self.spinner.stopAnimating()
            self.refresh.endRefreshing()
        }
    }

    @objc private func pulled() { loadScreen() }
    @objc private func searchChanged() { rebuild() }
    @objc private func searchDone() { search.resignFirstResponder() }
    @objc private func sortChanged() { rebuild() }

    private func byName(_ a: AppProfile, _ b: AppProfile) -> Bool {
        a.name.localizedStandardCompare(b.name) == .orderedAscending
    }

    /// 차례 넷 — 웹 `sortPeople`과 같다. **모르는 값은 뒤로.**
    private func sorted(_ list: [AppProfile]) -> [AppProfile] {
        let key = Sort(rawValue: sortCtl.selectedSegmentIndex) ?? .name
        switch key {
        case .age:
            return list.sorted { a, b in
                let ya = a.birthYear ?? 9999, yb = b.birthYear ?? 9999
                return ya != yb ? ya < yb : byName(a, b)
            }
        case .region:
            return list.sorted { a, b in
                let ra = a.region, rb = b.region
                if (ra == nil) != (rb == nil) { return ra != nil }
                if let ra = ra, let rb = rb, ra != rb { return ra.localizedStandardCompare(rb) == .orderedAscending }
                return byName(a, b)
            }
        case .gender:
            let rank: (String?) -> Int = { $0 == "m" ? 0 : $0 == "f" ? 1 : 2 }
            return list.sorted { a, b in
                let ga = rank(a.gender), gb = rank(b.gender)
                return ga != gb ? ga < gb : byName(a, b)
            }
        case .name:
            return list.sorted(by: byName)
        }
    }

    private func rebuild() {
        let pending = all.filter { $0.role == "pending" }
        let members = all.filter { $0.role != "pending" && $0.role != "banned" }
        let banned = all.filter { $0.role == "banned" }

        let big = members.count > Self.findAt
        search.isHidden = !big
        let q = (search.text ?? "").replacingOccurrences(of: " ", with: "").lowercased()
        let found: [AppProfile] = big && !q.isEmpty ? members.filter { p in
            let c = contacts[p.id]
            return [p.name, p.region ?? "", c?.car ?? "", c?.phone ?? ""]
                .contains { $0.replacingOccurrences(of: " ", with: "").lowercased().contains(q) }
        } : members
        let shown = sorted(found)

        var s: [(String, UIColor, [AppProfile])] = []
        if isAdmin && !pending.isEmpty { s.append(("가입 신청 \(pending.count)명", AppSkin.warn, sorted(pending))) }
        s.append(("회원 \(members.count)명" + (shown.count != members.count ? " · \(shown.count)명 찾음" : ""), AppSkin.dim, shown))
        if isAdmin && !banned.isEmpty { s.append(("추방 \(banned.count)명", AppSkin.danger, sorted(banned))) }
        sections = s.map { (title: $0.0, color: $0.1, rows: $0.2) }
        table.reloadData()
    }

    // ── 표 ───────────────────────────────────────────────────────

    func numberOfSections(in tableView: UITableView) -> Int { sections.count }
    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { sections[section].rows.count }

    func tableView(_ tableView: UITableView, viewForHeaderInSection section: Int) -> UIView? {
        let v = UIView()
        v.backgroundColor = AppSkin.bg
        let l = UILabel()
        l.text = sections[section].title
        l.font = .systemFont(ofSize: 13, weight: .bold)
        l.textColor = sections[section].color
        l.translatesAutoresizingMaskIntoConstraints = false
        v.addSubview(l)
        NSLayoutConstraint.activate([
            l.leadingAnchor.constraint(equalTo: v.leadingAnchor, constant: 16),
            l.trailingAnchor.constraint(lessThanOrEqualTo: v.trailingAnchor, constant: -16),
            l.bottomAnchor.constraint(equalTo: v.bottomAnchor, constant: -6),
            l.topAnchor.constraint(equalTo: v.topAnchor, constant: 14)
        ])
        return v
    }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "m", for: indexPath) as! MemberCell
        let p = sections[indexPath.section].rows[indexPath.row]
        let c = contacts[p.id]
        var subs: [String] = []
        /* 참석 횟수·차량번호·전화번호 한 줄 — 운영진에게만(웹과 같은 잣대). */
        if let attend = attend { subs.append("올해 \(attend[p.id] ?? 0)회") }
        if isAdmin { subs.append(c?.car ?? "차량번호 미등록") }
        if isAdmin, let phone = c?.phone { subs.append(phone) }
        /* 생일은 **안 적은 사람은 줄째 안 그린다** — `1975년`만 적으면 받아 둔
           것처럼 보인다. */
        var birth = ""
        if isAdmin, let md = c?.birthMd {
            birth = "🎂 " + AppDate.birthLabel(year: p.birthYear, md: md, cal: c?.birthCal ?? "solar")
        }
        cell.fill(p, mine: p.id == service.config.user, sub: subs.joined(separator: " · "), birth: birth,
                  manageable: manageable(p), first: indexPath.row == 0,
                  last: indexPath.row == sections[indexPath.section].rows.count - 1)
        return cell
    }

    /// 이 사람을 내가 만질 수 있는가 — 나 자신·나보다 위는 못 만진다(웹과 같다).
    private func manageable(_ p: AppProfile) -> Bool {
        guard isAdmin, p.id != service.config.user else { return false }
        let above = p.role == "superadmin" || (p.role == "admin" && !isSuper)
        return !above
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        let p = sections[indexPath.section].rows[indexPath.row]
        guard manageable(p), !busy else { return }
        showActions(p, at: tableView.cellForRow(at: indexPath))
    }

    // ── 관리 ─────────────────────────────────────────────────────

    /// 웹의 `관리` 단추가 펼치던 것들 — 줄을 누르면 창으로 뜬다.
    private func showActions(_ p: AppProfile, at cell: UIView?) {
        let name = p.name.isEmpty ? "이 분" : p.name
        let a = UIAlertController(title: p.label.isEmpty ? "이름 없음" : p.label,
                                  message: AppRole.label[p.role], preferredStyle: .actionSheet)
        if p.role == "pending" {
            a.addAction(UIAlertAction(title: "승인", style: .default) { [weak self] _ in self?.setRole(p, "member") })
            a.addAction(UIAlertAction(title: "거절", style: .destructive) { [weak self] _ in
                self?.confirm(title: "\(name)의 가입을 거절할까요?",
                              detail: "명단에서 사라집니다. 그 사람이 다시 로그인하면 가입 신청부터 다시 하게 됩니다.",
                              ok: "거절", danger: true) { ok in if ok { self?.reject(p) } }
            })
        } else if p.role == "banned" {
            a.addAction(UIAlertAction(title: "대기로 되돌리기", style: .default) { [weak self] _ in self?.setRole(p, "pending") })
        } else {
            /* **앱관리자만 운영자를 임명한다.** */
            if isSuper {
                a.addAction(UIAlertAction(title: p.role == "admin" ? "운영자 해제" : "운영자 임명", style: .default) { [weak self] _ in
                    self?.setRole(p, p.role == "admin" ? "member" : "admin")
                })
            }
            /* **운영자 이상이 부운영자·총무를 인원 제한 없이 임명한다.** */
            if isOwner && p.role != "admin" {
                a.addAction(UIAlertAction(title: p.role == "staff" ? "부운영자 해제" : "부운영자 임명", style: .default) { [weak self] _ in
                    self?.setRole(p, p.role == "staff" ? "member" : "staff")
                })
                a.addAction(UIAlertAction(title: p.role == "treasurer" ? "총무 해제" : "총무 임명", style: .default) { [weak self] _ in
                    self?.setRole(p, p.role == "treasurer" ? "member" : "treasurer")
                })
            }
            a.addAction(UIAlertAction(title: "내보내기 (대기로)", style: .destructive) { [weak self] _ in
                self?.confirm(title: "\(name)님을 내보낼까요?",
                              detail: "승인 대기 상태로 되돌아가 아무것도 볼 수 없게 됩니다. 신청 기록은 남습니다.",
                              ok: "내보내기", danger: true) { ok in if ok { self?.setRole(p, "pending") } }
            })
            a.addAction(UIAlertAction(title: "추방", style: .destructive) { [weak self] _ in
                self?.confirm(title: "\(name)을 추방할까요?",
                              detail: "앱을 볼 수 없게 되고, 다시 로그인해도 가입 신청이 되지 않습니다. 나중에 명단 아래쪽에서 되돌릴 수 있습니다.",
                              ok: "추방", danger: true) { ok in if ok { self?.setRole(p, "banned") } }
            })
        }
        a.addAction(UIAlertAction(title: "취소", style: .cancel))
        /* 아이패드는 붙일 자리가 없으면 그대로 죽는다 — 누른 줄에 붙인다. */
        if let pop = a.popoverPresentationController {
            pop.sourceView = cell ?? view
            pop.sourceRect = cell?.bounds ?? CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        }
        present(a, animated: true)
    }

    private func setRole(_ p: AppProfile, _ role: String) {
        guard !busy else { return }
        busy = true
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            defer { self.busy = false }
            do {
                try await self.service.setRole(p.id, role)
                let name = p.name
                let msg: String
                if role == "member" && p.role == "pending" { msg = "\(name)님을 승인했습니다." }
                else if role == "member" { msg = "\(name)님의 \(AppRole.label[p.role] ?? "직책")를 풀었습니다." }
                else if role == "banned" { msg = "\(name)님을 추방했습니다." }
                else if role == "pending" { msg = "\(name)님을 대기로 되돌렸습니다." }
                else { msg = "\(name)님을 \(AppRole.label[role] ?? role)로 임명했습니다." }
                self.flash(msg)
                self.loadScreen()
            } catch {
                self.flash(error.localizedDescription, error: true)
            }
        }
    }

    private func reject(_ p: AppProfile) {
        guard !busy else { return }
        busy = true
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            defer { self.busy = false }
            do {
                try await self.service.deleteProfile(p.id)
                self.flash("거절했습니다.")
                self.loadScreen()
            } catch {
                self.flash(error.localizedDescription, error: true)
            }
        }
    }
}

/**
 * 명단 한 줄 — 얼굴(36pt · 남녀 테두리) · 이름표 + 직책 표 · 운영진 줄 · 생일 줄.
 * 흰 카드 안에 줄이 쌓이고 사이는 가는 선이다(웹 `.member-row`와 같은 꼴).
 */
final class MemberCell: UITableViewCell {
    private let card = UIView()
    private let face = AvatarView()
    private let nameLabel = UILabel()
    private let subLabel = UILabel()
    private let birthLabel = UILabel()
    private let chevron = UIImageView(image: UIImage(systemName: "ellipsis"))
    private let rule = UIView()
    private let column = UIStackView()

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        backgroundColor = .clear
        contentView.backgroundColor = .clear
        selectionStyle = .none
        card.backgroundColor = AppSkin.surface
        card.translatesAutoresizingMaskIntoConstraints = false
        face.translatesAutoresizingMaskIntoConstraints = false
        /* 얼굴의 예비 바탕은 보라 목록용(흰색 25%)이라 밝은 카드에서는 안 보인다. */
        face.backgroundColor = AppSkin.faint
        nameLabel.font = .systemFont(ofSize: 15, weight: .bold)
        nameLabel.textColor = AppSkin.text
        nameLabel.numberOfLines = 1
        nameLabel.lineBreakMode = .byTruncatingTail
        subLabel.font = .systemFont(ofSize: 12)
        subLabel.textColor = AppSkin.faint
        subLabel.numberOfLines = 1
        birthLabel.font = .systemFont(ofSize: 12)
        birthLabel.textColor = AppSkin.faint
        birthLabel.numberOfLines = 1
        column.axis = .vertical
        column.spacing = 2
        column.translatesAutoresizingMaskIntoConstraints = false
        column.addArrangedSubview(nameLabel)
        column.addArrangedSubview(subLabel)
        column.addArrangedSubview(birthLabel)
        chevron.tintColor = AppSkin.faint
        chevron.translatesAutoresizingMaskIntoConstraints = false
        chevron.contentMode = .scaleAspectFit
        rule.backgroundColor = AppSkin.line
        rule.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(card)
        card.addSubview(face); card.addSubview(column); card.addSubview(chevron); card.addSubview(rule)
        NSLayoutConstraint.activate([
            card.topAnchor.constraint(equalTo: contentView.topAnchor),
            card.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
            card.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            card.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
            face.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 12),
            face.centerYAnchor.constraint(equalTo: card.centerYAnchor),
            face.widthAnchor.constraint(equalToConstant: 36),
            face.heightAnchor.constraint(equalToConstant: 36),
            column.leadingAnchor.constraint(equalTo: face.trailingAnchor, constant: 12),
            column.trailingAnchor.constraint(equalTo: chevron.leadingAnchor, constant: -8),
            column.topAnchor.constraint(equalTo: card.topAnchor, constant: 10),
            column.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -10),
            chevron.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -12),
            chevron.centerYAnchor.constraint(equalTo: card.centerYAnchor),
            chevron.widthAnchor.constraint(equalToConstant: 18),
            chevron.heightAnchor.constraint(equalToConstant: 18),
            rule.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 12),
            rule.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -12),
            rule.bottomAnchor.constraint(equalTo: card.bottomAnchor),
            rule.heightAnchor.constraint(equalToConstant: 1),
            card.heightAnchor.constraint(greaterThanOrEqualToConstant: 56)
        ])
    }
    required init?(coder: NSCoder) { fatalError() }

    func fill(_ p: AppProfile, mine: Bool, sub: String, birth: String, manageable: Bool, first: Bool, last: Bool) {
        face.show(url: p.avatar, letter: p.name, edge: p.edge, size: 36)
        let text = NSMutableAttributedString(string: p.label.isEmpty ? "이름 없음" : p.label,
                                             attributes: [.font: UIFont.systemFont(ofSize: 15, weight: .bold), .foregroundColor: AppSkin.text])
        if let color = AppRole.tagColor(p.role), let tag = AppRole.label[p.role] {
            text.append(NSAttributedString(string: "  " + tag,
                                           attributes: [.font: UIFont.systemFont(ofSize: 11.5, weight: .heavy), .foregroundColor: color]))
        }
        if mine {
            text.append(NSAttributedString(string: "  (나)",
                                           attributes: [.font: UIFont.systemFont(ofSize: 11.5), .foregroundColor: AppSkin.faint]))
        }
        nameLabel.attributedText = text
        subLabel.text = sub; subLabel.isHidden = sub.isEmpty
        birthLabel.text = birth; birthLabel.isHidden = birth.isEmpty
        chevron.isHidden = !manageable
        rule.isHidden = last
        /* 카드 모서리 — 묶음의 첫 줄과 끝 줄만 둥글다. */
        card.layer.cornerRadius = AppSkin.radius
        card.layer.cornerCurve = .continuous
        var corners: CACornerMask = []
        if first { corners.insert(.layerMinXMinYCorner); corners.insert(.layerMaxXMinYCorner) }
        if last { corners.insert(.layerMinXMaxYCorner); corners.insert(.layerMaxXMaxYCorner) }
        card.layer.maskedCorners = corners
        card.layer.masksToBounds = true
    }
}
