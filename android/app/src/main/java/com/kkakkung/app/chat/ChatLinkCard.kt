package com.kkakkung.app.chat

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * **대화방의 눌리는 카드(라운드·투표·공지)** — 아이폰 `ChatList.swift`의
 * `CardParts`·`cardBox`·`CardChip`을 옮긴 것이다(웹 `LinkCard`와도 한 벌).
 *
 * ```
 * [●배지] [골프존파크 상무점]        ← 곳 이름은 꽉 찬 알약
 *         9월 8일 (화)               ← 날짜가 큰 제목      (오른쪽에 흐린 그림)
 *         🕐 오전 7:30  👥 정원 6명
 * ────────────────────────────────
 * 신성호님이 스크린을 공유했습니다   [라운드 보러 가기 ›]
 * ```
 *
 *  - **줄을 세지 않고 `icon`으로 갈린다** — 라운드만 둘째 줄이 알약이고 셋째 줄을
 *    `·`로 갈라 첫 조각이 큰 제목, 나머지가 칩이다. 투표·공지는 둘째 줄이 제목.
 *  - **그림은 코드로 그린다**(`CardGlyph`) — 그림글자는 기기에 없으면 두부가 된다.
 *  - 알약은 `--grass`, 단추는 한 톤 낮춘 `--grass-deep`. **분홍을 쓰지 말 것**.
 */
class ChatLinkCard(context: Context) : FrameLayout(context) {
    data class Parts(
        val by: String, val pill: String?, val title: String,
        val chips: List<String>, val notes: List<String>, val showBy: Boolean
    )

    companion object {
        fun parse(body: String, icon: String?): Parts {
            val lines = body.split("\n").filter { it.isNotEmpty() }
            val foot = lines.firstOrNull() ?: return Parts("", null, "", emptyList(), emptyList(), false)
            val rest = lines.drop(1)
            if (icon == "round" && rest.size >= 2) {
                val segs = rest.drop(1).joinToString(" · ").split("·").map { it.trim() }.filter { it.isNotEmpty() }
                return Parts(foot, rest[0], segs.firstOrNull() ?: rest[0], segs.drop(1), emptyList(), true)
            }
            val t = rest.firstOrNull() ?: return Parts(foot, null, foot, emptyList(), emptyList(), false)
            return Parts(foot, null, t, emptyList(), rest.drop(1), true)
        }

        /** 곁줄 칩 앞의 그림 — 글을 보고 고른다(시각이면 시계, 사람 수면 사람, 모르면 안 붙인다). */
        fun chipGlyph(text: String): String? = when {
            Regex("오전|오후|[0-9]\\s*:\\s*[0-9]").containsMatchIn(text) -> "clock"
            Regex("정원|자리|명|인").containsMatchIn(text) -> "people"
            else -> null
        }

        fun badgeGlyph(icon: String?) = when (icon) { "round" -> "flag"; "poll" -> "check"; "post" -> "megaphone"; else -> "bell" }
        fun decoGlyph(icon: String?) = when (icon) { "round" -> "flag"; "poll" -> "bars"; "post" -> "megaphone"; else -> "bell" }
    }

    private fun dp(v: Float) = context.dp(v)
    private val dim = Color.argb((255 * .7f).toInt(), 27, 31, 25)

