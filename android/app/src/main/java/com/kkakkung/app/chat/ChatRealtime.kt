package com.kkakkung.app.chat

import kotlinx.coroutines.*
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject

/** Socket callbacks, timers and public actions all mutate state on the same dispatcher. */
class ChatRealtime internal constructor(
    private val service: ChatService,
    private val room: String,
    private val scope: CoroutineScope,
    private val sockets: WebSocket.Factory
) {
    constructor(service: ChatService, room: String) : this(
        service, room, CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate), service.http
    )

    var changed: ((JSONObject) -> Unit)? = null
    var connected: (() -> Unit)? = null
    var status: ((Boolean) -> Unit)? = null
    private val topic = "realtime:native-$room"
    private var socket: WebSocket? = null
    private var heartbeat: Job? = null
    private var joinTimeout: Job? = null
    private var retry: Job? = null
    private var active = false
    private var generation = 0L
    private var ref = 0L
    private var joinRef: String? = null
    private var heartbeatRef: String? = null
    private var joined = false
    private var failures = 0

    fun start() = scope.launch { failures = 0; startNow() }
    fun stop() = scope.launch { stopNow() }
    fun updateToken() = scope.launch {
        if (active && joinRef != null) send("access_token", JSONObject().put("access_token", service.config.token))
    }

    private fun current(gen: Long) = active && gen == generation

    private fun startNow() {
        stopNow()
        active = true
        val gen = generation
        val base = service.config.url.replaceFirst("https://", "wss://")
        val request = Request.Builder().url("$base/realtime/v1/websocket?apikey=${service.config.key}&vsn=1.0.0").build()
        socket = sockets.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                scope.launch {
                    if (!current(gen)) { webSocket.cancel(); return@launch }
                    val changes = JSONArray()
                        .put(JSONObject().put("event", "*").put("schema", "public").put("table", "messages").put("filter", "room_id=eq.$room"))
                        .put(JSONObject().put("event", "*").put("schema", "public").put("table", "room_reads").put("filter", "room_id=eq.$room"))
                        .put(JSONObject().put("event", "*").put("schema", "public").put("table", "message_reactions"))
                    val config = JSONObject().put("broadcast", JSONObject().put("self", false))
                        .put("presence", JSONObject().put("enabled", false))
                        .put("private", false).put("postgres_changes", changes)
                    joinRef = send("phx_join", JSONObject().put("access_token", service.config.token).put("config", config))
                    joinTimeout = scope.launch { delay(15_000); if (current(gen) && !joined) reconnect(gen) }
                    heartbeat = scope.launch {
                        while (isActive && current(gen)) {
                            delay(20_000)
                            if (!current(gen)) return@launch
                            if (heartbeatRef != null) { reconnect(gen); return@launch }
                            heartbeatRef = send("heartbeat", JSONObject(), "phoenix")
                        }
                    }
                }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                scope.launch {
                    // Check here, not on the socket thread: stop/re-entry may precede delivery.
                    if (!current(gen)) return@launch
                    val data = try { JSONObject(text) } catch (_: Exception) { return@launch }
                    val event = data.optString("event")
                    val channel = data.optString("topic")
                    val payload = data.optJSONObject("payload") ?: JSONObject()
                    if (event == "phx_reply") {
                        val replyRef = data.optString("ref")
                        if (channel == "phoenix" && replyRef == heartbeatRef) {
                            if (payload.optString("status") == "ok") heartbeatRef = null else reconnect(gen)
                        } else if (channel == topic && replyRef == joinRef && !joined) {
                            if (payload.optString("status") == "ok") {
                                joined = true; failures = 0
                                joinTimeout?.cancel(); joinTimeout = null
                                status?.invoke(true); connected?.invoke()
                            } else reconnect(gen)
                        }
                    }
                    if (!current(gen) || channel != topic) return@launch
                    if (event == "postgres_changes" && joined) payload.optJSONObject("data")?.let { changed?.invoke(it) }
                    if (event == "phx_error" || event == "phx_close" ||
                        (event == "system" && payload.optString("status") in setOf("error", "timeout"))) reconnect(gen)
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                scope.launch { if (current(gen)) reconnect(gen) }
            }
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                scope.launch { if (current(gen)) reconnect(gen) }
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                scope.launch { if (current(gen)) reconnect(gen) }
            }
        })
    }

    private fun send(event: String, payload: JSONObject, channel: String = topic): String {
        val id = (++ref).toString()
        val message = JSONObject().put("topic", channel).put("event", event).put("payload", payload).put("ref", id)
        if (channel != "phoenix") message.put("join_ref", if (event == "phx_join") id else joinRef)
        socket?.send(message.toString())
        return id
    }

    private fun reconnect(gen: Long) {
        if (!current(gen) || retry != null) return
        generation++ // Invalidate every queued callback before cancelling the old socket.
        val retryGeneration = generation
        clearConnection()
        status?.invoke(false)
        val delayMs = listOf(3_000L, 6_000L, 12_000L, 30_000L)[failures.coerceAtMost(3)]
        failures = (failures + 1).coerceAtMost(3)
        retry = scope.launch {
            delay(delayMs)
            if (current(retryGeneration)) { retry = null; startNow() }
        }
    }

    private fun clearConnection() {
        heartbeat?.cancel(); heartbeat = null
        joinTimeout?.cancel(); joinTimeout = null
        socket?.cancel(); socket = null
        joinRef = null; heartbeatRef = null; joined = false
    }

    private fun stopNow() {
        active = false; generation++
        retry?.cancel(); retry = null
        clearConnection()
    }
}
