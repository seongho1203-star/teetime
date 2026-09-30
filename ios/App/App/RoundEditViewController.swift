import UIKit

/*
 * **모집 열기·고치기** — 웹 `screens/RoundEdit.tsx`를 Swift로 옮긴 것이다
 * (`docs/아이폰-네이티브.md` 3단계). 주소는 `/rounds/new`(`?from=` 베끼기 포함)와
 * `/rounds/<id>/edit`.
 *
 * **규칙은 웹과 같다 — 한쪽만 고치지 말 것:**
 *  - 누구나 열고, 고치는 것은 **연 사람과 운영진**만.
 *  - **맨 위에서 종류(필드·스크린)부터 고른다** — 아래 칸의 말과 있고 없음이
 *    여기서 갈린다(골프장/매장 · 티오프/시작 · 그린피/게임비 · 캐디·카트 줄).
 *  - 캐디·카트는 **한 줄에 하나만** 켜지고, 누른 것을 다시 누르면 '안 정함'.
 *  - **스크린으로 저장하면 캐디·카트·좌표를 지운다**(null) — 안 지우면
 *    상세에 조건이 그대로 뜨고 엉뚱한 골프장 날씨가 붙는다.
 *  - 필드는 **골프장 목록에서 찾아 준다** — 고르면 좌표가 붙어 날씨가 뜬다.
 *    **목록은 웹이 실어 보낸다**(`open({courses})` · `src/lib/courses.ts`) —
 *    574곳을 Swift에 또 적으면 두 벌이 된다. 찾는 규칙은 웹 `courseGeo`·
 *    `searchCourses`와 같다(`CourseBook`).
 *  - **`title`·`opens_at`은 보내지 않는다**(없앤 칸).
 *  - `?from=`으로 들어오면 **값만 베끼고 시각은 비운다** — 저장하면 새 모집이다.
 *  - 저장하면 그 라운드로 **바꿔치기**해 간다(웹 `onDone`과 같다).
 */
final class RoundEditViewController: FormScreenController {
    private let roundId: String?
    private let fromId: String?
    private let book: CourseBook
    private var round: AppRound?
    private var preset: AppRound?
    private var role = "member"

    private var kind = "field"
    private var caddie: String?
    private var cart: String?

    private let fieldBtn = OptButton()
    private let screenBtn = OptButton()
    private let placeName = UILabel()
    private let courseField = FormTextField(max: 40)
    private let hitsStack = UIStackView()
    private let placeNote = UILabel()
    /* 코스(`rounds.sub_course` · 사용자 요청 — `골프장칸을 절반으로하고 그 자리에 코스를`).
       골프장과 섞지 않는다(`course`에 합쳐 넣으면 좌표를 못 찾아 날씨가 사라진다).
       칩은 `lib/clubs.ts`의 표 — 누를 때마다 켜지고 꺼지며 **고른 차례가 곧 전·후반**이다. */
    private let subName = UILabel()
    private let subField = FormTextField(max: 30)
    private let subChips = UIStackView()
    private let clubs: [String: [String]]
    private var hadSub = false
    private let condBox = UIStackView()
    private let caddieBtn = OptButton(), noCaddieBtn = OptButton()
    private let cartInBtn = OptButton(), cartOutBtn = OptButton()
    private let teeName = UILabel()
    private let when = WhenPicker(hour: 7, minute: 0)
    private let capField = FormTextField(max: 3)
    private let feeName = UILabel()
    private let feeField = WonTextField()
    private let noteField = FormTextView(minHeight: 90, max: 1000)

    /* 팀별 코스·시각(`tee_slots`) — 필드에만. 줄 하나가 한 팀 = 한 조다. */
    private struct SlotRow { let course: FormTextField; let time: UIDatePicker; let view: UIView }
    private var slotRows: [SlotRow] = []
    private let slotsWrap = UIStackView()
    private let slotsBox = UIStackView()
    private let slotsHint = UILabel()
    private var hadSlots = false

    private var screen: Bool { kind == "screen" }

    init(service: NativeChatService, id: String?, from: String?, courses: [ChatJSON], clubs: [String: [String]] = [:]) {
        roundId = id
        self.clubs = clubs
        fromId = id == nil ? from : nil
        book = CourseBook(courses)
        super.init(service: service, title: id == nil ? "모집 열기" : "라운드 수정")
    }
    required init?(coder: NSCoder) { fatalError() }

