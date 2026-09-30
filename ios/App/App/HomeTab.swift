import UIKit

/*
 * **홈 — '내가 뭘 해야 하나'에 답한다**(웹 `Home.tsx`). 위에서부터 급한 순서로
 * 쌓고 해당 없는 칸은 통째로 사라진다:
 *   1 다음 라운드 — 주인공. 언제·어디·날씨·내 조·자리·**내 상태**.
 *   2 내가 할 일 — 안 한 투표 · 미정산금액 · (운영진) 승인 대기 · 안 읽은 대화.
 *   3 모집중 — 다음 것 말고 열려 있는 라운드.
 * 머리말은 왼쪽이 얼굴 + 인사말, 오른쪽이 🔔(안 읽은 알림 수).
 *
 * 규칙은 웹과 같다 — 대기 번호는 대기 줄에서의 차례 · 이름은 닉네임 그대로 ·
 * 스크린에는 날씨 줄이 없다. **날씨는 좌표가 있는 라운드만** — 이름으로 찾는
 * 예비 길(`courses.ts`)은 앱에 없다.
 */
final class HomeTabController: ShellTabController {
    private enum Row {
        case next(AppRound), empty, section(String)
        case poll(AppPoll), pending(Int), chat(Int), unpaid(Int, Int, String?)
        case other(AppRound)
    }
    private var rows: [Row] = []
    private var tees: [String: String] = [:]
    private var weather: AppWeather?
    private var weatherFor = ""
    private let greet = UILabel()
    private let face = AvatarView()
    private let nameLabel = UILabel()
    private let bell = UIButton(type: .system)
    private let bellDot = NativeScreenController.PillLabel()

    init(service: NativeChatService) { super.init(service: service, title: "") }
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        titleLabel.isHidden = true
        table.register(NextRoundCell.self, forCellReuseIdentifier: "n")
        table.register(EmptyNextCell.self, forCellReuseIdentifier: "e")
        table.register(SectionCell.self, forCellReuseIdentifier: "s")
        table.register(HomeRowCell.self, forCellReuseIdentifier: "h")

