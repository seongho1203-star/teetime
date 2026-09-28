package com.kkakkung.app.nativev2

import android.content.Context
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import androidx.appcompat.app.AlertDialog
import org.json.JSONArray
import org.json.JSONObject

/*
 * **정산 만들기** — 아이폰 `SettlementEditViewController.swift`를 코틀린으로 옮긴 것이다.
 * 규칙이 그쪽(그리고 웹 `Settlement.tsx`의 `SettlementForm`)과 같아야 한다 — 한쪽만 고치지 말 것.
 *
 *  - 회원 누구나 만든다. 제목·사람·총금액은 필수, 칸에 예시 글씨를 안 둔다.
 *  - **은행은 목록(`BANKS`)에서 고르고 `직접 입력`을 남긴다.** 은행 136 · 계좌가 나머지 한 줄.
 *  - **고르는 명단은 회원 전체다** — 확정 참가자를 `참가자`로 앞에 세우고 나머지는 `그 외`로
 *    접는다(뒷풀이만 온 사람). 고른 사람이 `그 외`에 있으면 접지 않고, 열둘을 넘으면 찾기 칸.
 *  - **1/N은 10원 단위로 내림, 남는 잔돈은 맨 앞 사람**(`splitEvenly`). 고쳐 적으면 그 사람만
 *    예외로 굳고 나머지가 남은 돈을 다시 나눈다.
 *  - 몫은 **정산을 만든 뒤에** 넣는다 — 그 줄이 들어갈 때 사람마다 제 금액이 알림으로 간다.
 */
