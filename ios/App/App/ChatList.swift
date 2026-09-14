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

/// 말풍선 아래 붙는 반응 알약 하나(`😄 2`).
struct ChatReact {
    let emoji: String
    let n: Int
    /// 내가 누른 것인가 — 그것만 분홍 테두리로 갈라 둔다.
    let mine: Bool
}

struct ChatRow {
    enum Kind {
        case text       // 말풍선
        case system     // 가운데 안내 줄
        case photo      // 사진 (말풍선 없음)
        case sticker    // 이모티콘 (말풍선 없음 · 118px 붙박이)
        case card       // 눌러서 들어가는 안내 카드(라운드·투표·공지)
        case other      // 아직 안 그리는 것 — 자리만 잡는다
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
    /// 사진·이모티콘 그림 주소. **이모티콘은 웹이 `stickerSrc()`로 만들어 준다** —
    /// 글에 남는 값은 `sticker:<id>`이고 주소 짓는 규칙은 웹에만 있다.
    let image: String?
    /// 사진·이모티콘 **아래에 붙는 한 줄**(함께 보낸 글). 웹의 `.chat-cap`이다.
    let cap: String?
    /// 이모지만 보낸 글 — 말풍선을 벗기고 크게 그린다(`lib/emoji.ts`가 가른다).
    let big: Bool
    /// 눌리는 카드의 아랫줄(`라운드 보러 가기 ›`).
    let go: String?
    /// 그 카드가 가는 곳(`/rounds/r1`). 누르면 웹에 그대로 넘긴다.
    let to: String?
    /// 인용(답장)의 머리말(`박승수에게 댓글`). 없으면 인용이 없는 줄이다.
    let quoteWho: String?
    /// 인용의 원문 **한 줄**. 웹이 이미 잘라서 준다(가린 글은 `가려진 메시지`).
    let quoteText: String?
    /// 말풍선 아래 반응 알약. 비어 있으면 **줄 자체를 안 그린다**.
    let reacts: [ChatReact]
    /// 이 줄 **위에** `여기까지 읽으셨습니다`를 긋는가.
    let mark: Bool

    init?(_ d: [String: Any]) {
        guard let id = d["id"] as? String else { return nil }
        self.id = id
        switch d["kind"] as? String {
        case "system": kind = .system
        case "text": kind = .text
        case "photo": kind = .photo
        case "sticker": kind = .sticker
        case "card": kind = .card
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
        image = d["image"] as? String
        cap = d["cap"] as? String
        big = (d["big"] as? Bool) ?? false
        go = d["go"] as? String
        to = d["to"] as? String
        quoteWho = d["quoteWho"] as? String
        quoteText = d["quoteText"] as? String
        mark = (d["mark"] as? Bool) ?? false
        reacts = ((d["reacts"] as? [[String: Any]]) ?? []).compactMap {
            guard let e = $0["emoji"] as? String else { return nil }
            return ChatReact(emoji: e, n: ($0["n"] as? Int) ?? 0,
                             mine: ($0["mine"] as? Bool) ?? false)
        }
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
    /// 카드의 `보러 가기 ›` 한 줄. 잔디 초록(`--grass`)이다 — 좋은 상태 몫이고,
    /// **분홍을 쓰지 말 것**(이 화면에서 '지금 눌러야 할 것'은 보내기 하나다).
    var link = UIColor(red: 0x4c / 255, green: 0x8c / 255, blue: 0x2f / 255, alpha: 1)
    var card = UIColor.white
    /// 인용 안의 가는 선. **`--line`을 쓰지 말 것** — 흰 말풍선에만 맞는 값이라
    /// **내 노란 말풍선 위에서는 안 보인다.** 검정 10%는 둘 다에서 같게 보인다.
    var quoteRule = UIColor(white: 0, alpha: 0.1)
    /// 반응 알약에서 **내가 누른 것**의 테두리(분홍 `--brand`).
    /// 이 화면에서 분홍은 보내기 단추 몫이라, **칠하지 않고 테두리로만** 쓴다.
    var brand = UIColor(red: 0xe8 / 255, green: 0x4a / 255, blue: 0x7f / 255, alpha: 1)

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
    /// 사진 상자 — 웹의 `.chat-image`(`max-width: min(100%, 240px)` · `max-height: 300px`).
    /// **폭을 꽉 채우지 않는다** — 사진 한 장에 화면이 통째로 넘어가 대화가 끊긴다.
    var photoW: CGFloat = 240
    var photoH: CGFloat = 300
    var photoRadius: CGFloat = 15
    /// 이모티콘은 붙박이 118px이다(웹의 `.chat-sticker`).
    var sticker: CGFloat = 118
    /// 이모지만 보낸 글의 글자 크기(웹의 `.emoji-only`).
    var bigSize: CGFloat = 40
    /// 인용 글자 — **말풍선보다 한 톤 낮춘다**(웹의 `.chat-quote`).
    /// 같은 크기로 두면 인용이 답장만큼 커 보여 무엇이 새 글인지 흐려진다.
    var quoteSize: CGFloat = 13
    var quoteLine: CGFloat = 18
    /// 반응 알약 한 줄의 높이. **30px 아래로 내리지 말 것**(누를 자리다).
    var reactH: CGFloat = 30

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
        c("link", &link); c("card", &card)
        c("quoteRule", &quoteRule); c("brand", &brand)
        n("pad", &pad); n("avatar", &avatar); n("avatarGap", &avatarGap)
        n("radius", &radius); n("fontSize", &fontSize); n("lineHeight", &lineHeight)
        n("padH", &padH); n("padV", &padV); n("nameSize", &nameSize)
        n("stampSize", &stampSize); n("maxRatio", &maxRatio)
        n("photoW", &photoW); n("photoH", &photoH); n("photoRadius", &photoRadius)
        n("sticker", &sticker); n("bigSize", &bigSize)
        n("quoteSize", &quoteSize); n("quoteLine", &quoteLine); n("reactH", &reactH)
    }
}

protocol ChatListDelegate: AnyObject {
    /// 맨 아래에 있는가 · 맨 위에 닿았는가(지난 대화를 더 받아야 한다) ·
    /// `최근 대화로` 줄을 띄울 만큼 멀어졌는가.
    func chatListState(atBottom: Bool, atTop: Bool, far: Bool)
    /// 키보드를 내려 달라 — 목록을 아래로 끌었거나 목록을 눌렀다.
    func chatListDismissKeyboard()
    /// 무엇인가를 눌렀다 — 사진(크게 보기) · 카드(그 화면으로) · 반응 알약 ·
    /// 얼굴(프로필 카드) · 왼쪽으로 밀기(댓글).
    /// **앱이 스스로 하지 않고 웹에 넘긴다** — 하는 일이 전부 웹에 이미 있는
    /// 길이고, 두 벌로 만들면 한쪽만 고치게 된다.
    func chatListTap(kind: String, id: String, to: String?)
    /// 말풍선을 길게 눌렀다 — **누른 자리에** 고르는 창이 떠야 하므로
    /// 말풍선의 자리를 **창(화면) 좌표로** 함께 넘긴다.
    func chatListHold(id: String, mine: Bool, rect: CGRect)
}

// MARK: - 목록

final class ChatList: UIView, UITableViewDataSource, UITableViewDelegate {

