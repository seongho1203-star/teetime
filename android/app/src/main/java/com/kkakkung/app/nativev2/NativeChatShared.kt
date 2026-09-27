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
            .put("suggestAnim", open.optInt("suggestAnim", 2))
    }

    fun applyTo(config: JSONObject): JSONObject {
        val v = raw ?: return config
        for (key in listOf("reactions", "stickers", "suggest", "suggestMax", "suggestAnim")) {
            if (v.has(key)) config.put(key, v.get(key))
        }
        return config
    }
}
