package com.kkakkung.app.nativev2

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import java.util.concurrent.TimeUnit

/** 라운드 날 날씨(아이폰 `AppWeather` · 웹 `lib/weather.ts`). */
data class AppWeather(val min: Int, val max: Int, val rain: Int, val icon: String, val label: String) {
    /** `☀️ 12° / 21°  맑음 · 비 30%` — 아이폰 홈 카드와 같은 줄. */
    val line: String get() = "$icon $min° / $max°  $label" + if (rain > 0) " · 비 $rain%" else ""

    companion object {
        /** WMO 코드 → 한 마디(웹 `describe`와 같은 묶음). */
        fun describe(code: Int): Pair<String, String> = when {
            code == 0 -> "☀️" to "맑음"
            code <= 2 -> "🌤️" to "구름 조금"
            code == 3 -> "☁️" to "흐림"
            code <= 48 -> "🌫️" to "안개"
            code <= 57 -> "🌦️" to "이슬비"
            code <= 67 -> "🌧️" to "비"
            code <= 77 -> "🌨️" to "눈"
            code <= 82 -> "🌧️" to "소나기"
            code <= 86 -> "🌨️" to "눈"
            else -> "⛈️" to "천둥번개"
        }
    }
}

internal object NativeWeather {
    private val client = OkHttpClient.Builder().callTimeout(10, TimeUnit.SECONDS).build()
    private val cache = java.util.concurrent.ConcurrentHashMap<String, AppWeather>()

    /** 좌표가 있는 필드 라운드만 · 예보 범위(16일) 밖이면 없음. **200이 아닌 답은 없는 것으로 본다.** */
    suspend fun weather(round: JSONObject): AppWeather? = withContext(Dispatchers.IO) {
        if (round.optString("kind") == "screen" || round.isNull("lat") || round.isNull("lon")) return@withContext null
        try {
            val day = OffsetDateTime.parse(round.optString("tee_at")).atZoneSameInstant(ZoneId.of("Asia/Seoul")).toLocalDate()
            if (ChronoUnit.DAYS.between(LocalDate.now(ZoneId.of("Asia/Seoul")), day) !in 0..15) return@withContext null
            val lat = round.optDouble("lat"); val lon = round.optDouble("lon")
            if (!lat.isFinite() || !lon.isFinite()) return@withContext null
            val key = "$lat,$lon,$day"
            cache[key]?.let { return@withContext it }
            val url = "https://api.open-meteo.com/v1/forecast?latitude=$lat&longitude=$lon" +
                "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FSeoul&start_date=$day&end_date=$day"
            client.newCall(Request.Builder().url(url).build()).execute().use { res ->
                if (!res.isSuccessful) return@withContext null
                val d = JSONObject(res.body?.string().orEmpty()).getJSONObject("daily")
                val (icon, label) = AppWeather.describe(d.getJSONArray("weather_code").getInt(0))
                val w = AppWeather(
                    kotlin.math.round(d.getJSONArray("temperature_2m_min").getDouble(0)).toInt(),
                    kotlin.math.round(d.getJSONArray("temperature_2m_max").getDouble(0)).toInt(),
                    d.getJSONArray("precipitation_probability_max").optInt(0), icon, label)
                cache[key] = w
                w
            }
        } catch (_: Exception) { null }
    }
}
