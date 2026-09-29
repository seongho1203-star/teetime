package com.kkakkung.app.nativev2

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.GridLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.io.ByteArrayOutputStream

/*
 * **커스텀 프로필 만들기** — 아이폰 `AvatarMakerViewController`(카톡의 그 화면 · 사용자 요청 —
 * 카톡 프사가 가입할 때 저절로 딸려 오는데 그게 싫은 사람이 있다).
 * 색 바탕에 **닉네임 글자**나 **이모티콘**을 얹은 그림을 앱이 그려서 **보통 프로필 사진과 똑같이**
 * 올린다(`uploadAvatar`). 새 칸도 SQL도 없다.
 *
 * **그리는 규칙(`AvatarArt`)은 아이폰과 값이 같아야 한다** — 색 · 이모티콘 목록 · 글자 자리.
 */
object AvatarArt {
    /** 바탕색 열둘 — 첫째가 카톡 사진의 그 라벤더다. */
    val colors = listOf("#b088c8", "#e85d9a", "#f29a76", "#f6c343", "#7cb342", "#4db6ac",
        "#5aa9e6", "#3f5ba9", "#8d6e63", "#9e9e9e", "#2b2b2b", "#f5f1e8")
    /** 이모티콘 스물넷 — 맨 앞의 빈 글자가 `없음`이다. */
    val emojis = listOf("", "⛳", "🏌️", "🏆", "🎯", "😎", "😀", "😆", "🥰", "🤩", "😇", "🤔",
        "🐻", "🐶", "🐱", "🐰", "🦊", "🐼", "🐧", "🌸", "🌿", "☀️", "🍺", "☕")
    const val MAX_TEXT = 8

    data class Spec(var color: String = colors[0], var text: String = "", var showText: Boolean = true,
                    var bold: Boolean = false, var emoji: String = "")

    /** 바탕이 밝으면 먹색 글자, 아니면 흰 글자. */
    fun ink(hex: String): Int {
        val c = Color.parseColor(hex)
        val l = (0.299 * Color.red(c) + 0.587 * Color.green(c) + 0.114 * Color.blue(c)) / 255
        return if (l > 0.72) AppSkin.text else Color.WHITE
    }

    /** 글자만 — 폭 80% · 높이 34% / 이모티콘만 — 56% / 둘 다 — 이모티콘 42%(가운데 40%) + 글자 폭 78% · 높이 16%(가운데 76%). */
    fun render(s: Spec, side: Int): Bitmap {
        val bmp = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val f = side.toFloat()
        c.drawColor(Color.parseColor(s.color))
        val text = if (s.showText) s.text.trim().take(MAX_TEXT) else ""
        val hasEmoji = s.emoji.isNotEmpty()
        if (hasEmoji) {
            val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER; textSize = f * if (text.isEmpty()) .56f else .42f }
            drawCentered(c, s.emoji, p, f / 2, f * if (text.isEmpty()) .5f else .40f)
        }
        if (text.isNotEmpty()) {
            val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                textAlign = Paint.Align.CENTER
                color = ink(s.color)
                typeface = if (s.bold) Typeface.DEFAULT_BOLD else Typeface.create("sans-serif-medium", Typeface.NORMAL)
                textSize = 100f
            }
            val maxW = f * if (hasEmoji) .78f else .80f
            val maxH = f * if (hasEmoji) .16f else .34f
            p.textSize = minOf(maxH, 100f * maxW / maxOf(p.measureText(text), 1f))
            drawCentered(c, text, p, f / 2, f * if (hasEmoji) .76f else .5f)
        }
        return bmp
    }

    private fun drawCentered(c: Canvas, t: String, p: Paint, x: Float, y: Float) {
        val fm = p.fontMetrics
        c.drawText(t, x, y - (fm.ascent + fm.descent) / 2, p)
    }

    /** 400px JPEG — 사진으로 바꿀 때와 같은 크기다. */
    fun jpeg(s: Spec): ByteArray = ByteArrayOutputStream().also { render(s, 400).compress(Bitmap.CompressFormat.JPEG, 90, it) }.toByteArray()
}

