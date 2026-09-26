import Foundation
import UIKit

/*
 * **앱 화면들이 쓰는 자료와 조회.** `NativeChatService`(REST 한 번 부르기 ·
 * 401이면 토큰 갱신)에 화면마다 필요한 조회를 extension으로 얹는다.
 *
 * **규칙은 웹과 같아야 한다** — 이름표(`personLabel`) · 직책 이름(`ROLE_LABEL`) ·
 * 운영진 갈래(`is_admin`·`is_owner`·`is_super` — `lib/auth.tsx`). 여기와
 * `src/lib/types.ts`를 함께 볼 것.
 */

/// `profiles` 한 줄. 칸이 없는 저장소에서는 그 값이 `nil`이다.
struct AppProfile {
    let raw: ChatJSON
    var id: String { raw["id"] as? String ?? "" }
    var name: String { (raw["name"] as? String ?? "").trimmingCharacters(in: .whitespaces) }
    var avatar: String? { raw["avatar_url"] as? String }
    var role: String { raw["role"] as? String ?? "member" }
    var gender: String? { raw["gender"] as? String }
    var birthYear: Int? { raw["birth_year"] as? Int }
    var region: String? {
        let r = (raw["region"] as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
        return r.isEmpty ? nil : r
    }
    /**
     * `83/신성호/광산구` — 웹의 `personLabel`과 같은 규칙이다.
     * **모르는 조각은 그냥 뺀다** — 빈칸을 `//`로 남기면 고장 난 것처럼 보인다.
     */
    var label: String {
        var parts: [String] = []
        if let y = birthYear { parts.append(String(format: "%02d", y % 100)) }
        if !name.isEmpty { parts.append(name) }
        if let r = region { parts.append(r) }
        return parts.joined(separator: "/")
    }
    /// 얼굴 테두리 — 남녀는 **얼굴에만** 쓰는 색이다(`--male`·`--female`).
    var edge: UIColor? {
        switch gender {
        case "m": return AppSkin.male
        case "f": return AppSkin.female
        default: return nil
        }
    }
}

/// `profile_private` 한 줄 — 정책이 운영진에게만 전원을 돌려준다.
struct AppContact {
    let raw: ChatJSON
    var id: String { raw["id"] as? String ?? "" }
    var phone: String? { blank(raw["phone"] as? String) }
    var car: String? { blank(raw["car"] as? String) }
    var birthMd: String? { blank(raw["birth_md"] as? String) }
    var birthCal: String { raw["birth_cal"] as? String ?? "solar" }
    private func blank(_ s: String?) -> String? {
        let t = s?.trimmingCharacters(in: .whitespaces) ?? ""
        return t.isEmpty ? nil : t
    }
}

/// 직책 — `src/lib/types.ts`의 `ROLE_LABEL`·`ROLE_TAG`와 같은 값이다.
enum AppRole {
    static let label: [String: String] = [
        "pending": "대기", "member": "일반회원", "treasurer": "총무", "staff": "부운영자",
        "admin": "운영자", "superadmin": "앱관리자", "banned": "추방"
    ]
    /// 명단에서 이름 옆에 붙는 표 — 일반회원은 안 붙인다.
    static func tagColor(_ role: String) -> UIColor? {
        switch role {
        case "superadmin": return AppSkin.brandDeep
        case "admin": return AppSkin.brand
        case "staff": return AppSkin.info
        case "treasurer": return AppSkin.warn
        default: return nil
        }
    }
    /// 운영진(부운영자·운영자·앱관리자) — DB의 `is_admin()`과 같다. 총무는 아니다.
    static func isAdmin(_ r: String) -> Bool { r == "staff" || r == "admin" || r == "superadmin" }
    /// 운영자 이상 — 부운영자·총무를 임명한다.
    static func isOwner(_ r: String) -> Bool { r == "admin" || r == "superadmin" }
    /// 앱관리자 한 사람 — 운영자를 임명한다.
    static func isSuper(_ r: String) -> Bool { r == "superadmin" }
}

/// `posts` 한 줄(웹 `Post`).
struct AppPost {
    let raw: ChatJSON
    var id: String { raw["id"] as? String ?? "" }
    var title: String { raw["title"] as? String ?? "" }
    var body: String { raw["body"] as? String ?? "" }
    var pinned: Bool { raw["pinned"] as? Bool ?? false }
    var authorId: String? { raw["author_id"] as? String }
    var createdAt: String { raw["created_at"] as? String ?? "" }
}

/// 댓글 한 줄 — 세 표(`post_comments`·`poll_comments`·`round_comments`)가 같은 모양이다(웹 `AnyComment`).
struct AppComment {
    let raw: ChatJSON
    var id: String { raw["id"] as? String ?? "" }
    var authorId: String? { raw["author_id"] as? String }
    var body: String { raw["body"] as? String ?? "" }
    var createdAt: String { raw["created_at"] as? String ?? "" }
}

/// 알림함 한 줄(웹 `AppNotification`).
struct AppAlert {
    let raw: ChatJSON
    var id: String { raw["id"] as? String ?? "" }
    var kind: String { raw["kind"] as? String ?? "etc" }
    var title: String { raw["title"] as? String ?? "" }
    var body: String { raw["body"] as? String ?? "" }
    var url: String { raw["url"] as? String ?? "" }
    var createdAt: String { raw["created_at"] as? String ?? "" }
    var readAt: String? { raw["read_at"] as? String }

