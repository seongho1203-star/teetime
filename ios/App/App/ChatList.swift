import UIKit

/*
 * **대화 목록을 앱이 그린다**(17판 · 사용자가 고른 길 —
 * `docs/네이티브로-바꾸기.md`의 B).
 *
 * 사용자가 `카톡만큼 부드럽게`를 바라며 짚은 거친 순간은 **전부 이 화면**
 * 이었다 — 키보드가 오르내릴 때 · 위로 올리면 끊긴다 · 치면 깜빡인다.
 * 앞의 둘은 글칸(`ComposerBar`)과 목록 그림 밀기(`ListSlider`)로 메워
 * 왔지만, 그것은 **웹 목록을 밖에서 떠받치는 일**이라 끝이 없었다.
 * 목록 자체가 네이티브가 되면 그 일이 통째로 없어진다:
 *
 * - **키보드와 한 몸으로 움직인다.** 아래를 바 윗변에 묶어 두므로
 *   `keyboardLayoutGuide`가 바를 옮길 때 목록도 같은 움직임을 탄다 —
 *   프레임마다 다리를 건너 높이를 다시 적던 일(`kbFrame`)이 필요 없다.
 * - **그림을 미리 받아 둘 일이 없다.** 사진·이모티콘을 푸는 일이 화면
 *   그리는 갈래 밖에서 돌아, 훑는 중에 걸리지 않는다.
 * - **늦게 뜬 사진이 자리를 밀지 않는다.** 높이를 우리가 재서 잡아 둔다.
 *
 * ## 무엇을 누가 맡나 — 이 파일의 전부다
 *
 * **줄은 웹이 만든다.** 누구 글인지 · 이름을 붙일지 · 시각을 적을지 ·
 * 가려진 글인지 · 안 읽은 수가 몇인지는 전부 웹이 이미 알고 있고, 그
 * 규칙이 `Chat.tsx`에 한 벌로 있다. 여기서 다시 셈하면 **같은 규칙이 두
 * 곳이 되어 언젠가 어긋난다**(CLAUDE.md가 스무 번 적어 둔 그 자리다).
 * 그래서 이 파일은 **그리기와 굴리기만** 한다:
 *
 *   웹 → `listRows`(줄 목록) → 우리가 높이를 재고 그린다
 *   우리 → `listState`(맨 아래인가 · 맨 위에 닿았나) → 웹이 더 받아 온다
 *
 * **크기와 색도 웹이 준다**(`listAttach`의 값들 · `composerSkin()`과 같은
 * 결이다). 앱은 한 바퀴가 30분인데 웹은 밀면 바로 올라가므로, 어긋난 것을
 * 고치는 길이 웹에 있어야 한다. 아래 기본값은 **웹이 안 줄 때의 예비값**
 * 이고, 값의 출처는 카톡 스크린샷을 픽셀로 재서 맞춘 그 표다(CLAUDE.md의
 * `대화 화면의 크기`). **눈대중으로 고치지 말 것.**
 *
 * ## 되물러남
 *
 * **웹 목록은 지우지 않는다.** 이 목록이 서서 줄을 받아 그렸다고 알려 줄
 * 때만 웹이 제 목록을 `visibility: hidden`으로 감춘다 — 안 서면 예전
 * 그대로다(`display: none`이 아닌 것은 자리를 그대로 둬야 `--chat-h` 셈이
 * 안 흔들리기 때문이다. 댓글 칸에서 쓴 그 수와 같다).
 * 여기가 어긋나도 `내 정보`의 스위치 한 번으로 웹 목록으로 돌아간다.
 *
 * **헤드리스로는 한 줄도 확인할 수 없다**(맥도 아이폰도 없다). 그래서
 * 되물러남을 먼저 만들어 두었고, 판을 잘게 나눠 올린다.
 */

// MARK: - 웹이 보내 주는 한 줄

struct ChatRow {
    enum Kind {
        case text       // 말풍선
        case system     // 가운데 안내 줄
        case other      // 아직 안 그리는 것(사진·이모티콘…) — 자리만 잡는다
    }

