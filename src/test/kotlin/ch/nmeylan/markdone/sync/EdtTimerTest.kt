package ch.nmeylan.markdone.sync

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.testFramework.PlatformTestUtil
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.concurrency.AppExecutorUtil
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** [scheduleOnEdt] with the real application scheduler. */
class EdtTimerTest : BasePlatformTestCase() {
    private val runs = AtomicInteger()
    private val onEdt = AtomicInteger()

    private val task = {
        runs.incrementAndGet()
        if (ApplicationManager.getApplication().isDispatchThread) onEdt.incrementAndGet()
        Unit
    }

    fun testTaskRunsOnTheEdtAfterTheDelay() {
        scheduleOnEdt(50, ModalityState.any(), task)
        assertEquals("Not before the delay", 0, runs.get())
        val deadline = System.currentTimeMillis() + 10_000
        while (runs.get() == 0 && System.currentTimeMillis() < deadline) {
            PlatformTestUtil.dispatchAllEventsInIdeEventQueue()
            Thread.sleep(10)
        }
        assertEquals(1, runs.get())
        assertEquals("On the EDT", 1, onEdt.get())
    }

    fun testCancelBeforeTheDelayPreventsTheTask() {
        val cancel = scheduleOnEdt(300, ModalityState.any(), task)
        cancel()
        Thread.sleep(500)
        PlatformTestUtil.dispatchAllEventsInIdeEventQueue()
        assertEquals(0, runs.get())
    }

    fun testCancelAfterTheTaskIsQueuedPreventsTheTask() {
        val cancel = scheduleOnEdt(0, ModalityState.any(), task)
        // The scheduled pool task is done: the EDT task is queued, and the EDT is blocked by this test thread.
        val scheduler = AppExecutorUtil.getAppScheduledExecutorService()
        val barrier = java.util.concurrent.CountDownLatch(1)
        scheduler.schedule({ barrier.countDown() }, 200, TimeUnit.MILLISECONDS)
        assertTrue(barrier.await(10, TimeUnit.SECONDS))
        cancel()
        PlatformTestUtil.dispatchAllEventsInIdeEventQueue()
        assertEquals(0, runs.get())
    }
}
