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

internal object NativeWeather {
    private val client = OkHttpClient.Builder().callTimeout(10, TimeUnit.SECONDS).build()
    private val cache = java.util.concurrent.ConcurrentHashMap<String, String>()
    suspend fun forecast(round: JSONObject): String? = withContext(Dispatchers.IO) {
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
                val code = d.getJSONArray("weather_code").getInt(0)
                val label = when { code == 0 -> "맑음"; code <= 2 -> "구름 조금"; code == 3 -> "흐림"; code <= 48 -> "안개"; code <= 57 -> "이슬비"; code <= 67 -> "비"; code <= 77 -> "눈"; code <= 82 -> "소나기"; code <= 86 -> "눈"; else -> "천둥번개" }
                val min = kotlin.math.round(d.getJSONArray("temperature_2m_min").getDouble(0)).toInt()
                val max = kotlin.math.round(d.getJSONArray("temperature_2m_max").getDouble(0)).toInt()
                val text = "$label · $min~$max℃ · 강수 ${d.getJSONArray("precipitation_probability_max").getInt(0)}%"
                cache[key] = text
                text
            }
        } catch (_: Exception) { null }
    }
}
