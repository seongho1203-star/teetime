package com.kkakkung.app.chat

import android.app.Activity
import android.app.Dialog
import android.content.ClipData
import android.content.ContentValues
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.RectF
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.view.Gravity
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.GestureDetector
import android.view.VelocityTracker
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.widget.AppCompatImageView
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.fragment.app.DialogFragment
import coil.dispose
import coil.load
import com.kkakkung.app.R
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.min
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request

/** E-17: 사진은 대화 위에서 열고, 원본 파일을 저장/공유한다. */
class ChatPhotoDialog : DialogFragment() {
    companion object {
        private const val TAG = "chat-photo"
        private val client = OkHttpClient.Builder().callTimeout(60, TimeUnit.SECONDS).build()

        fun show(activity: androidx.appcompat.app.AppCompatActivity, url: String) {
            val manager = activity.supportFragmentManager
            if (manager.isStateSaved || manager.findFragmentByTag(TAG) != null) return
            ChatPhotoDialog().apply { arguments = Bundle().apply { putString("url", url) } }
                .showNow(manager, TAG)
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    @Volatile private var download: Call? = null
    private var original: Original? = null
    private var busy = false
    private lateinit var photo: ZoomPhoto
    private lateinit var save: TextView
    private lateinit var share: TextView
    private lateinit var close: ImageButton
    private lateinit var root: FrameLayout
    private lateinit var scrim: View
    private lateinit var progress: ProgressBar
    private lateinit var error: TextView
    private data class Original(val file: File, val mime: String)

    // Android 6–9: 파일 선택기로 저장하므로 광범위한 저장소 권한을 요구하지 않는다.
    private val document = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            setBusy(false)
        } else {
            scope.launch {
                try {
                    val source = originalFile()
                    val resolver = requireContext().contentResolver
                    withContext(Dispatchers.IO) {
                        resolver.openOutputStream(uri)?.use { output -> source.file.inputStream().use { it.copyTo(output) } }
                            ?: throw IOException("저장할 파일을 열지 못했습니다.")
                    }
                    notice("사진을 저장했습니다.")
                } catch (e: CancellationException) { throw e }
                catch (e: Exception) { notice("사진을 저장하지 못했습니다. 다시 시도해 주세요.") }
                finally { setBusy(false) }
            }
        }
    }

