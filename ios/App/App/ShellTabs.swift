import UIKit

/*
 * **탭 셋 — 공지 · 라운드 · 투표 목록**(웹 `Board.tsx`·`Rounds.tsx`·`Polls.tsx`).
 * 홈은 `HomeTab.swift`에 있다. 규칙은 웹과 같다 — 한쪽만 고치지 말 것.
 */

// ── 공지 ─────────────────────────────────────────────────────

final class BoardTabController: ShellTabController {
    override var liveTables: Set<String> { ["posts"] }
    private var posts: [AppPost] = []

    init(service: NativeChatService) {
        super.init(service: service, title: "공지")
        rightButton.setTitle("+ 글쓰기", for: .normal)
    }
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        table.register(PostCell.self, forCellReuseIdentifier: "p")
    }

    override func load() {
        /* 글쓰기는 운영진만(웹과 같다). */
        rightButton.isHidden = !(shell?.isAdmin ?? false)
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            do {
                self.posts = try await self.service.posts()
                self.emptyLabel.text = "아직 공지가 없습니다.\n중요한 것만 여기 남기세요. 대화는 대화 탭에서 합니다."
                self.emptyLabel.isHidden = !self.posts.isEmpty
                self.table.reloadData()
                /* 목록을 열었으면 공지는 다 본 것으로 친다(웹 `markSeen('board')`). */
                self.shell?.markBoardSeen()
            } catch {
                self.flash(error.localizedDescription, error: true)
            }
            self.finished()
        }
    }

    override func rightTapped() { go("/board/new") }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { posts.count }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "p", for: indexPath) as! PostCell
        let p = posts[indexPath.row]
        cell.fill(p, author: p.authorId.flatMap { shell?.people[$0] }?.label ?? "")
        return cell
    }
    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        go("/board/\(posts[indexPath.row].id)")
    }
}

/// 공지 한 줄 — `고정` 표 + 제목 · 본문 두 줄 · 글쓴이 · 시각(웹 `.post-row`).
final class PostCell: CardCell {
    func fill(_ p: AppPost, author: String) {
        card.clear()
        var head: [UIView] = []
        if p.pinned { head.append(BadgeLabel("고정", .warn)) }
        let t = mkLabel(p.title, size: 16, weight: .bold)
        head.append(t)
        card.content.addArrangedSubview(hrow(head))
        let body = p.body.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces)
        if !body.isEmpty { card.content.addArrangedSubview(mkLabel(body, size: 14, color: AppSkin.dim, lines: 2)) }
        card.content.addArrangedSubview(mkLabel("\(author.isEmpty ? "알 수 없음" : author) · \(AppDate.ago(p.createdAt))", size: 12, color: AppSkin.faint))
    }
}

// ── 라운드 ────────────────────────────────────────────────────

final class RoundsTabController: ShellTabController {
    override var liveTables: Set<String> { ["rounds", "signups"] }
    static let pastRounds = 10
    static let moreRounds = 20

    private enum Row { case section(String), round(AppRound, past: Bool), more }
    private var rows: [Row] = []
    private var all: [AppRound] = []
    private var pastMax = RoundsTabController.pastRounds
    private var pastGot = 0
    /// 종류 가리개 — 둘이 섞여 있을 때만 나온다. 0 전체 · 1 필드 · 2 스크린.
    private let filter = UISegmentedControl(items: ["전체", "⛳ 필드", "🎯 스크린"])
    private let filterWrap = UIView()

    init(service: NativeChatService) {
        super.init(service: service, title: "라운드")
        rightButton.setTitle("+ 모집 열기", for: .normal)
        rightButton.isHidden = false
    }
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        table.register(RoundCell.self, forCellReuseIdentifier: "r")
        table.register(SectionCell.self, forCellReuseIdentifier: "s")
        table.register(ButtonCell.self, forCellReuseIdentifier: "b")
        filter.selectedSegmentIndex = 0
        filter.addTarget(self, action: #selector(filterChanged), for: .valueChanged)
        filter.translatesAutoresizingMaskIntoConstraints = false
        filterWrap.addSubview(filter)
        NSLayoutConstraint.activate([
            filter.leadingAnchor.constraint(equalTo: filterWrap.leadingAnchor, constant: 16),
            filter.trailingAnchor.constraint(equalTo: filterWrap.trailingAnchor, constant: -16),
            filter.topAnchor.constraint(equalTo: filterWrap.topAnchor, constant: 4),
            filter.bottomAnchor.constraint(equalTo: filterWrap.bottomAnchor, constant: -8)
        ])
    }