    /**
     * 제목을 **그림글자와 글자로 가른다** — `💰 정산` → (`💰`, `정산`).
     * 웹 `splitAlertTitle`과 같은 규칙: 알림 제목에는 이미 그림글자가 붙어 있어
     * 아이콘을 따로 그리면 같은 그림이 두 번 나온다. 그림글자가 없으면
     * 갈래로 고르고(`icons`), 그것도 모르면 `🔔`이다.
     */
    var split: (icon: String, text: String) {
        let t = title.trimmingCharacters(in: .whitespaces)
        if let re = try? NSRegularExpression(pattern: "^(\\p{Extended_Pictographic}\\uFE0F?)\\s*(.*)$", options: [.dotMatchesLineSeparators]),
           let m = re.firstMatch(in: t, range: NSRange(t.startIndex..., in: t)),
           let r1 = Range(m.range(at: 1), in: t), let r2 = Range(m.range(at: 2), in: t) {
            return (String(t[r1]), String(t[r2]))
        }
        return (Self.icons[kind] ?? "🔔", t)
    }
    /// 제목에 그림글자가 없을 때 쓸 갈래별 그림 — 웹 `ALERT_ICON`과 같은 값.
    static let icons: [String: String] = [
        "rounds": "⛳", "polls": "🗳", "posts": "📢", "profiles": "🙋", "signups": "🎉",
        "round_groups": "🚩", "round_reminders": "⏰", "settlement_shares": "💰", "settle_reminders": "💰"
    ]
}

/// `signups` 한 줄 — 라운드에 딸려 온다(웹 `SignupHome`·`Signup`).
struct AppSignup {
    let raw: ChatJSON
    var id: String { raw["id"] as? String ?? "" }
    var roundId: String { raw["round_id"] as? String ?? "" }
    var userId: String { raw["user_id"] as? String ?? "" }
    var state: String { raw["state"] as? String ?? "" }
    var seq: Int { raw["seq"] as? Int ?? 0 }
    var grp: Int? { raw["grp"] as? Int }
}

/// `rounds` 한 줄(웹 `Round`·`RoundLite`) + 딸려 온 신청.
struct AppRound {
    let raw: ChatJSON
    let signups: [AppSignup]
    init(raw: ChatJSON) {
        self.raw = raw
        signups = (raw["signups"] as? [ChatJSON] ?? []).map { AppSignup(raw: $0) }
    }
    var id: String { raw["id"] as? String ?? "" }
    var course: String { raw["course"] as? String ?? "" }
    var title: String { raw["title"] as? String ?? "" }
    var teeAt: String { raw["tee_at"] as? String ?? "" }
    var capacity: Int { raw["capacity"] as? Int ?? 0 }
    var fee: Int { raw["fee"] as? Int ?? 0 }
    var status: String { raw["status"] as? String ?? "open" }
    /// `field`/`screen` — 칸이 없는 저장소에서는 필드다(웹 `roundKind`).
    var kind: String { raw["kind"] as? String == "screen" ? "screen" : "field" }
    var caddie: String? { raw["caddie"] as? String }
    var cart: String? { raw["cart"] as? String }
    var note: String { raw["note"] as? String ?? "" }
    var createdBy: String? { raw["created_by"] as? String }
    var lat: Double? { raw["lat"] as? Double }
    var lon: Double? { raw["lon"] as? Double }
    var isScreen: Bool { kind == "screen" }
    var kindIcon: String { isScreen ? "🎯" : "⛳" }
    var kindLabel: String { isScreen ? "스크린" : "필드" }
    var teeLabel: String { isScreen ? "시작" : "티오프" }
    /// 장소 — 비어 있으면 제목, 그것도 없으면 `골프장 미정`/`매장 미정`.
    var place: String {
        if !course.isEmpty { return course }
        if !title.isEmpty { return title }
        return isScreen ? "매장 미정" : "골프장 미정"
    }
    var confirmed: [AppSignup] { signups.filter { $0.state == "confirmed" } }
    var waiting: [AppSignup] { signups.filter { $0.state == "waitlist" } }
    func mine(_ me: String) -> AppSignup? { signups.first { $0.userId == me } }
    /// 대기 번호는 **대기 줄에서 몇 번째인가**다(`seq` 그대로가 아니다 — 웹과 같은 규칙).
    func waitRank(_ me: String) -> Int {
        let list = waiting.sorted { $0.seq < $1.seq }
        guard let i = list.firstIndex(where: { $0.userId == me }) else { return 0 }
        return i + 1
    }
    static let caddieLabel = ["caddie": "캐디", "none": "노캐디"]
    static let cartLabel = ["included": "카트 포함", "excluded": "카트 미포함"]
    /// 상세의 표만 짧은 말이다(웹 `CADDIE_SHORT`·`CART_SHORT`) — 이름 칸이 따로 있어 `캐디: 캐디`가 된다.
    static let caddieShort = ["caddie": "있음", "none": "없음"]
    static let cartShort = ["included": "포함", "excluded": "미포함"]
    var feeLabel: String { isScreen ? "게임비" : "그린피" }
    /// 오늘(한국 날짜)보다 앞이면 지난 라운드다.
    var isPast: Bool { AppDate.daysUntil(teeAt) < 0 }
    /// 조별로 묶은 확정자 — **조가 하나도 없으면 빈 배열**이고 그때는 한 줄로 그린다(웹 `grouped`).
    /// 미배정(`nil`)은 늘 맨 뒤다.
    func grouped() -> [(no: Int?, list: [AppSignup])] {
        let list = confirmed.sorted { $0.seq < $1.seq }
        guard list.contains(where: { $0.grp != nil }) else { return [] }
        var order: [Int?] = []
        var bag: [Int?: [AppSignup]] = [:]
        for s in list {
            let k = s.grp
            if bag[k] == nil { bag[k] = []; order.append(k) }
            bag[k]!.append(s)
        }
        return order.sorted { a, b in
            guard let a = a else { return false }
            guard let b = b else { return true }
            return a < b
        }.map { (no: $0, list: bag[$0] ?? []) }
    }
}

/// `settlements` 한 줄(웹 `Settlement`).
struct AppSettlement {
    let raw: ChatJSON
    var id: String { raw["id"] as? String ?? "" }
    var title: String { raw["title"] as? String ?? "" }
    var body: String { raw["body"] as? String ?? "" }
    var bank: String { (raw["bank"] as? String ?? "").trimmingCharacters(in: .whitespaces) }
    var account: String { (raw["account"] as? String ?? "").trimmingCharacters(in: .whitespaces) }
    var total: Int { raw["total"] as? Int ?? 0 }
    var createdBy: String? { raw["created_by"] as? String }
    var createdAt: String { raw["created_at"] as? String ?? "" }
    /**
     * 토스 송금 화면 주소(웹 `tossUrl`) — 은행·계좌·내 몫이 채워진 채로 뜬다.
     * 끝의 `은행`을 떼고(`카카오뱅크`는 `뱅크`라 안 걸린다) 계좌의 `-`를 뺀다.
     * **토스가 없는 폰에서는 안 열리므로 복사 단추를 그대로 둔다.**
     */
    func tossURL(amount: Int?) -> URL? {
        var parts = URLComponents()
        parts.scheme = "supertoss"; parts.host = "send"
        var items = [URLQueryItem(name: "bank", value: bank.replacingOccurrences(of: "은행$", with: "", options: .regularExpression)),
                     URLQueryItem(name: "accountNo", value: account.filter { $0.isNumber })]
        if let a = amount, a > 0 { items.append(URLQueryItem(name: "amount", value: String(a))) }
        parts.queryItems = items
        return parts.url
    }
}

/// `settlement_shares` 한 줄(웹 `SettlementShare`) — 사람마다 낼 돈을 그대로 적는다.
struct AppShare {
    let raw: ChatJSON
    var id: String { raw["id"] as? String ?? "" }
    var settlementId: String { raw["settlement_id"] as? String ?? "" }
    var userId: String { raw["user_id"] as? String ?? "" }
    var amount: Int { raw["amount"] as? Int ?? 0 }
    var paid: Bool { raw["paid"] as? Bool ?? false }
}

struct AppPollOption {
    let raw: ChatJSON
    var id: String { raw["id"] as? String ?? "" }
    var label: String { raw["label"] as? String ?? "" }
    var sort: Int { raw["sort"] as? Int ?? 0 }
}
struct AppVote {
    let raw: ChatJSON
    var optionId: String { raw["option_id"] as? String ?? "" }
    var userId: String { raw["user_id"] as? String ?? "" }
}
/// `polls` 한 줄(웹 `Poll`) + 딸려 온 항목·표.
struct AppPoll {
    let raw: ChatJSON
    let options: [AppPollOption]
    let votes: [AppVote]
    init(raw: ChatJSON) {
        self.raw = raw
        options = (raw["poll_options"] as? [ChatJSON] ?? []).map { AppPollOption(raw: $0) }.sorted { $0.sort < $1.sort }
        votes = (raw["poll_votes"] as? [ChatJSON] ?? []).map { AppVote(raw: $0) }
    }
    var id: String { raw["id"] as? String ?? "" }
    var title: String { raw["title"] as? String ?? "" }
    var body: String { raw["body"] as? String ?? "" }
    var multi: Bool { raw["multi"] as? Bool ?? false }
    var anonymous: Bool { raw["anonymous"] as? Bool ?? false }
    var closedFlag: Bool { raw["closed"] as? Bool ?? false }
    var closesAt: String? { raw["closes_at"] as? String }
    var createdBy: String? { raw["created_by"] as? String }
    var createdAt: String { raw["created_at"] as? String ?? "" }
    /// 웹 `pollClosed()`와 같은 잣대 — 손으로 닫았거나 마감 시각이 지났거나.
    var closed: Bool {
        if closedFlag { return true }
        guard let c = closesAt else { return false }
        return NativeChatRows.date(c) < Date()
    }
    func count(_ optionId: String) -> Int { votes.filter { $0.optionId == optionId }.count }
    /// 1위 항목들 — **동점이면 다 적는다**(웹 `topOptions`·`post_poll_result`와 같은 규칙).
    func top() -> (names: [String], n: Int)? {
        guard !options.isEmpty else { return nil }
        let best = options.map { count($0.id) }.max() ?? 0
        guard best > 0 else { return nil }
        return (options.filter { count($0.id) == best }.map { $0.label }, best)
    }
}

/// 라운드 날 날씨(웹 `lib/weather.ts`의 `Weather`).
struct AppWeather {
    let min: Int, max: Int, rain: Int, icon: String, label: String
    /// WMO 코드 → 한 마디. 웹 `describe`와 같은 묶음이다.
    static func describe(_ code: Int) -> (String, String) {
        if code == 0 { return ("☀️", "맑음") }
        if code <= 2 { return ("🌤️", "구름 조금") }
        if code == 3 { return ("☁️", "흐림") }
        if code <= 48 { return ("🌫️", "안개") }
        if code <= 57 { return ("🌦️", "이슬비") }
        if code <= 67 { return ("🌧️", "비") }
        if code <= 77 { return ("🌨️", "눈") }
        if code <= 82 { return ("🌧️", "소나기") }
        if code <= 86 { return ("🌨️", "눈") }
        return ("⛈️", "천둥번개")
    }
}

enum AppDate {
    static let seoul = TimeZone(identifier: "Asia/Seoul") ?? .current
    private static func fmt(_ pattern: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ko_KR")
        f.timeZone = seoul
        f.dateFormat = pattern
        return f
    }
    /// `8/21 오후 3:04` — 목록의 작은 시각(웹 `formatStamp`).
    static let stampFmt = fmt("M/d a h:mm")
    /// `8월 21일 (금)`(웹 `formatDate`).
    static let dayFmt = fmt("M월 d일 (E)")
    /// `2026년 8월 21일 (금)`(웹 `formatFullDate`).
    static let fullFmt = fmt("yyyy년 M월 d일 (E)")
    static func fullDate(_ iso: String) -> String { fullFmt.string(from: NativeChatRows.date(iso)) }
    static func day(_ iso: String) -> String { dayFmt.string(from: NativeChatRows.date(iso)) }
    static func stamp(_ iso: String) -> String { stampFmt.string(from: NativeChatRows.date(iso)) }
    /// `오전 7:30`(웹 `formatTime`).
    static let timeFmt = fmt("a h:mm")
    /// `8월 21일 (금) 오전 7:30`(웹 `formatDateTime`).
    static func dateTime(_ iso: String) -> String {
        let d = NativeChatRows.date(iso)
        return dayFmt.string(from: d) + " " + timeFmt.string(from: d)
    }
    static func time(_ iso: String) -> String { timeFmt.string(from: NativeChatRows.date(iso)) }
    /// `YYYY-MM-DD`(한국 날짜).
    static let ymdFmt: DateFormatter = {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = seoul; f.dateFormat = "yyyy-MM-dd"; return f
    }()
    static func kstDay(_ d: Date) -> String { ymdFmt.string(from: d) }
    /// 오늘(한국 날짜)부터 며칠 뒤인가 — **날짜끼리** 뺀다(웹 `daysUntil`: 밀리초로 나누면 시간대에 따라 하루가 어긋난다).
    static func daysUntil(_ iso: String) -> Int {
        var cal = Calendar(identifier: .gregorian); cal.timeZone = seoul
        let a = cal.startOfDay(for: NativeChatRows.date(iso))
        let b = cal.startOfDay(for: Date())
        return cal.dateComponents([.day], from: b, to: a).day ?? 0
    }
    /// `D-3` · `D-DAY` · `종료`(웹 `ddayLabel`).
    static func dday(_ iso: String) -> String {
        let d = daysUntil(iso)
        if d > 0 { return "D-\(d)" }
        if d == 0 { return "D-DAY" }
        return "종료"
    }
    /// 하루 여유를 둔 잘라 내기(웹 `upcomingSince`) — 오늘 라운드가 사라지지 않게.
    static func upcomingSince() -> String { NativeChatRows.iso.string(from: Date(timeIntervalSinceNow: -86400)) }
    static func nowIso() -> String { NativeChatRows.now() }
    /// `120,000원`(웹 `formatWon`).
    static let wonFmt: NumberFormatter = { let f = NumberFormatter(); f.numberStyle = .decimal; f.locale = Locale(identifier: "ko_KR"); return f }()
    static func won(_ n: Int) -> String { (wonFmt.string(from: NSNumber(value: n)) ?? String(n)) + "원" }
    /// `방금` · `12분 전` · `3시간 전` · `2일 전` · 그보다 오래면 날짜(웹 `timeAgo`).
    static func ago(_ iso: String) -> String {
        let d = NativeChatRows.date(iso)
        let secs = Date().timeIntervalSince(d)
        if secs < 60 { return "방금" }
        if secs < 3600 { return "\(Int(secs / 60))분 전" }
        if secs < 86400 { return "\(Int(secs / 3600))시간 전" }
        if secs < 86400 * 7 { return "\(Int(secs / 86400))일 전" }
        return dayFmt.string(from: d)
    }
    /// 올해 1월 1일(한국 시각) — `attendance_counts`의 `p_since`.
    static func yearStart() -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = seoul
        let y = cal.component(.year, from: Date())
        return "\(y)-01-01T00:00:00+09:00"
    }
    /// `MM-DD` → `5월 10일`. 못 읽으면 빈 글자다(웹 `mdLabel`).
    static func mdLabel(_ md: String?) -> String {
        guard let md = md, md.count == 5 else { return "" }
        let p = md.split(separator: "-")
        guard p.count == 2, let m = Int(p[0]), let d = Int(p[1]) else { return "" }
        return "\(m)월 \(d)일"
    }
    /// `양력 1975년 5월 10일` — 웹 `birthLabel`과 같다. 조각이 빠졌으면 있는 것만.
    static func birthLabel(year: Int?, md: String?, cal: String) -> String {
        let day = mdLabel(md)
        if day.isEmpty && year == nil { return "" }
        var parts: [String] = []
        if !day.isEmpty { parts.append(cal == "lunar" ? "음력" : "양력") }
        if let y = year { parts.append("\(y)년") }
        if !day.isEmpty { parts.append(day) }
        return parts.joined(separator: " ")
    }
}

