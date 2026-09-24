package com.kkakkung.app.chat

import org.json.JSONObject

/**
 * 말풍선 한 줄의 재료 — 아이폰 `ChatRow`와 같은 칸이다.
 * 목록은 이것만 보고 그린다(글 원본을 다시 뒤지지 않는다).
 */
class ChatRow(
    val id: String,
    /** text · sticker · photo · system · card */
    val kind: String,
    val mine: Boolean,
    val name: String?,
    val avatar: String?,
    /** 얼굴 테두리 색(남녀). 모르면 null. */
    val edge: Int?,
    val body: String,
    val time: String?,
    val unread: Int,
    val date: String?,
    val image: String?,
    val video: Boolean,
    val cap: String?,
    val big: Boolean,
    val go: String?,
    val to: String?,
    val icon: String?,
    val quoteWho: String?,
    val quoteText: String?,
    val quoteTo: String?,
    val reacts: List<ChatReact>,
    val mark: Boolean,
    /** 윗줄과의 사이(dp). 같은 사람·같은 분이면 2, 아니면 10. */
    val top: Int,
)

class ChatReact(val emoji: String, val n: Int, val mine: Boolean)

/**
 * 글 목록 → 줄 목록. 아이폰 `NativeChatRows.make`를 그대로 옮겼다.
 *
 * - **묶는 단위는 '같은 사람·같은 분'**이고, 이름·얼굴은 묶음의 첫 줄에만,
 *   시각은 마지막 줄에만 붙는다(카톡의 그 규칙 — CLAUDE.md `대화 화면`).
 * - 안 읽은 사람 수는 `room_reads`(사람마다 한 줄)로 센다.
 * - 이모티콘 그림은 **앱 안에 담긴 것**을 가리킨다(`assets/public/stickers/`).
 */
object ChatRows {
    private const val STICKERS = "file:///android_asset/public/stickers/"