class AvatarMakerScreen(ctx: Context, host: ScreenHost, name: String) : NativeScreen(ctx, host, "커스텀 프로필 만들기") {
    private enum class Panel { EMOJI, COLOR, TEXT }

    private val spec = AvatarArt.Spec(text = name.take(AvatarArt.MAX_TEXT), showText = name.isNotBlank())
    private var panel = Panel.COLOR
    private val preview = ImageView(ctx).apply {
        scaleType = ImageView.ScaleType.FIT_XY
        contentDescription = "미리보기"
    }
    private val panelBox = ui.vstack(0)
    private val tools = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
    private val field = EditText(ctx).apply {
        setText(spec.text)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
        setTextColor(AppSkin.text)
        hint = "적을 글자"
        isSingleLine = true
        imeOptions = EditorInfo.IME_ACTION_DONE
        inputType = InputType.TYPE_CLASS_TEXT
        background = ui.rounded(AppSkin.surface2, 12)
        setPadding(ui.dp(12), 0, ui.dp(12), 0)
    }
    private var saving = false

    init {
        header.visibility = View.GONE
        root.setBackgroundColor(AppSkin.surface)
        val column = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }

        /* 머리 — 왼쪽 `✕` · 가운데 제목 · 오른쪽 `확인`(둘 다 테두리 둥근 단추). */
        val top = FrameLayout(ctx)
        top.addView(pill("✕", 20f) { hideKeyboard(); host.back() }.apply { contentDescription = "닫기" },
            FrameLayout.LayoutParams(ui.dp(44), ui.dp(44), Gravity.START or Gravity.CENTER_VERTICAL).apply { marginStart = ui.dp(12) })
        top.addView(ui.label("커스텀 프로필 만들기", 17f, bold = true),
            FrameLayout.LayoutParams(-2, -2, Gravity.CENTER))
        top.addView(pill("확인", 16f) { save() }.apply { setPadding(ui.dp(16), 0, ui.dp(16), 0) },
            FrameLayout.LayoutParams(-2, ui.dp(44), Gravity.END or Gravity.CENTER_VERTICAL).apply { marginEnd = ui.dp(12) })
        column.addView(top, LinearLayout.LayoutParams(-1, ui.dp(60)))

        val sw = ctx.resources.displayMetrics.widthPixels
        val side = (sw * .64f).toInt()
        column.addView(preview, LinearLayout.LayoutParams(side, side).apply {
            gravity = Gravity.CENTER_HORIZONTAL; topMargin = ui.dp(12); bottomMargin = ui.dp(16)
        })

        val scroll = ScrollView(ctx).apply {
            addView(panelBox, FrameLayout.LayoutParams(-1, -2))
            panelBox.setPadding(0, 0, 0, ui.dp(90))
        }
        column.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        body.addView(column, FrameLayout.LayoutParams(-1, -1))

