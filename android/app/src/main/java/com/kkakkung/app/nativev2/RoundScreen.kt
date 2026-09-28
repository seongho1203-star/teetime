package com.kkakkung.app.nativev2

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONObject

/*
 * **라운드 상세** — 아이폰 `RoundViewController.swift`를 코틀린으로 옮긴 것이다.
 * 생김새·말·규칙이 그쪽과 같아야 한다 — 한쪽만 고치지 말 것.
 *
 *  - **신청·취소는 DB 함수(`join_round`·`leave_round`)가 한다.** 정원은 여기서 안 센다.
 *  - 상태표 맨 앞은 '지금 어떤 상태인가' — 취소됨 · 종료 · 모집 마감(닫았거나 자리가
 *    다 찼거나) · 모집중. 그다음 D-day.
 *  - 정보 표는 **칸 수가 늘 짝수다** — 필드는 캐디·카트를 한 칸씩(안 정했으면 `미정`,
 *    **값은 `있음`/`없음`·`포함`/`미포함`** — DB 글자 `none`·`included`를 그대로 찍지 말 것),
 *    스크린은 둘 다 없다.
 *  - 조가 짜여 있으면 조별로 묶어 그린다. 내 조는 작은 표(`내 조`)로만 알린다.
 *  - `📣 대화방에 공유`는 누구나(지난·취소 빼고), `📋 같은 조건으로 새로 열기`는 스크린만.
 *  - 운영 단추와 `수정`·`조 편성`은 연 사람과 운영진. 남을 빼는 `✕`는 운영진만.
 *  - 신청 단추는 화면 아래 붙박이 바. 댓글 칸은 카드 안에 그대로 선다.
 */
class RoundScreen(ctx: Context, host: ScreenHost, private val roundId: String) : NativeScreen(ctx, host, "라운드") {
    private val scroll: ScrollView
    private val stack: LinearLayout
    private val actionBar = LinearLayout(ctx)
    private val actionBtn: TextView
    private val commentInput = CommentInput(ui)

    private var round: AppRound? = null
    private var rawRound: JSONObject? = null
    private var comments: List<AppComment> = emptyList()
    private var settlements: List<AppSettlement> = emptyList()
    private var tees: JSONObject = JSONObject()
    private var peopleRaw: List<JSONObject> = emptyList()
    private var people: Map<String, AppProfile> = emptyMap()

    private val me get() = people[myId]
    private val isAdmin get() = AppRole.isAdmin(me?.role ?: "member")
    private val canSettle get() = isAdmin || me?.role == "treasurer"
    private val isOwner get() = round?.createdBy == myId

    init {
        val (s, st) = scrollStack(); scroll = s; stack = st
        rightButton.text = "수정"
        rightButton.setTextColor(AppSkin.text)
        rightButton.setOnClickListener { rawRound?.let { host.editRound(it) } }

        /* 신청 단추 바 — 바탕에 위쪽 가는 선(웹 `.round-actions`). */
        actionBar.orientation = LinearLayout.VERTICAL
        actionBar.setBackgroundColor(AppSkin.bg)
        actionBar.addView(View(ctx).apply { setBackgroundColor(AppSkin.line) }, LinearLayout.LayoutParams(-1, ui.dp(1)))
        actionBtn = TextView(ctx).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            isClickable = true
            setOnClickListener { actionTapped() }
        }
        ui.pressable(actionBtn)
        actionBar.addView(actionBtn, LinearLayout.LayoutParams(-1, ui.dp(44)).apply {
            topMargin = ui.dp(10); bottomMargin = ui.dp(10); marginStart = ui.dp(16); marginEnd = ui.dp(16)
        })
        actionBar.visibility = View.GONE