    private val deco = CardGlyph(context).apply { alpha = .14f; color = ChatSkin.cardBadge }
    private val badge = FrameLayout(context).apply {
        background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(ChatSkin.cardBadge) }
    }
    private val badgeGlyph = CardGlyph(context).apply { color = Color.WHITE }
    private val pill = text(ChatSkin_cardHead, true).apply {
        setTextColor(Color.WHITE); maxLines = 1; ellipsize = TextUtils.TruncateAt.END
        setPadding(dp(9f), dp(3f), dp(9f), dp(3f))
        background = GradientDrawable().apply { cornerRadius = dp(20f).toFloat(); setColor(ChatSkin.cardBadge) }
    }
    private val title = text(16f, true).apply { setTextColor(ChatSkin.text) }
    private val chips = Flow(context, dp(10f), dp(3f))
    private val notes = text(12.5f, false).apply { setTextColor(dim) }
    private val rule = View(context).apply { setBackgroundColor(ChatSkin.cardRule) }
    private val by = text(ChatSkin_cardHead, true).apply {
        setTextColor(Color.argb((255 * .55f).toInt(), 27, 31, 25)); maxLines = 2; ellipsize = TextUtils.TruncateAt.END
    }
    private val go = text(12f, true).apply {
        setTextColor(Color.WHITE); maxLines = 1; gravity = Gravity.CENTER
        setPadding(dp(12f), dp(7f), dp(12f), dp(7f))
        background = GradientDrawable().apply { cornerRadius = dp(20f).toFloat(); setColor(ChatSkin.link) }
    }
    private val foot = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }

    init {
        background = GradientDrawable().apply { cornerRadius = dp(ChatSkin.cardRadius).toFloat(); setColor(ChatSkin.cardTint) }
        elevation = dp(3f).toFloat()
        clipToOutline = true
        /* 흐린 그림 — 오른쪽 끝 · 아래에서 36 · 80×56. 글 뒤에 깔리므로 맨 먼저. */
        addView(deco, LayoutParams(dp(80f), dp(56f), Gravity.END or Gravity.BOTTOM).apply { bottomMargin = dp(36f) })
        val col = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        val pad = dp(ChatSkin.cardPad)
        col.setPadding(pad, pad, pad, pad)
        val top = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
        badge.addView(badgeGlyph, LayoutParams(dp(20f), dp(20f), Gravity.CENTER))
        top.addView(badge, LinearLayout.LayoutParams(dp(34f), dp(34f)))
        val body = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        body.addView(pill, LinearLayout.LayoutParams(-2, -2).apply { bottomMargin = dp(3f) })
        body.addView(title, LinearLayout.LayoutParams(-1, -2))
        body.addView(chips, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(4f) })
        body.addView(notes, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(3f) })
        top.addView(body, LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = dp(10f) })
        col.addView(top)
        col.addView(rule, LinearLayout.LayoutParams(-1, dp(1f)).apply { topMargin = dp(11f) })
        foot.addView(by, LinearLayout.LayoutParams(0, -2, 1f))
        foot.addView(go, LinearLayout.LayoutParams(-2, -2).apply { marginStart = dp(8f) })
        col.addView(foot, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(9f) })
        addView(col, LayoutParams(-1, -2))
    }

    fun bind(body: String, icon: String?, goLabel: String?) {
        val p = parse(body, icon)
        badgeGlyph.kind = badgeGlyph(icon)
        deco.kind = decoGlyph(icon)
        pill.visibility = if (p.pill == null) View.GONE else View.VISIBLE
        pill.text = p.pill ?: ""
        title.text = p.title
        chips.removeAllViews()
        chips.visibility = if (p.chips.isEmpty()) View.GONE else View.VISIBLE
        for (c in p.chips) {
            val row = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            chipGlyph(c)?.let { g ->
                row.addView(CardGlyph(context).apply { kind = g; color = ChatSkin.link; stroke = true },
                    LinearLayout.LayoutParams(dp(13f), dp(13f)).apply { marginEnd = dp(4f) })
            }
            row.addView(text(12.5f, true).apply { text = c; setTextColor(dim); maxLines = 1 })
            chips.addView(row)
        }
        notes.visibility = if (p.notes.isEmpty()) View.GONE else View.VISIBLE
        notes.text = p.notes.joinToString("\n")
        by.visibility = if (p.showBy) View.VISIBLE else View.INVISIBLE
        by.text = p.by
        val g = goLabel.orEmpty()
        go.visibility = if (g.isEmpty()) View.GONE else View.VISIBLE
        go.text = g
    }

    private fun text(size: Float, bold: Boolean) = TextView(context).apply {
        setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
        typeface = if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
        includeFontPadding = false
        setLineSpacing(0f, 1.15f)
    }
}

/* 아이폰 `cardHead`(11.5) — 알약·`○○님이 …` 글자 크기. */
private const val ChatSkin_cardHead = 11.5f

/** 칩을 한 줄에 늘어놓다 넘치면 다음 줄로(웹의 `flex-wrap`). */
class Flow(context: Context, private val hGap: Int, private val vGap: Int) : ViewGroup(context) {
    override fun onMeasure(wSpec: Int, hSpec: Int) {
        val maxW = MeasureSpec.getSize(wSpec).let { if (it == 0) Int.MAX_VALUE else it }
        var x = 0; var y = 0; var rowH = 0; var widest = 0
        for (i in 0 until childCount) {
            val c = getChildAt(i)
            if (c.visibility == GONE) continue
            c.measure(MeasureSpec.makeMeasureSpec(maxW, MeasureSpec.AT_MOST), MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED))
            if (x > 0 && x + c.measuredWidth > maxW) { x = 0; y += rowH + vGap; rowH = 0 }
            x += c.measuredWidth + hGap
            rowH = maxOf(rowH, c.measuredHeight)
            widest = maxOf(widest, x - hGap)
        }
        setMeasuredDimension(resolveSize(widest, wSpec), y + rowH)
    }
    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        val maxW = r - l
        var x = 0; var y = 0; var rowH = 0
        for (i in 0 until childCount) {
            val c = getChildAt(i)
            if (c.visibility == GONE) continue
            if (x > 0 && x + c.measuredWidth > maxW) { x = 0; y += rowH + vGap; rowH = 0 }
            c.layout(x, y, x + c.measuredWidth, y + c.measuredHeight)
            x += c.measuredWidth + hGap
            rowH = maxOf(rowH, c.measuredHeight)
        }
    }
}

