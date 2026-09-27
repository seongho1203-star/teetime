import UIKit

/*
 * **정산 만들기** — 웹 `components/Settlement.tsx`의 `SettlementForm`을 Swift로
 * 옮긴 것이다(`docs/아이폰-네이티브.md` 3단계).
 *
 * **주소가 없다 — 라운드 상세 위에 뜨는 시트다.** 웹에서도 상세 안에 접혀 있던
 * 폼이라 히스토리에 한 칸을 만들 이유가 없고, 시트로 두면 웹 라우터와 얽힐 일이
 * 없다(`←`·끌기가 웹에 `back`을 보내지 않는다 — `goBack`을 덮어 닫기만 한다).
 * 적은 것이 날아가지 않게 **아래로 끌어 닫지 못한다**(`isModalInPresentation`) —
 * 닫는 것은 `✕` 하나다.
 *
 * **규칙은 웹과 같다 — 한쪽만 고치지 말 것:**
 *  - 회원 누구나 만든다. 제목·사람·총금액은 필수, 칸에 예시 글씨를 안 둔다.
 *  - **은행은 목록(`BANKS`)에서 고르고 `직접 입력`을 남긴다.** 목록은 웹이
 *    실어 보낸다(`open({banks})`) — 없으면 라운드 상세가 받은 것이 없어
 *    이 기능이 안 뜬다.
 *  - **고르는 명단은 회원 전체다** — 확정 참가자를 `참가자`로 앞에 세우고
 *    나머지는 `그 외`로 접는다(뒷풀이만 온 사람). 고른 사람이 `그 외`에
 *    있으면 접지 않고, 열둘을 넘으면 찾기 칸이 거르개로 선다.
 *  - **1/N은 10원 단위로 내림, 남는 잔돈은 맨 앞 사람**(`splitEvenly`).
 *    금액을 고쳐 적으면 그 사람만 예외로 굳고 나머지가 남은 돈을 다시 나눈다.
 *  - 몫은 **정산을 만든 뒤에** 넣는다 — 그 줄이 들어갈 때 발송기가 사람마다
 *    제 금액을 실어 알림을 보낸다.
 */
final class SettlementEditViewController: FormScreenController {
    private let roundId: String
    private let people: [AppProfile]
    private let joined: Set<String>
    private let banks: [String]
    private let onDone: (Int) -> Void

    private let titleField = FormTextField(max: 60)
    private let bodyField = FormTextView(minHeight: 60, max: 300)
    private let bankBtn = UIButton(type: .system)
    private let accountField = FormTextField(max: 40)
    private let bankEtc = FormTextField(max: 20)
    private let bankEtcBox = UIView()
    private let totalField = WonTextField()
    private let pickTitle = UILabel()
    private let pickBox = UIStackView()
    private let splitBox = UIStackView()
    private let findField = FormTextField(max: 20)

    private var bank = ""
    private var bankOther = false
    private var picked: [String] = []
    private var fixed: [String: Int] = [:]
    private var showRest = false
    private var amountFields: [String: WonTextField] = [:]
    private var resetBtns: [String: UIButton] = [:]
    private let sumLabel = UILabel()

    private var players: [AppProfile] { people.filter { joined.contains($0.id) } }
    private var rest: [AppProfile] { people.filter { !joined.contains($0.id) } }

