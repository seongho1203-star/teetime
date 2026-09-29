package com.kkakkung.app.chat

import java.util.Locale

/** Match the shared suggest.ts normalizer: remove whitespace only; retain punctuation. */
internal object StickerWords {
    data class Normalized(val text: String, val starts: List<Int>, val ends: List<Int>)
    fun mapped(raw: String): Normalized {
        val text = StringBuilder(); val starts = mutableListOf<Int>(); val ends = mutableListOf<Int>()
        var index = 0
        while (index < raw.length) {
            val cp = raw.codePointAt(index); val end = index + Character.charCount(cp)
            if (!Character.isWhitespace(cp) && !Character.isSpaceChar(cp) && cp != 0xfeff) {
                val fixed = when (cp) { 0xff1f -> "?"; 0xff01 -> "!"; 0xff5e -> "~"; else -> String(Character.toChars(cp)) }
                fixed.lowercase(Locale.ROOT).forEach { text.append(it); starts.add(index); ends.add(end) }
            }
            index = end
        }
        return Normalized(text.toString(), starts, ends)
    }
    fun normalize(raw: String) = mapped(raw).text
    fun split(raw: String): List<String> = raw.split(Regex("[,，\\n]+")).map(::normalize)
        .filter { it.codePointCount(0, it.length) in 1..20 }.distinct()
    /**
     * 한 글자 말(`응`·`헉`)은 **그 한 글자만 쳤을 때만** 걸린다 — 들어 있는가로
     * 보면 글자를 칠 때마다 줄이 뜬다. 두 글자부터는 들어 있으면 걸린다.
     * 아이폰 `NativeChatViewController.suggestFind`와 같은 잣대다.
     */
    fun matches(norm: String, word: String): Boolean =
        if (word.codePointCount(0, word.length) == 1) norm == word else word.isNotEmpty() && norm.contains(word)
    /**
     * **맨 끝에 친 말 하나만 본다**(사용자 요청 — `엥? ㅋㅋ 감사`처럼 치면
     * 마지막 `감사`의 것만). 끝이 가장 뒤인 자리를 고르고, 끝이 같으면 긴 쪽
     * (`감사합니다` > `감사`)이다. 그 자리 **안에 든** 말의 이모티콘은 함께 친다.
     * 돌려주는 것은 칠할 자리(원문)와 이모티콘 id들이다. 아이폰
     * `NativeChatViewController.suggestFind`와 같은 잣대다.
     */
    fun lastHit(raw: String, rules: Map<String, List<String>>): Pair<IntRange, Set<String>>? {
        val q = normalize(raw)
        val found = mutableListOf<Pair<IntRange, String>>()
        rules.forEach { (id, words) ->
            words.forEach { w0 ->
                val w = normalize(w0)
                if (w.isNotEmpty() && matches(q, w)) ranges(raw, listOf(w)).forEach { found.add(it to id) }
            }
        }
        val last = found.map { it.first }.maxWithOrNull(compareBy<IntRange>({ it.last }, { it.last - it.first })) ?: return null
        val ids = found.filter { it.first.first >= last.first && it.first.last <= last.last }.mapTo(LinkedHashSet()) { it.second }
        return last to ids
    }
    fun ranges(raw: String, words: Collection<String>): List<IntRange> {
        val norm = mapped(raw); val out = mutableListOf<IntRange>()
        words.forEach { word ->
            if (word.isNotEmpty() && (word.codePointCount(0, word.length) > 1 || norm.text == word)) {
                var from = 0
                while (from < norm.text.length) {
                    val at = norm.text.indexOf(word, from); if (at < 0) break
                    out.add(norm.starts[at] until norm.ends[at + word.length - 1]); from = at + word.length
                }
            }
        }
        return out.distinct()
    }
}
