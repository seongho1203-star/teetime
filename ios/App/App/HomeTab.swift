import UIKit

/*
 * **홈 — '내가 뭘 해야 하나'에 답한다**(웹 `Home.tsx`). 위에서부터 급한 순서로
 * 쌓고 해당 없는 칸은 통째로 사라진다:
 *   1 다음 라운드 — 주인공. 언제·어디·날씨·내 조·자리·**내 상태**.
 *   2 내가 할 일 — 안 한 투표 · (운영진) 승인 대기 · 안 읽은 대화.
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
        case poll(AppPoll), pending(Int), chat(Int)
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

    @objc private func faceTapped() { go("/me") }
    @objc private func bellTapped() { go("/alerts") }

    override func load() {
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            if self.shell?.me == nil { await self.shell?.refreshPeople() }
            let me = self.shell?.me
            self.face.show(url: me?.avatar, letter: me?.name ?? "", edge: me?.edge, size: 36)
            self.nameLabel.text = "\(me?.name ?? "회원")님"
            do {
                let rounds = try await self.service.roundsUpcoming().filter { $0.status != "cancelled" }
                let live = try await self.service.pollsLive().filter { !$0.closed }
                let voted = await self.service.myVotedPolls()
                let pending = (self.shell?.isAdmin ?? false) ? await self.service.pendingCount() : 0
                let chat = await self.service.unreadChatCount()
                let alerts = await self.service.unreadAlertCount()
                self.bellDot.text = alerts > 99 ? "99+" : String(alerts)
                self.bellDot.isHidden = alerts == 0

                let upcoming = rounds.filter { AppDate.daysUntil($0.teeAt) >= 0 }
                var r: [Row] = []
                if let next = upcoming.first {
                    r.append(.next(next))
                    /* 조별 시각과 날씨는 뒤따라 붙는다 — 없어도 카드는 먼저 선다. */
                    self.tees = await self.service.groupTees(next.id)
                    if !next.isScreen, let lat = next.lat, let lon = next.lon {
                        if self.weatherFor != next.id + AppDate.kstDay(NativeChatRows.date(next.teeAt)) {
                            self.weather = await self.service.weather(lat: lat, lon: lon, teeAt: next.teeAt)
                            self.weatherFor = next.id + AppDate.kstDay(NativeChatRows.date(next.teeAt))
                        }
                    } else { self.weather = nil; self.weatherFor = "" }
                } else {
                    r.append(.empty)
                }
                let todoPolls = live.filter { !voted.contains($0.id) }
                if !todoPolls.isEmpty || pending > 0 || chat > 0 {
                    r.append(.section("내가 할 일"))
                    r += todoPolls.map { .poll($0) }
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
        case .chat(let n):
            let c = tableView.dequeueReusableCell(withIdentifier: "h", for: indexPath) as! HomeRowCell
            c.fill(badge: BadgeLabel("대화", .danger), text: "안 읽은 메시지 \(n)개", trailing: nil); return c
        case .other(let r):
            let c = tableView.dequeueReusableCell(withIdentifier: "h", for: indexPath) as! HomeRowCell
            let confirmed = r.confirmed.count
            let left = Swift.max(0, r.capacity - confirmed)
            let trailing: BadgeLabel = r.mine(me) != nil ? BadgeLabel("신청함", .dim)
                : left > 0 ? BadgeLabel("\(left)자리", .brand) : BadgeLabel("자리 참", .dim)
            let when = AppDate.dateTime(r.teeAt).replacingOccurrences(of: #" \(.\)"#, with: "", options: .regularExpression)
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
        let whereL = white(r.place, 16, .semibold, alpha: 0.95)
        let col = UIStackView(arrangedSubviews: [when, whereL]); col.axis = .vertical; col.spacing = 2
        stack.addArrangedSubview(col)

        let my = r.mine(me)
        /* **내 조는 여기서 끝나야 한다** — 조 번호 · 그 조의 시각 · 같은 조 사람(닉네임). */
        if let my = my, let grp = my.grp {
            var text = "\(grp)조"
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
        who.insertArrangedSubview(white("\(confirmed.count) / \(r.capacity)명" + (left > 0 ? " · \(left)자리 남음" : " · 자리 참"), 13, .semibold, alpha: 0.95), at: confirmed.isEmpty ? 0 : 1)
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
