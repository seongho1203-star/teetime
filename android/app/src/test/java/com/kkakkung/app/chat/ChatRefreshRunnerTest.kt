package com.kkakkung.app.chat

import kotlinx.coroutines.*
import org.junit.Assert.assertEquals
import org.junit.Test

class ChatRefreshRunnerTest {
    @Test fun reconnectDuringRefreshRunsOneAdditionalPass() = runBlocking {
        withTimeout(3000) {
            val first = CompletableDeferred<Unit>()
            val release = CompletableDeferred<Unit>()
            val second = CompletableDeferred<Unit>()
            var calls = 0
            val runner = ChatRefreshRunner(this) {
                calls++
                if (calls == 1) { first.complete(Unit); release.await() }
                else second.complete(Unit)
            }
            runner.request(); first.await()
            repeat(5) { runner.request() }
            assertEquals(1, calls)
            release.complete(Unit); second.await(); yield()
            assertEquals(2, calls)
            runner.cancel()
        }
    }

    @Test fun cancelledOldRefreshCannotClearNewSessionWorker() = runBlocking {
        withTimeout(3000) {
            val first = CompletableDeferred<Unit>()
            val finishOld = CompletableDeferred<Unit>()
            val oldFinished = CompletableDeferred<Unit>()
            val second = CompletableDeferred<Unit>()
            val finishSecond = CompletableDeferred<Unit>()
            val third = CompletableDeferred<Unit>()
            var calls = 0
            val runner = ChatRefreshRunner(this) {
                when (++calls) {
                    1 -> try { first.complete(Unit); awaitCancellation() }
                         finally { withContext(NonCancellable) { withTimeout(1000) { finishOld.await() }; oldFinished.complete(Unit) } }
                    2 -> { second.complete(Unit); finishSecond.await() }
                    3 -> third.complete(Unit)
                }
            }
            runner.request(); first.await()
            runner.cancel(); runner.request(); second.await()
            finishOld.complete(Unit); oldFinished.await(); yield()
            runner.request(); yield()
            assertEquals(2, calls)
            finishSecond.complete(Unit); third.await(); yield()
            assertEquals(3, calls)
            runner.cancel()
        }
    }
}
