package com.kkakkung.app.nativev2

import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import java.time.ZonedDateTime

class RoundFormRulesTest {
    private val date = ZonedDateTime.parse("2026-09-29T07:00:00+09:00[Asia/Seoul]")
    private fun base() = JSONObject("""{"course":"목록 밖 필드","kind":"field","caddie":"caddie","cart":"included","lat":37.123,"lon":127.456,"tee_at":"2026-09-15T23:21:00Z"}""")
    private fun payload(base: JSONObject?, screen: Boolean = false, slots: List<JSONObject> = emptyList()) = RoundFormRules.payload(base, screen, "목록 밖 필드", date, 8, 100000, "안내", "caddie", "included", null, slots)
    @Test fun editingFieldPreservesConditionsAndCoordinatesButScreenClearsThem() {
        val field = payload(base())
        for (key in listOf("caddie", "cart", "lat", "lon")) assertEquals(base().get(key), field.get(key))
        val screen = payload(base(), true)
        for (key in listOf("caddie", "cart", "lat", "lon")) assertTrue(screen.isNull(key))
        assertFalse(field.has("title")); assertFalse(field.has("opens_at"))
    }
    @Test fun orderedTeamsChooseEarliestTimeWithoutChangingGroupNumbers() {
        val teams = listOf(JSONObject("""{"course":"스카이","time":"07:28"}"""), JSONObject("""{"course":"베르힐","time":"07:14"}"""))
        val out = payload(base(), slots = teams)
        assertEquals("2026-09-29T07:14+09:00", out.getString("tee_at"))
        assertEquals("07:28", out.getJSONArray("tee_slots").getJSONObject(0).getString("time"))
        assertEquals("1조 · 스카이", RoundFormRules.groupTitle(out, 1))
        val tees = RoundFormRules.groupTees(out, JSONObject())
        assertTrue(tees.getString("1").contains("07:28"))
        val saved = JSONObject().put("2", "2026-09-29T08:00+09:00")
        assertSame(saved, RoundFormRules.groupTees(out, saved)); assertFalse(saved.has("1"))
    }
    @Test fun emptyTeamsOmitLegacyColumnButClearExistingColumn() {
        assertFalse(payload(base()).has("tee_slots"))
        val original = base().put("tee_slots", JSONArray().put(JSONObject().put("course", "A").put("time", "07:00")))
        assertEquals(0, payload(original).getJSONArray("tee_slots").length())
        assertEquals(0, payload(original, true).getJSONArray("tee_slots").length())
    }
    @Test fun newAndCopiedDatesAreTomorrowInSeoul() {
        val now = ZonedDateTime.parse("2026-12-31T23:55:00+09:00[Asia/Seoul]")
        assertEquals("2027-01-01T07:00+09:00[Asia/Seoul]", RoundFormRules.initialDate(null, false, now).toString())
        assertEquals("2027-01-01T08:21+09:00[Asia/Seoul]", RoundFormRules.initialDate(base(), true, now).toString())
        assertEquals("2026-09-16T08:21+09:00[Asia/Seoul]", RoundFormRules.initialDate(base(), false, now).toString())
    }
    @Test fun homeStateUsesOwnStatusBeforeClosedAndRanksWaitlistBySequence() {
        val round = JSONObject("""{"status":"closed","capacity":1,"signups":[{"user_id":"b","state":"waitlist","seq":7},{"user_id":"a","state":"waitlist","seq":3},{"user_id":"c","state":"confirmed","seq":1}]}""")
        assertEquals("대기 2번", RoundFormRules.homeState(round, "b"))
        assertEquals("신청 완료", RoundFormRules.homeState(round, "c"))
        assertEquals("신청 마감", RoundFormRules.homeState(round, "d"))
        round.put("status", "open")
        assertEquals("대기 신청", RoundFormRules.homeState(round, "d"))
        round.put("capacity", 2)
        assertEquals("신청하기", RoundFormRules.homeState(round, "d"))
        assertEquals("1.24", RoundFormRules.displayVersion("1.241"))
        assertEquals("1.0", RoundFormRules.displayVersion("1.9"))
    }
}
