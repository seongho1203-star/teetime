package com.kkakkung.app.nativev2

import android.content.Context
import android.net.Uri
import android.util.Base64
import com.kkakkung.app.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
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

    /** 갱신은 한 번에 하나만 — 아래 `refresh`. */
    private val refreshLock = Mutex()

    /** 정말로 로그인이 끝났을 때(서버가 갱신 열쇠를 거절했을 때) 부른다 — 홈이 로그인 화면으로 보낸다. */
    @Volatile var onExpired: (() -> Unit)? = null

    /**
     * 토큰을 새로 받는다.
     *
     * **한 번에 하나만 간다**(사용자 제보 — `앱을 한동안 사용안하다가 접속하면` 로그인이
     * 만료됐다고 떴다). 오래 쉬고 들어오면 토큰이 이미 지나 있고, 홈은 조회 여덟을
     * 한꺼번에 보내 **여덟이 같은 갱신 열쇠로 동시에** 갱신하러 갔다 — 갱신 열쇠는 한 번
     * 쓰면 바뀌므로 뒤엣것들이 거절당했다. 먼저 든 하나만 가고 나머지는 그 결과를 쓴다.
     *
     * `stale` — 401을 받은 그 토큰. 그새 누가 이미 바꿔 두었으면 다시 안 간다.
     *
     * **로그인을 지우는 것은 서버가 열쇠를 거절했을 때(4xx)뿐이다.** 예전에는 통신이
     * 잠깐 끊기거나 서버가 5xx를 줘도 지워서, 깨어나자마자 인터넷이 덜 붙은 폰은
     * 그대로 로그아웃됐다. 그때는 지우지 않고 `다시 시도` 말만 던진다(code `network`).
     */
    suspend fun refresh(session: NativeSession, stale: String? = null): NativeSession = refreshLock.withLock {
        if (stale != null) { if (session.accessToken != stale) return@withLock session }
        else if (!session.needsRefresh) return@withLock session
        withContext(Dispatchers.IO) {
            if (session.refreshToken.isBlank()) throw NativeApiError("다시 로그인해 주세요.", "expired")
            val url = session.supabaseUrl.trimEnd('/') + "/auth/v1/token?grant_type=refresh_token"
            val req = Request.Builder().url(url)
                .header("apikey", session.anonKey)
                .header("Content-Type", "application/json")
                .post(JSONObject().put("refresh_token", session.refreshToken).toString()
                    .toRequestBody("application/json".toMediaType()))
                .build()
            val res = try { http.newCall(req).execute() } catch (e: java.io.IOException) {
                throw NativeApiError("인터넷 연결이 불안정합니다. 잠시 뒤 다시 시도해 주세요.", "network")
            }
            res.use {
                val raw = it.body?.string().orEmpty()
                if (!it.isSuccessful) {
                    if (it.code in 400..499 && it.code != 408 && it.code != 429) {
                        NativeSessionStore.clear()
                        onExpired?.invoke()
                        throw NativeApiError("로그인이 만료됐습니다. 다시 로그인해 주세요.", "expired")
                    }
                    throw NativeApiError("서버에 연결하지 못했습니다(${it.code}). 잠시 뒤 다시 시도해 주세요.", "network")
                }
                val j = JSONObject(raw)
                session.accessToken = j.optString("access_token")
                j.optString("refresh_token").takeIf { t -> t.isNotBlank() }?.let { t -> session.refreshToken = t }
                val seconds = j.optLong("expires_in", 3600)
                session.expiresAt = System.currentTimeMillis() + seconds * 1000L
                NativeSessionStore.persist()
                session
            }
        }
    }
}
