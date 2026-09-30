package com.kkakkung.app.nativev2

import android.app.TimePickerDialog
import android.content.Context
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalTime

/*
 * **모집 열기·고치기** — 아이폰 `RoundEditViewController.swift`를 코틀린으로 옮긴 것이다.
 * 규칙이 그쪽(그리고 웹 `RoundEdit.tsx`)과 같아야 한다 — 한쪽만 고치지 말 것.
 *
 *  - 누구나 열고, 고치는 것은 **연 사람과 운영진**만.
 *  - **맨 위에서 종류(필드·스크린)부터 고른다** — 아래 칸의 말과 있고 없음이 여기서 갈린다.
 *  - 캐디·카트는 **한 줄에 하나만**, 누른 것을 다시 누르면 '안 정함'.
 *  - **스크린으로 저장하면 캐디·카트·좌표를 지운다**(`RoundFormRules.payload`).
 *    같은 골프장을 그대로 두면 목록 밖 곳이라도 원래 좌표를 지킨다.
 *  - 필드는 **골프장 목록에서 찾아 준다**(`assets/courses.json` — 웹 `lib/courses.ts`에서 빌드 때 뽑는다).
 *  - 날짜·시각 칸은 **처음부터 펴 있다** — 새로 열면 내일 07:00, 베끼면 내일 + 원래 시·분.
 *  - 팀별 코스·시각(`tee_slots`) — 필드에만. **적은 차례가 곧 조 번호**라 정렬하지 않는다.
 *    가장 이른 팀이 곧 티오프다. 팀이 없고 원래 칸도 없던 라운드는 그 칸을 안 싣는다.
 *  - 저장하면 새 모집은 그 라운드로 **바꿔치기**, 고친 것은 뒤로.
 */
