package com.kkakkung.app.nativev2

import org.json.JSONArray
import org.json.JSONObject
import java.time.*
import java.util.Locale

internal object RoundFormRules {
    val seoul: ZoneId = ZoneId.of("Asia/Seoul")
    fun initialDate(base: JSONObject?, copy: Boolean, now: ZonedDateTime = ZonedDateTime.now(seoul)): ZonedDateTime {
        val original = try { OffsetDateTime.parse(base?.optString("tee_at")).atZoneSameInstant(seoul) } catch (_: Exception) { null }
        if (!copy && original != null) return original
        val time = if (copy && original != null) original.toLocalTime() else LocalTime.of(7, 0)
        return now.withZoneSameInstant(seoul).toLocalDate().plusDays(1).atTime(time).atZone(seoul).withSecond(0).withNano(0)
    }
    fun slots(round: JSONObject): List<JSONObject> {
        val rows = round.optJSONArray("tee_slots") ?: return emptyList()
        return (0 until rows.length()).mapNotNull { rows.optJSONObject(it) }.filter {
            try { LocalTime.parse(it.optString("time")); true } catch (_: Exception) { false }
        }
    }
    fun groupTitle(round: JSONObject, group: Int): String {
        if (group <= 0) return "미배정"
        val course = slots(round).getOrNull(group - 1)?.optString("course").orEmpty()
        return "${group}조" + if (course.isBlank()) "" else " · $course"
    }
    fun groupTees(round: JSONObject, saved: JSONObject): JSONObject {
        if (saved.length() > 0) return saved
        val out = JSONObject()
        val day = try { OffsetDateTime.parse(round.getString("tee_at")).atZoneSameInstant(seoul).toLocalDate() } catch (_: Exception) { return out }
        slots(round).forEachIndexed { i, row -> out.put((i + 1).toString(), day.atTime(LocalTime.parse(row.getString("time"))).atZone(seoul).toOffsetDateTime().toString()) }
        return out
    }
    fun payload(base: JSONObject?, screen: Boolean, course: String, date: ZonedDateTime, capacity: Int, fee: Int,
                note: String, caddie: String?, cart: String?, geo: JSONObject?, teamSlots: List<JSONObject>): JSONObject {
        require(course.isNotBlank() && capacity > 0 && fee >= 0)
        val teams = if (screen) emptyList() else teamSlots
        val earliest = teams.map { LocalTime.parse(it.getString("time")) }.minOrNull()
        val tee = if (earliest != null) date.toLocalDate().atTime(earliest).atZone(seoul) else date
        // Unchanged field courses retain their exact coordinates, including courses absent from the catalogue.
        val sameCourse = base?.optString("course")?.trim() == course.trim()
        fun coordinate(key: String): Any = if (screen) JSONObject.NULL else if (sameCourse) base?.opt(key) ?: JSONObject.NULL else geo?.opt(key) ?: JSONObject.NULL
        val out = JSONObject().put("kind", if (screen) "screen" else "field").put("course", course.trim())
            .put("tee_at", tee.withSecond(0).withNano(0).toOffsetDateTime().toString()).put("capacity", capacity)
            .put("fee", fee).put("note", note.trim()).put("caddie", if (screen) JSONObject.NULL else caddie ?: JSONObject.NULL)
            .put("cart", if (screen) JSONObject.NULL else cart ?: JSONObject.NULL).put("lat", coordinate("lat")).put("lon", coordinate("lon"))
        if (teams.isNotEmpty() || base?.has("tee_slots") == true) out.put("tee_slots", JSONArray(teams))
        return out
    }
    fun homeState(round: JSONObject, user: String): String {
        val rows = round.optJSONArray("signups") ?: JSONArray()
        val all = (0 until rows.length()).mapNotNull { rows.optJSONObject(it) }
        val mine = all.firstOrNull { it.optString("user_id") == user }
        if (mine?.optString("state") == "waitlist") {
            val waiting = all.filter { it.optString("state") == "waitlist" }.sortedBy { it.optInt("seq") }
            return "대기 ${waiting.indexOf(mine) + 1}번"
        }
        if (mine?.optString("state") == "confirmed") return "신청 완료"
        if (round.optString("status") != "open") return "신청 마감"
        return if (all.count { it.optString("state") == "confirmed" } >= round.optInt("capacity")) "대기 신청" else "신청하기"
    }
    fun displayVersion(name: String): String = name.substringBeforeLast('.') + "." + name.substringAfterLast('.').dropLast(1).ifEmpty { "0" }
}

internal class CourseBook(val courses: List<JSONObject>) {
    private fun key(s: String) = s.filterNot { it.isWhitespace() || Character.isSpaceChar(it) }.lowercase(Locale.ROOT)
    fun search(q: String): List<JSONObject> = if (key(q).isBlank()) emptyList() else courses.filter { key(it.getString("name")).contains(key(q)) }.sortedBy { it.getString("name").length }.take(8)
    fun geo(q: String): JSONObject? {
        val k = key(q); if (k.isEmpty()) return null
        return courses.firstOrNull { key(it.getString("name")) == k } ?: courses.filter {
            val n = key(it.getString("name")); n.contains(k) || k.contains(n)
        }.maxByOrNull { key(it.getString("name")).length }
    }
}
