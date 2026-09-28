package com.kkakkung.app.nativev2

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

/**
 * 음력 셈이 **웹(`src/lib/lunar.ts`)과 한 치도 안 다른가** — 웹이 셈해 둔 표(`lunar-web.json`,
 * 2020~2040년 날마다 + 음력→양력 1,260가지)와 견준다. 웹 셈을 고쳤으면 그 표도 다시 뽑을 것.
 */
class LunarTest {
    private val web = JSONObject(javaClass.getResource("/lunar-web.json")!!.readText())

    @Test fun everyDayMatchesWeb() {
        val days = web.getJSONArray("days")
        var d = LocalDate.parse(web.getString("start"))
        for (i in 0 until days.length()) {
            val r = Lunar.toLunar(d.year, d.monthValue, d.dayOfMonth)
            assertEquals("$d", days.getString(i), "${if (r.leap) "L" else ""}${r.month}.${r.day}")
            d = d.plusDays(1)
        }
    }

    @Test fun lunarToSolarMatchesWeb() {
        val solar = web.getJSONObject("solar")
        for (key in solar.keys()) {
            val (y, m, d) = key.split("-").map(String::toInt)
            val got = Lunar.lunarToSolar(y, m, d)
            assertEquals(key, solar.getString(key), got?.let { "${it.year}-${it.monthValue}-${it.dayOfMonth}" } ?: "")
        }
    }

    @Test fun wellKnownDays() {
        assertEquals(Lunar.LunarDate(1, 1, false), Lunar.toLunar(2026, 2, 17))     // 설날
        assertEquals(Lunar.LunarDate(8, 15, false), Lunar.toLunar(2026, 9, 25))    // 추석
        assertTrue(Lunar.toLunar(2025, 7, 28).leap)                                 // 윤6월
        assertEquals(LocalDate.of(2025, 10, 6), Lunar.lunarToSolar(2025, 8, 15))
    }
}
