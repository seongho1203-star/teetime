package com.kkakkung.app.chat

import android.os.Handler
import android.os.Looper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.net.URLEncoder
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * 웹이 열 때 넘겨 주는 설정 — 아이폰의 `NativeChatConfig`와 같은 칸이다
 * (`src/screens/NativeChat.tsx`의 `openNativeChat`).
 *
 * **규칙은 웹에서 온다** — 반응 다섯(`reactions`)·이모티콘 목록(`stickers`)·
 * 추천 표(`suggest`). 앱에 또 적으면 한쪽만 고치게 된다.
 */
class ChatConfig(d: JSONObject) {
    val user: String = d.optString("user")
    val url: String = d.optString("url").trimEnd('/')
    val key: String = d.optString("key")
    @Volatile var token: String = d.optString("token")
    val seen: String = d.optString("seen", "1970-01-01T00:00:00Z")
    val back: Boolean = d.optBoolean("back", false)
    val reactions: List<String>
    val stickers: JSONArray = d.optJSONArray("stickers") ?: JSONArray()
    val suggest: JSONArray = d.optJSONArray("suggest") ?: JSONArray()
    val suggestMax: Int = d.optInt("suggestMax", 8)
    val suggestAnim: Int = d.optInt("suggestAnim", 2)

    init {
        val five = d.optJSONArray("reactions")
        val list = ArrayList<String>()
        if (five != null) for (i in 0 until five.length()) list.add(five.optString(i))
        reactions = if (list.isEmpty()) listOf("👍", "❤️", "😂", "😮", "😢") else list
    }

    val valid: Boolean
        get() = user.isNotEmpty() && url.startsWith("https://") && key.isNotEmpty() && token.isNotEmpty()
}

class ChatError(message: String) : Exception(message)

/** 한 줄의 글. 아이폰 `NativeChatMessage`와 같은 겉모양이다. */
class ChatMessage(val raw: JSONObject) {
    val id: String get() = raw.optString("id")
    val body: String get() = raw.optString("body")
    val user: String get() = raw.optString("user_id")
    val at: String get() = raw.optString("created_at")
    val image: String? get() = if (raw.isNull("image_url")) null else raw.optString("image_url")
    val reply: String? get() = if (raw.isNull("reply_to")) null else raw.optString("reply_to")
    val hidden: Boolean get() = !raw.isNull("hidden_at") && raw.optString("hidden_at").isNotEmpty()
    val system: Boolean get() = raw.optBoolean("system", false)
    val preview: String
        get() {
            if (hidden) return "가려진 메시지입니다"
            if (body.isNotEmpty()) return body
            val img = image
            if (img != null && img.startsWith("sticker:")) return "이모티콘"
            if (ChatMedia.isVideo(img)) return "동영상"
            return if (img != null) "사진" else "메시지"
        }
}

object ChatMedia {
    private val videoExts = listOf("mp4", "mov", "m4v")
    /** 주소 끝으로 가른다 — 웹 `lib/media.ts`의 `isVideo`와 같은 잣대다. */
    fun isVideo(url: String?): Boolean {
        if (url == null || url.startsWith("sticker:")) return false
        val path = url.substringBefore('?').lowercase()
        return videoExts.any { path.endsWith(".$it") }
    }
}

/**
 * Supabase REST · Storage · RPC — 회원 JWT와 공개 anon key로 부르므로
 * **기존 RLS가 그대로 걸린다.** DB 변경은 없다(아이폰과 같은 길이다).
 */
class ChatService(@Volatile var config: ChatConfig) {
    var authNeeded: (() -> Unit)? = null
    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(300, TimeUnit.SECONDS)
        .build()

    private fun encode(v: String): String =
        /* `URLEncoder`는 빈칸을 `+`로 적는데 PostgREST는 `+`를 빈칸으로 읽는다 —
           시각의 `+00:00`이 그대로 가면 400이다(아이폰의 `percentEncodedQuery`
           자리). `+` 글자 자체는 `%2B`로 이미 바뀌어 있으니 빈칸만 `%20`으로. */
        URLEncoder.encode(v, "UTF-8").replace("+", "%20")

