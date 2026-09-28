package com.kkakkung.app.nativev2

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView

/*
 * **쓰는 화면의 뼈대** — 아이폰 `FormScreen.swift`(`FormScreenController`)를 코틀린으로 옮긴 것.
 * 공지 쓰기·모집 열기·투표 만들기·프로필 수정·정산 만들기가 같이 쓴다.
 *
 *  - 본문은 굴러가는 카드 기둥(`stack`)이고, **저장 단추는 아래 붙박이 바**다(웹 `.form-actions`).
 *    화면이 `adjustResize`라 키보드가 올라오면 바가 그 위로 따라 올라간다.
 *  - **글칸이 아닌 데를 누르면 키보드를 내린다**(`scrollStack`이 맡는다).
 *  - **한 번 그린 폼은 다시 받지 않는다**(`built`) — 적던 글이 날아가면 안 된다.
 */
abstract class FormScreen(ctx: Context, host: ScreenHost, title: String) : NativeScreen(ctx, host, title) {
    val scroll: ScrollView
    val stack: LinearLayout
    private val saveBar = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(AppSkin.bg) }
    val saveBtn: TextView = ui.label("저장", 16f, bold = true, color = Color.WHITE).apply {
        gravity = Gravity.CENTER
        isClickable = true
        setOnClickListener { if (!saving) save() }
    }
    var built = false
    var saving = false

    init {
        val column = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        val (s, st) = scrollStack(); scroll = s; stack = st
        column.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        saveBar.addView(View(ctx).apply { setBackgroundColor(AppSkin.line) }, LinearLayout.LayoutParams(-1, ui.dp(1)))
        saveBar.addView(saveBtn, LinearLayout.LayoutParams(-1, ui.dp(48)).apply {
            setMargins(ui.dp(16), ui.dp(10), ui.dp(16), ui.dp(10))
        })
        column.addView(saveBar, LinearLayout.LayoutParams(-1, -2))
        body.addView(column, 0, FrameLayout.LayoutParams(-1, -1))
        scroll.visibility = View.GONE
        saveBar.visibility = View.GONE
    }

    abstract fun save()

    /** 저장 단추 글자 — 도는 동안은 `저장 중…`이고 눌리지 않는다. */
    fun setSave(title: String, busy: Boolean) {
        saving = busy
        saveBtn.text = if (busy) "저장 중…" else title
        saveBtn.setTextColor(if (busy) AppSkin.faint else Color.WHITE)
        saveBtn.background = ui.rounded(if (busy) AppSkin.surface2 else AppSkin.brand, AppSkin.radiusSm)
    }

    /** 다 받았다 — 본문과 바를 내보인다. */
    fun showForm(saveTitle: String) {
        spinner.visibility = View.GONE
        scroll.visibility = View.VISIBLE
        saveBar.visibility = View.VISIBLE
        setSave(saveTitle, false)
    }

    /** 못 쓰는 사람에게 — 빨간 안내 카드 하나만(웹 `.notice danger`). */
    fun showNotice(text: String) {
        spinner.visibility = View.GONE
        stack.removeAllViews()
        stack.addView(ui.label(text, 15f, bold = true, color = AppSkin.danger, lines = 0).apply {
            background = ui.rounded(AppSkin.alpha(AppSkin.danger, .08f), AppSkin.radiusSm)
            setPadding(ui.dp(14), ui.dp(12), ui.dp(14), ui.dp(12))
        })
        scroll.visibility = View.VISIBLE
        saveBar.visibility = View.GONE
    }

    // ── 칸 만들기 ────────────────────────────────────────────────

    /** 이름 + 칸 한 벌(웹 `.field` — 이름은 작고 굵은 흐린 글자). */
    fun field(name: String, input: View, note: String? = null): View = ui.vstack(6).apply {
        addView(ui.label(name, 13f, bold = true, color = AppSkin.dim))
        addView(input)
        if (note != null) addView(ui.label(note, 12f, color = AppSkin.faint, lines = 0))
    }

    /** 카드 한 장에 칸들을 담는다. */
    fun card(views: List<View>, spacing: Int = 14): LinearLayout {
        val c = ui.vstack(spacing).apply {
            background = ui.rounded(AppSkin.surface, AppSkin.radius, AppSkin.line)
            setPadding(ui.dp(14), ui.dp(11), ui.dp(14), ui.dp(11))
        }
        views.forEach { c.addView(it) }
        stack.addView(c)
        return c
    }

    fun switchRow(title: String, desc: String?, on: Boolean): Pair<View, Switch> = appSwitchRow(ui, title, desc, on)

    /** 한 줄 칸(웹 `.input` — 16 · 44 높이 · 흰 바탕 · 가는 테두리). `max`는 글자 수 한도. */
    fun textField(hint: String = "", max: Int = 0, type: Int = InputType.TYPE_CLASS_TEXT): EditText = formText(ui, hint, max, type)

    /** 여러 줄 칸(웹 `.textarea`) — 적은 만큼 자라고, 한도에서 자른다. */
    fun textArea(minH: Int, max: Int = 0, hint: String = ""): EditText = formText(ui, hint, max,
        InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES).apply {
        isSingleLine = false
        minHeight = ui.dp(minH)
        gravity = Gravity.TOP or Gravity.START
        setPadding(ui.dp(13), ui.dp(11), ui.dp(13), ui.dp(11))
    }

    fun text(e: EditText): String = e.text.toString().trim()
}

