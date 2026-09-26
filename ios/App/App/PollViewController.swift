import UIKit

/*
 * **투표 상세** — 웹 `screens/PollDetail.tsx`(+ `Polls.tsx`의 `PollOptions` ·
 * `components/Comments.tsx`)를 Swift로 옮긴 것이다(`docs/아이폰-네이티브.md` 2단계).
 *
 * **규칙은 웹과 같다 — 한쪽만 고치지 말 것:**
 *  - 위는 **던지는 곳**(항목 — 이름은 안 적는다), 아래 탭은 **읽는 곳**
 *    (`항목별` · `멤버별` · `미참여 N`). 같은 이름을 두 번 적지 않는다.
 *  - **익명 투표에서는 현황 카드가 통째로 없다** — 안 한 사람을 알려 주면
 *    나머지가 곧 한 사람이 되어 익명이 깨진다.
 *  - 참여 수는 **회원(대기·추방 제외)** 가운데 표를 던진 사람이다 —
 *    `voted.size`로 세면 추방된 사람의 표까지 들어가 `전체`·`미참여`와 안 맞는다.
 *  - `멤버별`은 **항목 순서대로** 적는다 — 표가 들어온 순서로 늘어놓으면
 *    사람마다 차례가 달라진다.
 *  - 끝났는가는 `closed`가 아니라 **`AppPoll.closed`**(마감 시각까지 본다)로
 *    가른다. 다시 열 때 지나간 마감 시각을 함께 지운다(`setPollClosed`).
 *  - 마감 시각 한 줄만 빨강이다(정해 둔 예외) — 상태표·단추에는 안 번진다.
 *  - 끝났는데 결과 카드를 아직 안 남긴 투표면 여기서 `post_poll_result`를
 *    부른다(알림을 눌러 목록을 안 거치고 들어오는 사람이 있다).
 *  - `수정`(`/polls/<id>/edit`)은 만든 사람과 운영진 — 쓰는 화면은 아직 웹이다.
 *
 * 댓글 칸은 공지 상세와 같은 붙박이 바(`keyboardLayoutGuide`)다.
 */
final class PollViewController: NativeScreenController, UITextViewDelegate {
    /// 실시간 — 이 표들이 바뀌면 보이는 동안 다시 받는다(5단계 · `AppLive`).
    override var liveTables: Set<String> { ["polls", "poll_options", "poll_votes", "poll_comments"] }
    private let pollId: String

    private let scroll = UIScrollView()
    private let stack = UIStackView()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let refresh = UIRefreshControl()

    private let composer = UIView()
    private let field = UITextView()
    private let hint = UILabel()
    private let sendBtn = UIButton(type: .system)
    private var fieldH: NSLayoutConstraint?

    private var poll: AppPoll?
    private var comments: [AppComment] = []
    private var people: [String: AppProfile] = [:]
    private var busy = false
    /// 현황 탭 — 0 항목별 · 1 멤버별 · 2 미참여.
    private var statusTab = 0
    private var optionIds: [String] = []

    private var me: AppProfile? { people[service.config.user] }
    private var myId: String { service.config.user }
    private var isAdmin: Bool { AppRole.isAdmin(me?.role ?? "member") }
    private var mayEdit: Bool { isAdmin || poll?.createdBy == myId }

    init(service: NativeChatService, id: String) {
        pollId = id
        super.init(service: service, title: "투표")
    }
    required init?(coder: NSCoder) { fatalError() }

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

