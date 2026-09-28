package com.kkakkung.app.nativev2

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import kotlin.math.floor
import kotlin.math.roundToLong

/*
 * **음력 ↔ 양력** — 웹 `src/lib/lunar.ts`를 한 줄씩 옮긴 것이다. **표를 안 들고 천문 계산으로 낸다**
 * (Meeus `Astronomical Algorithms` 49장 합삭 · 25장 태양 황경). 몇 년치 표를 박아 두면 그 범위가
 * 끝나는 날 조용히 틀린 값을 내놓는다 — 그 길로 가지 말 것.
 *
 * **한국 시각으로 끊는다** — 합삭이 한국 시각으로 몇 시냐에 따라 그 달의 초하루가 하루 갈린다.
 * **규칙을 고치면 웹과 함께 고칠 것** — 웹은 `.dev/lunar-check.mts`, 여기는 `LunarTest`가 붙들어 둔다
 * (웹이 셈한 값 표 `lunar-web.json`과 날마다 견준다).
 */
object Lunar {
    data class LunarDate(val month: Int, val day: Int, val leap: Boolean)

    private const val DEG = Math.PI / 180
    private fun sin(d: Double) = kotlin.math.sin(d * DEG)
    private fun wrap360(d: Double): Double { val x = d % 360; return if (x < 0) x + 360 else x }

    /** 역학시(TT)와 세계시(UT)의 차이(초) — Espenak–Meeus 2005~2050년 식. 날짜만 쓰므로 몇십 초는 안 걸린다. */
    private fun deltaT(year: Double): Double { val t = year - 2000; return 62.92 + 0.32217 * t + 0.005589 * t * t }
    private fun jdYear(jd: Double) = 2000 + (jd - 2451545) / 365.25

    /** `k`번째 합삭의 율리우스일(UT). `k = 0`이 2000년 1월 6일. */
    private fun newMoonJd(k: Int): Double {
        val kk = k.toDouble()
        val t = kk / 1236.85
        val t2 = t * t; val t3 = t2 * t; val t4 = t3 * t
        var jde = 2451550.09766 + 29.530588861 * kk + 0.00015437 * t2 - 0.000000150 * t3 + 0.00000000073 * t4
        val e = 1 - 0.002516 * t - 0.0000074 * t2
        val m = 2.5534 + 29.10535670 * kk - 0.0000014 * t2 - 0.00000011 * t3
        val mp = 201.5643 + 385.81693528 * kk + 0.0107582 * t2 + 0.00001238 * t3 - 0.000000058 * t4
        val f = 160.7108 + 390.67050284 * kk - 0.0016118 * t2 - 0.00000227 * t3 + 0.000000011 * t4
        val o = 124.7746 - 1.56375588 * kk + 0.0020672 * t2 + 0.00000215 * t3
        jde += -0.40720 * sin(mp) +
            0.17241 * e * sin(m) +
            0.01608 * sin(2 * mp) +
            0.01039 * sin(2 * f) +
            0.00739 * e * sin(mp - m) -
            0.00514 * e * sin(mp + m) +
            0.00208 * e * e * sin(2 * m) -
            0.00111 * sin(mp - 2 * f) -
            0.00057 * sin(mp + 2 * f) +
            0.00056 * e * sin(2 * mp + m) -
            0.00042 * sin(3 * mp) +
            0.00042 * e * sin(m + 2 * f) +
            0.00038 * e * sin(m - 2 * f) -
            0.00024 * e * sin(2 * mp - m) -
            0.00017 * sin(o) -
            0.00007 * sin(mp + 2 * m) +
            0.00004 * sin(2 * mp - 2 * f) +
            0.00004 * sin(3 * m) +
            0.00003 * sin(mp + m - 2 * f) +
            0.00003 * sin(2 * mp + 2 * f) -
            0.00003 * sin(mp + m + 2 * f) +
            0.00003 * sin(mp - m + 2 * f) -
            0.00002 * sin(mp - m - 2 * f) -
            0.00002 * sin(3 * mp + m) +
            0.00002 * sin(4 * mp)
        /* 행성이 끌어당기는 몫 — 열넷을 더하면 자정 언저리에서 날짜를 가를 수 있다. */
        val a = arrayOf(
            299.77 + 0.107408 * kk - 0.009173 * t2 to 0.000325,
            251.88 + 0.016321 * kk to 0.000165,
            251.83 + 26.651886 * kk to 0.000164,
            349.42 + 36.412478 * kk to 0.000126,
            84.66 + 18.206239 * kk to 0.000110,
            141.74 + 53.303771 * kk to 0.000062,
            207.14 + 2.453732 * kk to 0.000060,
            154.84 + 7.306860 * kk to 0.000056,
            34.52 + 27.261239 * kk to 0.000047,
            207.19 + 0.121824 * kk to 0.000042,
            291.34 + 1.844379 * kk to 0.000040,
            161.72 + 24.198154 * kk to 0.000037,
            239.56 + 25.513099 * kk to 0.000035,
            331.55 + 3.592518 * kk to 0.000023,
        )
        for ((ang, amp) in a) jde += amp * sin(ang)
        return jde - deltaT(jdYear(jde)) / 86400
    }