    suspend fun request(path: String, query: List<Pair<String, String>> = emptyList(),
                        method: String = "GET", body: Any? = null,
                        bytes: ByteArray? = null, contentType: String = "image/jpeg"): Any? =
        withContext(Dispatchers.IO) {
            val qs = query.joinToString("&") { encode(it.first) + "=" + encode(it.second) }
            val url = config.url + "/" + path + (if (qs.isEmpty()) "" else "?$qs")
            var lastStatus = 0
            for (attempt in 0..1) {
                val token = config.token
                val b = Request.Builder().url(url)
                    .header("apikey", config.key)
                    .header("Authorization", "Bearer $token")
                    .header("Prefer", "return=representation")
                val payload = when {
                    bytes != null -> { b.header("cache-control", "31536000"); bytes.toRequestBody(contentType.toMediaType()) }
                    body != null -> body.toString().toRequestBody("application/json".toMediaType())
                    method == "POST" || method == "PATCH" -> "".toRequestBody("application/json".toMediaType())
                    else -> null
                }
                b.method(method, payload)
                val res: Response = http.newCall(b.build()).execute()
                val status = res.code
                val text = res.body?.string() ?: ""
                res.close()
                if (status == 401 && attempt == 0) {
                    /* 토큰이 만료됐다 — 웹에 알리고 새 토큰이 오면 한 번 더 간다
                       (`session()`이 `config.token`을 갈아 끼운다). */
                    authNeeded?.invoke()
                    for (i in 0 until 10) { delay(300); if (config.token != token) break }
                    lastStatus = status
                    continue
                }
                if (status !in 200..299) {
                    if (status == 401) throw ChatError("로그인이 만료됐습니다. 다시 로그인해 주세요.")
                    if (status == 403) throw ChatError("이 작업을 할 권한이 없습니다.")
                    throw ChatError("서버에 연결하지 못했습니다($status). 다시 시도해 주세요.")
                }
                return@withContext if (text.isEmpty()) JSONArray() else JSONTokener(text).nextValue()
            }
            throw ChatError("로그인 확인이 필요합니다.($lastStatus)")
        }

    suspend fun rows(table: String, query: List<Pair<String, String>> = emptyList()): List<JSONObject> {
        val out = ArrayList<JSONObject>()
        val r = request("rest/v1/$table", query)
        if (r is JSONArray) for (i in 0 until r.length()) r.optJSONObject(i)?.let { out.add(it) }
        return out
    }

    suspend fun room(): JSONObject =
        rows("rooms", listOf("select" to "*", "round_id" to "is.null", "order" to "created_at.asc", "limit" to "1"))
            .firstOrNull() ?: throw ChatError("대화방을 찾지 못했습니다.")

    suspend fun people(): List<JSONObject> = try {
        rows("profiles", listOf("select" to "id,name,avatar_url,role,gender,birth_year,region", "order" to "name", "limit" to "1000"))
    } catch (e: Exception) {
        rows("profiles", listOf("select" to "id,name,avatar_url,role", "order" to "name", "limit" to "1000"))
    }

    suspend fun messages(room: String, filters: List<Pair<String, String>> = emptyList(),
                         ascending: Boolean = false, limit: Int = 50): List<ChatMessage> {
        val order = if (ascending) "created_at.asc,id.asc" else "created_at.desc,id.desc"
        val q = ArrayList<Pair<String, String>>()
        q.add("select" to "*"); q.add("room_id" to "eq.$room"); q.add("order" to order); q.add("limit" to limit.toString())
        q.addAll(filters)
        return rows("messages", q).map { ChatMessage(it) }
    }

    suspend fun reads(room: String): Map<String, String> {
        val out = HashMap<String, String>()
        for (d in rows("room_reads", listOf("select" to "user_id,last_read_at", "room_id" to "eq.$room", "limit" to "1000"))) {
            val id = d.optString("user_id"); val at = d.optString("last_read_at")
            if (id.isNotEmpty() && at.isNotEmpty()) out[id] = at
        }
        return out
    }

    suspend fun reactions(ids: List<String>): List<JSONObject> {
        val out = ArrayList<JSONObject>()
        var i = 0
        while (i < ids.size) {
            val chunk = ids.subList(i, minOf(ids.size, i + 50)).joinToString(",")
            out.addAll(rows("message_reactions", listOf("select" to "message_id,user_id,emoji,created_at",
                "message_id" to "in.($chunk)", "order" to "created_at.asc", "limit" to "1000")))
            i += 50
        }
        return out
    }

    /** 보낸다. **id는 클라이언트가 정한 UUID**라 답을 못 받고 다시 보내도 같은 글이다. */
    suspend fun send(row: JSONObject): ChatMessage {
        try {
            val r = request("rest/v1/messages", method = "POST", body = row)
            val first = (r as? JSONArray)?.optJSONObject(0) ?: throw ChatError("메시지를 저장하지 못했습니다.")
            return ChatMessage(first)
        } catch (e: Exception) {
            val id = row.optString("id")
            if (id.isNotEmpty()) {
                val existing = try { rows("messages", listOf("select" to "*", "id" to "eq.$id", "limit" to "1")) } catch (x: Exception) { emptyList() }
                existing.firstOrNull()?.let { return ChatMessage(it) }
            }
            throw e
        }
    }

    suspend fun change(message: ChatMessage, patch: JSONObject?) {
        val r = request("rest/v1/messages", listOf("id" to "eq.${message.id}"),
            method = if (patch == null) "DELETE" else "PATCH", body = patch)
        val n = (r as? JSONArray)?.length() ?: 0
        if (n == 0) throw ChatError("권한이 없거나 이미 삭제된 메시지입니다.")
    }