/** 한 줄 칸 — 쓰는 화면들과 명단 찾기가 같이 쓴다. */
fun formText(ui: Ui, hint: String, max: Int, type: Int): EditText = EditText(ui.ctx).apply {
    setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
    setTextColor(AppSkin.text)
    setHintTextColor(AppSkin.faint)
    this.hint = hint
    background = ui.rounded(AppSkin.surface, AppSkin.radiusSm, AppSkin.line)
    setPadding(ui.dp(13), 0, ui.dp(13), 0)
    inputType = type
    isSingleLine = type and InputType.TYPE_TEXT_FLAG_MULTI_LINE == 0
    minHeight = ui.dp(44)
    /* 한도는 조합이 끝난 뒤에 자른다 — `InputFilter.LengthFilter`는 조합 중인 한글을 깨뜨린다. */
    if (max > 0) addTextChangedListener(object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        override fun afterTextChanged(s: Editable) {
            if (s.length > max && android.view.inputmethod.BaseInputConnection.getComposingSpanStart(s) < 0) s.delete(max, s.length)
        }
    })
    layoutParams = LinearLayout.LayoutParams(-1, -2)
}

/** 켜고 끄는 줄(웹 `.switch-row` — 켜지면 분홍). 아이폰 `appSwitchRow`. */
fun appSwitchRow(ui: Ui, title: String, desc: String?, on: Boolean): Pair<View, Switch> {
    val sw = Switch(ui.ctx).apply {
        isChecked = on
        contentDescription = title
        val states = arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf())
        thumbTintList = ColorStateList(states, intArrayOf(Color.WHITE, Color.WHITE))
        trackTintList = ColorStateList(states, intArrayOf(AppSkin.brand, AppSkin.line))
    }
    val texts = ui.vstack(2)
    texts.addView(ui.label(title, 15f, bold = true))
    if (desc != null) texts.addView(ui.label(desc, 12f, color = AppSkin.faint, lines = 0))
    val row = LinearLayout(ui.ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        addView(texts, LinearLayout.LayoutParams(0, -2, 1f))
        addView(sw, LinearLayout.LayoutParams(-2, -2).apply { marginStart = ui.dp(12) })
    }
    return row to sw
}

/**
 * 둘 중 하나를 고르는 칸(아이폰 `OptButton`) — 켜지면 분홍 테두리·옅은 분홍 바탕에
 * 잔디색 `✓` 네모. 높이 44.
 */
class OptButton(private val ui: Ui, title: String) : LinearLayout(ui.ctx) {
    private val box = ui.label("", 12f, bold = true, color = Color.WHITE).apply { gravity = Gravity.CENTER }
    private val label = ui.label(title, 15f, bold = true)
    var on = false
        set(v) { field = v; paint() }

