package com.kkakkung.app.nativev2

import android.content.Context
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
import android.widget.ScrollView
import org.json.JSONObject

/*
 * **알림함(🔔)** — 아이폰 `AlertsViewController.swift`를 코틀린으로 옮긴 것이다.
 * 규칙이 그쪽(그리고 웹 `Alerts.tsx`)과 같아야 한다 — 한쪽만 고치지 말 것.
 *
 *  - **여는 순간 다 읽음으로 찍는다.** 그래서 무엇이 안 읽은 것이었는지는 `read_at`이 아니라
 *    화면이 얼려 둔 `fresh`가 정한다 — 담기는 길이 둘(`read_at`이 빈 줄 · 방금 찍은 id)이고
 *    **id마다 한 번만 판단한다**(`judged`).
 *  - 안 읽은 줄은 흰 카드 + 왼쪽 빨간 띠 + `N`, 읽은 줄은 `surface2`에 흐린 제목.
 *    **분홍을 쓰지 말 것**(빨강이 '내가 안 본 것'이다).
 *  - 제목 앞 그림글자를 아이콘 자리로 옮긴다(`split`) — 안 옮기면 두 번 나온다.
 *  - 90일 지난 것은 이 화면을 처음 연 때 지운다. 줄을 누르면 **그 건으로** 간다.
 */
class AlertsScreen(ctx: Context, host: ScreenHost) : NativeScreen(ctx, host, "알림") {
    private val scroll: ScrollView
    private val stack: LinearLayout
    private val empty = ui.label("아직 온 알림이 없습니다\n모집·정산·조 편성 소식이 여기 쌓입니다.\n대화는 대화 탭에서 보세요.", 14f, color = AppSkin.dim, lines = 0).apply {
        gravity = Gravity.CENTER; visibility = View.GONE
    }
    private var list: List<JSONObject> = emptyList()
    private val fresh = mutableSetOf<String>()
    private val judged = mutableSetOf<String>()
    private var loaded = false

    init {
        val (s, st) = scrollStack(); scroll = s; stack = st
        body.addView(scroll, 0, FrameLayout.LayoutParams(-1, -1))
        body.addView(empty, FrameLayout.LayoutParams(-2, -2, Gravity.CENTER).apply {
            marginStart = ui.dp(24); marginEnd = ui.dp(24); bottomMargin = ui.dp(80)
        })
    }

    override fun load() {
        if (!loaded) spinner.visibility = View.VISIBLE
        launch {
            /* 읽음을 먼저 찍고 — 그 답이 곧 '열기 전까지 안 읽은 것' — 청소하고 받는다. */
            fresh.addAll(api.markNotificationsRead())
            if (!loaded) api.purgeNotifications()
            list = api.notifications()
            for (a in list) {
                val id = a.str("id")
                if (judged.add(id) && a.strOrNull("read_at") == null) fresh.add(id)
            }
            loaded = true
            spinner.visibility = View.GONE
            render()
        }
    }

    private fun render() {
        stack.removeAllViews()
        empty.visibility = if (list.isEmpty()) View.VISIBLE else View.GONE
        for (a in list) stack.addView(row(a, a.str("id") in fresh))
        if (list.isNotEmpty()) stack.addView(ui.label("90일이 지난 알림은 저절로 지워집니다", 12f, color = AppSkin.faint).apply {
            gravity = Gravity.CENTER; setPadding(0, ui.dp(12), 0, ui.dp(12))
        })
    }

    private fun row(a: JSONObject, isFresh: Boolean): View {
        val (icon, text) = split(a)
        val url = a.str("url")
        val card = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            background = ui.rounded(if (isFresh) AppSkin.surface else AppSkin.surface2, AppSkin.radius)
            clipToOutline = true
        }
        card.addView(View(ctx).apply { setBackgroundColor(if (isFresh) AppSkin.danger else 0) }, LinearLayout.LayoutParams(ui.dp(3), -1))
        val inner = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(ui.dp(10), ui.dp(13), ui.dp(13), ui.dp(13))
        }
        inner.addView(ui.label(icon, 20f).apply { alpha = if (isFresh) 1f else .55f }, LinearLayout.LayoutParams(-2, -2))
        val col = ui.vstack(2)
        val t = SpannableStringBuilder(text)
        t.setSpan(ForegroundColorSpan(if (isFresh) AppSkin.text else AppSkin.dim), 0, t.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        if (isFresh) {
            t.setSpan(StyleSpan(Typeface.BOLD), 0, t.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            /* 색만으로 가르지 않으려고 둔 작은 표 — 웹 `.alert-new`. */
            val s = t.length
            t.append("  N")
            t.setSpan(AbsoluteSizeSpan(10, true), s, t.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            t.setSpan(ForegroundColorSpan(AppSkin.danger), s, t.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            t.setSpan(StyleSpan(Typeface.BOLD), s, t.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
        col.addView(ui.label(t, 15f, bold = isFresh, lines = 0))
        val b = a.str("body")
        if (b.isNotEmpty()) col.addView(ui.label(b, 14f, color = AppSkin.dim, lines = 2))
        col.addView(ui.label(AppDate.ago(a.str("created_at")), 12f, color = AppSkin.faint),
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = ui.dp(4) })
        inner.addView(col, LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = ui.dp(10); marginEnd = ui.dp(8) })
        if (url.isNotEmpty()) inner.addView(ui.label("›", 20f, color = AppSkin.faint), LinearLayout.LayoutParams(-2, -2).apply { gravity = Gravity.CENTER_VERTICAL })
        card.addView(inner, LinearLayout.LayoutParams(0, -2, 1f))
        if (url.isNotEmpty()) {
            card.isClickable = true
            ui.pressable(card)
            /* 발송기가 실어 보내는 값 그대로다(`#/rounds/123`) — `#`만 떼고 넘긴다. */
            card.setOnClickListener {
                var path = url.removePrefix("#")
                if (!path.startsWith("/")) path = "/$path"
                host.open(path)
            }
        }
        return card
    }

    companion object {
        /** 제목에 그림글자가 없을 때 쓸 갈래별 그림 — 웹 `ALERT_ICON`·아이폰 `AppAlert.icons`와 같은 값. */
        private val icons = mapOf(
            "rounds" to "⛳", "polls" to "🗳", "posts" to "📢", "profiles" to "🙋", "signups" to "🎉",
            "round_groups" to "🚩", "round_reminders" to "⏰", "settlement_shares" to "💰", "settle_reminders" to "💰"
        )

        /** `💰 정산` → (`💰`, `정산`) — 웹 `splitAlertTitle`과 같은 규칙. */
        fun split(a: JSONObject): Pair<String, String> {
            val t = a.str("title").trim()
            val cp = t.codePointAtOrNull(0)
            if (cp != null && isPictograph(cp)) {
                val n = Character.charCount(cp)
                var i = n
                if (t.length > i && t[i] == '️') i++
                return t.substring(0, i) to t.substring(i).trim()
            }
            return (icons[a.str("kind")] ?: "🔔") to t
        }

        private fun String.codePointAtOrNull(i: Int) = if (length > i) codePointAt(i) else null
        /** 그림글자 — 잡기호(So) 가운데 이모지 자리들. `©`·`®` 같은 글자는 안 걸린다. */
        private fun isPictograph(cp: Int) = cp >= 0x1F000 || cp in 0x2600..0x27BF || cp in 0x2B00..0x2BFF || cp == 0x23F0
    }
}
