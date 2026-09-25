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
    static func stamp(_ iso: String) -> String { stampFmt.string(from: NativeChatRows.date(iso)) }
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
