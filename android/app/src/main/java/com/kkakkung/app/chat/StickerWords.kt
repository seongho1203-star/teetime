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