    let id: String
    let kind: Kind
    /// 내 글인가(오른쪽에 노란 말풍선).
    let mine: Bool
    /// 이름. **없으면 안 그린다** — 같은 사람이 같은 분에 잇따라 보낸 줄이다.
    let name: String?
    /// 얼굴 그림 주소. 이름과 한 벌로 온다(없으면 글자 한 자를 그린다).
    let avatar: String?
    /// 남녀 테두리 색(`#rrggbb`). 없으면 테두리 없음.
    let edge: UIColor?
    let body: String
    /// 덩어리의 **마지막 줄에만** 붙는다.
    let time: String?
    /// 안 읽은 사람 수. 0이면 안 그린다.
    let unread: Int
    /// 이 줄 **위에** 붙는 날짜 칸(`10월 4일 (일)`). 없으면 안 붙는다.
    let date: String?
    /// 아직 못 그리는 줄에 적을 말(`사진`·`이모티콘`).
    let note: String?

    init?(_ d: [String: Any]) {
        guard let id = d["id"] as? String else { return nil }
        self.id = id
        switch d["kind"] as? String {
        case "system": kind = .system
        case "text": kind = .text
        default: kind = .other
        }
        mine = (d["mine"] as? Bool) ?? false
        name = d["name"] as? String
        avatar = d["avatar"] as? String
        edge = ChatList.color(d["edge"] as? String)
        body = (d["body"] as? String) ?? ""
        time = d["time"] as? String
        unread = (d["unread"] as? Int) ?? 0
        date = d["date"] as? String
        note = d["note"] as? String
    }
}

// MARK: - 값 (웹이 정한다)

struct ChatSkin {
    var bg = UIColor(red: 0x73 / 255, green: 0x69 / 255, blue: 0xa0 / 255, alpha: 1)
    var bubble = UIColor(red: 0xf5 / 255, green: 0xf5 / 255, blue: 0xf5 / 255, alpha: 1)
    var mineBubble = UIColor(red: 1, green: 0xdf / 255, blue: 0x47 / 255, alpha: 1)
    var text = UIColor(red: 0x1b / 255, green: 0x1f / 255, blue: 0x19 / 255, alpha: 1)
    var soft = UIColor(white: 1, alpha: 0.77)      // 이름
    var faint = UIColor(white: 1, alpha: 0.62)     // 시각
    var chip = UIColor(white: 1, alpha: 0.16)      // 날짜·안내 줄 바탕
    var on = UIColor(white: 1, alpha: 0.92)        // 그 위의 글자
    var unread = UIColor(red: 1, green: 0xdf / 255, blue: 0x47 / 255, alpha: 1)

    /// 카톡을 픽셀로 재서 맞춘 값들(345px 화면 기준).
    var pad: CGFloat = 9          // 목록 좌우 여백
    var avatar: CGFloat = 29
    var avatarGap: CGFloat = 7    // 얼굴 → 말풍선
    var radius: CGFloat = 11
    var fontSize: CGFloat = 15
    var lineHeight: CGFloat = 18
    var padH: CGFloat = 11        // 말풍선 가로 안여백(테두리 1 포함)
    var padV: CGFloat = 8.5       // 세로 안여백(테두리 1 포함) — 한 줄 35px
    var nameSize: CGFloat = 13.5
    var stampSize: CGFloat = 10
    /// 말풍선 최대 폭의 비율. 345px에서 236px을 잰 값이다(236/345).
    var maxRatio: CGFloat = 0.684

    mutating func apply(_ d: [String: Any]) {
        func c(_ k: String, _ v: inout UIColor) {
            if let s = d[k] as? String, let u = ChatList.color(s) { v = u }
        }
        func n(_ k: String, _ v: inout CGFloat) {
            if let x = d[k] as? Double { v = CGFloat(x) }
        }
        c("bg", &bg); c("bubble", &bubble); c("mineBubble", &mineBubble)
        c("text", &text); c("soft", &soft); c("faint", &faint)
        c("chip", &chip); c("on", &on); c("unread", &unread)
        n("pad", &pad); n("avatar", &avatar); n("avatarGap", &avatarGap)
        n("radius", &radius); n("fontSize", &fontSize); n("lineHeight", &lineHeight)
        n("padH", &padH); n("padV", &padV); n("nameSize", &nameSize)
        n("stampSize", &stampSize); n("maxRatio", &maxRatio)
    }
}

protocol ChatListDelegate: AnyObject {
    /// 맨 아래에 있는가 · 맨 위에 닿았는가(지난 대화를 더 받아야 한다).
    func chatListState(atBottom: Bool, atTop: Bool)
}

