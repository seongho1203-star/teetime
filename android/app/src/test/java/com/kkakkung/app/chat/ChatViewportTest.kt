package com.kkakkung.app.chat

import org.junit.Assert.*
import org.junit.Test

class ChatViewportTest {
    @Test fun prependingHistoryKeepsTheMessageAndItsOffset() {
        val saved = ChatViewport(false, listOf("b" to -24, "c" to 80), 1)
        assertEquals(3 to -24, saved.resolve(listOf("older1", "older2", "a", "b", "c", "new")))
    }

    @Test fun deletedTopMessageUsesASurvivingVisibleNeighbour() {
        val saved = ChatViewport(false, listOf("b" to -24, "c" to 80), 1)
        assertEquals(1 to 80, saved.resolve(listOf("a", "c", "d")))
    }

    @Test fun removedVisiblePageFallsBackInsideTheRemainingList() {
        val saved = ChatViewport(false, listOf("gone" to -24), 80)
        assertEquals(1 to 0, saved.resolve(listOf("a", "b")))
        assertNull(saved.resolve(emptyList()))
    }
}
