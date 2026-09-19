import UIKit

/**
 * 대화 서랍(☰)과 전체화면 프로필.
 *
 * **둘 다 화면에 올리는 뷰다 — 따로 띄우는 화면(`present`)이 아니다.**
 * 대화 화면 안에 얹어야 네이티브 글칸 바와 말풍선 목록을 그대로 덮는다
 * (웹의 `z-index`로 앱 부품을 못 덮는 그 자리와 같은 까닭이다).
 *
 * 값은 **카톡 서랍 사진을 픽셀로 재서 맞춘 것**이다(그 폰 1206×2622 ·
 * 배율 3.0 — 대화 화면을 맞출 때와 같은 자다). 한 장 192픽셀 → 64px,
 * 사이 12픽셀 → 4px, 모서리 7픽셀 → 4px. 참여자 줄은 150 → 50px
 * (36 + 7×2) · 얼굴 108 → 36px · 얼굴에서 이름까지 39 → 13px.
 * **눈대중으로 고치지 말 것.**
 */

/// 직책 — 이름과 색이 **회원 명단(`ROLE_TAG` → `.role-*`)과 같아야 한다.**
enum ChatRole {
    static func label(_ role: String?) -> String {
        return ["superadmin": "앱관리자", "admin": "운영자",
                "staff": "부운영자", "treasurer": "총무"][role ?? ""] ?? ""
    }

    static func color(_ role: String?) -> UIColor? {
        switch role ?? "" {
        case "superadmin": return UIColor(hexString: "#b41f72")
        case "admin": return UIColor(hexString: "#e84a7f")
        case "staff": return UIColor(hexString: "#2c7bd4")
        case "treasurer": return UIColor(hexString: "#b97c00")
        default: return nil
        }
    }

    /// 운영진인가 — **DB의 `is_admin()`과 같은 잣대다**(총무는 안 든다).
    static func isAdmin(_ role: String?) -> Bool {
        return ["staff", "admin", "superadmin"].contains(role ?? "")
    }

    /**
     * 서랍의 차례 — **운영진이 맨 위, 그다음 총무, 그다음 일반회원**이고
     * 묶음 안에서는 **연장자가 앞**이다(사용자 요청 — `운영진이 맨위에오고
     * 그 다음은 나이순으로 정렬되게해줘`).
     *
     * **모르는 값은 늘 뒤로 보낸다** — 태어난 해가 `null`인 것은 0이 아니라
     * **아직 안 적음**이다. 같은 값끼리는 이름순이다.
     */
    static func order(_ a: ChatJSON, _ b: ChatJSON) -> Bool {
        let ra = a["role"] as? String, rb = b["role"] as? String
        let ga = isAdmin(ra) ? 0 : (ra == "treasurer" ? 1 : 2)
        let gb = isAdmin(rb) ? 0 : (rb == "treasurer" ? 1 : 2)
        if ga != gb { return ga < gb }
        let ya = a["birth_year"] as? Int ?? 9999
        let yb = b["birth_year"] as? Int ?? 9999
        if ya != yb { return ya < yb }
        return (a["name"] as? String ?? "") < (b["name"] as? String ?? "")
    }
}

/**
 * 서랍 안의 묶음 머리말 — **초록 네모 그림 + 굵은 제목**이다.
 *
 * 사용자 요청(`우측 상단 메뉴눌렀을때 내가 올린사진처럼해주고` · 밴드
 * 화면을 받아 맞췄다). 예전에는 흐린 14px 한 줄이라 두 묶음이 그냥
 * 이어져 보였다.
 *
 * **값은 그 사진을 픽셀로 재서 얻었다**(1206 × 배율 3.0 — 대화 화면을
 * 맞출 때와 같은 자다): 그림 58픽셀 → **20px** · 그림에서 제목까지
 * 33픽셀 → **10px** · 제목 잉크 46픽셀 → **20px 굵게**.
 * **눈대중으로 고치지 말 것.**
 *
 * **초록은 새로 안 정한다** — 눌리는 카드의 배지와 같은
 * `ChatSkin().cardBadge`(웹의 `--grass`)이고 그림은 흰색으로 뒤집는다
 * (`RankMark`가 직책 색을 물려받는 것과 같은 수다).
 */
final class DrawerHead: UIView {
    static let height: CGFloat = 26
    private static let markSize: CGFloat = 20
    private static let gap: CGFloat = 10

    private let mark = UIImageView()
    private let label = UILabel()

    var title: String {
        get { label.text ?? "" }
        set { label.text = newValue }
    }

    init(icon: String, title: String) {
        super.init(frame: .zero)
        mark.backgroundColor = ChatSkin().cardBadge
        mark.layer.cornerRadius = 6
        mark.layer.cornerCurve = .continuous
        mark.clipsToBounds = true
        mark.contentMode = .center
        /* **그림글자를 쓰지 말 것** — 기기에 없으면 네모난 두부가 나온다
           (투표 결과 카드의 `🗳`에서 겪었다). SF Symbol이다. */
        mark.image = UIImage(systemName: icon,
            withConfiguration: UIImage.SymbolConfiguration(pointSize: 11, weight: .semibold))
        mark.tintColor = .white
        addSubview(mark)

        label.text = title
        label.font = .systemFont(ofSize: 20, weight: .bold)
        label.textColor = .label
        addSubview(label)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func layoutSubviews() {
        super.layoutSubviews()
        let s = Self.markSize
        mark.frame = CGRect(x: 0, y: (bounds.height - s) / 2, width: s, height: s)
        let x = s + Self.gap
        label.frame = CGRect(x: x, y: 0, width: max(0, bounds.width - x), height: bounds.height)
    }
}

/**
 * 사진 줄 끝의 `더보기` — 동그란 `→`와 그 아래 글자.
 *
 * **누르는 자리는 사진 한 장만 하다**(64×64). 그림의 동그라미는 24px쯤
 * 이지만 그 크기로 두면 `node .dev/audit.mjs`가 잡는 30px 아래가 되고
 * 손으로 누르기도 어렵다 — 동그라미만 작게 그리고 **누르는 칸은 줄
 * 높이를 다 쓴다.**
 */
final class DrawerMore: UIControl {
    static let width: CGFloat = 64
    private static let ring: CGFloat = 36

    private let circle = UIView()
    private let arrow = UIImageView()
    private let label = UILabel()

    override init(frame: CGRect) {
        super.init(frame: frame)
        circle.backgroundColor = .secondarySystemFill
        circle.layer.cornerRadius = Self.ring / 2
        circle.isUserInteractionEnabled = false
        addSubview(circle)

        arrow.image = UIImage(systemName: "arrow.right",
            withConfiguration: UIImage.SymbolConfiguration(pointSize: 15, weight: .semibold))
        arrow.tintColor = .label
        arrow.contentMode = .center
        arrow.isUserInteractionEnabled = false
        addSubview(arrow)

        label.text = "더보기"
        label.font = .systemFont(ofSize: 12)
        label.textColor = .secondaryLabel
        label.textAlignment = .center
        label.isUserInteractionEnabled = false
        addSubview(label)

        accessibilityLabel = "사진·동영상 더보기"
        accessibilityIdentifier = "native-chat-drawer-more"
    }

    required init?(coder: NSCoder) { fatalError() }

    override func layoutSubviews() {
        super.layoutSubviews()
        let r = Self.ring
        circle.frame = CGRect(x: (bounds.width - r) / 2, y: 2, width: r, height: r)
        arrow.frame = circle.frame
        label.frame = CGRect(x: 0, y: circle.frame.maxY + 4, width: bounds.width, height: 16)
    }

    override var isHighlighted: Bool {
        didSet { alpha = isHighlighted ? 0.6 : 1 }
    }
}

// MARK: - 서랍 (☰)

/**
 * 위에서부터 **`최근 사진` · `참여자 N명`**이다(사용자 요청 — 카톡 서랍
 * 사진을 받아 맞췄다). **맨 윗줄에는 `닫기` 하나만 둔다** — 방 이름은 바로
 * 위 대화 머리말에 그대로 보이므로 두 군데에 적지 않는다.
 */
final class ChatDrawer: UIView, UITableViewDataSource, UITableViewDelegate {

    /// 사람이 이만큼을 넘으면 **늘어놓지 않고 찾게 한다**(웹의 `FIND_AT`).
    private static let findAt = 12
    private static let thumb: CGFloat = 64
    private static let thumbGap: CGFloat = 4
    private static let rowH: CGFloat = 50