        /* 머리말 — `안녕하세요` 위 · 얼굴 + `이름님` · 오른쪽 🔔. 얼굴만 눌린다(→ 내 정보). */
        for c in header.constraints where c.firstAttribute == .height { c.constant = 76 }
        greet.text = "안녕하세요"
        greet.font = .systemFont(ofSize: 13)
        greet.textColor = AppSkin.faint
        greet.translatesAutoresizingMaskIntoConstraints = false
        face.translatesAutoresizingMaskIntoConstraints = false
        face.backgroundColor = AppSkin.faint
        face.isUserInteractionEnabled = true
        face.hitOutset = 8          // 그림은 36 그대로, 누르는 자리만 52로(가장자리를 눌러도 먹게)
        face.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(faceTapped)))
        nameLabel.font = .systemFont(ofSize: 22, weight: .bold)
        nameLabel.textColor = AppSkin.text
        nameLabel.translatesAutoresizingMaskIntoConstraints = false
        bell.setImage(UIImage(systemName: "bell"), for: .normal)
        bell.tintColor = AppSkin.dim
        bell.translatesAutoresizingMaskIntoConstraints = false
        bell.accessibilityLabel = "알림"
        bell.addTarget(self, action: #selector(bellTapped), for: .touchUpInside)
        bellDot.pad = UIEdgeInsets(top: 1, left: 5, bottom: 1, right: 5)
        bellDot.font = .systemFont(ofSize: 10, weight: .heavy)
        bellDot.textColor = .white
        bellDot.backgroundColor = AppSkin.danger
        bellDot.layer.cornerRadius = 8
        bellDot.layer.masksToBounds = true
        bellDot.translatesAutoresizingMaskIntoConstraints = false
        bellDot.isHidden = true
        header.addSubview(greet); header.addSubview(face); header.addSubview(nameLabel); header.addSubview(bell); header.addSubview(bellDot)
        NSLayoutConstraint.activate([
            greet.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 16),
            greet.topAnchor.constraint(equalTo: header.topAnchor, constant: 8),
            face.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 16),
            face.topAnchor.constraint(equalTo: greet.bottomAnchor, constant: 6),
            face.widthAnchor.constraint(equalToConstant: 36), face.heightAnchor.constraint(equalToConstant: 36),
            nameLabel.leadingAnchor.constraint(equalTo: face.trailingAnchor, constant: 10),
            nameLabel.centerYAnchor.constraint(equalTo: face.centerYAnchor),
            nameLabel.trailingAnchor.constraint(lessThanOrEqualTo: bell.leadingAnchor, constant: -8),
            bell.trailingAnchor.constraint(equalTo: header.trailingAnchor, constant: -8),
            bell.centerYAnchor.constraint(equalTo: face.centerYAnchor),
            bell.widthAnchor.constraint(equalToConstant: 44), bell.heightAnchor.constraint(equalToConstant: 44),
            bellDot.leadingAnchor.constraint(equalTo: bell.centerXAnchor, constant: 2),
            bellDot.topAnchor.constraint(equalTo: bell.topAnchor, constant: 4),
            bellDot.heightAnchor.constraint(equalToConstant: 16)
        ])
    }

    override var liveTables: Set<String> {
        ["rounds", "signups", "polls", "poll_votes", "profiles", "round_groups", "messages", "notifications",
         "settlements", "settlement_shares"]
    }

    /**
     * **대화·알림만 바뀌었으면 숫자만 고친다**(웹 `Home.tsx`의 `reloadUnread`·`reloadAlerts`).
     * 대화는 하루 백 마디라 그때마다 라운드·투표까지 다시 받으면 헛조회다.
     * `내가 할 일`의 대화 줄이 새로 생기거나 사라질 때만 통째로 다시 받는다.
     */
    override func liveReload(_ tables: Set<String>) {
        guard tables.isSubset(of: ["messages", "notifications"]) else { load(); return }
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            if tables.contains("notifications") {
                let alerts = await self.service.unreadAlertCount()
                self.bellDot.text = alerts > 99 ? "99+" : String(alerts)
                self.bellDot.isHidden = alerts == 0
            }
            guard tables.contains("messages") else { return }
            let chat = await self.service.unreadChatCount()
            let at = self.rows.firstIndex { if case .chat = $0 { return true }; return false }
            if let i = at, chat > 0 {
                self.rows[i] = .chat(chat)
                self.table.reloadRows(at: [IndexPath(row: i, section: 0)], with: .none)
            } else if at != nil || chat > 0 {
                self.load()
            }
        }
    }

    @objc private func faceTapped() { go("/me") }
    @objc private func bellTapped() { go("/alerts") }

    /// 명단이 아직 없을 때만 받는다(껍데기가 먼저 받아 두었으면 건너뛴다).
    private func peopleIfNeeded() async {
        if shell?.me == nil { await shell?.refreshPeople() }
    }
    /// 가입 대기 수 — 운영진에게만 묻는다.
    private func pendingIfAdmin() async -> Int {
        guard shell?.isAdmin ?? false else { return 0 }
        return await service.pendingCount()
    }

    override func load() {
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            /* **한꺼번에 묻는다**(첫 화면 가리개 — 사용자 요청). 예전에는 여덟 조회를
               하나씩 기다려, 왕복이 150ms면 그것만 1초가 넘었다. 서로 기대지 않는
               것은 다 함께 보내고, 조 시각·날씨만 다음 라운드를 알고 나서 둘이 함께 간다. */
            async let people: Void = self.peopleIfNeeded()
            async let roundsQ = self.service.roundsUpcoming()
            async let pollsQ = self.service.pollsLive()
            async let votedQ = self.service.myVotedPolls()
            async let chatQ = self.service.unreadChatCount()
            async let alertsQ = self.service.unreadAlertCount()
            async let unpaidQ = self.service.myUnpaidShares()
            _ = await people
            let me = self.shell?.me
            self.face.show(url: me?.avatar, letter: me?.name ?? "", edge: me?.edge, size: 36)
            self.nameLabel.text = "\(me?.name ?? "회원")님"
            async let pendingQ = self.pendingIfAdmin()
            do {
                let rounds = try await roundsQ.filter { $0.status != "cancelled" }
                let rawPolls = try await pollsQ
                let live = rawPolls.filter { !$0.closed }
                /* 홈이 함께 부르는 것이 핵심이다 — 투표 탭을 아무도 안 여는 날 결과가 하루 종일 안 남는다(웹과 같다).
                   **화면이 기다릴 일은 아니라** 뒤에서 돌린다(대화방에 결과 카드를 남길 뿐이다). */
                let service = self.service
                Task { @MainActor in await service.announceClosedPolls(rawPolls) }
                let voted = await votedQ
                let pending = await pendingQ
                let chat = await chatQ
                let alerts = await alertsQ
                let unpaid = await unpaidQ
                self.bellDot.text = alerts > 99 ? "99+" : String(alerts)
                self.bellDot.isHidden = alerts == 0

                let upcoming = rounds.filter { !$0.isPast }
                var r: [Row] = []
                if let next = upcoming.first {
                    r.append(.next(next))
                    /* 조별 시각과 날씨는 뒤따라 붙는다 — 없어도 카드는 먼저 선다. */
                    let wKey = next.id + AppDate.kstDay(NativeChatRows.date(next.teeAt))
                    async let teesQ = self.service.groupTees(next.id)
                    if !next.isScreen, let lat = next.lat, let lon = next.lon {
                        if self.weatherFor != wKey {
                            self.weather = await self.service.weather(lat: lat, lon: lon, teeAt: next.teeAt)
                            self.weatherFor = wKey
                        }
                    } else { self.weather = nil; self.weatherFor = "" }
                    self.tees = await teesQ
                } else {
                    r.append(.empty)
                }
                let todoPolls = live.filter { !voted.contains($0.id) }
                if !todoPolls.isEmpty || !unpaid.isEmpty || pending > 0 || chat > 0 {
                    r.append(.section("내가 할 일"))
                    r += todoPolls.map { .poll($0) }
                    /* 아직 안 낸 내 몫(사용자 요청 — `미정산금액 1건`). 누르면 **가장 오래된 것의
                       라운드**로 가서 그 자리에서 `입금완료 알림 보내기`를 누른다. 다 내면 사라진다. */
                    if !unpaid.isEmpty {
                        r.append(.unpaid(unpaid.count, unpaid.reduce(0) { $0 + $1.amount },
                                         unpaid.first { $0.roundId != nil }?.roundId))
                    }
                    if pending > 0 { r.append(.pending(pending)) }
                    if chat > 0 { r.append(.chat(chat)) }
                }
                let others = Array(upcoming.dropFirst())
                if !others.isEmpty {
                    r.append(.section("모집중"))
                    r += others.map { .other($0) }
                }
                self.rows = r
                self.table.reloadData()
                self.shell?.refreshBadges(rounds: upcoming.count, polls: live.count)
            } catch {
                self.flash(error.localizedDescription, error: true)
            }
            self.finished()
        }
    }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { rows.count }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let me = service.config.user
        switch rows[indexPath.row] {
        case .next(let r):
            let c = tableView.dequeueReusableCell(withIdentifier: "n", for: indexPath) as! NextRoundCell
            c.fill(r, me: me, people: shell?.people ?? [:], tees: tees, weather: weather)
            return c
        case .empty:
            return tableView.dequeueReusableCell(withIdentifier: "e", for: indexPath)
        case .section(let t):
            let c = tableView.dequeueReusableCell(withIdentifier: "s", for: indexPath) as! SectionCell
            c.l.text = t; return c
        case .poll(let p):
            let c = tableView.dequeueReusableCell(withIdentifier: "h", for: indexPath) as! HomeRowCell
            c.fill(badge: BadgeLabel("투표", .brand), text: p.title, trailing: nil); return c
        case .pending(let n):
            let c = tableView.dequeueReusableCell(withIdentifier: "h", for: indexPath) as! HomeRowCell
            c.fill(badge: BadgeLabel("승인", .warn), text: "가입 신청 \(n)명", trailing: nil); return c
        case .unpaid(let n, let won, _):
            let c = tableView.dequeueReusableCell(withIdentifier: "h", for: indexPath) as! HomeRowCell
            c.fill(badge: BadgeLabel("정산", .warn), text: "미정산금액 \(n)건 · \(AppDate.won(won))", trailing: nil); return c
        case .chat(let n):
            let c = tableView.dequeueReusableCell(withIdentifier: "h", for: indexPath) as! HomeRowCell
            c.fill(badge: BadgeLabel("대화", .danger), text: "안 읽은 메시지 \(n)개", trailing: nil); return c
        case .other(let r):
            let c = tableView.dequeueReusableCell(withIdentifier: "h", for: indexPath) as! HomeRowCell
            let confirmed = r.confirmed.count
            let left = Swift.max(0, r.capacity - confirmed)
            let trailing: BadgeLabel = r.mine(me) != nil ? BadgeLabel("신청함", .dim)
                : left > 0 ? BadgeLabel("\(left)자리", .brand) : BadgeLabel("자리 참", .dim)
            /* 요일까지 적는다(사용자 요청 — `9월 30일 (수) 오후 4:10`). */
            let when = AppDate.dateTime(r.teeAt)
            c.fill(badge: nil, text: "\(r.kindIcon) \(when) \(r.place)", trailing: trailing)
            return c
        }
    }
    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        switch rows[indexPath.row] {
        case .next(let r), .other(let r): go("/rounds/\(r.id)")
        case .empty: go("/rounds/new")
        case .poll(let p): go("/polls/\(p.id)")
        case .pending: go("/members")
        case .unpaid(_, _, let roundId):
            if let id = roundId {
                RoundViewController.focusSettle = id
                go("/rounds/\(id)")
            } else { go("/settle") }
        case .chat: go("/chat")
        case .section: break
        }
    }
}

