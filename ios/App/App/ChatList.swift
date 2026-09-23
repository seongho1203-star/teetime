import AVFoundation
import ImageIO
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

// MARK: - 사진과 동영상 · 찾은 글자

/**
 * **주소 끝으로 사진과 동영상을 가른다**(사용자 요청 — `사진과 동영상을
 * 원본으로 올릴수있게해주고`).
 *
 * **DB에 칸을 새로 만들지 않았다** — 동영상도 사진이 쓰던
 * `messages.image_url`에 주소가 그대로 들어간다(이모티콘이 같은 칸을
 * `sticker:<id>`로 쓰는 그 방식이다). 그래서 **붙여넣을 SQL도, 새 표도
 * 없고** 옛 판에서도 그냥 '사진'으로 보일 뿐 안 깨진다.
 *
 * **웹 `lib/media.ts`의 `isVideo`와 같은 규칙이다 — 한쪽만 고치지 말 것.**
 */
enum ChatMedia {
    static let videoExts = ["mp4", "mov", "m4v"]
    static func isVideo(_ url: String?) -> Bool {
        guard let url = url, !url.hasPrefix("sticker:") else { return false }
        let path = (URL(string: url)?.path ?? url).lowercased()
        return videoExts.contains { path.hasSuffix(".\($0)") }
    }
}

/**
 * 검색칸에 친 글자를 말풍선에서 찾는다 — **그 자리만 파랗게 칠한다**
 * (사용자 요청 — `내가 검색한 단어는 파랗게보이도록해줘`).
 *
 * **색만 바꾸고 굵기는 안 건드린다.** 줄 높이는 `measure`가 여느 글자로
 * 미리 재 두는 값이라, 굵게 하면 그만큼 넓어져 **한 줄이 더 접혀 말풍선
 * 밖으로 밀려 나간다**(`@언급` 칠하기에서 얻은 그 규칙이다).
 */
enum ChatFind {
    static let color = UIColor(red: 0x2c / 255, green: 0x7b / 255, blue: 0xd4 / 255, alpha: 1)

    /// 대소문자를 안 가린다. 한글은 어차피 그대로 맞는다.
    static func ranges(_ body: String, _ find: String) -> [NSRange] {
        let needle = find.trimmingCharacters(in: .whitespacesAndNewlines)
        guard needle.count >= 1, !body.isEmpty else { return [] }
        let ns = body as NSString
        var out: [NSRange] = []
        var from = 0
        while from < ns.length {
            let rest = NSRange(location: from, length: ns.length - from)
            let hit = ns.range(of: needle, options: [.caseInsensitive], range: rest)
            guard hit.location != NSNotFound, hit.length > 0 else { break }
            out.append(hit)
            from = hit.location + hit.length
        }
        return out
    }

    static func paint(_ s: NSMutableAttributedString, _ body: String, _ find: String) {
        guard !find.isEmpty else { return }
        for hit in ranges(body, find) where NSMaxRange(hit) <= s.length {
            s.addAttribute(.foregroundColor, value: Self.color, range: hit)
        }
    }
}

// MARK: - 웹이 보내 주는 한 줄

/// 말풍선 아래 붙는 반응 알약 하나(`😄 2`).
struct ChatReact {
    let emoji: String
    let n: Int
    /// 내가 누른 것인가 — 그것만 분홍 테두리로 갈라 둔다.
    let mine: Bool
}

/**
 * **지금 올라가고 있는 사진·동영상**(보낸 바이트 / 전체 바이트).
 *
 * 카톡처럼 **고르는 순간 대화방에 그림이 먼저 뜨고** 그 위에서 진행률이
 * 찬다(사용자 요청 — `사진이나 동영상 선택하고 확인누르면 채팅창에
 * 사진이나 동영상이 뜨고 내가 올린사진처럼 용량표시되게끔해줘`).
 * 이 값이 있는 줄은 **아직 서버에 없는 임시 줄**이다(`tmp:`로 시작한다).
 */
struct ChatUpload {
    var sent: Int64
    var total: Int64
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
    /// 글 안의 `@이름` 자리 — 파랑(남)·분홍(나·`@전체`)으로 칠한다.
    let mentions: [ChatMention]
    /// 아직 못 그리는 줄에 적을 말(`사진`·`이모티콘`).
    let note: String?
    /// 사진·이모티콘 그림 주소. **이모티콘은 웹이 `stickerSrc()`로 만들어 준다** —
    /// 글에 남는 값은 `sticker:<id>`이고 주소 짓는 규칙은 웹에만 있다.
    let image: String?
    /// 사진이 아니라 **동영상**인가(주소 끝으로 가른다 — `ChatMedia`).
    /// 그림 자리에 ▶를 얹고, 누르면 사진 대신 재생기를 띄운다.
    let video: Bool
    /// 사진·이모티콘 **아래에 붙는 한 줄**(함께 보낸 글). 웹의 `.chat-cap`이다.
    let cap: String?
    /// 이모지만 보낸 글 — 말풍선을 벗기고 크게 그린다(`lib/emoji.ts`가 가른다).
    let big: Bool
    /// 눌리는 카드의 아랫줄(`라운드 보러 가기 ›`).
    let go: String?
    /// 그 카드가 가는 곳(`/rounds/r1`). 누르면 웹에 그대로 넘긴다.
    let to: String?
    /// 카드 머리에 서는 배지 그림의 이름(`round`·`poll`·`post`).
    /// **웹의 `CARD_PATHS`와 같은 이름이다** — 여기서 SF Symbol로 옮겨 그린다.
    let icon: String?
    /// 인용(답장)의 머리말(`박승수에게 댓글`). 없으면 인용이 없는 줄이다.
    let quoteWho: String?
    /// 인용의 원문 **한 줄**. 웹이 이미 잘라서 준다(가린 글은 `가려진 메시지`).
    let quoteText: String?
    /// 인용을 누르면 갈 **원본 글의 id**. 없으면 안 눌린다(아직 안 받아 온
    /// 지난 묶음의 원본 — 웹 목록에서도 그 자리는 안 움직인다).
    let quoteTo: String?
    /// 말풍선 아래 반응 알약. 비어 있으면 **줄 자체를 안 그린다**.
    let reacts: [ChatReact]
    /// 이 줄 **위에** `여기까지 읽으셨습니다`를 긋는가.
    let mark: Bool
    /**
     * 이 줄 **위에 띄울 자리**(웹의 `.chat-row`의 `margin-top`).
     *
     * **웹이 알려 주는 값이다 — 여기서 셈하지 말 것.** 예전에는 모든 줄에
     * 4px을 박아 두었는데 웹은 **다른 사람 사이 10px · 같은 사람 잇따라
     * 2px**이라, 줄마다 6px씩 어긋나 **아래로 갈수록 쌓였다.** 길게 누르는
     * 창이 뜨면 앱 목록을 감추고 웹 목록으로 바꿔치기하는데 그때 그
     * 어긋남이 통째로 드러난다(사용자 제보 · 사진 두 장 — `팝업이 있을때와
     * 없을때 프로필이나 말풍선 위치가 틀어져`).
     */
    let top: CGFloat
    /**
     * 올리는 중이면 그 진행률. **그림 위에 어두운 막과 고리, 가운데에
     * `✕`(그만두기), 아래에 `0.24 / 4.15MB`가 얹힌다** — 카톡의 그 자리다.
     *
     * `var`인 것은 **신호가 올 때마다 줄을 통째로 다시 만들지 않으려는
     * 것이다**(초에 수십 번 온다). `ChatList.markUpload`가 이 값만 갈아
     * 끼우고 보이는 칸의 고리·글자만 고친다.
     */
    var upload: ChatUpload?

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
        /* **주소 하나로 가른다** — 줄을 만드는 쪽이 따로 표를 안 세워도
           되고, 옛 줄에도 그대로 먹는다. */
        video = kind == .photo && ChatMedia.isVideo(image)
        cap = d["cap"] as? String
        big = (d["big"] as? Bool) ?? false
        go = d["go"] as? String
        to = d["to"] as? String
        icon = d["icon"] as? String
        quoteWho = d["quoteWho"] as? String
        quoteText = d["quoteText"] as? String
        quoteTo = d["quoteTo"] as? String
        mark = (d["mark"] as? Bool) ?? false
        /* 못 받았으면 예전처럼 군다 — 옛 웹이 붙은 판에서 줄이 겹치면 안 된다. */
        top = CGFloat((d["top"] as? Double) ?? 4)
        if let job = d["upload"] as? [String: Any],
           let total = job["total"] as? Int64, total > 0 {
            upload = ChatUpload(sent: (job["sent"] as? Int64) ?? 0, total: total)
        }
        /* `@이름` 자리 — **웹은 벌써 파랗게 칠하고 있었는데 앱 말풍선만
           검은 글자였다.** 못 받았으면 빈 배열이라 예전 그대로다. */
        mentions = ((d["mentions"] as? [[String: Any]]) ?? []).compactMap {
            guard let at = $0["at"] as? Int, let len = $0["len"] as? Int, len > 0 else { return nil }
            return ChatMention(range: NSRange(location: at, length: len),
                               mine: ($0["mine"] as? Bool) ?? false)
        }
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
    /// 카드의 `보러 가기 ›` 한 줄과 머리 배지. 잔디 초록(`--grass-deep`)이다 —
    /// 좋은 상태 몫이고, **분홍을 쓰지 말 것**(이 화면에서 '지금 눌러야 할
    /// 것'은 보내기 하나다).
    var link = UIColor(red: 0x5b / 255, green: 0x8d / 255, blue: 0x18 / 255, alpha: 1)
    /// 배지의 옅은 칠(웹의 `--grass-soft`).
    var linkSoft = UIColor(red: 0x7c / 255, green: 0xb8 / 255, blue: 0x28 / 255, alpha: 0.16)
    var card = UIColor.white
    /// 눌리는 카드의 잔디빛 칠. **`card`를 물들이지 말 것** — 그 값은 길게
    /// 누른 창의 카드(`HoldMenu`)도 같이 쓴다.
    var cardTint = UIColor(red: 0xe9 / 255, green: 0xf3 / 255, blue: 0xda / 255, alpha: 1)
    /// 그 카드 배지의 꽉 찬 칠(웹의 `--grass`). 그림은 흰색으로 뒤집는다.
    var cardBadge = UIColor(red: 0x7c / 255, green: 0xb8 / 255, blue: 0x28 / 255, alpha: 1)
    /// 카드 안의 가는 선(`보러 가기 ›` 위). 흰 바탕 위라 `--line` 그대로다.
    var cardRule = UIColor(red: 0xdd / 255, green: 0xe3 / 255, blue: 0xd1 / 255, alpha: 1)
    /// 인용 안의 가는 선. **`--line`을 쓰지 말 것** — 흰 말풍선에만 맞는 값이라
    /// **내 노란 말풍선 위에서는 안 보인다.** 검정 10%는 둘 다에서 같게 보인다.
    var quoteRule = UIColor(white: 0, alpha: 0.1)
    /// 반응 알약에서 **내가 누른 것**의 테두리(분홍 `--brand`).
    /// 이 화면에서 분홍은 보내기 단추 몫이라, **칠하지 않고 테두리로만** 쓴다.
    var brand = UIColor(red: 0xe8 / 255, green: 0x4a / 255, blue: 0x7f / 255, alpha: 1)
    /// `최근 대화로` 줄(웹의 `.chat-jump`). **분홍을 쓰지 않는다** — 흰 알약이다.
    var jumpBg = UIColor.white
    var jumpLine = UIColor(white: 0, alpha: 0.1)
    var jumpDim = UIColor(red: 0x5b / 255, green: 0x64 / 255, blue: 0x55 / 255, alpha: 1)
    var jumpH: CGFloat = 38
    var jumpSize: CGFloat = 13
    /// 굴릴 때 오른쪽에 뜨는 날짜 알약(카톡의 그것). **카톡 화면을 픽셀로
    /// 재서 맞춘 값이다**(1206×2622 · 배율 3.0): 높이 66px → 22 ·
    /// 오른쪽 10px → 4 · 칠은 검정 40%(보라 위에서 `115→68`로 재서 얻었다).
    /// **흰 칩(`chip`)을 쓰지 말 것** — 그것은 목록에 섞여 흐르는 날짜 칸
    /// 몫이고, 이 알약은 그 위에 떠서 읽혀야 한다.
    var dateH: CGFloat = 22
    var dateSize: CGFloat = 13
    var dateBg = UIColor(white: 0, alpha: 0.4)
    /// 길게 누른 창의 `삭제` 줄(27판 · 웹의 `--danger`). 되돌릴 수 없는
    /// 일이라 그 줄만 색으로 갈라 둔다 — **분홍이 아니다.**
    var danger = UIColor(red: 0xd1 / 255, green: 0x3c / 255, blue: 0x3c / 255, alpha: 1)

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
    /// 이름 줄이 차지하는 높이(38판). **웹과 같은 셈이다** — `.chat-who`는
    /// 뿌리 `line-height: 1.5`를 물려받아 `13.5 × 1.5`이고, 그 아래
    /// `.chat-col`의 `gap: 2px`이 말풍선과의 사이다. 예전에는 `+5`(18.5)로
    /// 두어 웹(22.25)보다 이름 있는 줄마다 3.75px씩 짧았고, 뒤로 끌어
    /// 돌아올 때 웹 그림과 앱 목록이 바뀌는 순간 말풍선이 그만큼 튀었다.
    /// 글꼴과 무관한 값이라(줄 높이 배율) 여기서 맞춰도 폰에서 어긋나지 않는다.
    var nameLine: CGFloat { nameSize * 1.5 + 2 }
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
    /// 눌리는 카드(라운드·투표·공지). **웹의 `.chat-result`와 같은 값이다** —
    /// 길게 누르는 창이 뜰 때 웹 목록으로 바꿔치기하는 판이 아직 남아 있어
    /// (28판 아래 앱) 두 카드가 같아 보여야 한다. 한쪽만 고치지 말 것.
    var cardW: CGFloat = 320
    var cardPad: CGFloat = 13
    var cardRadius: CGFloat = 16
    var cardIconSize: CGFloat = 34
    var cardIconGap: CGFloat = 10
    var cardHead: CGFloat = 11.5
    var cardTitle: CGFloat = 16
    var cardNote: CGFloat = 12.5
    var cardGo: CGFloat = 12

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
        c("link", &link); c("linkSoft", &linkSoft)
        c("card", &card); c("cardRule", &cardRule)
        c("cardTint", &cardTint); c("cardBadge", &cardBadge)
        c("quoteRule", &quoteRule); c("brand", &brand)
        c("jumpBg", &jumpBg); c("jumpLine", &jumpLine); c("jumpDim", &jumpDim)
        c("danger", &danger)
        n("pad", &pad); n("avatar", &avatar); n("avatarGap", &avatarGap)
        n("radius", &radius); n("fontSize", &fontSize); n("lineHeight", &lineHeight)
        n("padH", &padH); n("padV", &padV); n("nameSize", &nameSize)
        n("stampSize", &stampSize); n("maxRatio", &maxRatio)
        n("photoW", &photoW); n("photoH", &photoH); n("photoRadius", &photoRadius)
        n("sticker", &sticker); n("bigSize", &bigSize)
        n("quoteSize", &quoteSize); n("quoteLine", &quoteLine); n("reactH", &reactH)
        n("jumpH", &jumpH); n("jumpSize", &jumpSize)
        n("cardW", &cardW); n("cardPad", &cardPad); n("cardRadius", &cardRadius)
        n("cardIconSize", &cardIconSize); n("cardIconGap", &cardIconGap)
        n("cardHead", &cardHead); n("cardTitle", &cardTitle)
        n("cardNote", &cardNote); n("cardGo", &cardGo)
    }
}

// MARK: - 눌리는 카드 (웹의 `LinkCard`)

/**
 * 카드 글을 웹의 `LinkCard`와 **같은 규칙으로** 가른다(34판).
 *
 * **줄을 세는 것이 아니라 `icon`으로 갈린다** — 글 모양이 갈래마다 정해져
 * 있는데 줄 수로 가리면 **공지의 본문 첫 줄이 제목 자리에 앉는다**(웹에서
 * 실제로 그렇게 짜 봤다가 갈아엎은 자리다).
 *
 * - **라운드** — 둘째 줄이 알약(곳 이름), 셋째 줄을 `·`로 갈라 **첫 조각이
 *   큰 제목**(날짜)이고 나머지가 그림 붙은 칩이다. `모집을 열었습니다`처럼
 *   **두 줄뿐인 것**(DB 트리거)은 곳 이름이 곧 제목이 된다.
 * - **투표 · 공지** — 둘째 줄이 제목이고 나머지는 있는 대로 곁줄이다.
 *
 * **한쪽만 고치지 말 것** — `Chat.tsx`의 `LinkCard`와 한 벌이다.
 */
struct CardParts {
    /// `○○님이 …했습니다` — **맨 아래, 가는 선 밑**이다(그림의 그 차례).
    var by = ""
    /// 곳 이름 알약(라운드만).
    var pill: String?
    var title = ""
    /// 그림 붙은 곁줄 칩(시각·정원·자리).
    var chips: [String] = []
    /// 투표·공지의 곁줄(1위 줄 · 본문 첫 줄).
    var notes: [String] = []
    /// 아랫줄에 `○○님이 …`를 적는가 — 한 줄짜리 글에는 안 적는다.
    var showBy = false

    static func parse(_ body: String, icon: String?) -> CardParts {
        var p = CardParts()
        let lines = body.components(separatedBy: "\n").filter { !$0.isEmpty }
        guard let foot = lines.first else { return p }
        p.by = foot
        p.title = foot
        let rest = Array(lines.dropFirst())
        p.showBy = !rest.isEmpty
        if icon == "round", rest.count >= 2 {
            p.pill = rest[0]
            let segs = rest.dropFirst().joined(separator: " · ")
                .components(separatedBy: "·")
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
            p.title = segs.first ?? rest[0]
            p.chips = Array(segs.dropFirst())
        } else if let t = rest.first {
            p.title = t
            p.notes = Array(rest.dropFirst())
        }
        return p
    }
}

/**
 * 곁줄 칩 앞의 작은 그림 — **글을 보고 고른다**(웹의 `ChipIcon`과 같은 잣대).
 * 시각이면 시계, 사람 수면 사람, **모르는 것에는 안 붙인다**(억지로 붙이면
 * 뜻이 어긋난 그림이 선다).
 */
func cardChipSymbol(_ text: String) -> String? {
    if text.range(of: "오전|오후|[0-9]\\s*:\\s*[0-9]", options: .regularExpression) != nil {
        return "clock"
    }
    if text.range(of: "정원|자리|명|인", options: .regularExpression) != nil {
        return "person.2"
    }
    return nil
}

/// 카드에 쓰는 글꼴. 굵기는 웹의 `font-weight`를 그대로 옮긴 것이다.
struct CardFonts {
    let pill: UIFont, title: UIFont, chip: UIFont, note: UIFont, by: UIFont, go: UIFont

    init(_ s: ChatSkin) {
        pill = .systemFont(ofSize: s.cardHead, weight: .heavy)    // 800
        title = .systemFont(ofSize: s.cardTitle, weight: .heavy)  // 800
        chip = .systemFont(ofSize: s.cardNote, weight: .semibold) // 600
        note = .systemFont(ofSize: s.cardNote, weight: .regular)
        by = .systemFont(ofSize: s.cardHead, weight: .bold)       // 700
        go = .systemFont(ofSize: s.cardGo, weight: .heavy)        // 800
    }
}

