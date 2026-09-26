package com.kkakkung.app.nativev2

import android.content.Context
import android.net.Uri
import android.util.Base64
import com.kkakkung.app.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.TimeUnit

/** Supabase Auth를 WebView 없이 처리하는 Native V2 인증기. */
object NativeAuth {
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).build()
    private const val REDIRECT = "kkakkung://auth"
    private const val PREF = "kk_native_auth"
    private const val VERIFIER = "pkce_verifier"

    /** 기존 supabase-js와 같은 PKCE social OAuth URL을 Kotlin에서 만든다. */
    fun oauthUrl(context: Context, provider: String): Uri {
        require(provider == "kakao" || provider == "apple")
        val bytes = ByteArray(64).also { SecureRandom().nextBytes(it) }
        val verifier = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        val challenge = Base64.encodeToString(
            MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)),
            Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
        )
        context.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit()
            .putString(VERIFIER, verifier).apply()

        val base = BuildConfig.SUPABASE_URL.trimEnd('/') + "/auth/v1/authorize"
        return Uri.parse(base).buildUpon()
            .appendQueryParameter("provider", provider)
            .appendQueryParameter("redirect_to", REDIRECT)
            .appendQueryParameter("code_challenge", challenge)
            .appendQueryParameter("code_challenge_method", "s256")
            .apply {
                if (provider == "kakao")
                    appendQueryParameter("scopes", "profile_nickname profile_image")
            }
            .build()
    }

    /** kkakkung://auth?code=... 를 access/refresh session으로 바꾼다.
     * Supabase Auth의 실제 PKCE endpoint는 /token?grant_type=pkce 이며
     * auth_code + code_verifier를 JSON으로 받는다. */
    suspend fun exchangeCallback(context: Context, uri: Uri): NativeSession =
        withContext(Dispatchers.IO) {
            uri.getQueryParameter("error_description")?.let { throw NativeApiError(it) }
            val code = uri.getQueryParameter("code")
                ?: throw NativeApiError("로그인 인증 코드가 없습니다.")
            val prefs = context.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            val verifier = prefs.getString(VERIFIER, null)
                ?: throw NativeApiError("로그인 확인값이 없습니다. 다시 로그인해 주세요.")
            val url = BuildConfig.SUPABASE_URL.trimEnd('/') + "/auth/v1/token?grant_type=pkce"
            val req = Request.Builder().url(url)
                .header("apikey", BuildConfig.SUPABASE_ANON_KEY)
                .header("Content-Type", "application/json")
                .post(JSONObject().put("auth_code", code).put("code_verifier", verifier)
                    .toString().toRequestBody("application/json".toMediaType()))
                .build()
            http.newCall(req).execute().use { res ->
                val raw = res.body?.string().orEmpty()
                if (!res.isSuccessful) {
                    val msg = try { JSONObject(raw).optString("msg").ifBlank {
                        JSONObject(raw).optString("message")
                    } } catch (_: Exception) { "" }
                    throw NativeApiError(msg.ifBlank { "로그인을 완료하지 못했습니다." })
                }
                prefs.edit().remove(VERIFIER).apply()
                val j = JSONObject(raw)
                val access = j.optString("access_token")
                val refresh = j.optString("refresh_token")
                val user = j.optJSONObject("user")
                val uid = user?.optString("id").orEmpty().ifBlank { jwtUserId(access) }
                val meta = user?.optJSONObject("user_metadata")
                val name = sequenceOf("name", "full_name", "preferred_username", "user_name")
                    .map { meta?.optString(it).orEmpty() }.firstOrNull { it.isNotBlank() }.orEmpty()
                val session = NativeSession(
                    uid, access, refresh,
                    System.currentTimeMillis() + j.optLong("expires_in", 3600) * 1000L,
                    BuildConfig.SUPABASE_URL, BuildConfig.SUPABASE_ANON_KEY, name
                )
                if (!session.valid) throw NativeApiError("로그인 세션이 올바르지 않습니다.")
                NativeSessionStore.set(context, session)
                session
            }
        }

    private fun jwtUserId(jwt: String): String = try {
        val part = jwt.split('.')[1]
        val decoded = Base64.decode(part, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        JSONObject(decoded.toString(Charsets.UTF_8)).optString("sub")
    } catch (_: Exception) { "" }

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
