package ch.nmeylan.markdone.sync

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.util.concurrency.AppExecutorUtil
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Runs [task] on the EDT, in [modality], once [delayMs] have passed.
 * The returned function cancels it, also when the task is already waiting in the EDT queue.
 */
fun scheduleOnEdt(delayMs: Long, modality: ModalityState, task: () -> Unit): () -> Unit {
    val cancelled = AtomicBoolean(false)
    val future = AppExecutorUtil.getAppScheduledExecutorService().schedule({
        ApplicationManager.getApplication().invokeLater({ if (!cancelled.get()) task() }, modality)
    }, delayMs, TimeUnit.MILLISECONDS)
    return {
        cancelled.set(true)
        future.cancel(false)
    }
}