// MARK: - 목록

final class ChatList: UIView, UITableViewDataSource, UITableViewDelegate {

    weak var listDelegate: ChatListDelegate?

    private let table = UITableView(frame: .zero, style: .plain)
    private var rows: [ChatRow] = []
    private var skin = ChatSkin()
    /// 줄 하나의 높이. `id|폭`으로 담아 두어 다시 재지 않는다.
    private var heights: [String: CGFloat] = [:]
    private var lastAtBottom = true
    private var toldTop = false

    /// 맨 아래에서 이만큼 안쪽이면 '맨 아래'로 본다(웹의 80px과 같은 값).
    private let bottomSlack: CGFloat = 80
    /// 위에서 이만큼 안이면 지난 대화를 더 받아 온다.
    private let topSlack: CGFloat = 400

    override init(frame: CGRect) {
        super.init(frame: frame)
        table.dataSource = self
        table.delegate = self
        table.separatorStyle = .none
        table.backgroundColor = .clear
        table.showsVerticalScrollIndicator = true
        table.register(BubbleCell.self, forCellReuseIdentifier: "b")
        /* **높이를 우리가 잰다.** 저절로 재는 길(`automaticDimension`)은
           줄이 들어올 때마다 자리가 조금씩 튀는데, 이 화면은 `읽던 자리가
           안 튄다`가 규칙이라 그것으로는 못 쓴다. */
        table.estimatedRowHeight = 0
        table.estimatedSectionHeaderHeight = 0
        table.estimatedSectionFooterHeight = 0
        table.contentInsetAdjustmentBehavior = .never
        addSubview(table)
        backgroundColor = skin.bg
    }

    required init?(coder: NSCoder) { fatalError() }

    override func layoutSubviews() {
        super.layoutSubviews()
        let before = table.frame.size
        table.frame = bounds
        /* **폭이 바뀌면 높이를 다시 잰다**(가로세로 돌리기). 같은 폭이면
           담아 둔 값을 그대로 쓴다 — 굴릴 때마다 다시 재면 그것이 곧 끊김이다. */
        if before.width != bounds.width {
            heights.removeAll()
            table.reloadData()
        }
        /* **키보드가 올라와 목록이 짧아지면 굴러간 자리를 따라 내린다.**
           웹에서 `settleList`가 하던 일인데, 여기서는 높이가 바뀌는 그
           자리에서 바로 할 수 있다 — 맨 아래를 보고 있었을 때만이다. */
        if before.height != bounds.height, lastAtBottom {
            scrollToBottom(animated: false)
        }
    }

    // MARK: 웹이 부르는 것

    func apply(skin d: [String: Any]) {
        skin.apply(d)
        backgroundColor = skin.bg
        heights.removeAll()
        table.reloadData()
    }

    /**
     * 줄을 갈아 끼운다.
     *
     * **맨 아래를 보고 있었으면 맨 아래로 따라간다**(새 글이 올 때).
     * **지난 대화를 앞에 붙였으면 읽던 자리를 그대로 둔다** — 붙은 만큼
     * 굴린 자리를 내려 준다. 그게 없으면 `더 보기`를 누를 때마다 화면이
     * 맨 위로 튄다.
     */
    func apply(rows next: [ChatRow], stickBottom: Bool) {
        let wasBottom = atBottom()
        let oldFirst = rows.first?.id
        let oldOffset = table.contentOffset.y

        rows = next
        toldTop = false

        // 앞에 붙은 줄이 있으면 그 높이만큼
        var added: CGFloat = 0
        if let oldFirst = oldFirst,
           let at = next.firstIndex(where: { $0.id == oldFirst }), at > 0 {
            for i in 0..<at { added += height(next[i]) }
        }

        table.reloadData()
        table.layoutIfNeeded()

        if (wasBottom && stickBottom) || rows.count <= 1 {
            scrollToBottom(animated: false)
        } else if added > 0 {
            table.contentOffset.y = oldOffset + added
        }
        report()
    }

    func scrollToBottom(animated: Bool) {
        let y = max(-table.adjustedContentInset.top,
                    table.contentSize.height - table.bounds.height
                        + table.adjustedContentInset.bottom)
        table.setContentOffset(CGPoint(x: 0, y: y), animated: animated)
    }