/// 글 한 덩이의 크기. `lines`를 주면 그 줄 수에서 자른다(웹의 말줄임 자리).
func cardText(_ s: String, font: UIFont, width: CGFloat, lines: Int = 0) -> CGSize {
    if s.isEmpty { return .zero }
    let r = (s as NSString).boundingRect(
        with: CGSize(width: max(1, width), height: .greatestFiniteMagnitude),
        options: [.usesLineFragmentOrigin, .usesFontLeading],
        attributes: [.font: font], context: nil)
    var h = ceil(r.height)
    if lines > 0 { h = min(h, ceil(font.lineHeight) * CGFloat(lines)) }
    return CGSize(width: ceil(r.width), height: h)
}

/// 카드 한 장의 자리.
struct CardBox {
    var badge = CGRect.zero
    var pill = CGRect.zero
    var title = CGRect.zero
    var chips: [CGRect] = []
    var notes: [CGRect] = []
    var rule = CGRect.zero
    var by = CGRect.zero
    var go = CGRect.zero
    var height: CGFloat = 0
}

/**
 * 웹의 `.chat-result` 격자를 그대로 옮긴 셈이다 — 배지 오른쪽에 글이 서고,
 * 가는 선 아래에 `○○님이 …`와 알약 단추가 나란히 선다.
 *
 * **높이 셈과 배치가 이 한 함수에서 나온다** — 두 곳에서 따로 셈하면
 * 언젠가 어긋나 글이 제 칸 밖으로 밀려 나간다(26판에서 겪은 그 자리다).
 */
func cardBox(_ p: CardParts, go: String, skin s: ChatSkin, width cw: CGFloat) -> CardBox {
    let f = CardFonts(s)
    let pad = s.cardPad
    let icon = s.cardIconSize
    let x = pad + icon + s.cardIconGap
    let w = max(1, cw - x - pad)       // 글이 쓸 폭
    let inner = cw - pad * 2
    let gap: CGFloat = 3               // 웹 `.chat-result-body`의 `gap: 3px`
    var box = CardBox()
    box.badge = CGRect(x: pad, y: pad, width: icon, height: icon)

    var y = pad
    if let pill = p.pill {
        /* 알약은 안여백 `3px 9px`이고 **한 줄로 자른다**(웹과 같다). */
        let t = cardText(pill, font: f.pill, width: max(1, w - 18), lines: 1)
        box.pill = CGRect(x: x, y: y, width: min(w, t.width + 18), height: t.height + 6)
        y = box.pill.maxY + gap
    }
    let th = cardText(p.title, font: f.title, width: w).height
    box.title = CGRect(x: x, y: y, width: w, height: th)
    y = box.title.maxY

    if !p.chips.isEmpty {
        y += gap + 1                   // 웹의 `margin-top: 1px`
        let rowH = ceil(f.chip.lineHeight)
        var cx: CGFloat = 0, cy: CGFloat = 0
        for c in p.chips {
            var wd = cardText(c, font: f.chip, width: w, lines: 1).width
            if cardChipSymbol(c) != nil { wd += 17 }   // 그림 13 + 사이 4
            wd = min(wd, w)
            if cx > 0 && cx + wd > w { cx = 0; cy += rowH + 3 }
            box.chips.append(CGRect(x: x + cx, y: y + cy, width: wd, height: rowH))
            cx += wd + 10              // 칩 사이 10px
        }
        y += cy + rowH
    }
    if !p.notes.isEmpty {
        /* 곁줄은 **한 덩이로 그린다**(글상자 하나) — 줄마다 칸을 두면 줄
           사이가 벌어져 웹과 달라진다. */
        y += gap
        let h = cardText(p.notes.joined(separator: "\n"), font: f.note, width: w).height
        box.notes = [CGRect(x: x, y: y, width: w, height: h)]
        y += h
    }

    /* 배지보다 글이 짧을 수 있어 윗줄 높이는 **둘 중 큰 쪽**이다. */
    let bodyH = max(y - pad, icon)
    var fy = pad + bodyH + 11          // 웹 `.chat-result-foot`의 `margin-top`
    box.rule = CGRect(x: pad, y: fy, width: inner, height: 1)
    fy += 1 + 9                        // 선 + `padding-top`
    /* 알약 단추는 안여백 `7px 12px`. `○○님이 …`는 **두 줄까지 편다** —
       말줄임으로 자르면 누가 무엇을 했는지가 사라진다. */
    let gt = cardText(go, font: f.go, width: inner, lines: 1)
    let gw = go.isEmpty ? 0 : min(inner, gt.width + 24)
    let gh = go.isEmpty ? 0 : gt.height + 14
    let bw = max(1, inner - (gw > 0 ? gw + 8 : 0))
    let bh = p.showBy ? cardText(p.by, font: f.by, width: bw, lines: 2).height : 0
    let footH = max(bh, gh)
    if p.showBy {
        box.by = CGRect(x: pad, y: fy + (footH - bh) / 2, width: bw, height: bh)
    }
    if gw > 0 {
        box.go = CGRect(x: cw - pad - gw, y: fy + (footH - gh) / 2, width: gw, height: gh)
    }
    box.height = fy + footH + pad
    return box
}

/// 곁줄 칩 하나(`🕐 오전 7:30`) — 그림과 글이 한 줄에 선다.
final class CardChip: UIView {
    let icon = UIImageView()
    let label = UILabel()

    override init(frame: CGRect) {
        super.init(frame: frame)
        icon.contentMode = .scaleAspectFit
        label.lineBreakMode = .byTruncatingTail
        addSubview(icon)
        addSubview(label)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func layoutSubviews() {
        super.layoutSubviews()
        let has = icon.image != nil
        icon.frame = has
            ? CGRect(x: 0, y: (bounds.height - 13) / 2, width: 13, height: 13)
            : .zero
        let lx: CGFloat = has ? 17 : 0
        label.frame = CGRect(x: lx, y: 0, width: max(0, bounds.width - lx),
                             height: bounds.height)
    }
}

protocol ChatListDelegate: AnyObject {
    /// 맨 아래에 있는가 · 맨 위에 닿았는가(지난 대화를 더 받아야 한다) ·
    /// `최근 대화로` 줄을 띄울 만큼 멀어졌는가.
    func chatListState(atBottom: Bool, atTop: Bool, far: Bool)
    /// 키보드를 내려 달라 — 목록을 아래로 끌었거나 목록을 눌렀다.
    func chatListDismissKeyboard()
    /// 무엇인가를 눌렀다 — 사진(크게 보기) · 카드(그 화면으로) · 반응 알약 ·
    /// 얼굴(프로필 카드) · 왼쪽으로 밀기(댓글) · **오른쪽으로 밀기(뒤로)**.
    /// **앱이 스스로 하지 않고 웹에 넘긴다** — 하는 일이 전부 웹에 이미 있는
    /// 길이고, 두 벌로 만들면 한쪽만 고치게 된다.
    func chatListTap(kind: String, id: String, to: String?)
    /// 말풍선을 길게 눌렀다 — **누른 자리에** 고르는 창이 떠야 하므로
    /// 말풍선의 자리를 **창(화면) 좌표로** 함께 넘긴다.
    func chatListHold(id: String, mine: Bool, rect: CGRect)

    /* ── 손가락을 따라 뒤로 가기(35판) ─────────────────────────
     *
     * **끄는 그림은 앱이 옮긴다**(`BackDrag`). 25판까지는 놓을 때 한 번만
     * 보고 곧바로 넘어갔는데, 나머지 열아홉 화면은 손가락을 따라오므로
     * **대화방만 툭 넘어가는 것이 눈에 걸렸다**(사용자 요청 —
     * `되돌아가기할때 손따라 오면서 되는건 안되는거야?`).
     *
     * 목록은 여기서 손짓만 잡고 **하는 일은 다리가 맡는다** — 그림을
     * 옮기는 것도, 웹에 알리는 것도 `root`·웹뷰를 아는 쪽이라야 한다.
     */

    /// 끌 준비가 됐는가. **거짓이면 예전처럼** 놓을 때 한 번만 보고 넘어간다
    /// (스위치가 꺼져 있거나 뒤에 깔 앞 화면이 없을 때다).
    func chatListBackBegan() -> Bool
    /// 손가락이 움직였다 — 오른쪽으로 간 만큼(pt).
    func chatListBackMoved(dx: CGFloat)
    /// 손을 뗐다. `cancelled`면 손짓이 끊긴 것이라 그대로 접는다.
    func chatListBackEnded(dx: CGFloat, vx: CGFloat, cancelled: Bool)
}

// MARK: - 목록

final class ChatList: UIView, UITableViewDataSource, UITableViewDelegate {

    weak var listDelegate: ChatListDelegate?

    private let table = UITableView(frame: .zero, style: .plain)
    /// `최근 대화로` 줄. 목록 위에 떠 있다 — 웹이 그리면 앱 목록에 가린다.
    private let jumpBar = JumpBar()
    /**
     * 굴릴 때 오른쪽에 뜨는 날짜 알약(사용자 요청 — `채팅내용 스크롤할때
     * 카톡처럼 날짜나오게해줘` · 카톡 사진을 받아 픽셀로 맞췄다).
     *
     * **글자는 날짜 칸(`ChatRow.date`)에서 그대로 온다** — 여기서 날짜를
     * 다시 만들지 말 것. 그 값은 `NativeChatService`가 한 곳에서 짓고
     * 목록에 흐르는 칸도 같은 글자를 쓴다(두 군데가 되면 어긋난다).
     *
     * **세로 자리는 스크롤 막대에 맞춘다** — 카톡이 그 자리에 띄운다.
     * 굴리기가 멎고 `dateWait`가 지나면 스스로 사라진다.
     */
    private let datePill = PadLabel()
    private var dateHide: DispatchWorkItem?
    private let dateWait = 1.2
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
    // 배치 중 UITableView가 보내는 중간 위치를 사용자 스크롤로 취급하지 않는다.
    private var changingViewport = false

    private struct Viewport {
        let bottom: Bool
        let offset: CGFloat
        let anchors: [(id: String, offset: CGFloat)]
    }

    private func viewport() -> Viewport {
        let y = table.contentOffset.y
        let anchors = (table.indexPathsForVisibleRows ?? []).sorted().compactMap { ip -> (id: String, offset: CGFloat)? in
            guard ip.row < rows.count else { return nil }
            return (rows[ip.row].id, y - table.rectForRow(at: ip).minY)
        }
        return Viewport(bottom: below() <= 1, offset: y, anchors: anchors)
    }

    // 42판: 탭을 떠나기 전의 위치는 UIKit이 보관한다. 웹 픽셀값으로 재해석하지 않는다.
    private var sessionKey: String?
    private var pausedViewport: Viewport?
    private var pendingViewport: Viewport?
    private var pausedPosition: [String: Any]?

    func pauseSession() {
        guard pausedViewport == nil, superview != nil,
              !rows.isEmpty || pendingViewport != nil else { return }
        dropSpot()
        let saved = pendingViewport ?? viewport()
        pausedViewport = saved
        var position: [String: Any] = ["atBottom": saved.bottom]
        if let spot = saved.anchors.first {
            position["topId"] = spot.id
            position["off"] = Double(spot.offset + table.adjustedContentInset.top)
        }
        pausedPosition = position
    }

    func departurePosition() -> [String: Any] {
        pauseSession()
        return pausedPosition ?? ["atBottom": true]
    }

    func beginSession(_ key: String?) -> Bool {
        /* 끌다가 화면이 걷힌 판을 대비해 잠금을 여기서도 푼다 — 잠긴 채로
           남으면 목록이 통째로 안 굴러간다(`lockList` 주석). */
        table.isScrollEnabled = true
        backOffset = nil
        let resume = key != nil && key == sessionKey && pausedViewport != nil
        pendingViewport = resume ? pausedViewport : nil
        pausedViewport = nil
        pausedPosition = nil
        if key != sessionKey {
            dropSpot()
            rows = []
            heights.removeAll()
            table.reloadData()
        }
        sessionKey = key
        return resume
    }

    func restoreSession() {
        guard let saved = pendingViewport else { return }
        table.layoutIfNeeded()
        restore(saved)
    }

    private func placeOffset(_ y: CGFloat) {
        let low = -table.adjustedContentInset.top
        let high = max(low, table.contentSize.height - table.bounds.height + table.adjustedContentInset.bottom)
        table.setContentOffset(CGPoint(x: 0, y: min(high, max(low, y))), animated: false)
    }

    private func restore(_ saved: Viewport, followBottom: Bool = true) {
        if saved.bottom && followBottom {
            placeOffset(table.contentSize.height - table.bounds.height + table.adjustedContentInset.bottom)
        } else if let anchor = saved.anchors.first(where: { a in rows.contains { $0.id == a.id } }),
                  let index = rows.firstIndex(where: { $0.id == anchor.id }) {
            placeOffset(table.rectForRow(at: IndexPath(row: index, section: 0)).minY + anchor.offset)
        } else {
            placeOffset(saved.offset)
        }
    }

    private func preservingViewport(followBottom: Bool = true, _ change: () -> Void) {
        let saved = viewport()
        changingViewport = true
        UIView.performWithoutAnimation {
            change()
            table.layoutIfNeeded()
            restore(saved, followBottom: followBottom)
        }
        changingViewport = false
        report()
    }
    /// 아래로 이만큼 끌면 키보드를 내린다(웹의 `dy > 40`과 같은 값).
    private let dragToHide: CGFloat = 40
    /// 오른쪽으로 이만큼 밀면 뒤로 간다(웹 `plainBack`의 `PLAIN_TAKE`와 같은 값).
    private let backAt: CGFloat = 60
    /// 그 손짓의 문지기 — **오른쪽으로 그은 것만** 받는다(`BackGuard` 참고).
    private let backGuard = BackGuard()
    /// 지금 **손가락을 따라** 끌고 있는가(35판). 거짓이면 25판처럼 놓을 때
    /// 한 번만 보고 넘어간다 — 한 손짓 안에서 갈래가 안 바뀌어야 하므로
    /// `.began`에서 한 번 정하고 그대로 간다.
    private var backLive = false
    /**
     * **끌기 시작할 때의 굴린 자리**(44판).
     *
     * 이 손짓과 목록의 굴리기는 **함께 알아채진다**(`BackGuard`의
     * `shouldRecognizeSimultaneouslyWith`가 참이다) — 그래서 오른쪽으로 미는
     * 동안 손끝이 조금만 아래로 흘러도 **목록이 그만큼 함께 굴러갔다.**
     * 끄는 동안에는 화면이 감춰져 있어(`BackDrag.begin`의 `cover`) 눈에
     * 안 보이다가, 놓고 되돌아오면 그 자리에서 **살짝 내려가 있고 되풀이하면
     * 계속 내려갔다**(사용자 제보 — `살짝 끌었다놨을때 대화목록이 살짝 내려감`).
     *
     * 그래서 끌기가 시작되면 **목록을 잠그고**(`isScrollEnabled`) 시작할 때의
     * 자리를 적어 둔다 — 잠그는 것이 목록의 손짓을 그 자리에서 끊으므로
     * 놓은 뒤에 미끄러지지도 않는다. 잠기기 전에 새어 든 몇 픽셀은 이 값으로
     * 되돌린다.
     */
    private var backOffset: CGPoint?

    /// 되돌려 놓을 자리(34판의 `holdSpot`) — 높이가 정해질 때까지 다시 놓는다.
    private var spotAim: (id: String, off: CGFloat)?
    private var spotUntil: CFTimeInterval = 0
    private var spotSize: CGFloat = -1
    private var spotFit: CGFloat = -1
    private var spotLink: CADisplayLink?

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