    override fun onCreateDialog(savedInstanceState: Bundle?): Dialog {
        val context = requireContext()
        root = FrameLayout(context)
        scrim = View(context).apply { setBackgroundColor(Color.BLACK) }
        root.addView(scrim, FrameLayout.LayoutParams(-1, -1))
        photo = ZoomPhoto(context)
        root.addView(photo, FrameLayout.LayoutParams(-1, -1))
        progress = ProgressBar(context)
        root.addView(progress, FrameLayout.LayoutParams(dp(40), dp(40), Gravity.CENTER))
        error = TextView(context).apply {
            text = "사진을 불러오지 못했습니다.\n눌러서 다시 시도"
            gravity = Gravity.CENTER; setTextColor(Color.WHITE); textSize = 15f
            visibility = View.GONE
            setPadding(dp(24), dp(24), dp(24), dp(24))
            setOnClickListener { loadPhoto() }
        }
        root.addView(error, FrameLayout.LayoutParams(-1, -2, Gravity.CENTER))
        close = ImageButton(context).apply {
            setImageResource(R.drawable.ic_chat_close)
            contentDescription = "사진 닫기"
            background = ColorDrawable(Color.TRANSPARENT)
            setPadding(dp(12), dp(12), dp(12), dp(12))
            setOnClickListener { dismiss() }
        }
        root.addView(close, FrameLayout.LayoutParams(dp(44), dp(44), Gravity.TOP or Gravity.END).apply {
            topMargin = dp(4); rightMargin = dp(8)
        })
        val actions = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        save = pill("저장") { saveOriginal() }
        share = pill("공유") { shareOriginal() }
        actions.addView(save, LinearLayout.LayoutParams(dp(96), dp(44)).apply { marginEnd = dp(6) })
        actions.addView(share, LinearLayout.LayoutParams(dp(96), dp(44)).apply { marginStart = dp(6) })
        root.addView(actions, FrameLayout.LayoutParams(-2, dp(44), Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply {
            bottomMargin = dp(16)
        })
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            root.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        photo.onDrag = { dy ->
            val fade = (1f - abs(dy) / dp(400)).coerceIn(0f, 1f)
            scrim.alpha = fade; close.alpha = fade; actions.alpha = fade
        }
        photo.onDismiss = { dismiss() }
        loadPhoto()
        return Dialog(context, R.style.ChatPhotoTheme).apply {
            setContentView(root)
            window?.apply {
                setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
                clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            }
        }
    }

    override fun onStart() {
        super.onStart()
        dialog?.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        ViewCompat.requestApplyInsets(root)
    }

    private fun loadPhoto() {
        progress.visibility = View.VISIBLE; error.visibility = View.GONE
        save.isEnabled = false; share.isEnabled = false
        photo.load(requireArguments().getString("url")) {
            crossfade(false)
            listener(onSuccess = { _, _ ->
                progress.visibility = View.GONE
                photo.post { photo.fit() }
                setBusy(false)
            }, onError = { _, _ ->
                progress.visibility = View.GONE; error.visibility = View.VISIBLE
            })
        }
    }

    private fun pill(label: String, action: () -> Unit) = TextView(requireContext()).apply {
        text = label; textSize = 15f; gravity = Gravity.CENTER; setTextColor(Color.WHITE)
        background = GradientDrawable().apply {
            setColor(0x4DFFFFFF); cornerRadius = dp(22).toFloat(); setStroke(dp(1), 0x40FFFFFF)
        }
        setOnClickListener { action() }
    }

    private fun setBusy(value: Boolean) {
        busy = value
        if (!::save.isInitialized) return
        save.text = if (value) "처리 중…" else "저장"
        val enabled = !value && photo.drawable != null
        save.isEnabled = enabled; share.isEnabled = enabled
        save.alpha = if (enabled) 1f else .5f; share.alpha = save.alpha
    }

    private fun saveOriginal() {
        if (busy) return
        setBusy(true)
        scope.launch {
            var choosingDocument = false
            try {
                val source = originalFile()
                if (Build.VERSION.SDK_INT >= 29) {
                    val resolver = requireContext().contentResolver
                    withContext(Dispatchers.IO) {
                        val values = ContentValues().apply {
                            put(MediaStore.Images.Media.DISPLAY_NAME, source.file.name)
                            put(MediaStore.Images.Media.MIME_TYPE, source.mime)
                            put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/까꿍")
                            put(MediaStore.Images.Media.IS_PENDING, 1)
                        }
                        val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                            ?: throw IOException("사진 저장 공간을 만들지 못했습니다.")
                        try {
                            resolver.openOutputStream(uri)?.use { output -> source.file.inputStream().use { it.copyTo(output) } }
                                ?: throw IOException("사진 저장 공간을 열지 못했습니다.")
                            ensureActive()
                            val updated = resolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
                            if (updated == 0) throw IOException("사진 저장을 마치지 못했습니다.")
                        } catch (e: Exception) {
                            resolver.delete(uri, null, null)
                            throw e
                        }
                    }
                    notice("사진첩에 저장했습니다.")
                } else {
                    document.launch(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE); type = source.mime
                        putExtra(Intent.EXTRA_TITLE, source.file.name)
                    })
                    choosingDocument = true
                }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { notice("사진을 저장하지 못했습니다. 다시 시도해 주세요.") }
            finally { if (!choosingDocument) setBusy(false) }
        }
    }

