package com.kkakkung.app.chat

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import okhttp3.*
import okio.ByteString
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ChatRealtimeTest {
    private class FakeSocket(private val request: Request, val listener: WebSocketListener) : WebSocket {
        val sent = ArrayList<JSONObject>()
        var cancelled = false
        override fun request() = request
        override fun queueSize() = 0L
        override fun send(text: String): Boolean { sent.add(JSONObject(text)); return true }
        override fun send(bytes: ByteString) = true
        override fun close(code: Int, reason: String?) = true
        override fun cancel() { cancelled = true }
        fun open() = listener.onOpen(this, Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(101).message("Switching Protocols").build())
        fun event(event: String, topic: String = "realtime:native-room", ref: String = "", payload: JSONObject = JSONObject()) {
            listener.onMessage(this, JSONObject().put("event", event).put("topic", topic).put("ref", ref).put("payload", payload).toString())
        }
        fun joinReply() = event("phx_reply", ref = sent.first().getString("ref"), payload = JSONObject().put("status", "ok"))
    }
    private class Factory : WebSocket.Factory {
        val connections = ArrayList<FakeSocket>()
        override fun newWebSocket(request: Request, listener: WebSocketListener): WebSocket =
            FakeSocket(request, listener).also { connections.add(it) }
    }
    private fun service() = ChatService(ChatConfig(JSONObject().put("url", "https://example.com")
        .put("key", "test-anon").put("token", "test-member")))

    @Test fun subscriptionUsesMemberTokenAndOnlyJoinAckReportsConnected() = runTest {
        val factory = Factory(); val api = service()
        val realtime = ChatRealtime(api, "room", backgroundScope, factory)
        var connected = 0; realtime.connected = { connected++ }
        realtime.start(); runCurrent()
        val socket = factory.connections.single(); socket.open(); runCurrent()
        val join = socket.sent.single()
        assertEquals("phx_join", join.getString("event"))
        assertEquals(join.getString("ref"), join.getString("join_ref"))
        assertEquals("test-member", join.getJSONObject("payload").getString("access_token"))
        assertEquals("room_id=eq.room", join.getJSONObject("payload").getJSONObject("config")
            .getJSONArray("postgres_changes").getJSONObject(0).getString("filter"))
        socket.joinReply(); runCurrent(); assertEquals(1, connected)
        api.config.token = "refreshed-member"
        realtime.updateToken(); runCurrent()
        val token = socket.sent.last()
        assertEquals("refreshed-member", token.getJSONObject("payload").getString("access_token"))
        assertEquals(join.getString("ref"), token.getString("join_ref"))
        socket.event("phx_reply", ref = token.getString("ref"), payload = JSONObject().put("status", "ok"))
        socket.joinReply(); runCurrent()
        assertEquals(1, connected)
        realtime.stop(); runCurrent()
    }

    @Test fun queuedOldEventsCannotReachAStoppedOrReopenedScreen() = runTest {
        val factory = Factory(); val realtime = ChatRealtime(service(), "room", backgroundScope, factory)
        var changes = 0; realtime.changed = { changes++ }
        realtime.start(); runCurrent()
        val old = factory.connections.single(); old.open(); runCurrent(); old.joinReply(); runCurrent()
        realtime.stop()
        old.event("postgres_changes", payload = JSONObject().put("data", JSONObject().put("table", "messages")))
        realtime.start(); runCurrent()
        old.open(); old.joinReply()
        old.listener.onFailure(old, Exception("late failure"), null)
        runCurrent()
        assertEquals(0, changes)
        assertEquals(2, factory.connections.size)
        assertTrue(old.cancelled)
        realtime.stop(); runCurrent(); advanceTimeBy(60_000); runCurrent()
        assertEquals(2, factory.connections.size)
    }

    @Test fun duplicateFailuresScheduleOneRetryAndStopCancelsIt() = runTest {
        val factory = Factory(); val realtime = ChatRealtime(service(), "room", backgroundScope, factory)
        realtime.start(); runCurrent()
        val first = factory.connections.single()
        repeat(3) { first.listener.onFailure(first, Exception("offline"), null) }
        runCurrent(); advanceTimeBy(3_000); runCurrent()
        assertEquals(2, factory.connections.size)
        val second = factory.connections.last()
        second.listener.onFailure(second, Exception("offline again"), null); runCurrent()
        realtime.stop(); runCurrent(); advanceTimeBy(60_000); runCurrent()
        assertEquals(2, factory.connections.size)
    }

    @Test fun unmatchedHeartbeatAckDoesNotHideADeadConnection() = runTest {
        val factory = Factory(); val realtime = ChatRealtime(service(), "room", backgroundScope, factory)
        realtime.start(); runCurrent()
        val socket = factory.connections.single(); socket.open(); runCurrent(); socket.joinReply(); runCurrent()
        advanceTimeBy(20_000); runCurrent()
        assertEquals("heartbeat", socket.sent.last().getString("event"))
        socket.event("phx_reply", "phoenix", "unrelated-ref", JSONObject().put("status", "ok")); runCurrent()
        advanceTimeBy(20_000); runCurrent()
        assertTrue(socket.cancelled)
        advanceTimeBy(3_000); runCurrent()
        assertEquals(2, factory.connections.size)
        realtime.stop(); runCurrent()
    }

    @Test fun matchingHeartbeatAckKeepsTheConnectionAlive() = runTest {
        val factory = Factory(); val realtime = ChatRealtime(service(), "room", backgroundScope, factory)
        realtime.start(); runCurrent()
        val socket = factory.connections.single(); socket.open(); runCurrent(); socket.joinReply(); runCurrent()
        advanceTimeBy(20_000); runCurrent()
        val heartbeatRef = socket.sent.last().getString("ref")
        socket.event("phx_reply", "phoenix", heartbeatRef, JSONObject().put("status", "ok")); runCurrent()
        advanceTimeBy(20_000); runCurrent()
        assertFalse(socket.cancelled)
        assertEquals(1, factory.connections.size)
        assertEquals(2, socket.sent.count { it.optString("event") == "heartbeat" })
        realtime.stop(); runCurrent()
    }

    @Test fun missingJoinAckTimesOutAndRetries() = runTest {
        val factory = Factory(); val realtime = ChatRealtime(service(), "room", backgroundScope, factory)
        realtime.start(); runCurrent(); factory.connections.single().open(); runCurrent()
        advanceTimeBy(15_000); runCurrent()
        assertTrue(factory.connections.single().cancelled)
        advanceTimeBy(3_000); runCurrent()
        assertEquals(2, factory.connections.size)
        realtime.stop(); runCurrent()
    }
}
