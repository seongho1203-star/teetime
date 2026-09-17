import Foundation
import UIKit

typealias ChatJSON = [String: Any]

struct NativeChatMessage {
    var raw: ChatJSON
    var id: String { raw["id"] as? String ?? "" }
    var body: String { raw["body"] as? String ?? "" }
    var user: String { raw["user_id"] as? String ?? "" }
    var at: String { raw["created_at"] as? String ?? "" }
    var image: String? { raw["image_url"] as? String }
    var reply: String? { raw["reply_to"] as? String }
    var hidden: Bool { raw["hidden_at"] is String }
    var system: Bool { raw["system"] as? Bool ?? false }
    var preview: String {
        if hidden { return "가려진 메시지입니다" }
        if !body.isEmpty { return body }
        return image?.hasPrefix("sticker:") == true ? "이모티콘" : image != nil ? "사진" : "메시지"
    }
}

struct NativeChatConfig {
    let user: String
    let url: URL
    let key: String
    var token: String
    let seen: String
    let stickers: [ChatJSON]
    init?(_ d: ChatJSON) {
        guard let user = d["user"] as? String, !user.isEmpty,
              let base = d["url"] as? String, let url = URL(string: base), url.scheme == "https",
              let key = d["key"] as? String, !key.isEmpty,
              let token = d["token"] as? String, !token.isEmpty else { return nil }
        self.user = user; self.url = url; self.key = key; self.token = token
        seen = d["seen"] as? String ?? "1970-01-01T00:00:00Z"
        stickers = d["stickers"] as? [ChatJSON] ?? []
    }
}

struct NativeChatError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// Authentication is supplied by the existing app account. All chat I/O is native;
/// requests use the member JWT and the existing RLS policies, never a service key.
@MainActor
final class NativeChatService {
    var config: NativeChatConfig
    var authNeeded: (() -> Void)?
    let session: URLSession
    let liveUpdates: Bool
    init(_ config: NativeChatConfig, session: URLSession = .shared, liveUpdates: Bool = true) {
        self.config = config; self.session = session; self.liveUpdates = liveUpdates
    }