    override func load() {
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            do {
                let next = try await self.service.roundsUpcoming()
                let past = try await self.service.roundsPast(limit: self.pastMax)
                self.pastGot = past.count
                self.all = next + past
                self.rebuild()
                /* 탭 위의 숫자 — 예정된 것(취소 아님). 진행중 투표 수는 투표 탭이 준다. */
                let open = next.filter { AppDate.daysUntil($0.teeAt) >= 0 && $0.status != "cancelled" }.count
                self.shell?.refreshBadges(rounds: open)
            } catch {
                self.flash(error.localizedDescription, error: true)
            }
            self.finished()
        }
    }

    @objc private func filterChanged() { rebuild() }

    private func rebuild() {
        let mixed = all.contains { $0.isScreen } && all.contains { !$0.isScreen }
        if mixed {
            filterWrap.frame = CGRect(x: 0, y: 0, width: table.bounds.width, height: 44)
            table.tableHeaderView = filterWrap
        } else {
            filter.selectedSegmentIndex = 0
            table.tableHeaderView = nil
        }
        let only = filter.selectedSegmentIndex
        let list = all.filter { only == 0 || (only == 1 && !$0.isScreen) || (only == 2 && $0.isScreen) }
        /* 오늘(한국 날짜) 이후는 '예정', 그 전은 '지난'. 지난 것은 최근 순으로. */
        let upcoming = list.filter { AppDate.daysUntil($0.teeAt) >= 0 && $0.status != "cancelled" }
        let past = list.filter { AppDate.daysUntil($0.teeAt) < 0 || $0.status == "cancelled" }
            .sorted { $0.teeAt > $1.teeAt }
        var r: [Row] = upcoming.map { .round($0, past: false) }
        if !past.isEmpty {
            r.append(.section("지난 라운드"))
            r += past.map { .round($0, past: true) }
        }
        if pastGot >= pastMax { r.append(.more) }
        rows = r
        emptyLabel.text = only == 0 ? "예정된 라운드가 없습니다.\n위의 모집 열기로 새 라운드를 올려 보세요." : "예정된 \(only == 1 ? "필드" : "스크린") 라운드가 없습니다."
        emptyLabel.isHidden = !(upcoming.isEmpty && past.isEmpty)
        table.reloadData()
    }

    override func rightTapped() { go("/rounds/new") }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { rows.count }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        switch rows[indexPath.row] {
        case .section(let t):
            let c = tableView.dequeueReusableCell(withIdentifier: "s", for: indexPath) as! SectionCell
            c.l.text = t; return c
        case .round(let r, let past):
            let c = tableView.dequeueReusableCell(withIdentifier: "r", for: indexPath) as! RoundCell
            c.fill(r, me: service.config.user, past: past); return c
        case .more:
            let c = tableView.dequeueReusableCell(withIdentifier: "b", for: indexPath) as! ButtonCell
            c.button.setTitle("지난 라운드 더 보기", for: .normal)
            c.onTap = { [weak self] in
                guard let self = self else { return }
                self.pastMax += Self.moreRounds
                self.load()
            }
            return c
        }
    }
    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        if case .round(let r, _) = rows[indexPath.row] { go("/rounds/\(r.id)") }
    }
}