class SettlementEditScreen(
    ctx: Context, host: ScreenHost, private val roundId: String,
    private val people: List<AppProfile>, joinedIds: List<String>, private val banks: List<String>,
) : FormScreen(ctx, host, "정산 만들기") {
    private val joined = joinedIds.toSet()
    private val joinedOrder = joinedIds

    private val titleField = textField(max = 60)
    private val bodyField = textArea(60, 300)
    private val bankBtn = ui.label("", 16f).apply {
        gravity = Gravity.CENTER_VERTICAL
        background = ui.rounded(AppSkin.surface, AppSkin.radiusSm, AppSkin.line)
        setPadding(ui.dp(13), 0, ui.dp(10), 0)
        isClickable = true
    }
    private val accountField = textField(max = 40, type = android.text.InputType.TYPE_CLASS_PHONE)
    private val bankEtc = textField(max = 20)
    private lateinit var bankEtcBox: View
    val totalField = WonField(ui)
    private val pickTitle = ui.label("", 13f, bold = true, color = AppSkin.dim)
    private val pickBox = ui.vstack(6)
    private val splitBox = ui.vstack(8)
    private lateinit var splitCard: View
    private val findField = textField(max = 20)
    private val restList = ui.vstack(6)
    private val sumLabel = ui.label("", 12f, color = AppSkin.faint)
    private val allBtn = ui.button("모두 넣기", AppSkin.dim) { allTapped() }

    private var bank = ""
    private var bankOther = false
    private val picked = mutableListOf<String>()
    private val fixed = mutableMapOf<String, Int>()
    private var showRest = false
    private var restWasOpen = false
    private val amountFields = mutableMapOf<String, WonField>()
    private val resetBtns = mutableMapOf<String, View>()
    private val pickViews = mutableMapOf<String, PersonPick>()
    private var typing: String? = null

    private val byId = people.associateBy { it.id }
    private val players get() = joinedOrder.mapNotNull { byId[it] }
    private val rest get() = people.filter { it.id !in joined }
    private val restOpen get() = showRest || rest.any { it.id in picked }

    override fun load() {
        if (built) return
        built = true
        paintBank()
        bankBtn.setOnClickListener { chooseBank() }
        val bankRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(field("입금 은행", bankBtn.also { it.layoutParams = LinearLayout.LayoutParams(-1, ui.dp(44)) }), LinearLayout.LayoutParams(ui.dp(136), -2))
            addView(field("계좌번호", accountField), LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = ui.dp(10) })
        }
        bankEtcBox = field("은행 이름", bankEtc).apply { visibility = View.GONE }
        findField.addTextChangedListener(watch { renderRest() })
        totalField.edit.addTextChangedListener(watch { refreshAmounts(null) })

        card(listOf(field("정산 제목", titleField), field("상세 내용 (선택)", bodyField), bankRow, bankEtcBox, field("총금액", totalField)))
        card(listOf(pickTitle, pickBox), spacing = 8)
        splitCard = card(listOf(splitBox), spacing = 8)
        renderPick()
        renderSplit()
        showForm("정산 보내기")
    }

    private fun watch(f: () -> Unit) = object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        override fun afterTextChanged(s: Editable?) { f() }
    }

    // ── 은행 ─────────────────────────────────────────────────────

    private fun paintBank() {
        bankBtn.text = (if (bankOther) "직접 입력" else bank.ifEmpty { "고르기" }) + "  ▾"
        bankBtn.setTextColor(if (bank.isEmpty() && !bankOther) AppSkin.faint else AppSkin.text)
        if (::bankEtcBox.isInitialized) bankEtcBox.visibility = if (bankOther) View.VISIBLE else View.GONE
    }

    private fun chooseBank() {
        val items = banks + "직접 입력"
        AlertDialog.Builder(ctx)
            .setTitle("입금 은행")
            .setItems(items.toTypedArray()) { _, i ->
                if (i == items.lastIndex) { bankOther = true; bank = ""; bankEtc.setText("") }   // 직접 입력은 비워 준다
                else { bankOther = false; bank = items[i] }
                paintBank()
            }
            .setNegativeButton("취소", null)
            .show()
    }

    // ── 사람 고르기 ───────────────────────────────────────────────

    private fun renderPick() {
        pickBox.removeAllViews()
        pickViews.clear()
        (restList.parent as? android.view.ViewGroup)?.removeView(restList)
        val ps = players
        if (ps.isNotEmpty()) {
            (allBtn.parent as? android.view.ViewGroup)?.removeView(allBtn)
            pickBox.addView(LinearLayout(ctx).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                addView(ui.label("참가자 ${ps.size}명", 12f, color = AppSkin.faint), LinearLayout.LayoutParams(0, -2, 1f))
                addView(allBtn)
            })
            ps.forEach { pickBox.addView(pill(it)) }
        }
        val rs = rest
        restWasOpen = restOpen
        if (rs.isNotEmpty()) {
            if (!restWasOpen) {
                pickBox.addView(ui.hrow(listOf(ui.button("＋ 참가자 외 다른 사람 추가", AppSkin.dim) { showRest = true; renderPick() })))
            } else {
                pickBox.addView(ui.label("그 외 ${rs.size}명 · 뒷풀이만 오신 분도 눌러서 고르세요", 12f, color = AppSkin.faint, lines = 0))
                val big = rs.size > MembersScreen.FIND_AT
                if (big) {
                    (findField.parent as? android.view.ViewGroup)?.let { (it.parent as? android.view.ViewGroup)?.removeView(it) }
                    pickBox.addView(field("이름으로 찾기", findField))
                    /* **감추지 않고 높이만 잡아 둔다**(웹 `.settle-pick.tall`) — 이름을 몰라도 훑어서 고른다. */
                    pickBox.addView(ScrollView(ctx).apply { addView(restList, FrameLayout.LayoutParams(-1, -2)) }, LinearLayout.LayoutParams(-1, ui.dp(190)))
                } else pickBox.addView(restList)
                renderRest()
            }
        }
        paintPicks()
    }

    /** `그 외` 목록만 — 찾는 글자가 바뀔 때 이것만 다시 그린다. */
    private fun renderRest() {
        restList.removeAllViews()
        rest.forEach { pickViews.remove(it.id) }
        val q = findField.text.toString().replace(" ", "").lowercase()
        /* 고른 사람은 검색어와 상관없이 남긴다 — 사라지면 뺀 것처럼 보인다. */
        val shown = if (q.isEmpty()) rest else rest.filter { p ->
            p.id in picked || listOf(p.name, p.region.orEmpty()).any { it.replace(" ", "").lowercase().contains(q) }
        }
        if (shown.isEmpty()) restList.addView(ui.label("'${findField.text}' 님을 못 찾았습니다.", 12f, color = AppSkin.faint))
        shown.forEach { restList.addView(pill(it)) }
        paintPicks()
    }

    private fun paintPicks() {
        pickTitle.text = "정산할 사람 (${picked.size}명)"
        for ((id, v) in pickViews) byId[id]?.let { v.fill(it, id in picked) }
        val all = players.isNotEmpty() && players.all { it.id in picked }
        allBtn.text = if (all) "모두 빼기" else "모두 넣기"
    }

    private fun pill(p: AppProfile): View {
        val c = PersonPick(ui)
        c.fill(p, p.id in picked)
        c.setOnClickListener { toggle(p.id) }
        pickViews[p.id] = c
        return c
    }

    private fun toggle(id: String) {
        if (!picked.remove(id)) picked.add(id)
        /* 뺀 사람의 예외 금액도 같이 지운다 — 안 그러면 다시 넣을 때 살아난다. */
        fixed.remove(id)
        if (restOpen != restWasOpen) renderPick() else paintPicks()
        renderSplit()
    }

    internal fun allTapped() {
        val ids = players.map { it.id }
        if (ids.all { it in picked }) { picked.removeAll(ids); ids.forEach(fixed::remove) }
        else ids.forEach { if (it !in picked) picked.add(it) }
        if (restOpen != restWasOpen) renderPick() else paintPicks()
        renderSplit()
    }

    // ── 1/N ──────────────────────────────────────────────────────

    private val amounts get() = splitEvenly(totalField.won, picked, fixed)

    private fun renderSplit() {
        splitBox.removeAllViews()
        amountFields.clear(); resetBtns.clear()
        if (::splitCard.isInitialized) splitCard.visibility = if (picked.isEmpty()) View.GONE else View.VISIBLE
        if (picked.isEmpty()) return
        splitBox.addView(ui.label("1/N — 고쳐 적으면 그 사람만 예외가 됩니다", 13f, bold = true, color = AppSkin.dim, lines = 0))
        for (id in picked) {
            val f = WonField(ui)
            f.edit.addTextChangedListener(watch {
                if (typing != null) return@watch    // 우리가 넣는 값에는 반응하지 않는다
                if (!f.edit.hasFocus()) return@watch
                fixed[id] = f.won
                refreshAmounts(id)
            })
            val reset = ui.button("1/N로", AppSkin.dim) { fixed.remove(id); refreshAmounts(null) }
            amountFields[id] = f; resetBtns[id] = reset
            splitBox.addView(LinearLayout(ctx).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                addView(ui.label(byId[id]?.label ?: "알 수 없음", 14f), LinearLayout.LayoutParams(0, -2, 1f))
                addView(f, LinearLayout.LayoutParams(ui.dp(126), -2).apply { marginStart = ui.dp(8) })
                addView(reset, LinearLayout.LayoutParams(-2, -2).apply { marginStart = ui.dp(8) })
            })
        }
        splitBox.addView(sumLabel)
        refreshAmounts(null)
    }

    /** 금액만 갈아 끼운다 — 치는 중인 칸은 안 건드린다(다시 만들면 초점이 날아간다). */
    private fun refreshAmounts(except: String?) {
        val a = amounts
        typing = except ?: ""
        for ((id, f) in amountFields) if (id != except) f.setWon(a[id] ?: 0)
        typing = null
        for ((id, b) in resetBtns) b.visibility = if (id in fixed) View.VISIBLE else View.GONE
        sumLabel.text = "합계 ${AppDate.won(a.values.sum())} / 총 ${AppDate.won(totalField.won)}"
    }

    // ── 보내기 ───────────────────────────────────────────────────

    override fun save() {
        if (saving) return
        hideKeyboard()
        val title = text(titleField)
        if (title.isEmpty()) { flash("정산 제목을 적어 주세요.", error = true); return }
        if (picked.isEmpty()) { flash("정산할 사람을 골라 주세요.", error = true); return }
        val total = totalField.won
        if (total <= 0) { flash("총금액을 적어 주세요.", error = true); return }
        val bankName = (if (bankOther) bankEtc.text.toString() else bank).trim()
        val a = amounts
        val ids = picked.toList()
        setSave("정산 보내기", true)
        launch {
            try {
                val sid = api.insertRows("settlements", JSONArray().put(JSONObject()
                    .put("round_id", roundId).put("title", title).put("body", text(bodyField))
                    .put("bank", bankName).put("account", text(accountField))
                    .put("total", total).put("created_by", myId))).firstOrNull()?.strOrNull("id")
                    ?: throw NativeApiError("정산을 만들지 못했습니다. 다시 시도해 주세요.")
                val shares = JSONArray()
                ids.forEach { shares.put(JSONObject().put("settlement_id", sid).put("user_id", it).put("amount", a[it] ?: 0)) }
                api.insertRows("settlement_shares", shares)
                host.back(refreshBehind = true)
            } catch (e: Exception) {
                setSave("정산 보내기", false)
                flash(e.message ?: "정산을 만들지 못했습니다.", error = true)
            }
        }
    }

    companion object {
        /** 웹 `splitEvenly`와 같은 셈 — 10원 단위 내림 · 잔돈은 맨 앞 사람. **한쪽만 고치지 말 것.** */
        fun splitEvenly(total: Int, ids: List<String>, fixed: Map<String, Int>): Map<String, Int> {
            val out = mutableMapOf<String, Int>()
            val free = ids.filter { it !in fixed }
            val used = ids.sumOf { fixed[it] ?: 0 }
            val restMoney = maxOf(0, total - used)
            ids.forEach { id -> fixed[id]?.let { out[id] = it } }
            if (free.isEmpty()) return out
            val each = restMoney / free.size / 10 * 10
            free.forEach { out[it] = each }
            val left = restMoney - each * free.size
            if (left > 0) out[free[0]] = (out[free[0]] ?: 0) + left
            return out
        }
    }
}