    func request(_ path: String, query: [(String, String)] = [], method: String = "GET",
                 body: Any? = nil, bytes: Data? = nil) async throws -> Any {
        var parts = URLComponents(url: config.url.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        parts.queryItems = query.map { URLQueryItem(name: $0.0, value: $0.1) }
        guard let url = parts.url else { throw NativeChatError(message: "요청 주소를 만들 수 없습니다.") }
        for attempt in 0...1 {
            let token = config.token
            var req = URLRequest(url: url)
            req.httpMethod = method
            req.timeoutInterval = 25
            req.setValue(config.key, forHTTPHeaderField: "apikey")
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            req.setValue(bytes == nil ? "application/json" : "image/jpeg", forHTTPHeaderField: "Content-Type")
            req.setValue("return=representation", forHTTPHeaderField: "Prefer")
            if let bytes = bytes {
                req.httpBody = bytes
                req.setValue("31536000", forHTTPHeaderField: "cache-control")
            } else if let body = body { req.httpBody = try JSONSerialization.data(withJSONObject: body) }
            let (data, response) = try await session.data(for: req)
            try Task.checkCancellation()
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if status == 401 && attempt == 0 {
                authNeeded?()
                for _ in 0..<10 {
                    try await Task.sleep(nanoseconds: 300_000_000)
                    if config.token != token { break }
                }
                continue
            }
            guard (200..<300).contains(status) else {
                if status == 401 { throw NativeChatError(message: "로그인이 만료됐습니다. 다시 로그인해 주세요.") }
                if status == 403 { throw NativeChatError(message: "이 작업을 할 권한이 없습니다.") }
                throw NativeChatError(message: "서버에 연결하지 못했습니다(\(status)). 다시 시도해 주세요.")
            }
            return data.isEmpty ? [] : try JSONSerialization.jsonObject(with: data)
        }
        throw NativeChatError(message: "로그인 확인이 필요합니다.")
    }

    func rows(_ table: String, _ query: [(String, String)] = []) async throws -> [ChatJSON] {
        try await request("rest/v1/\(table)", query: query) as? [ChatJSON] ?? []
    }
    func room() async throws -> ChatJSON {
        guard let room = try await rows("rooms", [("select", "*"), ("round_id", "is.null"),
            ("order", "created_at.asc"), ("limit", "1")]).first else {
            throw NativeChatError(message: "대화방을 찾지 못했습니다.")
        }
        return room
    }
    func people() async throws -> [ChatJSON] {
        do { return try await rows("profiles", [("select", "id,name,avatar_url,role,gender,birth_year,region"), ("order", "name"), ("limit", "1000")]) }
        catch { return try await rows("profiles", [("select", "id,name,avatar_url,role"), ("order", "name"), ("limit", "1000")]) }
    }
    func messages(_ room: String, filters: [(String, String)] = [], ascending: Bool = false,
                  limit: Int = 50) async throws -> [NativeChatMessage] {
        let order = ascending ? "created_at.asc,id.asc" : "created_at.desc,id.desc"
        let raw = try await rows("messages", [("select", "*"), ("room_id", "eq.\(room)"),
            ("order", order), ("limit", String(limit))] + filters)
        return raw.map { NativeChatMessage(raw: $0) }
    }
    func reads(_ room: String) async throws -> [String: String] {
        let raw = try await rows("room_reads", [("select", "user_id,last_read_at"), ("room_id", "eq.\(room)"), ("limit", "1000")])
        return Dictionary(raw.compactMap { d in
            guard let id = d["user_id"] as? String, let at = d["last_read_at"] as? String else { return nil }
            return (id, at)
        }, uniquingKeysWith: { _, new in new })
    }
    func reactions(_ ids: [String]) async throws -> [ChatJSON] {
        var out: [ChatJSON] = []
        for offset in stride(from: 0, to: ids.count, by: 50) {
            let chunk = ids[offset..<min(ids.count, offset + 50)].joined(separator: ",")
            out += try await rows("message_reactions", [("select", "message_id,user_id,emoji,created_at"),
                ("message_id", "in.(\(chunk))"), ("order", "created_at.asc"), ("limit", "1000")])
        }
        return out
    }
    func send(_ row: ChatJSON) async throws -> NativeChatMessage {
        // A stable client UUID makes retry after an ambiguous network failure idempotent.
        do {
            let result = try await request("rest/v1/messages", method: "POST", body: row) as? [ChatJSON]
            guard let first = result?.first else { throw NativeChatError(message: "메시지를 저장하지 못했습니다.") }
            return NativeChatMessage(raw: first)
        } catch {
            if let id = row["id"] as? String,
               let existing = try? await rows("messages", [("select", "*"), ("id", "eq.\(id)"), ("limit", "1")]),
               let first = existing.first { return NativeChatMessage(raw: first) }
            throw error
        }
    }
    func change(_ message: NativeChatMessage, patch: ChatJSON?) async throws {
        let result = try await request("rest/v1/messages", query: [("id", "eq.\(message.id)")],
            method: patch == nil ? "DELETE" : "PATCH", body: patch) as? [ChatJSON]
        guard result?.isEmpty == false else { throw NativeChatError(message: "권한이 없거나 이미 삭제된 메시지입니다.") }
    }
    func react(_ id: String, emoji: String, remove: Bool) async throws {
        _ = try await request("rest/v1/message_reactions",
            query: remove ? [("message_id", "eq.\(id)"), ("user_id", "eq.\(config.user)"), ("emoji", "eq.\(emoji)")] : [],
            method: remove ? "DELETE" : "POST",
            body: remove ? nil : ["message_id": id, "user_id": config.user, "emoji": emoji])
    }
    func markRead(_ room: String) async throws {
        _ = try await request("rest/v1/rpc/mark_room_read", method: "POST", body: ["p_room": room])
    }
    func upload(_ data: Data, room: String) async throws -> String {
        let path = "\(room)/\(UUID().uuidString.lowercased()).jpg"
        _ = try await request("storage/v1/object/chat-photos/\(path)", method: "POST", bytes: data)
        return config.url.appendingPathComponent("storage/v1/object/public/chat-photos/\(path)").absoluteString
    }
}

/// Phoenix protocol v1: authenticated DB changes, reconnect and a 20s heartbeat.
/// https://supabase.com/docs/guides/realtime/protocol
@MainActor
final class NativeChatRealtime {
    private let service: NativeChatService
    private let room: String
    private var socket: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?
    private var heartbeat: Task<Void, Never>?
    private var retry: Task<Void, Never>?
    private var active = false
    private var ref = 0
    private var heartbeatPending = false
    var changed: ((ChatJSON) -> Void)?
    var connected: (() -> Void)?
    var status: ((Bool) -> Void)?
    init(service: NativeChatService, room: String) { self.service = service; self.room = room }
    func start() {
        stop(); active = true; heartbeatPending = false
        var url = URLComponents(url: service.config.url, resolvingAgainstBaseURL: false)!
        url.scheme = "wss"; url.path = "/realtime/v1/websocket"
        url.queryItems = [URLQueryItem(name: "apikey", value: service.config.key), URLQueryItem(name: "vsn", value: "1.0.0")]
        guard let address = url.url else { return }
        let task = service.session.webSocketTask(with: address); socket = task; task.resume()
        receiveTask = Task { [weak self] in
            guard let self = self else { return }
            do {
                try await self.send("phx_join", payload: ["access_token": self.service.config.token, "config": [
                    "broadcast": ["self": false], "presence": ["enabled": false], "private": false,
                    "postgres_changes": [
                        ["event": "*", "schema": "public", "table": "messages", "filter": "room_id=eq.\(self.room)"],
                        ["event": "*", "schema": "public", "table": "room_reads", "filter": "room_id=eq.\(self.room)"],
                        ["event": "*", "schema": "public", "table": "message_reactions"]
                    ]
                ]])
                while !Task.isCancelled {
                    let message = try await task.receive()
                    let data: Data
                    switch message { case .string(let s): data = Data(s.utf8); case .data(let d): data = d; @unknown default: continue }
                    guard let d = try JSONSerialization.jsonObject(with: data) as? ChatJSON else { continue }
                    let event = d["event"] as? String
                    let payload = d["payload"] as? ChatJSON ?? [:]
                    if event == "phx_reply", d["topic"] as? String == "phoenix" { self.heartbeatPending = false }
                    if event == "phx_reply", d["topic"] as? String != "phoenix" {
                        if payload["status"] as? String == "ok" { self.status?(true); self.connected?() }
                        else { throw NativeChatError(message: "실시간 연결을 확인하고 있습니다.") }
                    }
                    if event == "postgres_changes", let change = payload["data"] as? ChatJSON { self.changed?(change) }
                    if event == "phx_error" || event == "phx_close" || (event == "system" && payload["status"] as? String == "error") {
                        throw URLError(.networkConnectionLost)
                    }
                }
            } catch { if !Task.isCancelled { self.reconnect() } }
        }
        heartbeat = Task { [weak self] in
            while !Task.isCancelled {
                do {
                    try await Task.sleep(nanoseconds: 20_000_000_000)
                    guard let self = self else { return }
                    if self.heartbeatPending { self.reconnect(); return }
                    self.heartbeatPending = true
                    try await self.send("heartbeat", payload: [:], topic: "phoenix")
                } catch { if !Task.isCancelled { self?.reconnect() }; return }
            }
        }
    }
    func updateToken() { Task { try? await send("access_token", payload: ["access_token": service.config.token]) } }
    private func send(_ event: String, payload: ChatJSON, topic: String? = nil) async throws {
        ref += 1
        let data = try JSONSerialization.data(withJSONObject: ["topic": topic ?? "realtime:native-\(room)",
            "event": event, "payload": payload, "ref": String(ref)])
        try await socket?.send(.string(String(decoding: data, as: UTF8.self)))
    }
    private func reconnect() {
        guard active, retry == nil else { return }
        status?(false); socket?.cancel(with: .goingAway, reason: nil)
        receiveTask?.cancel(); heartbeat?.cancel()
        retry = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: 3_000_000_000) } catch { return }
            guard let self = self, self.active else { return }
            self.retry = nil; self.start()
        }
    }
    func stop() {
        active = false; receiveTask?.cancel(); heartbeat?.cancel(); retry?.cancel(); retry = nil
        socket?.cancel(with: .goingAway, reason: nil); socket = nil
    }
}

