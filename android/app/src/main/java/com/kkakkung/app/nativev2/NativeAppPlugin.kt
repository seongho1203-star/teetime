package com.kkakkung.app.nativev2

import android.content.Intent
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Android 전체 Native V2를 여는 웹→Kotlin 다리.
 * open의 공통 대화 규칙은 이름을 바꾸지 않고 NativeChatShared에 보관한다.
 */
@CapacitorPlugin(name = "NativeApp")
class NativeAppPlugin : Plugin() {
    @PluginMethod
    fun open(call: PluginCall) {
        val d = call.data
        val user = d.optString("user")
        val token = d.optString("token")
        val url = d.optString("url")
        val key = d.optString("key")
        if (user.isBlank() || token.isBlank() || !url.startsWith("https://") || key.isBlank()) {
            call.reject("Android Native V2 설정이 올바르지 않습니다."); return
        }
        NativeChatShared.set(d)
        val exp = d.optLong("expires", 0L).let { if (it in 1..999_999_999_999L) it * 1000L else it }
        val session = NativeSession(
            userId = user, accessToken = token,
            refreshToken = d.optString("refresh"), expiresAt = exp,
            supabaseUrl = url, anonKey = key, displayName = d.optString("name")
        )
        NativeSessionStore.set(context, session)
        activity.runOnUiThread {
            activity.startActivity(Intent(activity, NativeHomeActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
            call.resolve(JSObject().put("ok", true))
        }
    }

    @PluginMethod fun session(call: PluginCall) {
        NativeSessionStore.current?.let {
            call.getString("token")?.takeIf(String::isNotBlank)?.let { t -> it.accessToken = t }
            NativeSessionStore.persist()
        }
        call.resolve()
    }
}