    func atBottom() -> Bool {
        let max = table.contentSize.height - table.bounds.height
            + table.adjustedContentInset.bottom
        return table.contentOffset.y >= max - bottomSlack
    }

    var rowCount: Int { return rows.count }

    // MARK: 재기

    private func maxBubbleWidth() -> CGFloat {
        return floor(bounds.width * skin.maxRatio)
    }

    private func textWidth() -> CGFloat {
        return maxBubbleWidth() - skin.padH * 2
    }

    private func bodyFont() -> UIFont { return .systemFont(ofSize: skin.fontSize) }

    /**
     * 글이 차지하는 크기. **줄 간격을 못박아 둔다**(카톡에서 잰 18px) —
     * 글꼴이 달라져도 줄 사이는 그대로여야 한 줄 말풍선 높이가 안 흔들린다.
     */
    private func measure(_ s: String, width: CGFloat, size: CGFloat) -> CGSize {
        if s.isEmpty { return CGSize(width: 0, height: skin.lineHeight) }
        let p = NSMutableParagraphStyle()
        p.minimumLineHeight = skin.lineHeight
        p.maximumLineHeight = skin.lineHeight
        p.lineBreakMode = .byWordWrapping
        let attrs: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: size),
            .paragraphStyle: p,
        ]
        let box = CGSize(width: width, height: .greatestFiniteMagnitude)
        let r = (s as NSString).boundingRect(with: box,
                                             options: [.usesLineFragmentOrigin, .usesFontLeading],
                                             attributes: attrs, context: nil)
        return CGSize(width: ceil(r.width), height: ceil(r.height))
    }

    private func height(_ row: ChatRow) -> CGFloat {
        let key = "\(row.id)|\(Int(bounds.width))"
        if let h = heights[key] { return h }
        var h: CGFloat = 0
        if row.date != nil { h += 34 }                   // 날짜 칸 + 사이
        switch row.kind {
        case .system:
            h += measure(row.body, width: bounds.width - skin.pad * 4,
                         size: skin.stampSize + 2).height + 18
        case .text, .other:
            if row.name != nil { h += skin.nameSize + 5 }
            let body = row.kind == .other ? (row.note ?? "사진") : row.body
            let t = measure(body, width: textWidth(), size: skin.fontSize)
            h += t.height + skin.padV * 2
            h += 4                                        // 줄 사이
        }
        heights[key] = h
        return h
    }

    // MARK: 표

    func numberOfSections(in tableView: UITableView) -> Int { return 1 }

    func tableView(_ t: UITableView, numberOfRowsInSection s: Int) -> Int {
        return rows.count
    }

    func tableView(_ t: UITableView, heightForRowAt ip: IndexPath) -> CGFloat {
        return height(rows[ip.row])
    }

    func tableView(_ t: UITableView, cellForRowAt ip: IndexPath) -> UITableViewCell {
        let cell = t.dequeueReusableCell(withIdentifier: "b", for: ip) as! BubbleCell
        cell.fill(rows[ip.row], skin: skin,
                  maxBubble: maxBubbleWidth(), textW: textWidth(), font: bodyFont())
        return cell
    }

    // MARK: 굴리기

    func scrollViewDidScroll(_ sv: UIScrollView) { report() }

    private func report() {
        let bottom = atBottom()
        let top = table.contentOffset.y < topSlack && rows.count > 0
        if bottom == lastAtBottom && !(top && !toldTop) { return }
        lastAtBottom = bottom
        if top { toldTop = true }
        listDelegate?.chatListState(atBottom: bottom, atTop: top)
    }

    // MARK: 도우미

    /// `#rrggbb` · `#rrggbbaa` · `rgba(…)`를 받는다 — 웹이 주는 값 그대로다.
    static func color(_ s: String?) -> UIColor? {
        guard var t = s?.trimmingCharacters(in: .whitespaces), !t.isEmpty else { return nil }
        if t.hasPrefix("rgba") || t.hasPrefix("rgb") {
            let nums = t.components(separatedBy: CharacterSet(charactersIn: "0123456789.").inverted)
                .filter { !$0.isEmpty }.compactMap { Double($0) }
            guard nums.count >= 3 else { return nil }
            let a = nums.count >= 4 ? nums[3] : 1
            return UIColor(red: nums[0] / 255, green: nums[1] / 255, blue: nums[2] / 255, alpha: a)
        }
        if t.hasPrefix("#") { t.removeFirst() }
        if t.count == 3 { t = t.map { "\($0)\($0)" }.joined() }
        guard t.count == 6 || t.count == 8, let v = UInt64(t, radix: 16) else { return nil }
        if t.count == 6 {
            return UIColor(red: CGFloat((v >> 16) & 0xff) / 255,
                           green: CGFloat((v >> 8) & 0xff) / 255,
                           blue: CGFloat(v & 0xff) / 255, alpha: 1)
        }
        return UIColor(red: CGFloat((v >> 24) & 0xff) / 255,
                       green: CGFloat((v >> 16) & 0xff) / 255,
                       blue: CGFloat((v >> 8) & 0xff) / 255,
                       alpha: CGFloat(v & 0xff) / 255)
    }
}

