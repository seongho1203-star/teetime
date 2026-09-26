import UIKit

/*
 * **정산 현황** — 웹 `screens/Settle.tsx`를 Swift로 옮긴 것이다
 * (`docs/아이폰-네이티브.md` 3단계). 주소는 `/settle`, 문은 `내 정보`에 있다.
 *
 * **규칙은 웹과 같다 — 한쪽만 고치지 말 것:**
 *  - 최근 `RECENT`(30)건만 받고, 몫은 딸려 받는다(안 쓰는 칸은 안 받는다).
 *  - **기본은 `내가 올린 것`이다.** `전체`는 총무·운영진에게, 남이 올린 것이
 *    실제로 있을 때만 나온다.
 *  - 맨 위는 **안 걷힌 금액 하나**(먹색 — 경고가 아니다). 다 걷힌 정산은
 *    목록에서 빼고 개수만 센다. **안 낸 사람만** 세우고, 누르면 입금완료다.
 *  - `입금 알림 보내기`는 `settle_reminders`에 한 줄만 넣는다 — 누구에게 갈지는
 *    발송기가 고른다. 남의 정산이면 그 사람 계좌로 들어간다고 한 번 더 알린다.
 *  - `settle_reminders`가 없는 저장소에서는 `마지막 알림` 줄만 안 나온다.
 */
final class SettleViewController: NativeScreenController {
    /// 실시간 — 이 표들이 바뀌면 보이는 동안 다시 받는다(5단계 · `AppLive`).
    override var liveTables: Set<String> { ["settlements", "settlement_shares"] }
    private static let recent = 30

    private let scroll = UIScrollView()
    private let stack = UIStackView()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let refresh = UIRefreshControl()

    private var role = "member"
    private var list: [(s: AppSettlement, shares: [AppShare])] = []
    private var names: [String: AppProfile] = [:]
    private var lastSent: [String: String] = [:]
    private var place: [String: String] = [:]
    private var mineOnly = true
    private var busy: Set<String> = []

    private var mayAll: Bool { role == "treasurer" || AppRole.isAdmin(role) }   // 웹 `canSettle`

    init(service: NativeChatService) {
        super.init(service: service, title: "정산 현황")
    }
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.alwaysBounceVertical = true
        scroll.refreshControl = refresh
        refresh.addTarget(self, action: #selector(pulled), for: .valueChanged)
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

    @objc private func pulled() { loadScreen() }

    override func loadScreen() {
        if list.isEmpty && stack.arrangedSubviews.isEmpty { spinner.startAnimating() }
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            do { try await self.fetch() }
            catch {
                self.spinner.stopAnimating(); self.refresh.endRefreshing()
                self.stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
                self.stack.addArrangedSubview(mkLabel(error.localizedDescription, size: 15, weight: .semibold, color: AppSkin.danger, lines: 0))
                return
            }
            self.spinner.stopAnimating(); self.refresh.endRefreshing()
            self.render()
        }
    }

    private func fetch() async throws {
        async let rows = service.rows("settlements", [
            ("select", "id,round_id,title,total,created_by,created_at,settlement_shares(id,settlement_id,user_id,amount,paid)"),
            ("order", "created_at.desc"), ("limit", String(Self.recent))])
        async let people = service.peopleById()
        async let myRole = service.myRole()
        let raw = try await rows
        names = (try? await people) ?? [:]
        role = await myRole
        list = raw.map { r in (s: AppSettlement(raw: r), shares: (r["settlement_shares"] as? [ChatJSON] ?? []).map { AppShare(raw: $0) }) }
        guard !list.isEmpty else { lastSent = [:]; place = [:]; return }
        let ids = list.map { $0.s.id }.joined(separator: ",")
        let roundIds = Array(Set(list.compactMap { $0.s.raw["round_id"] as? String })).joined(separator: ",")
        async let sent = maybe("settle_reminders", [("select", "settlement_id,created_at"),
                                                    ("settlement_id", "in.(\(ids))"), ("order", "created_at.desc")])
        async let rounds = maybe("rounds", [("select", "id,course,title"), ("id", "in.(\(roundIds))")])
        /* 내림차순이라 **처음 본 것이 가장 최근**이다. 표가 없는 저장소에서는 빈 것이다. */
        var last: [String: String] = [:]
        for x in await sent {
            if let k = x["settlement_id"] as? String, last[k] == nil { last[k] = x["created_at"] as? String }
        }
        lastSent = last
        var name: [String: String] = [:]
        for r in await rounds {
            let r = AppRound(raw: r)
            name[r.id] = !r.course.isEmpty ? r.course : (!r.title.isEmpty ? r.title : "라운드")
        }
        var where_: [String: String] = [:]
        for x in list { where_[x.s.id] = name[x.s.raw["round_id"] as? String ?? ""] ?? "" }
        place = where_
    }

