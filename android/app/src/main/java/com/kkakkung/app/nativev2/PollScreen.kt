package com.kkakkung.app.nativev2

import android.content.Context
import android.graphics.Color
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONObject

/*
 * **투표 상세** — 아이폰 `PollViewController.swift`를 코틀린으로 옮긴 것이다.
 *
 *  - 위는 **던지는 곳**(항목 — 이름은 안 적는다), 아래 탭은 **읽는 곳**
 *    (`항목별` · `멤버별` · `미참여 N`).
 *  - **익명 투표에서는 현황 카드가 통째로 없다.**
 *  - 참여 수는 **회원(대기·추방 제외)** 가운데 표를 던진 사람이다.
 *  - 끝났는가는 `closed` 칸이 아니라 `AppPoll.closed`(마감 시각까지 본다).
 *  - **마감 시각 한 줄만 빨강이다** — `9월 30일 (수) 오전 10:23 마감`. `마감` 두 글자만
 *    덩그러니 찍지 말 것(예전 안드로이드가 그랬다).
 *  - 끝났는데 결과 카드를 아직 안 남긴 투표면 `post_poll_result`를 부른다.
 */
class PollScreen(ctx: Context, host: ScreenHost, private val pollId: String) : NativeScreen(ctx, host, "투표") {
    private val scroll: ScrollView
    private val stack: LinearLayout
    private val commentInput = CommentInput(ui)

    private var poll: AppPoll? = null
    private var comments: List<AppComment> = emptyList()
    private var people: Map<String, AppProfile> = emptyMap()
    /** 현황 탭 — 0 항목별 · 1 멤버별 · 2 미참여. */
    private var statusTab = 0

    private val me get() = people[myId]
    private val isAdmin get() = AppRole.isAdmin(me?.role ?: "member")
    private val mayEdit get() = isAdmin || poll?.createdBy == myId

    init {
        val (s, st) = scrollStack(); scroll = s; stack = st
        rightButton.text = "수정"
        rightButton.setTextColor(AppSkin.text)
        rightButton.setOnClickListener { poll?.let { host.editPoll(it.raw) } }
        body.addView(scroll, 0, FrameLayout.LayoutParams(-1, -1))
        scroll.visibility = View.GONE
        commentInput.onSend = { send(it) }
    }

    override fun load() {
        if (poll == null) spinner.visibility = View.VISIBLE
        launch {
            try {
                val p = api.poll(pollId)
                comments = api.pollComments(pollId).map(::AppComment)
                people = api.people().associate { it.str("id") to AppProfile(it) }
                poll = p?.let(::AppPoll)
                render()
                if (p != null) api.announceClosedPolls(listOf(p))
            } catch (e: Exception) {
                flash(e.message ?: "불러오지 못했습니다.", error = true)
            }
            spinner.visibility = View.GONE
        }
    }

