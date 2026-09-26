import UIKit

/*
 * **알림함(🔔)** — 웹의 `screens/Alerts.tsx`를 Swift로 옮긴 것이다
 * (`docs/아이폰-네이티브.md` 2단계). 폰으로 왔던 알림을 되짚는 자리 —
 * 배너를 놓쳤을 때 볼 데가 없던 문제를 푼다.
 *
 * **규칙은 웹과 같다 — 한쪽만 고치지 말 것:**
 *  - **여는 순간 다 읽음으로 찍는다**(`markAlertsRead`) — 줄마다 눌러 읽게
 *    하면 아이콘의 뱃지를 지울 길이 없어진다.
 *  - 그래서 **무엇이 안 읽은 것이었는지는 `read_at`이 아니라 화면이 얼려
 *    둔 `fresh`가 정한다.** 담기는 길이 둘이다 — 받아 온 줄 중 `read_at`이
 *    빈 것, 그리고 `markAlertsRead`가 돌려준 id. **id마다 한 번만 판단한다**
 *    (`judged`) — 다시 받아 올 때마다 보면 읽음으로 바뀐 줄이 뒤집힌다.
 *  - 안 읽은 줄은 **흰 카드 + 왼쪽 빨간 띠 + `N` 표**, 읽은 줄은 `surface2`
 *    바탕에 흐린 제목. 빨강인 것은 이 앱에서 빨강이 '내가 안 본 것'이기
 *    때문이다(**분홍을 쓰지 말 것**).
 *  - 제목 앞 그림글자를 아이콘 자리로 옮긴다(`AppAlert.split`) — 안 옮기면
 *    같은 그림이 두 번 나온다.
 *  - 90일 지난 것은 이 화면을 연 사람이 지운다(`purgeAlerts`).
 *  - 줄을 누르면 **그 건으로** 간다(`url`의 `#`을 떼어 웹에 넘긴다). 갈 곳이
 *    없는 줄(지워진 라운드)은 눌리지 않는다.
 *  - **앱으로 돌아오면 다시 받는다**(`didBecomeActive` — 웹 `useRefreshOnShow`).
 *    실시간은 5단계에서 붙인다.
 */
final class AlertsViewController: NativeScreenController, UITableViewDataSource, UITableViewDelegate {
    /// 실시간 — 이 표들이 바뀌면 보이는 동안 다시 받는다(5단계 · `AppLive`).
    override var liveTables: Set<String> { ["notifications"] }
    private let table = UITableView(frame: .zero, style: .plain)
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let refresh = UIRefreshControl()
    private let empty = UILabel()
    private let footer = UILabel()

    private var list: [AppAlert] = []
    private var fresh = Set<String>()
    private var judged = Set<String>()
    private var loadedList = false

    init(service: NativeChatService) { super.init(service: service, title: "알림") }
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        table.translatesAutoresizingMaskIntoConstraints = false
        table.dataSource = self; table.delegate = self
        table.backgroundColor = AppSkin.bg
        table.separatorStyle = .none
        table.register(AlertCell.self, forCellReuseIdentifier: "a")
        table.rowHeight = UITableView.automaticDimension
        table.estimatedRowHeight = 88
        table.contentInset = UIEdgeInsets(top: 4, left: 0, bottom: 24, right: 0)
        refresh.addTarget(self, action: #selector(pulled), for: .valueChanged)
        table.refreshControl = refresh

        /* 오래된 것이 저절로 사라지는 것을 한 줄로 알려 준다 — 안 적으면
           지난달 알림이 없어진 것을 고장으로 본다. */
        footer.text = "90일이 지난 알림은 저절로 지워집니다"
        footer.font = .systemFont(ofSize: 12)
        footer.textColor = AppSkin.faint
        footer.textAlignment = .center
        footer.frame = CGRect(x: 0, y: 0, width: 0, height: 44)
        table.tableFooterView = footer
        footer.isHidden = true

        empty.text = "아직 온 알림이 없습니다\n모집·정산·조 편성 소식이 여기 쌓입니다.\n대화는 대화 탭에서 보세요."
        empty.font = .systemFont(ofSize: 14)
        empty.textColor = AppSkin.dim
        empty.textAlignment = .center
        empty.numberOfLines = 0
        empty.translatesAutoresizingMaskIntoConstraints = false
        empty.isHidden = true

        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.hidesWhenStopped = true

        body.addSubview(table); body.addSubview(empty); body.addSubview(spinner)
        NSLayoutConstraint.activate([
            table.topAnchor.constraint(equalTo: body.topAnchor),
            table.leadingAnchor.constraint(equalTo: body.leadingAnchor),
            table.trailingAnchor.constraint(equalTo: body.trailingAnchor),
            table.bottomAnchor.constraint(equalTo: body.bottomAnchor),
            empty.centerXAnchor.constraint(equalTo: body.centerXAnchor),
            empty.centerYAnchor.constraint(equalTo: body.centerYAnchor, constant: -40),
            empty.widthAnchor.constraint(lessThanOrEqualTo: body.widthAnchor, constant: -48),
            spinner.centerXAnchor.constraint(equalTo: body.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: body.centerYAnchor)
        ])
        NotificationCenter.default.addObserver(self, selector: #selector(becameActive),
                                               name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    // ── 받아 오기 ────────────────────────────────────────────────

    override func loadScreen() {
        if !loadedList { spinner.startAnimating() }
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            /* 읽음을 먼저 찍고 — 그 답이 곧 '열기 전까지 안 읽은 것' — 청소하고 받는다. */
            for id in await self.service.markAlertsRead() { self.fresh.insert(id) }
            if !self.loadedList { await self.service.purgeAlerts() }
            self.list = await self.service.alerts()
            for a in self.list where !self.judged.contains(a.id) {
                self.judged.insert(a.id)
                if a.readAt == nil { self.fresh.insert(a.id) }
            }
            self.loadedList = true
            self.spinner.stopAnimating()
            self.refresh.endRefreshing()
            self.empty.isHidden = !self.list.isEmpty
            self.footer.isHidden = self.list.isEmpty
            self.table.reloadData()
        }
    }

    @objc private func pulled() { loadScreen() }
    @objc private func becameActive() { if loadedList { loadScreen() } }

    // ── 표 ───────────────────────────────────────────────────────

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { list.count }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "a", for: indexPath) as! AlertCell
        let a = list[indexPath.row]
        cell.fill(a, fresh: fresh.contains(a.id))
        return cell
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        let a = list[indexPath.row]
        guard !a.url.isEmpty else { return }
        /* 발송기가 실어 보내는 값 그대로다(`#/rounds/123`) — `#`만 떼고 넘긴다. */
        var path = a.url
        if path.hasPrefix("#") { path.removeFirst() }
        if !path.hasPrefix("/") { path = "/" + path }
        navigate(path)
    }
}

