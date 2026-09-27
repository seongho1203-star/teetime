package com.kkakkung.app.nativev2

import org.junit.Assert.*
import org.junit.Test
import kotlin.random.Random

class NativeParityRulesTest {
    @Test fun ninePeopleUseThreeBalancedGroups() {
        assertEquals(listOf(3, 3, 3), GroupRules.groupSizes(9, 4))
        val people = (1..9).map { GroupPerson("$it", null, null) }
        assertEquals(mapOf(1 to 3, 2 to 3, 3 to 3), GroupRules.splitGroups(people, 4, "seq").values.groupingBy { it }.eachCount())
    }
    @Test fun allModesKeepEveryMemberAndRespectCapacity() {
        for (n in 1..100) for (size in 2..4) for (mode in listOf("seq", "random", "gender", "age")) {
            val people = (1..n).map { GroupPerson("$it", when(it % 3) { 0 -> "f"; 1 -> "m"; else -> null }, if (it % 5 == 0) null else 1950 + it % 60) }
            val groups = GroupRules.splitGroups(people, size, mode, Random(42))
            assertEquals(people.map { it.id }.toSet(), groups.keys)
            assertEquals(GroupRules.groupSizes(n, size), groups.values.groupingBy { it }.eachCount().toSortedMap().values.toList())
        }
    }
    @Test fun genderMinoritySpreadsBeforeMajority() {
        val people = (1..8).map { GroupPerson("$it", if (it <= 2) "f" else "m", null) }
        val g = GroupRules.splitGroups(people, 4, "gender")
        assertNotEquals(g["1"], g["2"])
    }
    @Test fun manualAmountsStayFixedAcrossTotalAndMemberChanges() {
        assertEquals(mapOf("a" to 340, "b" to 330, "c" to 330), SettlementRules.split(1000, listOf("a", "b", "c"), emptyMap()))
        assertEquals(mapOf("a" to 200, "b" to 410, "c" to 400), SettlementRules.split(1010, listOf("a", "b", "c"), mapOf("a" to 200)))
        assertEquals(mapOf("a" to 200, "b" to 910), SettlementRules.split(1110, listOf("a", "b"), mapOf("a" to 200, "removed" to 9999)))
    }
    @Test(expected = IllegalArgumentException::class) fun invalidFixedAmountsAreRejected() {
        SettlementRules.split(100, listOf("a", "b"), mapOf("a" to 200))
    }
    @Test fun onlyChatIsSuppressedInVisibleForegroundChat() {
        NativePushForeground.active = true; NativePushForeground.chatVisible = true
        assertTrue(NativePushForeground.suppress(mapOf("chat" to "1")))
        assertFalse(NativePushForeground.suppress(mapOf("chat" to "0")))
        assertFalse(NativePushForeground.suppress(emptyMap()))
        NativePushForeground.active = false
        assertFalse(NativePushForeground.suppress(mapOf("chat" to "1")))
        NativePushForeground.active = true; NativePushForeground.chatVisible = false
        assertFalse(NativePushForeground.suppress(mapOf("chat" to "1")))
        NativePushForeground.active = false
    }
}
