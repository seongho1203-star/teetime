package com.kkakkung.app.chat

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class StickerWordsTest {
    @Test fun punctuationSurvivesAndHighlightOffsetsReferToOriginalText() {
        assertEquals(listOf("짱!", "응?", "^^", "a~b", "a.b"), StickerWords.split(" 짱 ！, 응？, ^^, A～B, a.b, 짱!"))
        assertEquals("짱 ！", "앞 짱 ！ 뒤".substring(StickerWords.ranges("앞 짱 ！ 뒤", listOf("짱!")).single()))
        assertEquals("👋👋", StickerWords.split("👋👋").single())
        assertEquals(listOf("응", "헉"), StickerWords.split("응, 헉, 응"))
        assertTrue(StickerWords.matches("응", "응")); assertFalse(StickerWords.matches("응원해", "응"))
        assertTrue(StickerWords.matches("응원해", "응원")); assertTrue(StickerWords.ranges("응원해", listOf("응")).isEmpty())
    }
    @Test fun onlyTheLastTypedWordPicksStickers() {
        val rules = mapOf("a" to listOf("엥?"), "b" to listOf("ㅋㅋ"), "c" to listOf("감사"), "d" to listOf("감사합니다"))
        val (at, ids) = StickerWords.lastHit("엥? ㅋㅋ 감사", rules)!!
        assertEquals("감사", "엥? ㅋㅋ 감사".substring(at)); assertEquals(setOf("c"), ids)
        assertEquals(setOf("c", "d"), StickerWords.lastHit("감사합니다", rules)!!.second)
        assertNull(StickerWords.lastHit("안녕", rules))
    }
    private fun service(server: MockWebServer) = ChatService(ChatConfig(JSONObject().put("user", "member").put("url", server.url("/").toString()).put("key", "anon").put("token", "member-token")))
    @Test fun fetchesDatabaseWordsAndWritesOnlyChangedRowsWithEscapedFilters() = runBlocking {
        MockWebServer().use { server ->
            val api = service(server)
            server.enqueue(MockResponse().setBody("[]")); api.stickerWords()
            val get = server.takeRequest()
            assertEquals("sticker_id,word", get.requestUrl!!.queryParameter("select")); assertEquals("5000", get.requestUrl!!.queryParameter("limit"))
            server.enqueue(MockResponse().setBody("[{\"word\":\"old\"}]")); server.enqueue(MockResponse().setBody("[]"))
            api.setStickerWords("mv1", listOf("짱!", "a\"b\\c"), listOf("짱!", "응?"))
            val deleted = server.takeRequest(); val added = server.takeRequest()
            assertEquals("DELETE", deleted.method); assertEquals("eq.mv1", deleted.requestUrl!!.queryParameter("sticker_id"))
            assertEquals("in.(\"a\\\"b\\\\c\")", deleted.requestUrl!!.queryParameter("word"))
            val rows = JSONArray(added.body.readUtf8()); assertEquals(1, rows.length()); assertEquals("응?", rows.getJSONObject(0).getString("word"))
            assertEquals("Bearer member-token", added.getHeader("Authorization"))
            api.setStickerWords("mv1", listOf("짱!"), listOf("짱!")); assertEquals(3, server.requestCount)
        }
    }
    @Test fun rlsFilteredDeletionIsNotReportedAsSuccess() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("[]"))
            try { service(server).setStickerWords("mv1", listOf("짱!"), emptyList()); fail("Expected permission failure") } catch (_: ChatError) { }
            assertEquals(1, server.requestCount)
        }
    }
}
