import Foundation

/**
 * **로그인 유지는 앱이 맡는다**(사용자가 정했다 — `앱이 직접 받기`).
 *
 * 예전에는 앱 화면이 토큰이 끝나면 **뒤에 숨은 웹 화면에 새 토큰을 부탁하고**
 * 20초를 기다렸다. 그런데 앱 껍데기가 서 있는 동안 웹뷰는 화면 밖이라, 오래
 * 쉬고 나면 iOS가 그 웹 화면을 재우거나 통째로 치워 둔다 — 부탁이 닿지 않아
 * 20초 + 20초를 기다리다 `로그인을 확인하지 못했습니다`로 굳었다(사용자 제보
 * 세 번 — 기다리는 시간을 늘리고 · 죽은 연결을 끊고 · 깨어날 때 끊는 것으로
 * 세 번 고쳤는데 또 돌아왔다. **바탕이 틀린 것이었다**).
 *
 * 그래서 **갱신은 늘 여기 한 곳에서 한다.**
 *  - 앱 화면이 토큰이 필요하면 여기서 곧바로 받아 온다(웹을 안 기다린다).
 *  - **웹도 갱신을 여기에 맡긴다** — 웹의 `authFetch`(supabase.ts)가 갱신 요청을
 *    `NativeApp.refresh`로 넘긴다. 갱신 열쇠(refresh token)는 **한 번 쓰면 바뀌고,
 *    옛것을 10초가 지나 또 쓰면 서버가 로그인을 통째로 끊는다** — 웹과 앱이 따로
 *    갱신하면 언젠가 그 일이 난다. 한 곳에서만 하면 그럴 자리가 없다.
 *  - **쓴 열쇠를 기억한다**(`used`). 웹이 재워졌다 깨어나 옛 열쇠로 부탁하면
 *    서버에 다시 안 보내고 지금 것을 돌려준다 — 그것이 위의 끊김을 막는 자리다.
 *  - **디스크에 남긴다**(UserDefaults). 앱이 통째로 죽었다 켜져도, 웹이 들고 있는
 *    옛 열쇠를 알아볼 수 있어야 한다.
 *  - 앱이 스스로 받은 것은 웹에도 넘긴다(`onRotate` → `authSession` 이벤트 →
 *    `supabase.auth.setSession`). 웹의 실시간·업로드가 같은 토큰을 쓰게.
 *
 * **안드로이드는 처음부터 이 방식이다**(`NativeAuth.refresh` — 웹뷰가 없다).
 */
@MainActor
final class AuthStore {
    static let shared = AuthStore()

    private struct Saved: Codable {
        var url: String
        var user: String
        var access: String
        var refresh: String
        /// 서버가 준 응답 그대로 — 웹에 돌려줄 때 쓴다(웹은 `user`까지 든 모양을 바란다).
        var raw: String?
        var used: [String]
    }
    private var cur: Saved?
    private var inflight: [String: Task<(Int, Data), Error>] = [:]
    private let keyName = "kkakkung.auth.v1"
    /// 앱이 스스로 받은 새 세션을 웹에 넘기는 손잡이(`NativeAppPlugin`이 건다).
    var onRotate: ((ChatJSON) -> Void)?

    private init() {
        if let d = UserDefaults.standard.data(forKey: keyName),
           let s = try? JSONDecoder().decode(Saved.self, from: d) { cur = s }
    }
    private func save() {
        if let s = cur, let d = try? JSONEncoder().encode(s) {
            UserDefaults.standard.set(d, forKey: keyName)
        } else {
            UserDefaults.standard.removeObject(forKey: keyName)
        }
    }

    /// 로그아웃 — 다음 사람에게 남기지 않는다.
    func clear() { cur = nil; inflight = [:]; save() }

    /**
     * 웹이 들고 있는 세션을 알려 준다(`shell`·`open`·`session`에 실려 온다).
     * **옛것이면 안 받는다** — 이미 쓴 열쇠이거나, 지금 것보다 일찍 끝나는 토큰이면.
     */
    func offer(url: URL, user: String, access: String, refresh: String?) {
        guard let refresh = refresh, !refresh.isEmpty, !access.isEmpty else { return }
        let base = url.absoluteString
        if var c = cur, c.url == base, c.user == user {
            if c.used.contains(refresh) || c.refresh == refresh { return }
            if Self.exp(access) < Self.exp(c.access) { return }
            c.used = Array((c.used + [c.refresh]).suffix(12))
            c.access = access; c.refresh = refresh; c.raw = nil
            cur = c
        } else {
            cur = Saved(url: base, user: user, access: access, refresh: refresh, raw: nil, used: [])
        }
        save()
    }

    /// 이 사람의 지금 토큰 — 앱 화면이 보내기 전에 갈아 끼운다.
    func access(url: URL, user: String) -> String? {
        guard let c = cur, c.url == url.absoluteString, c.user == user else { return nil }
        return c.access
    }