/// 라운드 카드(웹 `RoundCard`) — 표 줄 · 장소 · 시각/조건 · 자리 막대.
final class RoundCell: CardCell {
    func fill(_ r: AppRound, me: String, past: Bool) {
        card.clear()
        card.alpha = past ? 0.72 : 1
        let confirmed = r.confirmed.count, waiting = r.waiting.count
        let full = confirmed >= r.capacity
        var head: [UIView] = [BadgeLabel("\(r.kindIcon) \(r.kindLabel)", r.isScreen ? .screen : .field)]
        /* **맨 앞은 늘 '지금 어떤 상태인가'다** — 잔디=열림 · 회색=끝남 · 빨강=취소.
           자리가 다 차도 `모집 마감`으로 적는다. */
        if r.status == "cancelled" { head.append(BadgeLabel("취소됨", .danger)) }
        else if past { head.append(BadgeLabel("종료", .done)) }
        else if r.status == "closed" || full { head.append(BadgeLabel("모집 마감", .done)) }
        else { head.append(BadgeLabel("모집중", .live)) }
        if !past && r.status != "cancelled" {
            head.append(BadgeLabel(AppDate.dday(r.teeAt), AppDate.daysUntil(r.teeAt) <= 3 ? .warn : .dim))
        }
        let row = hrow(head)
        if let my = r.mine(me) {
            row.addArrangedSubview(BadgeLabel(my.state == "confirmed" ? "참가 확정" : "대기중", my.state == "confirmed" ? .dim : .wait))
        }
        card.content.addArrangedSubview(row)
        card.content.addArrangedSubview(mkLabel("\(r.kindIcon) \(r.place)", size: 16, weight: .bold))
        var sub = AppDate.dateTime(r.teeAt)
        if let c = r.caddie, let l = AppRound.caddieLabel[c] { sub += " · \(l)" }
        if let c = r.cart, let l = AppRound.cartLabel[c] { sub += " · \(l)" }
        card.content.addArrangedSubview(mkLabel(sub, size: 14, color: AppSkin.dim))

        /* 자리 막대 + `3/4명 · 대기 1` · 요금. */
        let bar = UIView()
        bar.backgroundColor = AppSkin.surface2
        bar.layer.cornerRadius = 3
        bar.layer.masksToBounds = true
        bar.translatesAutoresizingMaskIntoConstraints = false
        let fillV = UIView()
        fillV.backgroundColor = full ? AppSkin.faint : AppSkin.grass
        fillV.translatesAutoresizingMaskIntoConstraints = false
        bar.addSubview(fillV)
        let ratio = r.capacity > 0 ? min(1, CGFloat(confirmed) / CGFloat(r.capacity)) : 0
        NSLayoutConstraint.activate([
            bar.widthAnchor.constraint(equalToConstant: 72), bar.heightAnchor.constraint(equalToConstant: 6),
            fillV.leadingAnchor.constraint(equalTo: bar.leadingAnchor), fillV.topAnchor.constraint(equalTo: bar.topAnchor),
            fillV.bottomAnchor.constraint(equalTo: bar.bottomAnchor),
            fillV.widthAnchor.constraint(equalTo: bar.widthAnchor, multiplier: ratio)
        ])
        let count = NSMutableAttributedString(string: "\(confirmed)/\(r.capacity)명",
            attributes: [.font: UIFont.systemFont(ofSize: 14, weight: .bold), .foregroundColor: full ? AppSkin.faint : AppSkin.text])
        if waiting > 0 {
            count.append(NSAttributedString(string: " · 대기 \(waiting)",
                attributes: [.font: UIFont.systemFont(ofSize: 14, weight: .bold), .foregroundColor: UIColor(hexString: "#7a55d6") ?? AppSkin.info]))
        }
        let countL = UILabel(); countL.attributedText = count
        let foot = hrow([bar, countL], spacing: 8)
        if r.fee > 0 { foot.addArrangedSubview(mkLabel(AppDate.won(r.fee), size: 12, color: AppSkin.faint)) }
        card.content.addArrangedSubview(foot)
    }
}

// ── 투표 ─────────────────────────────────────────────────────

final class PollsTabController: ShellTabController {
    override var liveTables: Set<String> { ["polls", "poll_options", "poll_votes"] }
    static let donePolls = 10
    static let morePolls = 20
    static let optionsShown = 5

    private enum Row { case section(String), poll(AppPoll), more }
    private var rows: [Row] = []
    private var live: [AppPoll] = []
    private var done: [AppPoll] = []
    private var doneMax = PollsTabController.donePolls
    private var doneGot = 0
    /// `항목 N개 더 보기`로 편 투표.
    private var expanded = Set<String>()
    private var busy = false

