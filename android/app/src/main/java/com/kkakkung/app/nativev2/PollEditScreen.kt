package com.kkakkung.app.nativev2

import android.content.Context
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.Switch
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZonedDateTime

/*
 * **투표 만들기·고치기** — 아이폰 `PollEditViewController.swift`를 코틀린으로 옮긴 것이다.
 * 규칙이 그쪽(그리고 웹 `PollEdit.tsx`)과 같아야 한다 — 한쪽만 고치지 말 것.
 *
 *  - 누구나 올리고, 고치는 것은 **올린 사람과 운영진**만.
 *  - **표가 하나라도 들어오면 `익명`·`복수 선택`이 잠긴다.**
 *  - 항목은 두 개 이상 · 같은 글자 두 번 안 됨. **두 줄까지 줄면 지우는 대신 글자만 비운다.**
 *    표가 있는 항목을 지우면 몇 표가 사라지는지 한 번 더 묻는다.
 *  - **마감 시각은 필수** · 새 투표는 7일 뒤 21:00이 처음부터 떠 있다 · 새로 올릴 때만 지난 시각을 막는다.
 *  - 날짜를 누르면 `10월 4일 (일)` 항목이 되고 다시 누르면 빠진다. **빈 줄부터 채운다.**
 *  - 고칠 때는 안 바뀐 항목에 쓰기를 안 보내고, `sort`는 보이는 차례로 다시 매긴다.
 *  - 새로 올리다 항목이 실패하면 **껍데기 투표를 지운다.**
 */