extension NativeChatService {
    /// 명단 전체를 모든 칸까지 — 회원 명단 화면만 쓴다(웹 `fetchProfiles`).
    func profiles() async throws -> [AppProfile] {
        try await rows("profiles", [("select", "*"), ("order", "name"), ("limit", "1000")])
            .map { AppProfile(raw: $0) }
    }
    /// 전화번호·차량번호·생일 — 정책이 알아서 좁혀 준다(운영진이면 전원, 아니면 본인).
    /// 표가 없는 저장소에서는 빈 것으로 물러난다(웹 `fetchContacts`).
    func contacts() async -> [String: AppContact] {
        guard let raw = try? await rows("profile_private", [("select", "*"), ("limit", "1000")]) else { return [:] }
        var out: [String: AppContact] = [:]
        for r in raw { let c = AppContact(raw: r); if !c.id.isEmpty { out[c.id] = c } }
        return out
    }
    /**
     * 올해 참석 횟수 — **운영진만**. DB 함수가 그 밖의 사람을 막으므로(42501)
     * 못 받으면 `nil`이다 — **빈 표로 넘기지 말 것**: 모두가 `올해 0회`가
     * 되어 거짓말이 된다(웹 `Members.tsx`와 같은 규칙).
     */
    func attendance() async -> [String: Int]? {
        guard let raw = try? await request("rest/v1/rpc/attendance_counts", method: "POST",
                                           body: ["p_since": AppDate.yearStart()]) as? [ChatJSON]
        else { return nil }
        var out: [String: Int] = [:]
        for r in raw {
            if let u = r["user_id"] as? String, let n = r["n"] as? Int { out[u] = n }
        }
        return out
    }
    /// 직책을 바꾼다 — 승인(`member`)·임명·추방(`banned`)·내보내기(`pending`)가 다 이 길이다.
    /// DB 정책이 한 계단씩만 허락하므로 막히면 빈 답이 온다.
    func setRole(_ id: String, _ role: String) async throws {
        let result = try await request("rest/v1/profiles", query: [("id", "eq.\(id)")],
                                       method: "PATCH", body: ["role": role]) as? [ChatJSON]
        guard result?.isEmpty == false else { throw NativeChatError(message: "권한이 없거나 이미 바뀐 회원입니다.") }
    }
    /// 가입 거절 — 행을 지운다(다시 로그인하면 가입 신청부터 다시 한다).
    func deleteProfile(_ id: String) async throws {
        let result = try await request("rest/v1/profiles", query: [("id", "eq.\(id)")],
                                       method: "DELETE") as? [ChatJSON]
        guard result?.isEmpty == false else { throw NativeChatError(message: "권한이 없거나 이미 지워진 회원입니다.") }
    }