    var onClose: (() -> Void)?
    var onPerson: ((String) -> Void)?
    var onPhoto: ((String) -> Void)?
    /// `더보기` — 사진만 격자로 모아 보는 화면을 연다(`ChatGallery`).
    var onMore: (() -> Void)?

    private let dim = UIView()
    private let panel = UIView()
    private let closeBtn = UIButton(type: .system)
    private let shotsHead = DrawerHead(icon: "photo.fill", title: "사진·동영상")
    private let shotsRow = UIScrollView()
    private let moreBtn = DrawerMore()
    private let peopleHead = DrawerHead(icon: "person.2.fill", title: "참여자")
    private let find = UITextField()
    private let table = UITableView()

    private var me = ""
    private var people: [ChatJSON] = []
    private var shown: [ChatJSON] = []
    private var photos: [(id: String, url: String)] = []
    /// 저장 기간(일주일 · `lib/photos.ts`의 `PHOTO_DAYS`)이 지나 지워진 사진 —
    /// **참·거짓이 아니라 그 글의 id다**(`Avatar`의 `bad`와 같은 결이다).
    /// 네모난 빈칸이 되므로 아예 안 그린다. **못 받아 온 것은 여기 안 담는다** —
    /// 통이 `없다`고 답했을 때만이다(`ChatThumb.load` 주석).
    private var gone: Set<String> = []

    override init(frame: CGRect) {
        super.init(frame: frame)
        dim.backgroundColor = UIColor(white: 0, alpha: 0.32)
        dim.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(closeTapped)))
        addSubview(dim)

        panel.backgroundColor = .systemBackground
        addSubview(panel)

        closeBtn.setTitle("닫기", for: .normal)
        closeBtn.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
        closeBtn.accessibilityIdentifier = "native-chat-drawer-close"
        closeBtn.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)

        /* **`최근`을 뗐다** — 예전에는 서른 장만 보여 주므로 다 있는 것처럼
           적으면 거짓말이 된다고 `최근 사진·동영상`이었는데, 이제 줄 끝의
           `더보기`가 **다 보여 주는 화면**으로 데려간다(`ChatGallery`).
           그 단추를 없애면 이름도 함께 되돌릴 것. */
        /* **가로로만 굴러간다** — 세로로 쌓으면 사진 서른 장이 서랍을 통째로
           먹어 참여자 목록이 저 아래로 밀린다. */
        shotsRow.showsHorizontalScrollIndicator = false
        shotsRow.accessibilityIdentifier = "native-chat-drawer-photos"
        moreBtn.addTarget(self, action: #selector(moreTapped), for: .touchUpInside)

        find.borderStyle = .roundedRect
        find.font = .systemFont(ofSize: 16)
        find.clearButtonMode = .whileEditing
        find.returnKeyType = .done
        find.accessibilityLabel = "참여자 찾기"
        find.addTarget(self, action: #selector(findChanged), for: .editingChanged)
        find.addTarget(self, action: #selector(findDone), for: .editingDidEndOnExit)

        table.dataSource = self
        table.delegate = self
        table.rowHeight = Self.rowH
        /* **줄을 가르는 선이 없다** — 얼굴이 이미 줄을 갈라 준다(카톡 사진을
           픽셀로 훑어 확인했다). **되살리지 말 것.** */
        table.separatorStyle = .none
        table.keyboardDismissMode = .onDrag
        table.register(ChatPersonCell.self, forCellReuseIdentifier: "p")
        table.accessibilityIdentifier = "native-chat-drawer-people"

        for v in [closeBtn, shotsHead, shotsRow, moreBtn, peopleHead, find, table] as [UIView] {
            panel.addSubview(v)
        }
        isHidden = true
    }

    required init?(coder: NSCoder) { fatalError() }

    @objc private func closeTapped() { onClose?() }
    @objc private func moreTapped() { onMore?() }
    @objc private func findDone() { find.resignFirstResponder() }
    @objc private func findChanged() { filter(); table.reloadData() }

    /// 서랍을 연다. **명단을 새로 안 받아 온다** — 대화 화면이 이미 들고
    /// 있는 값이고, 방에 있는 사람이 곧 회원이다.
    func show(people list: [ChatJSON], me id: String) {
        me = id
        people = list.sorted(by: ChatRole.order)
        filter()
        table.reloadData()
        peopleHead.title = "참여자 \(people.count)명"
        find.isHidden = people.count <= Self.findAt
        isHidden = false
        setNeedsLayout()
        layoutIfNeeded()
        dim.alpha = 0
        panel.transform = CGAffineTransform(translationX: panel.bounds.width, y: 0)
        UIView.animate(withDuration: 0.22, delay: 0, options: [.curveEaseOut]) {
            self.dim.alpha = 1
            self.panel.transform = .identity
        }
    }

    func hide() {
        find.resignFirstResponder()
        isHidden = true
        panel.transform = .identity
    }

    /**
     * 최근 사진을 늘어놓는다. **한 장도 없으면 묶음째 안 그린다** —
     * 글만 오간 방에 빈 칸이 덩그러니 남지 않게.
     */
    func setPhotos(_ list: [(id: String, url: String)]) {
        photos = list
        for v in shotsRow.subviews { v.removeFromSuperview() }
        var x: CGFloat = 0
        for p in photos where !gone.contains(p.id) {
            let b = ChatThumb(id: p.id, url: p.url)
            b.frame = CGRect(x: x, y: 0, width: Self.thumb, height: Self.thumb)
            b.addTarget(self, action: #selector(thumbTapped(_:)), for: .touchUpInside)
            b.onGone = { [weak self] id in self?.dropPhoto(id) }
            /* **받아 오는 것은 손잡이를 단 뒤에 시작한다** — 담아 둔 그림은
               그 자리에서 곧바로 답하므로, 만들 때 시작하면 지워진 사진을
               알려 줄 데가 없다. */
            b.load()
            shotsRow.addSubview(b)
            x += Self.thumb + Self.thumbGap
        }
        shotsRow.contentSize = CGSize(width: max(0, x - Self.thumbGap), height: Self.thumb)
        setNeedsLayout()
    }

    /// 저장 기간이 지난 사진을 목록에서 뺀다. **다시 그리는 것은 다음
    /// 차례로 미룬다** — 그리는 도중에 또 그리면 서로를 물고 돈다.
    private func dropPhoto(_ id: String) {
        guard !gone.contains(id) else { return }
        gone.insert(id)
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.setPhotos(self.photos)
        }
    }

    @objc private func thumbTapped(_ b: ChatThumb) { onPhoto?(b.url) }

    private func filter() {
        let q = (find.text ?? "").trimmingCharacters(in: .whitespaces)
        shown = q.isEmpty ? people : people.filter {
            NativeChatRows.label($0).localizedCaseInsensitiveContains(q)
        }
    }

    private var hasPhotos: Bool { return !shotsRow.subviews.isEmpty }

    override func layoutSubviews() {
        super.layoutSubviews()
        dim.frame = bounds
        let w = min(bounds.width - 40, 360)
        panel.frame = CGRect(x: bounds.width - w, y: 0, width: w, height: bounds.height)
        let pad: CGFloat = 16
        let top = safeAreaInsets.top
        closeBtn.frame = CGRect(x: w - pad - 60, y: top + 6, width: 60, height: 44)
        var y = top + 56
        if hasPhotos {
            shotsHead.isHidden = false
            shotsRow.isHidden = false
            moreBtn.isHidden = false
            shotsHead.frame = CGRect(x: pad, y: y, width: w - pad * 2, height: DrawerHead.height)
            y += DrawerHead.height + 12
            /* **`더보기`는 굴러가는 줄 밖, 오른쪽 끝에 붙박여 있다** — 줄
               안에 넣으면 사진 서른 장을 다 굴려야 만난다. 줄은 그만큼
               좁아진다. */
            moreBtn.frame = CGRect(x: w - pad - DrawerMore.width, y: y,
                                   width: DrawerMore.width, height: Self.thumb)
            shotsRow.frame = CGRect(x: pad, y: y,
                                    width: max(0, moreBtn.frame.minX - pad - 8), height: Self.thumb)
            y += Self.thumb + 20
        } else {
            shotsHead.isHidden = true
            shotsRow.isHidden = true
            moreBtn.isHidden = true
        }
        peopleHead.frame = CGRect(x: pad, y: y, width: w - pad * 2, height: DrawerHead.height)
        y += DrawerHead.height + 10
        if !find.isHidden {
            find.frame = CGRect(x: pad, y: y, width: w - pad * 2, height: 40)
            y += 48
        }
        table.frame = CGRect(x: 0, y: y, width: w, height: max(0, bounds.height - y - safeAreaInsets.bottom))
    }

    func tableView(_ t: UITableView, numberOfRowsInSection s: Int) -> Int { return shown.count }

    func tableView(_ t: UITableView, cellForRowAt ip: IndexPath) -> UITableViewCell {
        let cell = t.dequeueReusableCell(withIdentifier: "p", for: ip) as! ChatPersonCell
        cell.fill(shown[ip.row], me: me)
        return cell
    }

    func tableView(_ t: UITableView, didSelectRowAt ip: IndexPath) {
        t.deselectRow(at: ip, animated: true)
        onPerson?(shown[ip.row]["id"] as? String ?? "")
    }
}

/// 서랍의 사진 한 장. **지워진 것이 확인되면 알려 준다** — 저장 기간이 지난
/// 사진은 주소만 남아 있어 네모난 빈칸이 되므로 그 줄을 아예 뺀다.
final class ChatThumb: UIControl {
    let id: String
    let url: String
    var onGone: ((String) -> Void)?
    private let image = UIImageView()
    /// 동영상 자리에 얹는 ▶.
    private let play = UIImageView()

    init(id i: String, url u: String) {
        id = i
        url = u
        super.init(frame: .zero)
        layer.cornerRadius = 4
        layer.cornerCurve = .continuous
        clipsToBounds = true
        backgroundColor = .secondarySystemFill
        image.contentMode = .scaleAspectFill
        image.isUserInteractionEnabled = false
        addSubview(image)
        /* **동영상은 ▶를 얹는다** — 그림이 첫 장면이라 그것만으로는
           사진과 구별이 안 된다(말풍선의 그 규칙과 같다). */
        let video = ChatMedia.isVideo(u)
        play.image = UIImage(systemName: "play.circle.fill",
            withConfiguration: UIImage.SymbolConfiguration(pointSize: 20, weight: .regular))
        play.tintColor = UIColor(white: 1, alpha: 0.92)
        play.contentMode = .center
        play.isHidden = !video
        play.isUserInteractionEnabled = false
        addSubview(play)
        accessibilityLabel = video ? "동영상" : "사진"
    }

    /**
     * **못 받아 왔다고 지워진 것으로 보지 않는다**(44판).
     *
     * 목록에서 빼는 것은 통이 `없다`고 답했을 때(`gone`)뿐이다 — 끊김이나
     * 시간 초과로 빼면 한 번 실패할 때마다 한 장씩 영영 사라져 **끝내
     * 묶음째 안 그려진다**(사용자 제보 — `메뉴눌렀을때 나오던 사진이 안나옴`).
     * 사진을 원본 그대로 올리게 되면서 한 장이 3~5MB라 그 실패가 훨씬 잦다.
     * 그때는 회색 칸으로 남겨 두고 **다음에 서랍을 열 때 다시 받아 온다.**
     */
    func load() {
        ImageStore.shared.fetch(url) { [weak self] shot, gone in
            guard let self = self else { return }
            if let img = shot?.first { self.image.image = img } else if gone { self.onGone?(self.id) }
        }
    }

    required init?(coder: NSCoder) { fatalError() }

    override func layoutSubviews() {
        super.layoutSubviews()
        image.frame = bounds
        play.frame = bounds
    }
}

/// 참여자 한 줄 — 얼굴 · 이름표 · 직책 표.
final class ChatPersonCell: UITableViewCell {
    private let face = AvatarView()
    private let mark = UIImageView()
    private let name = UILabel()
    private let mine = PadLabel()

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        selectionStyle = .default
        name.font = .systemFont(ofSize: 16)
        name.lineBreakMode = .byTruncatingTail
        /* **`나`는 이름 앞에 붙는 동그란 표다**(카톡과 같다). 뒤에 두면
           긴 이름표에 밀려 화면 밖으로 나간다. */
        mine.text = "나"
        mine.font = .systemFont(ofSize: 11, weight: .bold)
        mine.textColor = .white
        mine.backgroundColor = UIColor(white: 0, alpha: 0.35)
        mine.layer.cornerRadius = 8
        mine.layer.masksToBounds = true
        mine.inset = UIEdgeInsets(top: 2, left: 6, bottom: 2, right: 6)
        /* **직책은 글자가 아니라 얼굴에 붙는 작은 표다**(사용자 요청).
           **그림글자를 쓰지 말 것** — 기기에 없으면 네모난 두부가 나온다. */
        mark.contentMode = .scaleAspectFit
        mark.tintColor = .white
        mark.layer.cornerRadius = 8
        mark.layer.masksToBounds = true
        for v in [face, mark, mine, name] as [UIView] { contentView.addSubview(v) }
        contentView.accessibilityIdentifier = "native-chat-person"
    }

    required init?(coder: NSCoder) { fatalError() }

    func fill(_ p: ChatJSON, me: String) {
        let role = p["role"] as? String
        let gender = p["gender"] as? String
        face.show(url: p["avatar_url"] as? String,
                  letter: p["name"] as? String ?? "",
                  /* 남녀는 **얼굴 테두리 색**으로 가른다(웹의 `--male`·
                     `--female`). 이 두 색은 얼굴에만 쓴다. */
                  edge: gender == "f" ? UIColor(hexString: "#ef6ba8")
                      : (gender == "m" ? UIColor(hexString: "#2f8fd6") : nil),
                  size: 36)
        name.text = NativeChatRows.label(p)
        mine.isHidden = (p["id"] as? String) != me
        if let color = ChatRole.color(role) {
            /* 운영진 셋은 왕관이고 색만 다르다 — **총무는 왕관이 아니라
               `₩`다**(앱의 다른 모든 자리에서 총무는 운영진이 아니다). */
            let crown = UIImage(systemName: "crown.fill") ?? UIImage(systemName: "star.fill")
            mark.image = role == "treasurer" ? UIImage(systemName: "wonsign") : crown
            mark.backgroundColor = color
            mark.isHidden = false
            mark.accessibilityLabel = ChatRole.label(role)
        } else {
            mark.isHidden = true
        }
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let pad: CGFloat = 16
        face.frame = CGRect(x: pad, y: 7, width: 36, height: 36)
        mark.frame = CGRect(x: face.frame.maxX - 14, y: face.frame.maxY - 14, width: 16, height: 16)
        var x = pad + 36 + 13
        if !mine.isHidden {
            let s = mine.sizeThatFits(CGSize(width: 60, height: 20))
            mine.frame = CGRect(x: x, y: (bounds.height - 18) / 2, width: s.width, height: 18)
            x += s.width + 6
        }
        name.frame = CGRect(x: x, y: 0, width: max(0, bounds.width - x - pad), height: bounds.height)
    }
}