    fun make(messages: List<ChatMessage>, user: String, people: List<JSONObject>,
             reads: Map<String, String>, reactions: List<JSONObject>, unread: String?): List<ChatRow> {
        val who = HashMap<String, JSONObject>()
        for (p in people) { val id = p.optString("id"); if (id.isNotEmpty()) who[id] = p }
        val byID = HashMap<String, ChatMessage>()
        for (m in messages) byID[m.id] = m
        val active = people.filter { p -> p.optString("role", "pending") !in listOf("pending", "banned") }
        val activeIds = active.map { it.optString("id") }
        val reactsByMsg = HashMap<String, ArrayList<JSONObject>>()
        for (r in reactions) reactsByMsg.getOrPut(r.optString("message_id")) { ArrayList() }.add(r)

        fun minute(m: ChatMessage) = Iso.format(m.at, "yyyy-MM-dd HH:mm")
        fun day(m: ChatMessage) = Iso.format(m.at, "yyyy-MM-dd")
        fun grouped(a: ChatMessage?, b: ChatMessage?): Boolean {
            if (a == null || b == null || a.system || b.system || a.hidden || b.hidden) return false
            return a.user == b.user && minute(a) == minute(b)
        }

        val out = ArrayList<ChatRow>(messages.size)
        for ((i, m) in messages.withIndex()) {
            val prev = if (i > 0) messages[i - 1] else null
            val next = if (i + 1 < messages.size) messages[i + 1] else null
            val mine = m.user == user
            val top = if (grouped(prev, m)) 2 else 10
            val date = if (prev == null || day(prev) != day(m)) Iso.format(m.at, "M월 d일 (E)") else null
            val mark = m.id == unread

            if (m.hidden) {
                out.add(row(m.id, "system", mine, "가려진 메시지입니다", date, top, mark)); continue
            }
            if (m.system) {
                var kind = "system"; var to: String? = null; var go: String? = null; var icon: String? = null
                for ((field, path, title, ic) in listOf(
                    arrayOf("round_id", "rounds", "라운드", "round"),
                    arrayOf("poll_id", "polls", "투표", "poll"),
                    arrayOf("post_id", "board", "공지", "post"))) {
                    if (!m.raw.isNull(field) && m.raw.optString(field).isNotEmpty()) {
                        kind = "card"; to = "/$path/${m.raw.optString(field)}"; go = "$title 보러 가기 ›"; icon = ic; break
                    }
                }
                out.add(ChatRow(m.id, kind, mine, null, null, null, m.body, null, 0, date, null, false, null, false,
                    go, to, icon, null, null, null, emptyList(), mark, top)); continue
            }

            var name: String? = null; var avatar: String? = null; var edge: Int? = null
            if (!mine && !grouped(prev, m)) {
                val p = who[m.user]
                if (p != null) {
                    name = label(p)
                    avatar = if (p.isNull("avatar_url")) null else p.optString("avatar_url").ifEmpty { null }
                    when (p.optString("gender")) {
                        "f" -> edge = 0xFFE84A7F.toInt()
                        "m" -> edge = 0xFF269BBE.toInt()
                    }
                }
            }
            val time = if (!grouped(m, next)) Iso.format(m.at, "a h:mm") else null
            val at = Iso.ms(m.at)
            var unreadN = 0
            for (id in activeIds) {
                if (id == m.user) continue
                if (Iso.ms(reads[id]) < at) unreadN++
            }
            var kind = "text"; var image: String? = null; var cap: String? = null; var video = false
            val img = m.image
            if (img != null) {
                if (img.startsWith("sticker:")) {
                    kind = "sticker"
                    val id = img.substring(8)
                    image = STICKERS + id + (if (id.startsWith("mv")) ".webp" else ".png")
                } else {
                    kind = "photo"; image = img; video = ChatMedia.isVideo(img)
                }
                cap = m.body.ifEmpty { null }
            }
            val big = m.reply == null && img == null && emojiOnly(m.body)
            var quoteWho: String? = null; var quoteText: String? = null; var quoteTo: String? = null
            val replyId = m.reply
            if (replyId != null) {
                val original = byID[replyId]
                val ownerName = original?.let { who[it.user]?.optString("name") }
                quoteWho = if (!ownerName.isNullOrEmpty()) "${ownerName}에게 댓글" else "댓글"
                quoteText = original?.preview ?: "이전 메시지 보기"
                quoteTo = replyId
            }
            val order = ArrayList<String>(); val counts = HashMap<String, Int>(); val mineSet = HashSet<String>()
            for (r in reactsByMsg[m.id] ?: emptyList<JSONObject>()) {
                val e = r.optString("emoji"); if (e.isEmpty()) continue
                if (!counts.containsKey(e)) order.add(e)
                counts[e] = (counts[e] ?: 0) + 1
                if (r.optString("user_id") == user) mineSet.add(e)
            }
            val reacts = order.map { ChatReact(it, counts[it] ?: 0, mineSet.contains(it)) }
            out.add(ChatRow(m.id, kind, mine, name, avatar, edge, m.body, time, unreadN, date, image, video, cap,
                big, null, null, null, quoteWho, quoteText, quoteTo, reacts, mark, top))
        }
        return out
    }

    private fun row(id: String, kind: String, mine: Boolean, body: String, date: String?, top: Int, mark: Boolean) =
        ChatRow(id, kind, mine, null, null, null, body, null, 0, date, null, false, null, false,
            null, null, null, null, null, null, emptyList(), mark, top)

    /** `83/신성호/광산구` — 웹 `personLabel`과 같다. 모르는 조각은 그냥 뺀다. */
    fun label(p: JSONObject): String {
        val parts = ArrayList<String>()
        if (!p.isNull("birth_year")) parts.add(String.format("%02d", p.optInt("birth_year") % 100))
        val name = p.optString("name"); if (name.isNotEmpty()) parts.add(name)
        if (!p.isNull("region")) { val r = p.optString("region"); if (r.isNotEmpty()) parts.add(r) }
        return parts.joinToString("/")
    }

    /** 이모지만 셋까지 보낸 글은 말풍선을 벗기고 크게 그린다. */
    fun emojiOnly(text: String): Boolean {
        val chars = text.filter { !it.isWhitespace() }
        if (chars.isEmpty()) return false
        var count = 0
        var i = 0
        while (i < chars.length) {
            val cp = chars.codePointAt(i)
            val emoji = cp >= 0x1F000 || cp in 0x2600..0x27BF || cp == 0xFE0F || cp == 0x20E3 || cp == 0x200D || cp in 0x1F3FB..0x1F3FF
            if (!emoji) return false
            if (cp >= 0x1F000 || cp in 0x2600..0x27BF) count++
            i += Character.charCount(cp)
        }
        return count in 1..3
    }
}