    // ── 명단(좁은 칸) ──────────────────────────────────────────

    /// 이름표·얼굴에 쓰는 좁은 명단을 id로 — 웹 `fetchPeople` + `byId`.
    func peopleById() async throws -> [String: AppProfile] {
        var out: [String: AppProfile] = [:]
        for raw in try await people() { let p = AppProfile(raw: raw); if !p.id.isEmpty { out[p.id] = p } }
        return out
    }

    // ── 공지 ─────────────────────────────────────────────────────

    func post(_ id: String) async throws -> AppPost? {
        try await rows("posts", [("select", "*"), ("id", "eq.\(id)"), ("limit", "1")]).first.map { AppPost(raw: $0) }
    }
    func postComments(_ id: String) async throws -> [AppComment] {
        try await rows("post_comments", [("select", "*"), ("post_id", "eq.\(id)"),
                                         ("order", "created_at.asc"), ("limit", "500")]).map { AppComment(raw: $0) }
    }
    /// 댓글 하나 — 표 이름과 부모 칸이 짝이다(웹 `Comments`의 `target`).
    func addComment(table: String, parentKey: String, parentId: String, body: String) async throws {
        _ = try await request("rest/v1/\(table)", method: "POST",
                              body: [parentKey: parentId, "author_id": config.user, "body": body])
    }
    /// 한 줄 지우기 — 정책에 막히면 빈 답이 오므로 그때는 권한 없음으로 알린다.
    func deleteRow(_ table: String, id: String) async throws {
        let result = try await request("rest/v1/\(table)", query: [("id", "eq.\(id)")], method: "DELETE") as? [ChatJSON]
        guard result?.isEmpty == false else { throw NativeChatError(message: "권한이 없거나 이미 지워졌습니다.") }
    }
    func setPinned(_ id: String, _ pinned: Bool) async throws {
        let result = try await request("rest/v1/posts", query: [("id", "eq.\(id)")],
                                       method: "PATCH", body: ["pinned": pinned]) as? [ChatJSON]
        guard result?.isEmpty == false else { throw NativeChatError(message: "권한이 없습니다.") }
    }

