package com.kkakkung.app.nativev2

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Supabase refresh token으로 access token을 갱신한다. */
object NativeAuth {
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).build()

    suspend fun refresh(session: NativeSession): NativeSession = withContext(Dispatchers.IO) {
        if (session.refreshToken.isBlank()) throw NativeApiError("다시 로그인해 주세요.")
        val url = session.supabaseUrl.trimEnd('/') + "/auth/v1/token?grant_type=refresh_token"
        val req = Request.Builder().url(url)
            .header("apikey", session.anonKey)
            .header("Content-Type", "application/json")
            .post(JSONObject().put("refresh_token", session.refreshToken).toString()
                .toRequestBody("application/json".toMediaType()))
            .build()
        http.newCall(req).execute().use { res ->
            val raw = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                NativeSessionStore.clear()
                throw NativeApiError("로그인이 만료됐습니다. 다시 로그인해 주세요.")
            }
            val j = JSONObject(raw)
            session.accessToken = j.optString("access_token")
            j.optString("refresh_token").takeIf { it.isNotBlank() }?.let { session.refreshToken = it }
            val seconds = j.optLong("expires_in", 3600)
            session.expiresAt = System.currentTimeMillis() + seconds * 1000L
            NativeSessionStore.persist()
            session
        }
    }
}