        /* **오른쪽으로 밀면 뒤로 간다**(25판).
           웹 목록에 있던 그 손짓인데(`useBackSwipe`), 앱 목록은 웹뷰 **위에
           얹힌 앱 부품**이라 그 자리의 터치가 웹에 아예 안 닿는다 — 그래서
           **머리말에서는 밀리는데 말풍선 자리에서만 안 먹었다**(사용자 제보
           — `상단에 돋보기 있는 그 라인을 잡고 우측으로 밀면 되돌리기가
           되는데 채팅창 잡고 오른쪽으로 밀면 되돌아가기가 안 돼`).
           **끌리는 것 없이 곧바로 간다** — 웹의 `plainBack()`과 같은 잣대다
           (네이티브 부품이 웹의 `transform`을 안 따라와 찢어져 보인다).
           `cancelsTouchesInView`를 끄는 것은 위 탭과 같은 까닭이다. */
        let back = UIPanGestureRecognizer(target: self, action: #selector(backPan))
        back.delegate = backGuard
        back.cancelsTouchesInView = false
        table.addGestureRecognizer(back)

        jumpBar.isHidden = true
        jumpBar.addTarget(self, action: #selector(jumpTapped), for: .touchUpInside)
        addSubview(jumpBar)

        /* 날짜 알약 — **누를 일이 없으므로 손짓을 안 받는다**(밑의 말풍선이
           그대로 눌려야 한다). */
        datePill.isHidden = true
        datePill.isUserInteractionEnabled = false
        datePill.textAlignment = .center
        datePill.layer.masksToBounds = true
        addSubview(datePill)
    }

    @objc private func tapped() { listDelegate?.chatListDismissKeyboard() }

    /**
     * 오른쪽으로 밀어 뒤로 가기(25판 · **35판에서 손가락을 따라온다**).
     *
     * **하는 일은 웹이 정한다** — 앱은 `back`을 눌렀다고만 알리고, 어디로
     * 갈지는 `goBack()`이 이미 안다(히스토리가 비었으면 홈으로 간다).
     *
     * **갈래가 둘이다.** 다리가 끌 준비를 해 주면(`chatListBackBegan`)
     * 움직임마다 알려 손가락을 따라 화면이 나오고, 못 하면 **25판 그대로**
     * 놓을 때 한 번만 보고 곧바로 넘어간다 — 스위치가 꺼져 있거나 뒤에
     * 깔 앞 화면이 없을 때다.
     */
    @objc private func backPan(_ g: UIPanGestureRecognizer) {
        let t = g.translation(in: self)
        switch g.state {
        case .began:
            backLive = listDelegate?.chatListBackBegan() ?? false
            /* **끄는 동안 목록은 잠근다**(44판 · `backOffset` 주석).
               손끝이 아래로 흘러도 목록이 따라 굴러가면 안 된다. */
            if backLive { lockList() }
        case .changed:
            if backLive { listDelegate?.chatListBackMoved(dx: max(0, t.x)) }
        case .ended, .cancelled, .failed:
            if backLive {
                backLive = false
                unlockList()
                listDelegate?.chatListBackEnded(dx: max(0, t.x),
                                                vx: g.velocity(in: self).x,
                                                cancelled: g.state != .ended)
            } else if g.state == .ended, t.x >= backAt, t.x > abs(t.y) {
                listDelegate?.chatListTap(kind: "back", id: "", to: nil)
            }
        default:
            break
        }
    }

    /// 목록을 그 자리에 붙든다 — 잠그는 것이 굴리기 손짓을 끊어 놓은 뒤에
    /// 미끄러지지도 않는다.
    private func lockList() {
        guard backOffset == nil else { return }
        backOffset = table.contentOffset
        table.isScrollEnabled = false
    }

    /// 잠금을 풀고 **시작할 때의 자리로 되돌린다** — 잠기기 전에 새어 든
    /// 몇 픽셀이 쌓이지 않게. 되돌리는 동안은 사람이 굴린 것이 아니므로
    /// `changingViewport`로 가려 둔다.
    private func unlockList() {
        table.isScrollEnabled = true
        guard let at = backOffset else { return }
        backOffset = nil
        guard table.contentOffset != at else { return }
        let was = changingViewport
        changingViewport = true
        table.setContentOffset(at, animated: false)
        changingViewport = was
    }

    /**
     * 들어올 때 오른쪽에서 미끄러져 들어온다(25판 · 웹의 `screen-in`).
     *
     * **남은 시간만큼만 움직인다**(`ms` — 웹의 `slideLeft()`). 앱 목록은
     * 웹 화면이 그려진 **뒤에** 서므로 늘 한두 프레임 늦는데, 제 시간
     * (웹의 `SCREEN_MS`)을 그대로 돌면 머리말보다 늦게 끝나 **두 단계로
     * 보인다.**
     * 끝을 맞추는 것이 눈에 걸리는 전부라 시작이 조금 어긋나는 것은 둔다.
     *
     * 값(40px · `cubic-bezier(.32,.72,0,1)`)은 `global.css`의 `screen-in`
     * 그대로다 — **한쪽만 고치지 말 것.**
     */
    func slideIn(ms: Double) {
        guard ms >= 40 else { return }
        transform = CGAffineTransform(translationX: 40, y: 0)
        alpha = 0
        let curve = UICubicTimingParameters(
            controlPoint1: CGPoint(x: 0.32, y: 0.72),
            controlPoint2: CGPoint(x: 0, y: 1))
        let a = UIViewPropertyAnimator(duration: ms / 1000, timingParameters: curve)
        a.addAnimations { self.transform = .identity; self.alpha = 1 }
        /* 어떤 까닭으로 끊겨도 제자리에 놓는다 — 반쯤 밀린 채로 굳으면
           목록이 통째로 어긋난 것처럼 보인다. */
        a.addCompletion { _ in self.transform = .identity; self.alpha = 1 }
        a.startAnimation()
    }

    required init?(coder: NSCoder) { fatalError() }

    override func layoutSubviews() {
        super.layoutSubviews()
        let before = table.frame.size
        let saved = viewport()
        let wasChanging = changingViewport
        changingViewport = true
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
        if before != bounds.size {
            table.layoutIfNeeded()
            restore(saved)
        }
        changingViewport = wasChanging
        if !wasChanging { report() }
        /* `최근 대화로` 동그라미는 **목록 오른쪽 아래에 떠 있다**(웹의
           `.chat-jump`가 입력칸 바로 위에 뜨는 그 자리다 — 여기서는 목록
           아랫변이 곧 바 윗변이라 같은 자리가 된다).
           **카톡 화면을 픽셀로 재서 맞춘 값이다**(1206×2622 · 배율 3.0):
           지름 114px → 38 · 오른쪽 30px → 10 · 바까지 25px → 8.
           눈대중으로 고치지 말 것. */
        if !jumpBar.isHidden {
            jumpBar.frame = CGRect(x: bounds.width - skin.jumpH - 10,
                                   y: bounds.height - skin.jumpH - 8,
                                   width: skin.jumpH, height: skin.jumpH)
        }
        if !datePill.isHidden { placeDate() }
    }

    // MARK: 날짜 알약

    /**
     * 굴리는 동안 오른쪽에 날짜를 띄운다(카톡과 같다).
     *
     * **날짜를 여기서 만들지 않는다** — 화면 맨 위에 걸린 줄에서 위로 훑어
     * 가장 가까운 날짜 칸(`ChatRow.date`)을 그대로 쓴다. 그 글자를 짓는
     * 곳은 `NativeChatService` 한 곳이고, 목록에 흐르는 칸도 같은 값이라
     * 알약과 칸이 어긋날 자리가 아예 없다.
     */
    private func showDate() {
        guard rows.count > 0, table.contentSize.height > table.bounds.height + 1 else { return }
        guard let top = table.indexPathsForVisibleRows?.first,
              let label = dayLabel(at: top.row), !label.isEmpty else { return }
        if datePill.text != label {
            datePill.text = label
            datePill.font = .systemFont(ofSize: skin.dateSize, weight: .medium)
            datePill.textColor = .white
            datePill.backgroundColor = skin.dateBg
        }
        datePill.isHidden = false
        datePill.alpha = 1
        placeDate()
        dateHide?.cancel()
        let job = DispatchWorkItem { [weak self] in
            guard let self = self, !self.datePill.isHidden else { return }
            UIView.animate(withDuration: 0.25, animations: { self.datePill.alpha = 0 },
                           completion: { _ in self.datePill.isHidden = true })
        }
        dateHide = job
        DispatchQueue.main.asyncAfter(deadline: .now() + dateWait, execute: job)
    }

    /// 그 줄이 속한 날 — 날짜 칸이 붙은 가장 가까운 윗줄에서 가져온다.
    private func dayLabel(at i: Int) -> String? {
        var j = min(i, rows.count - 1)
        while j >= 0 {
            if let d = rows[j].date { return d }
            j -= 1
        }
        return nil
    }

    /**
     * **세로 자리는 스크롤 막대에 맞춘다** — 카톡이 그 자리에 띄운다
     * (사용자가 준 사진에서 알약이 막대 옆 한가운데 있었다).
     * 가로는 오른쪽 끝에 거의 붙인다(재 보니 10px = 4).
     */
    private func placeDate() {
        let h = skin.dateH
        let fit = datePill.sizeThatFits(CGSize(width: bounds.width, height: h))
        let w = min(max(fit.width, 56), bounds.width - 40)
        let vh = table.bounds.height
        let content = max(table.contentSize.height, vh)
        let frac = max(0, min(1, table.contentOffset.y / max(1, content - vh)))
        let barH = max(40, vh * vh / content)
        var cy = (vh - barH) * frac + barH / 2
        cy = max(h / 2 + 8, min(vh - h / 2 - 8, cy))
        datePill.frame = CGRect(x: bounds.width - w - 4, y: cy - h / 2, width: w, height: h)
        datePill.layer.cornerRadius = h / 2
    }

    // MARK: 웹이 부르는 것

    func apply(skin d: [String: Any]) {
        preservingViewport {
            skin.apply(d)
            backgroundColor = skin.bg
            heights.removeAll()
            table.reloadData()
        }
    }

    /**
     * 줄을 갈아 끼운다.
     *
     * **맨 아래를 보고 있었으면 맨 아래로 따라간다**(새 글이 올 때).
     * **지난 대화를 앞에 붙였으면 읽던 자리를 그대로 둔다** — 붙은 만큼
     * 굴린 자리를 내려 준다. 그게 없으면 `더 보기`를 누를 때마다 화면이
     * 맨 위로 튄다.
     */
    /**
     * 올라가는 중인 줄의 **진행률만** 갈아 끼운다.
     *
     * 초에 수십 번 오는 값이라 `apply(rows:)`로 줄을 통째로 다시 만들면
     * 그때마다 높이를 다시 재고 표를 다시 그린다 — 여기서는 담아 둔 줄의
     * 값 하나와 **보이는 칸의 고리·글자만** 고친다(말풍선을 `memo`로
     * 감싼 것과 같은 결이다).
     */
    func markUpload(_ id: String, sent: Int64, total: Int64) {
        guard let i = rows.firstIndex(where: { $0.id == id }), rows[i].upload != nil else { return }
        let job = ChatUpload(sent: sent, total: total)
        rows[i].upload = job
        (table.cellForRow(at: IndexPath(row: i, section: 0)) as? BubbleCell)?.setUpload(job)
    }

    func apply(rows next: [ChatRow], stickBottom: Bool) {
        preservingViewport(followBottom: stickBottom) {
            rows = next
            toldTop = false
            // 같은 id라도 답장·반응·삭제·날짜 묶음이 바뀌면 높이가 달라진다.
            heights.removeAll()
            table.reloadData()
        }
        // 최신 메시지/읽음선으로 높이가 바뀐 뒤에도 같은 메시지를 같은 위치에 둔다.
        if pendingViewport != nil && !next.isEmpty {
            restoreSession()
            pendingViewport = nil
            report()
        }
    }

    /**
     * `최근 대화로` 동그라미를 얹거나 걷는다(21판).
     *
     * **띄울지 말지는 화면이 정한다** — 여기서 또 재지 않는다(`far`는 이미
     * 알려 주었고, `검색 중`처럼 화면만 아는 사정도 있다).
     */
    func apply(jump on: Bool) {
        jumpBar.isHidden = !on
        if on { jumpBar.paint(skin: skin); setNeedsLayout() }
    }

    /**
     * 검색칸에 친 글자 — 말풍선에서 **그 자리만 파랗게** 칠한다(사용자 요청).
     *
     * **높이는 안 바뀐다**(색만 바꾼다) — 그래서 다시 그리기만 하면 굴러간
     * 자리도 그대로다. `heights`를 비우지 말 것: 비우면 다 다시 재느라
     * 긴 대화에서 그대로 끊긴다.
     */
    var find: String = "" {
        didSet {
            guard find != oldValue else { return }
            table.reloadData()
        }
    }

    @objc private func jumpTapped() {
        listDelegate?.chatListTap(kind: "jump", id: "", to: nil)
    }

    func scrollToBottom(animated: Bool) {
        dropSpot()
        let y = max(-table.adjustedContentInset.top,
                    table.contentSize.height - table.bounds.height
                        + table.adjustedContentInset.bottom)
        table.setContentOffset(CGPoint(x: 0, y: y), animated: animated)
    }

    /**
     * **읽던 자리를 높이가 정해질 때까지 다시 놓는다**(34판).
     *
     * **한 번만 놓으면 어긋난다 — 목록 높이가 한 번에 안 정해진다.**
     * 사진이 늦게 뜨고 그림이 풀리며 위쪽에서 자라면 놓아 둔 자리가 그만큼
     * 밀리는데, 나갈 때 그 밀린 자리를 다시 적으므로 **드나들 때마다
     * 조금씩 쌓인다**(사용자 제보 — `들어갔다 되돌아오기를 반복하면
     * 말풍선이 조금씩 내려가`. 웹 목록에서는 안 나는 자국이었다 —
     * 거기는 `requestAnimationFrame`으로 1.5초 동안 다시 놓고 있었다).
     *
     * **높이가 바뀔 때만 한다** — 사람이 굴리는 것은 높이를 안 바꾸므로
     * 그 사이에 옮겨 간 자리를 빼앗지 않는다(웹과 같은 잣대다).
     */
    private func holdSpot(id: String, off: CGFloat) {
        spotAim = (id, off)
        spotSize = table.contentSize.height
        spotFit = table.bounds.height
        spotUntil = CACurrentMediaTime() + 1.5
        spotLink?.invalidate()
        let link = CADisplayLink(target: self, selector: #selector(spotTick))
        link.add(to: .main, forMode: .common)
        spotLink = link
    }

    @objc private func spotTick() {
        guard let aim = spotAim else { dropSpot(); return }
        /* **사람이 굴리기 시작하면 손을 뗀다** — 그 자리를 빼앗으면 안 된다. */
        if table.isDragging || table.isDecelerating { dropSpot(); return }
        let h = table.contentSize.height, fit = table.bounds.height
        if h != spotSize || fit != spotFit {
            spotSize = h
            spotFit = fit
            if let at = rows.firstIndex(where: { $0.id == aim.id }) {
                putAt(IndexPath(row: at, section: 0), off: aim.off)
                lastAtBottom = atBottom()
            }
        }
        if CACurrentMediaTime() >= spotUntil { dropSpot() }
    }

    private func dropSpot() {
        spotLink?.invalidate()
        spotLink = nil
        spotAim = nil
    }

    /* 화면에서 걷힐 때 함께 끈다 — 남으면 안 보이는 목록을 프레임마다 잰다. */
    override func willMove(toWindow newWindow: UIWindow?) {
        super.willMove(toWindow: newWindow)
        if newWindow == nil { dropSpot() }
    }

    /**
     * `at`(읽던 자리)로 놓는다 — 그 줄의 윗변을 맨 위에 맞추고 나갈 때 위로
     * 지나가 있던 `off`만큼 더 내린다. 끝을 넘지 않게 자른다.
     */
    private func putAt(_ ip: IndexPath, off: CGFloat) {
        table.layoutIfNeeded()
        placeOffset(table.rectForRow(at: ip).minY + off - table.adjustedContentInset.top)
    }

    func atBottom() -> Bool {
        let max = table.contentSize.height - table.bounds.height
            + table.adjustedContentInset.bottom
        return table.contentOffset.y >= max - bottomSlack
    }

    var rowCount: Int { return rows.count }

    /**
     * **읽던 자리**(32판) — 화면 맨 위에 걸린 줄과 그 줄이 위로 지나간 만큼.
     *
     * 라운드·투표를 눌러 들어갔다 `←`로 돌아오면 대화가 새로 만들어져
     * **최근 대화로 툭 내려갔다**(사용자 제보). 나가면서 이 값을 웹에 넘겨
     * 두면 다시 들어올 때 그 글을 같은 자리에 놓을 수 있다.
     *
     * **굴린 픽셀이 아니라 글 id로 적는다** — 다시 들어오면 사진이 늦게
     * 뜨며 높이가 달라져 같은 숫자가 다른 자리를 가리킨다.
     */
    func topSpot() -> (id: String, off: CGFloat)? {
        let y = table.contentOffset.y + table.adjustedContentInset.top
        guard let ip = (table.indexPathsForVisibleRows ?? []).sorted()
            .first(where: { table.rectForRow(at: $0).maxY > y + 1 }),
            ip.row < rows.count else { return nil }
        return (rows[ip.row].id, y - table.rectForRow(at: ip).minY)
    }

    /**
     * **앱이 그린 그대로 한 장 찍는다**(39판) — 끌어 돌아올 때 웹이 깔 그림이다.
     *
     * 라운드·투표에서 대화방으로 **끌어 돌아오는 길은 웹 화면이라** 앞 화면
     * 그림을 웹이 깔아야 하는데, 그 그림은 떠날 때 찍어 둔 **웹 DOM**이다.
     * 웹 말풍선은 Pretendard이고 앱 목록은 폰 기본 글꼴이라 줄 바뀌는 자리와
     * 높이가 달라, 돌아온 순간 **두 화면이 오가는 것처럼 보였다**(사용자 제보 —
     * `뭔가 2개화면이 왔다갔다하는 느낌`). 값을 하나씩 맞추는 길로는 끝이
     * 없으므로(26 → 27판의 그 답) **그림 자체를 앱 것으로 바꾼다.**
     *
     * **목록만 찍는다 — 화면 통째로 찍으면 안 된다.** 이 함수가 불리는
     * `listDetach`는 리액트가 **목적지를 이미 그린 뒤**라, `root`를 찍으면
     * 바뀐 웹 화면 위에 앱 목록이 얹힌 그림이 나온다. 앱 목록은 웹뷰 위에
     * 얹힌 앱 부품이라 저 혼자 찍어도 말풍선이 다 들어 있다.
     *
     * **감춰져 있으면 안 찍는다**(`isHidden`) — 빈 그림이 나온다. 그때는
     * 웹이 예전처럼 DOM 사본을 깐다.
     */
    func paint(scale: CGFloat = 2, quality: CGFloat = 0.7) -> (b64: String, h: CGFloat)? {
        guard !isHidden, bounds.width > 1, bounds.height > 1 else { return nil }
        let fmt = UIGraphicsImageRendererFormat()
        fmt.scale = scale
        fmt.opaque = true
        let img = UIGraphicsImageRenderer(bounds: bounds, format: fmt).image { ctx in
            /* **먼저 목록 바탕색으로 한 번 칠한다.** `opaque = true`인 판은
               **검정으로 시작**하는데, `afterScreenUpdates: false`는 **이미
               화면에 그려져 있는 것만** 떠 오므로 방금 늘어난 자리처럼 아직
               안 그려진 곳이 있으면 **그대로 검은 띠로 남는다**(사용자 제보 ·
               사진 — `밑에 까맣게 화면 나왔다가 내려가는 증상`). 칠해 두면
               그런 자리도 보라로 남아 눈에 안 띈다. */
            (backgroundColor ?? UIColor(white: 0.45, alpha: 1)).setFill()
            ctx.fill(bounds)
            /* `afterScreenUpdates: false` — 이미 그려져 있는 것을 그대로 뜬다.
               참으로 두면 한 판 더 그리느라 나가는 길이 그만큼 늦어진다. */
            drawHierarchy(in: bounds, afterScreenUpdates: false)
        }
        guard let data = img.jpegData(compressionQuality: quality) else { return nil }
        return (data.base64EncodedString(), bounds.height)
    }

    /**
     * 그 글로 뛴다 — 인용을 누르거나 검색 결과를 골랐을 때다(5판).
     *
     * **못 찾으면 거짓을 돌려준다.** 지난 묶음에 있어 아직 안 받아 온 글이라,
     * 웹이 `지난 대화에 있습니다`로 알려 준다(웹 목록과 같은 잣대다).
     *
     * `place`는 셋이다 — `center`(인용·검색) · `top`(`여기까지 읽으셨습니다`
     * 줄 — **마지막으로 읽은 글이 한 줄 보이게** 위에서 조금 내려 둔다) ·
     * **`at`(읽던 자리 — 그 글이 위로 `off`만큼 지나간 자리. 32판)**.
     */
    func scrollTo(id: String, place: String, off: CGFloat = 0, flash: Bool) -> Bool {
        guard let at = rows.firstIndex(where: { $0.id == id }) else { return false }
        let ip = IndexPath(row: at, section: 0)
        dropSpot()
        if place == "at" {
            /* **읽던 자리다**(32판). 한 번 놓고 끝내면 그 뒤에 사진이 뜨며
               위쪽에서 자라는 만큼 밀리므로, 높이가 정해질 때까지 다시
               놓는다(34판의 `holdSpot`). */
            putAt(ip, off: off)
            holdSpot(id: id, off: off)
        } else {
            /* **부드럽게 굴리지 않는다** — 300개까지 받아 둔 목록을 훑어
               내려가는 일이라 느린 폰에서 그대로 끊긴다(웹의 `jumpToLatest`와
               같은 잣대다). 게다가 `top`은 굴린 뒤에 자리를 한 번 더 고치므로
               움직이는 중이면 그 값이 어긋난다. */
            table.scrollToRow(at: ip, at: place == "top" ? .top : .middle,
                              animated: false)
            if place == "top" {
                /* 웹이 `위에서 100px`에 두는 그 자리다 — 줄 바로 위에 지난
                   글이 한 줄 비쳐야 거기서부터 읽어 내려갈 수 있다. */
                table.contentOffset.y = max(0, table.contentOffset.y - 100)
            }
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
        return min(bounds.width - skin.pad * 4, skin.cardW)
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
        if changingViewport {
            DispatchQueue.main.async { [weak self] in self?.noteSize(url, size) }
            return
        }
        preservingViewport {
            photoSizes[url] = size
            let affected = rows.indices.filter { rows[$0].image == url }
            for at in affected {
                heights.removeValue(forKey: "\(rows[at].id)|\(Int(bounds.width))")
            }
            table.reloadRows(at: affected.map { IndexPath(row: $0, section: 0) }, with: .none)
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
        /* **줄 위 자리는 웹이 알려 준다**(`row.top` — 10 또는 2). 예전에는
           맨 아래에 `4`를 박아 두었는데 그것이 곧 어긋남의 정체였다. */
        var h: CGFloat = row.top
        /* 날짜 칸 — 웹의 `.chat-day`는 `margin: 16px auto 10px`이고 칩이
           20px쯤이다(예전 34는 6 + 칩 + 8이라 12px 모자랐다). */
        if row.date != nil { h += 46 }
        if row.mark { h += 30 }                          // `여기까지 읽으셨습니다`
        if !row.reacts.isEmpty { h += skin.reactH + 3 }
        switch row.kind {
        case .system:
            /* 칩이 제 안여백(위아래 5)을 들고 있으므로 **글자 + 10**이고,
               웹의 `.chat-notice`는 아래 여백이 2px다. 위 여백은 이제
               `row.top`이 든다(예전 18 = 10 + 8).
               **배치도 `y`에서 바로 시작해야 한다** — 거기서 `+4`를 더하면
               그만큼 칸 밖으로 넘친다. */
            h += measure(row.body, width: bounds.width - skin.pad * 4,
                         size: skin.stampSize + 2).height + 12
        case .card:
            /* **자리는 `cardBox`가 셈한다** — 배치도 같은 함수를 쓰므로 둘이
               어긋날 자리가 없다(34판). 웹의 `.chat-result`는 아래 여백이
               2px다(`margin-top`은 `row.top`이 든다). */
            h += cardBox(CardParts.parse(row.body, icon: row.icon),
                         go: row.go ?? "", skin: skin, width: cardWidth()).height + 2
        case .photo, .sticker:
            if row.name != nil { h += skin.nameLine }
            h += quoteHeight(row, above: true)
            h += row.kind == .sticker ? skin.sticker : photoBox(row.image).height
            if let c = row.cap, !c.isEmpty {
                h += measure(c, width: textWidth(), size: skin.fontSize).height
                    + skin.padV * 2 + 2
            }
        case .text, .other:
            if row.name != nil { h += skin.nameLine }
            h += quoteHeight(row, above: false)
            /* **가린 글은 말풍선을 벗긴다**(웹의 `.chat-hidden`과 같은 모양).
               세로 안여백은 그대로라 **높이는 한 줄 말풍선과 같다** — 줄이
               통째로 줄어들면 가릴 때마다 읽던 자리가 위아래로 튄다. */
            let body = row.kind == .other ? (row.note ?? row.body) : row.body
            if row.big {
                /* 이모지만 보낸 글은 말풍선을 벗기고 크게 그린다 —
                   안여백도 웹과 같이 거의 없다(`.emoji-only`). */
                h += measure(body, width: textWidth(), size: skin.bigSize,
                             pinLine: false).height + 2
            } else {
                let t = measure(body, width: textWidth(), size: skin.fontSize)
                h += t.height + skin.padV * 2
            }
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
                  font: bodyFont(), photo: photoBox(row.image), card: cardWidth(), find: find)
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
        guard !changingViewport else { return }
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
        showDate()
        report()
    }

    func scrollViewWillBeginDragging(_ sv: UIScrollView) {
        dropSpot()
        dragFrom = sv.contentOffset.y
        dragHid = false
    }

    private func report() {
        guard !changingViewport else { return }
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
/**
 * **밀어서 댓글**(왼쪽으로 미는 손짓)의 문지기.
 *
 * **셀에 안 두고 따로 둔다.** `UITableViewCell`이 이미
 * `UIGestureRecognizerDelegate`를 따르고 있어 **어느 손잡이에 `override`가
 * 필요한지가 판마다 갈리는데**, 여기는 맥이 없어 빌드로만 확인되는 자리다
 * (실제로 한 번 `redundant conformance`로 죽었다). 따로 두면 그 물음이
 * 아예 없어지고, 규칙도 한 곳에 모인다.
 *
 * 하는 일이 둘이다:
 *
 * 1. **가로로 그은 것만 받는다** — 웹에서 `touch-action: pan-y`가 하던
 *    일이다. **빠르기가 0에 가까우면 옮긴 거리로 본다**: 천천히 밀면
 *    `velocity`가 둘 다 0이라 `abs(v.x) > abs(v.y)`가 거짓이 되어
 *    **그 손짓이 통째로 막혔다**(사용자 제보 — `답장 동작안됨`).
 * 2. **표가 굴리는 손짓과 나란히 선다**(22판). 이것이 없어 **밀어서
 *    댓글이 통째로 죽어 있었다**(사용자 제보 — `답장기능이 안돼`).
 *    손가락이 조금만 움직여도 **표의 굴리기 손짓이 먼저 알아채는데**,
 *    두 손짓은 기본적으로 나란히 안 서므로 먼저 선 쪽이 우리 것을 막아
 *    `shouldBegin`까지 가지도 못했다. **길게 누르기와 누르기가 멀쩡했던
 *    것이 갈라 준 단서다** — 움직이지 않는 손짓이라 그 겨룸이 없다.
 *    가로로 그은 것만 받으므로(1번) 나란히 서도 표가 세로로 안 밀린다.
 *
 * **누르기도 이 문지기를 쓴다**(24판). 셀의 탭과 목록의 `키보드 내리기`
 * 탭이 같은 터치를 두고 겨뤄 **깊이 있는 셀 쪽이 목록 것을 막았다** —
 * 2번과 완전히 같은 자리다(막는 쪽이 굴리기가 아니라 탭일 뿐이다).
 * 1번은 탭에 아무 말도 안 한다(`pan`이 아니면 그냥 참이다).
 *
 * **손잡이를 새로 더할 때도 여기에 둘 것.**
 */
/**
 * **오른쪽으로 밀어 뒤로 가기**의 문지기(25판).
 *
 * `SwipeGuard`와 갈래가 하나 다르다 — **오른쪽으로 그은 것만** 받는다.
 * 밀어서 댓글은 왼쪽(`dx < 0`)뿐이라 **방향으로 갈려 안 부딪힌다**
 * (웹에서 `.chat-row`를 `taken()`에서 뺀 그 규칙 그대로다).
 *
 * 빠르기가 0에 가까우면 옮긴 거리로 보는 것도 같다 — 천천히 밀면
 * `velocity`가 둘 다 0이라 그 손짓이 통째로 막힌다(21판에서 겪은 자리).
 */
final class BackGuard: NSObject, UIGestureRecognizerDelegate {
    func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
        guard let pan = g as? UIPanGestureRecognizer else { return true }
        let v = pan.velocity(in: pan.view)
        if abs(v.x) < 1, abs(v.y) < 1 {
            let t = pan.translation(in: pan.view)
            return t.x > 0 && t.x > abs(t.y)
        }
        return v.x > 0 && v.x > abs(v.y)
    }

    func gestureRecognizer(
        _ g: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
    ) -> Bool {
        return true
    }
}

// MARK: - 손가락을 따라 뒤로 가기 (35판)

/**
 * 대화방에서 **오른쪽으로 밀면 앞 화면이 손가락을 따라 나온다.**
 *
 * 나머지 열아홉 화면은 웹이 통째로 그려서 `useBackSwipe`가 그대로 하는데
 * (지금 화면이 손끝을 따라가고 앞 화면이 뒤에서 1/4만큼 따라 나오며
 * 어둡던 것이 밝아진다), **대화방만 25판까지 툭 넘어갔다** — 말풍선 목록과
 * 입력칸이 웹뷰 **위에 얹힌 앱 부품**이라 웹의 `transform`을 안 따라와
 * 화면이 찢어져 보이기 때문이다(`plainBack()`의 그 까닭이다).
 * 사용자 요청 — `되돌아가기할때 손따라 오면서 되는건 안되는거야?`
 *
 * **그래서 옮기는 일을 통째로 앱이 맡는다.** 짜임이 이렇다:
 *
 * ```
 * [떠나는 화면]  ← root를 통째로 찍은 그림. 손끝을 그대로 따라간다.
 * [막(dim)]      ← 그 아래. 밝아지며 걷힌다.
 * [웹뷰]         ← 앞 화면(웹이 깐 그림)만 남아 1/4만큼 따라 나온다.
 * ```
 *
 * 세 가지가 이 짜임의 값이다:
 *
 * 1. **`root`를 한 장으로 찍으므로 웹·앱이 갈릴 자리가 없다.** 머리말(웹)과
 *    말풍선(앱)과 입력칸(앱)이 한 그림이라 **어긋날 수가 없다** — 값을
 *    하나씩 맞추는 길로 가지 않는다는 27판의 그 답이다.
 * 2. **끄는 동안 다리를 한 번도 안 건넌다.** 그림도 웹뷰도 앱이 옮기므로
 *    프레임마다 값을 실어 보내던 일(13판 `frame`)이 아예 없다 —
 *    **손끝과 화면 사이에 아무것도 없다.**
 * 3. 앞 화면을 **웹이 깐다**(`nativeBackStart`). 그 그림은 떠날 때 찍어 둔
 *    웹 DOM이라 앱이 만들 길이 없고, 그것 하나만 `listBack` 신호로 부탁한다.
 *
 * **값은 웹 `tabs.ts`에서 그대로 가져왔다 — 한쪽만 고치지 말 것.**
 */
final class BackDrag {
    /// 앞 화면이 뒤에서 어긋나 따라 나오는 몫(웹의 `PARALLAX`).
    static let parallax: CGFloat = 0.25
    /// 그 위에 덮는 막의 짙기(웹의 `DIM`).
    static let dim: CGFloat = 0.18
    /// 이만큼 끌면 넘어간다 — 화면 폭의 몫(웹의 `TAKE`).
    static let take: CGFloat = 0.34
    /// 짧게 튕겨도 넘어가는 빠르기(pt/s). 웹의 `FLICK`(0.8px/ms)과 같은 값이다.
    static let flick: CGFloat = 800
    /// **거리 없이 빠르기만 보지 않는다** — 손끝이 미끄러진 것까지 걸린다
    /// (웹의 `FLICK_MIN`).
    static let flickMin: CGFloat = 40
    /// 손을 뗀 뒤 마무리에 걸리는 시간. 웹 `end()`의 230ms와 같다.
    static let ease = 0.23

    /// 키보드가 올라온 것으로 보는 최소 높이(pt). 홈 인디케이터 자리(34)만
    /// 남았을 때를 키보드로 보면 안 되므로 넉넉히 잡는다.
    static let kbMin: CGFloat = 80
    /// 키보드 그림을 얹는 창의 높이. **키보드 창보다 위여야 한다** —
    /// `UIRemoteKeyboardWindow`가 1,000만 언저리라 그 위로 하나 올려 잡는다.
    static let kbLevel: CGFloat = 10_000_001

    private weak var web: UIView?
    private var shot: UIView?
    private var veil: UIView?
    /// 앱 창. 키보드를 든 판에서는 **이것을 밀어** 앞 화면을 따라 나오게 한다.
    private weak var stage: UIWindow?
    /// 키보드를 찍어 둔 그림과 그것을 얹은 창(아래 `liftKeyboard`).
    private var kbBox: UIView?
    private var kbWin: UIWindow?
    /// 끌기 시작할 때 키보드를 들어 올렸는가 — 되돌릴 때 도로 올린다.
    private(set) var tookKeyboard = false
    /// 감춰 둔 앱 부품과 **감추기 전 값**. 바는 `hidden`이 진짜 기능이라
    /// (7판) 덮어놓고 내보이면 감춰 둔 것까지 살아난다.
    private var hid: [(view: UIView, was: Bool)] = []
    private var width: CGFloat = 1
    private(set) var live = false

    /**
     * 끌 준비를 한다. **떠나는 화면을 먼저 찍는다** — 앱 부품을 감춘 뒤에
     * 찍으면 말풍선이 빠진 그림이 된다.
     *
     * **그림은 화면(`root`)이 아니라 창(`UIWindow`)에 얹는다.**
     * Capacitor는 **웹뷰를 화면 그 자체로 쓴다**(`CAPBridgeViewController`의
     * `loadView`가 `view = webView`다) — 그래서 `root`가 곧 웹뷰이고, 그
     * 안에 그림을 얹으면 **앞 화면 몫으로 웹뷰를 미는 순간 그림과 앱
     * 부품까지 함께 밀린다.** 처음에 그렇게 짰다가 실기기에서
     * **화면이 왼쪽으로 97px 튀었다가 손을 따라 끌려오는** 자국으로
     * 나타났다(사용자 제보 — `오른쪽으로 손가락을 밀면 … 화면이 왼쪽으로
     * 갔다가 오른쪽으로 끌려와`). 창에 얹으면 웹뷰와 남남이라 그 자리가
     * 아예 없다.
     *
     * **앱 부품(목록·바)이 웹뷰와 함께 밀리는 것은 상관없다** — 그 둘은
     * 여기서 감춰지고, 찍어 둔 그림이 그 자리를 대신한다.
     *
     * ## 키보드가 올라와 있으면 한 겹 더 쓴다
     *
     * 사용자 제보 — `카톡은 키보드가 올라온상태에서 뒤로끌면 키보드까지
     * 같이 밀리는데 우리껀 안되네`. **키보드는 우리 창이 아니라
     * `UIRemoteKeyboardWindow`라, 앱 창에 무엇을 얹어도 못 덮고 찍히지도
     * 않는다.** 그래서 갈래가 이렇게 갈린다:
     *
     * ```
     * [키보드 창]   화면 전체를 찍어 키보드 자리만 오려낸 그림 → 손끝을 따라간다
     *   ＋ 그 창에 떠나는 화면 그림(shot)과 막(veil)도 함께 얹는다
     * [앱 창]       진짜 키보드는 그 뒤에서 조용히 내려가고, 웹뷰가 제 높이로
     *               자라 앞 화면이 **키보드 자리까지** 드러난다
     * ```
     *
     * - **앞 화면은 웹뷰가 아니라 앱 창을 밀어 따라오게 한다**(`back`).
     *   키보드가 내려가면 Capacitor 키보드 플러그인이 **웹뷰의 `frame`을
     *   고쳐 잡는데**(`Keyboard.m`의 `_updateFrame`), `transform`이 걸린 뷰에
     *   `frame`을 넣으면 UIKit이 거꾸로 셈해 **웹뷰가 폭까지 늘어난다.**
     *   창은 그 함수가 `bounds`로만 보므로 밀어도 안전하다.
     * - **그림을 못 찍거나 창을 못 만들면 키보드를 건드리지 않는다** —
     *   그때는 예전 그대로(키보드는 그 자리에 남고 화면만 끌린다).
     *
     * 못 찍으면 거짓을 돌려주고, 그때는 목록이 25판처럼 곧바로 넘어간다.
     *
     * - Parameter dropKeyboard: 키보드를 들어 올린 판에서만 불린다 —
     *   진짜 키보드를 내린다(부르는 쪽이 `holdFocus`를 먼저 푼다).
     *   **안 주면 키보드를 아예 안 든다** — 내릴 길이 없는데 그림만 밀면
     *   그림이 비켜난 자리에서 진짜 키보드가 그대로 드러난다. 잡종 시절의
     *   옛 다리(`NativeComposerPlugin`)가 그 갈래다.
     */
    func begin(root: UIView, web: UIView, cover: [UIView],
               dropKeyboard: (() -> Void)? = nil) -> Bool {
        end()
        guard root.bounds.width > 1,
              let stage = root.window,
              let shot = root.snapshotView(afterScreenUpdates: false) else { return false }
        self.web = web
        self.stage = stage
        width = root.bounds.width
        let box = root.convert(root.bounds, to: stage)
        shot.frame = box
        shot.isUserInteractionEnabled = false

        /* 키보드 자리 = **웹뷰 아랫변부터 창 아랫변까지.** `resize: 'native'`라
           키보드가 올라오면 웹뷰가 딱 그만큼 줄어 있다. */
        let gap = CGRect(x: 0, y: box.maxY,
                         width: stage.bounds.width,
                         height: stage.bounds.height - box.maxY)
        var fall: (() -> Void)?
        let host: UIView
        if let drop = dropKeyboard, gap.height > Self.kbMin,
           let win = liftKeyboard(stage: stage, gap: gap) {
            fall = drop
            kbWin = win
            tookKeyboard = true
            host = win
        } else {
            host = stage
        }

        let veil = UIView(frame: stage.bounds)
        veil.backgroundColor = .black
        veil.alpha = Self.dim
        veil.isUserInteractionEnabled = false
        /* **막은 웹뷰 위·그림 아래다.** 창에서 화면 다음에 얹으므로 차례를
           따로 따질 것이 없다 — 둘 다 맨 위에 붙이면 그대로 그 차례다. */
        host.addSubview(veil)
        host.addSubview(shot)
        self.shot = shot
        self.veil = veil

        hid = cover.map { ($0, $0.isHidden) }
        for v in cover { v.isHidden = true }
        back(0)
        live = true
        /* **밀 자리를 다 잡은 뒤에 내린다.** 앱 창은 `transform`을 걸어도
           플러그인이 웹뷰 `frame`을 고치는 데 지장이 없다(위 주석). */
        fall?()
        return true
    }

    /**
     * 화면을 통째로 찍어 **키보드 자리만 오려** 키보드보다 위에 뜨는 창에 얹는다.
     *
     * - **`UIScreen`으로 찍는다.** `UIView.snapshotView`는 제 화면만 그리므로
     *   키보드가 안 담긴다 — 화면 전체를 찍는 것이 유일한 길이다.
     * - **키보드 자리만 오려 쓴다.** 대화 화면은 이미 `root`를 찍은 그림
     *   (`shot`)이 맡고 있어, 화면 찍기가 키보드를 못 담는 판이어도
     *   **어긋나는 곳이 그 띠 하나로 그친다.**
     * - 못 담았을 때를 대비해 **키보드색 바탕을 깔아 둔다** — 그래야
     *   까만 띠 대신 키보드 비슷한 것이 남는다.
     * - **`makeKeyAndVisible`을 쓰지 말 것** — 키를 뺏으면 글칸의 초점이 풀린다.
     * - **손짓을 안 받는다**(`isUserInteractionEnabled = false`) — 받으면
     *   끌고 있는 그 손가락이 이 창에 잡혀 아래 목록까지 안 내려간다.
     *
     * - **씬(`windowScene`)을 요구하지 말 것 — 우리 앱에는 아예 없다.**
     *   Capacitor 기본 틀은 `UIApplicationSceneManifest`도 `SceneDelegate`도
     *   없이 `AppDelegate`가 `var window: UIWindow?`를 직접 들고 있는
     *   **레거시 앱**이라, iOS 13+에서도 `window.windowScene`이 **늘 nil**이다.
     *   처음에 `guard let scene = stage.windowScene else { return nil }`로
     *   시작했더니 **첫 줄에서 그대로 돌아서** 키보드를 드는 갈래가 통째로
     *   안 돌았다 — 실기기에서 **화면만 끌리고 키보드는 제자리에 굳은**
     *   자국으로 나타났다(사용자 제보 — `키보드가 한몸으로 안움직여`).
     *   씬이 있으면 그 창으로, 없으면 `UIWindow(frame:)`으로 만든다.
     */
    private func liftKeyboard(stage: UIWindow, gap: CGRect) -> UIWindow? {
        /* `UIScreen`의 것은 `UIView`와 달리 늘 돌려준다(옵셔널이 아니다). */
        let screen = stage.screen.snapshotView(afterScreenUpdates: false)
        let win: UIWindow
        if let scene = stage.windowScene { win = UIWindow(windowScene: scene) }
        else { win = UIWindow(frame: stage.frame) }
        win.frame = stage.frame
        /* 씬이 없으면 이웃 창을 훑을 길이 없다 — 그때는 `kbLevel`이 곧 답이다
           (`UITextEffectsWindow`가 10,000,000이라 그 위로 하나 올려 잡았다). */
        let top = stage.windowScene?.windows.map { $0.windowLevel.rawValue }.max() ?? 0
        win.windowLevel = UIWindow.Level(rawValue: max(top + 1, Self.kbLevel))
        win.backgroundColor = .clear
        win.isUserInteractionEnabled = false
        let empty = UIViewController()
        empty.view.backgroundColor = .clear
        win.rootViewController = empty
        win.isHidden = false

        let box = UIView(frame: gap)
        box.clipsToBounds = true
        box.isUserInteractionEnabled = false
        box.backgroundColor = UIColor { t in
            t.userInterfaceStyle == .dark ? UIColor(white: 0.13, alpha: 1)
                                          : UIColor(red: 0.82, green: 0.83, blue: 0.85, alpha: 1)
        }
        screen.frame = CGRect(origin: CGPoint(x: -gap.minX, y: -gap.minY), size: screen.bounds.size)
        screen.isUserInteractionEnabled = false
        box.addSubview(screen)
        win.addSubview(box)
        kbBox = box
        return win
    }

    /// 손끝을 따라간다. **웹의 `paint()`와 같은 셈이다.**
    func move(dx: CGFloat) {
        guard live else { return }
        let d = max(0, min(width, dx))
        let p = d / width
        let slide = CGAffineTransform(translationX: d, y: 0)
        shot?.transform = slide
        kbBox?.transform = slide
        back(p)
        veil?.alpha = Self.dim * (1 - p)
    }

    /// 뒤에 깔린 앞 화면을 `p`(0~1)만큼 따라 나오게 한다.
    /// **키보드를 든 판에서는 웹뷰가 아니라 앱 창을 민다**(위 `begin` 주석).
    private func back(_ p: CGFloat) {
        let move = CGAffineTransform(translationX: (p - 1) * width * Self.parallax, y: 0)
        if tookKeyboard { stage?.transform = move } else { web?.transform = move }
    }

    /// 놓았을 때 넘어갈 것인가(웹 `end()`의 잣대 그대로다).
    func wants(dx: CGFloat, vx: CGFloat) -> Bool {
        return dx > width * Self.take || (vx > Self.flick && dx > Self.flickMin)
    }

    /**
     * 마무리한다 — `go`면 화면 밖으로 내보내고 아니면 제자리로 되돌린다.
     *
     * **끝나고 나서 웹에 알리는 것은 부르는 쪽 몫이다.** 넘어가는 판에서는
     * 그림이 다 빠져나간 **뒤에** 뒤로 가야 한다 — 먼저 가면 목적지가
     * 아직 안 그려진 채로 그 0.23초가 지나간다(웹 `end()`가 230ms을
     * 기다렸다 `nav(-1)`을 부르는 그 자리다).
     */
    func finish(go: Bool, done: @escaping () -> Void) {
        guard live, let shot = shot else { done(); return }
        let toShot = go ? width : 0
        UIView.animate(withDuration: Self.ease, delay: 0,
                       options: [.curveEaseOut, .beginFromCurrentState],
                       animations: {
            let slide = CGAffineTransform(translationX: toShot, y: 0)
            shot.transform = slide
            self.kbBox?.transform = slide
            self.back(go ? 1 : 0)
            self.veil?.alpha = go ? 0 : Self.dim
        }, completion: { _ in done() })
    }

    /**
     * 감춰 둔 것을 되돌리고 민 것을 제자리에 놓는다 — **깔아 둔 그림은 그대로 둔다.**
     *
     * 되돌아오는 판에서 쓴다. 키보드를 내려 둔 판이라면 부르는 쪽이 여기서
     * 초점을 다시 줘 키보드를 올리는데, **찍어 둔 그림이 아직 덮고 있어**
     * 올라오는 동안이 안 보인다 — 다 올라온 뒤에 `end()`로 걷으면 된다.
     */
    func restore() {
        for h in hid { h.view.isHidden = h.was }
        hid = []
        web?.transform = .identity
        stage?.transform = .identity
        live = false
    }

    /// 깔아 둔 것을 걷고 감춰 둔 것을 되돌린다. **여러 번 불러도 안전하다.**
    func end() {
        restore()
        drop()
    }

    /**
     * 걷기만 하고 **감춰 둔 것은 그대로 둔다.**
     *
     * 넘어가는 판에서 쓴다 — 그때 앱 부품은 곧 걷힐 참인데(`listDetach`·
     * `detach`) 그 사이에 도로 내보이면 **옛 말풍선과 입력칸이 새 화면
     * 위에 한두 프레임 되살아난다.** 다시 설 때 저절로 보이므로
     * (`listAttach`가 되돌리고, 바는 `composerSkin`이 늘 `hidden: false`를
     * 함께 보낸다) 여기서 되돌릴 것이 없다.
     */
    func drop() {
        shot?.removeFromSuperview()
        veil?.removeFromSuperview()
        kbBox?.removeFromSuperview()
        /* 창은 감추고 놓아 준다 — 붙들고 있으면 화면 위에 죽은 창이 남는다. */
        kbWin?.isHidden = true
        kbWin?.rootViewController = nil
        shot = nil
        veil = nil
        kbBox = nil
        kbWin = nil
        web?.transform = .identity
        stage?.transform = .identity
        stage = nil
        web = nil
        hid = []
        tookKeyboard = false
        live = false
    }
}

final class SwipeGuard: NSObject, UIGestureRecognizerDelegate {
    func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
        guard let pan = g as? UIPanGestureRecognizer else { return true }
        let v = pan.velocity(in: pan.view)
        if abs(v.x) < 1, abs(v.y) < 1 {
            let t = pan.translation(in: pan.view)
            return abs(t.x) > abs(t.y)
        }
        return abs(v.x) > abs(v.y)
    }

    func gestureRecognizer(
        _ g: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
    ) -> Bool {
        return true
    }
}

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
    /// 동영상 자리에 얹는 ▶. **그림칸 안에 넣는다** — 사진 자리가 정해지면
    /// 그 가운데로 저절로 따라간다.
    private let playBadge = UIImageView()
    /* 올리는 동안 그림 위에 얹히는 셋 — 어두운 막 · 진행률 고리(가운데
       `✕`가 든 동그라미) · `0.24 / 4.15MB`. **그림칸 안에 넣는다**(▶와
       같은 자리라 사진 상자가 정해지면 저절로 따라간다). */
    private let upVeil = UIView()
    private let upRing = MediaRing()
    private let upStop = UIImageView()
    private let upSize = UILabel()
    private let capBubble = UIView()
    private let capLabel = UILabel()
    private let cardView = UIView()
    /// 오른쪽에 흐리게 깔리는 그림(37판 · 웹의 `.chat-result-deco`).
    private let cardDeco = UIImageView()
    private let cardBadge = UIView()
    private let cardIcon = UIImageView()
    /// 곳 이름 알약 · 큰 제목 · 곁줄 · `○○님이 …했습니다` · 알약 단추(34판).
    private let cardPill = PadLabel()
    private let cardTitle = UILabel()
    private let cardNote = UILabel()
    private let cardBy = UILabel()
    private let cardRule = UIView()
    private let cardGo = PadLabel()
    private var cardChips: [CardChip] = []
    /// 그린 카드의 조각들 — 배치가 다시 가르지 않게 담아 둔다.
    private var cardParts = CardParts()
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
    /// 검색칸에 친 글자 — 이 자리만 파랗게 칠한다(`ChatFind`).
    private var find = ""

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
    /// 밀기·누르기 손짓의 문지기 — **셀이 아니라 따로 둔다**(`SwipeGuard` 참고).
    private let guardian = SwipeGuard()

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
        playBadge.image = UIImage(systemName: "play.circle.fill",
            withConfiguration: UIImage.SymbolConfiguration(pointSize: 44, weight: .regular))
        playBadge.tintColor = UIColor(white: 1, alpha: 0.92)
        playBadge.contentMode = .center
        playBadge.isHidden = true
        /* 밝은 장면에서도 보이게 그림자를 깐다 — `filter`가 아니라
           레이어 그림자라 매 프레임 다시 그리지 않는다. */
        playBadge.layer.shadowColor = UIColor.black.cgColor
        playBadge.layer.shadowOpacity = 0.45
        playBadge.layer.shadowRadius = 6
        playBadge.layer.shadowOffset = .zero
        photoView.addSubview(playBadge)

        /* 올리는 동안의 덮개. **막은 사진 전체, 고리는 가운데 동그라미**다
           (카톡이 그렇다) — 고리를 사진 크기로 키우면 테두리를 도는 실선이
           되어 진행률로 안 읽힌다. */
        upVeil.backgroundColor = UIColor(white: 0, alpha: 0.32)
        upVeil.isUserInteractionEnabled = false
        upVeil.layer.cornerCurve = .continuous
        upRing.backgroundColor = UIColor(white: 0, alpha: 0.45)
        upRing.layer.cornerRadius = 32
        upRing.inset = 3
        upStop.image = UIImage(systemName: "xmark",
            withConfiguration: UIImage.SymbolConfiguration(pointSize: 20, weight: .semibold))
        upStop.tintColor = .white
        upStop.contentMode = .center
        upStop.isUserInteractionEnabled = false
        upSize.textAlignment = .center
        upSize.textColor = .white
        upSize.font = .systemFont(ofSize: 12, weight: .semibold)
        upSize.accessibilityIdentifier = "native-upload-size"
        for v in [upVeil, upRing, upStop, upSize] { v.isHidden = true; photoView.addSubview(v) }

        capLabel.numberOfLines = 0
        capBubble.layer.cornerRadius = 11
        capBubble.layer.cornerCurve = .continuous

        /* 눌리는 카드(라운드·투표·공지). **머리에 그림 배지가 선다**
           (사용자 요청 — 셋이 똑같이 생겨 글을 읽어야 무엇인지 알았다).
           **테두리 대신 그림자다** — `--line`은 흰 바탕에 맞춘 값이라
           보라 목록 위에서는 거의 안 보였다(웹의 `.chat-result`와 같다). */
        cardTitle.numberOfLines = 0
        cardNote.numberOfLines = 0
        /* **두 줄까지 편다 — 말줄임으로 자르지 말 것.** `○○님이 스크린을
           공유했습니다`는 한 문장이라 뒤가 잘리면 누가 무엇을 했는지가
           사라진다(웹의 `-webkit-line-clamp: 2`와 같은 자리다). */
        cardBy.numberOfLines = 2
        cardPill.numberOfLines = 1
        cardPill.lineBreakMode = .byTruncatingTail
        cardPill.inset = UIEdgeInsets(top: 3, left: 9, bottom: 3, right: 9)
        cardPill.layer.masksToBounds = true
        cardGo.numberOfLines = 1
        cardGo.inset = UIEdgeInsets(top: 7, left: 12, bottom: 7, right: 12)
        cardGo.textAlignment = .center
        cardGo.layer.masksToBounds = true
        cardView.layer.cornerCurve = .continuous
        cardView.layer.shadowColor = UIColor(red: 27 / 255, green: 31 / 255,
                                             blue: 25 / 255, alpha: 1).cgColor
        cardView.layer.shadowOpacity = 0.10
        cardView.layer.shadowRadius = 6
        cardView.layer.shadowOffset = CGSize(width: 0, height: 2)
        cardIcon.contentMode = .scaleAspectFit
        /* 오른쪽에 흐리게 깔리는 그림(37판). **웹의 `.chat-result-deco`와
           같은 자리·같은 옅기다**(오른쪽 끝 · 아래에서 36px · 80×56 · 0.14).
           한동안 웹에만 있어서, 뒤로 끌어 대화방으로 돌아오는 동안(웹 카드를
           찍은 그림) 그림이 나타났다가 앱 목록이 드러나면 사라졌다(사용자
           제보 · 사진 두 장). **글 뒤에 깔려야 하므로 맨 먼저 넣는다.**
           그림글자를 쓰지 말 것 — SF Symbol이다(`cardDecoSymbol`). */
        cardDeco.contentMode = .scaleAspectFit
        cardDeco.alpha = 0.14
        cardDeco.isUserInteractionEnabled = false
        cardView.addSubview(cardDeco)
        cardBadge.addSubview(cardIcon)
        cardView.addSubview(cardBadge)
        cardView.addSubview(cardRule)

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
        for v in [cardPill, cardTitle, cardNote, cardBy, cardGo] as [UIView] {
            cardView.addSubview(v)
        }

        /* **누르는 것은 한 곳에서 받아 자리로 가른다**(21판).
           예전에는 얼굴·사진·카드마다 제 탭 인식기를 달았는데, 실기기에서
           **얼굴도 인용도 안 눌렸다**(사용자 제보 — `프로필동작불`).
           목록 전체에 걸린 `키보드 내리기` 탭과 셀 안쪽 탭이 같은 터치를
           두고 겨루는 자리라, 한 인식기로 모으면 그 겨룸이 아예 없어지고
           **무엇을 눌렀는가의 규칙도 한 곳에 모인다.**
           (`ReactChip`은 인식기가 아니라 `UIControl`이라 그대로 둔다.)

           **그 겨룸이 한 자리 남아 있었다 — 목록의 `키보드 내리기` 탭이다**
           (24판 · 사용자 제보 — `채팅창을 터치하면 키보드가 내려가지않아`).
           둘 다 탭이라 **깊이 있는 쪽(셀)이 먼저 알아채 목록 것을 막는다** —
           `cancelsTouchesInView`는 손짓끼리의 그 막음과 아무 상관이 없다.
           게다가 이 손잡이는 **누른 자리에 아무것도 없으면 조용히 돌아서므로**
           (이모티콘 줄이 그렇다) 눌러도 정말 아무 일이 안 일어났다 —
           진단 줄의 `탭0`이 그 자국이다.
           그래서 **`SwipeGuard`를 달아 나란히 서게 한다**(그 안의
           `shouldRecognizeSimultaneouslyWith`가 참이다) — 밀기가 표의 굴리기와
           나란히 서는 것과 같은 수이고, **규칙은 셀이 아니라 거기에 둔다.**
           얼굴·사진을 눌러도 키보드가 함께 내려가는데
           **웹 목록에서도 그랬다** — 아이폰이 웹 화면을 누르는 순간 초점을
           도로 가져갔다. */
        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped))
        tap.delegate = guardian
        contentView.addGestureRecognizer(tap)

        /* **길게 누르면 고르는 창이 뜬다**(PC의 오른쪽 클릭 자리).
           왼쪽으로 미는 것은 댓글이 이미 쓰고 있어 겹치면 안 되므로,
           조금이라도 움직이면 취소된다(`allowableMovement` 기본값 10). */
        let hold = UILongPressGestureRecognizer(target: self, action: #selector(heldDown))
        hold.minimumPressDuration = holdFor
        hold.delegate = self
        contentView.addGestureRecognizer(hold)

        /* **탭은 길게 누르기가 실패한 뒤에만 이뤄진다**(사용자 제보 —
           `사진,동영상을 삭제하려고 길게 누르면 팝업메뉴가 뜨면서
           사진선택한것처럼 전체화면으로 보여지네`).
           위에 `0.5초를 붙들면 탭이 먼저 실패한다`고 적어 두었던 것이
           **틀린 말이었다** — `SwipeGuard`가 `shouldRecognizeSimultaneouslyWith`
           에 참을 돌려주므로 둘이 **나란히 선다.** 그래서 창이 뜬 뒤에
           손을 떼면 탭까지 이뤄져 `photo`(사진을 크게 띄움)나 `card`
           (그 라운드로 들어감)가 한 번 더 불렸다.
           **늦어지는 것은 없다** — 빨리 뗀 손짓에서는 길게 누르기가 손을
           떼는 그 자리에서 실패하고, 탭도 어차피 그때 이뤄진다. */
        tap.require(toFail: hold)

        /* **왼쪽으로 밀면 댓글이 걸린다**(카톡과 같은 손짓).
           세로로 굴리는 것과 안 부딪히게 **가로로 그은 것만** 받고, 표가
           굴리는 손짓과 **나란히 선다**(`SwipeGuard`). */
        let pan = UIPanGestureRecognizer(target: self, action: #selector(swiped))
        pan.delegate = guardian
        contentView.addGestureRecognizer(pan)
    }

    required init?(coder: NSCoder) { fatalError() }

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

    /**
     * 누른 자리로 무엇을 눌렀는지 가른다. **차례가 곧 규칙이다** — 얼굴이
     * 먼저고(가장 작다), 그다음 인용, 그림, 카드다.
     *
     * **누르는 자리는 그림보다 조금 넓다**(`slop`). 얼굴은 29px이라
     * 그대로 두면 30px 아래인데(웹에서 `.chat-face`에 음수 여백으로 넓혀
     * 둔 그 자리다), 여기서는 자리만 넓히므로 배치가 한 픽셀도 안 밀린다.
     */
    @objc private func tapped(_ g: UITapGestureRecognizer) {
        guard let r = row else { return }
        let p = g.location(in: contentView)
        let slop: CGFloat = 6
        let hits = { (v: UIView) in
            !v.isHidden && v.frame.insetBy(dx: -slop, dy: -slop).contains(p)
        }
        if hits(avatarView) { onTap?("face", r.id, nil); return }
        /* 인용을 누르면 원본으로 뛴다. **갈 곳을 모르면 안 누른다** —
           아직 안 받아 온 지난 묶음의 원본이라 웹 목록에서도 안 움직인다. */
        if hits(quoteBox), let to = r.quoteTo, !to.isEmpty {
            onTap?("quote", r.id, to); return
        }
        /* **올리는 중에는 가운데 동그라미가 `그만두기`다.** 그 밖의 자리를
           눌러도 아무 일이 없다 — 아직 서버에 없는 그림이라 크게 띄울
           것도, 재생할 것도 없다. */
        if r.upload != nil, r.kind == .photo, hits(photoView) {
            let c = CGPoint(x: photoView.frame.midX, y: photoView.frame.midY)
            if hypot(p.x - c.x, p.y - c.y) <= 34 { onTap?("cancel", r.id, nil) }
            return
        }
        if hits(photoView), r.kind == .photo, let u = r.image {
            onTap?("photo", r.id, u); return
        }
        if hits(cardView), r.kind == .card { onTap?("card", r.id, r.to); return }
    }

    /**
     * 길게 누른 자리. **줄 전체가 아니라 말풍선(또는 그림)을 넘긴다** —
     * 줄은 화면 폭을 다 쓰므로 그걸 넘기면 내 글에서도 창이 왼쪽에 뜬다
     * (웹의 `anchor()`와 같은 잣대다).
     */
    @objc private func heldDown(_ g: UILongPressGestureRecognizer) {
        guard g.state == .began, let r = row else { return }
        /* **올라가는 중인 줄에는 창을 안 띄운다** — 아직 서버에 없어
           복사·댓글·삭제가 갈 데가 없다(`tmp:` 줄이다). */
        guard r.upload == nil else { return }
        held = true
        /* **가린 글은 가운데 칩이다** — 그 줄에서는 `sysChip`이 곧 말풍선
           자리라, 안 넣으면 창이 줄 전체(화면 폭)에 붙어 한쪽 끝에 뜬다. */
        let target: UIView = !bubble.isHidden ? bubble
            : (!photoView.isHidden ? photoView
               : (!cardView.isHidden ? cardView
                  : (!sysChip.isHidden ? sysChip : contentView)))
        onHold?(r.id, target.convert(target.bounds, to: nil), r.mine)
    }

    /* **옮긴 거리는 우리가 안 움직이는 칸에서 잰다**(`self` — 셀 자체).
       `contentView`는 지금 우리가 밀고 있는 칸이라, 재는 자를 그 위에
       올려 두면 안 된다. */
    @objc private func swiped(_ g: UIPanGestureRecognizer) {
        /* 올라가는 중인 줄에는 댓글을 못 단다 — 원본이 아직 서버에 없다. */
        guard let r = row, r.upload == nil else { return }
        switch g.state {
        case .began:
            held = false
        case .changed:
            let dx = max(-swipeMax, min(0, g.translation(in: self).x))
            contentView.transform = CGAffineTransform(translationX: dx, y: 0)
        case .ended, .cancelled, .failed:
            let dx = max(-swipeMax, min(0, g.translation(in: self).x))
            let hit = !held && g.state == .ended && dx <= -swipeAt
            UIView.animate(withDuration: 0.16) { self.contentView.transform = .identity }
            if hit { onTap?("reply", r.id, nil) }
        default:
            break
        }
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
        /* 움직이는 이모티콘을 세워 둔다 — 안 세우면 다른 줄에 실려 간 칸이
           옛 그림을 계속 돌린다(그리기 비용이 그만큼 남는다). */
        ImageStore.put(nil, into: photoView)
        photoToken = nil
        playBadge.isHidden = true
        showUpload(nil)
    }

    /// 올리는 중 덮개를 켜고 끈다. **`nil`이면 통째로 감춘다.**
    private func showUpload(_ job: ChatUpload?) {
        let on = job != nil
        for v in [upVeil, upRing, upStop, upSize] { v.isHidden = !on }
        guard let job = job else { return }
        setUpload(job)
    }

    /// 진행률만 갈아 끼운다 — **배치는 한 번도 다시 안 돈다**(초에 수십 번
    /// 오는 값이라 여기서 `setNeedsLayout`을 부르면 그만큼 다시 잰다).
    func setUpload(_ job: ChatUpload) {
        upRing.value = job.total > 0 ? CGFloat(job.sent) / CGFloat(job.total) : 0
        let mb = { (n: Int64) in String(format: "%.2f", Double(n) / 1024 / 1024) }
        upSize.text = "\(mb(min(job.sent, job.total))) / \(mb(job.total))MB"
    }

    func fill(_ r: ChatRow, skin s: ChatSkin, maxBubble mb: CGFloat,
              textW tw: CGFloat, font: UIFont, photo pb: CGSize, card cw: CGFloat,
              find: String = "") {
        row = r
        self.find = find
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
               **같은 짜임이다**(34판) — 곳 이름 알약 · 큰 제목 · 그림 붙은 칩 ·
               가는 선 아래의 `○○님이 …`와 알약 단추. 가르는 규칙은
               `CardParts`에 한 벌로 있다. **한쪽만 고치지 말 것.** */
            cardView.backgroundColor = s.cardTint
            cardView.layer.cornerRadius = s.cardRadius
            cardRule.backgroundColor = s.cardRule
            /* 배지. **그림글자를 쓰지 말 것** — 기기에 없으면 네모난 두부가
               나온다. 이름은 웹의 `CARD_PATHS` 그대로이고 여기서 폰에 늘 있는
               그림으로 옮겨 그린다(길게 누른 창의 `HoldRow.symbols`와 같은 결). */
            cardBadge.backgroundColor = s.cardBadge
            cardBadge.layer.cornerRadius = s.cardIconSize / 2
            cardIcon.tintColor = s.card
            cardIcon.image = UIImage(systemName: BubbleCell.cardSymbol(r.icon))?
                .withRenderingMode(.alwaysTemplate)
            /* 흐린 그림은 웹처럼 `--grass` 색이다(`cardBadge`와 같은 값). */
            cardDeco.tintColor = s.cardBadge
            cardDeco.image = UIImage(systemName: BubbleCell.cardDecoSymbol(r.icon))?
                .withRenderingMode(.alwaysTemplate)

            let parts = CardParts.parse(r.body, icon: r.icon)
            cardParts = parts
            let f = CardFonts(s)
            let dim = s.text.withAlphaComponent(0.7)

            /* **알약과 단추가 잔디색 두 톤이다** — 곳 이름은 `--grass`,
               `보러 가기`는 한 톤 낮춘 `--grass-deep`. 연두 위 흰 글자는
               `필드` 이름표와 같은 **정해 둔 예외**다(대비 2.4:1).
               **분홍을 쓰지 말 것**(보내기 단추 몫이다). */
            cardPill.isHidden = parts.pill == nil
            if let pill = parts.pill {
                cardPill.backgroundColor = s.cardBadge
                cardPill.attributedText = NSAttributedString(string: pill, attributes: [
                    .font: f.pill, .foregroundColor: s.card,
                ])
            }
            cardTitle.attributedText = NSAttributedString(string: parts.title, attributes: [
                .font: f.title, .foregroundColor: s.text, .paragraphStyle: p,
            ])
            cardNote.isHidden = parts.notes.isEmpty
            if !parts.notes.isEmpty {
                cardNote.attributedText = NSAttributedString(
                    string: parts.notes.joined(separator: "\n"), attributes: [
                        .font: f.note, .foregroundColor: dim, .paragraphStyle: p,
                    ])
            }
            /* 곁줄 칩. **알려 주는 값이라 글자는 흐리고 그림만 잔디색이다.** */
            while cardChips.count < parts.chips.count {
                let c = CardChip()
                cardView.addSubview(c)
                cardChips.append(c)
            }
            for (i, c) in cardChips.enumerated() {
                c.isHidden = i >= parts.chips.count
                guard i < parts.chips.count else { continue }
                let text = parts.chips[i]
                c.label.attributedText = NSAttributedString(string: text, attributes: [
                    .font: f.chip, .foregroundColor: dim,
                ])
                c.icon.image = cardChipSymbol(text).flatMap {
                    UIImage(systemName: $0)?.withRenderingMode(.alwaysTemplate)
                }
                c.icon.tintColor = s.link
            }
            cardBy.isHidden = !parts.showBy
            if parts.showBy {
                cardBy.attributedText = NSAttributedString(string: parts.by, attributes: [
                    .font: f.by, .foregroundColor: s.text.withAlphaComponent(0.55),
                    .paragraphStyle: p,
                ])
            }
            let go = r.go ?? ""
            cardGo.isHidden = go.isEmpty
            cardGo.backgroundColor = s.link
            cardGo.attributedText = NSAttributedString(string: go, attributes: [
                .font: f.go, .foregroundColor: s.card,
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
            /* 동영상이면 ▶를 얹는다 — 그림은 첫 장면이라 그것만으로는
               사진과 구별이 안 된다. */
            playBadge.isHidden = !r.video
            /* 올리는 중에는 ▶를 안 얹는다 — 고리와 겹쳐 무엇을 누르는
               자리인지가 흐려진다. */
            if r.upload != nil { playBadge.isHidden = true }
            upVeil.layer.cornerRadius = r.kind == .sticker ? 0 : s.photoRadius
            showUpload(r.upload)
            ImageStore.put(nil, into: photoView)
            let mine = UUID()
            photoToken = mine
            let isPhoto = r.kind == .photo
            if let u = r.image, !u.isEmpty {
                ImageStore.shared.load(u) { [weak self] shot in
                    guard let self, self.photoToken == mine else { return }
                    ImageStore.put(shot, into: self.photoView)
                    if isPhoto, let f = shot?.first { self.onPhotoSize?(u, f.size) }
                }
            }
            if !capBubble.isHidden {
                capBubble.backgroundColor = r.mine ? s.mineBubble : s.bubble
                capBubble.layer.cornerRadius = s.radius
                let cap = NSMutableAttributedString(
                    string: r.cap ?? "", attributes: [
                        .font: font, .foregroundColor: s.text, .paragraphStyle: p,
                    ])
                /* 사진에 함께 적은 글도 같은 글(`m.body`)이라 자리가 그대로 맞는다. */
                ChatMentions.paint(cap, r.mentions)
                /* 찾은 글자가 **나중에** 칠해진다 — 부른 이름 안에 든
                   글자를 찾았으면 그게 찾은 글자로 보이는 것이 맞다. */
                ChatFind.paint(cap, r.cap ?? "", find)
                capLabel.attributedText = cap
            }
        }

        /* **가린 글(`other`)은 말풍선을 벗긴다** — 웹의 `.chat-hidden`과 같은
           모양이다(사용자가 고른 것: 흐린 한 줄). 덮어 둔 글에 말풍선을
           두르면 오히려 여느 말보다 도드라진다. 말은 웹이 `HIDDEN_LINE`
           하나로 보내 주므로 여기서 지어내지 않는다. */
        let bare = r.big || r.kind == .other
        bubble.backgroundColor = bare ? .clear : (r.mine ? s.mineBubble : s.bubble)
        bubble.layer.cornerRadius = s.radius
        let body = r.kind == .other ? (r.note ?? r.body) : r.body
        let shown = NSMutableAttributedString(string: body, attributes: [
            .font: r.big ? UIFont.systemFont(ofSize: s.bigSize) : font,
            .foregroundColor: r.kind == .other ? s.faint : s.text,
            /* 큰 이모지는 **줄 간격을 못박지 않는다** — 18px에 가두면
               40px 글자가 서로 겹친다(웹도 거기서만 `line-height: 1.15`다). */
            .paragraphStyle: r.big ? NSParagraphStyle.default : p,
        ])
        /* `@이름`은 파랗게(나·`@전체`는 분홍) — **글칸과 같은 색이다**.
           자리가 `r.body` 기준이라 **글자를 갈아 끼운 줄(`other`)에는 안 칠한다.** */
        if r.kind != .other { ChatMentions.paint(shown, r.mentions) }
        /* **찾은 글자는 파랗게**(사용자 요청) — 가린 글은 글자를 갈아
           끼운 줄이라 안 칠한다(덮어 둔 내용이 그리로 새면 안 된다). */
        if r.kind != .other { ChatFind.paint(shown, body, find) }
        bodyLabel.attributedText = shown

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

    /**
     * 카드 머리 배지의 그림. **이름은 웹의 `CARD_PATHS` 그대로다** —
     * 웹은 선 SVG, 여기서는 폰에 늘 있는 그림(SF Symbol)이라 생김새는 조금
     * 다르지만 **한 화면에 둘이 같이 서지 않으므로** 어긋날 자리가 없다
     * (길게 누른 창의 `HoldRow.symbols`와 같은 결이다).
     *
     * **그림글자(이모지)를 쓰지 말 것** — 기기에 없으면 네모난 두부가 나온다.
     */
    static func cardSymbol(_ name: String?) -> String {
        switch name {
        case "round": return "flag.fill"
        case "poll": return "checkmark.square.fill"
        case "post": return "megaphone.fill"
        default: return "bell.fill"
        }
    }

    /**
     * 카드 오른쪽에 흐리게 깔리는 그림(37판). 웹의 `CARD_DECO`와 같은 뜻으로
     * 고른다 — 라운드는 깃발, 투표는 표가 쌓인 막대, 공지는 확성기.
     * 웹은 선 SVG이고 여기는 SF Symbol이라 생김새는 조금 다르지만 **옅기가
     * 0.14라 그 차이는 눈에 안 걸린다** — 있고 없고가 걸렸다.
     */
    static func cardDecoSymbol(_ name: String?) -> String {
        switch name {
        case "round": return "flag.fill"
        case "poll": return "chart.bar.fill"
        case "post": return "megaphone.fill"
        default: return "bell.fill"
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard let r = row else { return }
        let w = contentView.bounds.width
        /* **높이 셈(`height`)과 같은 자리에서 시작해야 한다** — 한쪽만
           고치면 줄이 제 칸 밖으로 밀려 나간다. */
        var y: CGFloat = r.top

        if !dateChip.isHidden {
            let size = dateChip.intrinsicContentSize
            /* 웹의 `.chat-day`는 `margin: 16px auto 10px`이다. */
            dateChip.frame = CGRect(x: (w - size.width) / 2, y: y + 16,
                                    width: size.width, height: size.height)
            y = dateChip.frame.maxY + 10
        }

        if !markView.isHidden {
            markView.frame = CGRect(x: 0, y: y, width: w, height: 30)
            y += 30
        }

        if r.kind == .system {
            let maxW = w - skin.pad * 4
            let size = sysChip.sizeThatFits(CGSize(width: maxW, height: .greatestFiniteMagnitude))
            let cw = min(maxW, size.width)
            sysChip.frame = CGRect(x: (w - cw) / 2, y: y, width: cw, height: size.height)
            return
        }

        if r.kind == .card {
            /* **자리는 `cardBox`가 셈한다** — `height(_:)`가 쓰는 그 함수라
               둘이 어긋날 자리가 없다(34판). */
            let box = cardBox(cardParts, go: r.go ?? "", skin: skin, width: cardW)
            cardView.frame = CGRect(x: (w - cardW) / 2, y: y,
                                    width: cardW, height: box.height)
            /* 웹 `.chat-result-deco` — `right: 0; bottom: 36px; 80×56`. */
            cardDeco.frame = CGRect(x: cardW - 80, y: box.height - 36 - 56,
                                    width: 80, height: 56)
            cardBadge.frame = box.badge
            cardIcon.frame = cardBadge.bounds.insetBy(dx: box.badge.width * 0.2,
                                                      dy: box.badge.height * 0.2)
            cardPill.frame = box.pill
            cardPill.layer.cornerRadius = box.pill.height / 2
            cardTitle.frame = box.title
            for (i, c) in cardChips.enumerated() where i < box.chips.count {
                c.frame = box.chips[i]
            }
            cardNote.frame = box.notes.first ?? .zero
            cardRule.frame = box.rule
            cardBy.frame = box.by
            cardGo.frame = box.go
            cardGo.layer.cornerRadius = box.go.height / 2
            return
        }

        /* **얼굴은 줄의 맨 위, 이름 줄과 나란히 선다**(38판). 웹의 `.chat-row`가
           `align-items: flex-start`라 얼굴(`.chat-avatar`)은 이름(`.chat-who`)과
           같은 높이에서 시작하고 말풍선은 그 아래다. 37판까지는 얼굴을
           말풍선 옆에 두어 이름 줄만큼 내려앉았고, 뒤로 끌어 돌아올 때 웹
           그림(얼굴이 이름 옆)에서 앱 목록(얼굴이 말풍선 옆)으로 바뀌는
           순간 얼굴이 툭 내려가 **두 화면이 오가는 것처럼** 보였다
           (사용자 제보 — `채팅 프로필도 닉네임에있었는데 말풍선옆에있어`). */
        let rowTop = y
        if !nameLabel.isHidden {
            let x = skin.pad + skin.avatar + skin.avatarGap
            /* 웹 `.chat-who`의 줄 높이(13.5 × 1.5)와 `.chat-col`의 `gap: 2px`. */
            nameLabel.frame = CGRect(x: x, y: y, width: w - x - skin.pad,
                                     height: skin.nameSize * 1.5)
            y = nameLabel.frame.maxY + 2
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
            /* 말풍선을 안 두르는 줄(큰 이모지 · 가린 글)은 가로 안여백이
               거의 없다 — 웹의 `.emoji-only`·`.chat-hidden`과 같다.
               **세로는 가린 글만 그대로 둔다**(한 줄 높이가 안 흔들리게). */
            let padH = (r.big || r.kind == .other) ? 2 : skin.padH
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
            /* 줄 맨 위(`rowTop`) — 이름 줄·인용 쪽지가 있어도 안 내려온다.
               웹의 `.chat-avatar`가 그렇다(위 주석). */
            avatarView.frame = CGRect(x: skin.pad, y: rowTop,
                                      width: skin.avatar, height: skin.avatar)
        }
        if hasImage {
            photoView.frame = CGRect(x: x, y: y, width: bw, height: bh)
            playBadge.frame = photoView.bounds
            if !upVeil.isHidden {
                upVeil.frame = photoView.bounds
                let ring: CGFloat = 64
                upRing.frame = CGRect(x: (bw - ring) / 2, y: (bh - ring) / 2,
                                      width: ring, height: ring)
                upStop.frame = upRing.frame
                /* 용량 줄은 고리 **아래**다(카톡의 그 자리). 사진이 작으면
                   아래가 모자라니 상자 안으로 밀어 넣는다. */
                let sy = min(bh - 18, upRing.frame.maxY + 6)
                upSize.frame = CGRect(x: 0, y: sy, width: bw, height: 16)
            }
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
            let padH = (r.big || r.kind == .other) ? 2 : skin.padH
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
 * `최근 대화로` 동그라미(21판 · 웹의 `.chat-jump`와 같은 것이다).
 *
 * **앱이 그리는 까닭**: 이 단추는 목록 위에 떠 있는데 앱 목록은 웹 화면
 * 위에 얹힌 앱 부품이라, 웹이 그리면 **통째로 가려진다**(사용자 제보 —
 * `최신대화로 버튼 안나옴`). 네이티브 바에서 겪은 그 자리다.
 *
 * **카톡처럼 오른쪽 아래의 작은 동그라미다**(사용자 요청 — `최근대화로
 * 가는 버튼을 카톡처럼 바꿔줘` · 카톡 사진을 받아 픽셀로 맞췄다).
 * 한동안 **얼굴 · 이름 · 한 줄 미리보기 · `↓`를 펼친 줄**이었는데,
 * 그 줄은 좌우를 다 써서 말풍선 한 줄을 통째로 덮었다.
 * 지금 값은 재서 얻은 것이다 — 지름 38 · 흰 칠 · **테두리도 그림자도 없다**
 * (카톡 사진에서 동그라미 바로 밑이 그냥 대화 바탕색이었다).
 * **분홍을 쓰지 않는다** — 이 화면에서 '지금 눌러야 할 것'은 보내기 하나다.
 *
 * **그림글자를 쓰지 말 것** — 기기에 없으면 네모난 두부가 나온다.
 * SF Symbol 꺾쇠다(`HoldRow`와 같은 결).
 */
final class JumpBar: UIControl {
    private let mark = UIImageView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        layer.cornerCurve = .continuous
        mark.contentMode = .center
        /* 카톡의 꺾쇠는 재 보니 가로 17 · 세로 7 · 획 2.7이었다 —
           15pt semibold이 그 자리에 가장 가깝다. */
        mark.image = UIImage(systemName: "chevron.down", withConfiguration:
            UIImage.SymbolConfiguration(pointSize: 15, weight: .semibold))
        mark.isUserInteractionEnabled = false
        addSubview(mark)
    }

    required init?(coder: NSCoder) { fatalError() }

    func paint(skin: ChatSkin) {
        backgroundColor = skin.jumpBg
        mark.tintColor = skin.text
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        mark.frame = bounds
        layer.cornerRadius = bounds.height / 2
    }

    override var isHighlighted: Bool {
        didSet { alpha = isHighlighted ? 0.7 : 1 }
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
        ImageStore.shared.load(url) { [weak self] shot in
            guard let self, self.token == mine, let img = shot?.first else { return }
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
 * 그림 한 장. **정지면 `frames`가 하나**이고, 움직이는 것이면 여럿이다 —
 * 이모티콘의 `.webp`가 그렇다(12장 · `loop=3`).
 */
final class Shot {
    let frames: [UIImage]
    let duration: TimeInterval
    init(frames: [UIImage], duration: TimeInterval) {
        self.frames = frames
        self.duration = duration
    }
    var first: UIImage? { return frames.first }
    var moving: Bool { return frames.count > 1 }
    /// 담아 둘 때의 무게(바이트 어림) — `NSCache`가 이걸 보고 버린다.
    var cost: Int {
        guard let f = frames.first else { return 1 }
        return Int(f.size.width * f.size.height * 4) * frames.count
    }
}

/**
 * 그림을 한 번만 받아 담아 둔다.
 *
 * **받아 오는 곳이 둘이다 — 앱 안과 인터넷.**
 * 이모티콘은 회원이 올린 것이 아니라 **앱에 딸린 붙박이**라 `dist`에 담겨
 * 번들(`public/stickers/…`)에 들어 있고, 웹이 주는 주소도 상대 경로다
 * (`stickerSrc()` — `import.meta.env.BASE_URL`이 `./`다). 그래서
 * **`URLSession`으로는 한 장도 못 받아** 이모티콘 자리가 통째로 비어 있었다
 * (사용자 제보 · 사진 — 시각과 안 읽은 수만 떠 있었다). 우리 대화방은
 * 대부분이 이모티콘이라 화면이 통째로 빈 것처럼 보인다.
 * **주소가 `http(s)`가 아니면 번들에서 읽는다**(사진만 인터넷에서 온다).
 *
 * **주소를 `https`로 올려 받는다** — 카카오 프사가 `http://k.kakaocdn.net/…`
 * 으로 저장돼 있는데, 앱에서는 iOS가 http를 통째로 막아 그림만 조용히
 * 실패한다(웹에서 겪고 `Avatar`의 `https()`로 고친 그 자리다).
 * **`NSAllowsArbitraryLoads`로 열지 말 것** — 앱 전체의 http를 여는 일이다.
 */
final class ImageStore {
    static let shared = ImageStore()
    private let cache = NSCache<NSString, Shot>()
    private var waiting: [String: [(Shot?, Bool) -> Void]] = [:]
    /**
     * **폰에서 방금 고른 사진·동영상의 미리보기**(`local-preview/…`).
     *
     * 올리기 전에 대화방에 먼저 그리려면 보여 줄 그림이 있어야 하는데,
     * 그건 아직 아무 주소에도 없다 — 골라서 읽어 둔 그 이미지를 여기에
     * 담아 두고 임시 줄의 `image_url`로 그 열쇠를 쓴다.
     *
     * **`cache`(NSCache)에 넣지 않는다** — 그쪽은 무게가 차면 말없이
     * 버리는데, 버려지면 올리는 중인 그림이 빈 칸이 된다.
     * 올라가고 나면 `drop()`으로 우리가 지운다.
     */
    private var held: [String: Shot] = [:]

    /// 고른 그림을 그 열쇠(`local-preview/<uuid>.<확장자>`)로 담아 둔다.
    static func hold(_ key: String, _ image: UIImage?) {
        guard let image = image else { return }
        shared.held[key] = Shot(frames: [image], duration: 0)
    }
    static func drop(_ key: String) { shared.held.removeValue(forKey: key) }

    /// 미리 풀어 둘 차례 — 한 번에 하나씩만 푼다(`warm`).
    private var warmQ: [String] = []
    private var warming = false

    /**
     * **미리 풀어 둔다 — 서랍을 열기 전에**(사용자 제보 — `채팅을 누르면
     * 이모티콘을 다운받게해서 이모티콘이 빨리뜨게할수없을까? 카톡은 바로
     * 뜨던데 우리는 너무 안떠`).
     *
     * **앱에서는 받아 올 것이 없다** — 이모티콘 그림은 `dist`에 담겨
     * 앱 안에 있고(`inApp`) 읽는 것은 디스크에서다. 늦는 것은 **푸는 값**
     * 이다: 서랍을 열면 보이는 칸 열대여섯에 대해 그 자리에서 파일을 읽고
     * 풀기 시작하는데, 첫 묶음이 통째로 움직이는 판이라 한 장이
     * 256px × 12프레임 = **3.1MB**짜리 픽셀이 된다.
     *
     * 그래서 **대화방에 들어갈 때 첫 묶음의 멈춘 그림(`<id>.png`)을 미리
     * 풀어 담아 둔다.** 서른 장이 파일로 1.4MB · 푼 값으로 7.9MB라
     * 캐시 한도(48MB)에 여유롭게 든다 — 움직이는 판 서른 장은 94MB라
     * **미리 풀면 서로를 밀어내므로 여기 넣지 말 것.**
     * 그러면 서랍을 여는 그 프레임에 `fetch`가 캐시에서 곧바로 답해
     * **칸이 채워진 채로 뜨고**, 움직이는 판은 예전처럼 뒤따라 갈아 끼운다.
     *
     * - **한 번에 하나씩 푼다.** 사람이 보고 있는 것(대화의 사진·이모티콘)과
     *   다투면 미리 푸는 뜻이 없어진다 — 웹의 `미리 받아 두기`가 세 장씩
     *   나눠 켜는 것과 같은 결이다.
     * - **이미 담아 둔 것과 줄 서 있는 것은 건너뛴다.**
     * - `fetch`가 `cache`·`waiting`을 건드리므로 **메인에서만 돈다.**
     */
    static func warm(_ srcs: [String]) {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { ImageStore.warm(srcs) }; return
        }
        let store = shared
        for s in srcs where store.cache.object(forKey: s as NSString) == nil
            && !store.warmQ.contains(s) {
            store.warmQ.append(s)
        }
        store.warmNext()
    }

    private func warmNext() {
        guard !warming else { return }
        while let s = warmQ.first {
            warmQ.removeFirst()
            guard cache.object(forKey: s as NSString) == nil else { continue }
            warming = true
            fetch(s) { [weak self] _, _ in
                guard let self else { return }
                self.warming = false
                self.warmNext()
            }
            return
        }
    }

    init() {
        /* 움직이는 이모티콘은 푼 프레임이 한 장에 3MB쯤이라(256px × 12장)
           개수로 막으면 안 되고 **무게로 막아야 한다.** */
        cache.totalCostLimit = 48 * 1024 * 1024
    }

    func load(_ raw: String, done: @escaping (Shot?) -> Void) {
        fetch(raw) { shot, _ in done(shot) }
    }

    /**
     * 그림과 **못 받아 온 까닭**을 함께 준다(44판).
     *
     * `gone`이 참이면 **통이 `없다`고 답한 것**이다 — 저장 기간이 지나
     * 지워진 사진(`lib/photos.ts`). 거짓이면 그때 못 받았을 뿐이라
     * **다음에 다시 해 보면 된다**(끊김 · 시간 초과 · 못 푼 그림).
     *
     * **둘을 갈라야 하는 까닭은 서랍이다.** `ChatThumb`은 못 받아 온 사진을
     * `지워진 것`으로 보고 목록에서 빼는데, 그 판단이 **아무 실패에나**
     * 걸리면 한 번 끊길 때마다 한 장씩 영영 사라져 **끝내 묶음째 안 그려진다**
     * (사용자 제보 — `메뉴눌렀을때 나오던 사진이 안나옴`). 사진을 원본
     * 그대로 올리게 되면서 한 장이 3~5MB라 그 실패가 훨씬 잦아졌다.
     */
    func fetch(_ raw: String, done: @escaping (Shot?, Bool) -> Void) {
        var s = raw
        if s.hasPrefix("http://") { s = "https://" + s.dropFirst("http://".count) }
        if let mine = held[s] { done(mine, false); return }
        if let hit = cache.object(forKey: s as NSString) { done(hit, false); return }
        if waiting[s] != nil { waiting[s]?.append(done); return }
        waiting[s] = [done]
        let finish: (Shot?, Bool) -> Void = { [weak self] shot, gone in
            guard let self else { return }
            if let shot = shot { self.cache.setObject(shot, forKey: s as NSString,
                                                      cost: shot.cost) }
            let all = self.waiting.removeValue(forKey: s) ?? []
            all.forEach { $0(shot, gone) }
        }
        /* **동영상은 첫 장면만 떠 온다** — 통째로 받으면 목록을 훑기만 해도
           몇십 MB가 나간다(`AVURLAsset`은 앞부분만 읽는다).
           못 떠 와도 **지워진 것으로 보지 않는다** — 재생기는 그대로 열린다. */
        if ChatMedia.isVideo(s) { ImageStore.poster(s) { finish($0, false) }; return }
        /* **푸는 일은 메인에서 하지 말 것.** 움직이는 이모티콘 한 장이
           256px 열두 프레임이라, 서랍의 첫 묶음(움직임 18장)을 열면 216장을
           푼다 — 그것을 메인에서 하면 **그동안 화면이 한 프레임도 안 그려져
           서랍이 빈 채로 멈춰 있다**(사용자 제보 — `이모티콘을 누르면 바로
           안뜨고 골프공이나 다른걸 누른후에 떠`. 골프공은 정지 PNG 한 장이라
           싸다). 담아 두는 것(`finish`)은 그대로 메인에서 한다 —
           `cache`·`waiting`을 건드리기 때문이다. */
        bytes(s) { data, gone in
            guard let data = data else { finish(nil, gone); return }
            DispatchQueue.global(qos: .userInitiated).async {
                let shot = ImageStore.decode(data)
                DispatchQueue.main.async { finish(shot, gone) }
            }
        }
    }

    /**
     * 동영상의 첫 장면 한 장. 못 떠 오면 `nil`이라 **회색 칸에 ▶만** 남는다 —
     * 그 자리도 눌러서 재생은 된다.
     */
    private static func poster(_ s: String, done: @escaping (Shot?) -> Void) {
        guard let url = URL(string: s), url.scheme == "https" else { done(nil); return }
        DispatchQueue.global(qos: .userInitiated).async {
            let gen = AVAssetImageGenerator(asset: AVURLAsset(url: url))
            gen.appliesPreferredTrackTransform = true   // 세로로 찍은 것이 눕지 않게
            gen.maximumSize = CGSize(width: 720, height: 720)
            let at = CMTime(seconds: 0.2, preferredTimescale: 600)
            let cg = try? gen.copyCGImage(at: at, actualTime: nil)
            let shot = cg.map { Shot(frames: [UIImage(cgImage: $0)], duration: 0) }
            DispatchQueue.main.async { done(shot) }
        }
    }

    /**
     * 앱 안에서 읽거나 인터넷에서 받아 온다. 답은 늘 **메인에서** 준다.
     *
     * 함께 주는 참·거짓은 **통이 `없다`고 답했는가**다 — 저장소는 지워진
     * 파일에 400이나 404로 답한다. 그때만 지워진 것으로 보고, 끊김·시간
     * 초과는 거짓이라 다음에 다시 해 본다(`fetch` 주석).
     */
    private func bytes(_ s: String, done: @escaping (Data?, Bool) -> Void) {
        if let local = ImageStore.inApp(s) {
            DispatchQueue.global(qos: .userInitiated).async {
                let d = try? Data(contentsOf: local)
                DispatchQueue.main.async { done(d, false) }
            }
            return
        }
        guard let url = URL(string: s), url.scheme == "https" else { done(nil, false); return }
        URLSession.shared.dataTask(with: url) { data, res, _ in
            let code = (res as? HTTPURLResponse)?.statusCode ?? 0
            let gone = code == 400 || code == 404
            /* 없다고 답한 판의 몸통은 그림이 아니라 오류 글이다 — 넘기지 않는다. */
            DispatchQueue.main.async { done(gone ? nil : data, gone) }
        }.resume()
    }

    /**
     * 앱 번들 안의 자리. 웹이 주는 주소가 `./stickers/x.png`처럼 **상대**
     * 이거나 `capacitor://localhost/stickers/x.png`이면 여기로 온다.
     *
     * **없으면 `nil`이다** — 그때는 인터넷 쪽으로 간다(사진이 그렇다).
     */
    static func inApp(_ s: String) -> URL? {
        if s.hasPrefix("http://") || s.hasPrefix("https://") { return nil }
        var p = s
        if let u = URL(string: s), u.scheme != nil { p = u.path }
        while p.hasPrefix("./") { p.removeFirst(2) }
        while p.hasPrefix("/") { p.removeFirst() }
        guard !p.isEmpty, let base = Bundle.main.resourceURL else { return nil }
        let f = base.appendingPathComponent("public").appendingPathComponent(p)
        return FileManager.default.fileExists(atPath: f.path) ? f : nil
    }

    /**
     * 푼다. **여러 장이면 움직이는 것이다** — 이모티콘의 `.webp`가 그렇다
     * (ImageIO가 iOS 14부터 webp를 읽는다. 우리 최소 판이 14다).
     */
    private static func decode(_ d: Data) -> Shot? {
        guard let src = CGImageSourceCreateWithData(d as CFData, nil) else {
            return UIImage(data: d).map { Shot(frames: [$0], duration: 0) }
        }
        let n = CGImageSourceGetCount(src)
        if n <= 1 {
            return UIImage(data: d).map { Shot(frames: [$0], duration: 0) }
        }
        var frames: [UIImage] = []
        var total: TimeInterval = 0
        for i in 0..<n {
            guard let cg = CGImageSourceCreateImageAtIndex(src, i, nil) else { continue }
            frames.append(UIImage(cgImage: cg))
            total += delay(src, i)
        }
        guard !frames.isEmpty else { return nil }
        /* 못 읽으면 12fps로 본다 — 우리가 굽는 값이다(`lib/stickers.ts` 머리말). */
        return Shot(frames: frames,
                    duration: total > 0 ? total : Double(frames.count) / 12)
    }

    /// 한 장이 머무는 시간. **키 이름을 글자로 찾는다** — `{WebP}`·`{GIF}`·
    /// `{APNG}`가 판마다 `@available`이 갈려서, 글자로 보면 한 줄로 끝난다.
    private static func delay(_ src: CGImageSource, _ i: Int) -> TimeInterval {
        let props = CGImageSourceCopyPropertiesAtIndex(src, i, nil) as? [String: Any]
        for key in ["{WebP}", "{GIF}", "{APNG}"] {
            guard let d = props?[key] as? [String: Any] else { continue }
            if let v = d["UnclampedDelayTime"] as? Double, v > 0 { return v }
            if let v = d["DelayTime"] as? Double, v > 0 { return v }
        }
        return 0
    }

    /**
     * 그림칸에 앉힌다. **움직이는 것은 세 번만 돈다**(웹에서 굽는 `loop=3`과
     * 같은 값이다) — 늘 켜져 있는 그리기 비용이 화면을 끊기게 한다는 그
     * 규칙이 여기에도 걸린다. 한 사람이 열 장 보내면 그게 열 개다.
     */
    static func put(_ shot: Shot?, into iv: UIImageView) {
        iv.stopAnimating()
        iv.animationImages = nil
        iv.image = shot?.first
        guard let s = shot, s.moving else { return }
        /* 다 돌고 나면 `image`가 보인다 — **마지막 장에서 멈춘다**(웹의
           `loop=3`이 그렇다. 첫 장으로 되돌아가면 글자가 없는 그림에서
           멈추는 판이 있다). */
        iv.image = s.frames.last
        iv.animationImages = s.frames
        iv.animationDuration = s.duration
        iv.animationRepeatCount = 3
        iv.startAnimating()
    }
}

// MARK: - 길게 누르면 뜨는 창 (27판)

/**
 * 말풍선을 길게 눌렀을 때 뜨는 창 — **앱이 그린다.**
 *
 * 26판까지는 **웹이 그렸다.** 그런데 웹 창은 앱 목록을 못 덮으므로(웹의
 * `z-index`로는 앱 부품을 못 덮는다) 창이 뜨는 동안 **앱 목록을 감추고 웹
 * 목록을 도로 내보이는 바꿔치기**를 했는데, 두 목록은 **글꼴이 달라**
 * (앱은 폰 기본 글꼴, 웹은 Pretendard) 줄 높이와 줄 바뀌는 자리가 조금씩
 * 어긋나고 **아래로 갈수록 쌓인다** — 그래서 창이 뜨는 순간 말풍선과
 * 얼굴이 통째로 움찔했다(사용자 제보 · 사진 — `팝업이 있을때와 없을때
 * 프로필이나 말풍선 위치가 틀어져`). 줄 간격을 맞춰도(26판) 그대로였다.
 *
 * **앱이 그리면 바꿔치기 자체가 없어진다** — 그것이 이 판의 전부다.
 *
 * **무엇이 뜨는지는 그대로 웹이 정한다**(`listMenu`의 `items`) — 누구에게
 * 무엇이 붙는지(복사·선택 복사·댓글·공유·캡쳐 + 운영진의 가리기·공지로
 * 올리기 + 쓴 사람의 삭제)는 `Chat.tsx`에 한 벌로 있고, **앱은 그리기와
 * 누르기만** 맡는다. 두 벌로 만들면 한쪽만 고치게 된다.
 *
 * **자리 셈은 웹의 `HoldAt`을 그대로 옮긴 것이다** — 가로는 말풍선의
 * 가까운 쪽에 붙이고(내 글은 오른쪽 끝), 세로는 아래를 먼저 보고 안
 * 들어가면 위로 넘긴다. 가장자리에서 8px은 띄운다. **한쪽만 고치지 말 것.**
 */
final class HoldMenu: UIView {

    /// 창에 설 줄 하나. **글자도 갈래 이름도 웹이 준다.**
    struct Item {
        let name: String
        let label: String
        let icon: String
        let danger: Bool

        init?(_ d: [String: Any]) {
            guard let n = d["name"] as? String, let l = d["label"] as? String else { return nil }
            name = n
            label = l
            icon = (d["icon"] as? String) ?? ""
            danger = (d["danger"] as? Bool) ?? false
        }
    }

    /// 고른 것 — `item`(줄) · `react`(알약) · `close`(바탕을 누름).
    var onPick: ((String, String) -> Void)?

    /* **카톡 화면을 픽셀로 재서 맞춘 값이고 웹의 `.chat-menu`와 같다.**
       눈대중으로 고치지 말 것 — 고칠 일이 생기면 `Chat.css`와 함께 고친다.
       한 줄 40px · 알약 40px은 **30px 아래로 내리지 말 것**(누를 자리다). */
    private let cardW: CGFloat = 300
    private let itemH: CGFloat = 40
    private let cardRadius: CGFloat = 14
    private let pill: CGFloat = 40
    private let pillPadH: CGFloat = 6
    private let pillPadV: CGFloat = 4
    /// 카드와 알약 줄 사이(웹 `.chat-hold`의 `gap: 8px`).
    private let gap: CGFloat = 8
    /// 화면 가장자리에서 띄울 만큼(웹 `HoldAt`의 `M`).
    private let edge: CGFloat = 8
    /// 말풍선과의 사이(웹 `HoldAt`의 `GAP`).
    private let near: CGFloat = 6

    private let dim = UIView()
    /* **묶는 칸을 두지 않는다**(웹의 `.chat-hold`에 해당하는 것).
       카드와 알약을 감싸는 칸을 하나 두면 **그 사이 8px을 눌렀을 때 그
       칸이 손짓을 먹어** 아무 일도 안 일어난다 — 웹에서는 그 자리를 누르면
       바탕까지 올라가 창이 닫힌다. 자리는 셈해서 각자에게 주면 되므로
       칸이 있을 까닭이 없다. */
    /// 카드 — **그림자만** 맡는다(자르면 그림자가 안 보인다).
    private let card = UIView()
    /// 그 안 — **자르기만** 맡고 줄이 여기 든다.
    private let cardBody = UIView()
    private let pills = UIView()

    private var skin = ChatSkin()
    private var items: [Item] = []
    private var reacts: [String] = []
    private var rows: [HoldRow] = []
    private var pillBtns: [HoldPill] = []
    /// 누른 말풍선의 자리 — **창 좌표다**(`listHold`가 보내는 그 값).
    private var at: CGRect = .zero
    private var mine = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        /* **옅게 덮는다**(웹의 `.chat-menu-back.soft`, 0.30) — 짙게 가리면
           어느 글을 누른 것인지가 사라진다. */
        dim.backgroundColor = UIColor(red: 4 / 255, green: 8 / 255, blue: 16 / 255, alpha: 0.30)
        addSubview(dim)
        let tap = UITapGestureRecognizer(target: self, action: #selector(dimTapped))
        dim.addGestureRecognizer(tap)

        /* **선 없이 그림자만 있다**(카톡의 그 카드와 같다).
           **한 겹으로는 안 된다** — 자르는 것(`clipsToBounds`)과 그림자는
           같은 레이어에서 서로를 지운다(자르면 그림자가 안 보이고, 안 자르면
           눌린 줄의 네모난 칠이 둥근 모서리 밖으로 삐져나온다). 그래서
           **바깥은 그림자만, 안쪽은 자르기만** 맡는다. */
        card.layer.cornerRadius = cardRadius
        card.layer.cornerCurve = .continuous
        cardBody.layer.cornerRadius = cardRadius
        cardBody.layer.cornerCurve = .continuous
        cardBody.clipsToBounds = true
        card.addSubview(cardBody)
        /* 알약 줄은 안 자른다 — 눌린 표시가 동그라미라 제 알약 안에서
           끝나므로 넘칠 것이 없다. */
        pills.layer.cornerCurve = .continuous
        addSubview(card)
        addSubview(pills)
        /* **칠을 여기서 한 번 해 둔다 — `apply(skin:)`에만 두지 말 것.**
           웹이 색을 보내 줄 때만 칠하게 두었더니, **앱이 통째로 그리는
           대화 화면**(`NativeChatViewController`)은 그 신호를 아무 데서도
           안 보내므로 `cardBody`·`pills`의 바탕이 **nil(= 투명)** 으로
           남았다 — 길게 누르면 흰 카드 없이 `복사·선택 복사·댓글…` 글자만
           대화 위에 떠 고장 난 것처럼 보였다(사용자 제보 · 사진).
           `ChatSkin`의 기본값이 곧 예비값이므로 처음부터 그것으로 칠한다. */
        paint()
        isHidden = true
    }

    required init?(coder: NSCoder) { fatalError() }

    @objc private func dimTapped() { onPick?("close", "") }

    /* **색도 웹이 준다**(`chatListSkin()` — 목록과 같은 한 벌이다).
       네이티브 쪽 값은 예비값일 뿐이다: 앱은 한 바퀴가 30분인데 웹은 밀면
       바로 올라가므로, 어긋난 것을 고치는 길이 웹에 있어야 한다. */
    func apply(skin d: [String: Any]) {
        skin.apply(d)
        paint()
        setNeedsLayout()
    }

    /// 지금 들고 있는 값으로 칠한다 — 처음 세울 때와 웹이 색을 줄 때 같이 쓴다.
    private func paint() {
        cardBody.backgroundColor = skin.card
        pills.backgroundColor = skin.card
        for r in rows { r.paint(skin: skin) }
        for p in pillBtns { p.paint(skin: skin) }
    }

    /**
     * 창을 띄운다. **줄이 하나도 없으면 안 띄운다** — 빈 카드가 뜨면
     * 고장으로 보인다.
     */
    func show(at rect: CGRect, mine m: Bool, items list: [Item], reacts r: [String]) {
        guard !list.isEmpty else { hide(); return }
        at = rect
        mine = m
        items = list
        reacts = r

        for v in rows { v.removeFromSuperview() }
        rows = list.enumerated().map { i, it in
            let row = HoldRow(item: it, line: i > 0)
            row.paint(skin: skin)
            row.addTarget(self, action: #selector(rowTapped(_:)), for: .touchUpInside)
            cardBody.addSubview(row)
            return row
        }
        for v in pillBtns { v.removeFromSuperview() }
        pillBtns = r.map { e in
            let b = HoldPill(emoji: e)
            b.paint(skin: skin)
            b.addTarget(self, action: #selector(pillTapped(_:)), for: .touchUpInside)
            pills.addSubview(b)
            return b
        }
        pills.isHidden = r.isEmpty
        pills.layer.cornerRadius = (pill + pillPadV * 2) / 2

        isHidden = false
        setNeedsLayout()
        layoutIfNeeded()
        /* 나타나는 연출은 짧게 한 번만(웹의 `chat-hold-in 0.14s`).
           `transform`과 `opacity`만 움직인다 — 그것이 이 앱의 규칙이다. */
        dim.alpha = 0
        for v in [card, pills] {
            v.alpha = 0
            v.transform = CGAffineTransform(scaleX: 0.94, y: 0.94)
        }
        UIView.animate(withDuration: 0.14, delay: 0, options: [.curveEaseOut]) {
            self.dim.alpha = 1
            for v in [self.card, self.pills] {
                v.alpha = 1
                v.transform = .identity
            }
        }
    }

    func hide() {
        isHidden = true
        /* 반쯤 줄어든 채로 굳으면 다음에 띄울 때 그대로 보인다. */
        for v in [card, pills] { v.transform = .identity }
    }

    @objc private func rowTapped(_ r: HoldRow) { onPick?("item", r.name) }
    @objc private func pillTapped(_ p: HoldPill) { onPick?("react", p.emoji) }

    override func layoutSubviews() {
        super.layoutSubviews()
        dim.frame = bounds
        guard !items.isEmpty else { return }

        /* **누른 자리는 창 좌표로 왔다** — 우리 칸으로 옮겨 쓴다. */
        let a = convert(at, from: nil)
        let w = min(cardW, bounds.width - edge * 2)
        let cardH = itemH * CGFloat(items.count)
        let pillsW = reacts.isEmpty ? 0 : pillPadH * 2 + pill * CGFloat(reacts.count)
        let pillsH = reacts.isEmpty ? 0 : pill + pillPadV * 2
        let gw = max(w, pillsW)
        let h = cardH + (reacts.isEmpty ? 0 : gap + pillsH)

        /* 가로는 **말풍선의 가까운 쪽**에 붙인다(내 글은 오른쪽 끝).
           누른 자리에서 눈이 안 움직인다. */
        var left = mine ? a.maxX - gw : a.minX
        left = max(edge, min(left, bounds.width - gw - edge))
        /* 세로는 **아래를 먼저 보고, 안 들어가면 위로 넘긴다.**
           `bounds`가 곧 보이는 높이다 — 키보드가 올라오면 `resize: 'native'`가
           웹뷰를 그만큼 줄여 주므로 따로 잴 것이 없다(웹은 그 자리에서
           `visualViewport`를 봐야 했다). */
        var top = a.maxY + near
        if top + h > bounds.height - edge { top = a.minY - near - h }
        top = max(edge, min(top, max(edge, bounds.height - h - edge)))

        /* 카드와 알약도 묶음 안에서 **가까운 쪽으로 붙는다**(웹 `.chat-hold`의
           `align-items: flex-start` / `.mine`의 `flex-end`). 둘이 폭이 달라
           넓은 쪽(`gw`)을 기준으로 민다. */
        place(card, CGRect(x: left + (mine ? gw - w : 0), y: top, width: w, height: cardH))
        cardBody.frame = card.bounds
        for (i, r) in rows.enumerated() {
            r.frame = CGRect(x: 0, y: itemH * CGFloat(i), width: w, height: itemH)
        }
        if !reacts.isEmpty {
            place(pills, CGRect(x: left + (mine ? gw - pillsW : 0), y: top + cardH + gap,
                                width: pillsW, height: pillsH))
            for (i, b) in pillBtns.enumerated() {
                b.frame = CGRect(x: pillPadH + pill * CGFloat(i), y: pillPadV,
                                 width: pill, height: pill)
            }
        }
        shade(card, radius: cardRadius)
        shade(pills, radius: pills.layer.cornerRadius)
    }

    /**
     * 자리를 준다 — **`frame`이 아니라 `bounds`와 `center`로.**
     *
     * 나타나는 연출이 `transform`으로 도는데(`scale(0.94)`), 그 동안 무엇이
     * 다시 배치되면(키보드가 오르내리는 판이 그렇다) **`frame`은 그 셋에서
     * 거꾸로 셈한 값이라 창이 어긋난 자리로 튄다.** `bounds`·`center`는
     * `transform`과 서로 안 얽힌다.
     */
    private func place(_ v: UIView, _ r: CGRect) {
        v.bounds = CGRect(origin: .zero, size: r.size)
        v.center = CGPoint(x: r.midX, y: r.midY)
    }

    /// 웹의 `box-shadow: 0 6px 24px rgba(0,0,0,0.2)`와 같은 값.
    private func shade(_ v: UIView, radius: CGFloat) {
        v.layer.shadowColor = UIColor.black.cgColor
        v.layer.shadowOpacity = 0.2
        v.layer.shadowRadius = 12
        v.layer.shadowOffset = CGSize(width: 0, height: 6)
        v.layer.shadowPath = UIBezierPath(roundedRect: v.bounds, cornerRadius: radius).cgPath
    }
}

/**
 * 창의 한 줄. **글자는 왼쪽, 그림은 오른쪽이다**(카톡과 같다).
 *
 * **그림글자를 쓰지 말 것** — 기기에 없으면 네모난 두부가 나온다(투표 결과
 * 카드의 `🗳`에서 겪었다). 웹은 선 SVG를 그리고(`HoldIcons.tsx`) 여기서는
 * 폰에 늘 있는 SF Symbol로 같은 뜻을 그린다 — **이름은 웹이 정한 그대로다.**
 */
final class HoldRow: UIControl {
    let name: String
    private let title = UILabel()
    private let mark = UIImageView()
    private let rule = UIView()
    private let danger: Bool

    /// 웹의 `HoldIcon`과 같은 이름 → 폰에 있는 그림. 모르는 이름은 안 그린다.
    private static let symbols: [String: String] = [
        "copy": "doc.on.doc",
        "pick": "text.cursor",
        "reply": "arrowshape.turn.up.left",
        "share": "square.and.arrow.up",
        "hide": "eye.slash",
        "trash": "trash",
    ]

    init(item: HoldMenu.Item, line: Bool) {
        name = item.name
        danger = item.danger
        super.init(frame: .zero)
        title.text = item.label
        title.font = .systemFont(ofSize: 15, weight: .medium)
        mark.contentMode = .scaleAspectFit
        if let s = HoldRow.symbols[item.icon] {
            mark.image = UIImage(systemName: s)
        }
        rule.isHidden = !line
        for v in [title, mark, rule] as [UIView] {
            v.isUserInteractionEnabled = false
            addSubview(v)
        }
    }

    required init?(coder: NSCoder) { fatalError() }

    /* 그림은 글자색을 따라간다 — `삭제` 줄에서는 저절로 빨강이 되고,
       평소에는 한 톤 낮춰 글자가 먼저 읽히게 한다(웹과 같은 규칙이다). */
    func paint(skin s: ChatSkin) {
        title.textColor = danger ? s.danger : s.text
        mark.tintColor = danger ? s.danger : s.jumpDim
        rule.backgroundColor = s.jumpLine
        backgroundColor = .clear
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let pad: CGFloat = 16
        let ic: CGFloat = 20
        rule.frame = CGRect(x: 0, y: 0, width: bounds.width, height: 1)
        mark.frame = CGRect(x: bounds.width - pad - ic, y: (bounds.height - ic) / 2,
                            width: ic, height: ic)
        title.frame = CGRect(x: pad, y: 0,
                             width: max(0, bounds.width - pad * 2 - ic - 12),
                             height: bounds.height)
    }

    override var isHighlighted: Bool {
        didSet { backgroundColor = isHighlighted ? UIColor(white: 0, alpha: 0.06) : .clear }
    }
}

/// 반응 알약 하나. **칠은 안 깐다**(카톡도 그림글자만 있다).
final class HoldPill: UIControl {
    let emoji: String
    private let label = UILabel()

    init(emoji e: String) {
        emoji = e
        super.init(frame: .zero)
        label.text = e
        label.font = .systemFont(ofSize: 24)
        label.textAlignment = .center
        label.isUserInteractionEnabled = false
        addSubview(label)
        accessibilityLabel = "\(e) 반응"
    }

    required init?(coder: NSCoder) { fatalError() }

    func paint(skin _: ChatSkin) { backgroundColor = .clear }

    override func layoutSubviews() {
        super.layoutSubviews()
        label.frame = bounds
        layer.cornerRadius = bounds.height / 2
    }

    override var isHighlighted: Bool {
        didSet { backgroundColor = isHighlighted ? UIColor(white: 0, alpha: 0.06) : .clear }
    }
}

/**
 * **안내창(토스트)을 앱이 띄운다**(29판).
 *
 * ## 왜 앱이 맡는가
 *
 * 웹의 `.toast-stack`은 **화면 아래**에 붙는데, 앱에서는 거기가 곧
 * **네이티브 바와 앱 목록이 덮는 자리**다 — 웹의 `z-index`로는 앱 부품을
 * 못 덮으므로 `복사했습니다`가 한 줄도 안 보였다. 28판에서는 그 자리를
 * 피해 **머리말 자리로 올려** 두었는데, 사용자가 **`안내창이 위쪽이라
 * 눈에 잘 안띄어`**라고 짚었다 — 맞는 말이다. 대화방에서 눈이 가 있는
 * 곳은 방금 누른 말풍선과 입력칸 언저리이지 화면 맨 위가 아니다.
 *
 * **웹이 그릴 수 있는 자리 가운데 아래쪽은 없다.** 그래서 자리를 옮기는
 * 것이 아니라 **그리는 쪽을 옮겼다** — 공유·캡쳐를 28판에서 앱으로
 * 넘긴 것과 같은 까닭이다.
 *
 * ## 자리
 *
 * **네이티브 바 바로 위**다(`above`). 키보드가 올라와 있으면 바가 키보드
 * 위에 있으므로 토스트도 따라 올라간다 — `keyboardLayoutGuide`에 묶인
 * 바의 자리를 그대로 읽으면 되는 것이라 우리가 키보드를 셈할 일이 없다.
 * 바가 없으면 안전 영역 위에 띄운다(댓글 화면 등).
 *
 * ## 한 번에 하나만
 *
 * 웹은 여러 줄이 쌓이지만 여기서는 **새것이 옛것을 갈아 끼운다.**
 * 쌓으면 자리 셈이 늘어나는데, 잇따라 두 줄이 뜨는 자리가 애초에 없다
 * (`복사했습니다` 다음에 오는 것은 다음 손짓이다).
 *
 * 값은 웹의 `.toast`와 같게 맞춰 두었다 — 흰 알약 · 13px 굵은 글씨 ·
 * `ok`는 분홍, `error`는 빨강. **한쪽만 고치지 말 것**(`Toast.css`).
 */
final class ToastHUD: UIView {

    /// 지금 떠 있는 것. 새것이 오면 갈아 끼운다.
    private static weak var live: ToastHUD?

    /// 보이는 시간 — 웹의 `ToastProvider`와 같은 2.8초다.
    private static let hold = 2.8

    private let label = UILabel()
    private var timer: Timer?

    /// 띄운다. `above`가 네이티브 바(없으면 안전 영역 위에 뜬다).
    static func show(_ text: String, skin: Skin, in root: UIView, above bar: UIView?) {
        live?.close()
        let t = ToastHUD(text: text, skin: skin)
        live = t
        root.addSubview(t)

        let maxW = root.bounds.width - 32
        let size = t.label.sizeThatFits(CGSize(width: maxW - 32, height: .greatestFiniteMagnitude))
        let w = min(maxW, ceil(size.width) + 32)
        let h = ceil(size.height) + 22
        /* 바 윗변에서 12px 위. 바가 키보드에 묶여 있으므로(`pin`) 키보드가
           올라와 있으면 토스트도 저절로 따라 올라간다. */
        let bottom: CGFloat = bar.map { $0.frame.minY } ?? (root.bounds.height - root.safeAreaInsets.bottom)
        t.frame = CGRect(x: (root.bounds.width - w) / 2, y: bottom - 12 - h, width: w, height: h)
        t.layer.cornerRadius = h / 2

        /* 웹의 `toast-in`과 같은 값이다 — 8px 아래에서 0.18초에 뜬다. */
        t.alpha = 0
        t.transform = CGAffineTransform(translationX: 0, y: 8)
        UIView.animate(withDuration: 0.18, delay: 0, options: [.curveEaseOut]) {
            t.alpha = 1
            t.transform = .identity
        }
        t.timer = Timer.scheduledTimer(withTimeInterval: hold, repeats: false) { [weak t] _ in
            t?.close()
        }
    }

    /// 떠 있는 것을 걷는다(화면을 떠날 때 · 새것이 올 때).
    static func clear() { live?.close() }

    /**
     * 생김새 — **웹이 준다**(`composerSkin()`·`chatListSkin()`과 같은 결).
     * 앱은 한 바퀴가 30분인데 웹은 밀면 바로 올라가므로, 어긋난 것을
     * 고치는 길이 웹에 있어야 한다. 여기 값은 예비값일 뿐이다.
     */
    struct Skin {
        var bg = UIColor(hexString: "#e4e9da") ?? .secondarySystemBackground
        var fg = UIColor(hexString: "#1b1f19") ?? .label
        var line = UIColor(white: 0, alpha: 0.12)
        var size: CGFloat = 13
    }

    private init(text: String, skin: Skin) {
        super.init(frame: .zero)
        /* **뒤를 가로막지 않는다** — 웹의 `pointer-events: none`과 같다.
           읽기만 하는 것이라 그 밑의 말풍선이 그대로 눌려야 한다. */
        isUserInteractionEnabled = false
        backgroundColor = skin.bg
        layer.borderWidth = 1
        layer.borderColor = skin.line.cgColor
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.18
        layer.shadowRadius = 12
        layer.shadowOffset = CGSize(width: 0, height: 4)

        label.text = text
        label.numberOfLines = 0
        label.textAlignment = .center
        label.font = .systemFont(ofSize: skin.size, weight: .bold)
        label.textColor = skin.fg
        addSubview(label)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func layoutSubviews() {
        super.layoutSubviews()
        label.frame = bounds.insetBy(dx: 16, dy: 11)
    }

    private func close() {
        timer?.invalidate()
        timer = nil
        if ToastHUD.live === self { ToastHUD.live = nil }
        UIView.animate(withDuration: 0.2, animations: { self.alpha = 0 }) { _ in
            self.removeFromSuperview()
        }
    }
}
