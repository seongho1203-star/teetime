package com.kkakkung.app.chat

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import java.io.File
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

class ChatUploadState(val sent: Long, val total: Long, val label: String,
                      val failed: Boolean = false, val cancellable: Boolean = true)

/** 한 번에 한 파일만 읽고 전송. 실패한 항목에서 멈추고 사용자의 재시도를 기다린다. */
class ChatUploads(private val context: Context, private val service: ChatService,
                  private val changed: (ChatMessage?, String?) -> Unit,
                  private val progress: (Map<String, ChatUploadState>) -> Unit) {
    private class Item(val uri: Uri, val room: String) {
        val id = UUID.randomUUID().toString()
        val temp get() = "tmp:$id"
        var file: File? = null
        var mime = ""
        var ext = ""
        var url: String? = null
        var attemptedSend = false
        var state = ChatUploadState(0, 0, "전송 대기")
    }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val main = Handler(Looper.getMainLooper())
    private val items = ArrayList<Item>()
    private var worker: Job? = null
    private var active: Job? = null
    private var current: Item? = null
    private var destroyed = false
    val pending: Boolean get() = items.isNotEmpty()

    fun enqueue(uris: List<Uri>, room: String) {
        for (uri in uris) {
            val item = Item(uri, room)
            items.add(item)
            val video = runCatching { context.contentResolver.getType(uri)?.startsWith("video/") == true }.getOrDefault(false)
            changed(ChatMessage(JSONObject().put("id", item.temp).put("room_id", room)
                .put("user_id", service.config.user).put("body", "").put("image_url", uri.toString())
                .put("created_at", java.time.Instant.now().toString()).put("_local_video", video)), null)
        }
        notifyProgress(); runQueue()
    }

    fun retry(id: String) {
        val item = items.firstOrNull { it.temp == id } ?: return
        if (!item.state.failed) return
        item.state = ChatUploadState(0, item.file?.length() ?: 0, "다시 시도 중")
        notifyProgress(); runQueue()
    }

    fun cancel(id: String) {
        val item = items.firstOrNull { it.temp == id } ?: return
        if (!item.state.cancellable) return
        items.remove(item)
        if (current === item) active?.cancel()
        item.file?.delete()
        changed(null, item.temp); notifyProgress()
        runQueue()
    }

    private fun notifyProgress() { if (!destroyed) progress(items.associate { it.temp to it.state }) }
    private fun state(item: Item, value: ChatUploadState) {
        item.state = value
        notifyProgress()
    }

    private fun runQueue() {
        if (destroyed || worker?.isActive == true) return
        worker = scope.launch(start = CoroutineStart.LAZY) {
            while (items.isNotEmpty()) {
                val item = items.first()
                if (item.state.failed) break
                current = item
                active = scope.launch {
                    try {
                        if (item.file == null) {
                            state(item, ChatUploadState(0, 0, "파일 불러오는 중…"))
                            prepare(item)
                        }
                        val file = item.file ?: throw ChatError("파일을 다시 골라 주세요.")
                        if (item.url == null) {
                            state(item, ChatUploadState(0, file.length(), "업로드 중"))
                            var last = 0L
                            item.url = service.uploadFile(file, item.room, item.ext, item.mime) { sent, total ->
                                val now = System.nanoTime()
                                if (sent == total || now - last > 200_000_000L) {
                                    last = now
                                    main.post {
                                        if (items.contains(item) && item.url == null && !item.state.failed)
                                            state(item, ChatUploadState(sent, total, "업로드 중"))
                                    }
                                }
                            }
                        }
                        // POST의 답만 끊겼던 경우를 먼저 확인한다. 같은 UUID로 두 번 쓰지 않는다.
                        state(item, ChatUploadState(file.length(), file.length(), "메시지 전송 중…", cancellable = false))
                        val existing = if (item.attemptedSend) service.messages(item.room,
                            listOf("id" to "eq.${item.id}"), limit = 1).firstOrNull() else null
                        item.attemptedSend = true
                        val sent = existing ?: service.send(JSONObject().put("id", item.id)
                            .put("room_id", item.room).put("user_id", service.config.user)
                            .put("body", "").put("image_url", item.url))
                        items.remove(item); file.delete()
                        changed(sent, item.temp); notifyProgress()
                    } catch (e: CancellationException) { item.file?.delete(); throw e }
                    catch (e: Exception) {
                        state(item, ChatUploadState(0, item.file?.length() ?: 0,
                            (e as? ChatError)?.message ?: "전송하지 못했습니다. 다시 시도해 주세요.", true,
                            cancellable = !item.attemptedSend))
                    }
                }
                active?.join(); active = null; current = null
            }
        }
        worker?.start()
    }

    private suspend fun prepare(item: Item) = withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        val mime = resolver.getType(item.uri)?.lowercase() ?: throw ChatError("파일 형식을 읽지 못했습니다.")
        val heic = mime in listOf("image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence")
        val ext = when (mime) {
            "image/jpeg" -> "jpg"; "image/png" -> "png"; "image/gif" -> "gif"; "image/webp" -> "webp"
            "image/avif" -> "avif"; "video/mp4" -> "mp4"; "video/quicktime" -> "mov"; "video/x-m4v" -> "m4v"
            else -> if (heic) "heic" else throw ChatError("지원하지 않는 파일 형식입니다.")
        }
        val limit = 50L * 1024 * 1024
        resolver.query(item.uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst() && !cursor.isNull(0) && cursor.getLong(0) > limit)
                throw ChatError("한 파일은 50MB까지 보낼 수 있습니다.")
        }
        val folder = File(context.cacheDir, "chat-upload").apply { mkdirs() }
        val source = File(folder, "${item.id}.$ext")
        var converted: File? = null
        try {
            resolver.openInputStream(item.uri)?.use { input -> source.outputStream().use { output ->
                val buffer = ByteArray(8192); var size = 0L
                while (true) {
                    ensureActive()
                    val count = input.read(buffer); if (count < 0) break
                    size += count
                    if (size > limit) throw ChatError("한 파일은 50MB까지 보낼 수 있습니다.")
                    output.write(buffer, 0, count)
                }
            } } ?: throw ChatError("파일을 읽지 못했습니다. 다시 골라 주세요.")
            if (source.length() == 0L) throw ChatError("비어 있는 파일입니다.")
            if (heic) {
                converted = File(folder, "${item.id}.jpg")
                val bitmap = try {
                    if (Build.VERSION.SDK_INT >= 28) ImageDecoder.decodeBitmap(ImageDecoder.createSource(source)) { decoder, _, _ ->
                        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                    } else BitmapFactory.decodeFile(source.absolutePath)
                } catch (e: OutOfMemoryError) { throw ChatError("사진이 너무 커 변환하지 못했습니다.") }
                if (bitmap == null) throw ChatError("이 기기에서 HEIC 사진을 변환하지 못했습니다.")
                try { converted.outputStream().use { if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 95, it)) throw ChatError("사진 변환 실패") } }
                finally { bitmap.recycle() }
                source.delete()
                if (converted.length() > limit) throw ChatError("변환한 사진이 50MB를 넘습니다.")
            }
            ensureActive()
            item.ext = if (heic) "jpg" else ext
            item.mime = if (heic) "image/jpeg" else mime
            item.file = converted ?: source
        } catch (e: Exception) { source.delete(); converted?.delete(); throw e }
    }

    fun destroy() {
        destroyed = true; scope.cancel()
        items.forEach { it.file?.delete() }; items.clear()
    }
}
