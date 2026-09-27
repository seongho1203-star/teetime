package com.kkakkung.app.nativev2

import kotlin.random.Random

internal data class GroupPerson(val id: String, val gender: String?, val birth_year: Int?)
/** Keep function names/semantics aligned with src/lib/groups.ts and iOS GroupRules. */
internal object GroupRules {
    fun groupSizes(total: Int, size: Int): List<Int> {
        if (total <= 0 || size <= 0) return emptyList()
        val count = (total + size - 1) / size
        return List(count) { total / count + if (it < total % count) 1 else 0 }
    }
    private fun roomiest(filled: IntArray, caps: List<Int>): Int = caps.indices
        .filter { filled[it] < caps[it] }.minByOrNull { filled[it] } ?: -1
    private fun deal(order: List<GroupPerson>, caps: List<Int>): Map<String, Int> {
        val filled = IntArray(caps.size); val out = linkedMapOf<String, Int>()
        for (p in order) { val g = roomiest(filled, caps); if (g < 0) break; filled[g]++; out[p.id] = g + 1 }
        return out
    }
    private fun chunk(order: List<GroupPerson>, caps: List<Int>): Map<String, Int> {
        val out = linkedMapOf<String, Int>(); var i = 0
        caps.forEachIndexed { g, cap -> repeat(cap) { if (i < order.size) out[order[i++].id] = g + 1 } }
        return out
    }
    private fun snake(order: List<GroupPerson>, caps: List<Int>): Map<String, Int> {
        val out = linkedMapOf<String, Int>(); val filled = IntArray(caps.size); var i = 0; var row = 0
        while (i < order.size) {
            var placed = false
            val seq = if (row % 2 == 0) caps.indices.toList() else caps.indices.reversed()
            for (g in seq) if (i < order.size && filled[g] < caps[g]) {
                filled[g]++; out[order[i++].id] = g + 1; placed = true
            }
            if (!placed) break
            row++
        }
        return out
    }
    private fun shuffled(list: List<GroupPerson>, random: Random) = list.shuffled(random)
    private fun genderOf(p: GroupPerson) = p.gender?.takeIf { it == "m" || it == "f" } ?: "?"
    fun splitGroups(people: List<GroupPerson>, size: Int, mode: String, random: Random = Random.Default): Map<String, Int> {
        val caps = groupSizes(people.size, size)
        if (caps.isEmpty()) return emptyMap()
        return when (mode) {
            "seq" -> chunk(people, caps)
            "random" -> chunk(shuffled(people, random), caps)
            "gender" -> {
                val bag = people.groupBy(::genderOf)
                val known = listOf(bag["f"].orEmpty(), bag["m"].orEmpty()).sortedBy { it.size }
                deal(known.flatten() + bag["?"].orEmpty(), caps)
            }
            else -> snake(people.sortedBy { it.birth_year ?: Int.MAX_VALUE }, caps)
        }
    }
}

internal object SettlementRules {
    /** Only manually edited amounts are fixed; remaining people share the remainder. */
    fun split(total: Int, ids: List<String>, fixed: Map<String, Int>): Map<String, Int> {
        require(total >= 0 && ids.isNotEmpty())
        val locked = fixed.filterKeys { it in ids }
        require(locked.values.all { it >= 0 })
        val rest = total.toLong() - locked.values.sumOf { it.toLong() }
        require(rest >= 0)
        val free = ids.filterNot { it in locked }
        if (free.isEmpty()) { require(rest == 0L); return ids.associateWith { locked.getValue(it) } }
        val each = (rest / free.size / 10 * 10).toInt()
        val left = (rest - each.toLong() * free.size).toInt()
        return ids.associateWith { locked[it] ?: each + if (it == free.first()) left else 0 }
    }
}