    override func loadScreen() {
        guard !built else { return }
        spinner.startAnimating()
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            self.role = await self.service.myRole()
            if let which = self.roundId ?? self.fromId {
                let r: AppRound?
                do { r = try await self.service.round(which) }
                catch { self.showNotice(error.localizedDescription); return }
                if self.roundId != nil {
                    guard let r = r else { self.showNotice("없는 라운드입니다."); return }
                    self.round = r
                } else {
                    self.preset = r      // 베낄 것을 못 찾았으면 빈 새 모집으로 연다
                }
            }
            self.build()
        }
    }

    private func build() {
        built = true
        if let r = round, r.createdBy != service.config.user, !AppRole.isAdmin(role) {
            showNotice("올린 사람만 고칠 수 있습니다.")
            return
        }
        let base = round ?? preset
        kind = base?.kind ?? "field"
        caddie = base?.caddie
        cart = base?.cart
        courseField.text = base?.course ?? ""
        subField.text = base?.subCourse ?? ""
        hadSub = base?.raw["sub_course"] != nil
        /* **새로 열 때도 날짜·시각 칸을 처음부터 편다**(사용자 요청 — `티오프시간을
           기본으로 나오게해줘. 눌러야지 나오는거말고`). 비워 두면 `📅 날짜·시각 고르기`를
           한 번 더 눌러야 해서 한 걸음이 늘었다. 기본은 **내일**(지난 날짜가 채워지는
           일이 없다)이고, 베껴 온 모집이면 그 모집의 시·분을 쓴다. */
        if let r = round {
            when.date = NativeChatRows.date(r.teeAt)
        } else {
            let cal = WhenPicker.calendar
            let src = preset.map { cal.dateComponents([.hour, .minute], from: NativeChatRows.date($0.teeAt)) }
            let day = cal.startOfDay(for: Date(timeIntervalSinceNow: 86400))
            when.date = cal.date(bySettingHour: src?.hour ?? 7, minute: src?.minute ?? 0, second: 0, of: day)
        }
        capField.text = String(base?.capacity ?? 4)
        capField.keyboardType = .numberPad
        feeField.setWon(base?.fee ?? 0)
        noteField.setText(base?.note ?? "")

        /* 베껴 온 것이라고 밝혀 둔다 — 안 그러면 고치는 화면처럼 보여 원본을 건드리는 줄 안다. */
        if let p = preset {
            let t = NSMutableAttributedString(string: p.course.isEmpty ? "지난 모집" : p.course,
                                              attributes: [.font: UIFont.systemFont(ofSize: 14, weight: .bold), .foregroundColor: AppSkin.text])
            t.append(NSAttributedString(string: "의 조건을 그대로 가져왔습니다.\n날짜를 확인하면 새 모집으로 열립니다.",
                                        attributes: [.font: UIFont.systemFont(ofSize: 14), .foregroundColor: AppSkin.text]))
            let l = UILabel(); l.numberOfLines = 0; l.attributedText = t
            let wrap = UIStackView(arrangedSubviews: [l])
            wrap.isLayoutMarginsRelativeArrangement = true
            wrap.layoutMargins = UIEdgeInsets(top: 11, left: 13, bottom: 11, right: 13)
            wrap.backgroundColor = AppSkin.surface2
            wrap.layer.cornerRadius = AppSkin.radiusSm
            stack.addArrangedSubview(wrap)
        }

        fieldBtn.setTitle("⛳ 필드"); screenBtn.setTitle("🎯 스크린")
        fieldBtn.addTarget(self, action: #selector(kindTapped(_:)), for: .touchUpInside)
        screenBtn.addTarget(self, action: #selector(kindTapped(_:)), for: .touchUpInside)
        let kindRow = optRow([fieldBtn, screenBtn])

        placeName.font = .systemFont(ofSize: 13, weight: .bold); placeName.textColor = AppSkin.dim
        courseField.autocorrectionType = .no
        courseField.addTarget(self, action: #selector(courseChanged), for: .editingChanged)
        courseField.addTarget(self, action: #selector(courseChanged), for: .editingDidBegin)
        hitsStack.axis = .vertical
        hitsStack.spacing = 0
        hitsStack.backgroundColor = AppSkin.surface
        hitsStack.layer.cornerRadius = AppSkin.radiusSm
        hitsStack.layer.borderWidth = 1
        hitsStack.layer.borderColor = AppSkin.line.cgColor
        hitsStack.clipsToBounds = true
        hitsStack.isHidden = true
        placeNote.font = .systemFont(ofSize: 12); placeNote.textColor = AppSkin.faint; placeNote.numberOfLines = 0
        subName.font = .systemFont(ofSize: 13, weight: .bold); subName.textColor = AppSkin.dim
        subName.text = "코스"
        subField.autocorrectionType = .no
        subField.addTarget(self, action: #selector(subChanged), for: .editingChanged)
        subChips.axis = .vertical; subChips.spacing = 8
        let clubCol = UIStackView(arrangedSubviews: [placeName, courseField]); clubCol.axis = .vertical; clubCol.spacing = 6
        let subCol = UIStackView(arrangedSubviews: [subName, subField]); subCol.axis = .vertical; subCol.spacing = 6
        subCol.tag = 71
        let placeRow = UIStackView(arrangedSubviews: [clubCol, subCol])
        placeRow.axis = .horizontal; placeRow.spacing = 10; placeRow.distribution = .fillEqually
        let placeBox = UIStackView(arrangedSubviews: [placeRow, hitsStack, subChips, placeNote])
        placeBox.axis = .vertical; placeBox.spacing = 6

        caddieBtn.setTitle("캐디"); noCaddieBtn.setTitle("노캐디")
        cartInBtn.setTitle("카트 포함"); cartOutBtn.setTitle("카트 미포함")
        [caddieBtn, noCaddieBtn, cartInBtn, cartOutBtn].forEach { $0.addTarget(self, action: #selector(condTapped(_:)), for: .touchUpInside) }
        condBox.axis = .vertical; condBox.spacing = 8
        condBox.addArrangedSubview(mkLabel("라운드 조건 (선택)", size: 13, weight: .bold, color: AppSkin.dim))
        condBox.addArrangedSubview(optRow([caddieBtn, noCaddieBtn]))
        condBox.addArrangedSubview(optRow([cartInBtn, cartOutBtn]))

        teeName.font = .systemFont(ofSize: 13, weight: .bold); teeName.textColor = AppSkin.dim
        let teeBox = UIStackView(arrangedSubviews: [teeName, when])
        teeBox.axis = .vertical; teeBox.spacing = 6

        feeName.font = .systemFont(ofSize: 13, weight: .bold); feeName.textColor = AppSkin.dim
        let feeBox = UIStackView(arrangedSubviews: [feeName, feeField]); feeBox.axis = .vertical; feeBox.spacing = 6
        let capBox = field("정원", capField)
        let numRow = UIStackView(arrangedSubviews: [capBox, feeBox])
        numRow.axis = .horizontal; numRow.spacing = 10; numRow.distribution = .fillEqually

        buildSlots(base?.teeSlots ?? [])
        hadSlots = base?.raw["tee_slots"] != nil

        card([field("종류", kindRow), placeBox, condBox, teeBox, slotsWrap, numRow, field("전달 내용 (선택)", noteField)])
        noteField.onChange = { [weak self] in
            guard let self = self, let end = self.noteField.selectedTextRange?.end else { return }
            self.reveal(self.noteField, rect: self.noteField.caretRect(for: end))
        }
        refreshKind()
        showForm(saveTitle: round == nil ? "모집 열기" : "수정 저장")
    }

    private func optRow(_ bs: [UIView]) -> UIStackView {
        let r = UIStackView(arrangedSubviews: bs)
        r.axis = .horizontal; r.spacing = 10; r.distribution = .fillEqually
        return r
    }

    /// 종류가 바뀌면 말과 있고 없음을 맞춘다.
    private func refreshKind() {
        fieldBtn.on = !screen; screenBtn.on = screen
        placeName.text = screen ? "매장" : "골프장"
        courseField.attributedPlaceholder = NSAttributedString(string: screen ? "예) 신용DS" : "예) 무등산CC",
                                                               attributes: [.foregroundColor: AppSkin.faint])
        teeName.text = "\(screen ? "시작" : "티오프") (한국 시각)"
        feeName.text = "1인 \(screen ? "게임비" : "그린피")"
        condBox.isHidden = screen
        slotsWrap.isHidden = screen
        (subField.superview as? UIStackView)?.isHidden = screen
        refreshSubChips()
        refreshSlots()
        caddieBtn.on = caddie == "caddie"; noCaddieBtn.on = caddie == "none"
        cartInBtn.on = cart == "included"; cartOutBtn.on = cart == "excluded"
        refreshPlace(showHits: false)
    }

    // ── 팀별 코스·시각 ───────────────────────────────────────────

    /*
     * 한 골프장에서 코스를 나눠 여러 팀이 나가는 모집(`스카이 07:21 · 07:28 /
     * 베르힐 07:14 · 07:21 · 07:28`)을 위해 있다. **적은 차례가 곧 조 번호다** —
     * 조 편성이 1조부터 이 차례대로 시각을 채우고 조 이름 옆에 코스를 적는다.
     * 정렬하지 않는다: 적는 사람이 정한 차례를 앱이 바꾸면 조 번호가 어긋난다.
     * 비워 두면 예전과 똑같다(선택 칸).
     */
    private func buildSlots(_ slots: [AppRound.Slot]) {
        slotsWrap.axis = .vertical; slotsWrap.spacing = 8
        slotsBox.axis = .vertical; slotsBox.spacing = 8
        let add = UIButton(type: .system)
        appButton(add, title: "＋ 팀 추가", color: AppSkin.text, filled: false)
        add.addTarget(self, action: #selector(addSlotTapped), for: .touchUpInside)
        slotsHint.font = .systemFont(ofSize: 12); slotsHint.textColor = AppSkin.faint; slotsHint.numberOfLines = 0
        slotsWrap.addArrangedSubview(mkLabel("2팀 이상일 경우 입력(선택)", size: 13, weight: .bold, color: AppSkin.dim))
        slotsWrap.addArrangedSubview(slotsBox)
        slotsWrap.addArrangedSubview(UIStackView(arrangedSubviews: [add, UIView()]))
        slotsWrap.addArrangedSubview(slotsHint)
        slots.forEach { addSlot(course: $0.course, h: $0.h, m: $0.m) }
    }

    private func addSlot(course: String, h: Int, m: Int) {
        let n = slotRows.count + 1
        let no = mkLabel("\(n)팀", size: 14, weight: .bold)
        no.setContentHuggingPriority(.required, for: .horizontal)
        no.widthAnchor.constraint(equalToConstant: 34).isActive = true
        let c = FormTextField(hint: "코스", max: 20)
        c.text = course
        c.autocorrectionType = .no
        c.accessibilityLabel = "\(n)팀 코스"
        /* 코스 이름 다섯 글자(`임페리얼`·`마제스티`·`베르힐 A`)가 한눈에 들어가는 폭 —
           글자 수에 따라 칸이 줄었다 늘었다 하면 줄마다 들쭉날쭉해진다. */
        c.widthAnchor.constraint(equalToConstant: 116).isActive = true
        c.setContentHuggingPriority(.required, for: .horizontal)
        let p = UIDatePicker()
        p.datePickerMode = .time
        p.preferredDatePickerStyle = .compact
        p.locale = Locale(identifier: "ko_KR")
        p.timeZone = WhenPicker.seoul
        p.calendar = WhenPicker.calendar
        p.tintColor = AppSkin.brand
        p.minuteInterval = 1
        if let d = WhenPicker.calendar.date(bySettingHour: h, minute: m, second: 0, of: Date()) { p.date = d }
        p.accessibilityLabel = "\(n)팀 시각"
        p.addTarget(self, action: #selector(slotTimeChanged), for: .valueChanged)
        p.setContentHuggingPriority(.required, for: .horizontal)
        p.setContentCompressionResistancePriority(.required, for: .horizontal)
        let x = UIButton(type: .system)
        x.setImage(smallX(), for: .normal)   // 화면 안의 ✕는 다 같은 작은 표다
        x.tintColor = AppSkin.faint
        x.accessibilityLabel = "\(n)팀 지우기"
        x.addTarget(self, action: #selector(removeSlotTapped(_:)), for: .touchUpInside)
        x.widthAnchor.constraint(equalToConstant: 32).isActive = true
        x.heightAnchor.constraint(equalToConstant: 40).isActive = true
        let row = UIStackView(arrangedSubviews: [no, c, UIView(), p, x])
        row.axis = .horizontal; row.alignment = .center; row.spacing = 6
        slotRows.append(SlotRow(course: c, time: p, view: row))
        slotsBox.addArrangedSubview(row)
    }

    /// 새 팀은 **앞 팀의 코스를 그대로 · 7분 뒤**로 시작한다 — 한 코스에 몇 팀이
    /// 7분 간격으로 붙는 것이 흔하다. 첫 팀은 위 티오프 시각에서 시작한다.
    @objc private func addSlotTapped() {
        let cal = WhenPicker.calendar
        if let last = slotRows.last {
            let d = last.time.date.addingTimeInterval(7 * 60)
            let c = cal.dateComponents([.hour, .minute], from: d)
            addSlot(course: last.course.text ?? "", h: c.hour ?? 7, m: c.minute ?? 0)
        } else {
            let c = cal.dateComponents([.hour, .minute], from: when.date ?? cal.date(bySettingHour: 7, minute: 0, second: 0, of: Date()) ?? Date())
            addSlot(course: "", h: c.hour ?? 7, m: c.minute ?? 0)
        }
        refreshSlots()
    }
    @objc private func removeSlotTapped(_ b: UIButton) {
        guard let i = slotRows.firstIndex(where: { $0.view === b.superview }) else { return }
        slotRows[i].view.removeFromSuperview()
        slotRows.remove(at: i)
        /* 번호를 다시 매긴다 — 가운데를 지우면 `1팀 · 3팀`처럼 구멍이 난다. */
        for (k, r) in slotRows.enumerated() {
            ((r.view as? UIStackView)?.arrangedSubviews.first as? UILabel)?.text = "\(k + 1)팀"
            r.course.accessibilityLabel = "\(k + 1)팀 코스"
            r.time.accessibilityLabel = "\(k + 1)팀 시각"
        }
        refreshSlots()
    }
    @objc private func slotTimeChanged() { refreshSlots() }

    private func slotTimes() -> [(h: Int, m: Int)] {
        slotRows.map {
            let c = WhenPicker.calendar.dateComponents([.hour, .minute], from: $0.time.date)
            return (c.hour ?? 0, c.minute ?? 0)
        }
    }

    private func refreshSlots() {
        let n = slotRows.count
        guard n > 0 else {
            slotsHint.text = "한 골프장에서 코스를 나눠 여러 팀이 나갈 때 적어 두세요. 조 편성 때 1조부터 이 차례대로 시각이 채워집니다."
            return
        }
        let first = slotTimes().min { ($0.h, $0.m) < ($1.h, $1.m) }!
        slotsHint.text = "\(n)팀 · 한 팀 4명이면 \(n * 4)명 — 가장 이른 \(String(format: "%02d:%02d", first.h, first.m))이 \(screen ? "시작" : "티오프") 시각으로 저장됩니다. 팀 차례가 곧 조 번호입니다."
    }

    /// 찾은 곳 목록과 아래 안내 한 줄(웹 `course-hits`·`xs faint`).
    private func refreshPlace(showHits: Bool) {
        let typed = courseField.text ?? ""
        let trimmed = typed.trimmingCharacters(in: .whitespaces)
        hitsStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        let hits = (screen || book.geo(typed)?.name == trimmed || !showHits) ? [] : book.search(typed)
        for (i, c) in hits.enumerated() {
            let b = UIButton(type: .system)
            b.setTitle(c.name, for: .normal)
            b.setTitleColor(AppSkin.text, for: .normal)
            b.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
            b.contentHorizontalAlignment = .leading
            b.contentEdgeInsets = UIEdgeInsets(top: 11, left: 13, bottom: 11, right: 13)
            b.addTarget(self, action: #selector(hitTapped(_:)), for: .touchUpInside)
            if i > 0 {
                let rule = UIView(); rule.backgroundColor = AppSkin.line
                rule.heightAnchor.constraint(equalToConstant: 1).isActive = true
                hitsStack.addArrangedSubview(rule)
            }
            hitsStack.addArrangedSubview(b)
        }
        hitsStack.isHidden = hits.isEmpty
        if screen { placeNote.text = "실내라 날씨는 표시되지 않습니다" }
        else if trimmed.isEmpty { placeNote.text = nil }
        else { placeNote.text = book.geo(typed) != nil ? "날씨가 함께 표시됩니다" : "목록에 없는 곳입니다 — 날씨는 표시되지 않습니다" }
        placeNote.isHidden = placeNote.text == nil
    }

    @objc private func kindTapped(_ b: OptButton) {
        kind = b === screenBtn ? "screen" : "field"
        refreshKind()
    }
    @objc private func condTapped(_ b: OptButton) {
        switch b {
        case caddieBtn: caddie = caddie == "caddie" ? nil : "caddie"
        case noCaddieBtn: caddie = caddie == "none" ? nil : "none"
        case cartInBtn: cart = cart == "included" ? nil : "included"
        default: cart = cart == "excluded" ? nil : "excluded"
        }
        refreshKind()
    }
    @objc private func courseChanged() { refreshPlace(showHits: true); refreshSubChips() }
    /// 골프장 이름을 표 열쇠 모양으로 — 웹 `clubKey`(lib/clubs.ts)와 같은 규칙. **딱 맞을 때만 쓴다.**
    static func clubKey(_ name: String) -> String {
        let s = name.components(separatedBy: .whitespacesAndNewlines).joined()
        return s.replacingOccurrences(of: "(CC|GC|컨트리클럽|골프클럽|골프장|골프앤리조트|골프리조트|골프링크스|골프클럽스)$",
                                      with: "", options: [.regularExpression, .caseInsensitive])
    }
    private var picked: [String] {
        (subField.text ?? "").split(separator: "-").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }
    /// 그 골프장의 코스 칩 — 누를 때마다 켜지고 꺼진다. 표에 없는 골프장이면 칩 없이 칸만 남는다.
    private func refreshSubChips() {
        subChips.arrangedSubviews.forEach { $0.removeFromSuperview() }
        let list = screen ? [] : (clubs[Self.clubKey(courseField.text ?? "")] ?? [])
        subChips.isHidden = list.isEmpty
        guard !list.isEmpty else { return }
        let on = picked
        for i in stride(from: 0, to: list.count, by: 3) {
            var bs: [UIView] = []
            for name in list[i..<min(i + 3, list.count)] {
                let b = OptButton()
                let n = on.firstIndex(of: name).map { String($0 + 1) }
                b.setTitle(name)
                b.mark = n
                b.on = n != nil
                b.accessibilityIdentifier = name
                b.addTarget(self, action: #selector(subTapped(_:)), for: .touchUpInside)
                bs.append(b)
            }
            while bs.count < 3 { bs.append(UIView()) }
            subChips.addArrangedSubview(optRow(bs))
        }
    }
    @objc private func subTapped(_ b: OptButton) {
        guard let name = b.accessibilityIdentifier else { return }
        var on = picked
        if let i = on.firstIndex(of: name) { on.remove(at: i) } else { on.append(name) }
        subField.text = on.joined(separator: "-")
        refreshSubChips()
    }
    @objc private func subChanged() { refreshSubChips() }
    @objc private func hitTapped(_ b: UIButton) {
        /* 골프장을 바꾸면 골라 둔 코스를 비운다 — 안 비우면 어등산인데 마제스티가 붙은 채 저장된다. */
        if Self.clubKey(b.title(for: .normal) ?? "") != Self.clubKey(courseField.text ?? "") { subField.text = "" }
        courseField.text = b.title(for: .normal)
        refreshSubChips()
        refreshPlace(showHits: false)
        view.endEditing(true)
    }

    override func saveTapped() {
        guard !saving else { return }
        view.endEditing(true)
        guard var tee = when.date else { flash("\(screen ? "시작" : "티오프") 시각을 골라 주세요.", error: true); return }
        /* 팀별 시각을 적었으면 **가장 이른 팀**이 곧 티오프다 — 날짜는 위 칸 그대로.
           리마인더(`두 시간 전`·`전날 20시`)와 목록의 시각이 이 값을 본다. */
        var slots: [ChatJSON] = []
        if !screen {
            let times = slotTimes()
            for (i, r) in slotRows.enumerated() {
                let one: ChatJSON = ["course": (r.course.text ?? "").trimmingCharacters(in: .whitespaces),
                                     "time": String(format: "%02d:%02d", times[i].h, times[i].m)]
                slots.append(one)
            }
        }
        if !screen, let first = slotTimes().min(by: { ($0.h, $0.m) < ($1.h, $1.m) }) {
            let cal = WhenPicker.calendar
            tee = cal.date(bySettingHour: first.h, minute: first.m, second: 0, of: cal.startOfDay(for: tee)) ?? tee
        }
        let course = (courseField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !course.isEmpty else { flash("\(screen ? "매장" : "골프장") 이름을 적어 주세요.", error: true); return }
        guard let cap = Int(capField.text ?? ""), cap >= 1 else { flash("정원은 1명 이상이어야 합니다.", error: true); return }
        let geo = screen ? nil : book.geo(course)
        /* 빈 값은 JSON `null`로 보내야 DB가 지운다(스크린으로 바꾼 옛 조건·좌표). */
        func orNull(_ v: Any?) -> Any { v ?? NSNull() }
        var payload: ChatJSON = [
            "kind": kind,
            "course": course,
            "tee_at": WhenPicker.iso(tee),
            "capacity": cap,
            "fee": feeField.won,
            "note": noteField.text.trimmingCharacters(in: .whitespacesAndNewlines),
            "caddie": orNull(screen ? nil : caddie),
            "cart": orNull(screen ? nil : cart),
            "lat": orNull(geo?.lat),
            "lon": orNull(geo?.lon)
        ]
        /* 팀을 적었거나 원래 칸이 있던 라운드일 때만 싣는다 — 그 칸이 아직 없는
           저장소에서 **안 쓰는 모집까지 `PGRST204`로 막히면 안 된다.** */
        if !slots.isEmpty || hadSlots { payload["tee_slots"] = slots }
        /* 코스도 같은 잣대 — 적었거나 원래 칸이 있던 라운드일 때만 싣는다(`PGRST204`). */
        let sub = screen ? "" : (subField.text ?? "").trimmingCharacters(in: .whitespaces)
        if !sub.isEmpty || hadSub { payload["sub_course"] = sub.isEmpty ? NSNull() : sub }
        let saveTitle = round == nil ? "모집 열기" : "수정 저장"
        setSave(saveTitle, busy: true)
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            do {
                let id: String
                if let r = self.round {
                    try await self.service.patchRow("rounds", id: r.id, payload)
                    id = r.id
                } else {
                    var row = payload
                    row["created_by"] = self.service.config.user
                    guard let nid = try await self.service.insertRows("rounds", [row]).first?["id"] as? String else {
                        throw NativeChatError(message: "모집을 열지 못했습니다. 다시 시도해 주세요.")
                    }
                    id = nid
                }
                self.flash(self.round == nil ? "모집을 열었습니다." : "수정했습니다.")
                if self.round != nil { self.goBack() }
                else { self.navigate("/rounds/\(id)", replace: true) }
            } catch {
                self.setSave(saveTitle, busy: false)
                self.flash(error.localizedDescription, error: true)
            }
        }
    }
}

/// 체크칸 하나(웹 `.opt`) — 켜지면 분홍 테두리 · 옅은 분홍 바탕 · 초록 체크.
final class OptButton: UIControl {
    private let box = UILabel()
    private let label = UILabel()
    var on = false { didSet { paint() } }
    /// 켜졌을 때 네모 안에 ✓ 대신 적을 글자 — 코스 칩의 `1`·`2`(전·후반 차례).
    var mark: String? { didSet { paint() } }

    init() {
        super.init(frame: .zero)
        layer.cornerRadius = AppSkin.radiusSm
        layer.borderWidth = 1
        box.textAlignment = .center
        box.font = .systemFont(ofSize: 12, weight: .heavy)
        box.textColor = .white
        box.layer.cornerRadius = 5
        box.layer.borderWidth = 1.5
        box.layer.masksToBounds = true
        label.font = .systemFont(ofSize: 15, weight: .semibold)
        let row = UIStackView(arrangedSubviews: [box, label])
        row.axis = .horizontal; row.spacing = 8; row.alignment = .center
        row.isUserInteractionEnabled = false
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)
        NSLayoutConstraint.activate([
            heightAnchor.constraint(equalToConstant: 44),
            box.widthAnchor.constraint(equalToConstant: 18),
            box.heightAnchor.constraint(equalToConstant: 18),
            row.centerXAnchor.constraint(equalTo: centerXAnchor),
            row.centerYAnchor.constraint(equalTo: centerYAnchor),
            row.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 8)
        ])
        paint()
    }
    required init?(coder: NSCoder) { fatalError() }

    func setTitle(_ t: String) { label.text = t; accessibilityLabel = t }

    private func paint() {
        layer.borderColor = (on ? AppSkin.brandDeep : AppSkin.line).cgColor
        backgroundColor = on ? AppSkin.brand.withAlphaComponent(0.1) : AppSkin.surface
        label.textColor = on ? AppSkin.text : AppSkin.dim
        box.text = on ? (mark ?? "✓") : ""
        box.backgroundColor = on ? AppSkin.grass : .clear
        box.layer.borderColor = (on ? AppSkin.grass : AppSkin.line).cgColor
        accessibilityTraits = on ? [.button, .selected] : .button
    }
}

/**
 * 금액 칸(웹 `components/WonField.tsx`) — 치는 대로 `100,000`으로 보이고
 * 오른쪽에 `원`이 붙는다. **값은 숫자뿐이다**(`won`). 쉼표는 보여 줄 때만.
 */
final class WonTextField: UITextField {
    private let unit = UILabel()
    var won: Int { Int((text ?? "").filter(\.isNumber)) ?? 0 }

    init() {
        super.init(frame: .zero)
        font = .systemFont(ofSize: 16)
        textColor = AppSkin.text
        backgroundColor = AppSkin.surface
        layer.cornerRadius = AppSkin.radiusSm
        layer.borderWidth = 1
        layer.borderColor = AppSkin.line.cgColor
        textAlignment = .right
        keyboardType = .numberPad
        heightAnchor.constraint(equalToConstant: 44).isActive = true
        unit.text = "원"
        unit.font = .systemFont(ofSize: 16)
        unit.textColor = AppSkin.dim
        unit.sizeToFit()
        let pad = UIView(frame: CGRect(x: 0, y: 0, width: unit.bounds.width + 13, height: 44))
        unit.frame.origin = CGPoint(x: 3, y: (44 - unit.bounds.height) / 2)
        pad.addSubview(unit)
        rightView = pad
        rightViewMode = .always
        leftView = UIView(frame: CGRect(x: 0, y: 0, width: 13, height: 44))
        leftViewMode = .always
        addTarget(self, action: #selector(changed), for: .editingChanged)
    }
    required init?(coder: NSCoder) { fatalError() }

    func setWon(_ n: Int) { text = Self.group(n) }

    static func group(_ n: Int) -> String {
        let f = NumberFormatter(); f.numberStyle = .decimal; f.locale = Locale(identifier: "ko_KR")
        return f.string(from: NSNumber(value: n)) ?? String(n)
    }

    /* 커서는 **앞에 숫자가 몇 개였나**로 되돌린다 — 글자 수로 세면 쉼표가
       하나 늘 때마다 한 칸씩 밀린다(웹 `WonField`와 같은 셈). */
    @objc private func changed() {
        let raw = text ?? ""
        let caret = selectedTextRange.map { offset(from: beginningOfDocument, to: $0.start) } ?? raw.count
        let before = raw.prefix(caret).filter(\.isNumber).count
        let digits = String(raw.filter(\.isNumber).drop(while: { $0 == "0" }).prefix(9))
        let out = digits.isEmpty ? (raw.contains("0") ? "0" : "") : Self.group(Int(digits) ?? 0)
        guard out != raw else { return }
        text = out
        var seen = 0, pos = 0
        for ch in out {
            if seen >= before { break }
            pos += 1
            if ch.isNumber { seen += 1 }
        }
        if let p = position(from: beginningOfDocument, offset: min(pos, out.count)) {
            selectedTextRange = textRange(from: p, to: p)
        }
    }
}

/**
 * 골프장 목록 — 웹이 `open({courses})`로 실어 보낸 것(`src/lib/courses.ts`).
 * 찾는 규칙은 웹 `courseGeo`·`searchCourses`와 같다 — **한쪽만 고치지 말 것.**
 * 띄어쓰기·대소문자를 지우고 견준다.
 */
struct CourseBook {
    struct Course { let name: String; let lat: Double; let lon: Double }
    let list: [Course]
    private let byKey: [String: Course]

    init(_ raw: [ChatJSON]) {
        list = raw.compactMap { d in
            guard let n = d["name"] as? String, let lat = d["lat"] as? Double, let lon = d["lon"] as? Double else { return nil }
            return Course(name: n, lat: lat, lon: lon)
        }
        var m: [String: Course] = [:]
        for c in list where m[Self.key(c.name)] == nil { m[Self.key(c.name)] = c }
        byKey = m
    }
    static func key(_ s: String) -> String { s.components(separatedBy: .whitespacesAndNewlines).joined().lowercased() }

    /// 딱 맞는 것, 없으면 **이름이 들어 있는 곳 중 가장 긴 것**.
    func geo(_ name: String) -> Course? {
        let k = Self.key(name)
        guard !k.isEmpty else { return nil }
        if let c = byKey[k] { return c }
        var best: Course?
        for c in list {
            let ck = Self.key(c.name)
            guard k.contains(ck) || ck.contains(k) else { continue }
            if best == nil || ck.count > Self.key(best!.name).count { best = c }
        }
        return best
    }
    /// 검색칸 아래 몇 곳 — 짧은 이름이 먼저.
    func search(_ q: String, limit: Int = 8) -> [Course] {
        let k = Self.key(q)
        guard !k.isEmpty else { return [] }
        /* 같은 길이는 목록 차례 그대로(웹 `sort`는 안정 정렬이다). */
        let hit = list.enumerated().filter { Self.key($0.element.name).contains(k) }
        return Array(hit.sorted { ($0.element.name.count, $0.offset) < ($1.element.name.count, $1.offset) }
            .prefix(limit).map { $0.element })
    }
}
