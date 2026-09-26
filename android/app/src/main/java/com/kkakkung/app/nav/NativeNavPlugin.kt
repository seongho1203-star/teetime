package com.kkakkung.app.nav

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * 웹과 `NavLayer` 사이의 다리 — 신호는 `src/lib/native-nav.ts`에 적혀 있다.
 * 아이폰 `NativeNavPlugin.swift`와 같은 이름·같은 신호다.
 *
 * **`MainActivity`가 손으로 등록한다** — Capacitor는 npm으로 깐 플러그인만
 * 스스로 찾는다. 층 자체는 `super.onCreate` 뒤에 `NavLayer.install`로 선다
 * (그때 웹뷰가 있다).
 */
@CapacitorPlugin(name = "NativeNav")
class NativeNavPlugin : Plugin() {
    override fun load() {
        activity.runOnUiThread { hook() }
    }

    private fun hook() {
        val layer = NavLayer.instance ?: return
        layer.onBack = { phase ->
            notifyListeners("nav", JSObject().put("type", "back").put("phase", phase))
        }
    }

    @PluginMethod
    fun ready(call: PluginCall) { call.resolve(JSObject().put("v", 1)) }

    @PluginMethod
    fun push(call: PluginCall) {
        activity.runOnUiThread {
            hook()
            val layer = NavLayer.instance
            if (layer == null) { call.resolve(); return@runOnUiThread }
            val ms = (call.getDouble("ms") ?: 0.0).toLong()
            layer.push(ms, call.getBoolean("native") ?: false) { call.resolve() }
        }
    }

    @PluginMethod
    fun pop(call: PluginCall) {
        activity.runOnUiThread {
            hook()
            val layer = NavLayer.instance
            if (layer == null) { call.resolve(); return@runOnUiThread }
            val ms = (call.getDouble("ms") ?: 0.0).toLong()
            layer.pop(ms, call.getBoolean("native") ?: false) { call.resolve() }
        }
    }

    @PluginMethod
    fun back(call: PluginCall) {
        activity.runOnUiThread {
            hook()
            NavLayer.instance?.armed = call.getBoolean("on") ?: false
            call.resolve()
        }
    }

    @PluginMethod
    fun touch(call: PluginCall) {
        activity.runOnUiThread {
            NavLayer.instance?.free = call.getBoolean("free") ?: true
            call.resolve()
        }
    }

    @PluginMethod
    fun rendered(call: PluginCall) {
        activity.runOnUiThread { NavLayer.instance?.rendered(); call.resolve() }
    }
}