/// 다음 라운드 카드(웹 `.next`) — 잔디 그라디언트 위에 흰 글자. **이 카드에만** 쓴다.
final class NextRoundCell: UITableViewCell {
    private let card = UIView()
    private let gradient = CAGradientLayer()
    private let stack = UIStackView()

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        backgroundColor = .clear; contentView.backgroundColor = .clear; selectionStyle = .none
        card.translatesAutoresizingMaskIntoConstraints = false
        card.layer.cornerRadius = 22
        card.layer.cornerCurve = .continuous
        card.layer.masksToBounds = true
        card.layer.borderWidth = 1
        card.layer.borderColor = (UIColor(hexString: "#5b8d18") ?? AppSkin.grass).cgColor
        gradient.colors = [UIColor(hexString: "#8fc93a")!.cgColor, UIColor(hexString: "#6faa22")!.cgColor, UIColor(hexString: "#5b8d18")!.cgColor]
        gradient.locations = [0, 0.55, 1]
        gradient.startPoint = CGPoint(x: 0.1, y: 0); gradient.endPoint = CGPoint(x: 0.9, y: 1)
        card.layer.insertSublayer(gradient, at: 0)
        stack.axis = .vertical
        stack.spacing = 11
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.isLayoutMarginsRelativeArrangement = true
        stack.layoutMargins = UIEdgeInsets(top: 15, left: 15, bottom: 15, right: 15)
        card.addSubview(stack)
        contentView.addSubview(card)
        NSLayoutConstraint.activate([
            card.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 4),
            card.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -6),
            card.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            card.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
            stack.topAnchor.constraint(equalTo: card.topAnchor), stack.bottomAnchor.constraint(equalTo: card.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor), stack.trailingAnchor.constraint(equalTo: card.trailingAnchor)
        ])
    }
    required init?(coder: NSCoder) { fatalError() }
    override func layoutSubviews() { super.layoutSubviews(); gradient.frame = card.bounds }

    private func white(_ text: String, _ size: CGFloat, _ weight: UIFont.Weight, alpha: CGFloat = 1, lines: Int = 1) -> UILabel {
        mkLabel(text, size: size, weight: weight, color: UIColor(white: 1, alpha: alpha), lines: lines)
    }

    func fill(_ r: AppRound, me: String, people: [String: AppProfile], tees: [String: String], weather: AppWeather?) {
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        let top = hrow([white(r.isScreen ? "다음 스크린" : "다음 라운드", 12, .heavy, alpha: 0.85)])
        top.addArrangedSubview(white(AppDate.dday(r.teeAt), 12, .heavy))
        stack.addArrangedSubview(top)

        let when = white(AppDate.dateTime(r.teeAt), 22, .bold)
        let whereL = white(r.placeLine, 16, .semibold, alpha: 0.95, lines: 0)
        let col = UIStackView(arrangedSubviews: [when, whereL]); col.axis = .vertical; col.spacing = 2
        stack.addArrangedSubview(col)

        let my = r.mine(me)
        /* **내 조는 여기서 끝나야 한다** — 조 번호 · 그 조의 시각 · 같은 조 사람(닉네임). */
        if let my = my, let grp = my.grp {
            var text = "\(grp)조"
            /* 팀별 코스를 적어 두었으면 그 조의 코스도 적는다(사용자 요청 — `2조 · 펠리스 코스 · 티오프 오전 7:07`). */
            let gc = r.groupCourse(grp)
            if !gc.isEmpty { text += " · \(gc) 코스" }
            if let t = tees[String(grp)] { text += " · \(r.teeLabel) \(AppDate.time(t))" }
            let mates = r.confirmed.filter { $0.grp == grp && $0.userId != me }.compactMap { people[$0.userId]?.name }
            if !mates.isEmpty { text += " · " + mates.joined(separator: ", ") }
            stack.addArrangedSubview(white(text, 14, .semibold))
        }
        if !r.isScreen, let w = weather {
            var text = "\(w.icon) \(w.min)° / \(w.max)°  \(w.label)"
            if w.rain > 0 { text += " · 비 \(w.rain)%" }
            stack.addArrangedSubview(white(text, 14, .semibold, alpha: 0.95))
        }

        /* 얼굴 다섯 + `3 / 4명 · 1자리 남음`. */
        let confirmed = r.confirmed
        let faces = UIStackView(); faces.axis = .horizontal; faces.spacing = -6
        for s in confirmed.prefix(5) {
            let p = people[s.userId]
            let a = AvatarView()
            a.backgroundColor = UIColor(white: 1, alpha: 0.35)
            a.translatesAutoresizingMaskIntoConstraints = false
            a.widthAnchor.constraint(equalToConstant: 26).isActive = true
            a.heightAnchor.constraint(equalToConstant: 26).isActive = true
            a.show(url: p?.avatar, letter: p?.name ?? "", edge: nil, size: 26)
            faces.addArrangedSubview(a)
        }
        let left = Swift.max(0, r.capacity - confirmed.count)
        let who = hrow(confirmed.isEmpty ? [] : [faces], spacing: 8)
        /* 자리가 다 찼으면 대기 인원도 적는다 — 라운드 탭 카드의 `4/4명 · 대기 1`과 같은 값이다
           (사용자 요청 — `홈에도 대기 1 붙여줘`). 정원을 늘릴지 가늠하는 숫자라 홈에서도 보여야 한다. */
        let waitN = r.waiting.count
        var seat = "\(confirmed.count) / \(r.capacity)명" + (left > 0 ? " · \(left)자리 남음" : " · 자리 참")
        if waitN > 0 { seat += " · 대기 \(waitN)" }
        who.insertArrangedSubview(white(seat, 13, .semibold, alpha: 0.95), at: confirmed.isEmpty ? 0 : 1)
        stack.addArrangedSubview(who)

        /* 내 상태가 곧 단추 자리다 — 잔디 위의 분홍(`신청하기`) · 흰 반투명(`신청 완료`) · 흰 바탕 보라(`대기 N번`). */
        let state = NativeScreenController.PillLabel()
        state.textAlignment = .center
        state.font = .systemFont(ofSize: 16, weight: .heavy)
        state.layer.cornerRadius = AppSkin.radiusSm
        state.layer.masksToBounds = true
        if let my = my {
            if my.state == "waitlist" {
                state.text = "대기 \(r.waitRank(me))번"
                state.backgroundColor = UIColor(white: 1, alpha: 0.9)
                state.textColor = UIColor(hexString: "#7a55d6") ?? AppSkin.info
            } else {
                state.text = "신청 완료"
                state.backgroundColor = UIColor(white: 1, alpha: 0.22)
                state.textColor = .white
            }
        } else if r.status != "open" {
            /* 손으로 마감한 모집은 대기 신청도 안 받는다(`join_round`가 `open`만 받는다) —
               `대기 신청`이라고 세워 두면 눌러 들어가서야 막힌 줄 안다. 상세의 `신청 마감`과 같은 말이다. */
            state.text = "신청 마감"
            state.backgroundColor = UIColor(white: 1, alpha: 0.22)
            state.textColor = .white
        } else {
            state.text = left > 0 ? "신청하기" : "대기 신청"
            state.backgroundColor = AppSkin.brand
            state.textColor = .white
        }
        stack.addArrangedSubview(state)
    }
}