enum NativeChatRows {
    static let iso = ISO8601DateFormatter()
    static func date(_ value: String) -> Date {
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = iso.date(from: value) { return d }
        iso.formatOptions = [.withInternetDateTime]
        return iso.date(from: value) ?? .distantPast
    }
    static func now() -> String { iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return iso.string(from: Date()) }
    static func label(_ person: ChatJSON) -> String {
        let year = (person["birth_year"] as? Int).map { String(format: "%02d", $0 % 100) }
        return [year, person["name"] as? String, person["region"] as? String].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: "/")
    }
    static func make(_ messages: [NativeChatMessage], user: String, people: [ChatJSON], reads: [String: String],
                     reactions: [ChatJSON], unread: String?) -> [ChatRow] {
        let who = Dictionary(people.compactMap { p -> (String, ChatJSON)? in
            guard let id = p["id"] as? String else { return nil }; return (id, p)
        }, uniquingKeysWith: { _, b in b })
        let byID = Dictionary(messages.map { ($0.id, $0) }, uniquingKeysWith: { _, b in b })
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "ko_KR"); formatter.timeZone = TimeZone(identifier: "Asia/Seoul")
        func format(_ m: NativeChatMessage, _ pattern: String) -> String { formatter.dateFormat = pattern; return formatter.string(from: date(m.at)) }
        func grouped(_ a: NativeChatMessage?, _ b: NativeChatMessage?) -> Bool {
            guard let a = a, let b = b, !a.system, !b.system, !a.hidden, !b.hidden else { return false }
            return a.user == b.user && format(a, "yyyy-MM-dd HH:mm") == format(b, "yyyy-MM-dd HH:mm")
        }
        let active = people.filter { !["pending", "banned"].contains($0["role"] as? String ?? "pending") }
        return messages.enumerated().compactMap { i, m in
            let prev = i > 0 ? messages[i - 1] : nil
            let next = i + 1 < messages.count ? messages[i + 1] : nil
            var d: ChatJSON = ["id": m.id, "body": m.body, "kind": "text", "mine": m.user == user,
                "top": grouped(prev, m) ? 2.0 : 10.0, "mark": m.id == unread]
            if prev == nil || format(prev!, "yyyy-MM-dd") != format(m, "yyyy-MM-dd") { d["date"] = format(m, "M월 d일 (E)") }
            if m.hidden { d["kind"] = "system"; d["body"] = "가려진 메시지입니다"; return ChatRow(d) }
            if m.system {
                d["kind"] = "system"
                for (field, path, title, icon) in [("round_id", "rounds", "라운드", "round"), ("poll_id", "polls", "투표", "poll"), ("post_id", "board", "공지", "post")] {
                    if let id = m.raw[field] as? String { d["kind"] = "card"; d["to"] = "/\(path)/\(id)"; d["go"] = "\(title) 보러 가기 ›"; d["icon"] = icon; break }
                }
                return ChatRow(d)
            }
            if m.user != user && !grouped(prev, m), let p = who[m.user] {
                d["name"] = label(p); d["avatar"] = p["avatar_url"]
                if let gender = p["gender"] as? String, ["f", "m"].contains(gender) {
                    d["edge"] = gender == "f" ? "#e84a7f" : "#269bbe"
                }
            }
            if !grouped(m, next) { d["time"] = format(m, "a h:mm") }
            d["unread"] = active.filter { p in
                guard let id = p["id"] as? String, id != m.user else { return false }
                return date(reads[id] ?? "") < date(m.at)
            }.count
            if let img = m.image {
                let sticker = img.hasPrefix("sticker:")
                d["kind"] = sticker ? "sticker" : "photo"
                if sticker {
                    let id = String(img.dropFirst(8)); let ext = id.hasPrefix("mv") ? "webp" : "png"
                    d["image"] = "capacitor://localhost/stickers/\(id).\(ext)"
                } else { d["image"] = img }
                d["cap"] = m.body
            }
            if let id = m.reply {
                let original = byID[id]
                d["quoteWho"] = original.flatMap { who[$0.user]?["name"] as? String }.map { "\($0)에게 댓글" } ?? "댓글"
                d["quoteText"] = original?.preview ?? "이전 메시지 보기"
                d["quoteTo"] = id
            }
            var emojiOrder: [String] = []; var counts: [String: Int] = [:]; var mine = Set<String>()
            for r in reactions where r["message_id"] as? String == m.id {
                guard let e = r["emoji"] as? String else { continue }
                if counts[e] == nil { emojiOrder.append(e) }; counts[e, default: 0] += 1
                if r["user_id"] as? String == user { mine.insert(e) }
            }
            d["reacts"] = emojiOrder.map { ["emoji": $0, "n": counts[$0] ?? 0, "mine": mine.contains($0)] as ChatJSON }
            return ChatRow(d)
        }
    }
}
