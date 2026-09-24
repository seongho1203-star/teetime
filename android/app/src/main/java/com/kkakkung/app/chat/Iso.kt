package com.kkakkung.app.chat

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.regex.Pattern

/**
 * 날짜 셈 — 아이폰의 `NativeChatRows.date`·`format` 몫이다.
 *
 * **`java.time`을 안 쓴다.** 가장 낮은 안드로이드가 6.0(API 23)이라
 * 그것을 쓰려면 desugaring 설정이 한 벌 더 붙는다. Supabase가 주는
 * ISO 시각(`2026-09-17T09:00:00.123456+00:00` · `…Z`)은 모양이 정해져 있어
 * 손으로 풀어도 짧다.
 *
 * **화면에 적는 것은 전부 한국 시각이다**(웹 `lib/format.ts`와 같은 규칙).
 */
object Iso {
    private val KST: TimeZone = TimeZone.getTimeZone("Asia/Seoul")
    private val ISO = Pattern.compile(
        "^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})(?:\\.(\\d+))?(Z|[+-]\\d{2}:?\\d{2})?$")

    /** ISO 글자 → epoch ms. 못 풀면 0(아이폰의 `.distantPast`와 같은 뜻). */
    fun ms(value: String?): Long {
        if (value.isNullOrEmpty()) return 0L
        val m = ISO.matcher(value.trim())
        if (!m.matches()) return 0L
        val cal = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
        cal.clear()
        cal.set(m.group(1)!!.toInt(), m.group(2)!!.toInt() - 1, m.group(3)!!.toInt(),
                m.group(4)!!.toInt(), m.group(5)!!.toInt(), m.group(6)!!.toInt())
        val frac = m.group(7)
        if (frac != null) cal.set(Calendar.MILLISECOND, (frac + "00").substring(0, 3).toInt())
        var t = cal.timeInMillis
        val zone = m.group(8)
        if (zone != null && zone != "Z") {
            val sign = if (zone[0] == '-') -1 else 1
            val digits = zone.substring(1).replace(":", "")
            val hh = digits.substring(0, 2).toInt()
            val mm = if (digits.length >= 4) digits.substring(2, 4).toInt() else 0
            t -= sign * (hh * 60L + mm) * 60_000L
        }
        return t
    }

    /** 지금을 Supabase가 주는 꼴로(`2026-09-17T09:00:00.123Z`). */
    fun now(): String {
        val f = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        f.timeZone = TimeZone.getTimeZone("UTC")
        return f.format(Date())
    }

    /** 한국 시각으로 적는다. `pattern`은 `SimpleDateFormat` 꼴이다. */
    fun format(iso: String?, pattern: String): String {
        val f = SimpleDateFormat(pattern, Locale.KOREAN)
        f.timeZone = KST
        return f.format(Date(ms(iso)))
    }
}