    /**
     * 전체 대화방에 `system` 글 한 줄 — `📣 대화방에 공유`(웹 `PostDetail`·
     * `RoundDetail`의 `share`와 같은 짜임이다. **한쪽만 고치지 말 것.**)
     *
     * **없는 칸을 하나씩 빼면서 다시 넣는다.** 앱은 새로 깔면 바로인데
     * `schema.sql`은 그보다 늦을 수 있어 그 사이에는 `post_id`·`notify`가
     * 없는 DB에 새 앱이 붙는다. **오류 코드가 둘이다** — Postgres는 `42703`,
     * PostgREST는 칸 목록을 제가 들고 있어 `PGRST204`로 물린다.
     * `drops`는 뺄 차례다 — 덜 아쉬운 것부터(알림 먼저, 눌리는 카드는 마지막).
     */
    func shareToChat(body: String, extra: ChatJSON, drops: [String]) async throws {
        guard let roomId = try await room()["id"] as? String else {
            throw NativeChatError(message: "전체 대화방이 없습니다.")
        }
        for i in 0...drops.count {
            var row: ChatJSON = ["room_id": roomId, "user_id": config.user, "body": body, "system": true]
            for (k, v) in extra { row[k] = v }
            for k in drops.prefix(i) { row.removeValue(forKey: k) }
            do {
                _ = try await request("rest/v1/messages", method: "POST", body: row)
                return
            } catch let e as NativeChatError where e.code == "42703" || e.code == "PGRST204" {
                continue
            }
        }
        throw NativeChatError(message: "대화방에 올리지 못했습니다.")
    }

