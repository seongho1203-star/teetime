package com.kkakkung.app.chat

import java.io.File
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ChatUploadTransportTest {
    private fun service(server: MockWebServer) = ChatService(ChatConfig(JSONObject()
        .put("url", server.url("/").toString()).put("user", "test-member")
        .put("key", "test-anon-key").put("token", "test-member-jwt")))

    @Test fun originalBytesAndMemberHeadersReachStorage() = runBlocking {
        val server = MockWebServer(); server.start()
        val file = File.createTempFile("chat-upload-test", ".png")
        try {
            val bytes = ByteArray(16391) { (it % 251).toByte() }
            file.writeBytes(bytes)
            server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))
            val updates = ArrayList<Pair<Long, Long>>()
            val result = service(server).uploadFile(file, "room-1", "png", "image/png") { sent, total ->
                updates.add(sent to total)
            }
            val request = server.takeRequest(5, TimeUnit.SECONDS)!!
            assertEquals("POST", request.method)
            assertEquals("test-anon-key", request.getHeader("apikey"))
            assertEquals("Bearer test-member-jwt", request.getHeader("Authorization"))
            assertNull(request.getHeader("x-upsert"))
            assertEquals("image/png", request.getHeader("Content-Type"))
            assertArrayEquals(bytes, request.body.readByteArray())
            assertEquals(0L, updates.first().first)
            assertEquals(bytes.size.toLong() to bytes.size.toLong(), updates.last())
            assertTrue(updates.zipWithNext().all { it.first.first <= it.second.first })
            assertEquals(server.url(request.path!!.replace("/object/", "/object/public/")).toString(), result)
        } finally { file.delete(); server.shutdown() }
    }

    @Test fun unauthorizedUploadRequestsRefreshAndNeverReturnsSuccessUrl() = runBlocking {
        val server = MockWebServer(); server.start()
        val file = File.createTempFile("chat-upload-test", ".jpg").apply { writeText("test") }
        try {
            server.enqueue(MockResponse().setResponseCode(401).setBody("private server error"))
            val refreshed = AtomicBoolean(false)
            val api = service(server).apply { authNeeded = { refreshed.set(true) } }
            try { api.uploadFile(file, "room-1", "jpg", "image/jpeg") { _, _ -> }; fail("401 must fail") }
            catch (e: ChatError) { assertFalse(e.message.orEmpty().contains("private server error")) }
            assertTrue(refreshed.get())
        } finally { file.delete(); server.shutdown() }
    }

    @Test fun failedUploadDoesNotReturnAFileUrl() = runBlocking {
        val server = MockWebServer(); server.start()
        val file = File.createTempFile("chat-upload-test", ".mp4").apply { writeText("test") }
        try {
            server.enqueue(MockResponse().setResponseCode(413))
            try { service(server).uploadFile(file, "room-1", "mp4", "video/mp4") { _, _ -> }; fail("413 must fail") }
            catch (e: ChatError) { assertTrue(e.message.orEmpty().contains("용량")) }
        } finally { file.delete(); server.shutdown() }
    }

    @Test fun cancellingAnUploadCancelsTheHttpCall() = runBlocking {
        val server = MockWebServer(); server.start()
        val file = File.createTempFile("chat-upload-test", ".jpg").apply { writeText("test") }
        try {
            server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
            val api = service(server)
            val upload = async { api.uploadFile(file, "room-1", "jpg", "image/jpeg") { _, _ -> } }
            val request = withContext(Dispatchers.IO) { server.takeRequest(5, TimeUnit.SECONDS) }
            assertNotNull(request)
            val calls = api.http.dispatcher.runningCalls()
            assertEquals(1, calls.size)
            upload.cancelAndJoin()
            assertTrue(calls.single().isCanceled())
            assertTrue(upload.isCancelled)
        } finally { file.delete(); server.shutdown() }
    }
}
