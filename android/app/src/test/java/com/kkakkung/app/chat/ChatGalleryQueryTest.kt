package com.kkakkung.app.chat

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ChatGalleryQueryTest {
    @Test fun mediaFiltersAndStableCursorReachServer() = runBlocking {
        val server = MockWebServer(); server.start()
        try {
            server.enqueue(MockResponse().setBody("[]"))
            val api = ChatService(ChatConfig(JSONObject().put("url", server.url("/").toString())
                .put("token", "member-token").put("key", "anon")))
            val cursor = ChatMessage(JSONObject().put("id", "a123")
                .put("created_at", "2026-09-27T00:00:00+00:00"))
            assertTrue(api.recentMedia("room-1", 60, cursor).isEmpty())
            val request = server.takeRequest()
            val url = request.requestUrl!!
            assertEquals(listOf("not.is.null", "not.ilike.sticker:%"), url.queryParameterValues("image_url"))
            assertNull(url.queryParameter("sticker_id"))
            assertEquals("is.null", url.queryParameter("hidden_at"))
            assertEquals("60", url.queryParameter("limit"))
            assertEquals("eq.room-1", url.queryParameter("room_id"))
            assertEquals("created_at.desc,id.desc", url.queryParameter("order"))
            assertEquals("(created_at.lt.${cursor.at},and(created_at.eq.${cursor.at},id.lt.a123))", url.queryParameter("or"))
            assertEquals("Bearer member-token", request.getHeader("Authorization"))
        } finally { server.shutdown() }
    }

    @Test fun failedPageIsNotReportedAsEmptyAndCanBeRetried() = runBlocking {
        val server = MockWebServer(); server.start()
        try {
            val api = ChatService(ChatConfig(JSONObject().put("url", server.url("/").toString())))
            server.enqueue(MockResponse().setResponseCode(503))
            server.enqueue(MockResponse().setBody("[{\"id\":\"photo-1\",\"image_url\":\"https://example.com/a.jpg\"}]"))
            try { api.recentMedia("room-1"); fail("failure must not mark the gallery complete") }
            catch (_: ChatError) {}
            assertEquals("photo-1", api.recentMedia("room-1").single().id)
        } finally { server.shutdown() }
    }
}
