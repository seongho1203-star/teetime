package com.kkakkung.app.nativev2

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.AbsoluteSizeSpan
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject

/*
 * **앱 사용자 가이드** — 아이폰 `HelpViewController.swift`를 코틀린으로 옮긴 것이다.
 *
 * **글은 여기 없다.** `src/lib/guide.ts` 한 곳에만 있고, 빌드 때 `.dev/native-guide.mjs`가
 * `assets/guide.json`으로 뽑아 담는다 — **Kotlin에 글을 적지 말 것.**
 * 표시는 둘뿐이다 — `**굵게**`·`((곁말))`(웹 `Rich` · 아이폰 `GuideText`와 같은 규칙).
 * `webOnly`인 단계(홈 화면에 추가)는 앱에서는 뺀다.
 */
class HelpScreen(ctx: Context, host: ScreenHost, text: String? = null) : NativeScreen(ctx, host, "앱 사용자 가이드") {
    init {
        val (scroll, stack) = scrollStack()
        body.addView(scroll, 0, FrameLayout.LayoutParams(-1, -1))
        val guide = try { JSONObject(text ?: ctx.assets.open("guide.json").bufferedReader().use { it.readText() }) } catch (_: Exception) { null }
        if (guide == null) stack.addView(ui.label("가이드를 불러오지 못했습니다.", 14f, color = AppSkin.danger))
        else render(stack, guide)
    }

    override fun load() {}   // 받아 올 것이 없다 — 글은 앱에 담겨 있다

    private fun render(stack: LinearLayout, guide: JSONObject) {
        guide.strOrNull("intro")?.let { stack.addView(text(it, 15f, AppSkin.dim)) }
        for (part in guide.optJSONArray("parts").objects()) {
            val card = ui.card().apply { setPadding(ui.dp(14), ui.dp(14), ui.dp(14), ui.dp(14)) }
            val t = SpannableStringBuilder()
            fun put(s: String, size: Int, color: Int?, bold: Boolean) {
                val a = t.length; t.append(s)
                t.setSpan(AbsoluteSizeSpan(size, true), a, t.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                if (color != null) t.setSpan(ForegroundColorSpan(color), a, t.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                if (bold) t.setSpan(StyleSpan(Typeface.BOLD), a, t.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            }
            put(part.str("icon") + " ", 18, null, false)
            put("${part.optInt("n")}. ", 17, AppSkin.faint, true)
            put(part.str("title"), 17, AppSkin.text, true)
            card.addView(ui.label(t, 17f, lines = 0))
            part.strOrNull("lead")?.let { card.addView(text(it, 14f, AppSkin.dim)) }
            val items = part.optJSONArray("items")
            if (items != null) for (i in 0 until items.length()) card.addView(bullet(items.optString(i)))
            var no = 0
            for (step in part.optJSONArray("steps").objects()) {
                if (step.optBoolean("webOnly")) continue   // 홈 화면에 추가 — 앱에는 없는 단계
                no += 1
                card.addView(stepRow(no, step.str("text")))
            }
            part.strOrNull("tip")?.let {
                card.addView(text(it, 14f, AppSkin.dim).apply {
                    background = ui.rounded(AppSkin.surface2, AppSkin.radiusSm)
                    setPadding(ui.dp(11), ui.dp(9), ui.dp(11), ui.dp(9))
                })
            }
            stack.addView(card)
        }
        val foot = ui.card().apply { gravity = Gravity.CENTER_HORIZONTAL; setPadding(ui.dp(14), ui.dp(14), ui.dp(14), ui.dp(14)) }
        guide.strOrNull("foot")?.let { foot.addView(text(it, 14f, AppSkin.text).apply { gravity = Gravity.CENTER }) }
        foot.addView(ui.button("홈으로 가기") { host.open("/") }, LinearLayout.LayoutParams(-2, -2).apply { gravity = Gravity.CENTER_HORIZONTAL })
        stack.addView(foot)
    }

    private fun text(s: String, size: Float, color: Int): TextView =
        ui.label(rich(s, size.toInt(), color), size, color = color, lines = 0).apply { setLineSpacing(ui.dpf(4f), 1f) }

    /** 점 목록 한 줄 — `•` + 글(웹 `.help-list li`). */
    private fun bullet(s: String): View = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        addView(ui.label("•", 14f, color = AppSkin.dim), LinearLayout.LayoutParams(ui.dp(12), -2))
        addView(text(s, 14f, AppSkin.text), LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = ui.dp(4) })
    }

    /** 번호가 붙는 한 단계 — 분홍 동그라미 숫자(웹 `.help-step`). */
    private fun stepRow(n: Int, s: String): View = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        addView(ui.label(n.toString(), 12f, bold = true, color = Color.WHITE).apply {
            gravity = Gravity.CENTER
            background = ui.rounded(AppSkin.brand, 11)
        }, LinearLayout.LayoutParams(ui.dp(21), ui.dp(21)))
        addView(text(s, 14f, AppSkin.text), LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = ui.dp(9) })
    }

    companion object {
        private val marks = Regex("\\*\\*(.+?)\\*\\*|\\(\\((.+?)\\)\\)", RegexOption.DOT_MATCHES_ALL)

        /** `**굵게**`·`((곁말))`을 푼다 — 웹 `Rich` · 아이폰 `GuideText`와 같은 규칙. */
        fun rich(s: String, size: Int, color: Int, dim: Boolean = false): CharSequence {
            val out = SpannableStringBuilder()
            val base = if (dim) AppSkin.dim else color
            var last = 0
            fun plain(t: String) {
                val a = out.length; out.append(t)
                out.setSpan(ForegroundColorSpan(base), a, out.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            }
            for (m in marks.findAll(s)) {
                if (m.range.first > last) plain(s.substring(last, m.range.first))
                val bold = m.groups[1]
                if (bold != null) {
                    val a = out.length; out.append(bold.value)
                    out.setSpan(ForegroundColorSpan(base), a, out.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                    out.setSpan(StyleSpan(Typeface.BOLD), a, out.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                } else out.append(rich(m.groupValues[2], size, color, dim = true))
                last = m.range.last + 1
            }
            if (last < s.length) plain(s.substring(last))
            return out
        }
    }
}
