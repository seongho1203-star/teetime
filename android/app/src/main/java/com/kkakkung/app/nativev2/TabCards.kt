package com.kkakkung.app.nativev2

import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.ClipDrawable
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.LayerDrawable
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.kkakkung.app.R

/*
 * **탭 넷(홈 · 공지 · 라운드 · 투표)의 조각** — 아이폰 `HomeTab.swift`·`ShellTabs.swift`를
 * 그대로 옮긴 것이다. 크기·색·말이 거기와 같아야 한다 — **한쪽만 고치지 말 것.**
 *
 * 화면(무엇을 받아 어떤 차례로 쌓나)은 `NativeHomeActivity`의 `show…`가 하고,
 * 여기는 카드 한 장을 그리는 것만 한다(아이폰의 Cell들과 같은 몫).
 */
class TabCards(private val ui: Ui) {
    private val ctx get() = ui.ctx

    /** 카드 한 칸의 자리 — 위아래 5(아이폰 `CardCell`). 가로 16은 페이지가 준다. */
    fun place(v: View, top: Int = 5, bottom: Int = 5): View {
        v.layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = ui.dp(top); bottomMargin = ui.dp(bottom) }
        return v
    }

    private fun white(text: String, size: Float, bold: Boolean, alpha: Float = 1f, lines: Int = 1): TextView =
        ui.label(text, size, bold, AppSkin.alpha(Color.WHITE, alpha), lines)

    // ── 머리말 ─────────────────────────────────────────────────

    /** 탭 머리말(아이폰 `ShellTabController`) — 52 높이 · 제목 22 굵게 · 오른쪽 분홍 알약. */
    class TabHead(val view: View, val action: TextView?)

    fun tabHead(title: String, action: String?, click: (() -> Unit)?): TabHead {
        val box = FrameLayout(ctx).apply { setBackgroundColor(AppSkin.bg) }
        box.addView(ui.label(title, 22f, bold = true), FrameLayout.LayoutParams(-2, -2, Gravity.CENTER_VERTICAL or Gravity.START).apply { marginStart = ui.dp(16) })
        val pill = action?.let { t ->
            ui.label(t, 14f, bold = true, color = Color.WHITE).apply {
                gravity = Gravity.CENTER
                background = ui.rounded(AppSkin.brand, 17)
                setPadding(ui.dp(14), 0, ui.dp(14), 0)
                isClickable = true
                setOnClickListener { click?.invoke() }
                ui.pressable(this)
            }
        }
        if (pill != null) box.addView(pill, FrameLayout.LayoutParams(-2, ui.dp(34), Gravity.CENTER_VERTICAL or Gravity.END).apply { marginEnd = ui.dp(16) })
        box.layoutParams = LinearLayout.LayoutParams(-1, ui.dp(52))
        return TabHead(box, pill)
    }

    /**
     * 홈 머리말(아이폰 `HomeTabController`) — 76 높이.
     * `안녕하세요`(13 · 흐림)가 왼쪽 위, 그 아래 얼굴 36 + `이름님`(22 굵게),
     * 오른쪽에 🔔(44 칸)과 빨간 숫자. **얼굴만 눌린다**(→ 내 정보).
     */
    inner class HomeHead(onFace: () -> Unit, onBell: () -> Unit) {
        val view = FrameLayout(ctx).apply { setBackgroundColor(AppSkin.bg); layoutParams = LinearLayout.LayoutParams(-1, ui.dp(76)) }
        private val faceBox = FrameLayout(ctx).apply { isClickable = true; setOnClickListener { onFace() }; contentDescription = "내 정보" }
        private val name = ui.label("회원님", 22f, bold = true)
        val dot: TextView = ui.label("", 10f, bold = true, color = Color.WHITE).apply {
            gravity = Gravity.CENTER
            background = ui.rounded(AppSkin.danger, 8)
            setPadding(ui.dp(5), 0, ui.dp(5), 0)
            minWidth = ui.dp(16)
            visibility = View.GONE
        }

        init {
            view.addView(ui.label("안녕하세요", 13f, color = AppSkin.faint), FrameLayout.LayoutParams(-2, -2).apply { marginStart = ui.dp(16); topMargin = ui.dp(8) })
            val row = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            row.addView(faceBox, LinearLayout.LayoutParams(ui.dp(36), ui.dp(36)))
            row.addView(name, LinearLayout.LayoutParams(-2, -2).apply { marginStart = ui.dp(10) })
            view.addView(row, FrameLayout.LayoutParams(-1, ui.dp(36)).apply { marginStart = ui.dp(16); marginEnd = ui.dp(60); topMargin = ui.dp(30) })
            val bell = FrameLayout(ctx).apply { isClickable = true; setOnClickListener { onBell() }; contentDescription = "알림" }
            bell.addView(ImageView(ctx).apply {
                setImageResource(R.drawable.ic_bell)
                imageTintList = ColorStateList.valueOf(AppSkin.dim)
            }, FrameLayout.LayoutParams(ui.dp(22), ui.dp(22), Gravity.CENTER))
            bell.addView(dot, FrameLayout.LayoutParams(-2, ui.dp(16)).apply { marginStart = ui.dp(24); topMargin = ui.dp(4) })
            view.addView(bell, FrameLayout.LayoutParams(ui.dp(44), ui.dp(44), Gravity.END).apply { marginEnd = ui.dp(8); topMargin = ui.dp(26) })
            show(null, "")
        }

        fun show(me: AppProfile?, fallback: String) {
            faceBox.removeAllViews()
            faceBox.addView(ui.avatar(me, 36), FrameLayout.LayoutParams(-1, -1))
            name.text = "${me?.name?.ifEmpty { null } ?: fallback.ifEmpty { "회원" }}님"
        }

        fun alerts(n: Int) {
            dot.text = if (n > 99) "99+" else n.toString()
            dot.visibility = if (n > 0) View.VISIBLE else View.GONE
        }
    }

    /** 묶음 제목(아이폰 `SectionCell` — 13 굵게 흐림 · 위 18 · 아래 4). */
    fun section(t: String): View = ui.label(t, 13f, bold = true, color = AppSkin.dim).apply {
        layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = ui.dp(18); bottomMargin = ui.dp(4) }
    }

    /** 한 줄짜리 단추(아이폰 `ButtonCell` — `지난 라운드 더 보기`). */
    fun more(title: String, click: () -> Unit): View = ui.label(title, 14f, bold = true).apply {
        gravity = Gravity.CENTER
        background = ui.rounded(AppSkin.surface, 20, AppSkin.line)
        isClickable = true
        setOnClickListener { click() }
        ui.pressable(this)
        layoutParams = LinearLayout.LayoutParams(-1, ui.dp(40)).apply { topMargin = ui.dp(8); bottomMargin = ui.dp(8) }
    }

    /** 빈 목록 안내 — 가운데 14 흐림(아이폰 `emptyLabel`). */
    fun empty(t: String): View = ui.label(t, 14f, color = AppSkin.dim, lines = 0).apply {
        gravity = Gravity.CENTER
        layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = ui.dp(140); marginStart = ui.dp(8); marginEnd = ui.dp(8) }
    }

    // ── 홈 ─────────────────────────────────────────────────────

    /**
     * 다음 라운드 카드(아이폰 `NextRoundCell`) — 잔디 그라디언트 위에 흰 글자. **이 카드에만** 쓴다.
     * 차례: `다음 라운드`·D-day → 날짜(22) · 장소(16) → 내 조 → 날씨 → 얼굴 다섯 + 자리 → 내 상태.
     */
    fun nextRound(r: AppRound, me: String, people: Map<String, AppProfile>, tees: Map<String, String>, weather: AppWeather?, click: () -> Unit): View {
        val card = ui.vstack(11).apply {
            setPadding(ui.dp(15), ui.dp(15), ui.dp(15), ui.dp(15))
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR,
                intArrayOf(Color.parseColor("#8fc93a"), Color.parseColor("#6faa22"), Color.parseColor("#5b8d18"))).apply {
                cornerRadius = ui.dpf(22f)
                setStroke(ui.dp(1), Color.parseColor("#5b8d18"))
            }
            clipToOutline = true
            isClickable = true
            setOnClickListener { click() }
        }
        val top = ui.hrow(listOf(white(if (r.isScreen) "다음 스크린" else "다음 라운드", 12f, true, .85f)))
        top.addView(white(AppDate.dday(r.teeAt), 12f, true))
        card.addView(top)

        val col = ui.vstack(2)
        col.addView(white(AppDate.dateTime(r.teeAt), 22f, true))
        col.addView(white(r.place, 16f, true, .95f))
        card.addView(col)

        val my = r.mine(me)
        /* 내 조는 여기서 끝나야 한다 — 조 번호 · 그 조의 시각 · 같은 조 사람(닉네임). */
        val grp = my?.grp
        if (my != null && grp != null) {
            var text = "${grp}조"
            tees[grp.toString()]?.let { text += " · ${r.teeLabel} ${AppDate.time(it)}" }
            val mates = r.confirmed.filter { it.grp == grp && it.userId != me }.mapNotNull { people[it.userId]?.name }
            if (mates.isNotEmpty()) text += " · " + mates.joinToString(", ")
            card.addView(white(text, 14f, true, lines = 0))
        }
        if (!r.isScreen && weather != null) card.addView(white(weather.line, 14f, true, .95f))

        /* 얼굴 다섯 + `3 / 4명 · 1자리 남음 · 대기 1`. */
        val confirmed = r.confirmed
        val left = maxOf(0, r.capacity - confirmed.size)
        var seat = "${confirmed.size} / ${r.capacity}명" + if (left > 0) " · ${left}자리 남음" else " · 자리 참"
        if (r.waiting.isNotEmpty()) seat += " · 대기 ${r.waiting.size}"
        val who = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        if (confirmed.isNotEmpty()) {
            val faces = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }
            confirmed.take(5).forEachIndexed { i, s ->
                val a = ui.avatar(people[s.userId], 26)
                (a.background as? GradientDrawable)?.setColor(AppSkin.alpha(Color.WHITE, .35f))
                faces.addView(a, LinearLayout.LayoutParams(ui.dp(26), ui.dp(26)).apply { if (i > 0) marginStart = -ui.dp(6) })
            }
            who.addView(faces)
        }
        who.addView(white(seat, 13f, true, .95f), LinearLayout.LayoutParams(-2, -2).apply { if (confirmed.isNotEmpty()) marginStart = ui.dp(8) })
        card.addView(who)

        /* 내 상태가 곧 단추 자리다 — 잔디 위의 분홍(`신청하기`) · 흰 반투명(`신청 완료`) · 흰 바탕 보라(`대기 N번`). */
        val (text, bgc, fg) = when {
            my?.state == "waitlist" -> Triple("대기 ${r.waitRank(me)}번", AppSkin.alpha(Color.WHITE, .9f), AppSkin.wait)
            my != null -> Triple("신청 완료", AppSkin.alpha(Color.WHITE, .22f), Color.WHITE)
            r.status != "open" -> Triple("신청 마감", AppSkin.alpha(Color.WHITE, .22f), Color.WHITE)
            else -> Triple(if (left > 0) "신청하기" else "대기 신청", AppSkin.brand, Color.WHITE)
        }
        card.addView(ui.label(text, 16f, bold = true, color = fg).apply {
            gravity = Gravity.CENTER
            background = ui.rounded(bgc, AppSkin.radiusSm)
            setPadding(ui.dp(10), ui.dp(10), ui.dp(10), ui.dp(10))
        })
        card.layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = ui.dp(4); bottomMargin = ui.dp(6) }
        return card
    }

    /** 예정된 라운드가 없을 때 — 빈칸 대신 초대장(아이폰 `EmptyNextCell`). */
    fun emptyNext(click: () -> Unit): View {
        val c = ui.card().apply {
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(ui.dp(14), ui.dp(22), ui.dp(14), ui.dp(22))
            isClickable = true
            setOnClickListener { click() }
        }
        c.addView(ui.label("열린 라운드가 없습니다", 16f, bold = true), LinearLayout.LayoutParams(-2, -2))
        c.addView(ui.label("먼저 모집을 열어 보세요", 13f, color = AppSkin.faint), LinearLayout.LayoutParams(-2, -2))
        c.addView(ui.badge("+ 모집 열기", Ui.Badge.BRAND), LinearLayout.LayoutParams(-2, -2))
        return place(c)
    }

    /** 한 줄 카드(아이폰 `HomeRowCell`) — 표 · 글(15 굵게) · 오른쪽 표 또는 `›`. */
    fun homeRow(badge: View?, text: String, trailing: View?, click: () -> Unit): View {
        val c = ui.card().apply {
            setPadding(ui.dp(13), ui.dp(11), ui.dp(13), ui.dp(11))
            isClickable = true
            setOnClickListener { click() }
        }
        val items = mutableListOf<View>()
        if (badge != null) items.add(badge)
        items.add(ui.label(text, 15f, bold = true).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) })
        items.add(trailing ?: ui.label("›", 17f, color = AppSkin.faint))
        c.addView(ui.hrow(items, spacing = 10, fill = true))
        return place(c)
    }

    /** 모집중의 한 줄 — `⛳ 9월 8일 오전 7:30 무등산CC` · 오른쪽에 `신청함`/`N자리`/`자리 참`. */
    fun homeRound(r: AppRound, me: String, click: () -> Unit): View {
        val left = maxOf(0, r.capacity - r.confirmed.size)
        val trailing = when {
            r.mine(me) != null -> ui.badge("신청함", Ui.Badge.DIM)
            left > 0 -> ui.badge("${left}자리", Ui.Badge.BRAND)
            else -> ui.badge("자리 참", Ui.Badge.DIM)
        }
        val whenText = AppDate.dateTime(r.teeAt).replace(Regex(" \\(.\\)"), "")
        return homeRow(null, "${r.kindIcon} $whenText ${r.place}", trailing, click)
    }

    // ── 공지 ───────────────────────────────────────────────────

    /** 공지 한 줄(아이폰 `PostCell`) — `고정` + 제목 · 본문 두 줄 · 글쓴이 · 시각. */
    fun post(p: org.json.JSONObject, author: String, click: () -> Unit): View {
        val c = ui.card().apply { isClickable = true; setOnClickListener { click() } }
        val head = mutableListOf<View>()
        if (p.optBoolean("pinned")) head.add(ui.badge("고정", Ui.Badge.WARN))
        head.add(ui.label(p.str("title"), 16f, bold = true).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) })
        c.addView(ui.hrow(head, fill = true))
        val body = p.str("body").replace("\n", " ").trim()
        if (body.isNotEmpty()) c.addView(ui.label(body, 14f, color = AppSkin.dim, lines = 2))
        c.addView(ui.label("${author.ifEmpty { "알 수 없음" }} · ${AppDate.ago(p.str("created_at"))}", 12f, color = AppSkin.faint))
        return place(c)
    }

    // ── 라운드 ─────────────────────────────────────────────────

    /** 라운드 카드(아이폰 `RoundCell`) — 표 줄 · 장소 · 시각/조건 · 자리 막대. */
    fun round(r: AppRound, me: String, past: Boolean, click: () -> Unit): View {
        val c = ui.card().apply { isClickable = true; setOnClickListener { click() }; alpha = if (past) .72f else 1f }
        val confirmed = r.confirmed.size
        val waiting = r.waiting.size
        val full = confirmed >= r.capacity
        /* 맨 앞은 늘 '지금 어떤 상태인가'다 — 잔디=열림 · 회색=끝남 · 빨강=취소. */
        val head = mutableListOf<View>(ui.badge("${r.kindIcon} ${r.kindLabel}", if (r.isScreen) Ui.Badge.SCREEN else Ui.Badge.FIELD))
        head.add(when {
            r.status == "cancelled" -> ui.badge("취소됨", Ui.Badge.DANGER)
            past -> ui.badge("종료", Ui.Badge.DONE)
            r.status == "closed" || full -> ui.badge("모집 마감", Ui.Badge.DONE)
            else -> ui.badge("모집중", Ui.Badge.LIVE)
        })
        if (!past && r.status != "cancelled") head.add(ui.badge(AppDate.dday(r.teeAt), if (AppDate.daysUntil(r.teeAt) <= 3) Ui.Badge.WARN else Ui.Badge.DIM))
        val row = ui.hrow(head)
        r.mine(me)?.let { my ->
            row.addView(if (my.state == "confirmed") ui.badge("참가 확정", Ui.Badge.DIM) else ui.badge("대기중", Ui.Badge.WAIT))
        }
        c.addView(row)
        c.addView(ui.label("${r.kindIcon} ${r.place}", 16f, bold = true))
        var sub = AppDate.dateTime(r.teeAt)
        r.caddie?.let { AppRound.caddieLabel[it] }?.let { sub += " · $it" }
        r.cart?.let { AppRound.cartLabel[it] }?.let { sub += " · $it" }
        c.addView(ui.label(sub, 14f, color = AppSkin.dim))

        /* 자리 막대 + `3/4명 · 대기 1` · 요금. */
        val ratio = if (r.capacity > 0) minOf(1f, confirmed.toFloat() / r.capacity) else 0f
        val bar = View(ctx).apply { background = bar(ratio, if (full) AppSkin.faint else AppSkin.grass) }
        val count = ui.label(ui.rich(
            *listOfNotNull(
                Triple("$confirmed/${r.capacity}명", 14f, true to if (full) AppSkin.faint else AppSkin.text),
                if (waiting > 0) Triple(" · 대기 $waiting", 14f, true to AppSkin.wait) else null
            ).toTypedArray()), 14f)
        val foot = mutableListOf(bar.also { it.layoutParams = LinearLayout.LayoutParams(ui.dp(72), ui.dp(6)) }, count)
        if (r.fee > 0) foot.add(ui.label(AppDate.won(r.fee), 12f, color = AppSkin.faint))
        c.addView(ui.hrow(foot, spacing = 8))
        return place(c)
    }

    /** 옅은 판 위에 비율만큼 칠한 막대 — 한 장의 그림으로(뷰로 세우면 높이 셈이 흔들린다). */
    private fun bar(ratio: Float, color: Int): Drawable {
        val fill = ClipDrawable(ui.rounded(color, 3), Gravity.START, ClipDrawable.HORIZONTAL)
        fill.level = (ratio.coerceIn(0f, 1f) * 10000).toInt()
        return LayerDrawable(arrayOf(ui.rounded(AppSkin.surface2, 3), fill))
    }

    /** 종류 가리개(아이폰 `UISegmentedControl` — `전체 · ⛳ 필드 · 🎯 스크린`). 둘이 섞여 있을 때만 쓴다. */
    fun segments(titles: List<String>, selected: Int, pick: (Int) -> Unit): View {
        val track = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            background = ui.rounded(AppSkin.alpha(AppSkin.text, .06f), 9)
            setPadding(ui.dp(2), ui.dp(2), ui.dp(2), ui.dp(2))
        }
        titles.forEachIndexed { i, t ->
            track.addView(ui.label(t, 13f, bold = i == selected).apply {
                gravity = Gravity.CENTER
                if (i == selected) { background = ui.rounded(AppSkin.surface, 7); elevation = ui.dpf(1f) }
                isClickable = true
                setOnClickListener { if (i != selected) pick(i) }
            }, LinearLayout.LayoutParams(0, ui.dp(28), 1f))
        }
        track.layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = ui.dp(4); bottomMargin = ui.dp(8) }
        return track
    }

    // ── 투표 ───────────────────────────────────────────────────

    class PollActions(
        val open: () -> Unit, val more: () -> Unit, val pick: (String) -> Unit,
        val close: () -> Unit, val delete: () -> Unit,
    )

    /** 투표 카드(아이폰 `PollCell`) — 목록에서 바로 던진다. 마감된 것은 1위 한 줄로. */
    fun poll(p: AppPoll, me: String, people: Map<String, AppProfile>, canManage: Boolean, expanded: Boolean, max: Int, on: PollActions): View {
        val c = ui.card()
        val closed = p.closed
        c.alpha = if (closed) .8f else 1f
        val head = mutableListOf<View>(if (closed) ui.badge("마감", Ui.Badge.DONE) else ui.badge("진행중", Ui.Badge.LIVE))
        if (p.multi) head.add(ui.badge("복수 선택", Ui.Badge.DIM))
        if (p.anonymous) head.add(ui.badge("익명", Ui.Badge.DIM))
        val headRow = ui.hrow(head)
        headRow.addView(ui.label(AppDate.ago(p.createdAt), 12f, color = AppSkin.faint))
        c.addView(headRow)

        /* 제목을 누르면 상세로. */
        c.addView(ui.label(ui.rich(Triple(p.title + "  ", 17f, true to AppSkin.text), Triple("›", 17f, false to AppSkin.faint)), 17f, lines = 0).apply {
            isClickable = true
            setOnClickListener { on.open() }
        })
        if (p.body.isNotEmpty()) c.addView(ui.label(p.body, 14f, color = AppSkin.dim, lines = 0))

        if (closed) {
            /* 마감된 투표는 항목을 아예 안 편다 — 1위 한 줄로. 동점이면 다 적는다. */
            val won = p.top()
            if (won != null) {
                val row = ui.hrow(listOf(ui.badge(if (won.first.size > 1) "공동 1위" else "1위", Ui.Badge.LIVE),
                    ui.label(won.first.joinToString(", "), 15f, bold = true)), spacing = 8)
                row.addView(ui.label("${won.second}표", 12f, color = AppSkin.faint))
                c.addView(row)
            } else c.addView(ui.label("아무도 투표하지 않았습니다", 14f, color = AppSkin.faint))
        } else {
            val mine = p.votes.filter { it.userId == me }.map { it.optionId }.toSet()
            val voters = p.votes.map { it.userId }.toSet().size
            /* 내가 고른 것이 접힌 자리에 있으면 아예 펴 둔다. */
            val hidPick = p.options.drop(max).any { it.id in mine }
            val shown = if (expanded || hidPick) p.options else p.options.take(max)
            for (o in shown) {
                val on2 = p.votes.filter { it.optionId == o.id }
                val pct = if (voters > 0) on2.size.toFloat() / voters else 0f
                /* 누가 골랐나 줄은 표가 없어도 비워 둔 채 선다 — 익명이면 처음부터 없다. */
                val who = if (p.anonymous) null else votersLine(on2.map { people[it.userId]?.label ?: "?" })
                c.addView(optionRow(ui, o.label, on2.size, pct, o.id in mine, who).apply { setOnClickListener { on.pick(o.id) } })
            }
            val rest = p.options.size - shown.size
            if (rest > 0) c.addView(ui.label("항목 ${rest}개 더 보기", 13f, bold = true, color = AppSkin.dim).apply {
                gravity = Gravity.CENTER
                setPadding(0, ui.dp(6), 0, ui.dp(6))
                isClickable = true
                setOnClickListener { on.more() }
            })
        }

        /* 발 — `N명 참여 · 마감 시각`(빨강 · 정해 둔 예외) · 만든 사람/운영진의 마감·지우기. */
        val members = people.values.filter { it.role != "pending" && it.role != "banned" }.map { it.id }.toSet()
        val n = p.votes.map { it.userId }.filter { it in members }.toSet().size
        val parts = mutableListOf(Triple("${n}명 참여", 12f, false to AppSkin.faint))
        val closesAt = p.closesAt
        if (closesAt != null && !p.closedFlag) {
            parts.add(Triple(" · ", 12f, false to AppSkin.faint))
            parts.add(Triple("${AppDate.dateTime(closesAt)} 마감", 12f, true to AppSkin.danger))
        }
        val footL = ui.label(ui.rich(*parts.toTypedArray()), 12f, lines = 2).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
        val foot = mutableListOf<View>(footL)
        if (canManage) {
            if (!closed) foot.add(small("마감", on.close))
            foot.add(small("지우기", on.delete))
        }
        c.addView(ui.hrow(foot, spacing = 8, fill = true))
        return place(c)
    }

    private fun small(t: String, click: () -> Unit): TextView = ui.label(t, 13f, bold = true).apply {
        gravity = Gravity.CENTER
        background = ui.rounded(AppSkin.surface, 15, AppSkin.line)
        setPadding(ui.dp(12), ui.dp(6), ui.dp(12), ui.dp(6))
        isClickable = true
        setOnClickListener { click() }
        ui.pressable(this)
    }

    companion object {
        /** `이관교, 김지명, 박승수 외 12명` — 셋까지 적고 나머지는 센다(웹 `votersLine`). */
        fun votersLine(list: List<String>): String =
            if (list.size <= 3) list.joinToString(", ") else list.take(3).joinToString(", ") + " 외 ${list.size - 3}명"

        /**
         * 항목 한 줄(아이폰 `OptionRow`) — 옅은 바탕 위에 표 비율만큼 잔디 막대 · ✓ · 이름 · 표 수,
         * 그 아래 누가 골랐나(`voters` · null이면 줄이 없다). 목록 카드와 투표 상세가 같이 쓴다.
         */
        fun optionRow(ui: Ui, label: String, count: Int, pct: Float, chosen: Boolean, voters: String?): LinearLayout {
            val bar = ClipDrawable(ui.rounded(AppSkin.alpha(AppSkin.grass, .22f), AppSkin.radiusSm), Gravity.START, ClipDrawable.HORIZONTAL)
            bar.level = (pct.coerceIn(0f, 1f) * 10000).toInt()
            val layers = mutableListOf<Drawable>(ui.rounded(AppSkin.surface2, AppSkin.radiusSm), bar)
            if (chosen) layers.add(ui.rounded(Color.TRANSPARENT, AppSkin.radiusSm, AppSkin.brand, 2))
            val check = ui.label(if (chosen) "✓" else "", 14f, bold = true, color = AppSkin.brand).apply { layoutParams = LinearLayout.LayoutParams(ui.dp(16), -2) }
            val name = ui.label(label, 15f, bold = chosen).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
            val n = ui.label(count.toString(), 14f, bold = true, color = AppSkin.dim)
            val col = ui.vstack(2).apply {
                background = LayerDrawable(layers.toTypedArray())
                setPadding(ui.dp(10), ui.dp(9), ui.dp(10), ui.dp(9))
                minimumHeight = ui.dp(40)
                isClickable = true
            }
            col.addView(ui.hrow(listOf(check, name, n), spacing = 6, fill = true))
            if (voters != null) col.addView(ui.label(voters.ifEmpty { " " }, 12f, color = AppSkin.faint))
            ui.pressable(col)
            return col
        }
    }
}