// MARK: - 프로필은 전체화면이다

/**
 * 얼굴이나 참여자 줄을 누르면 뜬다(사용자 요청 — `프로필 누르면 사진처럼
 * 전체화면이 나오고 뒤로가기처럼 아래로 내리면 사라지게해줘`).
 *
 * **아래에서 올라오는 작은 카드로 되돌리지 말 것** — 100명 방에서 얼굴을
 * 누르는 까닭은 `83/신성호/광산구`만 보고는 누군지 안 떠올라서인데,
 * 사진이 작게 뜨면 그 물음에 답이 안 된다.
 */
final class ChatProfile: UIView {

    /// 이만큼 내리면 닫힌다(웹의 `SHEET_CLOSE`).
    private static let close: CGFloat = 120
    /// **거리 없이 빠르기만 보지 않는다**(웹의 `SHEET_FLICK_MIN`) — 손끝이
    /// 조금 미끄러진 것까지 닫힘으로 읽히면 사진을 들여다볼 수가 없다.
    private static let flickMin: CGFloat = 40

    var onClose: (() -> Void)?
    var onMention: ((String) -> Void)?

    private let back = UIView()
    private let sheet = UIView()
    private let photo = UIImageView()
    private let letter = UILabel()
    private let foot = UIView()
    private let name = UILabel()
    private let role = PadLabel()
    private let extra = UILabel()
    private let mention = UIButton(type: .system)
    private let closeBtn = UIButton(type: .system)
    private var who = ""