    /**
     * 앱 화면이 새 토큰이 필요할 때. 들고 있는 열쇠로 곧바로 받아 온다 —
     * **끊긴 연결이면 두 번 더 해 본다**(깨어난 직후 첫 판이 곧잘 실패한다).
     * 열쇠가 없거나 서버가 거절하면 `nil` — 그때는 예전처럼 웹에 부탁한다.
     */
    func renew(url: URL, key: String, user: String, from old: String) async -> String? {
        guard let c = cur, c.url == url.absoluteString, c.user == user else { return nil }
        if c.access != old, !NativeChatService.expiring(c.access) { return c.access }
        for attempt in 0..<3 {
            do {
                let (status, data) = try await serve(url: url, key: key, refresh: c.refresh)
                if (200..<300).contains(status), let now = cur, now.user == user {
                    if let o = try? JSONSerialization.jsonObject(with: data) as? ChatJSON { onRotate?(o) }
                    return now.access
                }
                return nil
            } catch {
                if attempt < 2 { try? await Task.sleep(nanoseconds: UInt64(800_000_000 * (attempt + 1))) }
            }
        }
        return nil
    }

    /**
     * 갱신 한 번 — 웹이 넘긴 것(`NativeApp.refresh`)과 앱 화면이 부른 것이 함께 지난다.
     * 돌려주는 것은 서버 응답 그대로(상태 · 본문)다. 끊기면 던진다(웹은 다시 해 본다).
     */
    func serve(url: URL, key: String, refresh: String) async throws -> (Int, Data) {
        /* 이미 쓴 열쇠 — 서버에 또 보내면 로그인이 통째로 끊긴다. 지금 것을 돌려준다. */
        if let c = cur, c.url == url.absoluteString, c.used.contains(refresh), c.refresh != refresh {
            if let raw = c.raw, !NativeChatService.expiring(c.access), let d = raw.data(using: .utf8) {
                return (200, Self.freshen(d))
            }
            return try await serve(url: url, key: key, refresh: c.refresh)
        }
        if let t = inflight[refresh] { return try await t.value }
        let t = Task { @MainActor () -> (Int, Data) in
            var req = URLRequest(url: url.appendingPathComponent("auth/v1/token"))
            var parts = URLComponents(url: req.url!, resolvingAgainstBaseURL: false)!
            parts.queryItems = [URLQueryItem(name: "grant_type", value: "refresh_token")]
            req.url = parts.url
            req.httpMethod = "POST"
            req.timeoutInterval = 10
            req.setValue(key, forHTTPHeaderField: "apikey")
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: ["refresh_token": refresh])
            let (data, resp) = try await URLSession.shared.data(for: req)
            let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
            if (200..<300).contains(status),
               let o = (try? JSONSerialization.jsonObject(with: data)) as? ChatJSON,
               let access = o["access_token"] as? String, let next = o["refresh_token"] as? String {
                let user = ((o["user"] as? ChatJSON)?["id"] as? String) ?? Self.sub(access) ?? ""
                var used = (cur?.url == url.absoluteString && cur?.user == user) ? (cur?.used ?? []) : []
                used.append(refresh)
                if let c = cur, c.refresh != refresh, c.user == user { used.append(c.refresh) }
                cur = Saved(url: url.absoluteString, user: user, access: access, refresh: next,
                            raw: String(data: data, encoding: .utf8), used: Array(used.suffix(12)))
                save()
                AppLog.add("앱이 로그인 갱신")
            } else {
                AppLog.add("로그인 갱신 거절 \(status)")
            }
            return (status, data)
        }
        inflight[refresh] = t
        defer { inflight[refresh] = nil }
        return try await t.value
    }

    /// 담아 둔 응답의 남은 시간을 지금에 맞춘다(`expires_in`).
    private static func freshen(_ d: Data) -> Data {
        guard var o = (try? JSONSerialization.jsonObject(with: d)) as? ChatJSON,
              let access = o["access_token"] as? String else { return d }
        let e = exp(access)
        if e > 0 { o["expires_at"] = Int(e); o["expires_in"] = max(0, Int(e - Date().timeIntervalSince1970)) }
        return (try? JSONSerialization.data(withJSONObject: o)) ?? d
    }

    static func claims(_ jwt: String) -> ChatJSON? {
        let parts = jwt.split(separator: ".")
        guard parts.count > 1 else { return nil }
        var b = parts[1].replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b.count % 4 != 0 { b += "=" }
        guard let data = Data(base64Encoded: b) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? ChatJSON
    }
    static func exp(_ jwt: String) -> Double { claims(jwt)?["exp"] as? Double ?? 0 }
    static func sub(_ jwt: String) -> String? { claims(jwt)?["sub"] as? String }
}