        /* 아래에 떠 있는 알약 도구 — 이모티콘 · 색 · `Aa`. */
        tools.background = ui.rounded(AppSkin.surface, 28, AppSkin.line)
        tools.elevation = ui.dpf(4f)
        body.addView(tools, FrameLayout.LayoutParams(ui.dp(240), ui.dp(56), Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply {
            bottomMargin = ui.dp(16)
        })

        field.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, st: Int, c: Int, a: Int) {}
            override fun onTextChanged(s: CharSequence?, st: Int, b: Int, c: Int) {}
            override fun afterTextChanged(e: Editable?) {
                val t = e?.toString().orEmpty()
                if (t.length > AvatarArt.MAX_TEXT) { e?.delete(AvatarArt.MAX_TEXT, t.length); return }
                spec.text = t
                if (t.isNotEmpty() && !spec.showText) { spec.showText = true; if (panel == Panel.TEXT) showPanel() }
                redraw()
            }
        })
        field.setOnEditorActionListener { _, _, _ -> hideKeyboard(); true }

        buildTools(); showPanel(); redraw()
    }

    override fun load() {}

    private fun pill(t: String, size: Float, click: () -> Unit) = ui.label(t, size, bold = true).apply {
        gravity = Gravity.CENTER
        background = ui.rounded(AppSkin.surface, 22, AppSkin.line)
        isClickable = true
        setOnClickListener { click() }
        ui.pressable(this)
    }

    /** 미리보기는 얼굴과 같은 둥근 네모로 잘라 보인다(모서리 = 크기 × 10/29). 올리는 그림은 네모 그대로다. */
    private fun redraw() {
        val src = AvatarArt.render(spec, 480)
        val out = Bitmap.createBitmap(480, 480, Bitmap.Config.ARGB_8888)
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { shader = android.graphics.BitmapShader(src, android.graphics.Shader.TileMode.CLAMP, android.graphics.Shader.TileMode.CLAMP) }
        val r = 480f * 10f / 29f
        Canvas(out).drawRoundRect(0f, 0f, 480f, 480f, r, r, p)
        preview.setImageBitmap(out)
    }

    /** 판 고르기 — 도구를 누른 것과 같다(스크린샷 시험이 판마다 찍으려고 부른다). */
    fun tab(i: Int) { panel = Panel.values()[i]; buildTools(); showPanel() }

    private fun buildTools() {
        tools.removeAllViews()
        for (p in Panel.values()) {
            val on = panel == p
            val cell = FrameLayout(ctx).apply {
                isClickable = true
                setOnClickListener { panel = p; hideKeyboard(); buildTools(); showPanel() }
            }
            when (p) {
                Panel.EMOJI -> cell.addView(ui.label("☺", 26f, bold = true, color = if (on) AppSkin.text else AppSkin.faint).apply {
                    gravity = Gravity.CENTER; contentDescription = "이모티콘"
                }, FrameLayout.LayoutParams(-1, -1))
                Panel.COLOR -> cell.addView(View(ctx).apply {
                    contentDescription = "색"
                    background = GradientDrawable().apply {
                        shape = GradientDrawable.OVAL; setColor(Color.parseColor(spec.color))
                        setStroke(ui.dp(if (on) 3 else 1), if (on) AppSkin.text else AppSkin.line)
                    }
                }, FrameLayout.LayoutParams(ui.dp(28), ui.dp(28), Gravity.CENTER))
                Panel.TEXT -> cell.addView(ui.label("Aa", 17f, bold = true, color = if (on) Color.WHITE else AppSkin.faint).apply {
                    gravity = Gravity.CENTER; contentDescription = "글자"
                    if (on) background = ui.rounded(AppSkin.text, 6)
                }, FrameLayout.LayoutParams(ui.dp(34), ui.dp(30), Gravity.CENTER))
            }
            tools.addView(cell, LinearLayout.LayoutParams(0, -1, 1f))
        }
    }

    private fun showPanel() {
        panelBox.removeAllViews()
        when (panel) {
            Panel.EMOJI -> panelBox.addView(grid(AvatarArt.emojis.size, ::emojiCell))
            Panel.COLOR -> panelBox.addView(grid(AvatarArt.colors.size, ::colorCell))
            Panel.TEXT -> textPanel()
        }
    }

    /** 여섯 칸씩 한 줄(아이폰 `grid`) — 칸 높이 48 · 사이 10. */
    private fun grid(count: Int, cell: (Int) -> View): View = GridLayout(ctx).apply {
        columnCount = 6
        setPadding(ui.dp(15), ui.dp(4), ui.dp(15), ui.dp(4))
        for (i in 0 until count) {
            addView(cell(i), GridLayout.LayoutParams(
                GridLayout.spec(GridLayout.UNDEFINED, GridLayout.FILL),
                GridLayout.spec(GridLayout.UNDEFINED, GridLayout.FILL, 1f),
            ).apply { width = 0; height = ui.dp(48); setMargins(ui.dp(5), ui.dp(5), ui.dp(5), ui.dp(5)) })
        }
    }

    private fun colorCell(i: Int): View {
        val hex = AvatarArt.colors[i]
        val cell = FrameLayout(ctx).apply {
            isClickable = true
            contentDescription = "색 ${i + 1}"
            setOnClickListener { spec.color = hex; redraw(); buildTools(); showPanel() }
        }
        cell.addView(TextView(ctx).apply {
            text = if (hex == spec.color) "✓" else ""
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(AvatarArt.ink(hex))
            gravity = Gravity.CENTER
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.parseColor(hex)); setStroke(ui.dp(1), AppSkin.line) }
        }, FrameLayout.LayoutParams(ui.dp(40), ui.dp(40), Gravity.CENTER))
        return cell
    }

    private fun emojiCell(i: Int): View {
        val e = AvatarArt.emojis[i]
        val on = e == spec.emoji
        return ui.label(if (e.isEmpty()) "없음" else e, if (e.isEmpty()) 13f else 28f, bold = e.isEmpty(),
            color = if (e.isEmpty()) AppSkin.faint else AppSkin.text).apply {
            gravity = Gravity.CENTER
            contentDescription = if (e.isEmpty()) "이모티콘 없음" else e
            if (on) background = ui.rounded(AppSkin.alpha(AppSkin.brand, .08f), 12, AppSkin.brand, 2)
            isClickable = true
            setOnClickListener { spec.emoji = e; redraw(); showPanel() }
        }
    }

    private fun textPanel() {
        val (_, sw) = appSwitchRow(ui, "텍스트 적용", null, spec.showText)
        (sw.parent as? android.view.ViewGroup)?.removeView(sw)
        sw.setOnCheckedChangeListener { _, on -> spec.showText = on; redraw() }
        panelBox.addView(row(ui.label("텍스트 적용", 16f), sw))
        panelBox.addView(FrameLayout(ctx).apply {
            (field.parent as? android.view.ViewGroup)?.removeView(field)
            addView(field, FrameLayout.LayoutParams(-1, ui.dp(44)).apply {
                setMargins(ui.dp(20), ui.dp(4), ui.dp(20), ui.dp(8))
            })
        })
        for ((bold, name) in listOf(false to "기본 글씨체", true to "굵은 글씨체")) {
            val on = spec.bold == bold
            val dot = View(ctx).apply {
                background = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL
                    if (on) { setColor(Color.WHITE); setStroke(ui.dp(7), AppSkin.brand) } else { setColor(Color.TRANSPARENT); setStroke(ui.dp(2), AppSkin.line) }
                }
                layoutParams = FrameLayout.LayoutParams(ui.dp(24), ui.dp(24))
            }
            val label = ui.label(name, 16f, bold = bold).apply {
                if (!bold) typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            }
            panelBox.addView(row(label, dot).apply {
                isClickable = true
                contentDescription = name
                setOnClickListener { spec.bold = bold; redraw(); showPanel() }
            })
        }
    }

    /** 카톡 판의 한 줄 — 왼쪽 글자 · 오른쪽 조각 · 아래 가는 선 · 높이 58. */
    private fun row(left: View, right: View): FrameLayout = FrameLayout(ctx).apply {
        addView(left, FrameLayout.LayoutParams(-2, -2, Gravity.START or Gravity.CENTER_VERTICAL).apply { marginStart = ui.dp(20) })
        addView(right, FrameLayout.LayoutParams(right.layoutParams?.width ?: -2, right.layoutParams?.height ?: -2,
            Gravity.END or Gravity.CENTER_VERTICAL).apply { marginEnd = ui.dp(20) })
        addView(View(ctx).apply { setBackgroundColor(AppSkin.line) }, FrameLayout.LayoutParams(-1, 1, Gravity.BOTTOM))
        layoutParams = LinearLayout.LayoutParams(-1, ui.dp(58))
    }

    private fun save() {
        if (saving) return
        hideKeyboard()
        saving = true
        flash("올리는 중…")
        launch {
            try {
                val bytes = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) { AvatarArt.jpeg(spec) }
                api.uploadAvatar(bytes)
                host.back(refreshBehind = true)
            } catch (e: Exception) {
                saving = false
                flash(e.message ?: "프로필을 저장하지 못했습니다.", error = true)
            }
        }
    }
}