    private fun render() {
        val p = poll ?: run { scroll.visibility = View.GONE; flash("없는 투표입니다.", error = true); return }
        scroll.visibility = View.VISIBLE
        rightButton.visibility = if (mayEdit) View.VISIBLE else View.GONE
        (commentInput.parent as? android.view.ViewGroup)?.removeView(commentInput)
        stack.removeAllViews()
        val closed = p.closed
        /* 표를 던져야 할 사람 = 이 앱에 들어와 있는 사람(대기·추방은 뺀다). */
        val members = people.values.filter { it.role != "pending" && it.role != "banned" }.sortedBy { it.name }
        val voted = p.votes.map { it.userId }.toSet()
        val done = members.filter { it.id in voted }
        val yet = members.filter { it.id !in voted }

        // 머리
        val badges = mutableListOf<View>(ui.badge(if (closed) "마감" else "진행중", if (closed) Ui.Badge.DONE else Ui.Badge.LIVE))
        if (p.multi) badges.add(ui.badge("복수 선택", Ui.Badge.DIM))
        if (p.anonymous) badges.add(ui.badge("익명", Ui.Badge.DIM))
        badges.add(ui.label(AppDate.ago(p.createdAt), 12f, color = AppSkin.faint))
        val hero = ui.vstack(6).apply { setPadding(ui.dp(2), ui.dp(4), ui.dp(2), ui.dp(6)) }
        hero.addView(ui.hrow(badges))
        hero.addView(ui.label(p.title, 22f, bold = true, lines = 0))
        if (p.body.isNotEmpty()) hero.addView(ui.label(p.body, 14f, color = AppSkin.dim, lines = 0).apply { setLineSpacing(ui.dpf(6f), 1f) })
        stack.addView(hero)

        // 던지는 곳 — 항목마다 막대·✓·표 수. 이름은 안 적는다(아래 탭 몫).
        val voteCard = ui.card()
        val mine = p.votes.filter { it.userId == myId }.map { it.optionId }.toSet()
        val voters = voted.size
        for (o in p.options) {
            val n = p.count(o.id)
            val pct = if (voters > 0) n.toFloat() / voters else 0f
            val row = optionRow(o.label, n, pct, o.id in mine)
            if (!closed) row.setOnClickListener { optionTapped(o.id) } else row.alpha = .75f
            voteCard.addView(row)
        }
        val foot = mutableListOf(Triple("${done.size}명 참여 · 전체 ${members.size}명", 12f, false to AppSkin.faint))
        val c = p.closesAt
        if (c != null && !p.closedFlag) {
            foot.add(Triple(" · ", 12f, false to AppSkin.faint))
            foot.add(Triple("${AppDate.dateTime(c)} 마감", 12f, true to AppSkin.danger))
        }
        voteCard.addView(ui.label(ui.rich(*foot.toTypedArray()), 12f, lines = 2))
        stack.addView(voteCard)

        // 현황 — 익명이면 통째로 없다
        if (!p.anonymous) {
            val card = ui.card()
            card.addView(segments(listOf("항목별", "멤버별", if (yet.isEmpty()) "미참여" else "미참여 ${yet.size}")))
            when (statusTab) {
                1 -> {
                    if (done.isEmpty()) card.addView(ui.label("아직 아무도 안 했습니다.", 12f, color = AppSkin.faint))
                    for (who in done) {
                        val picks = p.options.filter { o -> p.votes.any { it.userId == who.id && it.optionId == o.id } }.map { it.label }
                        val pl = ui.label(picks.joinToString(", "), 14f, color = AppSkin.dim, lines = 0).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
                        card.addView(ui.hrow(listOf(ui.avatar(who, 24), ui.label(who.label, 14f, bold = true), pl), spacing = 8, fill = true).apply { minimumHeight = ui.dp(32) })
                    }
                }
                2 -> if (yet.isEmpty()) card.addView(ui.label("모두 표를 던졌습니다.", 12f, color = AppSkin.faint)) else card.addView(peopleGrid(yet))
                else -> for (o in p.options) {
                    val on = p.votes.filter { it.optionId == o.id }.mapNotNull { people[it.userId] }
                    val block = ui.vstack(6)
                    block.addView(ui.label(ui.rich(Triple(o.label, 14f, true to AppSkin.text), Triple(" · ${on.size}명", 14f, false to AppSkin.faint)), 14f, lines = 0))
                    block.addView(if (on.isEmpty()) ui.label("고른 사람이 없습니다.", 12f, color = AppSkin.faint) else peopleGrid(on))
                    card.addView(block)
                }
            }
            stack.addView(card)
        }

        // 댓글
        val ccard = ui.card()
        ccard.addView(ui.sectionTitle("댓글 ${comments.size}"))
        if (comments.isEmpty()) ccard.addView(ui.label("아직 댓글이 없습니다.", 12f, color = AppSkin.faint))
        val clist = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        comments.forEachIndexed { i, cm ->
            clist.addView(commentRow(ui, cm, cm.authorId?.let { people[it] }, isAdmin || cm.authorId == myId, i == 0) { deleteComment(cm) })
        }
        ccard.addView(clist)
        ccard.addView(commentInput, LinearLayout.LayoutParams(-1, -2).apply { topMargin = ui.dp(10) })
        stack.addView(ccard)

        // 운영 — 만든 사람과 운영진
        if (mayEdit) {
            val card = ui.card()
            card.addView(ui.sectionTitle(if (isAdmin) "운영" else "내가 만든 투표"))
            card.addView(ui.hrow(listOf(
                ui.button(if (closed) "다시 열기" else "마감") { toggleTapped() },
                ui.button("지우기", AppSkin.danger, filled = true) { deleteTapped() }
            ), spacing = 8))
            stack.addView(card)
        }
    }

    /** 항목 한 줄 — 옅은 바탕 위에 표 비율만큼 잔디 막대 · ✓ · 이름 · 표 수(아이폰 `OptionRow`). */
    private fun optionRow(label: String, count: Int, pct: Float, chosen: Boolean): View {
        /* 막대는 바탕 그림 한 장에 겹쳐 그린다 — 뷰로 세우면 높이 셈이 흔들린다(재서 확인했다). */
        val bar = android.graphics.drawable.ClipDrawable(ui.rounded(AppSkin.alpha(AppSkin.grass, .22f), AppSkin.radiusSm), Gravity.START, android.graphics.drawable.ClipDrawable.HORIZONTAL)
        bar.level = (pct.coerceIn(0f, 1f) * 10000).toInt()
        val layers = mutableListOf<android.graphics.drawable.Drawable>(ui.rounded(AppSkin.surface2, AppSkin.radiusSm), bar)
        if (chosen) layers.add(ui.rounded(android.graphics.Color.TRANSPARENT, AppSkin.radiusSm, AppSkin.brand, 2))
        val check = ui.label(if (chosen) "✓" else "", 14f, bold = true, color = AppSkin.brand).apply { layoutParams = LinearLayout.LayoutParams(ui.dp(16), -2) }
        val name = ui.label(label, 15f, bold = chosen).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
        val n = ui.label(count.toString(), 14f, bold = true, color = AppSkin.dim)
        val row = ui.hrow(listOf(check, name, n), spacing = 6, fill = true).apply {
            background = android.graphics.drawable.LayerDrawable(layers.toTypedArray())
            setPadding(ui.dp(10), ui.dp(9), ui.dp(10), ui.dp(9))
            minimumHeight = ui.dp(40)
            isClickable = true
        }
        ui.pressable(row)
        return row
    }