/// 예정된 라운드가 없을 때 — 빈칸 대신 초대장(`+ 모집 열기`).
final class EmptyNextCell: CardCell {
    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        card.content.alignment = .center
        card.content.layoutMargins = UIEdgeInsets(top: 22, left: 14, bottom: 22, right: 14)
        card.content.addArrangedSubview(mkLabel("열린 라운드가 없습니다", size: 16, weight: .bold))
        card.content.addArrangedSubview(mkLabel("먼저 모집을 열어 보세요", size: 13, color: AppSkin.faint))
        card.content.addArrangedSubview(BadgeLabel("+ 모집 열기", .brand))
    }
    required init?(coder: NSCoder) { fatalError() }
}

/// 한 줄 카드(웹 `.home-row`) — 표 · 글 · 오른쪽 표/`›`.
final class HomeRowCell: CardCell {
    func fill(badge: UIView?, text: String, trailing: UIView?) {
        card.clear()
        card.content.layoutMargins = UIEdgeInsets(top: 11, left: 13, bottom: 11, right: 13)
        var items: [UIView] = []
        if let b = badge { items.append(b) }
        items.append(mkLabel(text, size: 15, weight: .bold))
        let row = hrow(items, spacing: 10)
        row.addArrangedSubview(trailing ?? mkLabel("›", size: 17, color: AppSkin.faint))
        card.content.addArrangedSubview(row)
    }
}