    init(service: NativeChatService, roundId: String, people: [AppProfile], joined: [String],
         banks: [String], onDone: @escaping (Int) -> Void) {
        self.roundId = roundId
        self.people = people
        self.joined = Set(joined)
        self.banks = banks
        self.onDone = onDone
        super.init(service: service, title: "정산 만들기")
        isModalInPresentation = true
    }
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        backButton.setImage(UIImage(systemName: "xmark"), for: .normal)
        backButton.accessibilityLabel = "닫기"
    }

    /// 시트라 웹에 알릴 것이 없다 — 닫기만 한다.
    override func goBack() {
        view.endEditing(true)
        dismiss(animated: true)
    }

    override func loadScreen() {
        guard !built else { return }
        built = true
        accountField.keyboardType = .numbersAndPunctuation
        bankBtn.translatesAutoresizingMaskIntoConstraints = false
        bankBtn.contentHorizontalAlignment = .leading
        bankBtn.titleLabel?.font = .systemFont(ofSize: 16)
        bankBtn.backgroundColor = AppSkin.surface
        bankBtn.layer.cornerRadius = AppSkin.radiusSm
        bankBtn.layer.borderWidth = 1
        bankBtn.layer.borderColor = AppSkin.line.cgColor
        bankBtn.contentEdgeInsets = UIEdgeInsets(top: 0, left: 13, bottom: 0, right: 10)
        bankBtn.heightAnchor.constraint(equalToConstant: 44).isActive = true
        bankBtn.showsMenuAsPrimaryAction = true
        paintBank()

        let bankCol = field("입금 은행", bankBtn)
        bankCol.widthAnchor.constraint(equalToConstant: 136).isActive = true
        let accCol = field("계좌번호", accountField)
        let bankRow = UIStackView(arrangedSubviews: [bankCol, accCol])
        bankRow.axis = .horizontal; bankRow.spacing = 10; bankRow.alignment = .top
        let etc = field("은행 이름", bankEtc)
        etc.isHidden = true
        etc.tag = 77

        pickTitle.font = .systemFont(ofSize: 13, weight: .bold); pickTitle.textColor = AppSkin.dim
        pickBox.axis = .vertical; pickBox.spacing = 6
        splitBox.axis = .vertical; splitBox.spacing = 8
        sumLabel.font = .systemFont(ofSize: 12); sumLabel.textColor = AppSkin.faint
        findField.addTarget(self, action: #selector(findChanged), for: .editingChanged)
        totalField.addTarget(self, action: #selector(totalChanged), for: .editingChanged)
        appButton(allBtn, title: "모두 넣기", color: AppSkin.dim, filled: false)
        allBtn.addTarget(self, action: #selector(allTapped), for: .touchUpInside)

        card([field("정산 제목", titleField), field("상세 내용 (선택)", bodyField), bankRow, etc,
              field("총금액", totalField)])
        card([pickTitle, pickBox], spacing: 8)
        card([splitBox], spacing: 8)
        renderPick()
        renderSplit()
        showForm(saveTitle: "정산 보내기")
    }

    // ── 은행 ─────────────────────────────────────────────────────

    private func paintBank() {
        let shown = bankOther ? "직접 입력" : (bank.isEmpty ? "고르기" : bank)
        bankBtn.setTitle(shown + "  ▾", for: .normal)
        bankBtn.setTitleColor(bank.isEmpty && !bankOther ? AppSkin.faint : AppSkin.text, for: .normal)
        var items: [UIMenuElement] = banks.map { name in
            UIAction(title: name, state: !bankOther && bank == name ? .on : .off) { [weak self] _ in
                self?.bankOther = false; self?.bank = name; self?.paintBank()
            }
        }
        items.append(UIAction(title: "직접 입력", state: bankOther ? .on : .off) { [weak self] _ in
            /* 직접 입력으로 넘어갈 때는 비워 준다 — 골라 뒀던 이름이 남으면 지우고 다시 쳐야 한다. */
            self?.bankOther = true; self?.bank = ""; self?.bankEtc.text = ""; self?.paintBank()
        })
        bankBtn.menu = UIMenu(children: items)
        stack.viewWithTag(77)?.isHidden = !bankOther
    }

    // ── 사람 고르기 ───────────────────────────────────────────────

    /// 줄마다 들고 있다 — 누를 때마다 목록을 새로 만들지 않고 칠만 갈아 끼운다
    /// (찾기 칸에 초점이 있을 때 다시 만들면 키보드가 내려가고 한글 조합이 깨진다).
    private var pickViews: [String: PersonPick] = [:]
    private let allBtn = UIButton(type: .system)
    private lazy var findWrap = field("이름으로 찾기", findField)
    private let restList = UIStackView()
    private var restWasOpen = false

    private var restOpen: Bool { showRest || rest.contains { picked.contains($0.id) } }

    private func renderPick() {
        pickBox.arrangedSubviews.forEach { $0.removeFromSuperview() }
        pickViews = [:]
        let ps = players
        if !ps.isEmpty {
            pickBox.addArrangedSubview(hrow([mkLabel("참가자 \(ps.count)명", size: 12, color: AppSkin.faint), UIView(), allBtn], fill: true))
            ps.forEach { pickBox.addArrangedSubview(pill($0)) }
        }
        let rs = rest
        restWasOpen = restOpen
        if !rs.isEmpty {
            if !restWasOpen {
                let more = UIButton(type: .system)
                appButton(more, title: "＋ 참가자 외 다른 사람 추가", color: AppSkin.dim, filled: false)
                more.addTarget(self, action: #selector(moreTapped), for: .touchUpInside)
                pickBox.addArrangedSubview(hrow([more]))
            } else {
                pickBox.addArrangedSubview(mkLabel("그 외 \(rs.count)명 · 뒷풀이만 오신 분도 눌러서 고르세요", size: 12, color: AppSkin.faint, lines: 0))
                let big = rs.count > 12      // 웹 `FIND_AT`
                if big { pickBox.addArrangedSubview(findWrap) }
                restList.axis = .vertical; restList.spacing = 6
                if big {
                    /* **감추지 않고 높이만 잡아 둔다**(웹 `.settle-pick.tall`) — 이름을 몰라도 훑어서 고른다. */
                    let sc = UIScrollView()
                    sc.translatesAutoresizingMaskIntoConstraints = false
                    restList.translatesAutoresizingMaskIntoConstraints = false
                    restList.removeFromSuperview()
                    sc.addSubview(restList)
                    NSLayoutConstraint.activate([
                        sc.heightAnchor.constraint(equalToConstant: 190),
                        restList.topAnchor.constraint(equalTo: sc.contentLayoutGuide.topAnchor),
                        restList.bottomAnchor.constraint(equalTo: sc.contentLayoutGuide.bottomAnchor),
                        restList.leadingAnchor.constraint(equalTo: sc.contentLayoutGuide.leadingAnchor),
                        restList.trailingAnchor.constraint(equalTo: sc.contentLayoutGuide.trailingAnchor),
                        restList.widthAnchor.constraint(equalTo: sc.frameLayoutGuide.widthAnchor)
                    ])
                    pickBox.addArrangedSubview(sc)
                } else {
                    pickBox.addArrangedSubview(restList)
                }
                renderRest()
            }
        }
        paintPicks()
    }

    /// `그 외` 목록만 — 찾는 글자가 바뀔 때 이것만 다시 그린다.
    private func renderRest() {
        restList.arrangedSubviews.forEach { $0.removeFromSuperview() }
        for id in pickViews.keys where !players.contains(where: { $0.id == id }) { pickViews[id] = nil }
        let q = (findField.text ?? "").replacingOccurrences(of: " ", with: "").lowercased()
        /* 고른 사람은 검색어와 상관없이 남긴다 — 사라지면 뺀 것처럼 보인다. */
        let shown = q.isEmpty ? rest : rest.filter { p in
            picked.contains(p.id) || [p.name, p.region ?? ""].contains { $0.replacingOccurrences(of: " ", with: "").lowercased().contains(q) }
        }
        if shown.isEmpty {
            restList.addArrangedSubview(mkLabel("'\(findField.text ?? "")' 님을 못 찾았습니다.", size: 12, color: AppSkin.faint))
        }
        shown.forEach { restList.addArrangedSubview(pill($0)) }
        paintPicks()
    }

    /// 고른 표시·머리 글자만 갈아 끼운다.
    private func paintPicks() {
        pickTitle.text = "정산할 사람 (\(picked.count)명)"
        let byId = Dictionary(people.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        for (id, v) in pickViews { if let p = byId[id] { v.fill(p, on: picked.contains(id)) } }
        let all = !players.isEmpty && players.allSatisfy { picked.contains($0.id) }
        allBtn.setTitle(all ? "모두 빼기" : "모두 넣기", for: .normal)
    }

    /// 고르는 줄 하나 — 얼굴 · 이름표 · 체크(웹 `PersonPill`). 켜지면 분홍 테두리.
    private func pill(_ p: AppProfile) -> UIView {
        let c = PersonPick()
        c.fill(p, on: picked.contains(p.id))
        c.addAction(UIAction { [weak self] _ in self?.toggle(p.id) }, for: .touchUpInside)
        pickViews[p.id] = c
        return c
    }

    private func toggle(_ id: String) {
        if let i = picked.firstIndex(of: id) { picked.remove(at: i) } else { picked.append(id) }
        /* 뺀 사람의 예외 금액도 같이 지운다 — 안 그러면 다시 넣을 때 살아난다. */
        fixed[id] = nil
        if restOpen != restWasOpen { renderPick() } else { paintPicks() }
        renderSplit()
    }

    @objc private func allTapped() {
        let ids = players.map { $0.id }
        if ids.allSatisfy({ picked.contains($0) }) {
            picked.removeAll { ids.contains($0) }
            ids.forEach { fixed[$0] = nil }
        } else {
            for id in ids where !picked.contains(id) { picked.append(id) }
        }
        if restOpen != restWasOpen { renderPick() } else { paintPicks() }
        renderSplit()
    }
    @objc private func moreTapped() { showRest = true; renderPick() }
    @objc private func findChanged() { renderRest() }

    // ── 1/N ──────────────────────────────────────────────────────

    /// 웹 `splitEvenly`와 같은 셈 — 10원 단위 내림 · 잔돈은 맨 앞 사람. **한쪽만 고치지 말 것.**
    static func splitEvenly(total: Int, ids: [String], fixed: [String: Int]) -> [String: Int] {
        var out: [String: Int] = [:]
        let free = ids.filter { fixed[$0] == nil }
        let used = ids.reduce(0) { $0 + (fixed[$1] ?? 0) }
        let restMoney = max(0, total - used)
        for id in ids { if let f = fixed[id] { out[id] = f } }
        guard !free.isEmpty else { return out }
        let each = restMoney / free.count / 10 * 10
        free.forEach { out[$0] = each }
        let left = restMoney - each * free.count
        if left > 0 { out[free[0], default: 0] += left }
        return out
    }

    private var amounts: [String: Int] { Self.splitEvenly(total: totalField.won, ids: picked, fixed: fixed) }

    private func renderSplit() {
        splitBox.arrangedSubviews.forEach { $0.removeFromSuperview() }
        amountFields = [:]; resetBtns = [:]
        splitBox.superview?.superview?.isHidden = picked.isEmpty
        guard !picked.isEmpty else { return }
        splitBox.addArrangedSubview(mkLabel("1/N — 고쳐 적으면 그 사람만 예외가 됩니다", size: 13, weight: .bold, color: AppSkin.dim, lines: 0))
        let byId = Dictionary(people.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        for id in picked {
            let name = mkLabel(byId[id]?.label ?? "알 수 없음", size: 14)
            let f = WonTextField()
            f.widthAnchor.constraint(equalToConstant: 126).isActive = true
            f.addAction(UIAction { [weak self, weak f] _ in
                guard let self = self, let f = f else { return }
                self.fixed[id] = f.won
                self.refreshAmounts(except: id)
            }, for: .editingChanged)
            let reset = UIButton(type: .system)
            appButton(reset, title: "1/N로", color: AppSkin.dim, filled: false)
            reset.addAction(UIAction { [weak self] _ in
                self?.fixed[id] = nil
                self?.refreshAmounts(except: nil)
            }, for: .touchUpInside)
            amountFields[id] = f; resetBtns[id] = reset
            let row = UIStackView(arrangedSubviews: [name, f, reset])
            row.axis = .horizontal; row.spacing = 8; row.alignment = .center
            splitBox.addArrangedSubview(row)
        }
        splitBox.addArrangedSubview(sumLabel)
        refreshAmounts(except: nil)
    }

    /// 금액만 갈아 끼운다 — 치는 중인 칸은 안 건드린다(다시 만들면 초점이 날아간다).
    private func refreshAmounts(except: String?) {
        let a = amounts
        for (id, f) in amountFields where id != except { f.setWon(a[id] ?? 0) }
        for (id, b) in resetBtns { b.isHidden = fixed[id] == nil }
        sumLabel.text = "합계 \(AppDate.won(a.values.reduce(0, +))) / 총 \(AppDate.won(totalField.won))"
    }

    @objc private func totalChanged() { refreshAmounts(except: nil) }

    // ── 보내기 ───────────────────────────────────────────────────

    override func saveTapped() {
        guard !saving else { return }
        view.endEditing(true)
        let title = (titleField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { flash("정산 제목을 적어 주세요.", error: true); return }
        guard !picked.isEmpty else { flash("정산할 사람을 골라 주세요.", error: true); return }
        let total = totalField.won
        guard total > 0 else { flash("총금액을 적어 주세요.", error: true); return }
        let bankName = (bankOther ? (bankEtc.text ?? "") : bank).trimmingCharacters(in: .whitespaces)
        let a = amounts
        let ids = picked
        setSave("정산 보내기", busy: true)
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            do {
                let row: ChatJSON = [
                    "round_id": self.roundId, "title": title,
                    "body": self.bodyField.text.trimmingCharacters(in: .whitespacesAndNewlines),
                    "bank": bankName, "account": (self.accountField.text ?? "").trimmingCharacters(in: .whitespaces),
                    "total": total, "created_by": self.service.config.user
                ]
                guard let sid = try await self.service.insertRows("settlements", [row]).first?["id"] as? String else {
                    throw NativeChatError(message: "정산을 만들지 못했습니다. 다시 시도해 주세요.")
                }
                _ = try await self.service.insertRows("settlement_shares",
                    ids.map { ["settlement_id": sid, "user_id": $0, "amount": a[$0] ?? 0] })
                self.onDone(ids.count)
                self.dismiss(animated: true)
            } catch {
                self.setSave("정산 보내기", busy: false)
                self.flash(error.localizedDescription, error: true)
            }
        }
    }
}

/// 고르는 줄 하나(웹 `.settle-pill`) — 얼굴 · 이름표 · 오른쪽 체크.
final class PersonPick: UIControl {
    private let face = AvatarView()
    private let name = UILabel()
    private let check = UIImageView(image: UIImage(systemName: "checkmark"))

    init() {
        super.init(frame: .zero)
        layer.cornerRadius = AppSkin.radiusSm
        layer.borderWidth = 1
        [face, name, check].forEach { $0.translatesAutoresizingMaskIntoConstraints = false; $0.isUserInteractionEnabled = false; addSubview($0) }
        name.font = .systemFont(ofSize: 14, weight: .semibold)
        name.lineBreakMode = .byTruncatingTail
        check.tintColor = AppSkin.brandDeep
        NSLayoutConstraint.activate([
            heightAnchor.constraint(equalToConstant: 44),
            face.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 10),
            face.centerYAnchor.constraint(equalTo: centerYAnchor),
            face.widthAnchor.constraint(equalToConstant: 26),
            face.heightAnchor.constraint(equalToConstant: 26),
            name.leadingAnchor.constraint(equalTo: face.trailingAnchor, constant: 9),
            name.centerYAnchor.constraint(equalTo: centerYAnchor),
            name.trailingAnchor.constraint(lessThanOrEqualTo: check.leadingAnchor, constant: -8),
            check.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),
            check.centerYAnchor.constraint(equalTo: centerYAnchor)
        ])
    }
    required init?(coder: NSCoder) { fatalError() }

    func fill(_ p: AppProfile, on: Bool) {
        face.show(url: p.avatar, letter: p.name, edge: p.edge, size: 26)
        name.text = p.label.isEmpty ? "알 수 없음" : p.label
        name.textColor = on ? AppSkin.text : AppSkin.dim
        layer.borderColor = (on ? AppSkin.brandDeep : AppSkin.line).cgColor
        backgroundColor = on ? AppSkin.brand.withAlphaComponent(0.1) : AppSkin.surface
        check.isHidden = !on
        accessibilityLabel = name.text
        accessibilityTraits = on ? [.button, .selected] : .button
    }
}