    // ── 라운드 ───────────────────────────────────────────────────

    static let roundCols = "*, signups(round_id, user_id, state, seq, grp)"
    /// 예정된 라운드 전부(취소 포함 — 목록이 가른다) — 신청이 딸려 온다(웹 `Rounds`·`Home`).
    func roundsUpcoming() async throws -> [AppRound] {
        try await rows("rounds", [("select", Self.roundCols), ("tee_at", "gte.\(AppDate.upcomingSince())"),
                                  ("order", "tee_at.asc"), ("limit", "200")]).map { AppRound(raw: $0) }
    }
    /// 지난 라운드는 최근 것만(웹 `PAST_ROUNDS`).
    func roundsPast(limit: Int) async throws -> [AppRound] {
        try await rows("rounds", [("select", Self.roundCols), ("tee_at", "lt.\(AppDate.upcomingSince())"),
                                  ("order", "tee_at.desc"), ("limit", String(limit))]).map { AppRound(raw: $0) }
    }
    /// 조별 시각 — 표가 없는 저장소에서는 빈 것으로(웹 홈의 `home:groups`).
    func groupTees(_ roundId: String) async -> [String: String] {
        guard let row = try? await rows("round_groups", [("select", "round_id,tees"), ("round_id", "eq.\(roundId)"), ("limit", "1")]).first,
              let tees = row["tees"] as? [String: Any] else { return [:] }
        var out: [String: String] = [:]
        for (k, v) in tees { if let t = v as? String { out[k] = t } }
        return out
    }
    /// 신청 — 정원 셈은 DB(`join_round`)가 한다. 돌려주는 것은 들어간 자리(`confirmed`/`waitlist`).
    func joinRound(_ id: String) async throws -> String? {
        let r = try await request("rest/v1/rpc/join_round", method: "POST", body: ["p_round": id, "p_note": ""])
        return (r as? ChatJSON)?["state"] as? String
    }
    func leaveRound(_ id: String) async throws {
        _ = try await request("rest/v1/rpc/leave_round", method: "POST", body: ["p_round": id])
    }
    /// 운영진이 남을 뺀다 — 확정자였으면 대기 맨 앞이 올라간다(DB `kick_signup`).
    func kickSignup(_ round: String, user: String) async throws {
        _ = try await request("rest/v1/rpc/kick_signup", method: "POST", body: ["p_round": round, "p_user": user])
    }

    // ── 라운드 상세 ──────────────────────────────────────────────