/** 고르는 줄 하나(웹 `.settle-pill` · 아이폰 `PersonPick`) — 얼굴 · 이름표 · 오른쪽 체크. 켜지면 분홍 테두리. */
class PersonPick(private val ui: Ui) : LinearLayout(ui.ctx) {
    private val faceBox = FrameLayout(ui.ctx)
    private val name = ui.label("", 14f, bold = true)
    private val check = ui.label("✓", 16f, bold = true, color = AppSkin.brandDeep)

    init {
        orientation = HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        minimumHeight = ui.dp(44)
        setPadding(ui.dp(10), 0, ui.dp(12), 0)
        isClickable = true
        addView(faceBox, LayoutParams(ui.dp(26), ui.dp(26)))
        addView(name, LayoutParams(0, -2, 1f).apply { marginStart = ui.dp(9); marginEnd = ui.dp(8) })
        addView(check)
        layoutParams = LayoutParams(-1, ui.dp(44))
    }

    fun fill(p: AppProfile, on: Boolean) {
        if (faceBox.childCount == 0) faceBox.addView(ui.avatar(p, 26), FrameLayout.LayoutParams(-1, -1))
        name.text = p.label.ifEmpty { "알 수 없음" }
        name.setTextColor(if (on) AppSkin.text else AppSkin.dim)
        background = ui.rounded(if (on) AppSkin.alpha(AppSkin.brand, .1f) else AppSkin.surface, AppSkin.radiusSm,
            if (on) AppSkin.brandDeep else AppSkin.line)
        check.visibility = if (on) View.VISIBLE else View.INVISIBLE
        contentDescription = name.text
        isSelected = on
    }
}
