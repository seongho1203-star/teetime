package com.kkakkung.app.chat

/** Message IDs survive prepending history; visible neighbours cover a deleted top row. */
internal data class ChatViewport(
    val bottom: Boolean,
    val anchors: List<Pair<String, Int>>,
    val fallbackIndex: Int
) {
    fun resolve(ids: List<String>): Pair<Int, Int>? {
        if (ids.isEmpty()) return null
        for ((id, offset) in anchors) {
            val index = ids.indexOf(id)
            if (index >= 0) return index to offset
        }
        return fallbackIndex.coerceIn(0, ids.lastIndex) to 0
    }
}
