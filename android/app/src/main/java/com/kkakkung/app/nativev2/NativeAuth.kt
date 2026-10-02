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
    /*
     * **로그인 요청은 8초에 끊고, 깨어나는 순간에는 기다리지 않고 끊는다**(아이폰·웹의
     * `authFetch`·`dropSlept`와 같은 규칙 · 사용자 제보 — 밤새 둔 앱이 아침에 멈춤 ·
     * `8초면 좀 길지않아??`). 잠든 동안 열려 있던 연결은 거의 늘 죽어 있어, 그대로
     * 기다리면 `refreshLock`에 뒤의 갱신이 다 매달린다. 5초 넘게 가려져 있다 돌아오면
     * (`wake`) 연결을 통째로 버리고 걸려 있던 요청을 끊는다 — 끊긴 갱신은 새 연결로
     * 한 번 더 간다(`refresh`의 두 번째 판).
     */
    private val http = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS).readTimeout(8, TimeUnit.SECONDS)
        .callTimeout(8, TimeUnit.SECONDS).build()
    private const val SLEEP_MIN = 5000L
    @Volatile private var hiddenAt = 0L

    /** 앱이 가려질 때 부른다(`NativeHomeActivity.onPause`). */
    fun sleep() { hiddenAt = System.currentTimeMillis() }

    /** 앱이 다시 보일 때 **다른 일보다 먼저** 부른다(`onResume` 맨 앞). */
    fun wake() {
        val long = hiddenAt > 0 && System.currentTimeMillis() - hiddenAt >= SLEEP_MIN
        hiddenAt = 0
        if (!long) return
        http.connectionPool.evictAll()
        http.dispatcher.cancelAll()
    }
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

    /** 심사용 서버가 이 빌드에 실려 있는가 — 없으면 로그인 화면에 그 문이 안 뜬다. */
    val hasReviewServer: Boolean
        get() = BuildConfig.REVIEW_SUPABASE_URL.startsWith("https://") &&
            BuildConfig.REVIEW_SUPABASE_ANON_KEY.isNotBlank()

    /**
     * **심사용 테스트 계정 로그인**(이메일·비밀번호 · 웹 `signInWithPassword`와 같은 자리).
     *
     * 애플·구글 심사자가 쓰는 **따로 떨어진 Supabase 프로젝트**로 들어간다 — 실제 모임
     * 회원·대화는 거기 없고, 심사자가 글을 써도 회원 폰이 안 울린다. 계정·샘플 자료는
     * `.github/workflows/review.yml`이 채운다.
     *
     * **세션이 서버 주소를 들고 다니므로**(`NativeSession.supabaseUrl`) 다른 곳은 고칠
     * 것이 없다 — 모든 조회·갱신·알림 등록이 그 주소로 간다. 로그아웃하면 세션째
     * 지워져 다음 로그인은 다시 실제 서버(`BuildConfig.SUPABASE_URL`)다.
     */
    suspend fun passwordLogin(context: Context, email: String, password: String): NativeSession =
        withContext(Dispatchers.IO) {
            if (!hasReviewServer) throw NativeApiError("심사용 서버가 이 앱에 없습니다.")
            val base = BuildConfig.REVIEW_SUPABASE_URL
            val key = BuildConfig.REVIEW_SUPABASE_ANON_KEY
            val req = Request.Builder().url(base.trimEnd('/') + "/auth/v1/token?grant_type=password")
                .header("apikey", key)
                .header("Content-Type", "application/json")
                .post(JSONObject().put("email", email.trim()).put("password", password)
                    .toString().toRequestBody("application/json".toMediaType()))
                .build()
            val res = try { http.newCall(req).execute() } catch (e: java.io.IOException) {
                throw NativeApiError("인터넷 연결이 불안정합니다. 잠시 뒤 다시 시도해 주세요.", "network")
            }
            res.use {
                val raw = it.body?.string().orEmpty()
                if (!it.isSuccessful) {
                    throw NativeApiError(if (it.code == 400) "이메일이나 비밀번호가 맞지 않습니다."
                        else "로그인하지 못했습니다(${it.code}).")
                }
                val j = JSONObject(raw)
                val access = j.optString("access_token")
                val uid = j.optJSONObject("user")?.optString("id").orEmpty().ifBlank { jwtUserId(access) }
                val session = NativeSession(
                    uid, access, j.optString("refresh_token"),
                    System.currentTimeMillis() + j.optLong("expires_in", 3600) * 1000L,
                    base, key, ""
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
            // 한 번 끊기면(죽은 연결 · 깨어나며 끊음 · 8초) 새 연결로 한 번 더 간다.
            val res = try { http.newCall(req).execute() } catch (e: java.io.IOException) {
                http.connectionPool.evictAll()
                try { http.newCall(req).execute() } catch (e2: java.io.IOException) {
                    throw NativeApiError("인터넷 연결이 불안정합니다. 잠시 뒤 다시 시도해 주세요.", "network")
                }
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
