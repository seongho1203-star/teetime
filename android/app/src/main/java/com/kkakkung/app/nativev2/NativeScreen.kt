package com.kkakkung.app.nativev2

import android.content.Context
import android.graphics.Color
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import com.kkakkung.app.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * **앱 화면이 껍데기(`NativeHomeActivity`)에게 부탁하는 것들.** 화면은 자기 일만
 * 하고, 다른 화면으로 가는 길은 껍데기가 안다(아이폰의 `navigate`와 같은 자리).
 */
interface ScreenHost {
    val hostApi: NativeApi
    val hostScope: CoroutineScope
    val myId: String
    /** 뒤로 — `refreshBehind`면 돌아간 화면을 다시 받는다(지운 뒤처럼). */
    fun back(refreshBehind: Boolean = false)
    fun editRound(r: JSONObject)
    fun copyRound(r: JSONObject)
    fun roundGroups(r: JSONObject, people: List<JSONObject>)
    fun newSettlement(roundId: String, joined: List<String>, people: List<JSONObject>)
    fun editPoll(p: JSONObject)
    fun editPost(p: JSONObject)
    /** 주소로 간다(`/rounds/<id>` · `/` 등) — 알림함·가이드가 쓴다(아이폰 `navigate`). */
    fun open(path: String)
    /** 지금 화면을 그 주소의 화면으로 **바꿔치기**한다 — 새로 만든 글·라운드로 갈 때(아이폰 `navigate(replace:)`). */
    fun replaceWith(path: String)
    /** 사진을 골라 400px JPEG로 줄여 준다(못 골랐으면 null) — 고르는 창은 껍데기가 띄운다. */
    fun pickAvatar(done: (ByteArray?) -> Unit)
    /** 알림 권한을 묻는다(안드로이드 13+) — 이미 있으면 곧바로 true. */
    fun askPushPermission(done: (Boolean) -> Unit)
    fun logout()
    /** 프로필 수정 — `내 정보` 위에 쓰는 화면을 얹는다. */
    fun editProfile(profile: JSONObject?, contact: JSONObject?)
}

/**
 * **앱 화면의 뼈대** — 머리말(`←` + 제목 + 오른쪽 단추)과 그 아래 본문 자리.
 * 아이폰의 `NativeScreenController`와 같은 모양이다(머리말 48 · `←` 44 · 굵은 17 제목).
 * 화면마다 이것을 물려받아 `body`에 내용을 얹고 `load()`에서 받아 온다.
 */
abstract class NativeScreen(val ctx: Context, val host: ScreenHost, title: String) {
    val ui = Ui(ctx)
    val root = FrameLayout(ctx).apply { setBackgroundColor(AppSkin.bg) }
    private val column = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
    val header = FrameLayout(ctx)
    val titleLabel: TextView = ui.label(title, 17f, bold = true)
    /** 머리말 오른쪽 단추(`수정` 같은 것) — 기본은 감춰져 있다. */
    val rightButton: TextView = ui.label("", 14f, bold = true).apply {
        gravity = Gravity.CENTER; setPadding(ui.dp(12), 0, ui.dp(12), 0); visibility = View.GONE
        isClickable = true
    }
    /** 머리말 아래 본문 자리. */
    val body = FrameLayout(ctx)
    val spinner = ProgressBar(ctx).apply { visibility = View.GONE }
    val api get() = host.hostApi
    val myId get() = host.myId
    private var flashView: TextView? = null
    var busy = false

    init {
        val back = ImageView(ctx).apply {
            setImageResource(R.drawable.ic_nav_back)
            imageTintList = android.content.res.ColorStateList.valueOf(AppSkin.text)
            scaleType = ImageView.ScaleType.CENTER
            contentDescription = "뒤로"
            isClickable = true
            setOnClickListener { hideKeyboard(); host.back() }
        }
        header.addView(back, FrameLayout.LayoutParams(ui.dp(44), ui.dp(44), Gravity.CENTER_VERTICAL or Gravity.START).apply { marginStart = ui.dp(4) })
        header.addView(titleLabel, FrameLayout.LayoutParams(-2, -2, Gravity.CENTER_VERTICAL or Gravity.START).apply { marginStart = ui.dp(50); marginEnd = ui.dp(90) })
        header.addView(rightButton, FrameLayout.LayoutParams(-2, ui.dp(44), Gravity.CENTER_VERTICAL or Gravity.END).apply { marginEnd = ui.dp(8) })
        column.addView(header, LinearLayout.LayoutParams(-1, ui.dp(48)))
        column.addView(body, LinearLayout.LayoutParams(-1, 0, 1f))
        root.addView(column, FrameLayout.LayoutParams(-1, -1))
        body.addView(spinner, FrameLayout.LayoutParams(-2, -2, Gravity.CENTER))
    }

    /** 처음 보일 때와 다시 받을 때 — 화면마다 여기서 받아 온다. */
    abstract fun load()

    fun launch(block: suspend CoroutineScope.() -> Unit) = host.hostScope.launch(block = block)

    /** 한 번 하고 다시 받아 온다 — 실패하면 까닭을 알린다(아이폰 `run`). */
    fun act(job: suspend () -> Unit) {
        if (busy) return
        busy = true
        launch {
            try { job(); load() }
            catch (e: Exception) { flash(e.message ?: "처리하지 못했습니다.", error = true) }
            finally { busy = false }
        }
    }

