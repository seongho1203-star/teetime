package com.kkakkung.app.chat

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/** Call from one dispatcher. Coalesce requests without dropping a refresh during an active run. */
internal class ChatRefreshRunner(private val scope: CoroutineScope, private val refresh: suspend () -> Unit) {
    private var job: Job? = null
    private var pending = false
    private var generation = 0

    fun request() {
        pending = true
        if (job != null) return
        val current = generation
        val next = scope.launch(start = CoroutineStart.LAZY) {
            try {
                while (current == generation && pending) {
                    pending = false
                    refresh()
                }
            } finally {
                if (current == generation) job = null
            }
        }
        job = next
        next.start()
    }

    fun cancel() {
        generation++
        pending = false
        job?.cancel()
        job = null
    }
}
