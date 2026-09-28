package com.kkakkung.app.nativev2

import android.content.Context
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView

/*
 * **정산 현황**(`/settle`) — 아이폰 `SettleViewController.swift`를 코틀린으로 옮긴 것이다.
 * 규칙이 그쪽(그리고 웹 `Settle.tsx`)과 같아야 한다 — 한쪽만 고치지 말 것.
 *
 *  - 최근 30건만 받고, 몫은 딸려 받는다.
 *  - **기본은 `내가 올린 것`.** `전체`는 총무·운영진에게, 남이 올린 것이 실제로 있을 때만.
 *  - 맨 위는 **안 걷힌 금액 하나**(먹색 — 경고가 아니다). 다 걷힌 정산은 빼고 개수만 센다.
 *    **안 낸 사람만** 세우고, 누르면 입금완료다(되돌릴 수 있어 안 묻는다).
 *  - `입금 알림 보내기`는 `settle_reminders`에 한 줄만 — 누구에게 갈지는 발송기가 고른다.
 *    남의 정산이면 그 사람 계좌로 들어간다고 한 번 더 알린다.
 */
class SettleScreen(ctx: Context, host: ScreenHost) : NativeScreen(ctx, host, "정산 현황") {
    private val cards = TabCards(ui)
    private val scroll: ScrollView
    private val stack: LinearLayout
    private var role = "member"
    private var list: List<AppSettlement> = emptyList()
    private var names: Map<String, AppProfile> = emptyMap()
    private var lastSent: Map<String, String> = emptyMap()
    private var place: Map<String, String> = emptyMap()
    private var mineOnly = true
    private val sending = mutableSetOf<String>()
    private var loaded = false

    private val mayAll get() = role == "treasurer" || AppRole.isAdmin(role)   // 웹 `canSettle`

    init {
        val (s, st) = scrollStack(); scroll = s; stack = st
        body.addView(scroll, 0, FrameLayout.LayoutParams(-1, -1))
    }

    override fun load() {
        if (!loaded) spinner.visibility = View.VISIBLE
        launch {
            try {
                list = api.settlements(30).map(::AppSettlement)
                names = api.people().map(::AppProfile).associateBy { it.id }
                role = names[myId]?.role ?: "member"
                if (list.isNotEmpty()) {
                    /* 내림차순이라 **처음 본 것이 가장 최근**이다. 표가 없는 저장소에서는 빈 것이다. */
                    val sent = try {
                        api.rows("settle_reminders", listOf("select" to "settlement_id,created_at",
                            "settlement_id" to "in.(${list.joinToString(",") { it.id }})", "order" to "created_at.desc"))
                    } catch (_: Exception) { emptyList() }
                    val last = mutableMapOf<String, String>()
                    sent.forEach { x -> val k = x.str("settlement_id"); if (k !in last) last[k] = x.str("created_at") }
                    lastSent = last
                    val rounds = try { api.roundNames(list.mapNotNull { it.raw.strOrNull("round_id") }.distinct()) } catch (_: Exception) { emptyMap() }
                    place = list.associate { it.id to (rounds[it.raw.strOrNull("round_id")] ?: "") }
                }
                loaded = true
                render()
            } catch (e: Exception) {
                stack.removeAllViews()
                stack.addView(ui.label(e.message ?: "불러오지 못했습니다.", 15f, bold = true, color = AppSkin.danger, lines = 0))
            }
            spinner.visibility = View.GONE
        }
    }

    private fun render() {
        stack.removeAllViews()
        val mine = list.filter { it.createdBy == myId }
        /* `전체`는 쓸 수 있고, 남이 올린 것이 실제로 있을 때만. */
        val canToggle = mayAll && list.size > mine.size
        val shown = if (canToggle && !mineOnly) list else mine
        val open = shown.filter { s -> s.shares.any { !it.paid } }
        val done = shown.size - open.size

        if (canToggle) stack.addView(cards.segments(listOf("내가 올린 것", "전체"), if (mineOnly) 0 else 1) { mineOnly = it == 0; render() })

        /* **맨 위는 숫자 하나다** — 먼저 알고 싶은 것은 "얼마가 안 걷혔나"다. */
        val sum = ui.card()
        if (open.isEmpty()) sum.addView(ui.label("다 걷혔습니다 👏", 17f, bold = true, color = AppSkin.dim))
        else {
            val unpaid = open.flatMap { s -> s.shares.filter { !it.paid } }
            sum.addView(ui.label(AppDate.won(unpaid.sumOf { it.amount }), 26f, bold = true))
            sum.addView(ui.label("아직 안 걷힘 · ${unpaid.map { it.userId }.toSet().size}명 · 정산 ${open.size}건", 13f, color = AppSkin.dim))
        }
        stack.addView(sum)

        open.forEach { stack.addView(card(it, if (it.createdBy == myId) null else it.createdBy)) }

        if (done > 0) stack.addView(ui.label("다 걷힌 정산 ${done}건은 여기 안 나옵니다.", 12f, color = AppSkin.faint, lines = 0).apply { gravity = Gravity.CENTER })
        if (shown.isEmpty()) stack.addView(ui.label(
            if (canToggle) "내가 올린 정산이 없습니다.\n남이 올린 것은 위의 전체에서 봅니다."
            else "아직 만든 정산이 없습니다.\n라운드에 들어가 ＋ 정산을 눌러 주세요.", 14f, color = AppSkin.faint, lines = 0).apply { gravity = Gravity.CENTER })
    }