    suspend fun react(id: String, emoji: String, remove: Boolean) {
        if (remove) request("rest/v1/message_reactions",
            listOf("message_id" to "eq.$id", "user_id" to "eq.${config.user}", "emoji" to "eq.$emoji"), method = "DELETE")
        else request("rest/v1/message_reactions", method = "POST",
            body = JSONObject().put("message_id", id).put("user_id", config.user).put("emoji", emoji))
    }

    suspend fun markRead(room: String) {
        request("rest/v1/rpc/mark_room_read", method = "POST", body = JSONObject().put("p_room", room))
    }

    /** 사진·동영상 한 개를 통에 올린다. **끝(`ext`)이 곧 갈래다**(`ChatMedia.isVideo`). */
    suspend fun upload(data: ByteArray, room: String, ext: String = "jpg", type: String = "image/jpeg"): String {
        val path = "$room/${UUID.randomUUID().toString().lowercase()}.$ext"
        request("storage/v1/object/chat-photos/$path", method = "POST", bytes = data, contentType = type)
        return "${config.url}/storage/v1/object/public/chat-photos/$path"
    }
}

/**
 * 실시간 — Supabase의 Phoenix v1 규약(아이폰 `NativeChatRealtime`과 같다).
 * 20초 heartbeat, 답이 없으면 다시 잇고, 토큰이 바뀌면 알린다.
 *
 * **알려 주는 것은 메인 갈래에서 한다** — 받는 쪽이 화면을 고치는 코드다.
 */
class ChatRealtime(private val service: ChatService, private val room: String) {
    var changed: ((JSONObject) -> Unit)? = null
    var connected: (() -> Unit)? = null
    var status: ((Boolean) -> Unit)? = null

    private val main = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var socket: WebSocket? = null
    private var heartbeat: Job? = null
    private var retry: Job? = null
    @Volatile private var active = false
    @Volatile private var pending = false
    private var ref = 0
    private var generation = 0

    fun start() {
        stop(); active = true; pending = false
        val gen = ++generation
        val base = service.config.url.replaceFirst("https://", "wss://")
        val url = "$base/realtime/v1/websocket?apikey=${service.config.key}&vsn=1.0.0"
        val req = Request.Builder().url(url).build()
        socket = service.http.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                if (gen != generation) return
                val changes = JSONArray()
                    .put(JSONObject().put("event", "*").put("schema", "public").put("table", "messages").put("filter", "room_id=eq.$room"))
                    .put(JSONObject().put("event", "*").put("schema", "public").put("table", "room_reads").put("filter", "room_id=eq.$room"))
                    .put(JSONObject().put("event", "*").put("schema", "public").put("table", "message_reactions"))
                val cfg = JSONObject()
                    .put("broadcast", JSONObject().put("self", false))
                    .put("presence", JSONObject().put("enabled", false))
                    .put("private", false)
                    .put("postgres_changes", changes)
                send("phx_join", JSONObject().put("access_token", service.config.token).put("config", cfg))
                heartbeat = scope.launch {
                    while (isActive) {
                        delay(20_000)
                        if (pending) { reconnect(); return@launch }
                        pending = true
                        send("heartbeat", JSONObject(), "phoenix")
                    }
                }
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                if (gen != generation) return
                val d = try { JSONObject(text) } catch (e: Exception) { return }
                val event = d.optString("event")
                val topic = d.optString("topic")
                val payload = d.optJSONObject("payload") ?: JSONObject()
                if (event == "phx_reply" && topic == "phoenix") pending = false
                if (event == "phx_reply" && topic != "phoenix") {
                    if (payload.optString("status") == "ok") main.post { status?.invoke(true); connected?.invoke() }
                    else reconnect()
                }
                if (event == "postgres_changes") {
                    val change = payload.optJSONObject("data")
                    if (change != null) main.post { changed?.invoke(change) }
                }
                if (event == "phx_error" || event == "phx_close" ||
                    (event == "system" && payload.optString("status") == "error")) reconnect()
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (gen == generation) reconnect()
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (gen == generation) reconnect()
            }
        })
    }

    fun updateToken() { send("access_token", JSONObject().put("access_token", service.config.token)) }

    @Synchronized private fun send(event: String, payload: JSONObject, topic: String? = null) {
        ref += 1
        val msg = JSONObject().put("topic", topic ?: "realtime:native-$room")
            .put("event", event).put("payload", payload).put("ref", ref.toString())
        socket?.send(msg.toString())
    }

    private fun reconnect() {
        if (!active) return
        synchronized(this) {
            if (retry != null) return
            main.post { status?.invoke(false) }
            socket?.cancel(); socket = null
            heartbeat?.cancel(); heartbeat = null
            retry = scope.launch {
                delay(3_000)
                synchronized(this@ChatRealtime) { retry = null }
                if (active) main.post { if (active) start() }
            }
        }
    }

    fun stop() {
        active = false
        heartbeat?.cancel(); heartbeat = null
        retry?.cancel(); retry = null
        socket?.cancel(); socket = null
    }
}