    /// 라운드 하나 + 신청 전부(웹 `RoundDetail`은 따로 부르지만 딸려 받아도 같은 값이다).
    func round(_ id: String) async throws -> AppRound? {
        try await rows("rounds", [("select", "*, signups(*)"), ("id", "eq.\(id)"), ("limit", "1")]).first.map { AppRound(raw: $0) }
    }
    func roundComments(_ id: String) async throws -> [AppComment] {
        try await rows("round_comments", [("select", "*"), ("round_id", "eq.\(id)"),
                                          ("order", "created_at.asc"), ("limit", "500")]).map { AppComment(raw: $0) }
    }
    /// 모집 마감·다시 열기·취소·되돌리기 — 정책에 막히면 빈 답이 온다.
    func setRoundStatus(_ id: String, _ status: String) async throws {
        let r = try await request("rest/v1/rounds", query: [("id", "eq.\(id)")], method: "PATCH", body: ["status": status]) as? [ChatJSON]
        guard r?.isEmpty == false else { throw NativeChatError(message: "권한이 없습니다.") }
    }
    /// 정산은 최근 것부터 — 표가 없는 저장소에서는 빈 것으로 물러난다.
    func settlements(_ roundId: String) async -> [AppSettlement] {
        guard let raw = try? await rows("settlements", [("select", "*"), ("round_id", "eq.\(roundId)"),
                                                        ("order", "created_at.desc"), ("limit", "50")]) else { return [] }
        return raw.map { AppSettlement(raw: $0) }
    }
    /// 몫은 정산을 받아 온 **뒤에** 그 id들로 부른다 — 몫 표에는 라운드가 안 적혀 있다(웹과 같다).
    func settlementShares(_ ids: [String]) async -> [AppShare] {
        guard !ids.isEmpty,
              let raw = try? await rows("settlement_shares", [("select", "*"), ("settlement_id", "in.(\(ids.joined(separator: ",")))"),
                                                              ("order", "created_at.asc"), ("limit", "1000")]) else { return [] }
        return raw.map { AppShare(raw: $0) }
    }
    /// `입금완료` — 본인 몫의 `paid`만 뒤집을 수 있다(DB `shares_own_paid`).
    func setSharePaid(_ id: String, _ paid: Bool) async throws {
        let r = try await request("rest/v1/settlement_shares", query: [("id", "eq.\(id)")], method: "PATCH", body: ["paid": paid]) as? [ChatJSON]
        guard r?.isEmpty == false else { throw NativeChatError(message: "권한이 없습니다.") }
    }

    // ── 투표 ─────────────────────────────────────────────────────

    static let pollCols = "*, poll_options(id, label, sort), poll_votes(option_id, user_id)"
    /// 진행중 둘(시각이 남았거나 · 마감 시각이 없거나) — 웹 `Polls`와 같이 넷으로 나눠 부른다.
    func pollsLive() async throws -> [AppPoll] {
        let now = AppDate.nowIso()
        let a = try await rows("polls", [("select", Self.pollCols), ("closed", "eq.false"), ("closes_at", "gte.\(now)"), ("order", "created_at.desc"), ("limit", "100")])
        let b = try await rows("polls", [("select", Self.pollCols), ("closed", "eq.false"), ("closes_at", "is.null"), ("order", "created_at.desc"), ("limit", "100")])
        return (a + b).map { AppPoll(raw: $0) }.sorted { $0.createdAt > $1.createdAt }
    }
    /// 끝난 둘(손으로 닫았거나 · 시각이 지났거나) — `limit`까지만.
    func pollsDone(limit: Int) async throws -> (list: [AppPoll], got: Int) {
        let now = AppDate.nowIso()
        let a = try await rows("polls", [("select", Self.pollCols), ("closed", "eq.true"), ("order", "created_at.desc"), ("limit", String(limit))])
        let b = try await rows("polls", [("select", Self.pollCols), ("closed", "eq.false"), ("closes_at", "lt.\(now)"), ("order", "created_at.desc"), ("limit", String(limit))])
        let all = (a + b).map { AppPoll(raw: $0) }.sorted { $0.createdAt > $1.createdAt }
        return (Array(all.prefix(limit)), all.count)
    }
    func castVote(_ optionId: String) async throws {
        _ = try await request("rest/v1/rpc/cast_vote", method: "POST", body: ["p_option": optionId])
    }
    func retractVote(_ optionId: String) async throws {
        _ = try await request("rest/v1/rpc/retract_vote", method: "POST", body: ["p_option": optionId])
    }
    func closePoll(_ id: String) async throws {
        let r = try await request("rest/v1/polls", query: [("id", "eq.\(id)")], method: "PATCH", body: ["closed": true]) as? [ChatJSON]
        guard r?.isEmpty == false else { throw NativeChatError(message: "권한이 없습니다.") }
    }

    // ── 공지 목록 ────────────────────────────────────────────────

    func posts() async throws -> [AppPost] {
        try await rows("posts", [("select", "*"), ("order", "pinned.desc,created_at.desc"), ("limit", "200")]).map { AppPost(raw: $0) }
    }

    // ── 숫자들(탭바·홈) ───────────────────────────────────────────