    /** 짧은 안내 — 화면 아래 알약 하나가 떴다 사라진다(아이폰 `flash`). */
    fun flash(text: String, error: Boolean = false, bottomGap: Int = 24) {
        flashView?.let { root.removeView(it) }
        val l = TextView(ctx).apply {
            this.text = text
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            maxLines = 2
            setPadding(ui.dp(16), ui.dp(10), ui.dp(16), ui.dp(10))
            minHeight = ui.dp(40)
            background = ui.rounded(if (error) AppSkin.danger else Color.argb(235, 31, 31, 31), 14)
            elevation = ui.dpf(4f)
            alpha = 0f
        }
        root.addView(l, FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply {
            bottomMargin = ui.dp(bottomGap); marginStart = ui.dp(16); marginEnd = ui.dp(16)
        })
        flashView = l
        l.animate().alpha(1f).setDuration(180).start()
        l.postDelayed({
            l.animate().alpha(0f).setDuration(250).withEndAction {
                root.removeView(l); if (flashView === l) flashView = null
            }.start()
        }, 2200)
    }

    /** 한 번 더 묻는 창(웹 `Confirm` · 아이폰 `UIAlertController`). */
    fun confirm(title: String, detail: String, ok: String, danger: Boolean, then: () -> Unit) {
        val d = AlertDialog.Builder(ctx)
            .setTitle(title)
            .setMessage(detail.ifBlank { null })
            .setNegativeButton("취소", null)
            .setPositiveButton(ok) { _, _ -> then() }
            .show()
        if (danger) d.getButton(AlertDialog.BUTTON_POSITIVE)?.setTextColor(AppSkin.danger)
    }

    fun hideKeyboard() {
        (ctx.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager)?.hideSoftInputFromWindow(root.windowToken, 0)
        root.findFocus()?.clearFocus()
    }

    /** 굴러가는 본문 — 좌우 16 · 위 4 · 아래 24, 사이 10(아이폰 화면들의 `stack`). */
    fun scrollStack(): Pair<ScrollView, LinearLayout> {
        val stack = ui.vstack(10).apply { setPadding(ui.dp(16), ui.dp(4), ui.dp(16), ui.dp(24)) }
        val scroll = ScrollView(ctx).apply {
            isFillViewport = true
            addView(stack, FrameLayout.LayoutParams(-1, -2))
            /* 글칸 밖을 누르면 키보드를 내린다(웹 `lib/keyboard.ts` · 아이폰 `dismissOnTap`). */
            setOnTouchListener { v, e ->
                if (e.actionMasked == android.view.MotionEvent.ACTION_UP) {
                    val f = v.findFocus()
                    if (f is EditText) {
                        val r = android.graphics.Rect(); f.getGlobalVisibleRect(r)
                        if (!r.contains(e.rawX.toInt(), e.rawY.toInt())) hideKeyboard()
                    }
                }
                false
            }
        }
        return scroll to stack
    }
}

/** 댓글 한 줄 — 얼굴(28) · 이름표 + 시각 · 본문 · (지울 수 있으면) ✕ · 줄 사이는 가는 선. */
fun commentRow(ui: Ui, c: AppComment, who: AppProfile?, canDelete: Boolean, first: Boolean, onDelete: () -> Unit): View {
    val wrap = LinearLayout(ui.ctx).apply { orientation = LinearLayout.VERTICAL }
    if (!first) wrap.addView(View(ui.ctx).apply { setBackgroundColor(AppSkin.line) }, LinearLayout.LayoutParams(-1, ui.dp(1)))
    val row = LinearLayout(ui.ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        setPadding(0, ui.dp(10), 0, ui.dp(10))
    }
    row.addView(ui.avatar(who, 28))
    val col = ui.vstack(3)
    val label = who?.label.orEmpty().ifEmpty { "알 수 없음" }
    col.addView(ui.label(ui.rich(Triple(label, 14f, true to AppSkin.text), Triple("  " + AppDate.ago(c.createdAt), 12f, false to AppSkin.faint)), 14f))
    col.addView(ui.label(c.body, 14f, lines = 0))
    row.addView(col, LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = ui.dp(10); marginEnd = ui.dp(6) })
    if (canDelete) row.addView(ui.smallX("댓글 지우기", onDelete))
    wrap.addView(row)
    return wrap
}

/**
 * **댓글 적는 칸 — 카드 안에 그대로 선다**(아이폰 `CommentInput`). 적은 만큼 44~140까지
 * 늘어난다. 화면이 다시 그려져도 **같은 칸을 옮겨 붙인다**(새로 만들면 적던 글이 날아간다).
 */
class CommentInput(private val ui: Ui) : LinearLayout(ui.ctx) {
    val field = EditText(ui.ctx).apply {
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
        setTextColor(AppSkin.text)
        setHintTextColor(AppSkin.faint)
        hint = "댓글 남기기"
        background = ui.rounded(AppSkin.surface2, AppSkin.radiusSm, AppSkin.line)
        setPadding(ui.dp(12), ui.dp(10), ui.dp(12), ui.dp(10))
        minHeight = ui.dp(44)
        maxHeight = ui.dp(140)
        inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        isVerticalScrollBarEnabled = true
    }
    var onSend: ((String) -> Unit)? = null
    private val sendBtn = ui.button("등록", AppSkin.brand, filled = true) {
        val t = field.text.toString().trim()
        if (t.isEmpty()) field.requestFocus() else onSend?.invoke(t)
    }

    init {
        orientation = HORIZONTAL
        gravity = Gravity.BOTTOM
        addView(field, LayoutParams(0, -2, 1f))
        addView(sendBtn, LayoutParams(-2, ui.dp(44)).apply { marginStart = ui.dp(8) })
    }

    /** 올린 뒤 — 칸을 비우고 키보드를 내린다. */
    fun clear() {
        field.setText("")
        field.clearFocus()
        (context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager)?.hideSoftInputFromWindow(windowToken, 0)
    }
}