/**
 * 카드에 쓰는 작은 그림 — 아이폰의 SF Symbol 자리(깃발 · 체크 · 확성기 · 종 ·
 * 시계 · 사람 · 막대). **그림글자를 쓰지 말 것**(기기에 없으면 네모난 두부).
 * 24칸 판에 그리고 크기에 맞춰 늘인다.
 */
class CardGlyph(context: Context) : View(context) {
    var kind = "bell"; set(v) { field = v; invalidate() }
    var color = Color.WHITE; set(v) { field = v; paint.color = v; invalidate() }
    /** 선으로만 그린다(칩의 시계·사람). */
    var stroke = false; set(v) { field = v; invalidate() }
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
    private val path = Path()

    override fun onDraw(canvas: Canvas) {
        val s = minOf(width, height) / 24f
        canvas.save()
        canvas.translate((width - 24 * s) / 2, (height - 24 * s) / 2)
        canvas.scale(s, s)
        paint.style = if (stroke) Paint.Style.STROKE else Paint.Style.FILL
        paint.strokeWidth = 2.2f
        path.reset()
        when (kind) {
            "flag" -> {
                paint.style = Paint.Style.FILL
                path.moveTo(6f, 3f); path.lineTo(19f, 7.5f); path.lineTo(6f, 12f); path.close()
                canvas.drawPath(path, paint)
                canvas.drawRoundRect(RectF(5f, 3f, 7f, 21f), 1f, 1f, paint)
            }
            "check" -> {
                paint.style = Paint.Style.FILL
                canvas.drawRoundRect(RectF(3f, 3f, 21f, 21f), 4f, 4f, paint)
                val p2 = Paint(paint).apply { style = Paint.Style.STROKE; strokeWidth = 2.6f; color = ChatSkin.cardBadge }
                path.moveTo(7f, 12.5f); path.lineTo(10.5f, 16f); path.lineTo(17f, 8.5f)
                canvas.drawPath(path, p2)
            }
            "megaphone" -> {
                paint.style = Paint.Style.FILL
                path.moveTo(3f, 9.5f); path.lineTo(8f, 9.5f); path.lineTo(18f, 4f); path.lineTo(18f, 20f); path.lineTo(8f, 14.5f); path.lineTo(3f, 14.5f); path.close()
                canvas.drawPath(path, paint)
                canvas.drawRoundRect(RectF(6.5f, 14f, 10f, 20.5f), 1.5f, 1.5f, paint)
                canvas.drawRoundRect(RectF(19f, 10f, 21.5f, 14f), 1f, 1f, paint)
            }
            "bars" -> {
                paint.style = Paint.Style.FILL
                canvas.drawRoundRect(RectF(4f, 12f, 8f, 21f), 1f, 1f, paint)
                canvas.drawRoundRect(RectF(10f, 5f, 14f, 21f), 1f, 1f, paint)
                canvas.drawRoundRect(RectF(16f, 9f, 20f, 21f), 1f, 1f, paint)
            }
            "clock" -> {
                paint.style = Paint.Style.STROKE
                canvas.drawCircle(12f, 12f, 9f, paint)
                path.moveTo(12f, 7f); path.lineTo(12f, 12f); path.lineTo(15.5f, 14f)
                canvas.drawPath(path, paint)
            }
            "people" -> {
                paint.style = Paint.Style.STROKE
                canvas.drawCircle(9f, 8f, 3.5f, paint)
                path.moveTo(2.5f, 20f); path.cubicTo(2.5f, 15f, 15.5f, 15f, 15.5f, 20f)
                path.moveTo(16f, 5f); path.cubicTo(19.5f, 5.5f, 19.5f, 10.5f, 16f, 11f)
                path.moveTo(18f, 14.5f); path.cubicTo(20.5f, 15.5f, 21.5f, 17.5f, 21.5f, 20f)
                canvas.drawPath(path, paint)
            }
            else -> { // bell
                paint.style = Paint.Style.FILL
                path.moveTo(12f, 3f); path.cubicTo(8f, 3f, 6f, 6f, 6f, 10f); path.lineTo(6f, 15f); path.lineTo(4f, 17f); path.lineTo(20f, 17f)
                path.lineTo(18f, 15f); path.lineTo(18f, 10f); path.cubicTo(18f, 6f, 16f, 3f, 12f, 3f); path.close()
                canvas.drawPath(path, paint)
                canvas.drawCircle(12f, 19.5f, 2f, paint)
            }
        }
        canvas.restore()
    }
}