        composer.backgroundColor = AppSkin.bg
        composer.translatesAutoresizingMaskIntoConstraints = false
        let rule = UIView()
        rule.backgroundColor = AppSkin.line
        rule.translatesAutoresizingMaskIntoConstraints = false
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
        hint.text = "댓글 남기기"
        hint.font = .systemFont(ofSize: 16)
        hint.textColor = AppSkin.faint
        hint.translatesAutoresizingMaskIntoConstraints = false
        hint.isUserInteractionEnabled = false
        appButton(sendBtn, title: "등록", color: AppSkin.brand, filled: true)
        sendBtn.addTarget(self, action: #selector(sendTapped), for: .touchUpInside)
        field.setContentHuggingPriority(.defaultLow, for: .horizontal)
        field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        composer.addSubview(rule); composer.addSubview(field); composer.addSubview(hint); composer.addSubview(sendBtn)

        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.hidesWhenStopped = true

        body.addSubview(scroll); body.addSubview(composer); body.addSubview(spinner)
        let fh = field.heightAnchor.constraint(equalToConstant: 44)
        fieldH = fh
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: body.topAnchor),
            scroll.leadingAnchor.constraint(equalTo: body.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: body.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: composer.topAnchor),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor),
            composer.leadingAnchor.constraint(equalTo: body.leadingAnchor),
            composer.trailingAnchor.constraint(equalTo: body.trailingAnchor),
            composer.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
            rule.topAnchor.constraint(equalTo: composer.topAnchor),
            rule.leadingAnchor.constraint(equalTo: composer.leadingAnchor),
            rule.trailingAnchor.constraint(equalTo: composer.trailingAnchor),
            rule.heightAnchor.constraint(equalToConstant: 1),
            field.topAnchor.constraint(equalTo: composer.topAnchor, constant: 9),
            field.bottomAnchor.constraint(equalTo: composer.bottomAnchor, constant: -9),
            field.leadingAnchor.constraint(equalTo: composer.leadingAnchor, constant: 16),
            fh,
            hint.leadingAnchor.constraint(equalTo: field.leadingAnchor, constant: 14),
            hint.topAnchor.constraint(equalTo: field.topAnchor, constant: 11),
            sendBtn.leadingAnchor.constraint(equalTo: field.trailingAnchor, constant: 10),
            sendBtn.trailingAnchor.constraint(equalTo: composer.trailingAnchor, constant: -16),
            sendBtn.bottomAnchor.constraint(equalTo: field.bottomAnchor),
            sendBtn.heightAnchor.constraint(equalToConstant: 44),
            spinner.centerXAnchor.constraint(equalTo: body.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: body.centerYAnchor)
        ])
        scroll.isHidden = true
        composer.isHidden = true
    }

    // ── 받아 오기 ────────────────────────────────────────────────

    override func loadScreen() {
        if poll == nil { spinner.startAnimating() }
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            do {
                let p = try await self.service.poll(self.pollId)
                self.comments = try await self.service.pollComments(self.pollId)
                self.people = try await self.service.peopleById()
                self.poll = p
                self.render()
                if let p = p { await self.service.announceClosedPolls([p]) }
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
        guard let p = poll else {
            scroll.isHidden = true; composer.isHidden = true
            flash("없는 투표입니다.", error: true)
            return
        }
        scroll.isHidden = false
        composer.isHidden = false
        rightButton.isHidden = !mayEdit
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        let closed = p.closed
        /* 표를 던져야 할 사람 = 이 앱에 들어와 있는 사람(대기·추방은 뺀다). */
        let members = people.values.filter { $0.role != "pending" && $0.role != "banned" }.sorted { $0.name < $1.name }
        let voted = Set(p.votes.map { $0.userId })
        let done = members.filter { voted.contains($0.id) }
        let yet = members.filter { !voted.contains($0.id) }

        // 머리
        var badges: [UIView] = [BadgeLabel(closed ? "마감" : "진행중", closed ? .done : .live)]
        if p.multi { badges.append(BadgeLabel("복수 선택", .dim)) }
        if p.anonymous { badges.append(BadgeLabel("익명", .dim)) }
        let bl = hrow(badges, fill: true)
        bl.addArrangedSubview(mkLabel(AppDate.ago(p.createdAt), size: 12, color: AppSkin.faint))
        bl.addArrangedSubview(UIView())
        let hero = UIStackView()
        hero.axis = .vertical; hero.spacing = 6
        hero.isLayoutMarginsRelativeArrangement = true
        hero.layoutMargins = UIEdgeInsets(top: 4, left: 2, bottom: 6, right: 2)
        hero.addArrangedSubview(bl)
        hero.addArrangedSubview(mkLabel(p.title, size: 22, weight: .bold, lines: 0))
        if !p.body.isEmpty {
            let l = mkLabel("", size: 14, color: AppSkin.dim, lines: 0)
            let para = NSMutableParagraphStyle(); para.lineSpacing = 6
            l.attributedText = NSAttributedString(string: p.body, attributes: [.font: UIFont.systemFont(ofSize: 14), .foregroundColor: AppSkin.dim, .paragraphStyle: para])
            hero.addArrangedSubview(l)
        }
        stack.addArrangedSubview(hero)

        // 던지는 곳 — 항목마다 막대·✓·표 수. 이름은 안 적는다(아래 탭 몫).
        let voteCard = CardView()
        let mine = Set(p.votes.filter { $0.userId == myId }.map { $0.optionId })
        let voters = voted.count
        optionIds = []
        for o in p.options {
            let n = p.count(o.id)
            let pct = voters > 0 ? CGFloat(n) / CGFloat(voters) : 0
            let v = OptionRow(label: o.label, count: n, pct: pct, chosen: mine.contains(o.id), voters: nil)
            v.tag = optionIds.count
            optionIds.append(o.id)
            v.isEnabled = !closed
            v.alpha = closed ? 0.75 : 1
            v.addTarget(self, action: #selector(optionTapped(_:)), for: .touchUpInside)
            voteCard.content.addArrangedSubview(v)
        }
        let foot = NSMutableAttributedString(string: "\(done.count)명 참여 · 전체 \(members.count)명",
                                             attributes: [.font: UIFont.systemFont(ofSize: 12), .foregroundColor: AppSkin.faint])
        if let c = p.closesAt, !p.closedFlag {
            foot.append(NSAttributedString(string: " · ", attributes: [.font: UIFont.systemFont(ofSize: 12), .foregroundColor: AppSkin.faint]))
            foot.append(NSAttributedString(string: "\(AppDate.dateTime(c)) 마감", attributes: [.font: UIFont.systemFont(ofSize: 12, weight: .semibold), .foregroundColor: AppSkin.danger]))
        }
        let footL = UILabel(); footL.attributedText = foot; footL.numberOfLines = 2
        voteCard.content.addArrangedSubview(footL)
        stack.addArrangedSubview(voteCard)

        // 현황 — 익명이면 통째로 없다
        if !p.anonymous {
            let card = CardView()
            let seg = UISegmentedControl(items: ["항목별", "멤버별", yet.isEmpty ? "미참여" : "미참여 \(yet.count)"])
            seg.selectedSegmentIndex = statusTab
            seg.addTarget(self, action: #selector(tabChanged(_:)), for: .valueChanged)
            card.content.addArrangedSubview(seg)
            switch statusTab {
            case 1:
                if done.isEmpty { card.content.addArrangedSubview(mkLabel("아직 아무도 안 했습니다.", size: 12, color: AppSkin.faint)) }
                for who in done {
                    let picks = p.options.filter { o in p.votes.contains { $0.userId == who.id && $0.optionId == o.id } }.map { $0.label }
                    let row = hrow([faceView(who), mkLabel(who.label, size: 14, weight: .bold)], spacing: 8, fill: true)
                    let pl = mkLabel(picks.joined(separator: ", "), size: 14, color: AppSkin.dim, lines: 0)
                    pl.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
                    row.addArrangedSubview(pl)
                    row.heightAnchor.constraint(greaterThanOrEqualToConstant: 32).isActive = true
                    card.content.addArrangedSubview(row)
                }
            case 2:
                if yet.isEmpty { card.content.addArrangedSubview(mkLabel("모두 표를 던졌습니다.", size: 12, color: AppSkin.faint)) }
                else { card.content.addArrangedSubview(peopleGrid(yet)) }
            default:
                for o in p.options {
                    let on = p.votes.filter { $0.optionId == o.id }.compactMap { people[$0.userId] }
                    let t = NSMutableAttributedString(string: o.label, attributes: [.font: UIFont.systemFont(ofSize: 14, weight: .bold), .foregroundColor: AppSkin.text])
                    t.append(NSAttributedString(string: " · \(on.count)명", attributes: [.font: UIFont.systemFont(ofSize: 14), .foregroundColor: AppSkin.faint]))
                    let hl = UILabel(); hl.attributedText = t; hl.numberOfLines = 0
                    let block = UIStackView(); block.axis = .vertical; block.spacing = 6
                    block.addArrangedSubview(hl)
                    block.addArrangedSubview(on.isEmpty ? mkLabel("고른 사람이 없습니다.", size: 12, color: AppSkin.faint) : peopleGrid(on))
                    card.content.addArrangedSubview(block)
                }
            }
            stack.addArrangedSubview(card)
        }

        // 댓글
        let ccard = CardView()
        ccard.content.addArrangedSubview(mkLabel("댓글 \(comments.count)", size: 14, weight: .bold, color: AppSkin.dim))
        if comments.isEmpty { ccard.content.addArrangedSubview(mkLabel("아직 댓글이 없습니다.", size: 12, color: AppSkin.faint)) }
        let clist = UIStackView(); clist.axis = .vertical; clist.spacing = 0
        for (i, c) in comments.enumerated() {
            let row = CommentRow()
            row.fill(c, who: c.authorId.flatMap { people[$0] }, canDelete: isAdmin || c.authorId == myId, first: i == 0)
            row.onDelete = { [weak self] in self?.deleteComment(c) }
            clist.addArrangedSubview(row)
        }
        ccard.content.addArrangedSubview(clist)
        stack.addArrangedSubview(ccard)

        // 운영 — 만든 사람과 운영진
        if mayEdit {
            let card = CardView()
            card.content.addArrangedSubview(mkLabel(isAdmin ? "운영" : "내가 만든 투표", size: 14, weight: .bold, color: AppSkin.dim))
            let t = UIButton(type: .system)
            appButton(t, title: closed ? "다시 열기" : "마감", color: AppSkin.text, filled: false)
            t.addTarget(self, action: #selector(toggleTapped), for: .touchUpInside)
            let d = UIButton(type: .system)
            appButton(d, title: "지우기", color: AppSkin.danger, filled: true)
            d.addTarget(self, action: #selector(deleteTapped), for: .touchUpInside)
            card.content.addArrangedSubview(hrow([t, d], spacing: 8))
            stack.addArrangedSubview(card)
        }
    }

    private func faceView(_ p: AppProfile) -> AvatarView {
        let f = AvatarView()
        f.backgroundColor = AppSkin.faint
        f.widthAnchor.constraint(equalToConstant: 24).isActive = true
        f.heightAnchor.constraint(equalToConstant: 24).isActive = true
        f.show(url: p.avatar, letter: p.name, edge: p.edge, size: 24)
        return f
    }

    /// 얼굴 + 이름표를 **두 칸씩** 늘어놓는다(웹 `PeopleGrid`) — 서른 명이 되어도 줄로 흘러간다.
    private func peopleGrid(_ list: [AppProfile]) -> UIView {
        let grid = UIStackView(); grid.axis = .vertical; grid.spacing = 4
        for i in stride(from: 0, to: list.count, by: 2) {
            let row = UIStackView(); row.axis = .horizontal; row.spacing = 8; row.distribution = .fillEqually
            for j in i..<min(i + 2, list.count) {
                let p = list[j]
                let cell = hrow([faceView(p), mkLabel(p.label, size: 13)], spacing: 6)
                row.addArrangedSubview(cell)
            }
            if list.count - i == 1 { row.addArrangedSubview(UIView()) }
            grid.addArrangedSubview(row)
        }
        return grid
    }

    // ── 누르는 것들 ─────────────────────────────────────────────

    @objc private func editTapped() { navigate("/polls/\(pollId)/edit") }
    @objc private func tabChanged(_ s: UISegmentedControl) { statusTab = s.selectedSegmentIndex; render() }

    /// 표 던지기 — 고른 것을 다시 누르면 뺀다(웹 `PollOptions.pick`).
    @objc private func optionTapped(_ sender: UIControl) {
        guard let p = poll, !p.closed, !busy, sender.tag < optionIds.count else { return }
        let optionId = optionIds[sender.tag]
        let mine = p.votes.contains { $0.userId == myId && $0.optionId == optionId }
        run {
            if mine { try await self.service.retractVote(optionId) } else { try await self.service.castVote(optionId) }
        }
    }

    @objc private func toggleTapped() {
        guard let p = poll, !busy else { return }
        let shut = p.closed
        run {
            try await self.service.setPollClosed(p, closed: !shut)
            self.flash(shut ? "다시 열었습니다. 대화방에도 알렸습니다." : "마감했습니다.")
        }
    }

    @objc private func deleteTapped() {
        guard let p = poll, !busy else { return }
        var detail = "\(p.title)\n\(p.votes.count)표"
        if !comments.isEmpty { detail += "와 댓글 \(comments.count)개" }
        detail += "가 함께 사라집니다."
        confirm(title: "이 투표를 지울까요?", detail: detail, ok: "지우기", danger: true) { [weak self] ok in
            guard ok, let self = self else { return }
            self.busy = true
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                defer { self.busy = false }
                do {
                    try await self.service.deleteRow("polls", id: p.id)
                    self.flash("지웠습니다.")
                    self.navigate("/polls", replace: true)
                } catch { self.flash(error.localizedDescription, error: true) }
            }
        }
    }

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

    @objc private func sendTapped() {
        let text = (field.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !busy else { return }
        busy = true
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            defer { self.busy = false }
            do {
                try await self.service.addComment(table: "poll_comments", parentKey: "poll_id", parentId: self.pollId, body: text)
                self.field.text = ""
                self.textViewDidChange(self.field)
                self.comments = (try? await self.service.pollComments(self.pollId)) ?? self.comments
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
            self.run { try await self.service.deleteRow("poll_comments", id: c.id) }
        }
    }

    func textViewDidChange(_ textView: UITextView) {
        hint.isHidden = !textView.text.isEmpty || textView.isFirstResponder
        let fit = textView.sizeThatFits(CGSize(width: textView.bounds.width, height: .greatestFiniteMagnitude)).height
        let h = min(140, max(44, fit))
        textView.isScrollEnabled = fit > 140
        if fieldH?.constant != h { fieldH?.constant = h; view.layoutIfNeeded() }
    }
    func textViewDidBeginEditing(_ textView: UITextView) { hint.isHidden = true }
    func textViewDidEndEditing(_ textView: UITextView) { hint.isHidden = !textView.text.isEmpty }
}
