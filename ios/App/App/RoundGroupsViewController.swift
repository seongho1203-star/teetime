import UIKit

/*
 * **조 편성** — 웹 `screens/RoundGroups.tsx`를 Swift로 옮긴 것이다
 * (`docs/아이폰-네이티브.md` 3단계). 주소는 `/rounds/<id>/groups`.
 *
 * **규칙은 웹과 같다 — 한쪽만 고치지 말 것:**
 *  - **모집을 연 사람과 운영진만** 들어온다(DB `set_round_groups`도 같게 막혀 있다).
 *  - **확정자만** 짠다. 대기에서 올라온 사람은 `미배정`으로 뜬다.
 *  - **`p_grps`가 곧 전부다** — 확정자 전원을 실어 보낸다(목록에 없는 사람은
 *    조에서 빠진 것으로 본다). 일부만 보내면 남이 조에서 사라진다.
 *  - **빈 조 하나를 늘 더 보여 준다** — 그 빈 칸이 곧 `새 조 만들기`다.
 *  - 조가 여섯을 넘으면 칩 대신 고르는 단추(메뉴)다(웹 `CHIPS_UP_TO`).
 *  - 조별 시각은 **시·분만** 받고 저장할 때 라운드의 한국 날짜에 붙인다.
 *    **쓰는 조의 시각만** 보낸다(없는 조의 시각이 DB에 굳지 않게).
 *  - 나누는 규칙은 아래 `GroupRules`다 — 웹 `lib/groups.ts`를 그대로 옮겼다.
 *  - 끌어서 옮기지 않는다 — 칩을 눌러 옮기고, 눌린 칩을 다시 누르면 미배정.
 */
final class RoundGroupsViewController: FormScreenController {
    private let roundId: String
    private var round: AppRound?
    private var names: [String: AppProfile] = [:]
    private var role = "member"

    /// 확정자 — 신청 순서대로(나누는 규칙이 이 순서를 밑감으로 쓴다).
    private var confirmed: [AppSignup] = []
    /// 사람 → 조 번호. `nil`이면 아직 안 넣은 것이다.
    private var grp: [String: Int] = [:]
    /// 조 번호 → 시각(한국 시각의 시·분).
    private var tees: [Int: (h: Int, m: Int)] = [:]
    private var size = 4                       // 웹 `GROUP_SIZE`
    private static let maxGroups = 20          // 웹 `MAX_GROUPS`
    private static let chipsUpTo = 6           // 웹 `CHIPS_UP_TO`

    /// 조 카드들이 드는 자리 — 옮길 때마다 여기만 다시 그린다.
    private let groupsBox = UIStackView()

    init(service: NativeChatService, id: String) {
        roundId = id
        super.init(service: service, title: "조 편성")
    }
    required init?(coder: NSCoder) { fatalError() }