    init {
        orientation = HORIZONTAL
        gravity = Gravity.CENTER
        minimumHeight = ui.dp(44)
        isClickable = true
        contentDescription = title
        addView(box, LayoutParams(ui.dp(18), ui.dp(18)))
        addView(label, LayoutParams(-2, -2).apply { marginStart = ui.dp(8) })
        paint()
    }

    private fun paint() {
        background = ui.rounded(if (on) AppSkin.alpha(AppSkin.brand, .1f) else AppSkin.surface, AppSkin.radiusSm,
            if (on) AppSkin.brandDeep else AppSkin.line)
        label.setTextColor(if (on) AppSkin.text else AppSkin.dim)
        box.text = if (on) "✓" else ""
        box.background = ui.rounded(if (on) AppSkin.grass else Color.TRANSPARENT, 5, if (on) AppSkin.grass else AppSkin.faint, 2)
    }
}

/** 같은 폭으로 둘(또는 여럿)을 나란히 — 아이폰 `fillEqually` 줄. */
fun equalRow(ui: Ui, views: List<View>, spacing: Int = 8): LinearLayout = LinearLayout(ui.ctx).apply {
    orientation = LinearLayout.HORIZONTAL
    views.forEachIndexed { i, v -> addView(v, LinearLayout.LayoutParams(0, -2, 1f).apply { if (i > 0) marginStart = ui.dp(spacing) }) }
}


/**
 * 금액 칸(아이폰 `WonTextField` · 웹 `WonField`) — 치는 대로 `100,000`으로 보이고 오른쪽에 `원`.
 * 값은 숫자뿐이다(`won`). 커서는 **앞에 숫자가 몇 개였나**로 되돌린다 — 글자 수로 세면 쉼표가
 * 하나 늘 때마다 한 칸씩 밀린다.
 */
class WonField(ui: Ui) : FrameLayout(ui.ctx) {
    val edit = EditText(ui.ctx).apply {
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
        setTextColor(AppSkin.text)
        background = ui.rounded(AppSkin.surface, AppSkin.radiusSm, AppSkin.line)
        gravity = Gravity.CENTER_VERTICAL or Gravity.END
        setPadding(ui.dp(13), 0, ui.dp(32), 0)
        inputType = InputType.TYPE_CLASS_NUMBER
        /* `isSingleLine`은 가로로 굴리는 칸이라 오른쪽 맞춤이 처음에 안 보이는 기기가 있다. */
        maxLines = 1; setHorizontallyScrolling(false)
        minHeight = ui.dp(44)
    }
    val won: Int get() = edit.text.filter { it.isDigit() }.toString().toIntOrNull() ?: 0
    private var busy = false

    init {
        addView(edit, LayoutParams(-1, ui.dp(44)))
        addView(ui.label("원", 16f, color = AppSkin.dim), LayoutParams(-2, -2, Gravity.CENTER_VERTICAL or Gravity.END).apply { marginEnd = ui.dp(13) })
        edit.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: Editable) {
                if (busy) return
                val raw = s.toString()
                val caret = edit.selectionEnd.coerceIn(0, raw.length)
                val before = raw.take(caret).count { it.isDigit() }
                val digits = raw.filter { it.isDigit() }.dropWhile { it == '0' }.take(9)
                val out = if (digits.isEmpty()) (if (raw.contains('0')) "0" else "") else group(digits.toInt())
                if (out == raw) return
                busy = true
                edit.setText(out)
                var seen = 0; var pos = 0
                for (ch in out) { if (seen >= before) break; pos++; if (ch.isDigit()) seen++ }
                edit.setSelection(pos.coerceAtMost(out.length))
                busy = false
            }
        })
    }

    fun setWon(n: Int) { edit.setText(group(n)) }

    companion object { fun group(n: Int): String = java.text.NumberFormat.getNumberInstance(java.util.Locale.KOREA).format(n) }
}
