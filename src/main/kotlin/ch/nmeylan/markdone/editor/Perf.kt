package ch.nmeylan.markdone.editor

import com.google.gson.JsonObject
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption

/**
 * Kotlin-side performance numbers (protocol/PROTOCOL.md): debug log `#ch.nmeylan.markdone.perf`, and JSON
 * lines appended to the file in the system property `markdone.perf.file` when it is set.
 */
object Perf {
    private val LOG = Logger.getInstance("#ch.nmeylan.markdone.perf")
    private val fileLock = Any()

    fun record(metric: String, ms: Long, fileName: String) {
        LOG.debug("$metric=$ms ms ($fileName)")
        val target = System.getProperty("markdone.perf.file")?.takeIf { it.isNotBlank() } ?: return
        val line = JsonObject().apply {
            addProperty("metric", metric)
            addProperty("ms", ms)
            addProperty("file", fileName)
        }.toString() + "\n"
        ApplicationManager.getApplication().executeOnPooledThread {
            synchronized(fileLock) {
                try {
                    Files.writeString(Path.of(target), line, StandardOpenOption.CREATE, StandardOpenOption.APPEND)
                } catch (e: Exception) {
                    LOG.warn("Cannot write perf file $target", e)
                }
            }
        }
    }
}