    private fun shareOriginal() {
        if (busy) return
        setBusy(true)
        scope.launch {
            try {
                val source = originalFile()
                val context = requireContext()
                val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", source.file)
                startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                    type = source.mime
                    putExtra(Intent.EXTRA_STREAM, uri)
                    clipData = ClipData.newUri(context.contentResolver, "사진", uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }, "사진 공유"))
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { notice("사진을 공유하지 못했습니다. 다시 시도해 주세요.") }
            finally { setBusy(false) }
        }
    }

    private suspend fun originalFile(): Original {
        original?.takeIf { it.file.isFile }?.let { return it }
        val folder = File(requireContext().cacheDir, "chat-photo-share")
        val url = requireArguments().getString("url") ?: throw IOException("사진 주소가 없습니다.")
        val result = withContext(Dispatchers.IO) {
            folder.mkdirs()
            // 공유 앱이 읽을 시간을 보장한다. 현재 파일은 닫을 때 지우지 않는다.
            folder.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > TimeUnit.DAYS.toMillis(7) }
                ?.forEach { it.delete() }
            val part = File(folder, UUID.randomUUID().toString() + ".part")
            val call = client.newCall(Request.Builder().url(url).build())
            download = call
            try {
                ensureActive()
                call.execute().use { response ->
                    if (!response.isSuccessful) throw IOException("사진을 받지 못했습니다.")
                    val body = response.body ?: throw IOException("사진이 비어 있습니다.")
                    val limit = 50L * 1024 * 1024
                    if (body.contentLength() > limit) throw IOException("사진이 너무 큽니다.")
                    body.byteStream().use { input -> part.outputStream().use { output ->
                        val buffer = ByteArray(8192)
                        var total = 0L
                        while (true) {
                            ensureActive()
                            val count = input.read(buffer)
                            if (count < 0) break
                            total += count
                            if (total > limit) throw IOException("사진이 너무 큽니다.")
                            output.write(buffer, 0, count)
                        }
                    } }
                }
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeFile(part.absolutePath, bounds)
                val mime = bounds.outMimeType ?: throw IOException("사진 형식이 아닙니다.")
                val extension = when (mime) {
                    "image/jpeg" -> "jpg"; "image/png" -> "png"; "image/webp" -> "webp"
                    "image/gif" -> "gif"; "image/heif", "image/heic" -> "heic"
                    "image/avif" -> "avif"; else -> throw IOException("지원하지 않는 사진 형식입니다.")
                }
                val file = File(folder, "kkakkung-${UUID.randomUUID()}.$extension")
                if (!part.renameTo(file)) throw IOException("사진 파일을 만들지 못했습니다.")
                Original(file, mime)
            } finally { part.delete(); download = null }
        }
        original = result
        return result
    }

    private fun notice(message: String) { context?.let { Toast.makeText(it, message, Toast.LENGTH_SHORT).show() } }
    private fun dp(value: Int) = (resources.displayMetrics.density * value).toInt()

    override fun onDestroyView() {
        if (::photo.isInitialized) photo.dispose()
        super.onDestroyView()
    }

    override fun onDestroy() {
        download?.cancel()
        scope.cancel()
        super.onDestroy()
    }
}

/** 사진의 실제 경계 안에서 확대/이동. 1배일 때에만 아래로 끌어 닫는다. */
private class ZoomPhoto(context: android.content.Context) : AppCompatImageView(context) {
    var onDrag: ((Float) -> Unit)? = null
    var onDismiss: (() -> Unit)? = null
    private val transform = Matrix()
    private val bounds = RectF()
    private var base = 1f
    private var zoom = 1f
    private var downX = 0f
    private var downY = 0f
    private var lastX = 0f
    private var lastY = 0f
    private var dismissDrag = false
    private var multiple = false
    private var velocity: VelocityTracker? = null
    private val slop = ViewConfiguration.get(context).scaledTouchSlop
    private val density = resources.displayMetrics.density

    init { scaleType = ScaleType.MATRIX; contentDescription = "사진. 두 손가락 또는 두 번 눌러 확대" }