    weak var listDelegate: ChatListDelegate?

    private let table = UITableView(frame: .zero, style: .plain)
    private var rows: [ChatRow] = []
    private var skin = ChatSkin()
    /// 줄 하나의 높이. `id|폭`으로 담아 두어 다시 재지 않는다.
    private var heights: [String: CGFloat] = [:]
    /// 사진의 진짜 크기(주소 → 크기). 받아 오기 전에는 모른다 — `photoBox` 참고.
    private var photoSizes: [String: CGSize] = [:]
    private var lastAtBottom = true
    private var toldTop = false

    /// 맨 아래에서 이만큼 안쪽이면 '맨 아래'로 본다(웹의 80px과 같은 값).
    private let bottomSlack: CGFloat = 80
    /// 위에서 이만큼 안이면 지난 대화를 더 받아 온다.
    private let topSlack: CGFloat = 400
    /// 맨 아래에서 이만큼 멀어지면 `최근 대화로` 줄이 뜬다(웹의 `JUMP_AT`).
    /// **`bottomSlack`과 벌려 놓는다** — 붙어 있으면 바닥 언저리에서 깜빡인다.
    private let jumpAt: CGFloat = 240
    private var lastFar = false
    /// 아래로 이만큼 끌면 키보드를 내린다(웹의 `dy > 40`과 같은 값).
    private let dragToHide: CGFloat = 40