// MARK: - 한 줄

/**
 * 말풍선 한 줄. **Auto Layout을 안 쓴다** — 쉰 줄이 굴러가는 자리라
 * 자리를 직접 잡는 편이 싸고, 값도 우리가 이미 재 두었다.
 */
final class BubbleCell: UITableViewCell {

    private let dateChip = PadLabel()
    private let nameLabel = UILabel()
    private let avatarView = AvatarView()
    private let bubble = UIView()
    private let bodyLabel = UILabel()
    private let timeLabel = UILabel()
    private let unreadLabel = UILabel()
    private let sysChip = PadLabel()

    private var row: ChatRow?
    private var skin = ChatSkin()
    private var maxBubble: CGFloat = 0
    private var textW: CGFloat = 0

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        backgroundColor = .clear
        contentView.backgroundColor = .clear
        selectionStyle = .none

        bodyLabel.numberOfLines = 0
        nameLabel.numberOfLines = 1
        sysChip.numberOfLines = 0
        sysChip.textAlignment = .center
        dateChip.textAlignment = .center
        bubble.layer.cornerRadius = 11
        bubble.layer.cornerCurve = .continuous

        for v in [dateChip, nameLabel, avatarView, bubble, timeLabel, unreadLabel, sysChip] {
            contentView.addSubview(v)
        }
        bubble.addSubview(bodyLabel)
    }

    required init?(coder: NSCoder) { fatalError() }

    func fill(_ r: ChatRow, skin s: ChatSkin, maxBubble mb: CGFloat,
              textW tw: CGFloat, font: UIFont) {
        row = r
        skin = s
        maxBubble = mb
        textW = tw

        let p = NSMutableParagraphStyle()
        p.minimumLineHeight = s.lineHeight
        p.maximumLineHeight = s.lineHeight
        p.lineBreakMode = .byWordWrapping

        let isSystem = r.kind == .system
        sysChip.isHidden = !isSystem
        for v in [nameLabel, avatarView, bubble, timeLabel, unreadLabel] as [UIView] {
            v.isHidden = isSystem
        }

        dateChip.isHidden = r.date == nil
        if let d = r.date {
            dateChip.attributedText = NSAttributedString(string: d, attributes: [
                .font: UIFont.systemFont(ofSize: s.stampSize + 1, weight: .medium),
                .foregroundColor: s.on,
            ])
            dateChip.backgroundColor = s.chip
            dateChip.layer.cornerRadius = 10
            dateChip.layer.masksToBounds = true
            dateChip.inset = UIEdgeInsets(top: 3, left: 10, bottom: 3, right: 10)
        }

        if isSystem {
            sysChip.attributedText = NSAttributedString(string: r.body, attributes: [
                .font: UIFont.systemFont(ofSize: s.stampSize + 2),
                .foregroundColor: s.on,
                .paragraphStyle: p,
            ])
            sysChip.backgroundColor = s.chip
            sysChip.layer.cornerRadius = 10
            sysChip.layer.masksToBounds = true
            sysChip.inset = UIEdgeInsets(top: 5, left: 10, bottom: 5, right: 10)
            setNeedsLayout()
            return
        }

        bubble.backgroundColor = r.mine ? s.mineBubble : s.bubble
        bubble.layer.cornerRadius = s.radius
        let body = r.kind == .other ? (r.note ?? "사진") : r.body
        bodyLabel.attributedText = NSAttributedString(string: body, attributes: [
            .font: font,
            .foregroundColor: s.text,
            .paragraphStyle: p,
        ])

        nameLabel.isHidden = r.name == nil
        if let n = r.name {
            nameLabel.attributedText = NSAttributedString(string: n, attributes: [
                .font: UIFont.systemFont(ofSize: s.nameSize),
                .foregroundColor: s.soft,
            ])
        }
        avatarView.isHidden = r.mine || r.name == nil
        if !avatarView.isHidden {
            avatarView.show(url: r.avatar, letter: r.name ?? "", edge: r.edge, size: s.avatar)
        }

        timeLabel.isHidden = r.time == nil
        if let t = r.time {
            timeLabel.attributedText = NSAttributedString(string: t, attributes: [
                .font: UIFont.systemFont(ofSize: s.stampSize),
                .foregroundColor: s.faint,
            ])
        }
        unreadLabel.isHidden = r.unread <= 0
        if r.unread > 0 {
            unreadLabel.attributedText = NSAttributedString(string: "\(r.unread)", attributes: [
                .font: UIFont.systemFont(ofSize: s.stampSize, weight: .semibold),
                .foregroundColor: s.unread,
            ])
        }
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard let r = row else { return }
        let w = contentView.bounds.width
        var y: CGFloat = 0

        if !dateChip.isHidden {
            let size = dateChip.intrinsicContentSize
            dateChip.frame = CGRect(x: (w - size.width) / 2, y: 6,
                                    width: size.width, height: size.height)
            y = dateChip.frame.maxY + 8
        }

        if r.kind == .system {
            let maxW = w - skin.pad * 4
            let size = sysChip.sizeThatFits(CGSize(width: maxW, height: .greatestFiniteMagnitude))
            let cw = min(maxW, size.width)
            sysChip.frame = CGRect(x: (w - cw) / 2, y: y + 4, width: cw, height: size.height)
            return
        }

        if !nameLabel.isHidden {
            let x = skin.pad + skin.avatar + skin.avatarGap
            nameLabel.frame = CGRect(x: x, y: y, width: w - x - skin.pad, height: skin.nameSize + 4)
            y = nameLabel.frame.maxY + 1
        }

        let body = bodyLabel.attributedText?.string ?? ""
        let size = measureBody(body)
        let bw = min(maxBubble, size.width + skin.padH * 2)
        let bh = size.height + skin.padV * 2

        let x: CGFloat
        if r.mine {
            x = w - skin.pad - bw
        } else {
            x = skin.pad + skin.avatar + skin.avatarGap
            if !avatarView.isHidden {
                avatarView.frame = CGRect(x: skin.pad, y: y, width: skin.avatar, height: skin.avatar)
            }
        }
        bubble.frame = CGRect(x: x, y: y, width: bw, height: bh)
        bodyLabel.frame = CGRect(x: skin.padH, y: skin.padV,
                                 width: bw - skin.padH * 2, height: size.height)

        /* 시각·안 읽은 수는 말풍선 옆에 **아래에서부터 세로로 쌓는다**
           (웹의 `Stamp`와 같다) — 숫자가 생기거나 사라져도 말풍선이
           위아래로 안 흔들린다. 시각이 맨 아래, 안 읽은 수가 그 위다. */
        let stampW: CGFloat = 44
        let stampH = skin.stampSize + 3
        let sx = r.mine ? bubble.frame.minX - 4 - stampW : bubble.frame.maxX + 4
        var bottom = bubble.frame.maxY
        if !timeLabel.isHidden {
            timeLabel.frame = CGRect(x: sx, y: bottom - stampH, width: stampW, height: stampH)
            timeLabel.textAlignment = r.mine ? .right : .left
            bottom -= stampH
        }
        if !unreadLabel.isHidden {
            unreadLabel.frame = CGRect(x: sx, y: bottom - stampH, width: stampW, height: stampH)
            unreadLabel.textAlignment = r.mine ? .right : .left
        }
    }

    private func measureBody(_ s: String) -> CGSize {
        if s.isEmpty { return CGSize(width: 0, height: skin.lineHeight) }
        let p = NSMutableParagraphStyle()
        p.minimumLineHeight = skin.lineHeight
        p.maximumLineHeight = skin.lineHeight
        p.lineBreakMode = .byWordWrapping
        let r = (s as NSString).boundingRect(
            with: CGSize(width: textW, height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: [.font: UIFont.systemFont(ofSize: skin.fontSize), .paragraphStyle: p],
            context: nil)
        return CGSize(width: ceil(r.width), height: ceil(r.height))
    }
}

