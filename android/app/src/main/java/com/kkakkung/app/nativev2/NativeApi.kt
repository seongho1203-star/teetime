package com.kkakkung.app.nativev2

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

class NativeApiError(message: String) : Exception(message)

class NativeApi(private val session: NativeSession) {
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private fun enc(v: String) = URLEncoder.encode(v, "UTF-8").replace("+", "%20")

    suspend fun rows(
        table: String,
        query: List<Pair<String, String>> = emptyList()
    ): List<JSONObject> = withContext(Dispatchers.IO) {
        val qs = query.joinToString("&") { enc(it.first) + "=" + enc(it.second) }
        val base = session.supabaseUrl.trimEnd('/')
        val url = "$base/rest/v1/$table" + if (qs.isEmpty()) "" else "?$qs"
        val req = Request.Builder().url(url)
            .header("apikey", session.anonKey)
            .header("Authorization", "Bearer ${session.accessToken}")
            .header("Accept", "application/json")
            .build()
        http.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (res.code == 401) throw NativeApiError("로그인이 만료됐습니다.")
            if (res.code == 403) throw NativeApiError("이 화면을 볼 권한이 없습니다.")
            if (!res.isSuccessful) throw NativeApiError("서버 오류(${res.code})")
            val value = if (body.isBlank()) JSONArray() else JSONTokener(body).nextValue()
            val arr = value as? JSONArray ?: JSONArray()
            buildList {
                for (i in 0 until arr.length()) arr.optJSONObject(i)?.let(::add)
            }
        }
    }

    suspend fun profile(): JSONObject? =
        rows("profiles", listOf("select" to "*", "id" to "eq.${session.userId}", "limit" to "1"))
            .firstOrNull()

    suspend fun upcomingRounds(limit: Int = 30): List<JSONObject> =
        rows("rounds", listOf(
            "select" to "id,title,course,tee_at,capacity,fee,status,kind,caddie,cart",
            "status" to "neq.cancelled", "order" to "tee_at.asc", "limit" to limit.toString()
        ))

    suspend fun rounds(limit: Int = 60): List<JSONObject> =
        rows("rounds", listOf(
            "select" to "id,title,course,tee_at,capacity,fee,status,kind,caddie,cart",
            "order" to "tee_at.desc", "limit" to limit.toString()
        ))

    suspend fun openPolls(limit: Int = 30): List<JSONObject> =
        rows("polls", listOf(
            "select" to "id,title,body,multi,anonymous,closes_at,closed,created_at",
            "closed" to "eq.false", "order" to "created_at.desc", "limit" to limit.toString()
        ))

    suspend fun polls(limit: Int = 60): List<JSONObject> =
        rows("polls", listOf(
            "select" to "id,title,body,multi,anonymous,closes_at,closed,created_at",
            "order" to "created_at.desc", "limit" to limit.toString()
        ))

    suspend fun round(id: String): JSONObject? =
        rows("rounds", listOf("select" to "*", "id" to "eq.$id", "limit" to "1")).firstOrNull()

    suspend fun poll(id: String): JSONObject? =
        rows("polls", listOf("select" to "*", "id" to "eq.$id", "limit" to "1")).firstOrNull()
}
