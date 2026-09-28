package com.kkakkung.app.nativev2

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.content.Context
import android.graphics.Typeface
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.widget.*
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Native form; edits stay in these views until a successful save. */
internal class NativeRoundEditor(context: Context, private val base: JSONObject?, copy: Boolean,
                                 private val save: (JSONObject, Button) -> Unit) : LinearLayout(context) {
    private fun dp(n: Int) = (n * resources.displayMetrics.density).toInt()
    private fun nullable(key: String) = base?.optString(key)?.takeIf { it.isNotBlank() && it != "null" }
    private var screen = base?.optString("kind") == "screen"
    private var caddie = nullable("caddie")
    private var cart = nullable("cart")
    private var tee = RoundFormRules.initialDate(base, copy)
    private val book: CourseBook
    private val course = EditText(context)
    private val hits = LinearLayout(context).apply { orientation = VERTICAL }
    private val conditions = LinearLayout(context).apply { orientation = VERTICAL }
    private val teams = LinearLayout(context).apply { orientation = VERTICAL }
    private val slotBox = LinearLayout(context).apply { orientation = VERTICAL }
    private val slotHint = TextView(context)
    private val slotRows = mutableListOf<Slot>()
    private data class Slot(val row: LinearLayout, val number: TextView, val course: EditText, var time: LocalTime)
    private fun label(parent: LinearLayout, text: String): TextView = TextView(context).apply {
        this.text = text; textSize = 13f; setTypeface(null, Typeface.BOLD); setPadding(0, dp(14), 0, dp(5)); parent.addView(this)
    }
    private fun button(text: String, block: () -> Unit): Button = Button(context).apply { this.text = text; isAllCaps = false; setOnClickListener { block() } }
    private fun row() = LinearLayout(context).apply { orientation = HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
    private fun field(parent: LinearLayout, title: String, value: String, numeric: Boolean = false): EditText {
        label(parent, title)
        return EditText(context).apply { setText(value); contentDescription = title; textSize = 16f; if (numeric) inputType = InputType.TYPE_CLASS_NUMBER; parent.addView(this, LayoutParams(-1, -2)) }
    }
    private fun changed(field: EditText, block: (Editable) -> Unit) {
        field.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable) { block(s) }
        })
    }
    init {
        orientation = VERTICAL
        val raw = JSONArray(context.assets.open("courses.json").bufferedReader().use { it.readText() })
        book = CourseBook((0 until raw.length()).map { raw.getJSONObject(it) })
        label(this, "종류")
        val kinds = RadioGroup(context).apply { orientation = HORIZONTAL; tag = "swipe-excluded" }
        val fieldKind = RadioButton(context).apply { id = View.generateViewId(); text = "⛳ 필드" }
        val screenKind = RadioButton(context).apply { id = View.generateViewId(); text = "🎯 스크린" }
        kinds.addView(fieldKind); kinds.addView(screenKind); kinds.check(if (screen) screenKind.id else fieldKind.id); addView(kinds)
        if (copy) label(this, "${base?.optString("course").orEmpty()}의 조건을 가져왔습니다. 날짜를 확인하면 새 모집으로 열립니다.")
        val placeLabel = label(this, "골프장")
        course.setText(nullable("course").orEmpty()); course.setSingleLine(true); course.contentDescription = "골프장 또는 매장"
        addView(course, LayoutParams(-1, -2)); addView(hits)
        val placeNote = TextView(context).apply { textSize = 12f }; addView(placeNote)
        fun refreshPlace() {
            hits.removeAllViews()
            val name = course.text.toString()
            val geo = book.geo(name)
            if (!screen && course.hasFocus() && geo?.optString("name") != name.trim()) {
                book.search(name).forEach { hit -> hits.addView(button(hit.getString("name")) {
                    course.setText(hit.getString("name")); course.setSelection(course.length()); hits.removeAllViews()
                }) }
            }
            placeNote.text = if (screen) "실내라 날씨는 표시되지 않습니다" else if (geo != null || (name == base?.optString("course") && base?.isNull("lat") == false)) "날씨가 함께 표시됩니다" else "목록에 없는 곳입니다 — 날씨는 표시되지 않습니다"
        }
        changed(course) { if (android.view.inputmethod.BaseInputConnection.getComposingSpanStart(it) < 0) refreshPlace() }
        course.setOnFocusChangeListener { _, _ -> refreshPlace() }
        label(conditions, "라운드 조건 (선택)")
        fun choices(options: List<Pair<String, String>>, get: () -> String?, set: (String?) -> Unit) {
            val line = row(); val boxes = mutableListOf<CheckBox>()
            options.forEach { (value, title) ->
                val box = CheckBox(context).apply { text = title; isChecked = get() == value }
                boxes.add(box); line.addView(box, LayoutParams(0, dp(48), 1f))
                box.setOnClickListener { set(if (box.isChecked) value else null); boxes.forEachIndexed { i, b -> b.isChecked = get() == options[i].first } }
            }
            conditions.addView(line)
        }
        choices(listOf("caddie" to "캐디", "none" to "노캐디"), { caddie }, { caddie = it })
        choices(listOf("included" to "카트 포함", "excluded" to "카트 미포함"), { cart }, { cart = it })
        addView(conditions)
        val teeLabel = label(this, "티오프")
        // Like iOS's compact picker, both filled date/time controls are visible from the first frame.
        val dateRow = row()
        val day = button("") { }; val time = button("") { }
        fun refreshDate() { day.text = tee.format(DateTimeFormatter.ofPattern("yyyy.MM.dd")); time.text = tee.format(DateTimeFormatter.ofPattern("HH:mm")) }
        day.setOnClickListener { DatePickerDialog(context, { _, y, m, d -> tee = tee.withDayOfMonth(1).withYear(y).withMonth(m + 1).withDayOfMonth(d); refreshDate() }, tee.year, tee.monthValue - 1, tee.dayOfMonth).show() }
        time.setOnClickListener { TimePickerDialog(context, { _, h, m -> tee = tee.withHour(h).withMinute(m); refreshDate() }, tee.hour, tee.minute, true).show() }
        dateRow.addView(day, LayoutParams(0, -2, 1f)); dateRow.addView(time, LayoutParams(0, -2, 1f)); addView(dateRow); refreshDate()
        label(teams, "2팀 이상일 경우 입력(선택)"); teams.addView(slotBox)
        teams.addView(button("＋ 팀 추가") {
            val previous = slotRows.lastOrNull()
            addSlot(previous?.course?.text?.toString().orEmpty(), previous?.time?.plusMinutes(7) ?: tee.toLocalTime())
        }); teams.addView(slotHint); addView(teams)
        if (base != null) RoundFormRules.slots(base).forEach { addSlot(it.optString("course"), LocalTime.parse(it.getString("time"))) }
        val capacity = field(this, "정원", base?.optInt("capacity", 4)?.toString() ?: "4", true)
        val feeLabel = label(this, "그린피")
        val feeRow = row(); val fee = EditText(context).apply { inputType = InputType.TYPE_CLASS_NUMBER; gravity = Gravity.END; contentDescription = "1인 비용" }
        fee.setText(String.format(Locale.KOREA, "%,d", base?.optInt("fee", 0) ?: 0))
        feeRow.addView(fee, LayoutParams(0, -2, 1f)); feeRow.addView(TextView(context).apply { text = "원"; textSize = 16f }); addView(feeRow)
        var formatting = false
        changed(fee) { value ->
            if (!formatting) {
                val rawText = value.toString(); val before = rawText.take(fee.selectionStart.coerceAtLeast(0)).count { it.isDigit() }
                val digits = rawText.filter { it in '0'..'9' }.trimStart('0').take(9)
                val formatted = if (digits.isEmpty()) (if (rawText.contains('0')) "0" else "") else String.format(Locale.KOREA, "%,d", digits.toLong())
                if (formatted != rawText) {
                    formatting = true; fee.setText(formatted)
                    var count = 0; var at = 0
                    while (at < formatted.length && count < before) { if (formatted[at].isDigit()) count++; at++ }
                    fee.setSelection(at); formatting = false
                }
            }
        }
        val note = field(this, "전달 내용 (선택)", nullable("note").orEmpty()).apply { minLines = 3; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE }
        fun refreshKind() {
            placeLabel.text = if (screen) "매장" else "골프장"; teeLabel.text = if (screen) "시작" else "티오프"; feeLabel.text = if (screen) "게임비" else "그린피"
            conditions.visibility = if (screen) GONE else VISIBLE; teams.visibility = if (screen) GONE else VISIBLE; refreshPlace()
        }
        kinds.setOnCheckedChangeListener { _, id -> screen = id == screenKind.id; refreshKind() }; refreshKind()
        val submit = button(if (base == null || copy) "모집 열기" else "수정 저장") { }
        submit.setOnClickListener {
            val cap = capacity.text.toString().toIntOrNull() ?: 0
            if (course.text.isBlank() || cap < 1) { Toast.makeText(context, "장소와 1명 이상의 정원을 적어 주세요.", Toast.LENGTH_SHORT).show(); return@setOnClickListener }
            val slots = slotRows.map { JSONObject().put("course", it.course.text.toString().trim()).put("time", it.time.format(DateTimeFormatter.ofPattern("HH:mm"))) }
            val payload = RoundFormRules.payload(base, screen, course.text.toString(), tee, cap, fee.text.toString().filter { it.isDigit() }.toIntOrNull() ?: 0, note.text.toString(), caddie, cart, book.geo(course.text.toString()), slots)
            save(payload, submit)
        }
        addView(submit, LayoutParams(-1, dp(52)))
    }
    private fun addSlot(name: String, time: LocalTime) {
        val line = row(); val number = TextView(context); val course = EditText(context).apply { setText(name); hint = "코스"; textSize = 14f; setSingleLine(true) }
        val slot = Slot(line, number, course, time); slotRows.add(slot)
        val clock = button(time.format(DateTimeFormatter.ofPattern("HH:mm"))) { }
        clock.setPadding(0, 0, 0, 0); clock.minWidth = 0; clock.textSize = 14f
        clock.setOnClickListener { TimePickerDialog(context, { _, h, m -> slot.time = LocalTime.of(h, m); clock.text = slot.time.toString(); refreshSlots() }, slot.time.hour, slot.time.minute, true).show() }
        val remove = button("×") { slotRows.remove(slot); slotBox.removeView(line); refreshSlots() }.apply { textSize = 12f; minWidth = 0; setPadding(0, 0, 0, 0) }
        line.addView(number, LayoutParams(dp(32), -2)); line.addView(course, LayoutParams(dp(116), -2)); line.addView(Space(context), LayoutParams(0, 1, 1f)); line.addView(clock, LayoutParams(dp(72), dp(48))); line.addView(remove, LayoutParams(dp(32), dp(40)))
        slotBox.addView(line); refreshSlots()
    }
    private fun refreshSlots() {
        slotRows.forEachIndexed { i, slot -> slot.number.text = "${i + 1}팀"; slot.course.contentDescription = "${i + 1}팀 코스" }
        slotHint.text = if (slotRows.isEmpty()) "팀 차례가 곧 조 번호입니다." else "${slotRows.size}팀 · 가장 이른 ${slotRows.minOf { it.time }}이 티오프 시각으로 저장됩니다."
    }
}