    init(service: NativeChatService) {
        super.init(service: service, title: "투표")
        rightButton.setTitle("+ 투표 만들기", for: .normal)
        rightButton.isHidden = false
    }
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        table.register(PollCell.self, forCellReuseIdentifier: "p")
        table.register(SectionCell.self, forCellReuseIdentifier: "s")
        table.register(ButtonCell.self, forCellReuseIdentifier: "b")
    }

    override func load() {
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            do {
                let raw = try await self.service.pollsLive()
                self.live = raw.filter { !$0.closed }
                let d = try await self.service.pollsDone(limit: self.doneMax)
                self.done = d.list
                self.doneGot = d.got
                /* 시각이 지나 끝난 투표는 아무 사건도 안 일으킨다 — 여기서 결과 카드를 남겨 준다(웹과 같다). */
                await self.service.announceClosedPolls(raw + d.list)
                self.rebuild()
                self.shell?.refreshBadges(polls: self.live.count)
            } catch {
                self.flash(error.localizedDescription, error: true)
            }
            self.finished()
        }
    }

    private func rebuild() {
        var r: [Row] = live.map { .poll($0) }
        if !done.isEmpty {
            r.append(.section("마감된 투표"))
            r += done.map { .poll($0) }
        }
        if doneGot >= doneMax { r.append(.more) }
        rows = r
        emptyLabel.text = "아직 투표가 없습니다.\n날짜 정하기, 골프장 고르기 같은 걸 올려 보세요."
        emptyLabel.isHidden = !(live.isEmpty && done.isEmpty)
        table.reloadData()
    }

    override func rightTapped() { go("/polls/new") }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { rows.count }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        switch rows[indexPath.row] {
        case .section(let t):
            let c = tableView.dequeueReusableCell(withIdentifier: "s", for: indexPath) as! SectionCell
            c.l.text = t; return c
        case .poll(let p):
            let c = tableView.dequeueReusableCell(withIdentifier: "p", for: indexPath) as! PollCell
            let me = service.config.user
            let admin = shell?.isAdmin ?? false
            c.fill(p, me: me, people: shell?.people ?? [:], canManage: admin || p.createdBy == me,
                   expanded: expanded.contains(p.id), max: Self.optionsShown)
            c.onOpen = { [weak self] in self?.go("/polls/\(p.id)") }
            c.onMore = { [weak self] in self?.expanded.insert(p.id); self?.table.reloadData() }
            c.onPick = { [weak self] optionId in self?.pick(p, optionId) }
            c.onClose = { [weak self] in self?.closePoll(p) }
            c.onDelete = { [weak self] in self?.deletePoll(p) }
            return c
        case .more:
            let c = tableView.dequeueReusableCell(withIdentifier: "b", for: indexPath) as! ButtonCell
            c.button.setTitle("지난 투표 더 보기", for: .normal)
            c.onTap = { [weak self] in
                guard let self = self else { return }
                self.doneMax += Self.morePolls
                self.load()
            }
            return c
        }
    }

    /// 표 던지기 — 고른 것을 다시 누르면 뺀다(웹 `PollOptions.pick`).
    private func pick(_ p: AppPoll, _ optionId: String) {
        guard !p.closed, !busy else { return }
        busy = true
        let mine = p.votes.contains { $0.userId == service.config.user && $0.optionId == optionId }
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            defer { self.busy = false }
            do {
                if mine { try await self.service.retractVote(optionId) } else { try await self.service.castVote(optionId) }
                self.load()
            } catch {
                self.flash(error.localizedDescription, error: true)
            }
        }
    }
    private func closePoll(_ p: AppPoll) {
        guard !busy else { return }
        busy = true
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            defer { self.busy = false }
            do { try await self.service.closePoll(p.id); self.load() }
            catch { self.flash(error.localizedDescription, error: true) }
        }
    }
    private func deletePoll(_ p: AppPoll) {
        confirm(title: "이 투표를 지울까요?", detail: "\(p.title)\n\(p.votes.count)표가 함께 사라집니다.",
                ok: "지우기", danger: true) { [weak self] ok in
            guard ok, let self = self, !self.busy else { return }
            self.busy = true
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                defer { self.busy = false }
                do { try await self.service.deleteRow("polls", id: p.id); self.flash("지웠습니다."); self.load() }
                catch { self.flash(error.localizedDescription, error: true) }
            }
        }
    }
}

/// 투표 카드(웹 `PollCard` + `PollOptions`).
final class PollCell: CardCell {
    var onOpen: (() -> Void)?
    var onMore: (() -> Void)?
    var onPick: ((String) -> Void)?
    var onClose: (() -> Void)?
    var onDelete: (() -> Void)?
    private var optionIds: [String] = []