    override init(frame: CGRect) {
        super.init(frame: frame)
        back.backgroundColor = .black
        addSubview(back)
        sheet.backgroundColor = UIColor(white: 0.07, alpha: 1)
        sheet.clipsToBounds = true
        addSubview(sheet)

        /* **사진은 `cover`다**(카톡과 같다) — 어떤 비율이 올지 모른다.
           없는 사람은 얼굴에 쓰는 그 두 글자를 크게 놓는다. */
        photo.contentMode = .scaleAspectFill
        photo.clipsToBounds = true
        letter.textAlignment = .center
        letter.textColor = UIColor(white: 1, alpha: 0.5)
        letter.font = .systemFont(ofSize: 72, weight: .semibold)

        foot.backgroundColor = UIColor(white: 0, alpha: 0.45)
        name.textColor = .white
        name.font = .systemFont(ofSize: 20, weight: .bold)
        name.numberOfLines = 2
        /* **색만으로 가르지 않는다** — 직책 이름을 글자로 적는다(얼굴
           테두리의 남녀 구분과 같은 잣대다). **그 글자표는 그대로 둘 것.** */
        role.textColor = .white
        role.font = .systemFont(ofSize: 12, weight: .bold)
        role.layer.cornerRadius = 10
        role.layer.masksToBounds = true
        extra.textColor = UIColor(white: 1, alpha: 0.75)
        extra.font = .systemFont(ofSize: 14)

        /* **분홍을 안 쓴다** — 이 화면에서 '지금 눌러야 할 것'은 보내기
           단추 하나다(크게 본 사진의 흰 알약과 같은 값이다). */
        mention.setTitle("@언급하기", for: .normal)
        mention.setTitleColor(.white, for: .normal)
        mention.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
        mention.backgroundColor = UIColor(white: 1, alpha: 0.3)
        mention.layer.cornerRadius = 22
        mention.addTarget(self, action: #selector(mentionTapped), for: .touchUpInside)

        /* **`✕`는 왼쪽 위다**(카톡과 같다) — 화면을 통째로 차지하는 창이다. */
        closeBtn.setImage(UIImage(systemName: "xmark"), for: .normal)
        closeBtn.tintColor = .white
        closeBtn.accessibilityLabel = "닫기"
        closeBtn.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)

        /* 두 글자는 **사진 밑에** 둔다 — 사진이 오면 그대로 덮는다. */
        for v in [letter, photo, foot, name, role, extra, mention, closeBtn] as [UIView] {
            sheet.addSubview(v)
        }
        let pan = UIPanGestureRecognizer(target: self, action: #selector(dragged(_:)))
        sheet.addGestureRecognizer(pan)
        isHidden = true
    }

    required init?(coder: NSCoder) { fatalError() }

    @objc private func closeTapped() { onClose?() }
    @objc private func mentionTapped() { onMention?(who) }

    /// `attend`는 **운영진에게만** 적는 `올해 N회`다 — 모르면 안 적는다
    /// (0으로 적으면 모두가 `올해 0회`가 되어 거짓말이 된다).
    func show(_ p: ChatJSON, attend: Int?) {
        fill(p, attend: attend)
        isHidden = false
        setNeedsLayout()
        layoutIfNeeded()
        back.alpha = 0
        sheet.transform = CGAffineTransform(translationX: 0, y: bounds.height)
        UIView.animate(withDuration: 0.24, delay: 0, options: [.curveEaseOut]) {
            self.back.alpha = 1
            self.sheet.transform = .identity
        }
    }

    /// 참석 횟수만 뒤늦게 적는다 — **다시 띄우지 않는다**(그러면 뜨는
    /// 연출이 한 번 더 돌아 창이 아래에서 다시 올라온다).
    func setAttend(_ n: Int?) {
        extra.text = n.map { "올해 \($0)회" } ?? ""
        extra.isHidden = n == nil
        setNeedsLayout()
    }

    private func fill(_ p: ChatJSON, attend: Int?) {
        who = p["name"] as? String ?? ""
        name.text = NativeChatRows.label(p)
        let r = p["role"] as? String
        let label = ChatRole.label(r)
        role.text = label
        role.isHidden = label.isEmpty
        /* **직책표만 칠이 된다** — 명단의 직책 색은 흰 바탕에서 읽히라고
           낮춰 둔 값이라 사진 위에서 죽는다. 색은 명단이 정한 것을
           그대로 물려받고 글자만 흰색으로 뒤집는다. */
        role.backgroundColor = ChatRole.color(r) ?? UIColor(white: 1, alpha: 0.25)
        extra.text = attend.map { "올해 \($0)회" } ?? ""
        extra.isHidden = attend == nil
        letter.text = String((p["name"] as? String ?? "?").suffix(2))
        photo.image = nil
        photo.isHidden = true
        if let url = p["avatar_url"] as? String, !url.isEmpty {
            ImageStore.shared.load(url) { [weak self] shot in
                guard let self = self, let img = shot?.first else { return }
                self.photo.image = img
                self.photo.isHidden = false
            }
        }
    }

    func hide() {
        isHidden = true
        sheet.transform = .identity
        back.alpha = 1
    }

    /**
     * 아래로 끌면 손가락을 따라온다(뒤로 가기 손짓과 같은 결).
     * **위로는 1/3만 따라간다** — 갈 데가 없으니 벽에 닿은 느낌만 준다.
     * **자리를 상태로 두지 않는다** — 매 프레임 다시 그리면 느린 폰에서
     * 그대로 끊긴다. `transform`과 `opacity`만 움직인다.
     */
    @objc private func dragged(_ g: UIPanGestureRecognizer) {
        let dy = g.translation(in: self).y
        switch g.state {
        case .changed:
            let d = dy >= 0 ? dy : dy / 3
            sheet.transform = CGAffineTransform(translationX: 0, y: d)
            /* **바탕만 걷힌다** — 사진째 흐려지면 '치우는 중'이 아니라
               '꺼지는 중'으로 보인다. */
            back.alpha = max(0, 1 - max(0, d) / bounds.height)
        case .ended, .cancelled, .failed:
            let vy = g.velocity(in: self).y
            let go = dy > Self.close || (vy > 900 && dy > Self.flickMin)
            if go {
                UIView.animate(withDuration: 0.2, animations: {
                    self.sheet.transform = CGAffineTransform(translationX: 0, y: self.bounds.height)
                    self.back.alpha = 0
                }, completion: { _ in self.onClose?() })
            } else {
                UIView.animate(withDuration: 0.2) {
                    self.sheet.transform = .identity
                    self.back.alpha = 1
                }
            }
        default:
            break
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        back.frame = bounds
        sheet.frame = bounds
        photo.frame = bounds
        letter.frame = bounds
        closeBtn.frame = CGRect(x: 4, y: safeAreaInsets.top + 4, width: 44, height: 44)
        let pad: CGFloat = 20
        let bottom = safeAreaInsets.bottom
        let h: CGFloat = 168 + bottom
        foot.frame = CGRect(x: 0, y: bounds.height - h, width: bounds.width, height: h)
        var y = foot.frame.minY + 20
        name.frame = CGRect(x: pad, y: y, width: bounds.width - pad * 2, height: 28)
        y += 32
        if !role.isHidden {
            let s = role.sizeThatFits(CGSize(width: 200, height: 24))
            role.frame = CGRect(x: pad, y: y, width: s.width, height: 20)
        }
        if !extra.isHidden {
            extra.frame = CGRect(x: role.isHidden ? pad : role.frame.maxX + 10, y: y,
                                 width: bounds.width - pad * 2, height: 20)
        }
        y += 30
        mention.frame = CGRect(x: pad, y: y, width: bounds.width - pad * 2, height: 44)
    }
}

// MARK: - @언급 목록

/**
 * 글칸에 `@`를 치면 **입력칸 바로 위에 뜨는 흰 카드**다.
 *
 * **값은 웹의 `.mention-list`와 같다** — 흰 바탕 · 테두리 · 둥근 모서리 ·
 * 줄 사이 선 · 왼쪽 정렬 · **여섯 명까지 보이고 그 위는 굴려서 본다.**
 * 앱이 그리는 자리라 웹 CSS가 안 닿으므로 여기에 같은 값을 적어 둔다 —
 * **한쪽만 고치지 말 것.**
 *
 * **바탕을 안 깔면 고장 난 것처럼 보인다**(사용자 제보 — `언급할때
 * 정상적으로 안나옴`). 처음에는 바탕도 테두리도 없는 파란 글자 셋이
 * 보라 목록 위에 그냥 떠 있었다.
 *
 * `@전체`는 **운영진만** 쓰고, 서른 명의 폰을 한꺼번에 울리는 일이라
 * 무엇을 하는 것인지 옆에 적는다(웹의 `.mention-item.is-all`과 같다).
 * **그림글자를 쓰지 말 것** — 기기에 없으면 네모난 두부가 된다.
 *
 * **카드 뒤는 대화 바탕색(보라)이다**(사용자 요청 — `@눌러서 회원목록뜰때
 * 목록뒤에 뒷배경 삭제해줘`). 이 칸은 아무 칠도 안 하고 있어 **화면
 * 바탕(크림색)이 그대로 비쳤고**, 보라 목록과 입력칸 사이에 밝은 판이
 * 하나 더 깔린 것처럼 보였다 — 웹에서 `.chat-over`를 보라로 칠해 없앤 그
 * 자리와 같다(`언급 기능 사용할 때 … 뒷면에 배경화면 같은 게 하나 있는데`).
 * **`backgroundColor`를 지우지 말 것.**
 *
 * **여럿을 이어 고를 수 있다**(사용자 요청 — `@눌러서 회원선택시
 * 다중선택기능 넣어줘`). 고른 뒤에도 목록이 남고 이미 넣은 사람 옆에는
 * 체크가 붙는다 — 닫는 것은 **글자를 한 자 치면** 저절로 된다.
 */
final class MentionList: UIView {
    /// 여섯 명까지 보이고 그 위는 굴린다(웹과 같은 값).
    private static let maxRows = 6
    private static let rowH: CGFloat = 44
    /// 카드와 입력칸 사이(웹 `.chat-over`의 `gap`).
    private static let gapBottom: CGFloat = 6
    /// 좌우 여백 — 화면 끝에 닿아 보이지 않게 둔다.
    private static let padSide: CGFloat = 10

    /**
     * 한 줄 — **보이는 것은 이름표, 넣는 것은 닉네임이다**(사용자 요청 —
     * `언급했을때 나오는 닉네임이 다르게나와. 회원목록에있는거처럼 해줘`).
     *
     * 100명 모임에서 `@악마제리`만 봐서는 누군지 모른다는 것이 이 요청의
     * 까닭이고, 그래서 목록은 회원 명단·서랍과 같은 `83/악마제리/광산구`를
     * 적는다. **글에 들어가는 것은 그대로 닉네임이다** — 알림 발송기
     * (`supabase/functions/notify`의 `mentionedIds`)가 글에서 `@<닉네임>`을
     * 찾아 누구를 부른 것인지 가리므로, 이름표를 넣으면 **부르긴 했는데
     * 알림이 안 가는** 글이 된다.
     */
    struct Item {
        let name: String
        let label: String
    }

    var onPick: ((String) -> Void)?
    private let card = UIView()
    private let scroll = UIScrollView()
    private let rows = UIStackView()
    private var boxH: NSLayoutConstraint!
    /// 이미 글에 넣은 이름 — 그 줄에만 체크가 붙는다.
    private var picked: Set<String> = []
    /// 이름 색 — `@전체`만 분홍이다(그 줄이 하는 일이 다르기 때문이다).
    var cText: UIColor = UIColor(hexString: "#1b1f19") ?? .label
    var cDim: UIColor = UIColor(hexString: "#5b6455") ?? .secondaryLabel
    var cBrand: UIColor = UIColor(red: 0.91, green: 0.29, blue: 0.50, alpha: 1)

    override init(frame: CGRect) {
        super.init(frame: frame)
        isHidden = true
        /* 카드 뒤는 **대화 바탕색**이다 — 위 머리말의 `뒷배경` 꼭지를 볼 것. */
        backgroundColor = ChatSkin().bg
        card.backgroundColor = .white
        card.layer.cornerRadius = 12
        card.layer.borderWidth = 1
        card.layer.borderColor = UIColor(white: 0, alpha: 0.10).cgColor
        card.layer.shadowColor = UIColor.black.cgColor
        card.layer.shadowOpacity = 0.10
        card.layer.shadowRadius = 10
        card.layer.shadowOffset = CGSize(width: 0, height: 4)
        scroll.clipsToBounds = true
        scroll.layer.cornerRadius = 12
        scroll.showsVerticalScrollIndicator = false
        rows.axis = .vertical
        for v in [card, scroll, rows] as [UIView] { v.translatesAutoresizingMaskIntoConstraints = false }
        addSubview(card); card.addSubview(scroll); scroll.addSubview(rows)
        boxH = heightAnchor.constraint(equalToConstant: 0)
        NSLayoutConstraint.activate([
            boxH,
            card.topAnchor.constraint(equalTo: topAnchor),
            card.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -Self.gapBottom),
            card.leadingAnchor.constraint(equalTo: leadingAnchor, constant: Self.padSide),
            card.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -Self.padSide),
            scroll.topAnchor.constraint(equalTo: card.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: card.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: card.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: card.trailingAnchor),
            rows.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            rows.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
            rows.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
            rows.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
            rows.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor),
        ])
    }
    required init?(coder: NSCoder) { fatalError() }

    /// 아무도 없으면 칸째 사라진다 — 빈 카드가 남으면 안 된다.
    func show(_ items: [Item], picked: Set<String> = []) {
        self.picked = picked
        rows.arrangedSubviews.forEach { $0.removeFromSuperview() }
        let shown = Array(items.prefix(30))
        for (i, item) in shown.enumerated() {
            if i > 0 {
                let line = UIView()
                line.backgroundColor = UIColor(white: 0, alpha: 0.08)
                line.heightAnchor.constraint(equalToConstant: 1).isActive = true
                rows.addArrangedSubview(line)
            }
            rows.addArrangedSubview(row(item))
        }
        isHidden = shown.isEmpty
        boxH.constant = shown.isEmpty ? 0
            : CGFloat(min(shown.count, Self.maxRows)) * Self.rowH + Self.gapBottom
        scroll.setContentOffset(.zero, animated: false)
    }

    func clear() { show([]) }

    private func row(_ item: Item) -> UIButton {
        let name = item.name
        let b = UIButton(type: .system)
        var cfg = UIButton.Configuration.plain()
        cfg.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: 13, bottom: 0, trailing: 13)
        let all = name == ChatMentions.all
        /* 이름표가 길어졌으므로(`83/신성호 법인/광산구`) 넘치면 끝을 자른다 —
           줄 높이가 44px로 못박혀 있어 접히면 글자가 통째로 밀린다. */
        cfg.titleLineBreakMode = .byTruncatingTail
        let title = NSMutableAttributedString(string: "@\(item.label)", attributes: [
            .font: UIFont.systemFont(ofSize: 15, weight: .bold),
            .foregroundColor: all ? cBrand : cText,
        ])
        if all {
            title.append(NSAttributedString(string: "   모두에게 알림", attributes: [
                .font: UIFont.systemFont(ofSize: 12),
                .foregroundColor: cDim,
            ]))
        }
        cfg.attributedTitle = AttributedString(title)
        /* 이미 넣은 사람에게는 **체크가 붙는다** — 여럿을 이어 고르는
           자리라 누구를 이미 불렀는지 목록만 봐서는 알 수 없다.
           **그림글자가 아니라 SF Symbol이다**(없는 기기에서 두부가 된다). */
        if picked.contains(name) {
            cfg.image = UIImage(systemName: "checkmark", withConfiguration:
                UIImage.SymbolConfiguration(pointSize: 13, weight: .bold))
            cfg.imagePlacement = .trailing
            cfg.imagePadding = 8
        }
        b.configuration = cfg
        b.tintColor = cDim
        b.contentHorizontalAlignment = .leading
        b.heightAnchor.constraint(equalToConstant: Self.rowH).isActive = true
        b.accessibilityIdentifier = "native-chat-mention"
        b.addAction(UIAction { [weak self] _ in self?.onPick?(name) }, for: .touchUpInside)
        return b
    }
}