    /** 탭 셋 — 옅은 판 위에 고른 것만 흰 알약(아이폰 `UISegmentedControl`). */
    private fun segments(titles: List<String>): View {
        val track = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            background = ui.rounded(AppSkin.surface2, 9)
            setPadding(ui.dp(2), ui.dp(2), ui.dp(2), ui.dp(2))
        }
        titles.forEachIndexed { i, t ->
            val on = i == statusTab
            val b = TextView(ctx).apply {
                text = t
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                typeface = if (on) android.graphics.Typeface.DEFAULT_BOLD else android.graphics.Typeface.DEFAULT
                setTextColor(AppSkin.text)
                gravity = Gravity.CENTER
                maxLines = 1
                if (on) { background = ui.rounded(Color.WHITE, 7); elevation = ui.dpf(1f) }
                isClickable = true
                setOnClickListener { if (statusTab != i) { statusTab = i; render() } }
            }
            track.addView(b, LinearLayout.LayoutParams(0, ui.dp(30), 1f))
        }
        return track
    }

    /** 얼굴 + 이름표를 **두 칸씩** 늘어놓는다(웹 `PeopleGrid`). */
    private fun peopleGrid(list: List<AppProfile>): View {
        val grid = ui.vstack(4)
        for (i in list.indices step 2) {
            val row = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }
            for (j in i until minOf(i + 2, list.size)) {
                val p = list[j]
                row.addView(ui.hrow(listOf(ui.avatar(p, 24), ui.label(p.label, 13f)), spacing = 6), LinearLayout.LayoutParams(0, -2, 1f).apply { if (j > i) marginStart = ui.dp(8) })
            }
            if (list.size - i == 1) row.addView(View(ctx), LinearLayout.LayoutParams(0, 1, 1f).apply { marginStart = ui.dp(8) })
            grid.addView(row)
        }
        return grid
    }

    // ── 누르는 것들 ─────────────────────────────────────────────

    /** 표 던지기 — 고른 것을 다시 누르면 뺀다(웹 `PollOptions.pick`). */
    private fun optionTapped(optionId: String) {
        val p = poll ?: return
        if (p.closed) return
        val mine = p.votes.any { it.userId == myId && it.optionId == optionId }
        act { if (mine) api.retractVote(optionId) else api.castVote(optionId) }
    }

    private fun toggleTapped() {
        val p = poll ?: return
        val shut = p.closed
        act {
            api.setPollClosed(p, !shut)
            flash(if (shut) "다시 열었습니다. 대화방에도 알렸습니다." else "마감했습니다.")
        }
    }

    private fun deleteTapped() {
        val p = poll ?: return
        var detail = "${p.title}\n${p.votes.size}표"
        if (comments.isNotEmpty()) detail += "와 댓글 ${comments.size}개"
        detail += "가 함께 사라집니다."
        confirm("이 투표를 지울까요?", detail, "지우기", true) {
            if (busy) return@confirm
            busy = true
            launch {
                try { api.deleteRow("polls", p.id); flash("지웠습니다."); host.back(refreshBehind = true) }
                catch (e: Exception) { flash(e.message ?: "지우지 못했습니다.", error = true) }
                finally { busy = false }
            }
        }
    }

    // ── 댓글 ─────────────────────────────────────────────────────

    private fun send(text: String) {
        if (busy) return
        busy = true
        launch {
            try {
                api.addComment("poll_comments", "poll_id", pollId, text)
                commentInput.clear()
                comments = api.pollComments(pollId).map(::AppComment)
                render()
                scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
            } catch (e: Exception) {
                flash(e.message ?: "댓글을 올리지 못했습니다.", error = true)
            } finally { busy = false }
        }
    }

    private fun deleteComment(c: AppComment) {
        confirm("댓글을 지울까요?", "", "지우기", true) { act { api.deleteRow("poll_comments", c.id) } }
    }
}