    func fill(_ p: AppPoll, me: String, people: [String: AppProfile], canManage: Bool, expanded: Bool, max: Int) {
        card.clear()
        let closed = p.closed
        card.alpha = closed ? 0.8 : 1
        var head: [UIView] = [BadgeLabel(closed ? "마감" : "진행중", closed ? .done : .live)]
        if p.multi { head.append(BadgeLabel("복수 선택", .dim)) }
        if p.anonymous { head.append(BadgeLabel("익명", .dim)) }
        let headRow = hrow(head)
        headRow.addArrangedSubview(mkLabel(AppDate.ago(p.createdAt), size: 12, color: AppSkin.faint))
        card.content.addArrangedSubview(headRow)

        /* 제목을 누르면 상세로(웹 `.poll-title-link`). */
        let titleBtn = UIButton(type: .system)
        titleBtn.contentHorizontalAlignment = .left
        let t = NSMutableAttributedString(string: p.title + "  ", attributes: [.font: UIFont.systemFont(ofSize: 17, weight: .bold), .foregroundColor: AppSkin.text])
        t.append(NSAttributedString(string: "›", attributes: [.font: UIFont.systemFont(ofSize: 17), .foregroundColor: AppSkin.faint]))
        titleBtn.setAttributedTitle(t, for: .normal)
        titleBtn.titleLabel?.numberOfLines = 0
        titleBtn.addTarget(self, action: #selector(openTapped), for: .touchUpInside)
        card.content.addArrangedSubview(titleBtn)
        if !p.body.isEmpty { card.content.addArrangedSubview(mkLabel(p.body, size: 14, color: AppSkin.dim, lines: 0)) }

        optionIds = []
        if closed {
            /* **마감된 투표는 항목을 아예 안 편다** — 1위 한 줄로. 동점이면 다 적는다. */
            if let won = p.top() {
                let row = hrow([BadgeLabel(won.names.count > 1 ? "공동 1위" : "1위", .live), mkLabel(won.names.joined(separator: ", "), size: 15, weight: .semibold)], spacing: 8)
                row.addArrangedSubview(mkLabel("\(won.n)표", size: 12, color: AppSkin.faint))
                card.content.addArrangedSubview(row)
            } else {
                card.content.addArrangedSubview(mkLabel("아무도 투표하지 않았습니다", size: 14, color: AppSkin.faint))
            }
        } else {
            let mine = Set(p.votes.filter { $0.userId == me }.map { $0.optionId })
            let voters = Set(p.votes.map { $0.userId }).count
            /* 내가 고른 것이 접힌 자리에 있으면 아예 펴 둔다. */
            let hidPick = p.options.dropFirst(max).contains { mine.contains($0.id) }
            let open = expanded || hidPick
            let shown = open ? p.options : Array(p.options.prefix(max))
            /* **누가 골랐나 줄은 표가 없어도 비워 둔 채 선다**(사용자 제보 — 고르기 전과 뒤의
               항목 크기가 달랐다). 첫 표가 들어오는 순간 줄이 생겨 목록이 통째로 커졌다.
               익명이면 처음부터 없다. */
            let showVoters = !p.anonymous
            for o in shown {
                let on = p.votes.filter { $0.optionId == o.id }
                let pct = voters > 0 ? CGFloat(on.count) / CGFloat(voters) : 0
                let chosen = mine.contains(o.id)
                let who = on.map { people[$0.userId]?.label ?? "?" }
                let v = OptionRow(label: o.label, count: on.count, pct: pct, chosen: chosen,
                                  voters: showVoters ? Self.votersLine(who) : nil)
                v.tag = optionIds.count
                optionIds.append(o.id)
                v.addTarget(self, action: #selector(optionTapped(_:)), for: .touchUpInside)
                card.content.addArrangedSubview(v)
            }
            let rest = p.options.count - shown.count
            if rest > 0 {
                let b = UIButton(type: .system)
                b.setTitle("항목 \(rest)개 더 보기", for: .normal)
                b.titleLabel?.font = .systemFont(ofSize: 13, weight: .semibold)
                b.setTitleColor(AppSkin.dim, for: .normal)
                b.addTarget(self, action: #selector(moreTapped), for: .touchUpInside)
                card.content.addArrangedSubview(b)
            }
        }

        /* 발 — `N명 참여 · 마감 시각`(빨강 · 정해 둔 예외) · 만든 사람/운영진의 마감·지우기. */
        let members = Set(people.values.filter { $0.role != "pending" && $0.role != "banned" }.map { $0.id })
        let voters = Set(p.votes.map { $0.userId }.filter { members.contains($0) }).count
        let foot = NSMutableAttributedString(string: "\(voters)명 참여", attributes: [.font: UIFont.systemFont(ofSize: 12), .foregroundColor: AppSkin.faint])
        if let c = p.closesAt, !p.closedFlag {
            foot.append(NSAttributedString(string: " · ", attributes: [.font: UIFont.systemFont(ofSize: 12), .foregroundColor: AppSkin.faint]))
            foot.append(NSAttributedString(string: "\(AppDate.dateTime(c)) 마감", attributes: [.font: UIFont.systemFont(ofSize: 12, weight: .semibold), .foregroundColor: AppSkin.danger]))
        }
        let footL = UILabel(); footL.attributedText = foot; footL.numberOfLines = 2
        let footRow = hrow([footL], spacing: 8)
        if canManage {
            if !closed {
                let b = smallButton("마감"); b.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
                footRow.addArrangedSubview(b)
            }
            let d = smallButton("지우기"); d.addTarget(self, action: #selector(deleteTapped), for: .touchUpInside)
            footRow.addArrangedSubview(d)
        }
        card.content.addArrangedSubview(footRow)
    }

    private func smallButton(_ title: String) -> UIButton {
        let b = UIButton(type: .system)
        b.setTitle(title, for: .normal)
        b.titleLabel?.font = .systemFont(ofSize: 13, weight: .semibold)
        b.setTitleColor(AppSkin.text, for: .normal)
        b.layer.cornerRadius = 15
        b.layer.borderWidth = 1
        b.layer.borderColor = AppSkin.line.cgColor
        b.contentEdgeInsets = UIEdgeInsets(top: 6, left: 12, bottom: 6, right: 12)
        b.setContentHuggingPriority(.required, for: .horizontal)
        return b
    }

    /// `이관교, 김지명, 박승수 외 12명` — 셋까지 적고 나머지는 센다(웹 `votersLine`).
    static func votersLine(_ list: [String]) -> String {
        list.count <= 3 ? list.joined(separator: ", ") : list.prefix(3).joined(separator: ", ") + " 외 \(list.count - 3)명"
    }

    @objc private func openTapped() { onOpen?() }
    @objc private func moreTapped() { onMore?() }
    @objc private func closeTapped() { onClose?() }
    @objc private func deleteTapped() { onDelete?() }
    @objc private func optionTapped(_ sender: UIControl) {
        guard sender.tag < optionIds.count else { return }
        onPick?(optionIds[sender.tag])
    }
}

/// 항목 한 줄(웹 `.poll-option`) — 막대가 배경으로 깔리고 ✓ · 이름 · 표 수 · 누가 골랐나.
final class OptionRow: UIControl {
    init(label: String, count: Int, pct: CGFloat, chosen: Bool, voters: String?) {
        super.init(frame: .zero)
        backgroundColor = AppSkin.surface2
        layer.cornerRadius = AppSkin.radiusSm
        layer.masksToBounds = true
        if chosen { layer.borderWidth = 1.5; layer.borderColor = AppSkin.brand.cgColor }
        let bar = UIView()
        bar.backgroundColor = AppSkin.grass.withAlphaComponent(0.22)
        bar.translatesAutoresizingMaskIntoConstraints = false
        bar.isUserInteractionEnabled = false
        addSubview(bar)
        let check = mkLabel(chosen ? "✓" : "", size: 14, weight: .heavy, color: AppSkin.brand)
        check.widthAnchor.constraint(equalToConstant: 16).isActive = true
        let name = mkLabel(label, size: 15, weight: chosen ? .bold : .regular)
        let n = mkLabel(String(count), size: 14, weight: .bold, color: AppSkin.dim)
        n.setContentHuggingPriority(.required, for: .horizontal)
        let top = hrow([check, name], spacing: 6)
        top.addArrangedSubview(n)
        let col = UIStackView(arrangedSubviews: [top])
        col.axis = .vertical
        col.spacing = 2
        col.isUserInteractionEnabled = false
        if let v = voters {
            col.addArrangedSubview(mkLabel(v.isEmpty ? " " : v, size: 12, color: AppSkin.faint))
        }
        col.translatesAutoresizingMaskIntoConstraints = false
        addSubview(col)
        NSLayoutConstraint.activate([
            bar.leadingAnchor.constraint(equalTo: leadingAnchor), bar.topAnchor.constraint(equalTo: topAnchor),
            bar.bottomAnchor.constraint(equalTo: bottomAnchor), bar.widthAnchor.constraint(equalTo: widthAnchor, multiplier: pct),
            col.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 10),
            col.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -10),
            col.topAnchor.constraint(equalTo: topAnchor, constant: 9),
            col.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -9),
            heightAnchor.constraint(greaterThanOrEqualToConstant: 40)
        ])
    }
    required init?(coder: NSCoder) { fatalError() }
    override var isHighlighted: Bool { didSet { alpha = isHighlighted ? 0.7 : 1 } }
}