// MARK: - 검색 — 찾은 글 사이를 오가는 바

/**
 * 🔍를 누르면 **입력칸 자리에 서는 바**다(사용자 요청 — `검색 눌렀을때
 * 카톡처럼 나오게해줘` · 카톡 사진을 받아 맞췄다).
 *
 * **찾은 것을 목록으로 덮지 않는다 — 대화가 그대로 보인다.** 예전에는
 * 화면을 통째로 덮는 목록창이었는데, 카톡은 **찾은 글로 곧장 옮겨 주고**
 * 이 바의 `^`(더 지난 것) · `⌄`(더 최근 것)로 그 사이를 오간다.
 * 그래서 앞뒤 대화를 보면서 되짚을 수 있다.
 *
 * 값은 카톡 사진에서 잰 것이다 — 바는 옅은 라벤더 알약(`ReplyBox.tint`),
 * 동그라미는 **흰색 36**이고 그림은 SF Symbol이다(**그림글자를 쓰지 말 것**).
 * 몇 번째인지(`3 / 12`)는 카톡에 없지만 우리는 적는다 — 없으면 끝까지
 * 갔는지 알 길이 없어 같은 자리를 되풀이해 누르게 된다.
 */
final class FindBar: UIView {
    var onUp: (() -> Void)?
    var onDown: (() -> Void)?
    private let bar = UIView()
    private let count = UILabel()
    private let up = UIButton(type: .system)
    private let down = UIButton(type: .system)