    /** 태양의 겉보기 황경(도) — Meeus 25장 간이식. */
    private fun sunLongitude(jd: Double): Double {
        val t = (jd - 2451545) / 36525
        val l0 = 280.46646 + 36000.76983 * t + 0.0003032 * t * t
        val m = 357.52911 + 35999.05029 * t - 0.0001537 * t * t
        val c = (1.914602 - 0.004817 * t - 0.000014 * t * t) * sin(m) +
            (0.019993 - 0.000101 * t) * sin(2 * m) + 0.000289 * sin(3 * m)
        val o = 125.04 - 1934.136 * t
        return wrap360(l0 + c - 0.00569 - 0.00478 * sin(o))
    }

    /** 그 시각이 몇 번째 30° 칸인가 — 달의 처음과 끝에서 다르면 그 달에 중기가 있다. */
    private fun majorTerm(jd: Double) = floor(sunLongitude(jd) / 30).toInt()

    /** 한국 날짜 0시(KST)의 율리우스일. */
    private fun kstJd(y: Int, m: Int, d: Int) = LocalDate.of(y, m, d).toEpochDay() + 2440587.5 - 9.0 / 24
    /** 율리우스일 → 그 시각이 든 한국 날짜. */
    private fun jdKstDate(jd: Double): LocalDate =
        Instant.ofEpochMilli(((jd - 2440587.5 + 9.0 / 24) * 86400000).roundToLong()).atZone(ZoneOffset.UTC).toLocalDate()
    /** 한국 날짜 → 하루 단위 번호(날짜끼리 견주고 빼는 데만 쓴다). */
    private fun dayNo(d: LocalDate) = d.toEpochDay().toInt()
    /** 합삭이 든 **한국 날짜** — 그 날이 그 달 초하루다. */
    private fun newMoonDay(k: Int) = dayNo(jdKstDate(newMoonJd(k)))
    private fun dayJd(n: Int) = n + 2440587.5 - 9.0 / 24

    /** 어느 해 12월의 동지(황경 270°) — 반씩 좁혀 든다. */
    private fun winterSolstice(year: Int): Double {
        var lo = kstJd(year, 12, 15); var hi = kstJd(year, 12, 27)
        fun f(jd: Double): Double { val x = sunLongitude(jd) - 270; return if (x > 180) x - 360 else if (x < -180) x + 360 else x }
        repeat(40) { val mid = (lo + hi) / 2; if (f(mid) < 0) lo = mid else hi = mid }
        return (lo + hi) / 2
    }

    /** 그 날짜가 든 달의 초하루를 내는 `k`. */
    private fun kBefore(day: Int): Int {
        var k = floor((day - 10961) / 29.530588861).toInt()
        while (newMoonDay(k) > day) k--
        while (newMoonDay(k + 1) <= day) k++
        return k
    }

    /** 양력(한국 날짜) → 음력. **동지가 든 달이 11월**, 달이 열셋이면 **중기가 없는 첫 달**이 윤달. */
    fun toLunar(y: Int, m: Int, d: Int): LunarDate {
        val today = dayNo(LocalDate.of(y, m, d))
        val start = newMoonDay(kBefore(today))
        fun solsticeMonth(yy: Int) = newMoonDay(kBefore(dayNo(jdKstDate(winterSolstice(yy)))))
        val thisYear = solsticeMonth(y)
        val from = if (start >= thisYear) thisYear else solsticeMonth(y - 1)
        val to = if (start >= thisYear) solsticeMonth(y + 1) else thisYear
        val k0 = kBefore(from)
        val starts = mutableListOf<Int>()
        var i = 0
        while (true) { val s = newMoonDay(k0 + i); if (s >= to) break; starts.add(s); i++ }
        var leapAt = -1
        if (starts.size == 13) {
            for (j in 1 until starts.size) {
                val end = if (j + 1 < starts.size) starts[j + 1] else to
                if (majorTerm(dayJd(starts[j])) == majorTerm(dayJd(end))) { leapAt = j; break }
            }
        }
        var num = 11; var leap = false
        for (j in starts.indices) {
            if (j > 0) { if (j == leapAt) leap = true else { num = if (num == 12) 1 else num + 1; leap = false } }
            if (starts[j] == start) return LunarDate(num, today - start + 1, leap)
        }
        return LunarDate(1, today - start + 1, false)
    }

    /**
     * 음력 달·날이 **그 해 양력 며칠인가**. 그 해에 없는 날(음력 30일이 없는 달)이면 null.
     * **윤달은 안 본다** — 평달로 찾는다(우리 관습).
     */
    fun lunarToSolar(year: Int, month: Int, day: Int): LocalDate? {
        var k = kBefore(dayNo(LocalDate.of(year - 1, 11, 1)))
        repeat(16) {
            val s = newMoonDay(k)
            val date = jdKstDate(dayJd(s))
            val lu = toLunar(date.year, date.monthValue, date.dayOfMonth)
            if (!lu.leap && lu.month == month) {
                val hit = s + day - 1
                if (hit >= newMoonDay(k + 1)) return null   // 그 달에 없는 날이다
                val got = jdKstDate(dayJd(hit))
                if (got.year == year) return got
            }
            k++
        }
        return null
    }
}
