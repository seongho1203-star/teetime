package com.kkakkung.app.nativev2

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Android Native V2 세션. refresh token까지 네이티브가 소유한다. */
data class NativeSession(
    val userId: String,
    var accessToken: String,
    var refreshToken: String,
    var expiresAt: Long,
    val supabaseUrl: String,
    val anonKey: String,
    val displayName: String = ""
) {
    val valid: Boolean
        get() = userId.isNotBlank() && accessToken.isNotBlank() &&
            supabaseUrl.startsWith("https://") && anonKey.isNotBlank()

    val needsRefresh: Boolean
        get() = refreshToken.isNotBlank() && expiresAt > 0 &&
            System.currentTimeMillis() >= expiresAt - 60_000L
}

/**
 * refresh token을 평문 SharedPreferences에 두지 않는다.
 * Android Keystore AES/GCM으로 암호화해 앱 재실행 뒤에도 Native V2가
 * WebView 로그인 없이 세션을 복원할 수 있게 한다.
 */
object NativeSessionStore {
    @Volatile var current: NativeSession? = null
        private set

    private const val PREF = "kk_native_v2"
    private const val KEY = "session"
    private const val ALIAS = "kk_native_v2_session"
    private var app: Context? = null

    @JvmStatic fun init(context: Context) {
        app = context.applicationContext
    }

    @JvmStatic fun set(context: Context, session: NativeSession) {
        init(context)
        current = session
        persist()
    }

    @JvmStatic fun restore(context: Context): NativeSession? {
        init(context)
        current?.let { return it }
        val packed = context.getSharedPreferences(PREF, Context.MODE_PRIVATE).getString(KEY, null)
            ?: return null
        return try {
            val raw = decrypt(packed)
            val j = JSONObject(raw)
            NativeSession(
                userId = j.optString("user"),
                accessToken = j.optString("access"),
                refreshToken = j.optString("refresh"),
                expiresAt = j.optLong("expires"),
                supabaseUrl = j.optString("url"),
                anonKey = j.optString("key"),
                displayName = j.optString("name")
            ).takeIf { it.valid }?.also { current = it }
        } catch (_: Exception) {
            clear(context); null
        }
    }

    @JvmStatic fun persist() {
        val context = app ?: return
        val s = current ?: return
        val raw = JSONObject()
            .put("user", s.userId).put("access", s.accessToken)
            .put("refresh", s.refreshToken).put("expires", s.expiresAt)
            .put("url", s.supabaseUrl).put("key", s.anonKey).put("name", s.displayName)
            .toString()
        try {
            context.getSharedPreferences(PREF, Context.MODE_PRIVATE)
                .edit().putString(KEY, encrypt(raw)).apply()
        } catch (_: Exception) { /* 메모리 세션은 계속 사용한다 */ }
    }

    @JvmStatic fun clear(context: Context? = app) {
        current = null
        context?.getSharedPreferences(PREF, Context.MODE_PRIVATE)?.edit()?.remove(KEY)?.apply()
    }

    private fun secret(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder(
                ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build())
            generateKey()
        }
    }

    private fun encrypt(raw: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secret())
        val iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
        val data = Base64.encodeToString(cipher.doFinal(raw.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
        return "$iv.$data"
    }

    private fun decrypt(packed: String): String {
        val (iv, data) = packed.split('.', limit = 2)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, secret(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
        return cipher.doFinal(Base64.decode(data, Base64.NO_WRAP)).toString(Charsets.UTF_8)
    }
}