    override init(frame: CGRect) {
        super.init(frame: frame)
        isHidden = true
        backgroundColor = ChatSkin().bg
        bar.backgroundColor = ReplyBox.tint
        bar.layer.cornerRadius = 24
        bar.layer.cornerCurve = .continuous
        count.font = .systemFont(ofSize: 14, weight: .medium)
        count.textColor = UIColor(red: 0x32 / 255, green: 0x30 / 255, blue: 0x3b / 255, alpha: 1)
        circle(up, "chevron.up", "더 지난 것", "native-find-up") { [weak self] in self?.onUp?() }
        circle(down, "chevron.down", "더 최근 것", "native-find-down") { [weak self] in self?.onDown?() }
        for v in [bar, count, up, down] as [UIView] { v.translatesAutoresizingMaskIntoConstraints = false }
        addSubview(bar); bar.addSubview(count); bar.addSubview(up); bar.addSubview(down)
        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: topAnchor, constant: 6),
            bar.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -6),
            bar.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 10),
            bar.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -10),
            bar.heightAnchor.constraint(equalToConstant: 48),
            count.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 18),
            count.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            down.trailingAnchor.constraint(equalTo: bar.trailingAnchor, constant: -6),
            down.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            down.widthAnchor.constraint(equalToConstant: 36),
            down.heightAnchor.constraint(equalToConstant: 36),
            up.trailingAnchor.constraint(equalTo: down.leadingAnchor, constant: -6),
            up.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            up.widthAnchor.constraint(equalToConstant: 36),
            up.heightAnchor.constraint(equalToConstant: 36),
        ])
    }
    required init?(coder: NSCoder) { fatalError() }

    /// `at`은 1부터 센다. 찾은 것이 없으면 `0`을 준다.
    func set(at: Int, of n: Int, hint: String) {
        count.text = n > 0 ? "\(at) / \(n)" : hint
        up.isEnabled = at < n
        down.isEnabled = at > 1
        up.alpha = up.isEnabled ? 1 : 0.4
        down.alpha = down.isEnabled ? 1 : 0.4
    }

    private func circle(_ b: UIButton, _ symbol: String, _ label: String, _ id: String, _ tap: @escaping () -> Void) {
        b.setImage(UIImage(systemName: symbol, withConfiguration:
            UIImage.SymbolConfiguration(pointSize: 15, weight: .semibold)), for: .normal)
        b.tintColor = UIColor(red: 0x32 / 255, green: 0x30 / 255, blue: 0x3b / 255, alpha: 1)
        b.backgroundColor = .white
        b.layer.cornerRadius = 18
        b.accessibilityLabel = label
        b.accessibilityIdentifier = id
        b.addAction(UIAction { _ in tap() }, for: .touchUpInside)
    }
}

// MARK: - 댓글(답장) 입력칸

/**
 * 말풍선을 왼쪽으로 밀어 **댓글을 달 때 입력칸 위에 물리는 카드**다
 * (사용자 요청 — `말풍선을 왼쪽으로 밀어서 댓글달때 카톡처럼해줘` ·
 * 카톡 사진을 받아 픽셀로 맞췄다).
 *
 * **예전에는 `댓글 · 입맛이 없어서 ㅋ    ✕` 한 줄짜리 단추였다 —
 * 되돌리지 말 것.** 누구에게 다는 것인지가 글 안에 묻혀 있었고, 원문으로
 * 가 볼 길도 없었다.
 *
 * ```
 * ┌───────────────────────────────────────┐
 * │ 신성호에게 댓글                  (↳) (✕) │  ← 굵은 이름 · 동그란 단추 둘
 * │ 입맛이 없어서 ㅋ                        │  ← 원문 한 줄(말줄임)
 * └───────────────────────────────────────┘
 * ```
 *
 * **잰 값**(1206×2622 · 배율 3.0): 카드 좌우 여백 30px → 10 ·
 * 모서리 54px → 18 · 칠 `#b0a5e5`(보라 위의 옅은 라벤더) ·
 * 동그라미 72px → 24, 사이 49px → 16, 오른쪽 36px → 12.
 * **눈대중으로 고치지 말 것.**
 *
 * - **이름은 닉네임 그대로다**(`83/신성호/광산구`가 아니라) — 문장에
 *   가까운 줄이라 긴 이름표는 목록의 이름 자리 몫이다(웹의 인용과 같다).
 * - **말은 `댓글`이다** — 길게 누른 창의 줄 · 말풍선 머리말과 같은 글자다.
 * - `↳`는 **원문으로 간다**(웹에서 인용을 누르면 가는 그 자리다),
 *   `✕`는 댓글 달기를 그만둔다.
 * - **그림글자를 쓰지 말 것** — SF Symbol이다.
 */
final class ReplyBox: UIView {
    var onJump: (() -> Void)?
    var onClose: (() -> Void)?
    /// 카톡에서 뽑은 옅은 라벤더. 대화 바탕(`#7369a0`)이 같은 값이라
    /// 그 위에 그대로 얹힌다.
    static let tint = UIColor(red: 0xb0 / 255, green: 0xa5 / 255, blue: 0xe5 / 255, alpha: 1)
    private static let btn: CGFloat = 24
    private let card = UIView()
    private let who = UILabel()
    private let quote = UILabel()

    override init(frame: CGRect) {
        super.init(frame: frame)
        isHidden = true
        backgroundColor = ChatSkin().bg
        card.backgroundColor = Self.tint
        card.layer.cornerRadius = 18
        card.layer.cornerCurve = .continuous
        who.font = .systemFont(ofSize: 14, weight: .bold)
        who.textColor = UIColor(red: 0x1b / 255, green: 0x1f / 255, blue: 0x19 / 255, alpha: 1)
        who.lineBreakMode = .byTruncatingTail
        quote.font = .systemFont(ofSize: 13.5)
        quote.textColor = UIColor(white: 0, alpha: 0.6)
        quote.lineBreakMode = .byTruncatingTail
        let jump = circleBtn("arrow.turn.down.left", "원문 보기", "native-reply-jump") { [weak self] in self?.onJump?() }
        let close = circleBtn("xmark", "댓글 취소", "native-reply-close") { [weak self] in self?.onClose?() }
        for v in [card, who, quote, jump, close] as [UIView] { v.translatesAutoresizingMaskIntoConstraints = false }
        addSubview(card); card.addSubview(who); card.addSubview(quote)
        card.addSubview(jump); card.addSubview(close)
        NSLayoutConstraint.activate([
            card.topAnchor.constraint(equalTo: topAnchor),
            card.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -6),
            card.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 10),
            card.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -10),
            close.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -12),
            close.centerYAnchor.constraint(equalTo: who.centerYAnchor),
            close.widthAnchor.constraint(equalToConstant: Self.btn),
            close.heightAnchor.constraint(equalToConstant: Self.btn),
            jump.trailingAnchor.constraint(equalTo: close.leadingAnchor, constant: -16),
            jump.centerYAnchor.constraint(equalTo: who.centerYAnchor),
            jump.widthAnchor.constraint(equalToConstant: Self.btn),
            jump.heightAnchor.constraint(equalToConstant: Self.btn),
            who.topAnchor.constraint(equalTo: card.topAnchor, constant: 11),
            who.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 14),
            who.trailingAnchor.constraint(equalTo: jump.leadingAnchor, constant: -8),
            who.heightAnchor.constraint(equalToConstant: Self.btn),
            quote.topAnchor.constraint(equalTo: who.bottomAnchor, constant: 2),
            quote.leadingAnchor.constraint(equalTo: who.leadingAnchor),
            quote.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -14),
            quote.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -11),
        ])
    }
    required init?(coder: NSCoder) { fatalError() }

    func show(who name: String, text: String) {
        who.text = "\(name)에게 댓글"
        quote.text = text
        isHidden = false
    }

    /// 동그란 단추 — 칠은 카드와 같고 **테두리로만** 갈라 둔다(카톡과 같다).
    private func circleBtn(_ symbol: String, _ label: String, _ id: String, _ tap: @escaping () -> Void) -> UIButton {
        let b = UIButton(type: .system)
        b.setImage(UIImage(systemName: symbol, withConfiguration:
            UIImage.SymbolConfiguration(pointSize: 12, weight: .semibold)), for: .normal)
        b.tintColor = UIColor(red: 0x32 / 255, green: 0x30 / 255, blue: 0x3b / 255, alpha: 1)
        b.layer.cornerRadius = Self.btn / 2
        b.layer.borderWidth = 1
        b.layer.borderColor = UIColor(red: 0x9c / 255, green: 0x93 / 255, blue: 0xca / 255, alpha: 1).cgColor
        b.accessibilityLabel = label
        b.accessibilityIdentifier = id
        b.addAction(UIAction { _ in tap() }, for: .touchUpInside)
        return b
    }
}