class PollEditScreen(ctx: Context, host: ScreenHost, private val given: JSONObject?) :
    FormScreen(ctx, host, if (given == null) "투표 만들기" else "투표 수정") {
    private class Row(val id: String?, var label: String, val votes: Int)

    private val poll = given?.let(::AppPoll)
    private var role = "member"
    private var rows = mutableListOf<Row>()
    private var initial = listOf<Row>()
    private val dropped = mutableListOf<String>()

    private val titleField = textField("예) 9월 정기 라운드 날짜", 80)
    private val bodyField = textArea(70, 500)
    private val optionsStack = ui.vstack(8)
    private val cal = DayCal(ui)
    private var multiSwitch: Switch? = null
    private var anonSwitch: Switch? = null
    private val whenPick = WhenPicker(ui, 21, 0, listOf("3일 후" to 3, "7일 후" to 7, "2주 후" to 14))
    private val saveTitle get() = if (poll == null) "투표 올리기" else "저장"
    private val locked get() = poll != null && initial.sumOf { it.votes } > 0

    override fun load() {
        if (built) return
        spinner.visibility = View.VISIBLE
        launch {
            role = try { api.profile()?.strOrNull("role") ?: "member" } catch (_: Exception) { "member" }
            poll?.let { p -> initial = p.options.map { Row(it.id, it.label, p.count(it.id)) } }
            build()
        }
    }

    private fun build() {
        built = true
        val p = poll
        if (p != null && p.createdBy != myId && !AppRole.isAdmin(role)) { showNotice("올린 사람만 고칠 수 있습니다."); return }
        rows = if (initial.isEmpty()) mutableListOf(Row(null, "", 0), Row(null, "", 0)) else initial.map { Row(it.id, it.label, it.votes) }.toMutableList()
        titleField.setText(p?.title.orEmpty())
        bodyField.setText(p?.body.orEmpty())
        card(listOf(field("무엇을 물어볼까요?", titleField), field("설명 (선택)", bodyField)))

        val add = ui.button("+ 항목 추가", AppSkin.dim) { rows.add(Row(null, "", 0)); renderRows() }
        /* 칠해진 날 = 항목에 있는 날(웹 `marked`와 같은 잣대 — 항목이 곧 진실이다). */
        cal.marked = { d -> rows.any { r -> r.label.trim() == WhenPicker.dayLabel(d) } }
        cal.onToggle = { d -> dayTapped(d) }
        val parts = mutableListOf<View>(ui.label("항목", 13f, bold = true, color = AppSkin.dim), optionsStack, add,
            /* 사용자가 정한 문구다(`날짜를 선택하면 자동입력됩니다. 이멘트로 변경해줘`). */
            ui.label("📅 날짜를 선택하면 자동입력됩니다.", 14f, bold = true, lines = 0), cal,
            ui.label("다시 누르면 항목에서 빠집니다.", 12f, color = AppSkin.faint, lines = 0))
        if (locked) parts.add(ui.label("항목 글자를 고치면 이미 그 항목을 고른 분들의 표가 그대로 따라갑니다.", 12f, color = AppSkin.faint, lines = 0))
        card(parts, spacing = 10)

        val lockedDesc = "표가 들어와 바꿀 수 없습니다"
        val (mRow, mSw) = switchRow("복수 선택", if (locked) lockedDesc else "되는 날짜를 여러 개 고르게 할 때", p?.multi ?: false)
        val (aRow, aSw) = switchRow("익명", if (locked) lockedDesc else "누가 무엇을 골랐는지 숨깁니다", p?.anonymous ?: false)
        mSw.isEnabled = !locked; aSw.isEnabled = !locked
        multiSwitch = mSw; anonSwitch = aSw
        /* **새 투표는 마감 시각이 처음부터 떠 있다**(7일 뒤 21:00). 고치는 투표는 적힌 값 그대로. */
        whenPick.date = if (p != null) AppDate.parse(p.closesAt) else WhenPicker.daysLater(7, 21, 0)
        card(listOf(mRow, aRow, field("마감 시각", whenPick)))

        renderRows()
        showForm(saveTitle)
    }

    // ── 항목 ─────────────────────────────────────────────────────

    private fun renderRows() {
        optionsStack.removeAllViews()
        rows.forEachIndexed { i, r ->
            val f = formText(ui, "항목 ${i + 1}", 60, android.text.InputType.TYPE_CLASS_TEXT)
            f.setText(r.label)
            f.contentDescription = "항목 ${i + 1}"
            f.addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun afterTextChanged(s: Editable?) { r.label = s?.toString().orEmpty(); cal.render() }
            })
            val line = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            line.addView(f, LinearLayout.LayoutParams(0, -2, 1f))
            if (r.votes > 0) line.addView(ui.label("${r.votes}표", 12f, color = AppSkin.faint), LinearLayout.LayoutParams(-2, -2).apply { marginStart = ui.dp(6) })
            /* 댓글 ✕와 같은 작은 표(`smallX` · 흐린 색) — 사용자 제보 `여기 X도 너무커`. */
            line.addView(ui.smallX("항목 ${i + 1} 지우기") { if (rows.size > 2) dropRow(i) {} }.apply {
                alpha = if (rows.size > 2) 1f else .35f
            }, LinearLayout.LayoutParams(ui.dp(40), ui.dp(44)).apply { marginStart = ui.dp(2) })
            optionsStack.addView(line)
        }
        cal.render()
    }

    /** 한 줄을 걷어낸다 — 두 줄까지 줄면 글자만 비운다. 표가 있으면 한 번 더 묻는다. */
    private fun dropRow(i: Int, then: (Boolean) -> Unit) {
        val row = rows.getOrNull(i) ?: return then(false)
        val go = {
            row.id?.let(dropped::add)
            if (rows.size <= 2) rows[i] = Row(null, "", 0) else rows.removeAt(i)
            renderRows()
            then(true)
        }
        if (row.id != null && row.votes > 0) {
            confirm("'${row.label}' 항목을 지울까요?", "이 항목에 들어온 ${row.votes}표가 함께 사라집니다.\n되돌릴 수 없습니다.", "지우기", true) { go() }
        } else go()
    }

    private fun dayTapped(d: LocalDate) {
        val label = WhenPicker.dayLabel(d)
        val at = rows.indexOfFirst { it.label.trim() == label }
        if (at >= 0) { dropRow(at) {}; return }
        /* 같은 글자는 두 번 안 넣고, **빈 줄부터 채운다.** */
        val empty = rows.indexOfFirst { it.label.isBlank() }
        if (empty >= 0) rows[empty] = Row(null, label, 0) else rows.add(Row(null, label, 0))
        renderRows()
    }

    // ── 저장 ─────────────────────────────────────────────────────

    override fun save() {
        if (saving) return
        hideKeyboard()
        val title = text(titleField)
        val kept = rows.map { Row(it.id, it.label.trim(), it.votes) }.filter { it.label.isNotEmpty() }
        if (title.isEmpty()) { flash("제목을 적어 주세요.", error = true); return }
        if (kept.size < 2) { flash("항목을 두 개 이상 적어 주세요.", error = true); return }
        if (kept.map { it.label }.toSet().size != kept.size) { flash("같은 항목이 두 번 있습니다.", error = true); return }
        val closes = whenPick.date ?: run { flash("마감 시각을 정해 주세요.", error = true); return }
        if (poll == null && !closes.isAfter(ZonedDateTime.now(AppDate.seoul))) { flash("마감 시각이 이미 지났습니다. 다시 골라 주세요.", error = true); return }

        val fields = JSONObject().put("title", title).put("body", text(bodyField))
            .put("multi", multiSwitch?.isChecked ?: false).put("anonymous", anonSwitch?.isChecked ?: false)
            .put("closes_at", WhenPicker.iso(closes))
        setSave(saveTitle, true)
        launch {
            try {
                val p = poll
                if (p != null) {
                    api.patchRow("polls", p.id, fields)
                    api.deleteRows("poll_options", dropped)
                    kept.forEachIndexed { i, r ->
                        if (r.id != null) {
                            /* 안 바뀐 줄에는 쓰기를 안 보낸다(글자도 차례도 그대로면). */
                            val at = initial.indexOfFirst { it.id == r.id }
                            if (at == i && initial[at].label == r.label) return@forEachIndexed
                            api.patchRow("poll_options", r.id, JSONObject().put("label", r.label).put("sort", i))
                        } else {
                            api.insertRows("poll_options", JSONArray().put(JSONObject().put("poll_id", p.id).put("label", r.label).put("sort", i)))
                        }
                    }
                    host.back(refreshBehind = true)
                } else {
                    fields.put("created_by", myId)
                    val id = api.insertRows("polls", JSONArray().put(fields)).firstOrNull()?.strOrNull("id")
                        ?: throw NativeApiError("올리지 못했습니다. 다시 시도해 주세요.")
                    try {
                        val opts = JSONArray()
                        kept.forEachIndexed { i, r -> opts.put(JSONObject().put("poll_id", id).put("label", r.label).put("sort", i)) }
                        api.insertRows("poll_options", opts)
                    } catch (e: Exception) {
                        /* 항목이 없는 투표는 쓸모가 없다 — 껍데기를 남기지 않는다. */
                        try { api.deleteRow("polls", id) } catch (_: Exception) {}
                        throw e
                    }
                    host.replaceWith("/polls")   // 웹과 같다 — 목록으로
                }
            } catch (e: Exception) {
                setSave(saveTitle, false)
                flash(e.message ?: "저장하지 못했습니다.", error = true)
            }
        }
    }
}