        val col = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        col.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        col.addView(actionBar, LinearLayout.LayoutParams(-1, -2))
        body.addView(col, 0, FrameLayout.LayoutParams(-1, -1))
        scroll.visibility = View.GONE
        commentInput.onSend = { send(it) }
    }

    override fun load() {
        if (round == null) spinner.visibility = View.VISIBLE
        launch {
            try {
                val r = api.round(roundId)
                comments = api.roundComments(roundId).map(::AppComment)
                peopleRaw = api.people()
                people = peopleRaw.associate { it.str("id") to AppProfile(it) }
                /* 조별 시각·정산은 **있으면 좋은 것** — 표가 없는 저장소에서 라운드가 통째로 안 열리면 안 된다. */
                tees = try { api.groupTees(roundId) } catch (_: Exception) { JSONObject() }
                settlements = try { api.roundSettlements(roundId).map(::AppSettlement) } catch (_: Exception) { emptyList() }
                rawRound = r
                round = r?.let(::AppRound)
                render()
            } catch (e: Exception) {
                flash(e.message ?: "불러오지 못했습니다.", error = true)
            }
            spinner.visibility = View.GONE
        }
    }

    private fun render() {
        val r = round ?: run {
            scroll.visibility = View.GONE; actionBar.visibility = View.GONE
            flash("없는 라운드입니다.", error = true); return
        }
        scroll.visibility = View.VISIBLE
        rightButton.visibility = if (isAdmin || isOwner) View.VISIBLE else View.GONE
        (commentInput.parent as? android.view.ViewGroup)?.removeView(commentInput)
        stack.removeAllViews()

        val confirmed = r.confirmed
        val waiting = r.waiting
        val openSlots = maxOf(0, r.capacity - confirmed.size)
        val isPast = r.isPast
        val my = r.mine(myId)

        // 머리 — 표 줄 · 장소 · (제목이 따로 있으면) 작은 줄
        val badges = mutableListOf<View>(ui.badge("${r.kindIcon} ${r.kindLabel}", if (r.isScreen) Ui.Badge.SCREEN else Ui.Badge.FIELD))
        when {
            r.status == "cancelled" -> badges.add(ui.badge("취소됨", Ui.Badge.DANGER))
            isPast -> badges.add(ui.badge("종료", Ui.Badge.DONE))
            r.status == "closed" || openSlots == 0 -> badges.add(ui.badge("모집 마감", Ui.Badge.DONE))
            else -> badges.add(ui.badge("모집중", Ui.Badge.LIVE))
        }
        if (!isPast && r.status != "cancelled") {
            badges.add(ui.badge(AppDate.dday(r.teeAt), if (AppDate.daysUntil(r.teeAt) <= 3) Ui.Badge.WARN else Ui.Badge.DIM))
        }
        val hero = ui.vstack(6).apply { setPadding(ui.dp(2), ui.dp(4), ui.dp(2), ui.dp(6)) }
        hero.addView(ui.hrow(badges))
        hero.addView(ui.label("${r.kindIcon} ${r.place}", 22f, bold = true, lines = 0))
        if (r.title.isNotEmpty() && r.course.isNotEmpty()) hero.addView(ui.label(r.title, 14f, color = AppSkin.dim, lines = 0))
        stack.addView(hero)

        // 정보 표 — 두 칸씩, 칸 수는 늘 짝수
        val cells = mutableListOf(
            "날짜" to AppDate.fullDate(r.teeAt), r.teeLabel to AppDate.time(r.teeAt),
            "정원" to "${r.capacity}명", r.feeLabel to (if (r.fee > 0) AppDate.won(r.fee) else "미정")
        )
        if (!r.isScreen) {
            cells.add("캐디" to (r.caddie?.let { AppRound.caddieShort[it] } ?: "미정"))
            cells.add("카트" to (r.cart?.let { AppRound.cartShort[it] } ?: "미정"))
        }
        val grid = ui.vstack(8)
        for (i in cells.indices step 2) {
            val row = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }
            row.addView(ui.infoCell(cells[i].first, cells[i].second), LinearLayout.LayoutParams(0, -1, 1f))
            row.addView(ui.infoCell(cells[i + 1].first, cells[i + 1].second), LinearLayout.LayoutParams(0, -1, 1f).apply { marginStart = ui.dp(8) })
            grid.addView(row)
        }
        stack.addView(grid)

        /* 팀별 코스·시각 — 조를 짜기 전에도 몇 시에 나가는지가 보여야 한다. */
        val slotLines = r.slotLines
        if (slotLines.isNotEmpty()) {
            val card = ui.card()
            card.addView(ui.hrow(listOf(ui.sectionTitle("팀별 ${r.teeLabel}"), ui.label("${r.teeSlots.size}팀", 13f, color = AppSkin.faint))))
            slotLines.forEach { card.addView(ui.label(it, 15f, bold = true, lines = 0)) }
            stack.addView(card)
        }

        // 공유 · 베끼기 — 오른쪽 정렬
        val canShare = !isPast && r.status != "cancelled"
        if (canShare || r.isScreen) {
            val list = mutableListOf<View>()
            if (canShare) list.add(ui.button("📣 대화방에 공유") { shareTapped() })
            if (r.isScreen) list.add(ui.button("📋 같은 조건으로 새로 열기") { rawRound?.let { host.copyRound(it) } })
            val row = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.END or Gravity.CENTER_VERTICAL }
            list.forEachIndexed { i, v -> row.addView(v, LinearLayout.LayoutParams(-2, -2).apply { if (i > 0) marginStart = ui.dp(8) }) }
            stack.addView(row)
        }

        // 전달 내용 — 노란 쪽지
        val note = r.note.trim()
        if (note.isNotEmpty()) {
            val card = ui.card()
            card.background = ui.rounded(AppSkin.alpha(AppSkin.warn, .10f), AppSkin.radius, AppSkin.alpha(AppSkin.warn, .35f))
            card.addView(ui.sectionTitle("전달 내용"))
            card.addView(ui.label(note, 15f, lines = 0).apply { setLineSpacing(ui.dpf(6f), 1f) })
            stack.addView(card)
        }

        // 참가 확정
        val joinCard = ui.card()
        val headViews = mutableListOf<View>(ui.sectionTitle("참가 확정 ${confirmed.size}/${r.capacity}"))
        if (openSlots > 0 && !isPast) headViews.add(ui.badge("${openSlots}자리 남음", Ui.Badge.BRAND))
        joinCard.addView(ui.hrow(headViews))
        val grouped = r.grouped()
        if (grouped.isNotEmpty()) {
            val slots = r.teeSlots
            for ((no, list) in grouped) {
                val block = ui.vstack(2)
                val gName = if (no == null) "미배정" else
                    if (no - 1 in slots.indices && slots[no - 1].course.isNotEmpty()) "${no}조 · ${slots[no - 1].course}" else "${no}조"
                val gh = mutableListOf<View>(ui.label(gName, 14f, bold = true))
                if (list.any { it.userId == myId }) gh.add(ui.badge("내 조", Ui.Badge.BRAND))
                if (no != null) tees.strOrNull(no.toString())?.let { gh.add(ui.label("${r.teeLabel} ${AppDate.time(it)}", 12f, color = AppSkin.faint)) }
                block.addView(ui.hrow(gh, spacing = 8))
                list.forEachIndexed { i, s -> block.addView(personRow(i + 1, s, false)) }
                joinCard.addView(block)
            }
        } else {
            val list = ui.vstack(2)
            confirmed.forEachIndexed { i, s -> list.addView(personRow(i + 1, s, false)) }
            /* 남은 자리를 빈 줄로 그려 둔다 — 몇 자리인지 세지 않아도 보인다. */
            if (!isPast) for (i in 0 until openSlots) list.addView(emptySlot(confirmed.size + i + 1))
            joinCard.addView(list)
        }
        if ((isAdmin || isOwner) && confirmed.isNotEmpty()) {
            val b = ui.button("🚩 " + if (grouped.isEmpty()) "조 편성" else "조 편성 고치기") { rawRound?.let { host.roundGroups(it, peopleRaw) } }
            joinCard.addView(ui.hrow(listOf(b)))
        }
        stack.addView(joinCard)

        // 대기
        if (waiting.isNotEmpty()) {
            val card = ui.card()
            card.addView(ui.sectionTitle("대기 ${waiting.size}명"))
            val list = ui.vstack(2)
            waiting.forEachIndexed { i, s -> list.addView(personRow(i + 1, s, true)) }
            card.addView(list)
            card.addView(ui.label("확정자가 빠지면 위에서부터 자동으로 올라갑니다.", 12f, color = AppSkin.faint, lines = 0))
            stack.addView(card)
        }

        // 정산 — 돈은 댓글보다 먼저 눈에 들어와야 한다
        val settleCard = ui.card()
        val settleTitle = ui.sectionTitle(if (settlements.isEmpty()) "정산" else "정산 ${settlements.size}")
        /* **만드는 것은 회원 누구나** — 걷는 사람이 곧 만드는 사람이다. */
        val add = ui.button("＋ 정산") {
            host.newSettlement(roundId, r.confirmed.map { it.userId }, peopleRaw)
        }
        settleCard.addView(ui.hrow(listOf(settleTitle, ui.spacer().apply { layoutParams = LinearLayout.LayoutParams(0, 1, 1f) }, add), fill = true))
        if (settlements.isEmpty()) settleCard.addView(ui.label("아직 정산이 없습니다.", 12f, color = AppSkin.faint))
        settlements.forEach { settleCard.addView(settlementView(it)) }
        stack.addView(settleCard)

        // 운영 — 연 사람과 운영진만
        if (isAdmin || isOwner) {
            val card = ui.card()
            card.addView(ui.sectionTitle(if (isAdmin) "운영" else "내가 연 모집"))
            /* **한 줄에 같은 폭으로** 선다 — 둘·하나로 접으면 폭이 제각각이다. */
            val line = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }
            fun put(title: String, danger: Boolean, work: () -> Unit) {
                val b = ui.button(title, if (danger) AppSkin.danger else AppSkin.text, filled = danger) { work() }
                b.setPadding(ui.dp(6), ui.dp(10), ui.dp(6), ui.dp(10))
                androidx.core.widget.TextViewCompat.setAutoSizeTextTypeUniformWithConfiguration(b, 10, 14, 1, TypedValue.COMPLEX_UNIT_SP)
                line.addView(b, LinearLayout.LayoutParams(0, ui.dp(40), 1f).apply { if (line.childCount > 0) marginStart = ui.dp(8) })
            }
            if (r.status == "open") put("모집 마감", false) { setStatus("closed") }
            if (r.status == "closed") put("모집 다시 열기", false) { setStatus("open") }
            if (r.status != "cancelled") put("라운드 취소", false) { setStatus("cancelled") } else put("취소 되돌리기", false) { setStatus("open") }
            put("지우기", true) { deleteTapped() }
            card.addView(line)
            stack.addView(card)
        }

        // 댓글 — 신청 단추보다 아래
        val ccard = ui.card()
        ccard.addView(ui.sectionTitle("댓글 ${comments.size}"))
        if (comments.isEmpty()) ccard.addView(ui.label("아직 댓글이 없습니다.", 12f, color = AppSkin.faint))
        val clist = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        comments.forEachIndexed { i, c ->
            clist.addView(commentRow(ui, c, c.authorId?.let { people[it] }, isAdmin || c.authorId == myId, i == 0) { deleteComment(c) })
        }
        ccard.addView(clist)
        ccard.addView(commentInput, LinearLayout.LayoutParams(-1, -2).apply { topMargin = ui.dp(10) })
        stack.addView(ccard)

        // 신청 단추 — 지난·취소된 라운드에는 바가 없다
        if (!isPast && r.status != "cancelled") {
            actionBar.visibility = View.VISIBLE
            val canSignUp = r.status == "open"
            if (my != null) {
                actionBtn.text = if (my.state == "confirmed") "참가 취소" else "대기 취소"
                actionBtn.background = ui.rounded(AppSkin.danger, 22)
                actionBtn.setTextColor(android.graphics.Color.WHITE)
                actionBtn.isEnabled = true
            } else {
                actionBtn.text = if (!canSignUp) "신청 마감" else if (openSlots > 0) "참가 신청" else "대기 신청"
                actionBtn.background = ui.rounded(if (canSignUp) AppSkin.brand else AppSkin.surface2, 22)
                actionBtn.setTextColor(if (canSignUp) android.graphics.Color.WHITE else AppSkin.faint)
                actionBtn.isEnabled = canSignUp
            }
        } else actionBar.visibility = View.GONE
    }

    /** 참가자 한 줄 — 번호 · 얼굴 · 이름표 (나) · 운영진의 ✕. 차량번호는 여기 없다. */
    private fun personRow(seq: Int, s: AppSignup, waiting: Boolean): View {
        val p = people[s.userId]
        val isMe = s.userId == myId
        val n = ui.label(seq.toString(), 12f, bold = true, color = AppSkin.faint).apply { layoutParams = LinearLayout.LayoutParams(ui.dp(18), -2) }
        val label = p?.label.orEmpty().ifEmpty { "알 수 없음" }
        val name = ui.label(
            if (isMe) ui.rich(Triple(label, 15f, true to AppSkin.text), Triple(" (나)", 12f, true to AppSkin.brand))
            else ui.rich(Triple(label, 15f, false to if (waiting) AppSkin.dim else AppSkin.text)), 15f
        ).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
        val views = mutableListOf(n, ui.avatar(p, 28), name)
        if (isAdmin && !isMe) views.add(ui.smallX("명단에서 빼기") { kick(s.userId) })
        return ui.hrow(views, spacing = 8, fill = true).apply { minimumHeight = ui.dp(36) }
    }

    private fun emptySlot(seq: Int): View {
        val n = ui.label(seq.toString(), 12f, bold = true, color = AppSkin.faint).apply { layoutParams = LinearLayout.LayoutParams(ui.dp(18), -2) }
        return ui.hrow(listOf(n, ui.label("빈 자리", 15f, color = AppSkin.faint)), spacing = 8).apply { minimumHeight = ui.dp(36) }
    }

    /** 정산 한 건 — 내 몫이 맨 위에 온다. */
    private fun settlementView(s: AppSettlement): View {
        val shares = s.shares
        val box = ui.vstack(8).apply { setPadding(0, ui.dp(10), 0, ui.dp(4)) }
        box.addView(ui.hrow(listOf(ui.label(s.title, 15f, bold = true), ui.label(AppDate.ago(s.createdAt), 12f, color = AppSkin.faint)), spacing = 8))
        s.createdBy?.let { by -> box.addView(ui.label("${people[by]?.name ?: "알 수 없음"}님이 걷습니다", 12f, color = AppSkin.faint)) }
        if (s.body.isNotEmpty()) box.addView(ui.label(s.body, 14f, color = AppSkin.dim, lines = 0))

        val mine = shares.firstOrNull { it.userId == myId }
        if (mine != null) {
            /* 낼 돈을 맨 위에 크게 · 그 아래 꽉 찬 단추(`입금완료`). 누른 뒤에는 잔디색 ✓. */
            val wrap = ui.vstack(8).apply {
                setPadding(ui.dp(12), ui.dp(10), ui.dp(12), ui.dp(10))
                background = ui.rounded(if (mine.paid) AppSkin.alpha(AppSkin.grass, .12f) else AppSkin.surface2, AppSkin.radiusSm)
            }
            wrap.addView(ui.hrow(listOf(ui.label("입금금액", 13f, color = AppSkin.dim), ui.label(AppDate.won(mine.amount), 20f, bold = true))))
            wrap.addView(ui.button(if (mine.paid) "입금완료 ✓" else "입금완료", if (mine.paid) AppSkin.grass else AppSkin.brand, filled = true) {
                act { api.markSharePaid(mine.id, !mine.paid) }
            })
            if (mine.paid) wrap.addView(ui.label("잘못 누르셨으면 한 번 더 누르면 취소됩니다.", 12f, color = AppSkin.faint, lines = 0))
            box.addView(wrap)
        }

        if (s.bank.isNotEmpty() || s.account.isNotEmpty()) {
            /* **계좌번호는 자르지 않는다** — 은행을 윗줄에, 번호는 한 줄을 통째로. */
            val col = ui.vstack(1)
            if (s.bank.isNotEmpty()) col.addView(ui.label(s.bank, 12f, color = AppSkin.faint))
            col.addView(ui.label(s.account, 15f, bold = true, lines = 0))
            col.layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
            val copy = ui.button("복사") {
                val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                cm.setPrimaryClip(ClipData.newPlainText("계좌", "${s.bank} ${s.account}".trim()))
                flash("계좌를 복사했습니다.")
            }
            box.addView(ui.hrow(listOf(col, copy), spacing = 8, fill = true))
        }
        if (s.account.isNotEmpty()) {
            /* 송금 지름길 — 토스가 없으면 안 열리므로 위의 복사를 그대로 둔다. 분홍을 안 쓴다. */
            box.addView(ui.button("토스로 보내기") {
                try { ctx.startActivity(Intent(Intent.ACTION_VIEW, s.tossUri(mine?.amount)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                catch (_: Exception) { flash("토스 앱이 없어 열지 못했습니다. 계좌를 복사해 보내 주세요.", error = true) }
            })
            box.addView(ui.label("토스 앱이 깔려 있을 때만 열립니다.", 12f, color = AppSkin.faint))
        }

        /* 누구 몫이 얼마인지 — 얼굴 · 이름표 · 금액, 낸 사람은 옅게. */
        val chips = ui.vstack(4)
        for (x in shares) {
            val p = people[x.userId]
            val c = if (x.paid) AppSkin.faint else AppSkin.text
            val views = mutableListOf(ui.avatar(p, 22), ui.label(p?.label.orEmpty().ifEmpty { "알 수 없음" }, 13f, color = c),
                ui.label(AppDate.won(x.amount), 13f, bold = true, color = c))
            if (x.paid) views.add(ui.label("✓", 12f, bold = true, color = AppSkin.grassDeep))
            chips.addView(ui.hrow(views))
        }
        box.addView(chips)

        val paid = shares.count { it.paid }
        val foot = mutableListOf<View>(ui.label("총 ${AppDate.won(s.total)} · $paid/${shares.size}명 보냄", 12f, color = AppSkin.faint))
        if (canSettle || s.createdBy == myId) foot.add(ui.button("지우기", AppSkin.danger, filled = true) { deleteSettlement(s, shares.size) })
        box.addView(ui.hrow(foot, spacing = 8))
        return box
    }

    // ── 누르는 것들 ─────────────────────────────────────────────

    /** 신청 또는 취소 — 정원 셈은 DB가 한다. */
    private fun actionTapped() {
        val r = round ?: return
        if (busy) return
        val my = r.mine(myId)
        if (my != null) {
            val next = r.waiting.firstOrNull()
            val detail = if (my.state == "confirmed" && next != null)
                "내 자리는 대기 1번인 ${people[next.userId]?.name ?: "다음 분"}에게 넘어갑니다."
            else "다시 신청하면 순번은 맨 뒤가 됩니다."
            confirm("신청을 취소할까요?", detail, "취소하기", true) {
                act { api.leaveRound(r.id); flash("신청을 취소했습니다.") }
            }
            return
        }
        act {
            val state = api.joinRound(r.id)
            flash(if (state == "confirmed") "참가가 확정되었습니다." else "자리가 차서 대기자로 올렸습니다.")
        }
    }

    private fun kick(userId: String) {
        val r = round ?: return
        confirm("${people[userId]?.name ?: "이 분"}을 뺄까요?", "대기자가 있으면 맨 앞 사람이 자동으로 올라갑니다.", "빼기", true) {
            act { api.kickSignup(r.id, userId); flash("명단에서 뺐습니다.") }
        }
    }

    private fun setStatus(status: String) {
        val r = round ?: return
        act { api.setRoundStatus(r.id, status) }
    }

    private fun deleteTapped() {
        val r = round ?: return
        var detail = "${r.place}\n신청 ${r.signups.size}건"
        if (comments.isNotEmpty()) detail += "과 댓글 ${comments.size}개"
        detail += "이 함께 사라집니다.\n되돌릴 수 없습니다. 모집만 멈추려면 마감을 쓰세요."
        confirm("이 라운드를 지울까요?", detail, "지우기", true) {
            if (busy) return@confirm
            busy = true
            launch {
                try { api.deleteRow("rounds", r.id); flash("지웠습니다."); host.back(refreshBehind = true) }
                catch (e: Exception) { flash(e.message ?: "지우지 못했습니다.", error = true) }
                finally { busy = false }
            }
        }
    }

    private fun shareTapped() {
        val r = round ?: return
        val openSlots = maxOf(0, r.capacity - r.confirmed.size)
        confirm("대화방에 올릴까요?",
            "전체 대화방에 이 ${r.kindLabel} 카드가 올라가고, 회원들에게 알림도 갑니다.\n${r.place} · ${AppDate.dateTime(r.teeAt)}",
            "올리기", false) {
            /* `필드를` / `스크린을` — 받침이 있으면 `을`. */
            val label = r.kindLabel
            val josa = if ((label.last().code - 0xac00) % 28 != 0) "을" else "를"
            val body = listOf(
                "${me?.name ?: "누군가"}님이 $label$josa 공유했습니다",
                r.place,
                "${AppDate.day(r.teeAt)} · ${AppDate.time(r.teeAt)} · 정원 ${r.capacity}명" + (if (openSlots > 0) " · ${openSlots}자리 남음" else " · 자리 참")
            ).joinToString("\n")
            if (busy) return@confirm
            busy = true
            launch {
                try { api.shareToChat(body, JSONObject().put("round_id", r.id).put("notify", true), listOf("notify", "round_id")); flash("대화방에 올렸습니다.") }
                catch (e: Exception) { flash(e.message ?: "올리지 못했습니다.", error = true) }
                finally { busy = false }
            }
        }
    }

    private fun deleteSettlement(s: AppSettlement, count: Int) {
        confirm("이 정산을 지울까요?", "${s.title}\n${count}명의 몫이 함께 사라집니다.", "지우기", true) {
            act { api.deleteRow("settlements", s.id); flash("지웠습니다.") }
        }
    }

    // ── 댓글 ─────────────────────────────────────────────────────

    private fun send(text: String) {
        if (busy) return
        busy = true
        launch {
            try {
                api.addComment("round_comments", "round_id", roundId, text)
                commentInput.clear()
                comments = api.roundComments(roundId).map(::AppComment)
                render()
                scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
            } catch (e: Exception) {
                flash(e.message ?: "댓글을 올리지 못했습니다.", error = true)   // 실패하면 적은 글을 남긴다
            } finally { busy = false }
        }
    }

    private fun deleteComment(c: AppComment) {
        confirm("댓글을 지울까요?", "", "지우기", true) { act { api.deleteRow("round_comments", c.id) } }
    }
}