    /// 승인 기다리는 사람 — 운영진만 부른다. 못 세면 0.
    func pendingCount() async -> Int {
        (try? await rows("profiles", [("select", "id"), ("role", "eq.pending"), ("limit", "200")]))?.count ?? 0
    }
    /// 안 읽은 알림(종의 숫자). 표가 없으면 0.
    func unreadAlertCount() async -> Int {
        (try? await rows("notifications", [("select", "id"), ("read_at", "is.null"), ("limit", "100")]))?.count ?? 0
    }
    /// 안 읽은 대화 — **서버의 `room_reads`를 잣대로 센다**(웹은 기기의 `teetime:seen:`을 보지만
    /// 앱 껍데기는 그 값을 볼 수 없다. 뱃지가 서버 쪽을 쓰는 것과 같은 잣대다). 100까지만.
    func unreadChatCount() async -> Int {
        guard let room = try? await room(), let roomId = room["id"] as? String else { return 0 }
        let reads = (try? await self.reads(roomId)) ?? [:]
        let since = reads[config.user] ?? "1970-01-01T00:00:00Z"
        let raw = try? await rows("messages", [("select", "id"), ("room_id", "eq.\(roomId)"),
            ("created_at", "gt.\(since)"), ("user_id", "neq.\(config.user)"), ("limit", "100")])
        return raw?.count ?? 0
    }
    /// 그 시각 뒤에 올라온 공지 수(탭의 빨간 숫자).
    func newPostCount(since: String) async -> Int {
        (try? await rows("posts", [("select", "id"), ("created_at", "gt.\(since)"), ("limit", "100")]))?.count ?? 0
    }
    /// 내가 표를 던진 투표 id들.
    func myVotedPolls() async -> Set<String> {
        let raw = (try? await rows("poll_votes", [("select", "poll_id"), ("user_id", "eq.\(config.user)"), ("limit", "1000")])) ?? []
        return Set(raw.compactMap { $0["poll_id"] as? String })
    }

    // ── 날씨(Open-Meteo · 웹 `fetchWeather`) ─────────────────────

    /// 좌표가 있는 라운드만 — 이름으로 찾는 예비 길(`courses.ts`)은 앱에 없다.
    /// **200이 아닌 답은 없는 것으로 본다**(한도 429 때 `daily`가 없어 조용히 깨진다).
    func weather(lat: Double, lon: Double, teeAt: String) async -> AppWeather? {
        let day = AppDate.kstDay(NativeChatRows.date(teeAt))
        var parts = URLComponents(string: "https://api.open-meteo.com/v1/forecast")!
        parts.queryItems = [
            URLQueryItem(name: "latitude", value: String(lat)), URLQueryItem(name: "longitude", value: String(lon)),
            URLQueryItem(name: "daily", value: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"),
            URLQueryItem(name: "timezone", value: "Asia/Seoul"),
            URLQueryItem(name: "start_date", value: day), URLQueryItem(name: "end_date", value: day)
        ]
        guard let url = parts.url, let got = try? await session.data(from: url),
              (got.1 as? HTTPURLResponse)?.statusCode == 200,
              let json = (try? JSONSerialization.jsonObject(with: got.0)) as? ChatJSON,
              let daily = json["daily"] as? ChatJSON,
              let maxes = daily["temperature_2m_max"] as? [Any], let mx = maxes.first as? Double,
              let mins = daily["temperature_2m_min"] as? [Any], let mn = mins.first as? Double
        else { return nil }
        let code = (daily["weather_code"] as? [Any])?.first as? Int ?? 0
        let rain = (daily["precipitation_probability_max"] as? [Any])?.first as? Double ?? 0
        let (icon, label) = AppWeather.describe(code)
        return AppWeather(min: Int(mn.rounded()), max: Int(mx.rounded()), rain: Int(rain.rounded()), icon: icon, label: label)
    }

    // ── 알림함 ───────────────────────────────────────────────────

    /// 최근 50건 — 표가 없는 저장소에서는 빈 목록으로 물러난다(웹 `fetchAlerts`).
    func alerts() async -> [AppAlert] {
        guard let raw = try? await rows("notifications", [("select", "*"), ("order", "created_at.desc"), ("limit", "50")])
        else { return [] }
        return raw.map { AppAlert(raw: $0) }
    }
    /// 안 읽은 것을 다 읽음으로 — **방금 찍은 id를 돌려준다**(웹 `markAlertsRead`).
    /// 안 읽은 것이 없으면 빈 답이 올 뿐 헛 쓰기는 아니다(PostgREST가 0줄을 고친다).
    func markAlertsRead() async -> [String] {
        guard let result = try? await request("rest/v1/notifications", query: [("read_at", "is.null")],
                                              method: "PATCH", body: ["read_at": NativeChatRows.now()]) as? [ChatJSON]
        else { return [] }
        return result.compactMap { $0["id"] as? String }
    }
    /// 90일 지난 내 알림을 걷는다 — 실패해도 그냥 넘어간다(웹 `purgeOldAlerts`).
    func purgeAlerts() async {
        _ = try? await request("rest/v1/rpc/purge_my_notifications", method: "POST", body: [String: Any]())
    }
}