/**
 * 알림 한 줄 — 카드 안에 그림글자 · 제목(+`N`) · 본문 두 줄 · 시각 · `›`.
 * 안 읽은 줄은 흰 카드에 왼쪽 빨간 띠, 읽은 줄은 옅은 바탕(웹 `.alert-row.fresh/.seen`).
 */
final class AlertCell: UITableViewCell {
    private let card = UIView()
    private let bar = UIView()
    private let icon = UILabel()
    private let titleL = UILabel()
    private let bodyL = UILabel()
    private let whenL = UILabel()
    private let chev = UILabel()
    private let column = UIStackView()

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        backgroundColor = .clear
        contentView.backgroundColor = .clear
        selectionStyle = .none
        card.translatesAutoresizingMaskIntoConstraints = false
        card.layer.cornerRadius = AppSkin.radius
        card.layer.cornerCurve = .continuous
        card.layer.masksToBounds = true
        bar.translatesAutoresizingMaskIntoConstraints = false
        bar.backgroundColor = AppSkin.danger
        icon.translatesAutoresizingMaskIntoConstraints = false
        icon.font = .systemFont(ofSize: 20)
        icon.setContentHuggingPriority(.required, for: .horizontal)
        titleL.numberOfLines = 0
        bodyL.font = .systemFont(ofSize: 14)
        bodyL.textColor = AppSkin.dim
        bodyL.numberOfLines = 2
        whenL.font = .systemFont(ofSize: 12)
        whenL.textColor = AppSkin.faint
        column.axis = .vertical
        column.spacing = 2
        column.translatesAutoresizingMaskIntoConstraints = false
        column.addArrangedSubview(titleL)
        column.addArrangedSubview(bodyL)
        column.addArrangedSubview(whenL)
        column.setCustomSpacing(4, after: bodyL)
        chev.text = "›"
        chev.font = .systemFont(ofSize: 20)
        chev.textColor = AppSkin.faint
        chev.translatesAutoresizingMaskIntoConstraints = false
        chev.setContentHuggingPriority(.required, for: .horizontal)
        contentView.addSubview(card)
        card.addSubview(bar); card.addSubview(icon); card.addSubview(column); card.addSubview(chev)
        NSLayoutConstraint.activate([
            card.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 5),
            card.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -5),
            card.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            card.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
            bar.leadingAnchor.constraint(equalTo: card.leadingAnchor),
            bar.topAnchor.constraint(equalTo: card.topAnchor),
            bar.bottomAnchor.constraint(equalTo: card.bottomAnchor),
            bar.widthAnchor.constraint(equalToConstant: 3),
            icon.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 13),
            icon.topAnchor.constraint(equalTo: card.topAnchor, constant: 13),
            column.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 10),
            column.topAnchor.constraint(equalTo: card.topAnchor, constant: 13),
            column.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -13),
            column.trailingAnchor.constraint(equalTo: chev.leadingAnchor, constant: -8),
            chev.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -13),
            chev.centerYAnchor.constraint(equalTo: card.centerYAnchor)
        ])
    }
    required init?(coder: NSCoder) { fatalError() }

    func fill(_ a: AppAlert, fresh: Bool) {
        let s = a.split
        icon.text = s.icon
        icon.alpha = fresh ? 1 : 0.55
        let t = NSMutableAttributedString(string: s.text, attributes: [
            .font: UIFont.systemFont(ofSize: 15, weight: fresh ? .bold : .semibold),
            .foregroundColor: fresh ? AppSkin.text : AppSkin.dim
        ])
        if fresh {
            /* 색만으로 가르지 않으려고 둔 작은 표 — 웹 `.alert-new`. */
            t.append(NSAttributedString(string: "  N", attributes: [
                .font: UIFont.systemFont(ofSize: 10, weight: .heavy),
                .foregroundColor: AppSkin.danger, .baselineOffset: 2
            ]))
        }
        titleL.attributedText = t
        bodyL.text = a.body
        bodyL.isHidden = a.body.isEmpty
        whenL.text = AppDate.ago(a.createdAt)
        chev.isHidden = a.url.isEmpty
        bar.isHidden = !fresh
        card.backgroundColor = fresh ? AppSkin.surface : AppSkin.surface2
    }
}
