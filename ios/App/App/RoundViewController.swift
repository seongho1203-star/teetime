import UIKit

/*
 * **라운드 상세** — 웹 `screens/RoundDetail.tsx`(+ `components/Settlement.tsx`의
 * 보는 쪽 · `components/Comments.tsx`)를 Swift로 옮긴 것이다
 * (`docs/아이폰-네이티브.md` 2단계).
 *
 * **규칙은 웹과 같다 — 한쪽만 고치지 말 것:**
 *  - **신청·취소는 DB 함수(`join_round`·`leave_round`)가 한다.** 정원은 여기서
 *    안 센다 — 둘이 동시에 누르면 정원 4에 5명이 들어앉는 그 자리다.
 *    자리가 다 차면 `대기 신청`이고, 모집이 닫혔거나 지났으면 `신청 마감`이다.
 *  - **`opens_at`은 안 본다**(`신청 시작` 칸을 없앴다 — 옛 값이 남아 있으면
 *    풀 길 없이 신청이 잠긴다).
 *  - 상태표는 맨 앞이 늘 '지금 어떤 상태인가'다 — 취소됨 · 종료 · 모집 마감
 *    (닫았거나 **자리가 다 찼거나**) · 모집중. 그다음 D-day.
 *  - 정보 표는 **칸 수가 늘 짝수다** — 필드는 캐디·카트를 각각 한 칸씩
 *    (안 정했으면 `미정`), 스크린은 둘 다 없다.
 *  - 조가 짜여 있으면 **조별로 묶어 그린다.** 내 조는 작은 표(`내 조`)로만
 *    알린다 — 칸을 분홍으로 칠하면 '지금 눌러야 할 것'과 뜻이 섞인다.
 *    미배정은 맨 뒤다.
 *  - `📣 대화방에 공유`는 누구나(지난·취소된 라운드는 빼고), `📋 같은 조건으로
 *    새로 열기`는 **스크린만**. 공유 글의 셋째 줄은 `·`로 갈라 적는다 —
 *    카드가 첫 조각을 큰 제목(날짜)으로, 나머지를 칩으로 그린다.
 *  - 운영 단추(모집 마감·다시 열기·취소·되돌리기·지우기)와 `수정`·`조 편성`은
 *    **연 사람과 운영진**. 남을 빼는 `✕`는 운영진만.
 *  - 정산은 **보는 쪽만** 여기 있다 — 내 몫 크게 · `입금완료`(본인만 뒤집는다) ·
 *    계좌 복사 · `토스로 보내기` · 누구 몫이 얼마인지 · 지우기(만든 사람·
 *    총무·운영진). **만드는 것은 3단계(쓰는 화면)에서 온다.**
 *  - 댓글은 누구나 달고 지우는 것은 쓴 사람과 운영진. 알림은 안 간다.
 *
 * **쓰는 화면은 아직 웹이다** — `수정`(`/rounds/<id>/edit`) · `조 편성`
 * (`/rounds/<id>/groups`) · `같은 조건으로 새로 열기`(`/rounds/new?from=`)는
 * `navigate`로 넘긴다.
 *
 * 신청 단추는 **화면 아래 붙박이 바**다(웹의 `sticky`와 같은 뜻). 댓글 칸은
 * 공지 상세와 같이 키보드에 묶인 바인데, **적는 동안만 뜬다** — 아래에 신청
 * 단추가 이미 있어 바를 둘 세울 자리가 없다. 댓글 카드의 `댓글 남기기`를
 * 누르면 그때 올라온다(웹 앱의 댓글 바와 같은 규칙).
 */
final class RoundViewController: NativeScreenController, UITextViewDelegate {
    private let roundId: String

    private let scroll = UIScrollView()
    private let stack = UIStackView()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let refresh = UIRefreshControl()

    private let actionBar = UIView()
    private let actionBtn = UIButton(type: .system)
    private var actionBarH: NSLayoutConstraint?

    private let composer = UIView()
    private let field = UITextView()
    private let sendBtn = UIButton(type: .system)
    private var fieldH: NSLayoutConstraint?
    private let commentTap = UIButton(type: .system)

    private var round: AppRound?
    private var comments: [AppComment] = []
    private var settlements: [AppSettlement] = []
    private var shares: [AppShare] = []
    private var tees: [String: String] = [:]
    private var people: [String: AppProfile] = [:]
    private var busy = false

    private var me: AppProfile? { people[service.config.user] }
    private var myId: String { service.config.user }
    private var isAdmin: Bool { AppRole.isAdmin(me?.role ?? "member") }
    /// 총무 + 운영진 — DB `can_settle()`과 같은 잣대(웹 `canSettle`).
    private var canSettle: Bool { isAdmin || me?.role == "treasurer" }
    private var isOwner: Bool { round?.createdBy == myId }

    /// 은행 목록(웹 `BANKS`) — 웹이 실어 보낸다. 비어 있으면 `＋ 정산`이 안 뜬다.
    private let banks: [String]

    init(service: NativeChatService, id: String, banks: [String] = []) {
        roundId = id
        self.banks = banks
        super.init(service: service, title: "라운드")
    }
    required init?(coder: NSCoder) { fatalError() }

    deinit { NotificationCenter.default.removeObserver(self) }