    fun fit() {
        val d = drawable ?: return
        if (width == 0 || height == 0 || d.intrinsicWidth <= 0 || d.intrinsicHeight <= 0) return
        base = min(width.toFloat() / d.intrinsicWidth, height.toFloat() / d.intrinsicHeight)
        zoom = 1f
        transform.setScale(base, base)
        transform.postTranslate((width - d.intrinsicWidth * base) / 2, (height - d.intrinsicHeight * base) / 2)
        imageMatrix = transform
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) { super.onSizeChanged(w, h, oldw, oldh); fit() }

    private fun clamp() {
        val d = drawable ?: return
        bounds.set(0f, 0f, d.intrinsicWidth.toFloat(), d.intrinsicHeight.toFloat())
        transform.mapRect(bounds)
        val dx = if (bounds.width() <= width) width / 2f - bounds.centerX()
            else if (bounds.left > 0) -bounds.left else if (bounds.right < width) width - bounds.right else 0f
        val dy = if (bounds.height() <= height) height / 2f - bounds.centerY()
            else if (bounds.top > 0) -bounds.top else if (bounds.bottom < height) height - bounds.bottom else 0f
        transform.postTranslate(dx, dy)
        imageMatrix = transform
    }

    private val scale = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScale(detector: ScaleGestureDetector): Boolean {
            val next = (zoom * detector.scaleFactor).coerceIn(1f, 5f)
            transform.postScale(next / zoom, next / zoom, detector.focusX, detector.focusY)
            zoom = next; clamp()
            return true
        }
    })
    private val taps = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
        override fun onDown(e: MotionEvent) = true
        override fun onDoubleTap(e: MotionEvent): Boolean {
            if (zoom > 1.01f) fit() else {
                transform.postScale(3f, 3f, e.x, e.y); zoom = 3f; clamp()
            }
            return true
        }
    })

    override fun onTouchEvent(event: MotionEvent): Boolean {
        parent?.requestDisallowInterceptTouchEvent(true)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                animate().cancel()
                translationY = 0f; onDrag?.invoke(0f)
                downX = event.rawX; downY = event.rawY; lastX = event.rawX; lastY = event.rawY
                dismissDrag = false; multiple = false
                velocity?.recycle(); velocity = VelocityTracker.obtain()
            }
            MotionEvent.ACTION_POINTER_DOWN -> {
                multiple = true; dismissDrag = false
                translationY = 0f; onDrag?.invoke(0f)
            }
        }
        val rawEvent = MotionEvent.obtain(event)
        rawEvent.offsetLocation(event.rawX - event.x, event.rawY - event.y)
        velocity?.addMovement(rawEvent)
        rawEvent.recycle()
        scale.onTouchEvent(event)
        taps.onTouchEvent(event)
        when (event.actionMasked) {
            MotionEvent.ACTION_MOVE -> if (!scale.isInProgress && event.pointerCount == 1 && !multiple) {
                // 움직이는 사진 좌표가 아니라 화면 좌표로 거리와 속도를 잰다.
                val dy = event.rawY - downY
                val dx = event.rawX - downX
                if (zoom <= 1.01f) {
                    if (!dismissDrag && dy > slop && dy > abs(dx)) dismissDrag = true
                    if (dismissDrag) {
                        translationY = if (dy > 0) dy else dy / 3
                        onDrag?.invoke(translationY)
                    }
                } else {
                    transform.postTranslate(event.rawX - lastX, event.rawY - lastY); clamp()
                }
                lastX = event.rawX; lastY = event.rawY
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                velocity?.computeCurrentVelocity(1000)
                val distance = translationY
                val shouldClose = event.actionMasked == MotionEvent.ACTION_UP && dismissDrag && !multiple &&
                    (distance > 120 * density || (distance > 40 * density && (velocity?.yVelocity ?: 0f) > 800 * density))
                velocity?.recycle(); velocity = null
                if (shouldClose) onDismiss?.invoke()
                else if (distance != 0f) animate().translationY(0f).setDuration(200)
                    .setUpdateListener { onDrag?.invoke(translationY) }.start()
            }
        }
        return true
    }

    override fun onDetachedFromWindow() {
        animate().cancel(); velocity?.recycle(); velocity = null
        super.onDetachedFromWindow()
    }
}