// MARK: - 이모티콘 서랍

/**
 * **입력칸 아래, 키보드가 서던 자리에 뜬다**(카톡과 같다. 사용자 요청 —
 * `이모티콘을 누르면 전체 팝업이 뜨는데 카톡처럼 뜨게끔해줘`).
 *
 * **전체화면 창으로 되돌리지 말 것.** 화면을 통째로 덮으면 고르는 동안
 * 대화가 안 보이고, 무엇보다 **글을 마저 칠 수가 없다** — 이모티콘을
 * 골라 두고 한마디 덧붙이는 것이 이 자리의 전부다(웹의 `.sticker-tray`와
 * 같은 까닭이다).
 *
 * 값은 웹에서 그대로 옮겼다 — 높이 `min(38vh, 300px)` · 탭 줄은 위에
 * 붙어 옆으로만 굴러가고 · 그림은 **다섯 칸 격자**다.
 * **눌린 탭에 분홍을 쓰지 않는다**(이 화면에서 '지금 눌러야 할 것'은
 * 보내기 단추 하나다) — 바탕을 흰색으로 올려 종이가 앞으로 나온 것처럼 한다.
 */
final class StickerTray: UIView, UICollectionViewDataSource, UICollectionViewDelegateFlowLayout {
    /// 한 줄에 다섯 칸(웹의 `grid-template-columns: repeat(5, 1fr)`).
    private static let cols: CGFloat = 5
    private static let gap: CGFloat = 2
    private static let tabH: CGFloat = 46
    /// 서랍 높이 — 키보드만 하게 잡는다(웹의 `min(38vh, 300px)`).
    static func height(for h: CGFloat, safe: CGFloat) -> CGFloat {
        return min(300, max(180, h * 0.38)) + safe
    }

    var onPick: ((ChatJSON) -> Void)?
    private var groups: [ChatJSON] = []
    private var group = 0
    private let tabs = UIScrollView()
    private var tabBtns: [UIButton] = []
    /// 탭 한 칸 — **이름이 두 글자든 다섯 글자든 같은 폭이다.** 들쭉날쭉하면
    /// 어느 묶음을 누르는 중인지가 흐려진다(웹의 `min-width: 46px` 자리).
    private static let tabW: CGFloat = 70
    private let line = UIView()
    private let grid = UICollectionView(frame: .zero, collectionViewLayout: UICollectionViewFlowLayout())
    private var picked = ""

    override init(frame: CGRect) {
        super.init(frame: frame)
        isHidden = true
        backgroundColor = UIColor(hexString: "#eef2e6") ?? .secondarySystemBackground
        accessibilityIdentifier = "native-chat-sticker-tray"
        tabs.showsHorizontalScrollIndicator = false
        line.backgroundColor = UIColor(white: 0, alpha: 0.08)
        grid.dataSource = self; grid.delegate = self
        grid.backgroundColor = .clear
        grid.alwaysBounceVertical = true
        grid.register(NativeStickerCell.self, forCellWithReuseIdentifier: "sticker")
        addSubview(tabs); addSubview(line); addSubview(grid)
    }
    required init?(coder: NSCoder) { fatalError() }

    private var items: [ChatJSON] {
        return groups.indices.contains(group) ? groups[group]["stickers"] as? [ChatJSON] ?? [] : []
    }

    /// 묶음은 한 번만 세운다 — 열 때마다 탭을 다시 만들 이유가 없다.
    func load(_ groups: [ChatJSON]) {
        guard self.groups.isEmpty else { return }
        self.groups = groups
        for (i, g) in groups.enumerated() {
            let b = UIButton(type: .system)
            var cfg = UIButton.Configuration.plain()
            cfg.contentInsets = NSDirectionalEdgeInsets(top: 4, leading: 8, bottom: 4, trailing: 8)
            let text = NSMutableAttributedString(string: (g["tab"] as? String ?? "") + "\n", attributes: [
                .font: UIFont.systemFont(ofSize: 15),
            ])
            text.append(NSAttributedString(string: g["name"] as? String ?? "", attributes: [
                .font: UIFont.systemFont(ofSize: 10, weight: .bold),
            ]))
            let para = NSMutableParagraphStyle(); para.alignment = .center; para.lineSpacing = 1
            text.addAttribute(.paragraphStyle, value: para, range: NSRange(location: 0, length: text.length))
            cfg.attributedTitle = AttributedString(text)
            b.configuration = cfg
            b.titleLabel?.numberOfLines = 2
            b.layer.cornerRadius = 8
            b.layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
            b.titleLabel?.adjustsFontSizeToFitWidth = true
            b.titleLabel?.minimumScaleFactor = 0.8
            b.accessibilityLabel = g["name"] as? String
            b.addAction(UIAction { [weak self] _ in self?.choose(i) }, for: .touchUpInside)
            tabBtns.append(b); tabs.addSubview(b)
        }
        setNeedsLayout()
        choose(0)
    }

    private func choose(_ i: Int) {
        group = i
        for (n, b) in tabBtns.enumerated() {
            b.backgroundColor = n == i ? .white : .clear
            b.tintColor = n == i ? (UIColor(hexString: "#1b1f19") ?? .label)
                                 : (UIColor(hexString: "#5b6455") ?? .secondaryLabel)
        }
        grid.setContentOffset(.zero, animated: false)
        grid.reloadData()
    }

    /// 골라 둔 것 — 서랍에서도 어느 것을 골랐는지 보여야 다른 것으로
    /// 바꿀 때 헤매지 않는다(웹의 `.sticker-btn.on`).
    func mark(_ id: String) {
        picked = id
        if !isHidden { grid.reloadData() }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        tabs.frame = CGRect(x: 0, y: 0, width: bounds.width, height: Self.tabH)
        for (i, b) in tabBtns.enumerated() {
            b.frame = CGRect(x: 4 + CGFloat(i) * (Self.tabW + 2), y: 3,
                             width: Self.tabW, height: Self.tabH - 3)
        }
        tabs.contentSize = CGSize(width: CGFloat(tabBtns.count) * (Self.tabW + 2) + 8, height: Self.tabH)
        line.frame = CGRect(x: 0, y: Self.tabH, width: bounds.width, height: 1)
        grid.frame = CGRect(x: 0, y: Self.tabH + 1, width: bounds.width,
                            height: max(0, bounds.height - Self.tabH - 1))
        grid.contentInset = UIEdgeInsets(top: 6, left: 6, bottom: safeAreaInsets.bottom + 6, right: 6)
    }

    func collectionView(_ c: UICollectionView, numberOfItemsInSection section: Int) -> Int { items.count }
    func collectionView(_ c: UICollectionView, cellForItemAt i: IndexPath) -> UICollectionViewCell {
        let cell = c.dequeueReusableCell(withReuseIdentifier: "sticker", for: i) as! NativeStickerCell
        let item = items[i.item]
        cell.show(item, compact: true)
        cell.contentView.backgroundColor = (item["id"] as? String) == picked
            ? UIColor(red: 0.91, green: 0.29, blue: 0.50, alpha: 0.14) : .clear
        cell.contentView.layer.cornerRadius = 8
        return cell
    }
    func collectionView(_ c: UICollectionView, didSelectItemAt i: IndexPath) {
        let item = items[i.item]
        mark(item["id"] as? String ?? "")
        onPick?(item)
    }
    func collectionView(_ c: UICollectionView, layout: UICollectionViewLayout,
                        sizeForItemAt i: IndexPath) -> CGSize {
        let inner = grid.bounds.width - 12 - Self.gap * (Self.cols - 1)
        let w = max(40, floor(inner / Self.cols))
        return CGSize(width: w, height: w)
    }
    func collectionView(_ c: UICollectionView, layout: UICollectionViewLayout,
                        minimumInteritemSpacingForSectionAt section: Int) -> CGFloat { Self.gap }
    func collectionView(_ c: UICollectionView, layout: UICollectionViewLayout,
                        minimumLineSpacingForSectionAt section: Int) -> CGFloat { Self.gap }
}

