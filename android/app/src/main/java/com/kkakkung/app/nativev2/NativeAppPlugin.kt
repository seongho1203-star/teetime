package com.kkakkung.app.nativev2

import android.content.Intent
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "NativeApp")
class NativeAppPlugin : Plugin() {
    @PluginMethod
    fun open(call: PluginCall) {
        val session = NativeSession(
            call.getString("user").orEmpty(),
            call.getString("token").orEmpty(),
            call.getString("url").orEmpty(),
            call.getString("key").orEmpty(),
            call.getString("name").orEmpty()
        )
        if (!session.valid) {
            call.reject("네이티브 앱을 열 로그인 정보가 없습니다.")
            return
        }
        NativeSessionStore.current = session
        activity.runOnUiThread {
            activity.startActivity(
                Intent(activity, NativeHomeActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            )
            call.resolve(JSObject().put("ok", true))
        }
    }

    @PluginMethod
    fun session(call: PluginCall) {
        val current = NativeSessionStore.current
        val user = call.getString("user")
        val token = call.getString("token")
        if (current != null && current.userId == user && !token.isNullOrBlank()) {
            current.accessToken = token
        }
        call.resolve()
    }
}
