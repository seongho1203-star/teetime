package com.kkakkung.app.chat

import android.os.Build
import android.view.ViewGroup
import coil.Coil
import coil.ImageLoader
import coil.decode.GifDecoder
import coil.decode.ImageDecoderDecoder
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject

/**
 * 웹과 대화 화면 사이의 다리 — 아이폰 `NativeChatPlugin.swift`와 같은 이름·
 * 같은 신호다(`src/lib/native-chat.ts`): `open`·`close`·`session`·`reset`,
 * 그리고 `event`(`navigate`·`read`·`auth`·`back`).
 *
 * **`MainActivity`가 손으로 등록한다** — Capacitor는 npm으로 깐 플러그인만
 * 스스로 찾는다.
 *
 * 화면은 한 번 만들면 다시 쓴다(글칸·굴린 자리를 지키려는 것 — 아이폰과
 * 같다). 사람이 바뀌거나 `reset`이 오면 버린다.
 */
@CapacitorPlugin(name = "NativeChat")
class NativeChatPlugin : Plugin() {
    private var chat: ChatScreen? = null
    private var screen = ""

    override fun load() {
        /* 움직이는 이모티콘(webp)을 풀려면 Coil에 gif 디코더를 붙여야 한다 —
           안드로이드 9부터. 그 아래는 첫 장만 멈춘 채 보인다. */
        val loader = ImageLoader.Builder(context).components {
            if (Build.VERSION.SDK_INT >= 28) add(ImageDecoderDecoder.Factory()) else add(GifDecoder.Factory())
        }.crossfade(false).build()
        Coil.setImageLoader(loader)
    }

    @PluginMethod
    fun open(call: PluginCall) {
        activity.runOnUiThread {
            val config = ChatConfig(call.data)
            val screenId = call.getString("screen") ?: ""
            if (!config.valid || screenId.isEmpty()) { call.reject("채팅을 열 수 없습니다."); return@runOnUiThread }
            if (chat != null && chat?.service?.config?.user != config.user) remove(clear = true)
            val c = chat ?: ChatScreen(activity, ChatService(config))
            chat = c; screen = screenId
            c.service.config = config
            c.updateToken(config.token)
            c.event = { type, data ->
                val d = JSObject().put("screen", screen).put("type", type)
                d.put("data", JSObject.fromJSONObject(data))
                notifyListeners("event", d)
            }
            c.service.authNeeded = {
                val d = JSObject().put("screen", screen).put("type", "auth").put("data", JSObject())
                notifyListeners("event", d)
            }
            /* **화면 전환 층이 있으면 거기에 얹는다**(`nav/NavLayer.kt`) — 그래야
               끌어서 뒤로 가는 손짓이 이 화면 위에서도 먹는다. 없는 판(옛 껍데기)
               에서는 예전처럼 창 맨 위에 붙는다. */
            val root: ViewGroup = com.kkakkung.app.nav.NavLayer.instance?.host()
                ?: activity.findViewById(android.R.id.content)
            val fresh = c.parent == null
            c.attach(root)
            /* 뒤로 단추·예측형 손짓도 NavLayer 한 곳에서만 받는다.
               예전 별도 backGuard는 나중에 등록되어 NavLayer의 progress 콜백을
               가로막아 채팅만 손가락 진행률이 끊기는 원인이었다. */
            com.kkakkung.app.nav.NavLayer.instance?.refreshBack()
            val ms = call.getDouble("slide") ?: 0.0
            if (fresh && ms > 40) {
                /* 오른쪽에서 통째로 밀려 들어온다(웹의 `screen-in`과 같은 움직임 —
                   **남은 시간만큼만** 간다. `slideLeft()`가 그 값이다). */
                c.translationX = root.width.toFloat()
                c.animate().translationX(0f).setDuration(ms.toLong()).withEndAction { call.resolve(JSObject().put("ok", true)) }.start()
            } else {
                c.translationX = 0f
                call.resolve(JSObject().put("ok", true))
            }
        }
    }

    @PluginMethod
    fun close(call: PluginCall) {
        activity.runOnUiThread {
            if (call.getString("screen") != screen) { call.resolve(); return@runOnUiThread }
            val c = chat
            if (c == null || c.parent == null) { remove(clear = false); call.resolve(); return@runOnUiThread }
            /* 오른쪽으로 빠져나간다 — 웹이 그 뒤에서 앞 화면을 되살린다. */
            c.animate().translationX(c.width.toFloat()).setDuration(240).withEndAction {
                remove(clear = false); call.resolve()
            }.start()
        }
    }

    @PluginMethod
    fun session(call: PluginCall) {
        activity.runOnUiThread {
            val token = call.getString("token")
            if (call.getString("user") == chat?.service?.config?.user && token != null) chat?.updateToken(token)
            call.resolve()
        }
    }

    @PluginMethod
    fun reset(call: PluginCall) {
        activity.runOnUiThread { remove(clear = true); call.resolve() }
    }

    private fun remove(clear: Boolean) {
        chat?.detach()
        com.kkakkung.app.nav.NavLayer.instance?.refreshBack()
        screen = ""
        if (clear) { chat?.destroy(); chat = null }
    }
}