class RoundEditScreen(
    ctx: Context, host: ScreenHost, private val base: JSONObject?, private val copy: Boolean,
    courses: List<JSONObject>? = null,
    clubs: Map<String, List<String>>? = null,
) : FormScreen(ctx, host, if (base == null || copy) "모집 열기" else "라운드 수정") {
    private val book = CourseBook(courses ?: loadCourses(ctx))
    private val editing get() = base != null && !copy
    private var role = "member"
    private var kind = "field"
    private var caddie: String? = null
    private var cart: String? = null
    private val screen get() = kind == "screen"

    private val fieldBtn = OptButton(ui, "⛳ 필드")
    private val screenBtn = OptButton(ui, "🎯 스크린")
    private val placeName = ui.label("", 13f, bold = true, color = AppSkin.dim)
    private val courseField = textField(max = 40)
    private val hits = ui.vstack(0).apply { visibility = View.GONE }
    /* 코스(`rounds.sub_course` · 사용자 요청 — `골프장칸을 절반으로하고 그 자리에 코스를`).
       골프장과 섞지 않는다. 칩은 `assets/clubs.json`(웹 `lib/clubs.ts`) — 누를 때마다 켜지고
       꺼지며 **고른 차례가 곧 전·후반**이다(아이폰 `RoundEditViewController`와 같다). */
    private val subField = textField(max = 30)
    private val subCol = ui.vstack(6)
    private val subChips = ui.vstack(8).apply { visibility = View.GONE }
    private val clubs: Map<String, List<String>> by lazy { clubs ?: loadClubs(ctx) }
    private val placeNote = ui.label("", 12f, color = AppSkin.faint, lines = 0)
    private val condBox = ui.vstack(8)
    private val caddieBtn = OptButton(ui, "캐디")
    private val noCaddieBtn = OptButton(ui, "노캐디")
    private val cartInBtn = OptButton(ui, "카트 포함")
    private val cartOutBtn = OptButton(ui, "카트 미포함")
    private val teeName = ui.label("", 13f, bold = true, color = AppSkin.dim)
    private val whenPick = WhenPicker(ui, 7, 0)
    private val capField = textField(max = 3, type = InputType.TYPE_CLASS_NUMBER)
    private val feeName = ui.label("", 13f, bold = true, color = AppSkin.dim)
    val feeField = WonField(ui).apply { edit.contentDescription = "1인 비용" }
    private val noteField = textArea(90, 1000)

    private class Slot(val view: LinearLayout, val no: TextView, val course: EditText, var time: LocalTime, val timeBtn: TextView)
    private val slots = mutableListOf<Slot>()
    private val slotsWrap = ui.vstack(8)
    private val slotsBox = ui.vstack(8)
    private val slotsHint = ui.label("", 12f, color = AppSkin.faint, lines = 0)
    private val saveTitle get() = if (editing) "수정 저장" else "모집 열기"

    override fun load() {
        if (built) return
        spinner.visibility = View.VISIBLE
        launch {
            role = try { api.profile()?.strOrNull("role") ?: "member" } catch (_: Exception) { "member" }
            build()
        }
    }

    internal fun build() {
        built = true
        if (editing && base?.strOrNull("created_by") != myId && !AppRole.isAdmin(role)) {
            showNotice("올린 사람만 고칠 수 있습니다."); return
        }
        kind = if (base?.strOrNull("kind") == "screen") "screen" else "field"
        caddie = base?.strOrNull("caddie")?.takeIf { it == "caddie" || it == "none" }
        cart = base?.strOrNull("cart")?.takeIf { it == "included" || it == "excluded" }
        courseField.setText(base?.strOrNull("course").orEmpty())
        subField.setText(base?.strOrNull("sub_course").orEmpty())
        whenPick.date = RoundFormRules.initialDate(base, copy)
        capField.setText((base?.optInt("capacity", 4)?.takeIf { it > 0 } ?: 4).toString())
        feeField.setWon(base?.optInt("fee") ?: 0)
        noteField.setText(base?.strOrNull("note").orEmpty())

        /* 베껴 온 것이라고 밝혀 둔다 — 안 그러면 고치는 화면처럼 보여 원본을 건드리는 줄 안다. */
        if (copy && base != null) {
            stack.addView(ui.label(ui.rich(
                Triple(base.strOrNull("course")?.ifBlank { null } ?: "지난 모집", 14f, true to AppSkin.text),
                Triple("의 조건을 그대로 가져왔습니다.\n날짜를 확인하면 새 모집으로 열립니다.", 14f, false to AppSkin.text)), 14f, lines = 0).apply {
                background = ui.rounded(AppSkin.surface2, AppSkin.radiusSm)
                setPadding(ui.dp(13), ui.dp(11), ui.dp(13), ui.dp(11))
            })
        }

        fieldBtn.setOnClickListener { kind = "field"; refreshKind() }
        screenBtn.setOnClickListener { kind = "screen"; refreshKind() }

        courseField.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        courseField.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: Editable?) { if (courseField.hasFocus()) refreshPlace(true); refreshSubChips() }
        })
        subField.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        subField.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: Editable?) { if (subField.hasFocus()) refreshSubChips() }
        })
        hits.background = ui.rounded(AppSkin.surface, AppSkin.radiusSm, AppSkin.line)
        hits.clipToOutline = true
        val clubCol = ui.vstack(6).apply { addView(placeName); addView(courseField) }
        subCol.addView(ui.label("코스", 13f, bold = true, color = AppSkin.dim)); subCol.addView(subField)
        val placeBox = ui.vstack(6).apply { addView(equalRow(ui, listOf(clubCol, subCol), 10)); addView(hits); addView(subChips); addView(placeNote) }

        caddieBtn.setOnClickListener { caddie = if (caddie == "caddie") null else "caddie"; refreshKind() }
        noCaddieBtn.setOnClickListener { caddie = if (caddie == "none") null else "none"; refreshKind() }
        cartInBtn.setOnClickListener { cart = if (cart == "included") null else "included"; refreshKind() }
        cartOutBtn.setOnClickListener { cart = if (cart == "excluded") null else "excluded"; refreshKind() }
        condBox.addView(ui.label("라운드 조건 (선택)", 13f, bold = true, color = AppSkin.dim))
        condBox.addView(equalRow(ui, listOf(caddieBtn, noCaddieBtn), 10))
        condBox.addView(equalRow(ui, listOf(cartInBtn, cartOutBtn), 10))

        val teeBox = ui.vstack(6).apply { addView(teeName); addView(whenPick) }
        val feeBox = ui.vstack(6).apply { addView(feeName); addView(feeField) }
        val numRow = equalRow(ui, listOf(field("정원", capField), feeBox), 10)

        buildSlots(base?.let(RoundFormRules::slots).orEmpty())

        card(listOf(field("종류", equalRow(ui, listOf(fieldBtn, screenBtn), 10)), placeBox, condBox, teeBox, slotsWrap, numRow,
            field("전달 내용 (선택)", noteField)))
        refreshKind()
        showForm(saveTitle)
    }

    /** 종류가 바뀌면 말과 있고 없음을 맞춘다. */
    private fun refreshKind() {
        fieldBtn.on = !screen; screenBtn.on = screen
        placeName.text = if (screen) "매장" else "골프장"
        courseField.hint = if (screen) "예) 신용DS" else "예) 무등산CC"
        teeName.text = "${if (screen) "시작" else "티오프"} (한국 시각)"
        feeName.text = "1인 ${if (screen) "게임비" else "그린피"}"
        condBox.visibility = if (screen) View.GONE else View.VISIBLE
        slotsWrap.visibility = if (screen) View.GONE else View.VISIBLE
        subCol.visibility = if (screen) View.GONE else View.VISIBLE
        refreshSubChips()
        refreshSlots()
        caddieBtn.on = caddie == "caddie"; noCaddieBtn.on = caddie == "none"
        cartInBtn.on = cart == "included"; cartOutBtn.on = cart == "excluded"
        refreshPlace(false)
    }

    /** 그 골프장의 코스 칩 — 한 줄에 셋. 표에 없는 골프장이면 칩 없이 칸만 남는다. */
    private fun refreshSubChips() {
        subChips.removeAllViews()
        val list = if (screen) emptyList() else clubs[RoundFormRules.clubKey(courseField.text.toString())].orEmpty()
        subChips.visibility = if (list.isEmpty()) View.GONE else View.VISIBLE
        val on = RoundFormRules.picked(subField.text.toString())
        list.chunked(3).forEach { row ->
            val views = row.map { name ->
                OptButton(ui, name).apply {
                    val i = on.indexOf(name)
                    mark = if (i >= 0) (i + 1).toString() else null
                    this.on = i >= 0
                    setOnClickListener {
                        subField.setText(RoundFormRules.toggle(subField.text.toString(), name))
                        refreshSubChips()
                    }
                } as View
            } + List(3 - row.size) { View(ctx) }
            subChips.addView(equalRow(ui, views, 10))
        }
    }

    /** 찾은 곳 목록과 아래 안내 한 줄(웹 `course-hits`). */
    private fun refreshPlace(showHits: Boolean) {
        val typed = courseField.text.toString()
        val trimmed = typed.trim()
        hits.removeAllViews()
        val list = if (screen || !showHits || book.geo(typed)?.optString("name") == trimmed) emptyList() else book.search(typed)
        list.forEachIndexed { i, c ->
            if (i > 0) hits.addView(View(ctx).apply { setBackgroundColor(AppSkin.line) }, LinearLayout.LayoutParams(-1, ui.dp(1)))
            hits.addView(ui.label(c.optString("name"), 15f, bold = true).apply {
                setPadding(ui.dp(13), ui.dp(11), ui.dp(13), ui.dp(11))
                isClickable = true
                ui.pressable(this)
                setOnClickListener {
                    /* 골프장을 바꾸면 골라 둔 코스를 비운다 — 안 비우면 어등산인데 마제스티가 붙은 채 저장된다. */
                    if (RoundFormRules.clubKey(c.optString("name")) != RoundFormRules.clubKey(courseField.text.toString())) subField.setText("")
                    courseField.setText(c.optString("name"))
                    courseField.setSelection(courseField.text.length)
                    refreshPlace(false)
                    hideKeyboard()
                }
            })
        }
        hits.visibility = if (list.isEmpty()) View.GONE else View.VISIBLE
        placeNote.text = when {
            screen -> "실내라 날씨는 표시되지 않습니다"
            trimmed.isEmpty() -> ""
            book.geo(typed) != null -> "날씨가 함께 표시됩니다"
            else -> "목록에 없는 곳입니다 — 날씨는 표시되지 않습니다"
        }
        placeNote.visibility = if (placeNote.text.isEmpty()) View.GONE else View.VISIBLE
    }

    // ── 팀별 코스·시각 ───────────────────────────────────────────

    private fun buildSlots(initial: List<JSONObject>) {
        slotsWrap.addView(ui.label("2팀 이상일 경우 입력(선택)", 13f, bold = true, color = AppSkin.dim))
        slotsWrap.addView(slotsBox)
        slotsWrap.addView(ui.hrow(listOf(ui.button("＋ 팀 추가") { addSlotTapped() })))
        slotsWrap.addView(slotsHint)
        initial.forEach { addSlot(it.optString("course"), LocalTime.parse(it.optString("time"))) }
    }

    private fun addSlot(course: String, time: LocalTime) {
        val n = slots.size + 1
        val no = ui.label("${n}팀", 14f, bold = true)
        val c = formText(ui, "코스", 20, InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS).apply {
            setText(course); contentDescription = "${n}팀 코스"
        }
        val timeBtn = ui.label("", 16f).apply {
            gravity = Gravity.CENTER
            background = ui.rounded(AppSkin.surface2, AppSkin.radiusSm)
            setPadding(ui.dp(12), 0, ui.dp(12), 0)
            isClickable = true
        }
        val row = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val slot = Slot(row, no, c, time, timeBtn)
        fun paintTime() { timeBtn.text = "%02d:%02d".format(slot.time.hour, slot.time.minute); timeBtn.contentDescription = "${slots.indexOf(slot) + 1}팀 시각" }
        timeBtn.setOnClickListener {
            TimePickerDialog(ctx, { _, h, m -> slot.time = LocalTime.of(h, m); paintTime(); refreshSlots() }, slot.time.hour, slot.time.minute, false).show()
        }
        paintTime()
        row.addView(no, LinearLayout.LayoutParams(ui.dp(34), -2))
        /* 코스 이름 다섯 글자가 한눈에 들어가는 폭 — 글자 수에 따라 칸이 들쭉날쭉하지 않게. */
        row.addView(c, LinearLayout.LayoutParams(ui.dp(116), -2).apply { marginStart = ui.dp(6) })
        row.addView(View(ctx), LinearLayout.LayoutParams(0, 1, 1f))
        row.addView(timeBtn, LinearLayout.LayoutParams(-2, ui.dp(40)))
        row.addView(ui.smallX("${n}팀 지우기") { removeSlot(slot) }, LinearLayout.LayoutParams(ui.dp(32), ui.dp(40)))
        slots.add(slot)
        slotsBox.addView(row)
    }

    /** 새 팀은 **앞 팀의 코스를 그대로 · 7분 뒤**로 시작한다. 첫 팀은 위 티오프 시각에서. */
    private fun addSlotTapped() {
        val last = slots.lastOrNull()
        if (last != null) addSlot(last.course.text.toString(), last.time.plusMinutes(7))
        else addSlot("", whenPick.date?.toLocalTime()?.withSecond(0)?.withNano(0) ?: LocalTime.of(7, 0))
        refreshSlots()
    }

    private fun removeSlot(s: Slot) {
        slotsBox.removeView(s.view)
        slots.remove(s)
        /* 번호를 다시 매긴다 — 가운데를 지우면 `1팀 · 3팀`처럼 구멍이 난다. */
        slots.forEachIndexed { k, r -> r.no.text = "${k + 1}팀"; r.course.contentDescription = "${k + 1}팀 코스" }
        refreshSlots()
    }

    private fun refreshSlots() {
        val n = slots.size
        if (n == 0) {
            slotsHint.text = "한 골프장에서 코스를 나눠 여러 팀이 나갈 때 적어 두세요. 조 편성 때 1조부터 이 차례대로 시각이 채워집니다."
            return
        }
        val first = slots.minOf { it.time }
        slotsHint.text = "${n}팀 · 한 팀 4명이면 ${n * 4}명 — 가장 이른 ${"%02d:%02d".format(first.hour, first.minute)}이 ${if (screen) "시작" else "티오프"} 시각으로 저장됩니다. 팀 차례가 곧 조 번호입니다."
    }

    // ── 저장 ─────────────────────────────────────────────────────

    /** 칸들을 DB에 넣을 모양으로 — 틀린 것이 있으면 알리고 null. */
    internal fun payload(): JSONObject? {
        val tee = whenPick.date ?: run { flash("${if (screen) "시작" else "티오프"} 시각을 골라 주세요.", error = true); return null }
        val course = text(courseField)
        if (course.isEmpty()) { flash("${if (screen) "매장" else "골프장"} 이름을 적어 주세요.", error = true); return null }
        val cap = text(capField).toIntOrNull()?.takeIf { it >= 1 } ?: run { flash("정원은 1명 이상이어야 합니다.", error = true); return null }
        val teams = if (screen) emptyList() else slots.map {
            JSONObject().put("course", it.course.text.toString().trim()).put("time", "%02d:%02d".format(it.time.hour, it.time.minute))
        }
        return RoundFormRules.payload(base, screen, course, tee, cap, feeField.won, text(noteField),
            caddie, cart, if (screen) null else book.geo(course), teams, text(subField))
    }

    override fun save() {
        if (saving) return
        hideKeyboard()
        val row = payload() ?: return
        setSave(saveTitle, true)
        launch {
            try {
                if (editing) {
                    api.updateRound(base!!.str("id"), row)
                    host.back(refreshBehind = true)
                } else {
                    val id = api.createRound(row)
                    host.replaceWith("/rounds/$id")
                }
            } catch (e: Exception) {
                setSave(saveTitle, false)
                flash(e.message ?: "저장하지 못했습니다.", error = true)
            }
        }
    }

    companion object {
        /** 골프장 목록 — 빌드 때 `.dev/native-guide.mjs`가 웹 `lib/courses.ts`에서 뽑아 담는다. */
        /** 골프장마다의 코스 — 빌드 때 웹 `lib/clubs.ts`에서 뽑는다(`clubs.json`). */
        fun loadClubs(ctx: Context): Map<String, List<String>> = try {
            val o = JSONObject(ctx.assets.open("clubs.json").bufferedReader().use { it.readText() })
            o.keys().asSequence().associateWith { k -> o.optJSONArray(k).let { a -> (0 until (a?.length() ?: 0)).map { a!!.optString(it) } } }
        } catch (_: Exception) { emptyMap() }
        fun loadCourses(ctx: Context): List<JSONObject> = try {
            JSONArray(ctx.assets.open("courses.json").bufferedReader().use { it.readText() }).objects()
        } catch (_: Exception) { emptyList() }
    }
}
