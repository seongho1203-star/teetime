package com.kkakkung.app.nativev2

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NativeApiParityTest {
    @Test fun pollPagesIncludeUndatedLivePollsAndUseStablePastBoundary() = runBlocking {
        MockWebServer().use { server ->
            val at = "2026-09-27T10:00:00Z"
            server.enqueue(MockResponse().setBody("[{\"id\":\"old\",\"closed\":false,\"closes_at\":null}]"))
            server.enqueue(MockResponse().setBody("[{\"id\":\"new\",\"closed\":false,\"closes_at\":\"2026-10-01T00:00:00Z\"}]"))
            server.enqueue(MockResponse().setBody("[]"))
            val client = api(server)
            assertEquals(listOf("old", "new"), client.livePolls(at).map { it.getString("id") })
            repeat(3) { offset ->
                val query = server.takeRequest().requestUrl!!
                assertEquals("eq.false", query.queryParameter("closed"))
                assertEquals("(closes_at.is.null,closes_at.gt.$at)", query.queryParameter("or"))
                assertEquals(offset.toString(), query.queryParameter("offset"))
            }
            server.enqueue(MockResponse().setBody("[]"))
            client.pastPolls(10, at)
            val past = server.takeRequest().requestUrl!!
            assertEquals("(closed.eq.true,closes_at.lte.$at)", past.queryParameter("or"))
            assertEquals("10", past.queryParameter("offset"))
            assertEquals("11", past.queryParameter("limit"))
        }
    }
    private fun api(server: MockWebServer) = NativeApi(NativeSession("member", "member-token", "", 0, server.url("/").toString(), "anon"))
    @Test fun deletionCleansPushThenPhotosThenAccountWithMemberToken() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("[]"))
            server.enqueue(MockResponse().setBody("[{\"name\":\"face.jpg\"}]"))
            server.enqueue(MockResponse().setBody("[]"))
            server.enqueue(MockResponse().setBody("null"))
            api(server).deleteMe { "device" }
            val calls = (1..4).map { server.takeRequest() }
            assertTrue(calls[0].path!!.startsWith("/rest/v1/push_subscriptions?"))
            assertEquals("/storage/v1/object/list/avatars", calls[1].path)
            assertEquals("/storage/v1/object/avatars", calls[2].path)
            assertEquals("member/face.jpg", JSONObject(calls[2].body.readUtf8()).getJSONArray("prefixes").getString(0))
            assertEquals("/rest/v1/rpc/delete_me", calls[3].path)
            calls.forEach { assertEquals("Bearer member-token", it.getHeader("Authorization")); assertEquals("anon", it.getHeader("apikey")) }
        }
    }
    @Test fun shareDropsOnlyCompatibilityColumnsOnMissingColumnErrors() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("[{\"id\":\"room\"}]"))
            server.enqueue(MockResponse().setResponseCode(400).setBody("{\"code\":\"PGRST204\",\"message\":\"missing notify\"}"))
            server.enqueue(MockResponse().setResponseCode(400).setBody("{\"code\":\"42703\",\"message\":\"missing round_id\"}"))
            server.enqueue(MockResponse().setBody("[]"))
            api(server).shareRound(JSONObject().put("id", "round").put("course", "Test"))
            server.takeRequest()
            val attempts = (1..3).map { JSONObject(server.takeRequest().body.readUtf8()) }
            assertTrue(attempts[0].has("notify")); assertFalse(attempts[1].has("notify"))
            assertTrue(attempts[1].has("round_id")); assertFalse(attempts[2].has("round_id"))
            attempts.forEach { assertEquals("room", it.getString("room_id")); assertTrue(it.getBoolean("system")) }
        }
    }
    @Test fun shareDoesNotRetryPermissionFailures() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("[{\"id\":\"room\"}]"))
            server.enqueue(MockResponse().setResponseCode(403))
            try { api(server).shareRound(JSONObject()); fail("Expected permission failure") } catch (_: NativeApiError) { }
            assertEquals(2, server.requestCount)
        }
    }
}