// MARK: - 사진·동영상 다 보기 (더보기)

/**
 * 서랍의 `더보기`가 여는 화면 — **올린 사진·동영상을 격자로 모아 본다.**
 *
 * **오래 비어 있던 자리다.** 서랍의 가로 줄은 마지막 서른 장만 보여 주고
 * (통신량 규칙), 그보다 앞엣것을 되짚으려면 **대화를 위로 계속 올리는 것
 * 말고 길이 없었다**(🔍는 글자만 찾는다). 그래서 머리말도 `최근 사진`
 * 이었는데, 이 화면이 생기면서 `최근`을 뗐다.
 *
 * - **한 번에 다 안 받는다**(`page`). 아래로 내려가 끝에 닿을 때마다
 *   그만큼 더 받아 온다 — 1년치 사진 주소를 한꺼번에 받을 이유가 없다.
 * - **조각은 `ChatThumb`을 그대로 쓴다** — 지워진 사진을 가리는 잣대
 *   (HTTP 400·404만 `gone`)가 서랍과 갈리면 안 된다.
 * - **누르면 앱 안에서 크게 뜬다**(서랍과 같은 `onPhoto`). 이 화면은
 *   안 닫는다 — 닫으면 사진을 닫았을 때 돌아올 데가 없다.
 * - **화면을 통째로 덮는다**(서랍 위에 얹힌다). 서랍은 그대로 열려 있어
 *   `닫기`를 누르면 그 자리로 돌아온다.
 */
final class ChatGallery: UIView, UICollectionViewDataSource, UICollectionViewDelegate,
                         UICollectionViewDelegateFlowLayout {

    /// 한 줄에 몇 칸인가. 조각이 클수록 통이 바빠지므로 셋으로 둔다.
    private static let cols: CGFloat = 3
    private static let gap: CGFloat = 2

    var onClose: (() -> Void)?
    var onPhoto: ((String) -> Void)?
    /// 끝에 닿았다 — 더 받아 올 것이 있으면 받아 온다.
    var onMore: (() -> Void)?

    private let head = UIView()
    private let closeBtn = UIButton(type: .system)
    private let title = UILabel()
    private let spin = UIActivityIndicatorView(style: .medium)
    private let empty = UILabel()
    private let grid: UICollectionView

    private var items: [(id: String, url: String)] = []
    private var hasMore = false
    /// 지워진 것 — **참·거짓이 아니라 그 글의 id다**(서랍의 `gone`과 같다).
    private var gone: Set<String> = []

    override init(frame: CGRect) {
        let layout = UICollectionViewFlowLayout()
        layout.minimumLineSpacing = Self.gap
        layout.minimumInteritemSpacing = Self.gap
        grid = UICollectionView(frame: .zero, collectionViewLayout: layout)
        super.init(frame: frame)

        backgroundColor = .systemBackground

        head.backgroundColor = .systemBackground
        addSubview(head)

        closeBtn.setTitle("닫기", for: .normal)
        closeBtn.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
        closeBtn.accessibilityIdentifier = "native-chat-gallery-close"
        closeBtn.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        head.addSubview(closeBtn)

        title.text = "사진·동영상"
        title.font = .systemFont(ofSize: 17, weight: .bold)
        title.textColor = .label
        head.addSubview(title)

        grid.backgroundColor = .systemBackground
        grid.dataSource = self
        grid.delegate = self
        grid.alwaysBounceVertical = true
        grid.register(GalleryCell.self, forCellWithReuseIdentifier: "shot")
        grid.accessibilityIdentifier = "native-chat-gallery"
        addSubview(grid)

        spin.hidesWhenStopped = true
        addSubview(spin)

        empty.text = "아직 올린 사진이 없습니다."
        empty.font = .systemFont(ofSize: 14)
        empty.textColor = .secondaryLabel
        empty.textAlignment = .center
        empty.isHidden = true
        addSubview(empty)

        isHidden = true
    }

    required init?(coder: NSCoder) { fatalError() }

    @objc private func closeTapped() { onClose?() }

    func show() {
        isHidden = false
        if items.isEmpty { spin.startAnimating() }
        setNeedsLayout()
    }

    func hide() { isHidden = true }

    /// 받아 온 것을 그린다. **지워진 것은 그 자리에서 뺀다.**
    func setPhotos(_ list: [(id: String, url: String)], more: Bool) {
        items = list.filter { !gone.contains($0.id) }
        hasMore = more
        spin.stopAnimating()
        empty.isHidden = !items.isEmpty
        grid.reloadData()
    }

    private func dropPhoto(_ id: String) {
        guard !gone.contains(id) else { return }
        gone.insert(id)
        /* **다시 그리는 것은 다음 차례로 미룬다** — 그리는 도중에 또
           그리면 서로를 물고 돈다(서랍과 같은 자리다). */
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.items.removeAll { $0.id == id }
            self.empty.isHidden = !self.items.isEmpty
            self.grid.reloadData()
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let top = safeAreaInsets.top
        head.frame = CGRect(x: 0, y: 0, width: bounds.width, height: top + 52)
        closeBtn.frame = CGRect(x: 8, y: top + 4, width: 60, height: 44)
        title.frame = CGRect(x: 76, y: top + 4, width: max(0, bounds.width - 88), height: 44)
        grid.frame = CGRect(x: 0, y: head.frame.maxY, width: bounds.width,
                            height: max(0, bounds.height - head.frame.maxY))
        grid.contentInset = UIEdgeInsets(top: Self.gap, left: 0,
                                         bottom: safeAreaInsets.bottom + Self.gap, right: 0)
        spin.center = CGPoint(x: bounds.midX, y: bounds.midY)
        empty.frame = CGRect(x: 16, y: bounds.midY - 12, width: bounds.width - 32, height: 24)
    }

    func collectionView(_ c: UICollectionView, numberOfItemsInSection section: Int) -> Int { items.count }

    func collectionView(_ c: UICollectionView, cellForItemAt i: IndexPath) -> UICollectionViewCell {
        let cell = c.dequeueReusableCell(withReuseIdentifier: "shot", for: i) as! GalleryCell
        let item = items[i.item]
        cell.show(id: item.id, url: item.url) { [weak self] id in self?.dropPhoto(id) }
        /* **끝이 가까우면 더 받아 온다** — 바닥에 닿고 나서 부르면 그때부터
           기다리게 된다. */
        if hasMore, i.item >= items.count - Int(Self.cols) * 2 { onMore?() }
        return cell
    }

    func collectionView(_ c: UICollectionView, didSelectItemAt i: IndexPath) {
        c.deselectItem(at: i, animated: false)
        onPhoto?(items[i.item].url)
    }

    func collectionView(_ c: UICollectionView, layout: UICollectionViewLayout,
                        sizeForItemAt i: IndexPath) -> CGSize {
        let inner = grid.bounds.width - Self.gap * (Self.cols - 1)
        let w = max(40, floor(inner / Self.cols))
        return CGSize(width: w, height: w)
    }
}

/// 격자 한 칸 — 안에 `ChatThumb`을 그대로 앉힌다(지워진 것을 가리는
/// 잣대를 서랍과 하나로 두려는 것이다).
final class GalleryCell: UICollectionViewCell {
    private var thumb: ChatThumb?

    func show(id: String, url: String, gone: @escaping (String) -> Void) {
        if thumb?.id != id {
            thumb?.removeFromSuperview()
            let t = ChatThumb(id: id, url: url)
            /* 격자에서는 조각마다 모서리를 안 깎는다 — 카톡·밴드의 그
               화면도 칸이 맞닿은 네모다. */
            t.layer.cornerRadius = 0
            t.isUserInteractionEnabled = false
            contentView.addSubview(t)
            thumb = t
            t.onGone = gone
            t.load()
        }
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        thumb?.frame = contentView.bounds
    }
}