// MARK: - 조각들

/// 안여백이 있는 글상자(날짜 칸·안내 줄).
final class PadLabel: UILabel {
    var inset = UIEdgeInsets(top: 3, left: 10, bottom: 3, right: 10)

    override func drawText(in rect: CGRect) {
        super.drawText(in: rect.inset(by: inset))
    }

    override var intrinsicContentSize: CGSize {
        let s = super.intrinsicContentSize
        return CGSize(width: s.width + inset.left + inset.right,
                      height: s.height + inset.top + inset.bottom)
    }

    override func sizeThatFits(_ size: CGSize) -> CGSize {
        let inner = CGSize(width: size.width - inset.left - inset.right, height: size.height)
        let s = super.sizeThatFits(inner)
        return CGSize(width: s.width + inset.left + inset.right,
                      height: s.height + inset.top + inset.bottom)
    }
}

/**
 * 얼굴. **모서리 둥근 네모다**(동그라미가 아니다 — 카톡과 같은 결이고,
 * `사소해 보이지만 인상에 크게 든다`고 적어 둔 그 자리다).
 * 그림이 없거나 못 받아 오면 이름 첫 글자를 그린다(웹의 `Avatar`와 같다).
 */
final class AvatarView: UIView {
    private let image = UIImageView()
    private let letter = UILabel()
    private var token: UUID?