    override func viewDidLoad() {
        super.viewDidLoad()
        rightButton.setTitle("수정", for: .normal)
        rightButton.addTarget(self, action: #selector(editTapped), for: .touchUpInside)

        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.alwaysBounceVertical = true
        scroll.keyboardDismissMode = .interactive
        refresh.addTarget(self, action: #selector(pulled), for: .valueChanged)
        scroll.refreshControl = refresh
        stack.axis = .vertical
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.isLayoutMarginsRelativeArrangement = true
        stack.layoutMargins = UIEdgeInsets(top: 4, left: 16, bottom: 24, right: 16)
        scroll.addSubview(stack)

        /* 신청 단추 바 — 흰 바탕에 위쪽 가는 선(웹 `.round-actions`). */
        actionBar.backgroundColor = AppSkin.bg
        actionBar.translatesAutoresizingMaskIntoConstraints = false
        let rule = UIView()
        rule.backgroundColor = AppSkin.line
        rule.translatesAutoresizingMaskIntoConstraints = false
        actionBtn.translatesAutoresizingMaskIntoConstraints = false
        actionBtn.titleLabel?.font = .systemFont(ofSize: 16, weight: .bold)
        actionBtn.layer.cornerRadius = 22
        actionBtn.addTarget(self, action: #selector(actionTapped), for: .touchUpInside)
        actionBar.addSubview(rule); actionBar.addSubview(actionBtn)

        /* 댓글 적는 바 — 공지 상세와 같은 모양, **적는 동안만** 보인다. */
        composer.backgroundColor = AppSkin.bg
        composer.translatesAutoresizingMaskIntoConstraints = false
        composer.isHidden = true
        let crule = UIView()
        crule.backgroundColor = AppSkin.line
        crule.translatesAutoresizingMaskIntoConstraints = false
        field.translatesAutoresizingMaskIntoConstraints = false
        field.font = .systemFont(ofSize: 16)
        field.textColor = AppSkin.text
        field.backgroundColor = AppSkin.surface
        field.layer.cornerRadius = AppSkin.radiusSm
        field.layer.borderWidth = 1
        field.layer.borderColor = AppSkin.line.cgColor
        field.textContainerInset = UIEdgeInsets(top: 11, left: 9, bottom: 11, right: 9)
        field.delegate = self
        field.isScrollEnabled = false
        appButton(sendBtn, title: "등록", color: AppSkin.brand, filled: true)
        sendBtn.addTarget(self, action: #selector(sendTapped), for: .touchUpInside)
        /* 단추는 제 글자만큼만, 글칸이 나머지를 다 쓴다(공지 상세에서 겪은 그 자리). */
        sendBtn.setContentHuggingPriority(.required, for: .horizontal)
        sendBtn.setContentCompressionResistancePriority(.required, for: .horizontal)
        field.setContentHuggingPriority(.defaultLow, for: .horizontal)
        field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        composer.addSubview(crule); composer.addSubview(field); composer.addSubview(sendBtn)

        /* 댓글 카드 안의 누르는 자리 — 글칸처럼 생겼지만 누르면 위의 바가 올라온다. */
        commentTap.addTarget(self, action: #selector(commentTapTapped), for: .touchUpInside)
        commentTap.contentHorizontalAlignment = .left
        commentTap.titleLabel?.font = .systemFont(ofSize: 16)
        commentTap.titleLabel?.lineBreakMode = .byTruncatingTail
        commentTap.backgroundColor = AppSkin.surface2
        commentTap.layer.cornerRadius = AppSkin.radiusSm
        commentTap.layer.borderWidth = 1
        commentTap.layer.borderColor = AppSkin.line.cgColor
        commentTap.contentEdgeInsets = UIEdgeInsets(top: 11, left: 12, bottom: 11, right: 12)
        commentTap.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true

        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.hidesWhenStopped = true

        body.addSubview(scroll); body.addSubview(actionBar); body.addSubview(composer); body.addSubview(spinner)
        let abh = actionBar.heightAnchor.constraint(equalToConstant: 0)
        actionBarH = abh
        let fh = field.heightAnchor.constraint(equalToConstant: 44)
        fieldH = fh
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: body.topAnchor),
            scroll.leadingAnchor.constraint(equalTo: body.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: body.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: actionBar.topAnchor),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor),
            actionBar.leadingAnchor.constraint(equalTo: body.leadingAnchor),
            actionBar.trailingAnchor.constraint(equalTo: body.trailingAnchor),
            actionBar.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            abh,
            rule.topAnchor.constraint(equalTo: actionBar.topAnchor),
            rule.leadingAnchor.constraint(equalTo: actionBar.leadingAnchor),
            rule.trailingAnchor.constraint(equalTo: actionBar.trailingAnchor),
            rule.heightAnchor.constraint(equalToConstant: 1),
            actionBtn.leadingAnchor.constraint(equalTo: actionBar.leadingAnchor, constant: 16),
            actionBtn.trailingAnchor.constraint(equalTo: actionBar.trailingAnchor, constant: -16),
            actionBtn.topAnchor.constraint(equalTo: actionBar.topAnchor, constant: 10),
            actionBtn.heightAnchor.constraint(equalToConstant: 44),
            composer.leadingAnchor.constraint(equalTo: body.leadingAnchor),
            composer.trailingAnchor.constraint(equalTo: body.trailingAnchor),
            /* **키보드에 묶는다** — 올라오면 키보드 위에 선다. */
            composer.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
            crule.topAnchor.constraint(equalTo: composer.topAnchor),
            crule.leadingAnchor.constraint(equalTo: composer.leadingAnchor),
            crule.trailingAnchor.constraint(equalTo: composer.trailingAnchor),
            crule.heightAnchor.constraint(equalToConstant: 1),
            field.topAnchor.constraint(equalTo: composer.topAnchor, constant: 9),
            field.bottomAnchor.constraint(equalTo: composer.bottomAnchor, constant: -9),
            field.leadingAnchor.constraint(equalTo: composer.leadingAnchor, constant: 16),
            fh,
            sendBtn.leadingAnchor.constraint(equalTo: field.trailingAnchor, constant: 10),
            sendBtn.trailingAnchor.constraint(equalTo: composer.trailingAnchor, constant: -16),
            sendBtn.bottomAnchor.constraint(equalTo: field.bottomAnchor),
            sendBtn.heightAnchor.constraint(equalToConstant: 44),
            spinner.centerXAnchor.constraint(equalTo: body.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: body.centerYAnchor)
        ])
        scroll.isHidden = true
        actionBar.isHidden = true

        NotificationCenter.default.addObserver(self, selector: #selector(kbChanged(_:)), name: UIResponder.keyboardWillShowNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(kbChanged(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
    }

    /// 키보드가 오르내리면 목록 아래를 그만큼 비운다 — 댓글 칸이 키보드 뒤로 안 들어가게.
    @objc private func kbChanged(_ n: Notification) {
        guard let end = (n.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue else { return }
        let inView = view.convert(end, from: nil)
        let covered = max(0, view.bounds.maxY - inView.minY)
        let bar = actionBar.isHidden ? 0 : (actionBarH?.constant ?? 0) + view.safeAreaInsets.bottom
        let inset = n.name == UIResponder.keyboardWillHideNotification ? 0 : max(0, covered - bar + 62)
        scroll.contentInset.bottom = inset
        scroll.verticalScrollIndicatorInsets.bottom = inset
        if inset > 0 {
            let y = max(0, scroll.contentSize.height - scroll.bounds.height + inset)
            scroll.setContentOffset(CGPoint(x: 0, y: y), animated: true)
        }
    }

    // ── 받아 오기 ────────────────────────────────────────────────

    override func loadScreen() {
        if round == nil { spinner.startAnimating() }
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            do {
                let r = try await self.service.round(self.roundId)
                self.comments = try await self.service.roundComments(self.roundId)
                self.people = try await self.service.peopleById()
                /* 조별 시각·정산은 **있으면 좋은 것** — 표가 없는 저장소에서 라운드가 통째로 안 열리면 안 된다. */
                self.tees = await self.service.groupTees(self.roundId)
                self.settlements = await self.service.settlements(self.roundId)
                self.shares = await self.service.settlementShares(self.settlements.map { $0.id })
                self.round = r
                self.render()
            } catch {
                self.flash(error.localizedDescription, error: true)
            }
            self.spinner.stopAnimating()
            self.refresh.endRefreshing()
        }
    }

    @objc private func pulled() { loadScreen() }

    // ── 그리기 ───────────────────────────────────────────────────

    private func render() {
        guard let r = round else {
            scroll.isHidden = true; actionBar.isHidden = true
            flash("없는 라운드입니다.", error: true)
            return
        }
        scroll.isHidden = false
        rightButton.isHidden = !(isAdmin || isOwner)
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }

        let confirmed = r.confirmed.sorted { $0.seq < $1.seq }
        let waiting = r.waiting.sorted { $0.seq < $1.seq }
        let openSlots = max(0, r.capacity - confirmed.count)
        let isPast = r.isPast
        let my = r.mine(myId)

        // 머리 — 표 줄 · 장소 · (제목이 따로 있으면) 작은 줄
        var badges: [UIView] = [BadgeLabel("\(r.kindIcon) \(r.kindLabel)", r.isScreen ? .screen : .field)]
        if r.status == "cancelled" { badges.append(BadgeLabel("취소됨", .danger)) }
        else if isPast { badges.append(BadgeLabel("종료", .done)) }
        else if r.status == "closed" || openSlots == 0 { badges.append(BadgeLabel("모집 마감", .done)) }
        else { badges.append(BadgeLabel("모집중", .live)) }
        if !isPast && r.status != "cancelled" {
            badges.append(BadgeLabel(AppDate.dday(r.teeAt), AppDate.daysUntil(r.teeAt) <= 3 ? .warn : .dim))
        }
        let hero = UIStackView()
        hero.axis = .vertical; hero.spacing = 6
        hero.isLayoutMarginsRelativeArrangement = true
        hero.layoutMargins = UIEdgeInsets(top: 4, left: 2, bottom: 6, right: 2)
        hero.addArrangedSubview(hrow(badges))
        hero.addArrangedSubview(mkLabel("\(r.kindIcon) \(r.place)", size: 22, weight: .bold, lines: 0))
        if !r.title.isEmpty && !r.course.isEmpty { hero.addArrangedSubview(mkLabel(r.title, size: 14, color: AppSkin.dim, lines: 0)) }
        stack.addArrangedSubview(hero)

        // 정보 표 — 두 칸씩, 칸 수는 늘 짝수
        var cells: [(String, String)] = [
            ("날짜", AppDate.fullDate(r.teeAt)), (r.teeLabel, AppDate.time(r.teeAt)),
            ("정원", "\(r.capacity)명"), (r.feeLabel, r.fee > 0 ? AppDate.won(r.fee) : "미정")
        ]
        if !r.isScreen {
            cells.append(("캐디", r.caddie.flatMap { AppRound.caddieShort[$0] } ?? "미정"))
            cells.append(("카트", r.cart.flatMap { AppRound.cartShort[$0] } ?? "미정"))
        }
        let grid = UIStackView()
        grid.axis = .vertical; grid.spacing = 8
        for i in stride(from: 0, to: cells.count, by: 2) {
            let a = InfoCell(cells[i].0, cells[i].1)
            let b = InfoCell(cells[i + 1].0, cells[i + 1].1)
            let row = UIStackView(arrangedSubviews: [a, b])
            row.axis = .horizontal; row.spacing = 8; row.distribution = .fillEqually
            grid.addArrangedSubview(row)
        }
        stack.addArrangedSubview(grid)

        // 공유 · 베끼기 — 오른쪽 정렬
        let canShare = !isPast && r.status != "cancelled"
        if canShare || r.isScreen {
            let row = UIStackView()
            row.axis = .horizontal; row.spacing = 8; row.alignment = .center
            row.addArrangedSubview(UIView())
            if canShare {
                let b = UIButton(type: .system)
                appButton(b, title: "📣 대화방에 공유", color: AppSkin.text, filled: false)
                b.addTarget(self, action: #selector(shareTapped), for: .touchUpInside)
                row.addArrangedSubview(b)
            }
            if r.isScreen {
                let b = UIButton(type: .system)
                appButton(b, title: "📋 같은 조건으로 새로 열기", color: AppSkin.text, filled: false)
                b.addTarget(self, action: #selector(cloneTapped), for: .touchUpInside)
                row.addArrangedSubview(b)
            }
            stack.addArrangedSubview(row)
        }

        // 전달 내용 — 노란 쪽지(꼭 읽어야 할 줄)
        let note = r.note.trimmingCharacters(in: .whitespacesAndNewlines)
        if !note.isEmpty {
            let card = CardView()
            card.backgroundColor = AppSkin.warn.withAlphaComponent(0.10)
            card.layer.borderColor = AppSkin.warn.withAlphaComponent(0.35).cgColor
            card.content.addArrangedSubview(sectionTitle("전달 내용"))
            let l = mkLabel("", size: 15, lines: 0)
            let para = NSMutableParagraphStyle(); para.lineSpacing = 6
            l.attributedText = NSAttributedString(string: note, attributes: [.font: UIFont.systemFont(ofSize: 15), .foregroundColor: AppSkin.text, .paragraphStyle: para])
            card.content.addArrangedSubview(l)
            stack.addArrangedSubview(card)
        }

        // 참가 확정
        let joinCard = CardView()
        let head = hrow([sectionTitle("참가 확정 \(confirmed.count)/\(r.capacity)")])
        if openSlots > 0 && !isPast { head.addArrangedSubview(BadgeLabel("\(openSlots)자리 남음", .brand)) }
        joinCard.content.addArrangedSubview(head)
        let grouped = r.grouped()
        if !grouped.isEmpty {
            for g in grouped {
                let block = UIStackView(); block.axis = .vertical; block.spacing = 2
                let gh = hrow([mkLabel(g.no.map { "\($0)조" } ?? "미배정", size: 14, weight: .bold)], spacing: 8)
                if g.list.contains(where: { $0.userId == myId }) { gh.addArrangedSubview(BadgeLabel("내 조", .brand)) }
                if let no = g.no, let t = tees[String(no)] {
                    gh.addArrangedSubview(mkLabel("\(r.teeLabel) \(AppDate.time(t))", size: 12, color: AppSkin.faint))
                }
                block.addArrangedSubview(gh)
                for (i, s) in g.list.enumerated() { block.addArrangedSubview(personRow(seq: i + 1, s, waiting: false)) }
                joinCard.content.addArrangedSubview(block)
            }
        } else {
            let list = UIStackView(); list.axis = .vertical; list.spacing = 2
            for (i, s) in confirmed.enumerated() { list.addArrangedSubview(personRow(seq: i + 1, s, waiting: false)) }
            /* 남은 자리를 빈 줄로 그려 둔다 — 몇 자리인지 세지 않아도 보인다. */
            if !isPast {
                for i in 0..<openSlots { list.addArrangedSubview(emptySlot(seq: confirmed.count + i + 1)) }
            }
            joinCard.content.addArrangedSubview(list)
        }
        /* 조 편성으로 들어가는 문 — 명단 바로 밑. 말은 `조 편성` 하나다. */
        if (isAdmin || isOwner) && !confirmed.isEmpty {
            let b = UIButton(type: .system)
            appButton(b, title: "🚩 " + (grouped.isEmpty ? "조 편성" : "조 편성 고치기"), color: AppSkin.text, filled: false)
            b.addTarget(self, action: #selector(groupsTapped), for: .touchUpInside)
            joinCard.content.addArrangedSubview(hrow([b]))
        }
        stack.addArrangedSubview(joinCard)

        // 대기
        if !waiting.isEmpty {
            let card = CardView()
            card.content.addArrangedSubview(sectionTitle("대기 \(waiting.count)명"))
            let list = UIStackView(); list.axis = .vertical; list.spacing = 2
            for (i, s) in waiting.enumerated() { list.addArrangedSubview(personRow(seq: i + 1, s, waiting: true)) }
            card.content.addArrangedSubview(list)
            card.content.addArrangedSubview(mkLabel("확정자가 빠지면 위에서부터 자동으로 올라갑니다.", size: 12, color: AppSkin.faint, lines: 0))
            stack.addArrangedSubview(card)
        }

        // 정산 — 돈은 댓글보다 먼저 눈에 들어와야 한다
        let settleCard = CardView()
        let settleTitle = sectionTitle(settlements.isEmpty ? "정산" : "정산 \(settlements.count)")
        if banks.isEmpty {
            settleCard.content.addArrangedSubview(settleTitle)
        } else {
            /* **만드는 것은 회원 누구나**(웹 `Settlements`) — 걷는 사람이 곧 만드는 사람이다. */
            let add = UIButton(type: .system)
            appButton(add, title: "＋ 정산", color: AppSkin.text, filled: false)
            add.addTarget(self, action: #selector(addSettlementTapped), for: .touchUpInside)
            settleCard.content.addArrangedSubview(hrow([settleTitle, UIView(), add], fill: true))
        }
        if settlements.isEmpty {
            settleCard.content.addArrangedSubview(mkLabel("아직 정산이 없습니다.", size: 12, color: AppSkin.faint))
        }
        for s in settlements {
            settleCard.content.addArrangedSubview(settlementView(s, shares: shares.filter { $0.settlementId == s.id }))
        }
        stack.addArrangedSubview(settleCard)

        // 운영 — 연 사람과 운영진만
        if isAdmin || isOwner {
            let card = CardView()
            card.content.addArrangedSubview(sectionTitle(isAdmin ? "운영" : "내가 연 모집"))
            let row = UIStackView(); row.axis = .horizontal; row.spacing = 8; row.alignment = .center
            let wrap = UIStackView(); wrap.axis = .vertical; wrap.spacing = 8
            var line = row
            var count = 0
            func put(_ title: String, danger: Bool, _ sel: Selector) {
                let b = UIButton(type: .system)
                appButton(b, title: title, color: danger ? AppSkin.danger : AppSkin.text, filled: danger)
                b.addTarget(self, action: sel, for: .touchUpInside)
                if count == 2 { line.addArrangedSubview(UIView()); wrap.addArrangedSubview(line); line = UIStackView(); line.axis = .horizontal; line.spacing = 8; line.alignment = .center; count = 0 }
                line.addArrangedSubview(b); count += 1
            }
            if r.status == "open" { put("모집 마감", danger: false, #selector(closeTapped)) }
            if r.status == "closed" { put("모집 다시 열기", danger: false, #selector(reopenTapped)) }
            if r.status != "cancelled" { put("라운드 취소", danger: false, #selector(cancelTapped)) }
            else { put("취소 되돌리기", danger: false, #selector(reopenTapped)) }
            put("지우기", danger: true, #selector(deleteTapped))
            line.addArrangedSubview(UIView()); wrap.addArrangedSubview(line)
            card.content.addArrangedSubview(wrap)
            stack.addArrangedSubview(card)
        }

        // 댓글 — 신청 단추보다 아래
        let ccard = CardView()
        ccard.content.addArrangedSubview(sectionTitle("댓글 \(comments.count)"))
        if comments.isEmpty {
            ccard.content.addArrangedSubview(mkLabel("아직 댓글이 없습니다.", size: 12, color: AppSkin.faint))
        }
        let clist = UIStackView(); clist.axis = .vertical; clist.spacing = 0
        for (i, c) in comments.enumerated() {
            let row = CommentRow()
            row.fill(c, who: c.authorId.flatMap { people[$0] }, canDelete: isAdmin || c.authorId == myId, first: i == 0)
            row.onDelete = { [weak self] in self?.deleteComment(c) }
            clist.addArrangedSubview(row)
        }
        ccard.content.addArrangedSubview(clist)
        /* 누르는 자리 — 진짜 글칸은 키보드에 묶인 바라 그때 올라온다. */
        styleCommentTap()
        ccard.content.addArrangedSubview(commentTap)
        stack.addArrangedSubview(ccard)

        // 신청 단추 — 지난·취소된 라운드에는 바가 없다
        if !isPast && r.status != "cancelled" {
            actionBar.isHidden = false
            actionBarH?.constant = 64
            let canSignUp = r.status == "open"
            if let my = my {
                actionBtn.setTitle(my.state == "confirmed" ? "참가 취소" : "대기 취소", for: .normal)
                actionBtn.backgroundColor = AppSkin.danger
                actionBtn.setTitleColor(.white, for: .normal)
                actionBtn.isEnabled = true
            } else {
                actionBtn.setTitle(!canSignUp ? "신청 마감" : openSlots > 0 ? "참가 신청" : "대기 신청", for: .normal)
                actionBtn.backgroundColor = canSignUp ? AppSkin.brand : AppSkin.surface2
                actionBtn.setTitleColor(canSignUp ? .white : AppSkin.faint, for: .normal)
                actionBtn.isEnabled = canSignUp
            }
        } else {
            actionBar.isHidden = true
            actionBarH?.constant = 0
        }
    }

    private func sectionTitle(_ t: String) -> UILabel { mkLabel(t, size: 14, weight: .bold, color: AppSkin.dim) }

    /// 누르는 자리의 글자만 갈아 끼운다 — 적어 둔 글이 있으면 그 글이 보인다.
    private func styleCommentTap() {
        let draft = (field.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        commentTap.setTitle(draft.isEmpty ? "댓글 남기기" : draft, for: .normal)
        commentTap.setTitleColor(draft.isEmpty ? AppSkin.faint : AppSkin.text, for: .normal)
    }

    /// 참가자 한 줄 — 번호 · 얼굴 · 이름표 (나) · 운영진의 ✕(웹 `PersonRow`). 차량번호는 여기 없다.
    private func personRow(seq: Int, _ s: AppSignup, waiting: Bool) -> UIView {
        let p = people[s.userId]
        let isMe = s.userId == myId
        let n = mkLabel(String(seq), size: 12, weight: .bold, color: AppSkin.faint)
        n.widthAnchor.constraint(equalToConstant: 18).isActive = true
        let face = AvatarView()
        face.backgroundColor = AppSkin.faint
        face.translatesAutoresizingMaskIntoConstraints = false
        face.widthAnchor.constraint(equalToConstant: 28).isActive = true
        face.heightAnchor.constraint(equalToConstant: 28).isActive = true
        face.show(url: p?.avatar, letter: p?.name ?? "", edge: p?.edge, size: 28)
        let label = p?.label ?? ""
        let t = NSMutableAttributedString(string: label.isEmpty ? "알 수 없음" : label,
                                          attributes: [.font: UIFont.systemFont(ofSize: 15, weight: isMe ? .bold : .regular), .foregroundColor: waiting ? AppSkin.dim : AppSkin.text])
        if isMe { t.append(NSAttributedString(string: " (나)", attributes: [.font: UIFont.systemFont(ofSize: 12, weight: .bold), .foregroundColor: AppSkin.brand])) }
        let name = UILabel(); name.attributedText = t; name.lineBreakMode = .byTruncatingTail
        let row = hrow([n, face, name], spacing: 8)
        if isAdmin && !isMe {
            let x = UIButton(type: .system)
            x.setImage(UIImage(systemName: "xmark"), for: .normal)
            x.tintColor = AppSkin.dim
            x.accessibilityLabel = "명단에서 빼기"
            x.widthAnchor.constraint(equalToConstant: 36).isActive = true
            x.heightAnchor.constraint(equalToConstant: 36).isActive = true
            x.addAction(UIAction { [weak self] _ in self?.kick(s.userId) }, for: .touchUpInside)
            row.addArrangedSubview(x)
        }
        row.heightAnchor.constraint(greaterThanOrEqualToConstant: 36).isActive = true
        return row
    }

    private func emptySlot(seq: Int) -> UIView {
        let n = mkLabel(String(seq), size: 12, weight: .bold, color: AppSkin.faint)
        n.widthAnchor.constraint(equalToConstant: 18).isActive = true
        let row = hrow([n, mkLabel("빈 자리", size: 15, color: AppSkin.faint)], spacing: 8)
        row.heightAnchor.constraint(greaterThanOrEqualToConstant: 36).isActive = true
        return row
    }

    /// 정산 한 건(웹 `SettlementCard`) — 내 몫이 맨 위에 온다.
    private func settlementView(_ s: AppSettlement, shares: [AppShare]) -> UIView {
        let box = UIStackView()
        box.axis = .vertical; box.spacing = 8
        box.isLayoutMarginsRelativeArrangement = true
        box.layoutMargins = UIEdgeInsets(top: 10, left: 0, bottom: 4, right: 0)
        let top = hrow([mkLabel(s.title, size: 15, weight: .bold)], spacing: 8)
        top.addArrangedSubview(mkLabel(AppDate.ago(s.createdAt), size: 12, color: AppSkin.faint))
        box.addArrangedSubview(top)
        if let by = s.createdBy {
            box.addArrangedSubview(mkLabel("\(people[by]?.name ?? "알 수 없음")님이 걷습니다", size: 12, color: AppSkin.faint))
        }
        if !s.body.isEmpty { box.addArrangedSubview(mkLabel(s.body, size: 14, color: AppSkin.dim, lines: 0)) }

        let mine = shares.first { $0.userId == myId }
        if let m = mine {
            /* 낼 돈을 맨 위에 크게 · 그 아래 꽉 찬 단추(`입금완료`). 누른 뒤에는 잔디색 ✓. */
            let wrap = UIStackView(); wrap.axis = .vertical; wrap.spacing = 8
            wrap.isLayoutMarginsRelativeArrangement = true
            wrap.layoutMargins = UIEdgeInsets(top: 10, left: 12, bottom: 10, right: 12)
            wrap.backgroundColor = m.paid ? AppSkin.grass.withAlphaComponent(0.12) : AppSkin.surface2
            wrap.layer.cornerRadius = AppSkin.radiusSm
            let line = hrow([mkLabel("입금금액", size: 13, color: AppSkin.dim)])
            line.addArrangedSubview(mkLabel(AppDate.won(m.amount), size: 20, weight: .bold))
            wrap.addArrangedSubview(line)
            let b = UIButton(type: .system)
            appButton(b, title: m.paid ? "입금완료 ✓" : "입금완료", color: m.paid ? AppSkin.grass : AppSkin.brand, filled: true)
            b.addAction(UIAction { [weak self] _ in self?.togglePaid(m) }, for: .touchUpInside)
            wrap.addArrangedSubview(b)
            if m.paid { wrap.addArrangedSubview(mkLabel("잘못 누르셨으면 한 번 더 누르면 취소됩니다.", size: 12, color: AppSkin.faint, lines: 0)) }
            box.addArrangedSubview(wrap)
        }

        if !s.bank.isEmpty || !s.account.isEmpty {
            /* **계좌번호는 자르지 않는다** — 은행을 윗줄에, 번호는 한 줄을 통째로. */
            let col = UIStackView(); col.axis = .vertical; col.spacing = 1
            if !s.bank.isEmpty { col.addArrangedSubview(mkLabel(s.bank, size: 12, color: AppSkin.faint)) }
            let no = mkLabel(s.account, size: 15, weight: .semibold, lines: 0)
            no.adjustsFontSizeToFitWidth = true
            no.minimumScaleFactor = 0.8
            col.addArrangedSubview(no)
            let copy = UIButton(type: .system)
            appButton(copy, title: "복사", color: AppSkin.text, filled: false)
            copy.addAction(UIAction { [weak self] _ in
                UIPasteboard.general.string = "\(s.bank) \(s.account)".trimmingCharacters(in: .whitespaces)
                self?.flash("계좌를 복사했습니다.")
            }, for: .touchUpInside)
            let row = hrow([col], spacing: 8)
            row.addArrangedSubview(copy)
            box.addArrangedSubview(row)
        }
        if !s.account.isEmpty {
            /* 송금 지름길 — 토스가 없으면 안 열리므로 위의 복사를 그대로 둔다. 분홍을 안 쓴다. */
            let t = UIButton(type: .system)
            appButton(t, title: "토스로 보내기", color: AppSkin.text, filled: false)
            t.addAction(UIAction { [weak self] _ in
                guard let url = s.tossURL(amount: mine?.amount) else { return }
                UIApplication.shared.open(url, options: [:]) { ok in
                    if !ok { self?.flash("토스 앱이 없어 열지 못했습니다. 계좌를 복사해 보내 주세요.", error: true) }
                }
            }, for: .touchUpInside)
            box.addArrangedSubview(t)
            box.addArrangedSubview(mkLabel("토스 앱이 깔려 있을 때만 열립니다.", size: 12, color: AppSkin.faint))
        }

        /* 누구 몫이 얼마인지 — 얼굴 · 이름표 · 금액, 낸 사람은 옅게. */
        let chips = UIStackView(); chips.axis = .vertical; chips.spacing = 4
        for x in shares {
            let p = people[x.userId]
            let face = AvatarView()
            face.backgroundColor = AppSkin.faint
            face.widthAnchor.constraint(equalToConstant: 22).isActive = true
            face.heightAnchor.constraint(equalToConstant: 22).isActive = true
            face.show(url: p?.avatar, letter: p?.name ?? "", edge: p?.edge, size: 22)
            let l = p?.label ?? ""
            let name = mkLabel(l.isEmpty ? "알 수 없음" : l, size: 13, color: x.paid ? AppSkin.faint : AppSkin.text)
            let row = hrow([face, name], spacing: 6)
            row.addArrangedSubview(mkLabel(AppDate.won(x.amount), size: 13, weight: .bold, color: x.paid ? AppSkin.faint : AppSkin.text))
            if x.paid { row.addArrangedSubview(mkLabel("✓", size: 12, weight: .heavy, color: UIColor(hexString: "#5b8d18") ?? AppSkin.grass)) }
            chips.addArrangedSubview(row)
        }
        box.addArrangedSubview(chips)

        let paid = shares.filter { $0.paid }.count
        let foot = hrow([mkLabel("총 \(AppDate.won(s.total)) · \(paid)/\(shares.count)명 보냄", size: 12, color: AppSkin.faint)], spacing: 8)
        if canSettle || s.createdBy == myId {
            let d = UIButton(type: .system)
            appButton(d, title: "지우기", color: AppSkin.danger, filled: true)
            d.addAction(UIAction { [weak self] _ in self?.deleteSettlement(s, count: shares.count) }, for: .touchUpInside)
            foot.addArrangedSubview(d)
        }
        box.addArrangedSubview(foot)
        return box
    }

    // ── 누르는 것들 ─────────────────────────────────────────────

    @objc private func editTapped() { navigate("/rounds/\(roundId)/edit") }
    @objc private func groupsTapped() { navigate("/rounds/\(roundId)/groups") }
    @objc private func cloneTapped() { navigate("/rounds/new?from=\(roundId)") }

    /// 신청 또는 취소 — 정원 셈은 DB가 한다.
    @objc private func actionTapped() {
        guard let r = round, !busy else { return }
        if let my = r.mine(myId) {
            let waiting = r.waiting.sorted { $0.seq < $1.seq }
            let detail: String
            if my.state == "confirmed", let next = waiting.first {
                detail = "내 자리는 대기 1번인 \(people[next.userId]?.name ?? "다음 분")에게 넘어갑니다."
            } else {
                detail = "다시 신청하면 순번은 맨 뒤가 됩니다."
            }
            confirm(title: "신청을 취소할까요?", detail: detail, ok: "취소하기", danger: true) { [weak self] ok in
                guard ok, let self = self else { return }
                self.run {
                    try await self.service.leaveRound(r.id)
                    self.flash("신청을 취소했습니다.")
                }
            }
            return
        }
        run {
            let state = try await self.service.joinRound(r.id)
            self.flash(state == "confirmed" ? "참가가 확정되었습니다." : "자리가 차서 대기자로 올렸습니다.")
        }
    }

    private func kick(_ userId: String) {
        guard let r = round, !busy else { return }
        confirm(title: "\(people[userId]?.name ?? "이 분")을 뺄까요?", detail: "대기자가 있으면 맨 앞 사람이 자동으로 올라갑니다.",
                ok: "빼기", danger: true) { [weak self] ok in
            guard ok, let self = self else { return }
            self.run { try await self.service.kickSignup(r.id, user: userId); self.flash("명단에서 뺐습니다.") }
        }
    }

    @objc private func closeTapped() { setStatus("closed") }
    @objc private func reopenTapped() { setStatus("open") }
    @objc private func cancelTapped() { setStatus("cancelled") }
    private func setStatus(_ status: String) {
        guard let r = round, !busy else { return }
        run { try await self.service.setRoundStatus(r.id, status) }
    }

    @objc private func deleteTapped() {
        guard let r = round, !busy else { return }
        var detail = "\(r.place)\n신청 \(r.signups.count)건"
        if !comments.isEmpty { detail += "과 댓글 \(comments.count)개" }
        detail += "이 함께 사라집니다.\n되돌릴 수 없습니다. 모집만 멈추려면 마감을 쓰세요."
        confirm(title: "이 라운드를 지울까요?", detail: detail, ok: "지우기", danger: true) { [weak self] ok in
            guard ok, let self = self else { return }
            self.busy = true
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                defer { self.busy = false }
                do {
                    try await self.service.deleteRow("rounds", id: r.id)
                    self.flash("지웠습니다.")
                    self.navigate("/rounds", replace: true)
                } catch { self.flash(error.localizedDescription, error: true) }
            }
        }
    }

    @objc private func shareTapped() {
        guard let r = round, !busy else { return }
        let confirmed = r.confirmed.count
        let openSlots = max(0, r.capacity - confirmed)
        confirm(title: "대화방에 올릴까요?",
                detail: "전체 대화방에 이 \(r.kindLabel) 카드가 올라가고, 회원들에게 알림도 갑니다.\n\(r.place) · \(AppDate.dateTime(r.teeAt))",
                ok: "올리기", danger: false) { [weak self] ok in
            guard ok, let self = self else { return }
            /* `필드를` / `스크린을` — 받침이 있으면 `을`. */
            let label = r.kindLabel
            let last = label.unicodeScalars.last!.value
            let josa = (last - 0xac00) % 28 != 0 ? "을" : "를"
            let body = [
                "\(self.me?.name ?? "누군가")님이 \(label)\(josa) 공유했습니다",
                r.place,
                "\(AppDate.day(r.teeAt)) · \(AppDate.time(r.teeAt)) · 정원 \(r.capacity)명" + (openSlots > 0 ? " · \(openSlots)자리 남음" : " · 자리 참")
            ].joined(separator: "\n")
            self.busy = true
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                defer { self.busy = false }
                do {
                    try await self.service.shareToChat(body: body, extra: ["round_id": r.id, "notify": true], drops: ["notify", "round_id"])
                    self.flash("대화방에 올렸습니다.")
                } catch { self.flash(error.localizedDescription, error: true) }
            }
        }
    }

    private func togglePaid(_ m: AppShare) {
        guard !busy else { return }
        run { try await self.service.setSharePaid(m.id, !m.paid) }
    }

    /// 정산 만들기 — 라운드 위에 시트로 뜬다(주소가 없다 · `SettlementEditViewController`).
    @objc private func addSettlementTapped() {
        guard let r = round else { return }
        /* 고르는 명단은 **회원 전체**(대기·추방만 뺀다) — 참가자로 좁히면 뒷풀이만 온 사람을 못 넣는다. */
        let members = people.values.filter { $0.role != "pending" && $0.role != "banned" }
            .sorted { $0.name < $1.name }
        let vc = SettlementEditViewController(service: service, roundId: roundId, people: members,
                                              joined: r.confirmed.sorted { $0.seq < $1.seq }.map { $0.userId },
                                              banks: banks) { [weak self] n in
            self?.flash("\(n)명에게 정산을 보냈습니다.")
            self?.loadScreen()
        }
        vc.modalPresentationStyle = .pageSheet
        present(vc, animated: true)
    }

    private func deleteSettlement(_ s: AppSettlement, count: Int) {
        guard !busy else { return }
        confirm(title: "이 정산을 지울까요?", detail: "\(s.title)\n\(count)명의 몫이 함께 사라집니다.", ok: "지우기", danger: true) { [weak self] ok in
            guard ok, let self = self else { return }
            self.run { try await self.service.deleteRow("settlements", id: s.id); self.flash("지웠습니다.") }
        }
    }

    /// 한 번 하고 다시 받아 온다 — 실패하면 까닭을 알린다.
    private func run(_ job: @escaping () async throws -> Void) {
        busy = true
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            defer { self.busy = false }
            do { try await job(); self.loadScreen() }
            catch { self.flash(error.localizedDescription, error: true) }
        }
    }

    // ── 댓글 ─────────────────────────────────────────────────────

    @objc private func commentTapTapped() {
        composer.isHidden = false
        field.becomeFirstResponder()
    }

    @objc private func sendTapped() {
        let text = (field.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !busy else { return }
        busy = true
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            defer { self.busy = false }
            do {
                try await self.service.addComment(table: "round_comments", parentKey: "round_id", parentId: self.roundId, body: text)
                self.field.text = ""
                self.textViewDidChange(self.field)
                self.field.resignFirstResponder()
                self.comments = (try? await self.service.roundComments(self.roundId)) ?? self.comments
                self.render()
                self.view.layoutIfNeeded()
                let y = max(0, self.scroll.contentSize.height - self.scroll.bounds.height + self.scroll.adjustedContentInset.bottom)
                self.scroll.setContentOffset(CGPoint(x: 0, y: y), animated: true)
            } catch {
                self.flash(error.localizedDescription, error: true)   // 실패하면 적은 글을 남긴다
            }
        }
    }

    private func deleteComment(_ c: AppComment) {
        guard !busy else { return }
        confirm(title: "댓글을 지울까요?", detail: "", ok: "지우기", danger: true) { [weak self] ok in
            guard ok, let self = self else { return }
            self.run { try await self.service.deleteRow("round_comments", id: c.id) }
        }
    }

    func textViewDidChange(_ textView: UITextView) {
        let fit = textView.sizeThatFits(CGSize(width: textView.bounds.width, height: .greatestFiniteMagnitude)).height
        let h = min(140, max(44, fit))
        textView.isScrollEnabled = fit > 140
        if fieldH?.constant != h { fieldH?.constant = h; view.layoutIfNeeded() }
    }
    /* 적기를 마치면 바를 내리고, 적어 둔 글은 누르는 자리에 남긴다. */
    func textViewDidEndEditing(_ textView: UITextView) {
        composer.isHidden = true
        styleCommentTap()
    }
}

/// 정보 표의 한 칸(웹 `.info-cell`) — 옅은 바탕에 이름(작게)·값.
final class InfoCell: UIView {
    init(_ name: String, _ value: String) {
        super.init(frame: .zero)
        backgroundColor = AppSkin.surface2
        layer.cornerRadius = AppSkin.radiusSm
        let col = UIStackView(arrangedSubviews: [mkLabel(name, size: 11, weight: .semibold, color: AppSkin.faint),
                                                 mkLabel(value, size: 15, weight: .semibold, lines: 0)])
        col.axis = .vertical; col.spacing = 2
        col.translatesAutoresizingMaskIntoConstraints = false
        addSubview(col)
        NSLayoutConstraint.activate([
            col.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12),
            col.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),
            col.topAnchor.constraint(equalTo: topAnchor, constant: 9),
            col.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -9)
        ])
    }
    required init?(coder: NSCoder) { fatalError() }
}

/// 단추 모양 — 웹 `.btn ghost sm` / `.btn primary` / `.btn danger sm`(공지 상세의 `style`과 같은 값).
func appButton(_ b: UIButton, title: String, color: UIColor, filled: Bool) {
    b.translatesAutoresizingMaskIntoConstraints = false
    b.setTitle(title, for: .normal)
    b.titleLabel?.font = .systemFont(ofSize: 14, weight: .semibold)
    b.setTitleColor(filled ? .white : color, for: .normal)
    b.backgroundColor = filled ? color : AppSkin.surface
    b.layer.cornerRadius = 20
    b.layer.borderWidth = filled ? 0 : 1
    b.layer.borderColor = AppSkin.line.cgColor
    b.contentEdgeInsets = UIEdgeInsets(top: 10, left: 16, bottom: 10, right: 16)
    b.setContentHuggingPriority(.required, for: .horizontal)
    b.setContentCompressionResistancePriority(.required, for: .horizontal)
    b.heightAnchor.constraint(greaterThanOrEqualToConstant: 40).isActive = true
}