    /// 끌기 시작한 자리. 아래로 끌었는지를 이것으로 잰다.
    private var dragFrom: CGFloat = 0
    /// 한 번 끄는 동안 키보드는 한 번만 내린다.
    private var dragHid = false

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
        /* **목록을 누르면 키보드가 내려간다**(18판).
           웹 목록에 있던 그 길인데, 웹에서는 **누르는 것을 우리가 안 맡고
           있었다** — 아이폰은 웹 화면을 누르는 순간 first responder를 도로
           가져가므로 키보드가 저절로 내려갔다. 앱 목록은 웹뷰 **위에 얹힌
           앱 부품**이라 그 손짓이 웹뷰에 아예 안 닿아, 옮기고 나니
           **키보드를 내릴 길이 통째로 없어졌다**(사용자 제보 —
           `키보드가 내려가지않아 … 둘 다 안돼`).
           **`cancelsTouchesInView`를 끄는 것이 한 쌍이다** — 안 끄면 나중에
           말풍선을 누르는 일(길게 누르기·인용으로 뛰기)을 이것이 먹는다. */
        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped))
        tap.cancelsTouchesInView = false
        table.addGestureRecognizer(tap)
    }

    @objc private func tapped() { listDelegate?.chatListDismissKeyboard() }

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

    /**
     * 그 글로 뛴다 — 인용을 누르거나 검색 결과를 골랐을 때다(5판).
     *
     * **못 찾으면 거짓을 돌려준다.** 지난 묶음에 있어 아직 안 받아 온 글이라,
     * 웹이 `지난 대화에 있습니다`로 알려 준다(웹 목록과 같은 잣대다).
     *
     * `place`는 `center`(인용·검색) 또는 `top`(`여기까지 읽으셨습니다` 줄 —
     * **마지막으로 읽은 글이 한 줄 보이게** 위에서 조금 내려 둔다).
     */
    func scrollTo(id: String, place: String, flash: Bool) -> Bool {
        guard let at = rows.firstIndex(where: { $0.id == id }) else { return false }
        let ip = IndexPath(row: at, section: 0)
        /* **부드럽게 굴리지 않는다** — 300개까지 받아 둔 목록을 훑어
           내려가는 일이라 느린 폰에서 그대로 끊긴다(웹의 `jumpToLatest`와
           같은 잣대다). 게다가 `top`은 굴린 뒤에 자리를 한 번 더 고치므로
           움직이는 중이면 그 값이 어긋난다. */
        table.scrollToRow(at: ip, at: place == "top" ? .top : .middle, animated: false)
        if place == "top" {
            /* 웹이 `위에서 100px`에 두는 그 자리다 — 줄 바로 위에 지난 글이
               한 줄 비쳐야 거기서부터 읽어 내려갈 수 있다. */
            table.contentOffset.y = max(0, table.contentOffset.y - 100)
        }
        lastAtBottom = atBottom()
        guard flash else { return true }
        /* 굴러가는 동안에는 그 줄이 아직 안 만들어졌을 수 있다 — 한 박자
           뒤에 찾는다. 못 찾아도 뛰는 것 자체는 이미 됐으므로 그냥 넘어간다. */
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
            (self?.table.cellForRow(at: ip) as? BubbleCell)?.flash()
        }
        return true
    }

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
    private func measure(_ s: String, width: CGFloat, size: CGFloat,
                         pinLine: Bool = true) -> CGSize {
        if s.isEmpty { return CGSize(width: 0, height: skin.lineHeight) }
        var attrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: size)]
        if pinLine {
            let p = NSMutableParagraphStyle()
            p.minimumLineHeight = skin.lineHeight
            p.maximumLineHeight = skin.lineHeight
            p.lineBreakMode = .byWordWrapping
            attrs[.paragraphStyle] = p
        }
        let box = CGSize(width: width, height: .greatestFiniteMagnitude)
        let r = (s as NSString).boundingRect(with: box,
                                             options: [.usesLineFragmentOrigin, .usesFontLeading],
                                             attributes: attrs, context: nil)
        return CGSize(width: ceil(r.width), height: ceil(r.height))
    }

    /**
     * 카드 폭. 가운데에 서는 줄이라 말풍선과 달리 화면을 기준으로 잡는다.
     */
    private func cardWidth() -> CGFloat {
        return min(bounds.width - skin.pad * 4, 320)
    }

    /**
     * 사진이 차지할 상자.
     *
     * **받아 오기 전에는 진짜 크기를 모른다.** 그때는 예비 상자(가로 한도 ×
     * 가로 한도)를 잡아 두고, 알게 되면 그 줄만 다시 재면서 **화면 위쪽에서
     * 자라거나 줄어든 만큼을 굴린 자리로 메운다**(`noteSize`). 웹에서
     * `onImageLoad`가 하던 그 일인데, 여기서는 높이를 우리가 재므로
     * 브라우저와 다투지 않아 훨씬 깨끗하다.
     *
     * **키우지는 않는다**(`min(…, 1)`) — 웹의 `width: auto`와 같다.
     */
    private func photoBox(_ url: String?) -> CGSize {
        let maxW = min(skin.photoW, maxBubbleWidth())
        guard let url = url, let real = photoSizes[url], real.width > 0, real.height > 0 else {
            return CGSize(width: maxW, height: maxW)
        }
        let k = min(maxW / real.width, skin.photoH / real.height, 1)
        return CGSize(width: floor(real.width * k), height: floor(real.height * k))
    }

    /**
     * 사진 크기를 알게 됐다 — 그 줄만 다시 재고, **읽던 자리를 지킨다.**
     *
     * 자란 줄이 보고 있는 자리보다 **위**에 있으면 그만큼 굴린 자리를 밀어
     * 준다. 안 그러면 위쪽 사진이 도착할 때마다 글이 통째로 내려간다 —
     * 웹에서 겪고 `overflow-anchor: none`으로 우리가 메우기로 한 그 자리다.
     */
    fileprivate func noteSize(_ url: String, _ size: CGSize) {
        guard size.width > 0, size.height > 0 else { return }
        if let had = photoSizes[url], had == size { return }
        photoSizes[url] = size
        guard let at = rows.firstIndex(where: { $0.image == url }) else { return }
        let key = "\(rows[at].id)|\(Int(bounds.width))"
        let before = heights[key] ?? 0
        heights.removeValue(forKey: key)
        let after = height(rows[at])
        let grew = after - before
        guard abs(grew) > 0.5 else { return }
        let above = table.rectForRow(at: IndexPath(row: at, section: 0)).maxY
            <= table.contentOffset.y
        UIView.performWithoutAnimation {
            table.reloadRows(at: [IndexPath(row: at, section: 0)], with: .none)
            if above { table.contentOffset.y += grew }
        }
    }

    /**
     * 인용이 차지하는 높이. **원문은 한 줄로 자른다**(웹과 같다) — 길면
     * 말풍선이 통째로 커져 정작 답장 글이 밀린다.
     * 말풍선 **안**에 들 때는 아래에 가는 선과 사이가 붙고, 사진·이모티콘처럼
     * 말풍선이 없는 줄에서는 그 위에 쪽지로 뜬다(웹의 `.chat-quote.above`).
     */
    private func quoteHeight(_ row: ChatRow, above: Bool) -> CGFloat {
        guard row.quoteWho != nil else { return 0 }
        let two = skin.quoteLine * 2 + 1      // 머리말 · 원문 · 가는 선
        return above ? two + 8 + 2 : two + 6
    }

    private func height(_ row: ChatRow) -> CGFloat {
        let key = "\(row.id)|\(Int(bounds.width))"
        if let h = heights[key] { return h }
        var h: CGFloat = 0
        if row.date != nil { h += 34 }                   // 날짜 칸 + 사이
        if row.mark { h += 30 }                          // `여기까지 읽으셨습니다`
        if !row.reacts.isEmpty { h += skin.reactH + 3 }
        switch row.kind {
        case .system:
            h += measure(row.body, width: bounds.width - skin.pad * 4,
                         size: skin.stampSize + 2).height + 18
        case .card:
            let w = cardWidth() - 24
            h += measure(row.body, width: w, size: skin.fontSize - 1).height
            h += measure(row.go ?? "", width: w, size: skin.fontSize - 2).height
            h += 30                                       // 안여백 + 줄 사이
        case .photo, .sticker:
            if row.name != nil { h += skin.nameSize + 5 }
            h += quoteHeight(row, above: true)
            h += row.kind == .sticker ? skin.sticker : photoBox(row.image).height
            if let c = row.cap, !c.isEmpty {
                h += measure(c, width: textWidth(), size: skin.fontSize).height
                    + skin.padV * 2 + 2
            }
            h += 4
        case .text, .other:
            if row.name != nil { h += skin.nameSize + 5 }
            h += quoteHeight(row, above: false)
            let body = row.kind == .other ? (row.note ?? "사진") : row.body
            if row.big {
                /* 이모지만 보낸 글은 말풍선을 벗기고 크게 그린다 —
                   안여백도 웹과 같이 거의 없다(`.emoji-only`). */
                h += measure(body, width: textWidth(), size: skin.bigSize,
                             pinLine: false).height + 2
            } else {
                let t = measure(body, width: textWidth(), size: skin.fontSize)
                h += t.height + skin.padV * 2
            }
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
        let row = rows[ip.row]
        cell.fill(row, skin: skin, maxBubble: maxBubbleWidth(), textW: textWidth(),
                  font: bodyFont(), photo: photoBox(row.image), card: cardWidth())
        cell.onPhotoSize = { [weak self] url, size in self?.noteSize(url, size) }
        cell.onTap = { [weak self] kind, id, to in
            self?.listDelegate?.chatListTap(kind: kind, id: id, to: to)
        }
        cell.onHold = { [weak self] id, rect, mine in
            self?.listDelegate?.chatListHold(id: id, mine: mine, rect: rect)
        }
        return cell
    }

    // MARK: 굴리기

    func scrollViewDidScroll(_ sv: UIScrollView) {
        /* **아래로 끌면 키보드가 함께 내려간다** — 카톡이 그렇다.
           `keyboardDismissMode = .onDrag`으로 하지 말 것: 그것은 **어느
           쪽으로 끌든** 내리므로, 옛 글을 읽으려고 위로 훑을 때마다 키보드가
           사라진다. 웹 목록이 쓰던 잣대(`dy > 40`, 아래로)를 그대로 옮긴다 —
           손가락이 내려가면 `contentOffset`은 줄어든다.
           한 번 끄는 동안 한 번만 부른다(`dragHid`). */
        if sv.isDragging, !dragHid, dragFrom - sv.contentOffset.y > dragToHide {
            dragHid = true
            listDelegate?.chatListDismissKeyboard()
        }
        report()
    }

    func scrollViewWillBeginDragging(_ sv: UIScrollView) {
        dragFrom = sv.contentOffset.y
        dragHid = false
    }

    private func report() {
        let bottom = atBottom()
        let top = table.contentOffset.y < topSlack && rows.count > 0
        /* **`최근 대화로` 화살표는 뒤집힐 때만 알린다**(웹의 `jumpShown`과
           같은 잣대다) — 굴릴 때마다 웹에 알리면 그때마다 화면이 다시
           그려져 긴 대화에서 그대로 끊긴다. */
        let far = below() > jumpAt
        if bottom == lastAtBottom && far == lastFar && !(top && !toldTop) { return }
        lastAtBottom = bottom
        lastFar = far
        if top { toldTop = true }
        listDelegate?.chatListState(atBottom: bottom, atTop: top, far: far)
    }

    /// 맨 아래에서 얼마나 떨어져 있나.
    private func below() -> CGFloat {
        let max = table.contentSize.height - table.bounds.height
            + table.adjustedContentInset.bottom
        return max - table.contentOffset.y
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
/* `UITableViewCell`이 이미 `UIGestureRecognizerDelegate`를 따른다 — 여기
   또 적으면 `redundant conformance`로 컴파일이 멈추고, 그래서 아래 두
   손잡이도 **`override`여야 한다.** */
final class BubbleCell: UITableViewCell {

    private let dateChip = PadLabel()
    private let nameLabel = UILabel()
    private let avatarView = AvatarView()
    private let bubble = UIView()
    private let bodyLabel = UILabel()
    private let timeLabel = UILabel()
    private let unreadLabel = UILabel()
    private let sysChip = PadLabel()
    private let photoView = UIImageView()
    private let capBubble = UIView()
    private let capLabel = UILabel()
    private let cardView = UIView()
    private let cardBody = UILabel()
    private let cardGo = UILabel()
    private let quoteBox = UIView()
    private let quoteWho = UILabel()
    private let quoteText = UILabel()
    private let quoteLine = UIView()
    private let markView = DividerView()
    private let reactRow = UIView()
    private var chips: [ReactChip] = []

    private var row: ChatRow?
    private var skin = ChatSkin()
    private var maxBubble: CGFloat = 0
    private var textW: CGFloat = 0
    private var photoBox: CGSize = .zero
    private var cardW: CGFloat = 0
    private var photoToken: UUID?

    /// 사진의 진짜 크기를 알게 되면 알린다 — 목록이 그 줄만 다시 잰다.
    var onPhotoSize: ((String, CGSize) -> Void)?
    /// 눌렸다(`photo`·`card`·`react`·`face`·`reply`).
    var onTap: ((String, String, String?) -> Void)?
    /// 길게 눌렀다 — 말풍선 자리를 **창 좌표로** 함께 넘긴다.
    var onHold: ((String, CGRect, Bool) -> Void)?

    /// 웹의 `HOLD_MS`(500)와 같은 값이다 — **한쪽만 고치지 말 것.**
    private let holdFor: TimeInterval = 0.5
    /// 왼쪽으로 이만큼 밀면 댓글이 걸린다(웹의 `SWIPE_TRIGGER`).
    private let swipeAt: CGFloat = 55
    /// 아무리 밀어도 여기까지만 따라간다(웹의 `SWIPE_MAX`).
    private let swipeMax: CGFloat = 72
    /// 길게 누르기가 이미 걸렸으면 손을 뗄 때 댓글을 안 건다(웹과 같다).
    private var held = false

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

        /* 사진은 **잘라서 채운다**(`object-fit: cover`와 같다). 상자를 진짜
           비율로 잡아 두므로 실제로 잘리는 일은 거의 없고, 받아 오기 전
           예비 상자에서만 잠깐 그렇다. */
        photoView.contentMode = .scaleAspectFill
        photoView.layer.masksToBounds = true
        photoView.layer.cornerCurve = .continuous
        photoView.isUserInteractionEnabled = true
        photoView.addGestureRecognizer(
            UITapGestureRecognizer(target: self, action: #selector(tapPhoto)))

        capLabel.numberOfLines = 0
        capBubble.layer.cornerRadius = 11
        capBubble.layer.cornerCurve = .continuous

        cardBody.numberOfLines = 0
        cardGo.numberOfLines = 1
        cardView.layer.cornerRadius = 12
        cardView.layer.cornerCurve = .continuous
        cardView.isUserInteractionEnabled = true
        cardView.addGestureRecognizer(
            UITapGestureRecognizer(target: self, action: #selector(tapCard)))

        /* 인용(답장)은 **말풍선 안**에 든다 — 카톡과 같다. 머리말 · 원문
           한 줄 · 가는 선, 그 아래가 답장 글이다. 사진·이모티콘처럼 말풍선이
           없는 줄에서만 그 위에 쪽지로 뜬다(`.chat-quote.above`). */
        quoteWho.numberOfLines = 1
        quoteText.numberOfLines = 1
        quoteText.lineBreakMode = .byTruncatingTail
        quoteBox.layer.cornerCurve = .continuous
        quoteBox.addSubview(quoteWho)
        quoteBox.addSubview(quoteText)
        quoteBox.addSubview(quoteLine)

        for v in [dateChip, markView, nameLabel, avatarView, bubble, timeLabel,
                  unreadLabel, sysChip, photoView, capBubble, cardView, quoteBox,
                  reactRow] {
            contentView.addSubview(v)
        }
        bubble.addSubview(bodyLabel)
        capBubble.addSubview(capLabel)
        cardView.addSubview(cardBody)
        cardView.addSubview(cardGo)

        /* **얼굴을 누르면 그 사람 카드가 뜬다**(카톡과 같다). 100명 방에서
           `83/신성호/광산구`만 보고는 누군지 떠올리기 어렵다. */
        avatarView.isUserInteractionEnabled = true
        avatarView.addGestureRecognizer(
            UITapGestureRecognizer(target: self, action: #selector(tapFace)))

        /* **길게 누르면 고르는 창이 뜬다**(PC의 오른쪽 클릭 자리).
           왼쪽으로 미는 것은 댓글이 이미 쓰고 있어 겹치면 안 되므로,
           조금이라도 움직이면 취소된다(`allowableMovement` 기본값 10). */
        let hold = UILongPressGestureRecognizer(target: self, action: #selector(heldDown))
        hold.minimumPressDuration = holdFor
        hold.delegate = self
        contentView.addGestureRecognizer(hold)

        /* **왼쪽으로 밀면 댓글이 걸린다**(카톡과 같은 손짓).
           세로로 굴리는 것과 안 부딪히게 `shouldBegin`에서 **가로로 그은
           것만** 받는다 — 웹에서 `touch-action: pan-y`가 하던 일이다. */
        let pan = UIPanGestureRecognizer(target: self, action: #selector(swiped))
        pan.delegate = self
        contentView.addGestureRecognizer(pan)
    }

    required init?(coder: NSCoder) { fatalError() }

    /// 세로로 그은 것은 표에 넘긴다 — 가로로 그은 것만 우리가 받는다.
    override func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
        guard let pan = g as? UIPanGestureRecognizer,
              pan.view === contentView else { return super.gestureRecognizerShouldBegin(g) }
        let v = pan.velocity(in: contentView)
        return abs(v.x) > abs(v.y)
    }

    /// **반응 알약 위에서는 길게 눌러도 창이 안 뜬다** — 누르는 자리가 이미
    /// 임자가 있는 곳이다(웹의 `taken`과 같은 결이다).
    override func gestureRecognizer(_ g: UIGestureRecognizer,
                                    shouldReceive touch: UITouch) -> Bool {
        guard g is UILongPressGestureRecognizer else { return true }
        var v = touch.view
        while let cur = v, cur !== contentView {
            if cur is ReactChip { return false }
            v = cur.superview
        }
        return true
    }

    @objc private func tapFace() {
        guard let r = row else { return }
        onTap?("face", r.id, nil)
    }

    /**
     * 길게 누른 자리. **줄 전체가 아니라 말풍선(또는 그림)을 넘긴다** —
     * 줄은 화면 폭을 다 쓰므로 그걸 넘기면 내 글에서도 창이 왼쪽에 뜬다
     * (웹의 `anchor()`와 같은 잣대다).
     */
    @objc private func heldDown(_ g: UILongPressGestureRecognizer) {
        guard g.state == .began, let r = row else { return }
        held = true
        let target: UIView = !bubble.isHidden ? bubble
            : (!photoView.isHidden ? photoView : (!cardView.isHidden ? cardView : contentView))
        onHold?(r.id, target.convert(target.bounds, to: nil), r.mine)
    }

    @objc private func swiped(_ g: UIPanGestureRecognizer) {
        guard let r = row else { return }
        switch g.state {
        case .began:
            held = false
        case .changed:
            let dx = max(-swipeMax, min(0, g.translation(in: contentView).x))
            contentView.transform = CGAffineTransform(translationX: dx, y: 0)
        case .ended, .cancelled, .failed:
            let dx = max(-swipeMax, min(0, g.translation(in: contentView).x))
            let hit = !held && g.state == .ended && dx <= -swipeAt
            UIView.animate(withDuration: 0.16) { self.contentView.transform = .identity }
            if hit { onTap?("reply", r.id, nil) }
        default:
            break
        }
    }

    @objc private func tapPhoto() {
        guard let r = row, r.kind == .photo, let u = r.image else { return }
        onTap?("photo", r.id, u)
    }

    @objc private func tapCard() {
        guard let r = row, r.kind == .card else { return }
        onTap?("card", r.id, r.to)
    }

    /**
     * 뛰어온 줄을 잠깐 깜빡인다(웹의 `.flash` — 1.3초 노란 바탕).
     * **어느 글로 왔는지 알려 주는 것이 전부라** 색만 오간다.
     */
    func flash() {
        let glow = UIView(frame: contentView.bounds)
        glow.backgroundColor = UIColor(red: 1, green: 0xdf / 255, blue: 0x47 / 255, alpha: 0)
        glow.layer.cornerRadius = 12
        glow.isUserInteractionEnabled = false
        contentView.insertSubview(glow, at: 0)
        UIView.animate(withDuration: 0.32, animations: { glow.alpha = 1
            glow.backgroundColor = UIColor(red: 1, green: 0xdf / 255,
                                           blue: 0x47 / 255, alpha: 0.3)
        }, completion: { _ in
            UIView.animate(withDuration: 0.98, animations: { glow.alpha = 0 },
                           completion: { _ in glow.removeFromSuperview() })
        })
    }

    /// 줄을 다시 쓸 때 밀다 만 자리를 되돌린다 — 안 그러면 엉뚱한 줄이
    /// 왼쪽으로 밀려 있는 채로 그려진다.
    override func prepareForReuse() {
        super.prepareForReuse()
        contentView.transform = .identity
        held = false
    }

    func fill(_ r: ChatRow, skin s: ChatSkin, maxBubble mb: CGFloat,
              textW tw: CGFloat, font: UIFont, photo pb: CGSize, card cw: CGFloat) {
        row = r
        held = false
        contentView.transform = .identity
        skin = s
        maxBubble = mb
        textW = tw
        photoBox = pb
        cardW = cw

        let p = NSMutableParagraphStyle()
        p.minimumLineHeight = s.lineHeight
        p.maximumLineHeight = s.lineHeight
        p.lineBreakMode = .byWordWrapping

        let isSystem = r.kind == .system
        let isCard = r.kind == .card
        let hasImage = r.kind == .photo || r.kind == .sticker

        /* `여기까지 읽으셨습니다` — **어느 갈래에서나 맨 위에 긋는다.**
           자리를 정하는 것은 웹이고(`unreadDone`) 여기는 그리기만 한다. */
        markView.isHidden = !r.mark
        if r.mark {
            markView.show("여기까지 읽으셨습니다", color: s.faint, rule: s.chip,
                          size: s.stampSize + 1)
        }

        /* 반응 알약. **하나도 없으면 줄 자체를 안 그린다** — 빈 자리를 늘
           비워 두면 말풍선 사이가 성겨진다. **차례는 먼저 달린 순서다**
           (웹의 `countReacts`가 그렇게 준다) — 개수순으로 세우면 새 반응이
           들어올 때마다 칩이 자리를 바꿔 누르려던 것을 잘못 누른다. */
        reactRow.isHidden = r.reacts.isEmpty
        while chips.count < r.reacts.count {
            let chip = ReactChip()
            chip.onTap = { [weak self] e in
                guard let self, let row = self.row else { return }
                self.onTap?("react", row.id, e)
            }
            reactRow.addSubview(chip)
            chips.append(chip)
        }
        for (i, chip) in chips.enumerated() {
            chip.isHidden = i >= r.reacts.count
            if i < r.reacts.count { chip.show(r.reacts[i], skin: s) }
        }

        /* 인용(답장). 원문은 **한 줄로 자른다**(웹과 같다) — 길면 말풍선이
           통째로 커져 정작 답장 글이 밀린다. */
        quoteBox.isHidden = r.quoteWho == nil
        if let who = r.quoteWho {
            let inBubble = !hasImage
            quoteBox.backgroundColor = inBubble ? .clear : s.chip
            quoteBox.layer.cornerRadius = inBubble ? 0 : 8
            quoteLine.isHidden = !inBubble
            quoteLine.backgroundColor = s.quoteRule
            quoteWho.attributedText = NSAttributedString(string: who, attributes: [
                .font: UIFont.systemFont(ofSize: s.quoteSize, weight: .semibold),
                .foregroundColor: inBubble ? s.text.withAlphaComponent(0.66) : s.on,
            ])
            quoteText.attributedText = NSAttributedString(
                string: r.quoteText ?? "", attributes: [
                    .font: UIFont.systemFont(ofSize: s.quoteSize),
                    .foregroundColor: inBubble ? s.text.withAlphaComponent(0.55) : s.faint,
                ])
        }

        sysChip.isHidden = !isSystem
        cardView.isHidden = !isCard
        photoView.isHidden = !hasImage
        capBubble.isHidden = !(hasImage && !(r.cap ?? "").isEmpty)
        bubble.isHidden = isSystem || isCard || hasImage
        for v in [nameLabel, avatarView, timeLabel, unreadLabel] as [UIView] {
            v.isHidden = isSystem || isCard
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

        if isCard {
            /* **눌러서 들어가는 카드다**(라운드·투표·공지). 웹의 `LinkCard`와
               같은 짜임이라 **줄 수를 세지 않는다** — 첫 줄만 흐리게 깔고
               나머지는 있는 대로 그리므로 문구가 늘어도 안 깨진다. */
            cardView.backgroundColor = s.card
            let text = NSMutableAttributedString()
            let lines = r.body.components(separatedBy: "\n")
            if lines.count > 1 {
                text.append(NSAttributedString(string: lines[0] + "\n", attributes: [
                    .font: UIFont.systemFont(ofSize: s.fontSize - 2),
                    .foregroundColor: s.text.withAlphaComponent(0.6),
                    .paragraphStyle: p,
                ]))
                text.append(NSAttributedString(
                    string: lines.dropFirst().joined(separator: "\n"), attributes: [
                        .font: UIFont.systemFont(ofSize: s.fontSize - 1, weight: .semibold),
                        .foregroundColor: s.text,
                        .paragraphStyle: p,
                    ]))
            } else {
                text.append(NSAttributedString(string: r.body, attributes: [
                    .font: UIFont.systemFont(ofSize: s.fontSize - 1, weight: .semibold),
                    .foregroundColor: s.text,
                    .paragraphStyle: p,
                ]))
            }
            cardBody.attributedText = text
            cardGo.attributedText = NSAttributedString(string: r.go ?? "", attributes: [
                .font: UIFont.systemFont(ofSize: s.fontSize - 2, weight: .semibold),
                .foregroundColor: s.link,
            ])
            setNeedsLayout()
            return
        }

        if hasImage {
            photoView.layer.cornerRadius = r.kind == .sticker ? 0 : s.photoRadius
            photoView.backgroundColor = r.kind == .sticker
                ? .clear : UIColor(white: 1, alpha: 0.12)
            /* 이모티콘은 **잘리면 안 된다**(그림 하나가 곧 말이다) —
               사진만 채워서 자른다. */
            photoView.contentMode = r.kind == .sticker ? .scaleAspectFit : .scaleAspectFill
            photoView.image = nil
            let mine = UUID()
            photoToken = mine
            let isPhoto = r.kind == .photo
            if let u = r.image, !u.isEmpty {
                ImageStore.shared.load(u) { [weak self] img in
                    guard let self, self.photoToken == mine else { return }
                    self.photoView.image = img
                    if isPhoto, let img = img { self.onPhotoSize?(u, img.size) }
                }
            }
            if !capBubble.isHidden {
                capBubble.backgroundColor = r.mine ? s.mineBubble : s.bubble
                capBubble.layer.cornerRadius = s.radius
                capLabel.attributedText = NSAttributedString(
                    string: r.cap ?? "", attributes: [
                        .font: font, .foregroundColor: s.text, .paragraphStyle: p,
                    ])
            }
        }

        bubble.backgroundColor = r.big ? .clear : (r.mine ? s.mineBubble : s.bubble)
        bubble.layer.cornerRadius = s.radius
        let body = r.kind == .other ? (r.note ?? "사진") : r.body
        bodyLabel.attributedText = NSAttributedString(string: body, attributes: [
            .font: r.big ? UIFont.systemFont(ofSize: s.bigSize) : font,
            .foregroundColor: s.text,
            /* 큰 이모지는 **줄 간격을 못박지 않는다** — 18px에 가두면
               40px 글자가 서로 겹친다(웹도 거기서만 `line-height: 1.15`다). */
            .paragraphStyle: r.big ? NSParagraphStyle.default : p,
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

        if !markView.isHidden {
            markView.frame = CGRect(x: 0, y: y, width: w, height: 30)
            y += 30
        }

        if r.kind == .system {
            let maxW = w - skin.pad * 4
            let size = sysChip.sizeThatFits(CGSize(width: maxW, height: .greatestFiniteMagnitude))
            let cw = min(maxW, size.width)
            sysChip.frame = CGRect(x: (w - cw) / 2, y: y + 4, width: cw, height: size.height)
            return
        }

        if r.kind == .card {
            let inner = cardW - 24
            let bh = ceil(cardBody.sizeThatFits(
                CGSize(width: inner, height: .greatestFiniteMagnitude)).height)
            let gh = ceil(cardGo.sizeThatFits(
                CGSize(width: inner, height: .greatestFiniteMagnitude)).height)
            cardView.frame = CGRect(x: (w - cardW) / 2, y: y + 4,
                                    width: cardW, height: bh + gh + 22)
            cardBody.frame = CGRect(x: 12, y: 10, width: inner, height: bh)
            cardGo.frame = CGRect(x: 12, y: bh + 12, width: inner, height: gh)
            return
        }

        if !nameLabel.isHidden {
            let x = skin.pad + skin.avatar + skin.avatarGap
            nameLabel.frame = CGRect(x: x, y: y, width: w - x - skin.pad, height: skin.nameSize + 4)
            y = nameLabel.frame.maxY + 1
        }

        /* 그림이 있는 줄(사진·이모티콘)은 **말풍선을 안 두른다** — 그림이 곧
           한 마디다. 함께 보낸 글만 그림 아래에 작은 말풍선으로 붙는다
           (웹의 `.chat-cap`). */
        let hasImage = r.kind == .photo || r.kind == .sticker
        /* 인용 몫. 말풍선 **안**이면 글 위에 얹히고(그만큼 말풍선이 커진다),
           사진·이모티콘처럼 말풍선이 없으면 **그 위에 쪽지로** 뜬다. */
        let quoted = r.quoteWho != nil
        let two = skin.quoteLine * 2 + 1
        let quoteIn: CGFloat = quoted && !hasImage ? two + 6 : 0
        let quoteUp: CGFloat = quoted && hasImage ? two + 8 : 0

        var size = CGSize.zero
        var bw: CGFloat = 0
        var bh: CGFloat = 0
        if hasImage {
            bw = r.kind == .sticker ? skin.sticker : photoBox.width
            bh = r.kind == .sticker ? skin.sticker : photoBox.height
        } else {
            let body = bodyLabel.attributedText?.string ?? ""
            size = measureBody(body, big: r.big)
            let padH = r.big ? 2 : skin.padH
            let padV = r.big ? 1 : skin.padV
            bw = min(maxBubble, size.width + padH * 2)
            /* 인용이 붙으면 말풍선이 너무 좁아지지 않게 바닥을 둔다 —
               `네` 한 글자에 답장하면 가는 선이 손톱만 해진다. */
            if quoted { bw = max(bw, min(maxBubble, 160)) }
            bh = size.height + padV * 2 + quoteIn
        }

        let x = r.mine ? w - skin.pad - bw : skin.pad + skin.avatar + skin.avatarGap
        if quoteUp > 0 {
            let qw = min(maxBubble, max(bw, 140))
            let qx = r.mine ? x + bw - qw : x
            quoteBox.frame = CGRect(x: qx, y: y, width: qw, height: quoteUp)
            layoutQuote(inner: CGRect(x: 8, y: 4, width: qw - 16, height: two))
            y += quoteUp + 2
        }
        if !r.mine, !avatarView.isHidden {
            /* 얼굴은 **말풍선(또는 그림)과 나란히** 선다 — 위에 인용 쪽지가
               붙는 줄에서는 그만큼 내려온다. */
            avatarView.frame = CGRect(x: skin.pad, y: y,
                                      width: skin.avatar, height: skin.avatar)
        }
        if hasImage {
            photoView.frame = CGRect(x: x, y: y, width: bw, height: bh)
            if !capBubble.isHidden {
                let cs = measureBody(capLabel.attributedText?.string ?? "", big: false)
                let cw = min(maxBubble, cs.width + skin.padH * 2)
                let ch = cs.height + skin.padV * 2
                let cx = r.mine ? x + bw - cw : x
                capBubble.frame = CGRect(x: cx, y: y + bh + 2, width: cw, height: ch)
                capLabel.frame = CGRect(x: skin.padH, y: skin.padV,
                                        width: cw - skin.padH * 2, height: cs.height)
                bh += 2 + ch
            }
        } else {
            let padH = r.big ? 2 : skin.padH
            let padV = r.big ? 1 : skin.padV
            bubble.frame = CGRect(x: x, y: y, width: bw, height: bh)
            bodyLabel.frame = CGRect(x: padH, y: padV + quoteIn,
                                     width: bw - padH * 2, height: size.height)
            if quoteIn > 0 {
                /* **말풍선 좌표가 아니라 칸 좌표로 놓는다** — 인용은
                   `contentView`에 붙어 있다(말풍선 안에 넣으면 겹판이 하나
                   더 생기는데 얻는 것이 없다). */
                quoteBox.frame = CGRect(x: x + padH, y: y + padV,
                                        width: bw - padH * 2, height: two)
                layoutQuote(inner: CGRect(x: 0, y: 0, width: bw - padH * 2, height: two))
            }
        }
        /* 시각·안 읽은 수가 붙을 자리. 그림 줄에서는 말풍선이 없으므로
           **그림(과 딸린 글)이 차지한 상자**를 대신 쓴다. */
        let box = CGRect(x: x, y: y, width: bw, height: bh)

        /* 시각·안 읽은 수는 말풍선 옆에 **아래에서부터 세로로 쌓는다**
           (웹의 `Stamp`와 같다) — 숫자가 생기거나 사라져도 말풍선이
           위아래로 안 흔들린다. 시각이 맨 아래, 안 읽은 수가 그 위다. */
        let stampW: CGFloat = 44
        let stampH = skin.stampSize + 3
        let sx = r.mine ? box.minX - 4 - stampW : box.maxX + 4
        var bottom = box.maxY
        if !timeLabel.isHidden {
            timeLabel.frame = CGRect(x: sx, y: bottom - stampH, width: stampW, height: stampH)
            timeLabel.textAlignment = r.mine ? .right : .left
            bottom -= stampH
        }
        if !unreadLabel.isHidden {
            unreadLabel.frame = CGRect(x: sx, y: bottom - stampH, width: stampW, height: stampH)
            unreadLabel.textAlignment = r.mine ? .right : .left
        }

        /* 반응 알약 줄 — 말풍선 **바로 아래**, 말풍선과 같은 쪽에 붙인다.
           다섯을 넘지 않으므로(`REACTIONS`) 접을 일이 없다. */
        if !reactRow.isHidden {
            let n = r.reacts.count
            var ws: [CGFloat] = []
            var total: CGFloat = 0
            for i in 0..<n {
                let cw = chips[i].width()
                ws.append(cw)
                total += cw + (i > 0 ? 4 : 0)
            }
            let rx = r.mine ? max(skin.pad, box.maxX - total) : box.minX
            reactRow.frame = CGRect(x: rx, y: box.maxY + 3,
                                    width: total, height: skin.reactH)
            var cx: CGFloat = 0
            for i in 0..<n {
                chips[i].frame = CGRect(x: cx, y: 0, width: ws[i], height: skin.reactH)
                cx += ws[i] + 4
            }
        }
    }

    /// 인용 안쪽(머리말 · 원문 · 가는 선)을 `quoteBox` 좌표로 놓는다.
    private func layoutQuote(inner: CGRect) {
        let line = skin.quoteLine
        quoteWho.frame = CGRect(x: inner.minX, y: inner.minY,
                                width: inner.width, height: line)
        quoteText.frame = CGRect(x: inner.minX, y: inner.minY + line,
                                 width: inner.width, height: line)
        quoteLine.frame = CGRect(x: inner.minX, y: inner.minY + line * 2,
                                 width: inner.width, height: 1)
    }

    private func measureBody(_ s: String, big: Bool) -> CGSize {
        if s.isEmpty { return CGSize(width: 0, height: skin.lineHeight) }
        var attrs: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: big ? skin.bigSize : skin.fontSize),
        ]
        if !big {
            let p = NSMutableParagraphStyle()
            p.minimumLineHeight = skin.lineHeight
            p.maximumLineHeight = skin.lineHeight
            p.lineBreakMode = .byWordWrapping
            attrs[.paragraphStyle] = p
        }
        let r = (s as NSString).boundingRect(
            with: CGSize(width: textW, height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: attrs, context: nil)
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
 * `여기까지 읽으셨습니다` 줄 — 가운데 글자, 양옆으로 가는 선.
 *
 * **웹의 `.chat-unread`와 같은 자리다.** 줄 자리를 정하는 것은 웹이고
 * (`unreadDone` — 보고 있는 동안 들어온 글로 줄이 따라 내려가면 안 된다)
 * 여기는 **그리기만** 한다.
 */
final class DividerView: UIView {
    private let label = UILabel()
    private let left = UIView()
    private let right = UIView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        label.textAlignment = .center
        addSubview(left)
        addSubview(right)
        addSubview(label)
    }

    required init?(coder: NSCoder) { fatalError() }

    func show(_ text: String, color: UIColor, rule: UIColor, size: CGFloat) {
        label.attributedText = NSAttributedString(string: text, attributes: [
            .font: UIFont.systemFont(ofSize: size),
            .foregroundColor: color,
        ])
        left.backgroundColor = rule
        right.backgroundColor = rule
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let w = bounds.width
        let h = bounds.height
        let size = label.intrinsicContentSize
        let lw = min(size.width, w - 60)
        let x = (w - lw) / 2
        label.frame = CGRect(x: x, y: 0, width: lw, height: h)
        left.frame = CGRect(x: 12, y: h / 2, width: max(0, x - 20), height: 1)
        right.frame = CGRect(x: x + lw + 8, y: h / 2,
                             width: max(0, w - (x + lw + 8) - 12), height: 1)
    }
}

/**
 * 말풍선 아래 붙는 반응 알약(`😄 2`).
 *
 * **뜻이 있는 색을 안 쓴다** — 흰 알약이고, 내가 누른 것만 분홍 테두리로
 * 갈라 둔다(웹의 `.react-chip`과 같은 잣대다).
 * **30px 아래로 내리지 말 것** — 누를 자리다(`audit.mjs`가 잡는 그 값).
 */
final class ReactChip: UIControl {
    private let label = UILabel()
    private(set) var emoji = ""
    /// 알약 하나의 가장 좁은 폭. **30px 아래로 내리지 말 것**(누를 자리다).
    private let least: CGFloat = 34

    var onTap: ((String) -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        layer.cornerCurve = .continuous
        layer.borderWidth = 1
        label.textAlignment = .center
        label.isUserInteractionEnabled = false
        addSubview(label)
        addTarget(self, action: #selector(hit), for: .touchUpInside)
    }

    required init?(coder: NSCoder) { fatalError() }

    @objc private func hit() { onTap?(emoji) }

    func show(_ r: ChatReact, skin: ChatSkin) {
        emoji = r.emoji
        label.attributedText = NSAttributedString(
            string: r.n > 1 ? "\(r.emoji) \(r.n)" : r.emoji,
            attributes: [
                .font: UIFont.systemFont(ofSize: skin.stampSize + 3),
                .foregroundColor: skin.text,
            ])
        backgroundColor = skin.bubble
        layer.borderColor = (r.mine ? skin.brand : UIColor.clear).cgColor
        layer.cornerRadius = skin.reactH / 2
        setNeedsLayout()
    }

    /// 알약 하나의 폭. 글자에 좌우 안여백을 더한 값이다.
    func width() -> CGFloat {
        return max(least, ceil(label.intrinsicContentSize.width) + 20)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        label.frame = bounds
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