    override init(frame: CGRect) {
        super.init(frame: frame)
        layer.masksToBounds = true
        layer.cornerCurve = .continuous
        image.contentMode = .scaleAspectFill
        letter.textAlignment = .center
        letter.textColor = .white
        backgroundColor = UIColor(white: 1, alpha: 0.25)
        addSubview(letter)
        addSubview(image)
    }

    required init?(coder: NSCoder) { fatalError() }

    func show(url: String?, letter name: String, edge: UIColor?, size: CGFloat) {
        layer.cornerRadius = size * 10 / 29        // 말풍선 옆 얼굴의 비율
        letter.font = .systemFont(ofSize: size * 0.34, weight: .semibold)
        /* **마지막 두 글자다**(웹의 `Avatar`와 같다) — 한국 이름은 성보다
           이름이 사람을 가른다(`신성호` → `성호`). 한쪽만 고치지 말 것. */
        letter.text = name.isEmpty ? "?" : String(name.suffix(2))
        if let edge = edge {
            layer.borderWidth = 2
            layer.borderColor = edge.cgColor
        } else {
            layer.borderWidth = 0
        }
        image.isHidden = true
        token = nil
        guard let url = url, !url.isEmpty else { return }
        let mine = UUID()
        token = mine
        ImageStore.shared.load(url) { [weak self] img in
            guard let self, self.token == mine, let img = img else { return }
            self.image.image = img
            self.image.isHidden = false
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        image.frame = bounds
        letter.frame = bounds
    }
}

/**
 * 그림을 한 번만 받아 담아 둔다.
 *
 * **주소를 `https`로 올려 받는다** — 카카오 프사가 `http://k.kakaocdn.net/…`
 * 으로 저장돼 있는데, 앱에서는 iOS가 http를 통째로 막아 그림만 조용히
 * 실패한다(웹에서 겪고 `Avatar`의 `https()`로 고친 그 자리다).
 * **`NSAllowsArbitraryLoads`로 열지 말 것** — 앱 전체의 http를 여는 일이다.
 */
final class ImageStore {
    static let shared = ImageStore()
    private let cache = NSCache<NSString, UIImage>()
    private var waiting: [String: [(UIImage?) -> Void]] = [:]

    func load(_ raw: String, done: @escaping (UIImage?) -> Void) {
        var s = raw
        if s.hasPrefix("http://") { s = "https://" + s.dropFirst("http://".count) }
        if let hit = cache.object(forKey: s as NSString) { done(hit); return }
        guard let url = URL(string: s) else { done(nil); return }
        if waiting[s] != nil { waiting[s]?.append(done); return }
        waiting[s] = [done]
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            let img = data.flatMap { UIImage(data: $0) }
            DispatchQueue.main.async {
                guard let self else { return }
                if let img = img { self.cache.setObject(img, forKey: s as NSString) }
                let all = self.waiting.removeValue(forKey: s) ?? []
                all.forEach { $0(img) }
            }
        }.resume()
    }
}
