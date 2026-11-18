package ch.nmeylan.markdone.sync

/** Keeps scheduled and posted tasks so a test runs them when it wants. */
class FakeScheduler : DocumentSync.Scheduler {
    val timeouts = mutableListOf<() -> Unit>()

    /** The delay of each [timeouts] entry, in the same order. */
    val delays = mutableListOf<Long>()
    val posts = mutableListOf<() -> Unit>()
    var cancelled = 0

    /** The clock of [nanoTime]; tests move it. */
    var now = 0L

    override fun schedule(delayMs: Long, task: () -> Unit): () -> Unit {
        timeouts += task
        delays += delayMs
        return { cancelled++ }
    }

    override fun post(task: () -> Unit) {
        posts += task
    }

    override fun nanoTime() = now

    /** Runs the posted tasks, as the end of an EDT cycle would. */
    fun runPosts() {
        while (posts.isNotEmpty()) posts.removeAt(0)()
    }
}
