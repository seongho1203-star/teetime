package com.kkakkung.app.nativev2

import org.json.JSONArray
import org.json.JSONObject

/**
 * 웹 원본에서 NativeApp.open으로 딱 한 번 받은 대화 공통 규칙.
 * Kotlin에는 반응/이모티콘/추천 목록을 복제하지 않는다.
 */
object NativeChatShared {
    @Volatile private var raw: JSONObject? = null

    fun set(open: JSONObject) {
        raw = JSONObject()
            .put("reactions", open.optJSONArray("reactions") ?: JSONArray())
            .put("stickers", open.optJSONArray("stickers") ?: JSONArray())
            .put("suggest", open.optJSONArray("suggest") ?: JSONArray())
            .put("suggestMax", open.optInt("suggestMax", 8))
            .put("suggestAnim", open.optInt("suggestAnim", 4))
    }

    /**
     * 웹뷰가 안 뜨는 판(Native V2)에서는 `NativeApp.open`이 안 불린다 — 그때는 빌드 때
     * 웹 원본에서 뽑아 담은 `chat-shared.json`을 쓴다(`.dev/native-guide.mjs`).
     * 이게 없으면 **이모티콘 단추가 아무 일도 안 하고 반응 줄이 안 뜬다**(실제로 그랬다).
     */
    fun load(context: android.content.Context) {
        if (raw != null) return
        try {
            val text = context.assets.open("chat-shared.json").bufferedReader().use { it.readText() }
            set(JSONObject(text))
        } catch (_: Exception) { }
    }

    fun applyTo(config: JSONObject): JSONObject {
        val v = raw ?: return config
        for (key in listOf("reactions", "stickers", "suggest", "suggestMax", "suggestAnim")) {
            if (v.has(key)) config.put(key, v.get(key))
        }
        return config
    }
}