    /// 못 받으면 빈 것으로 — 표가 없는 저장소에서 이 화면이 통째로 죽으면 안 된다.
    private func maybe(_ table: String, _ q: [(String, String)]) async -> [ChatJSON] {
        (try? await service.rows(table, q)) ?? []
    }

    private func render() {
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        let me = service.config.user
        let mine = list.filter { $0.s.createdBy == me }
        /* `전체`는 쓸 수 있고, 남이 올린 것이 실제로 있을 때만. */
        let canToggle = mayAll && list.count > mine.count
        let shown = canToggle && !mineOnly ? list : mine
        let open = shown.filter { $0.shares.contains { !$0.paid } }
        let done = shown.count - open.count

        if canToggle {
            let seg = UISegmentedControl(items: ["내가 올린 것", "전체"])
            seg.selectedSegmentIndex = mineOnly ? 0 : 1
            seg.addTarget(self, action: #selector(tabChanged(_:)), for: .valueChanged)
            stack.addArrangedSubview(seg)
        }

        /* **맨 위는 숫자 하나다** — 먼저 알고 싶은 것은 "얼마가 안 걷혔나"다. */
        let sum = CardView()
        if open.isEmpty {
            sum.content.addArrangedSubview(mkLabel("다 걷혔습니다 👏", size: 17, weight: .bold, color: AppSkin.dim))
        } else {
            let unpaid = open.flatMap { $0.shares.filter { !$0.paid } }
            let owed = unpaid.reduce(0) { $0 + $1.amount }
            let who = Set(unpaid.map(\.userId)).count
            sum.content.addArrangedSubview(mkLabel(AppDate.won(owed), size: 26, weight: .heavy))
            sum.content.addArrangedSubview(mkLabel("아직 안 걷힘 · \(who)명 · 정산 \(open.count)건", size: 13, color: AppSkin.dim))
        }
        stack.addArrangedSubview(sum)

        for x in open { stack.addArrangedSubview(card(x.s, x.shares, by: x.s.createdBy == me ? nil : x.s.createdBy)) }

        if done > 0 {
            let l = mkLabel("다 걷힌 정산 \(done)건은 여기 안 나옵니다.", size: 12, color: AppSkin.faint, lines: 0)
            l.textAlignment = .center
            stack.addArrangedSubview(l)
        }
        if shown.isEmpty {
            let l = mkLabel(canToggle ? "내가 올린 정산이 없습니다.\n남이 올린 것은 위의 전체에서 봅니다."
                                      : "아직 만든 정산이 없습니다.\n라운드에 들어가 ＋ 정산을 눌러 주세요.",
                            size: 14, color: AppSkin.faint, lines: 0)
            l.textAlignment = .center
            stack.addArrangedSubview(l)
        }
    }

    @objc private func tabChanged(_ s: UISegmentedControl) { mineOnly = s.selectedSegmentIndex == 0; render() }

    private func card(_ s: AppSettlement, _ shares: [AppShare], by: String?) -> UIView {
        let c = CardView()
        c.content.spacing = 8
        let unpaid = shares.filter { !$0.paid }
        let paid = shares.count - unpaid.count

        /* **제목 줄이 라운드로 가는 문이다** — 한 낱말만 링크면 손가락에 안 잡힌다. */
        let link = UIButton(type: .system)
        link.contentHorizontalAlignment = .leading
        let t = NSMutableAttributedString(string: s.title, attributes: [.font: UIFont.systemFont(ofSize: 16, weight: .bold), .foregroundColor: AppSkin.text])
        t.append(NSAttributedString(string: "  ›", attributes: [.font: UIFont.systemFont(ofSize: 16, weight: .bold), .foregroundColor: AppSkin.faint]))
        link.setAttributedTitle(t, for: .normal)
        link.titleLabel?.lineBreakMode = .byTruncatingMiddle
        link.heightAnchor.constraint(greaterThanOrEqualToConstant: 36).isActive = true
        let rid = s.raw["round_id"] as? String ?? ""
        link.addAction(UIAction { [weak self] _ in if !rid.isEmpty { self?.navigate("/rounds/\(rid)") } }, for: .touchUpInside)
        c.content.addArrangedSubview(link)

        let w = place[s.id] ?? ""
        let meta = NSMutableAttributedString(string: (w.isEmpty ? "" : "\(w) · ") + "총 \(AppDate.won(s.total)) · \(paid)/\(shares.count)명 보냄",
                                             attributes: [.font: UIFont.systemFont(ofSize: 13), .foregroundColor: AppSkin.dim])
        meta.append(NSAttributedString(string: " · \(AppDate.ago(s.createdAt))", attributes: [.font: UIFont.systemFont(ofSize: 12), .foregroundColor: AppSkin.faint]))
        let ml = UILabel(); ml.attributedText = meta; ml.numberOfLines = 0
        c.content.addArrangedSubview(ml)

        /* **남이 올린 것이면 누구 것인지 적는다** — 돈이 그 사람 계좌로 들어간다. */
        if let by = by {
            let p = names[by]
            let face = face(p, size: 24)
            let row = UIStackView(arrangedSubviews: [face, mkLabel("\(p?.name ?? "알 수 없음")님이 올림", size: 13, weight: .semibold, color: AppSkin.warn)])
            row.axis = .horizontal; row.alignment = .center; row.spacing = 6
            c.content.addArrangedSubview(row)
        }

        /* **안 낸 사람만 세운다. 누를 수 있다고 미리 적어 둔다.** */
        let head = NSMutableAttributedString(string: "안 내신 \(unpaid.count)명", attributes: [.font: UIFont.systemFont(ofSize: 14, weight: .bold), .foregroundColor: AppSkin.text])
        head.append(NSAttributedString(string: " · 눌러서 입금완료", attributes: [.font: UIFont.systemFont(ofSize: 12), .foregroundColor: AppSkin.faint]))
        let hl = UILabel(); hl.attributedText = head
        c.content.addArrangedSubview(hl)
        for x in unpaid { c.content.addArrangedSubview(chip(x)) }

        let when = mkLabel(lastSent[s.id].map { "마지막 알림 \(AppDate.ago($0))" } ?? "아직 안 보냈습니다", size: 12, color: AppSkin.faint)
        let remindBtn = UIButton(type: .system)
        let sending = busy.contains(s.id)
        appButton(remindBtn, title: sending ? "보내는 중…" : "입금 알림 보내기", color: AppSkin.text, filled: false)
        remindBtn.isEnabled = !sending
        remindBtn.addAction(UIAction { [weak self] _ in self?.remind(s, unpaid: unpaid.count, by: by) }, for: .touchUpInside)
        let foot = UIStackView(arrangedSubviews: [when, UIView(), remindBtn])
        foot.axis = .horizontal; foot.alignment = .center; foot.spacing = 8
        c.content.addArrangedSubview(foot)
        return c
    }

    private func face(_ p: AppProfile?, size: CGFloat) -> UIView {
        let v = AvatarView()
        v.translatesAutoresizingMaskIntoConstraints = false
        v.widthAnchor.constraint(equalToConstant: size).isActive = true
        v.heightAnchor.constraint(equalToConstant: size).isActive = true
        v.show(url: p?.avatar, letter: p?.name ?? "", edge: p?.edge, size: size)
        return v
    }

    /// 안 낸 사람 한 줄 — 누르면 입금완료(현금으로 받았을 때). 되돌릴 수 있으니 안 묻는다.
    private func chip(_ x: AppShare) -> UIView {
        let p = names[x.userId]
        let b = UIControl()
        b.backgroundColor = AppSkin.surface2
        b.layer.cornerRadius = AppSkin.radiusSm
        let label = (p?.label).flatMap { $0.isEmpty ? nil : $0 } ?? "알 수 없음"
        let name = mkLabel(label, size: 14, weight: .semibold)
        name.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let won = mkLabel(AppDate.won(x.amount), size: 14, weight: .bold)
        won.setContentHuggingPriority(.required, for: .horizontal)
        let tick = mkLabel("✓", size: 14, weight: .heavy, color: AppSkin.faint)
        tick.setContentHuggingPriority(.required, for: .horizontal)
        let row = UIStackView(arrangedSubviews: [face(p, size: 26), name, UIView(), won, tick])
        row.axis = .horizontal; row.alignment = .center; row.spacing = 8
        row.isUserInteractionEnabled = false
        row.translatesAutoresizingMaskIntoConstraints = false
        b.addSubview(row)
        NSLayoutConstraint.activate([
            row.topAnchor.constraint(equalTo: b.topAnchor, constant: 7),
            row.bottomAnchor.constraint(equalTo: b.bottomAnchor, constant: -7),
            row.leadingAnchor.constraint(equalTo: b.leadingAnchor, constant: 10),
            row.trailingAnchor.constraint(equalTo: b.trailingAnchor, constant: -12),
            b.heightAnchor.constraint(greaterThanOrEqualToConstant: 42)
        ])
        b.isAccessibilityElement = true
        b.accessibilityLabel = "\(p?.name ?? "알 수 없음") 입금완료로 바꾸기"
        b.accessibilityTraits = .button
        b.addAction(UIAction { [weak self] _ in self?.markPaid(x, name: p?.name) }, for: .touchUpInside)
        return b
    }

    private func markPaid(_ x: AppShare, name: String?) {
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            do {
                try await self.service.setSharePaid(x.id, true)
                self.flash("\(name ?? "이 분") 입금완료로 바꿨습니다.")
                self.loadScreen()
            } catch { self.flash(error.localizedDescription, error: true) }
        }
    }

    /* **한 줄 넣으면 발송기가 안 낸 사람만 골라 보낸다.** */
    private func remind(_ s: AppSettlement, unpaid: Int, by: String?) {
        var detail = "아직 안 내신 \(unpaid)명에게만 갑니다.\n이미 보내신 분에게는 가지 않습니다."
        if let by = by {
            detail += "\n\n\(names[by]?.name ?? "다른 분")님이 올린 정산입니다.\n돈은 그분 계좌로 들어갑니다."
        }
        confirm(title: "입금 알림을 보낼까요?", detail: detail, ok: "보내기", danger: false) { [weak self] ok in
            guard ok, let self = self else { return }
            self.busy.insert(s.id); self.render()
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                do {
                    _ = try await self.service.insertRows("settle_reminders", [["settlement_id": s.id]])
                    self.busy.remove(s.id)
                    self.flash("\(unpaid)명에게 보냈습니다.")
                    self.loadScreen()
                } catch {
                    self.busy.remove(s.id); self.render()
                    self.flash(error.localizedDescription, error: true)
                }
            }
        }
    }
}