    override func loadScreen() {
        guard !built else { return }
        spinner.startAnimating()
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            do {
                async let r = self.service.round(self.roundId)
                async let p = self.service.peopleById()
                async let t = self.service.groupTees(self.roundId)
                async let role = self.service.myRole()
                self.round = try await r
                self.names = (try? await p) ?? [:]
                let teeIso = await t
                self.role = await role
                for (k, v) in teeIso {
                    guard let n = Int(k) else { continue }
                    let c = WhenPicker.calendar.dateComponents([.hour, .minute], from: NativeChatRows.date(v))
                    self.tees[n] = (c.hour ?? 0, c.minute ?? 0)
                }
            } catch { self.showNotice(error.localizedDescription); return }
            self.build()
        }
    }

    private func build() {
        built = true
        guard let r = round else { showNotice("없는 라운드입니다."); return }
        guard AppRole.isAdmin(role) || r.createdBy == service.config.user else {
            showNotice("모집을 연 사람과 운영진만 조를 짤 수 있습니다."); return
        }
        confirmed = r.confirmed.sorted { $0.seq < $1.seq }
        for s in confirmed { if let g = s.grp { grp[s.userId] = g } }

        card([mkLabel(r.place, size: 17, weight: .bold, lines: 0),
              mkLabel("\(AppDate.fullDate(r.teeAt)) · 확정 \(confirmed.count)명", size: 13, color: AppSkin.dim, lines: 0)],
             spacing: 4)

        guard !confirmed.isEmpty else {
            let l = mkLabel("아직 확정된 참가자가 없습니다.\n신청이 들어오면 그때 조를 짜 주세요.",
                            size: 14, color: AppSkin.faint, lines: 0)
            l.textAlignment = .center
            stack.addArrangedSubview(l)
            spinner.stopAnimating()
            scroll.isHidden = false
            return
        }

        buildConditions()
        groupsBox.axis = .vertical
        groupsBox.spacing = 10
        stack.addArrangedSubview(groupsBox)

        let clear = UIButton(type: .system)
        appButton(clear, title: "조 편성 지우기", color: AppSkin.dim, filled: false)
        clear.addTarget(self, action: #selector(clearTapped), for: .touchUpInside)
        let clearRow = UIStackView(arrangedSubviews: [clear, UIView()])
        clearRow.axis = .horizontal
        stack.addArrangedSubview(clearRow)

        paintGroups()
        showForm(saveTitle: "저장")
    }

    // ── 조 편성 조건 ─────────────────────────────────────────────

    /* 대개 여기서 한 번 누르면 끝나고, 손으로 옮기는 건 그 뒤의 손질이다.
       **누르면 바로 나뉜다**(`적용`을 따로 두지 않는다). **분홍은 `저장` 하나뿐이다.** */
    private func buildConditions() {
        let title = mkLabel("조 편성 조건", size: 16, weight: .bold)
        let sizes = UISegmentedControl(items: [2, 3, 4, 5].map { "\($0)명" })
        sizes.selectedSegmentIndex = size - 2
        sizes.accessibilityLabel = "한 조에"
        sizes.addTarget(self, action: #selector(sizeChanged(_:)), for: .valueChanged)
        sizes.setContentHuggingPriority(.required, for: .horizontal)
        let sizeRow = UIStackView(arrangedSubviews: [title, UIView(), mkLabel("한 조에", size: 12, color: AppSkin.faint), sizes])
        sizeRow.axis = .horizontal
        sizeRow.alignment = .center
        sizeRow.spacing = 6

        var btns: [UIButton] = []
        for (i, m) in GroupRules.Mode.allCases.enumerated() {
            let b = UIButton(type: .system)
            appButton(b, title: m.label, color: AppSkin.text, filled: false)
            b.setContentHuggingPriority(.defaultLow, for: .horizontal)
            b.tag = i
            b.accessibilityHint = m.hint
            b.addTarget(self, action: #selector(modeTapped(_:)), for: .touchUpInside)
            btns.append(b)
        }
        func pair(_ a: UIButton, _ b: UIButton) -> UIStackView {
            let r = UIStackView(arrangedSubviews: [a, b])
            r.axis = .horizontal; r.spacing = 8; r.distribution = .fillEqually
            return r
        }
        var views: [UIView] = [sizeRow, pair(btns[0], btns[1]), pair(btns[2], btns[3]),
                               mkLabel("누르면 바로 나뉘고, 그다음 아래에서 손으로 옮기면 됩니다.\n성별 조합은 남녀가 고르게 섞이도록(남남여여 · 남남남여), 나이 조합은 나이가 고르게 섞이도록(신구 조화) 나눕니다.",
                                       size: 12, color: AppSkin.faint, lines: 0)]
        /* **정보가 빈 사람이 몇인지 알려 준다** — 안 적으면 그 조건이 반쪽으로 돈다. */
        let roster = self.roster()
        let noGender = roster.filter { $0.gender != "m" && $0.gender != "f" }.count
        let noAge = roster.filter { $0.birthYear == nil }.count
        if noGender > 0 || noAge > 0 {
            var parts: [String] = []
            if noGender > 0 { parts.append("성별 안 적은 분 \(noGender)명") }
            if noAge > 0 { parts.append("태어난 해 안 적은 분 \(noAge)명") }
            views.append(mkLabel(parts.joined(separator: " · "), size: 12, weight: .semibold, color: AppSkin.warn, lines: 0))
            views.append(mkLabel("그분들은 나머지 뒤에 고르게 넣습니다. 각자 내 정보 → 프로필 수정에서 적을 수 있습니다.",
                                 size: 12, color: AppSkin.faint, lines: 0))
        }
        card(views, spacing: 10)
    }

    /// 확정자를 명단 모양으로 — 명단에 없는 사람은 빈 껍데기다(빠뜨리면 조에서 사라진다).
    private func roster() -> [GroupRules.Person] {
        confirmed.map { s in
            let p = names[s.userId]
            return GroupRules.Person(id: s.userId, gender: p?.gender, birthYear: p?.birthYear)
        }
    }

    @objc private func sizeChanged(_ s: UISegmentedControl) { size = s.selectedSegmentIndex + 2 }

    /// 고른 조건대로 통째로 다시 나눈다. 이미 짠 것이 있어도 덮는다.
    @objc private func modeTapped(_ b: UIButton) {
        let mode = GroupRules.Mode.allCases[b.tag]
        grp = GroupRules.split(roster(), size: size, mode: mode)
        paintGroups()
    }

    @objc private func clearTapped() {
        confirm(title: "조 편성을 지울까요?", detail: "사람들 화면에서도 조가 사라집니다. 저장을 눌러야 반영됩니다.",
                ok: "지우기", danger: true) { [weak self] ok in
            guard ok, let self = self else { return }
            self.grp = [:]
            self.tees = [:]
            self.paintGroups()
        }
    }

    // ── 조 카드 ──────────────────────────────────────────────────

    private var numbers: [Int] {
        let highest = grp.values.max() ?? 0
        let shown = min(max(highest + 1, 1), Self.maxGroups)
        return Array(1...shown)
    }

    private func paintGroups() {
        groupsBox.arrangedSubviews.forEach { $0.removeFromSuperview() }
        let nums = numbers
        let kind = round?.teeLabel ?? "티오프"
        for n in nums {
            let members = confirmed.filter { grp[$0.userId] == n }
            let c = CardView()
            c.content.spacing = 8
            let head = UIStackView()
            head.axis = .horizontal
            head.alignment = .center
            head.spacing = 8
            let t = mkLabel("\(n)조", size: 16, weight: .bold)
            let cnt = mkLabel(" · \(members.count)명", size: 12, color: AppSkin.faint)
            head.addArrangedSubview(t); head.addArrangedSubview(cnt); head.addArrangedSubview(UIView())
            /* 빈 조에는 시각 칸을 안 띄운다 — 아직 아무도 없는 조의 시각을 정할 일이 없다. */
            if !members.isEmpty { head.addArrangedSubview(teeControl(n, kind: kind)) }
            c.content.addArrangedSubview(head)
            if members.isEmpty {
                c.alpha = 0.7
                c.content.addArrangedSubview(mkLabel("아래에서 사람을 이 조로 옮기면 채워집니다.", size: 12, color: AppSkin.faint, lines: 0))
            } else {
                members.forEach { c.content.addArrangedSubview(personRow($0, current: n, numbers: nums)) }
            }
            groupsBox.addArrangedSubview(c)
        }
        let rest = confirmed.filter { grp[$0.userId] == nil }
        if !rest.isEmpty {
            let c = CardView()
            c.content.spacing = 8
            let head = UIStackView(arrangedSubviews: [mkLabel("미배정", size: 16, weight: .bold),
                                                      mkLabel(" · \(rest.count)명", size: 12, color: AppSkin.faint), UIView()])
            head.axis = .horizontal
            head.alignment = .center
            c.content.addArrangedSubview(head)
            rest.forEach { c.content.addArrangedSubview(personRow($0, current: nil, numbers: nums)) }
            groupsBox.addArrangedSubview(c)
        }
    }

    /// 조마다의 시각 — 안 정했으면 `시각` 단추, 정했으면 시·분 칸과 `✕`.
    private func teeControl(_ n: Int, kind: String) -> UIView {
        guard let t = tees[n] else {
            let b = UIButton(type: .system)
            appButton(b, title: "🕐 \(kind)", color: AppSkin.dim, filled: false)
            b.accessibilityLabel = "\(n)조 \(kind) 정하기"
            b.tag = n
            b.addTarget(self, action: #selector(teeStart(_:)), for: .touchUpInside)
            return b
        }
        let p = UIDatePicker()
        p.datePickerMode = .time
        p.preferredDatePickerStyle = .compact
        p.locale = Locale(identifier: "ko_KR")
        p.timeZone = WhenPicker.seoul
        p.calendar = WhenPicker.calendar
        p.tintColor = AppSkin.brand
        p.minuteInterval = 1
        if let d = WhenPicker.calendar.date(bySettingHour: t.h, minute: t.m, second: 0, of: Date()) { p.date = d }
        p.tag = n
        p.accessibilityLabel = "\(n)조 \(kind)"
        p.addTarget(self, action: #selector(teePicked(_:)), for: .valueChanged)
        let x = UIButton(type: .system)
        x.setTitle("✕", for: .normal)
        x.setTitleColor(AppSkin.faint, for: .normal)
        x.tag = n
        x.accessibilityLabel = "\(n)조 \(kind) 지우기"
        x.addTarget(self, action: #selector(teeClear(_:)), for: .touchUpInside)
        x.widthAnchor.constraint(equalToConstant: 32).isActive = true
        x.heightAnchor.constraint(equalToConstant: 40).isActive = true
        let row = UIStackView(arrangedSubviews: [p, x])
        row.axis = .horizontal
        row.alignment = .center
        row.spacing = 2
        return row
    }

    /// 처음 정할 때는 라운드 시각에서 시작한다 — 조마다 몇 분씩 미는 것이 흔하다.
    @objc private func teeStart(_ b: UIButton) {
        let base = round.map { NativeChatRows.date($0.teeAt) } ?? Date()
        let c = WhenPicker.calendar.dateComponents([.hour, .minute], from: base)
        tees[b.tag] = (c.hour ?? 7, c.minute ?? 0)
        paintGroups()
    }
    @objc private func teePicked(_ p: UIDatePicker) {
        let c = WhenPicker.calendar.dateComponents([.hour, .minute], from: p.date)
        tees[p.tag] = (c.hour ?? 0, c.minute ?? 0)
    }
    @objc private func teeClear(_ b: UIButton) { tees[b.tag] = nil; paintGroups() }

    /// 한 사람과, 그 사람을 옮기는 자리. **지금 조가 곧 눌린 칩이다.**
    private func personRow(_ s: AppSignup, current: Int?, numbers: [Int]) -> UIView {
        let p = names[s.userId]
        let label = (p?.label).flatMap { $0.isEmpty ? nil : $0 } ?? "알 수 없음"
        let face = AvatarView()
        face.translatesAutoresizingMaskIntoConstraints = false
        face.widthAnchor.constraint(equalToConstant: 28).isActive = true
        face.heightAnchor.constraint(equalToConstant: 28).isActive = true
        face.show(url: p?.avatar, letter: p?.name ?? "", edge: p?.edge, size: 28)
        /* **왜 이렇게 갈렸는지 보이게 한다** — `여 · 65년생`(나이는 해가 바뀌면 틀린다). */
        let tag = [p?.gender == "f" ? "여" : (p?.gender == "m" ? "남" : ""),
                   p?.birthYear.map { String(format: "%02d년생", $0 % 100) } ?? ""]
            .filter { !$0.isEmpty }.joined(separator: " · ")
        let texts = UIStackView(arrangedSubviews: [mkLabel(label, size: 14, weight: .semibold)])
        texts.axis = .vertical
        texts.spacing = 1
        if !tag.isEmpty { texts.addArrangedSubview(mkLabel(tag, size: 11, color: AppSkin.faint)) }
        texts.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        texts.setContentHuggingPriority(.defaultLow, for: .horizontal)

        let pick: UIView
        if numbers.count <= Self.chipsUpTo {
            let chips = UIStackView()
            chips.axis = .horizontal
            chips.spacing = 4
            for n in numbers {
                let on = current == n
                let b = UIButton(type: .system)
                b.translatesAutoresizingMaskIntoConstraints = false
                b.setTitle("\(n)", for: .normal)
                b.titleLabel?.font = .systemFont(ofSize: 14, weight: .bold)
                b.setTitleColor(on ? .white : AppSkin.dim, for: .normal)
                b.backgroundColor = on ? AppSkin.grass : AppSkin.surface
                b.layer.cornerRadius = 8
                b.layer.borderWidth = on ? 0 : 1
                b.layer.borderColor = AppSkin.line.cgColor
                b.accessibilityLabel = "\(label) · \(n)조로 옮기기"
                b.accessibilityTraits = on ? [.button, .selected] : .button
                b.widthAnchor.constraint(equalToConstant: 32).isActive = true
                b.heightAnchor.constraint(equalToConstant: 32).isActive = true
                let uid = s.userId
                b.addAction(UIAction { [weak self] _ in self?.move(uid, to: on ? nil : n) }, for: .touchUpInside)
                chips.addArrangedSubview(b)
            }
            pick = chips
        } else {
            /* 조가 여섯을 넘으면 고르는 단추로 — 칩이 두 줄로 접히면 이름이 밀린다. */
            let b = UIButton(type: .system)
            appButton(b, title: current.map { "\($0)조 ▾" } ?? "미배정 ▾", color: AppSkin.text, filled: false)
            b.accessibilityLabel = "\(label)의 조"
            let uid = s.userId
            var acts = [UIAction(title: "미배정", state: current == nil ? .on : .off) { [weak self] _ in self?.move(uid, to: nil) }]
            for n in numbers {
                acts.append(UIAction(title: "\(n)조", state: current == n ? .on : .off) { [weak self] _ in self?.move(uid, to: n) })
            }
            b.menu = UIMenu(children: acts)
            b.showsMenuAsPrimaryAction = true
            pick = b
        }
        pick.setContentHuggingPriority(.required, for: .horizontal)
        pick.setContentCompressionResistancePriority(.required, for: .horizontal)
        let row = UIStackView(arrangedSubviews: [face, texts, pick])
        row.axis = .horizontal
        row.alignment = .center
        row.spacing = 8
        return row
    }

    private func move(_ uid: String, to n: Int?) {
        grp[uid] = n
        paintGroups()
    }

    // ── 저장 ─────────────────────────────────────────────────────

    override func saveTapped() {
        guard !saving, let r = round else { return }
        /* **쓰는 조의 시각만 보낸다** — 조를 넷에서 둘로 줄이면 3·4조의 시각이 남는다. */
        let cal = WhenPicker.calendar
        let day = cal.startOfDay(for: NativeChatRows.date(r.teeAt))
        var keep: [String: Any] = [:]
        for n in numbers {
            guard let t = tees[n], confirmed.contains(where: { grp[$0.userId] == n }),
                  let d = cal.date(bySettingHour: t.h, minute: t.m, second: 0, of: day) else { continue }
            keep[String(n)] = WhenPicker.iso(d)
        }
        /* **확정자 전원을 실어 보낸다** — 안 넣은 사람은 `null`이다. */
        var grps: [String: Any] = [:]
        for s in confirmed { grps[s.userId] = grp[s.userId].map { $0 as Any } ?? NSNull() }
        setSave("저장", busy: true)
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            do {
                _ = try await self.service.request("rest/v1/rpc/set_round_groups", method: "POST",
                                                   body: ["p_round": r.id, "p_grps": grps, "p_tees": keep])
                self.flash("조 편성을 저장했습니다.")
                self.goBack()
            } catch {
                self.setSave("저장", busy: false)
                self.flash(error.localizedDescription, error: true)
            }
        }
    }
}

/**
 * **조를 나누는 규칙** — 웹 `src/lib/groups.ts`를 그대로 옮긴 것이다.
 * 거기가 원본이고 `.dev/groups-check.mts`가 붙들어 둔다 — **규칙을 고치면
 * 두 곳을 함께 고칠 것**(함수 이름도 같게 두었다: `groupSizes`·`deal`·
 * `chunk`·`snake`·`split`).
 */
enum GroupRules {
    enum Mode: CaseIterable {
        case seq, random, gender, age
        var label: String {
            switch self { case .seq: return "신청 순서"; case .random: return "랜덤"
            case .gender: return "성별 조합"; case .age: return "나이 조합" }
        }
        var hint: String {
            switch self {
            case .seq: return "신청한 순서대로 끊어서 나눕니다."
            case .random: return "섞어서 나눕니다. 누를 때마다 달라집니다."
            case .gender: return "남녀가 고르게 섞이도록 나눕니다 (남남여여 · 남남남여)."
            case .age: return "나이가 고르게 섞이도록 나눕니다 (신구 조화)."
            }
        }
    }
    struct Person { let id: String; let gender: String?; let birthYear: Int? }

    /// `size`는 한 조의 **최대** 인원 — 아홉 명·4명씩이면 `3·3·3`이다.
    static func groupSizes(_ total: Int, _ size: Int) -> [Int] {
        guard total > 0, size > 0 else { return [] }
        let count = (total + size - 1) / size
        let base = total / count, extra = total % count
        return (0..<count).map { base + ($0 < extra ? 1 : 0) }
    }
    private static func roomiest(_ filled: [Int], _ caps: [Int]) -> Int {
        var best = -1
        for i in caps.indices where filled[i] < caps[i] {
            if best == -1 || filled[i] < filled[best] { best = i }
        }
        return best
    }
    private static func deal(_ order: [Person], _ caps: [Int]) -> [String: Int] {
        var filled = caps.map { _ in 0 }
        var out: [String: Int] = [:]
        for p in order {
            let g = roomiest(filled, caps)
            if g == -1 { break }
            filled[g] += 1
            out[p.id] = g + 1
        }
        return out
    }
    private static func chunk(_ order: [Person], _ caps: [Int]) -> [String: Int] {
        var out: [String: Int] = [:]
        var i = 0
        for (g, cap) in caps.enumerated() {
            var k = 0
            while k < cap && i < order.count { out[order[i].id] = g + 1; k += 1; i += 1 }
        }
        return out
    }
    private static func snake(_ order: [Person], _ caps: [Int]) -> [String: Int] {
        var filled = caps.map { _ in 0 }
        var out: [String: Int] = [:]
        let g = caps.count
        var i = 0, row = 0
        while i < order.count {
            let seq = (0..<g).map { row % 2 == 0 ? $0 : g - 1 - $0 }
            var placed = false
            for j in seq {
                if i >= order.count { break }
                if filled[j] >= caps[j] { continue }
                filled[j] += 1
                out[order[i].id] = j + 1
                i += 1
                placed = true
            }
            if !placed { break }
            row += 1
        }
        return out
    }

    /// `people`은 **신청한 순서**로 들어온다. 성별·태어난 해를 모르는 사람도 빼지 않는다 — 맨 뒤에 채운다.
    static func split(_ people: [Person], size: Int, mode: Mode) -> [String: Int] {
        let caps = groupSizes(people.count, size)
        guard !caps.isEmpty else { return [:] }
        switch mode {
        case .seq: return chunk(people, caps)
        case .random: return chunk(people.shuffled(), caps)
        case .gender:
            /* **적은 쪽을 먼저 담는다** — 그래야 각 조에 하나씩 간다. 모르는 사람은 맨 뒤. */
            let f = people.filter { $0.gender == "f" }, m = people.filter { $0.gender == "m" }
            let unknown = people.filter { $0.gender != "f" && $0.gender != "m" }
            let known = f.count <= m.count ? f + m : m + f
            return deal(known + unknown, caps)
        case .age:
            /* 태어난 해로 줄을 세우고 뱀 모양으로 흩는다. 모르는 사람은 맨 뒤(신청 순서 그대로). */
            let order = people.enumerated().sorted { a, b in
                let x = a.element.birthYear ?? Int.max, y = b.element.birthYear ?? Int.max
                return x != y ? x < y : a.offset < b.offset
            }.map(\.element)
            return snake(order, caps)
        }
    }
}