    private fun card(s: AppSettlement, by: String?): View {
        val c = ui.card()
        val shares = s.shares
        val unpaid = shares.filter { !it.paid }
        val paid = shares.size - unpaid.size

        /* **제목 줄이 라운드로 가는 문이다** — 한 낱말만 링크면 손가락에 안 잡힌다. */
        val rid = s.raw.strOrNull("round_id").orEmpty()
        c.addView(ui.label(ui.rich(Triple(s.title, 16f, true to AppSkin.text), Triple("  ›", 16f, true to AppSkin.faint)), 16f).apply {
            minHeight = ui.dp(36); gravity = Gravity.CENTER_VERTICAL
            ellipsize = android.text.TextUtils.TruncateAt.MIDDLE
            isClickable = true
            setOnClickListener { if (rid.isNotEmpty()) host.open("/rounds/$rid") }
        })
        val w = place[s.id].orEmpty()
        c.addView(ui.label(ui.rich(
            Triple((if (w.isEmpty()) "" else "$w · ") + "총 ${AppDate.won(s.total)} · $paid/${shares.size}명 보냄", 13f, false to AppSkin.dim),
            Triple(" · ${AppDate.ago(s.createdAt)}", 12f, false to AppSkin.faint)), 13f, lines = 0))

        /* **남이 올린 것이면 누구 것인지 적는다** — 돈이 그 사람 계좌로 들어간다. */
        if (by != null) {
            val p = names[by]
            c.addView(ui.hrow(listOf(ui.avatar(p, 24), ui.label("${p?.name ?: "알 수 없음"}님이 올림", 13f, bold = true, color = AppSkin.warn))))
        }

        /* **안 낸 사람만 세운다. 누를 수 있다고 미리 적어 둔다.** */
        c.addView(ui.label(ui.rich(Triple("안 내신 ${unpaid.size}명", 14f, true to AppSkin.text), Triple(" · 눌러서 입금완료", 12f, false to AppSkin.faint)), 14f))
        unpaid.forEach { c.addView(chip(it)) }

        val when_ = ui.label(lastSent[s.id]?.let { "마지막 알림 ${AppDate.ago(it)}" } ?: "아직 안 보냈습니다", 12f, color = AppSkin.faint)
        val busyNow = s.id in sending
        val btn = ui.button(if (busyNow) "보내는 중…" else "입금 알림 보내기") { remind(s, unpaid.size, by) }.apply { isEnabled = !busyNow }
        c.addView(LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            addView(when_, LinearLayout.LayoutParams(0, -2, 1f))
            addView(btn, LinearLayout.LayoutParams(-2, -2).apply { marginStart = ui.dp(8) })
        })
        return c
    }

    /** 안 낸 사람 한 줄 — 누르면 입금완료(현금으로 받았을 때). 되돌릴 수 있으니 안 묻는다. */
    private fun chip(x: AppShare): View {
        val p = names[x.userId]
        return LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            background = ui.rounded(AppSkin.surface2, AppSkin.radiusSm)
            setPadding(ui.dp(10), ui.dp(7), ui.dp(12), ui.dp(7))
            minimumHeight = ui.dp(42)
            addView(ui.avatar(p, 26))
            addView(ui.label(p?.label?.ifEmpty { null } ?: "알 수 없음", 14f, bold = true), LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = ui.dp(8); marginEnd = ui.dp(8) })
            addView(ui.label(AppDate.won(x.amount), 14f, bold = true))
            addView(ui.label("✓", 14f, bold = true, color = AppSkin.faint), LinearLayout.LayoutParams(-2, -2).apply { marginStart = ui.dp(8) })
            isClickable = true
            contentDescription = "${p?.name ?: "알 수 없음"} 입금완료로 바꾸기"
            ui.pressable(this)
            setOnClickListener {
                launch {
                    try { api.markSharePaid(x.id, true); flash("${p?.name ?: "이 분"} 입금완료로 바꿨습니다."); load() }
                    catch (e: Exception) { flash(e.message ?: "바꾸지 못했습니다.", error = true) }
                }
            }
        }
    }

    /* **한 줄 넣으면 발송기가 안 낸 사람만 골라 보낸다.** */
    private fun remind(s: AppSettlement, unpaid: Int, by: String?) {
        var detail = "아직 안 내신 ${unpaid}명에게만 갑니다.\n이미 보내신 분에게는 가지 않습니다."
        if (by != null) detail += "\n\n${names[by]?.name ?: "다른 분"}님이 올린 정산입니다.\n돈은 그분 계좌로 들어갑니다."
        confirm("입금 알림을 보낼까요?", detail, "보내기", false) {
            sending.add(s.id); render()
            launch {
                try { api.remindSettlement(s.id); sending.remove(s.id); flash("${unpaid}명에게 보냈습니다."); load() }
                catch (e: Exception) { sending.remove(s.id); render(); flash(e.message ?: "보내지 못했습니다.", error = true) }
            }
        }
    }
}
