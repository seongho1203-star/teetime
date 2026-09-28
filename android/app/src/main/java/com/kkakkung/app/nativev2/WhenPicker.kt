package com.kkakkung.app.nativev2

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.graphics.Color
import android.view.Gravity
import android.widget.GridLayout
import android.widget.LinearLayout
import android.widget.TextView
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/*
 * **날짜·시각 한 칸** — 아이폰 `WhenPicker`(FormScreen.swift)를 옮긴 것.
 * 투표 `마감 시각`과 모집 열기의 `티오프`가 같이 쓴다. **시간대는 늘 한국이다.**
 * 칸을 누르면 날짜 → 시각 순으로 시스템 창이 뜬다(`ko` · 한글).
 * `quick`는 바로누름(`3일 후` 같은 것 · 지금부터 며칠 뒤 같은 시각).
 */
class WhenPicker(private val ui: Ui, private val hour: Int, private val minute: Int, quick: List<Pair<String, Int>> = emptyList()) :
    LinearLayout(ui.ctx) {
    var onChange: (() -> Unit)? = null
    var date: ZonedDateTime? = null
        set(v) { field = v; paint() }
    private val box = ui.label("", 16f).apply {
        gravity = Gravity.CENTER_VERTICAL
        background = ui.rounded(AppSkin.surface, AppSkin.radiusSm, AppSkin.line)
        setPadding(ui.dp(13), 0, ui.dp(13), 0)
        isClickable = true
        minHeight = ui.dp(44)
    }

    init {
        orientation = VERTICAL
        addView(box, LayoutParams(-1, ui.dp(44)))
        box.setOnClickListener { pick() }
        if (quick.isNotEmpty()) {
            val row = ui.hrow(quick.map { (t, days) ->
                ui.button(t, AppSkin.dim) { date = ZonedDateTime.now(AppDate.seoul).plusDays(days.toLong()).withSecond(0).withNano(0); onChange?.invoke() }
            })
            addView(row, LayoutParams(-1, -2).apply { topMargin = ui.dp(8) })
        }
        paint()
    }

    private fun paint() {
        val d = date
        box.text = if (d == null) "📅 날짜·시각 고르기" else d.format(DateTimeFormatter.ofPattern("M월 d일 (E) a h:mm", Locale.KOREAN))
        box.setTextColor(if (d == null) AppSkin.dim else AppSkin.text)
    }

    private fun pick() {
        val start = date ?: ZonedDateTime.now(AppDate.seoul).plusDays(1).with(LocalTime.of(hour, minute))
        DatePickerDialog(ui.ctx, { _, y, m, d ->
            TimePickerDialog(ui.ctx, { _, h, min ->
                date = ZonedDateTime.of(y, m + 1, d, h, min, 0, 0, AppDate.seoul)
                onChange?.invoke()
            }, start.hour, start.minute, false).show()
        }, start.year, start.monthValue - 1, start.dayOfMonth).show()
    }

    companion object {
        /** 오늘(한국 날짜)에서 며칠 뒤 그 시각 — 새 투표의 마감 기본값. */
        fun daysLater(days: Long, hour: Int, minute: Int): ZonedDateTime =
            LocalDate.now(AppDate.seoul).plusDays(days).atTime(hour, minute).atZone(AppDate.seoul)
        /** DB에 넣는 모양(UTC ISO). */
        fun iso(d: ZonedDateTime): String = d.toInstant().toString()
        /** `10월 4일 (일)` — 웹 `dateLabel`과 같은 모양. */
        fun dayLabel(d: LocalDate): String = d.format(DateTimeFormatter.ofPattern("M월 d일 (E)", Locale.KOREAN))
    }
}

/**
 * **여러 날을 고르는 달력** — 웹 `components/DayCal.tsx`·아이폰 `UICalendarView`(여러 날)의 몫.
 * 날을 누르면 `onToggle`이 불리고, 칠해질 날은 `marked`가 정한다(항목이 곧 진실).
 */
class DayCal(private val ui: Ui) : LinearLayout(ui.ctx) {
    var marked: (LocalDate) -> Boolean = { false }
    var onToggle: ((LocalDate) -> Unit)? = null
    private var month = LocalDate.now(AppDate.seoul).withDayOfMonth(1)
    private val title = ui.label("", 16f, bold = true)
    private val grid = GridLayout(ui.ctx).apply { columnCount = 7 }

    init {
        orientation = VERTICAL
        fun arrow(t: String, step: Long) = ui.label(t, 20f, bold = true, color = AppSkin.brand).apply {
            gravity = Gravity.CENTER; isClickable = true
            setOnClickListener { month = month.plusMonths(step); render() }
        }
        val head = LinearLayout(ui.ctx).apply {
            orientation = HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            addView(title, LayoutParams(0, -2, 1f))
            addView(arrow("‹", -1), LayoutParams(ui.dp(40), ui.dp(40)))
            addView(arrow("›", 1), LayoutParams(ui.dp(40), ui.dp(40)))
        }
        addView(head)
        addView(grid, LayoutParams(-1, -2))
        render()
    }

    fun render() {
        title.text = "${month.year}년 ${month.monthValue}월"
        grid.removeAllViews()
        val w = (resources.displayMetrics.widthPixels - ui.dp(16 * 2 + 14 * 2 + 2)) / 7
        val today = LocalDate.now(AppDate.seoul)
        /* 줄 맞춤을 글자 밑선으로 하면 빈 칸이 있는 첫 주만 벌어진다 — 칸을 꽉 채워 맞춘다. */
        fun cell(h: Int) = GridLayout.LayoutParams(GridLayout.spec(GridLayout.UNDEFINED, GridLayout.FILL), GridLayout.spec(GridLayout.UNDEFINED))
            .apply { width = w; height = ui.dp(h) }
        listOf("일", "월", "화", "수", "목", "금", "토").forEach {
            grid.addView(ui.label(it, 12f, bold = true, color = AppSkin.faint).apply { gravity = Gravity.CENTER },
                cell(28))
        }
        val lead = month.dayOfWeek.value % 7
        repeat(lead) { grid.addView(TextView(ui.ctx), cell(40)) }
        for (day in 1..month.lengthOfMonth()) {
            val d = month.withDayOfMonth(day)
            val on = marked(d)
            val past = d.isBefore(today)
            grid.addView(ui.label(day.toString(), 16f, bold = on || d == today,
                color = when { on -> Color.WHITE; past -> AppSkin.faint; d == today -> AppSkin.brand; else -> AppSkin.text }).apply {
                gravity = Gravity.CENTER
                if (on) background = ui.rounded(AppSkin.brand, 18)
                isClickable = true
                contentDescription = WhenPicker.dayLabel(d)
                setOnClickListener { onToggle?.invoke(d) }
            }, cell(40))
        }
    }
}
