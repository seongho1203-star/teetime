package com.kkakkung.app.chat

import java.io.File
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.Response
import okio.BufferedSink

/** 파일을 통째로 메모리에 담지 않고 8KB씩 보낸다. */
class ChatUploadBody(private val file: File, private val mime: String,
                     private val progress: (Long, Long) -> Unit) : RequestBody() {
    override fun contentType() = mime.toMediaType()
    override fun contentLength() = file.length()
    override fun writeTo(sink: BufferedSink) {
        val total = contentLength()
        var sent = 0L
        progress(0, total)
        file.inputStream().use { source ->
            val buffer = ByteArray(8192)
            while (true) {
                val count = source.read(buffer)
                if (count < 0) break
                sink.write(buffer, 0, count)
                sent += count
                progress(sent, total)
            }
        }
    }
}

/** 취소는 HTTP 요청도 끊는다. 서버 원문(토큰/내부 정보)은 화면에 내보내지 않는다. */
suspend fun ChatService.uploadFile(file: File, room: String, ext: String, mime: String,
                                   progress: (Long, Long) -> Unit): String {
    val path = "$room/${java.util.UUID.randomUUID()}.$ext"
    val request = Request.Builder().url("${config.url}/storage/v1/object/chat-photos/$path")
        .header("apikey", config.key).header("Authorization", "Bearer ${config.token}")
        .header("cache-control", "31536000")
        .post(ChatUploadBody(file, mime, progress)).build()
    return suspendCancellableCoroutine { continuation ->
        val call = http.newCall(request)
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (continuation.isActive) continuation.resumeWithException(ChatError("연결이 끊겼습니다. 다시 시도해 주세요."))
            }
            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (!continuation.isActive) return
                    if (response.isSuccessful) continuation.resume("${config.url}/storage/v1/object/public/chat-photos/$path")
                    else {
                        if (response.code == 401) authNeeded?.invoke()
                        val message = when (response.code) {
                            401 -> "로그인 갱신 후 다시 시도해 주세요."
                            413 -> "파일이 저장소 용량 제한을 넘었습니다."
                            else -> "업로드하지 못했습니다. 다시 시도해 주세요."
                        }
                        continuation.resumeWithException(ChatError(message))
                    }
                }
            }
        })
    }
}
