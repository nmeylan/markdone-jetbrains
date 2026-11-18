package ch.nmeylan.markdone.sync

import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.command.undo.UndoManager
import com.intellij.openapi.diagnostic.ControlFlowException
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.editor.Document
import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.editor.event.DocumentListener
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.project.Project
import ch.nmeylan.markdone.editor.Perf
import java.beans.PropertyChangeListener

/**
 * IDE side of the page protocol for one document in one page (protocol/PROTOCOL.md):
 * `open`/`reload`/`close`, patches (apply, map or reject), `change` messages from `DocumentEvent`s,
 * `flush`, `writable`, undo/redo. All methods run on the EDT. Dispose it to stop listening to the document.
 * Every stamp is the document's [DocVersion] (protocol 2.1).
 */
class DocumentSync(
    val docId: String,
    private val project: Project?,
    private val document: Document,
    private val version: DocVersion,
    private val view: WebView,
    private val listener: Listener = object : Listener {},
    private val scheduler: Scheduler = Scheduler.EDT,
) : Disposable {

    interface Listener {
        /** The page created the document's state (`opened`). */
        fun onOpened() = Unit

        /** The editor whose undo stack `undo`/`redo` use (the `MdEditor`'s text editor). */
        fun undoEditor(): FileEditor? = null
    }

    /** Runs tasks later on the EDT. */
    interface Scheduler {
        /** Runs [task] after [delayMs]; the result cancels it. */
        fun schedule(delayMs: Long, task: () -> Unit): () -> Unit

        /** Runs [task] once the current EDT event is done (batches the events of one EDT cycle). */
        fun post(task: () -> Unit)

        /** The clock of the typing-burst undo groups. */
        fun nanoTime(): Long = System.nanoTime()

        companion object {
            val EDT = object : Scheduler {
                // The task can change the layout, so it does not run inside a modal dialog opened after the request.
                override fun schedule(delayMs: Long, task: () -> Unit): () -> Unit {
                    return scheduleOnEdt(delayMs, ModalityState.defaultModalityState(), task)
                }

                // any(): document changes made in a modal dialog (for example Replace) reach the page at once.
                override fun post(task: () -> Unit) =
                    ApplicationManager.getApplication().invokeLater(task, ModalityState.any())
            }
        }
    }

    data class Selection(val anchor: Int, val head: Int)

    private class PendingFlush(val seq: Long, val onDone: () -> Unit, val cancelTimeout: () -> Unit)

    private val log = EventLog()

    // The page has the document open or is loading it: only then the events are logged.
    private var logging = false
    private var opened = false
    private var disposed = false

    // Stamp of the text the page has: from `opened`, the last `ack` and the last `change`.
    private var pageStamp = 0L
    private var lastSeq = 0L
    private var pending: PendingFlush? = null
    private var sentWritable = document.isWritable

    // Our own patch is being applied: its events are logged but not sent back.
    private var applying = false
    private var changePosted = false

    /*
     * Typing burst: patches share one command group (one undo step) until a gap of more than
     * BURST_GAP_MS, a group older than BURST_MAX_MS, or a patch that inserts a newline.
     */
    private var burstId: String? = null
    private var burstCount = 0
    private var burstStartNanos = 0L
    private var lastPatchNanos = 0L

    private val fileName = FileDocumentManager.getInstance().getFile(document)?.name ?: ""

    private val documentListener = object : DocumentListener {
        override fun documentChanged(event: DocumentEvent) {
            if (!logging) return
            log.add(event, version.value)
            if (applying || !opened || changePosted) return
            changePosted = true
            scheduler.post {
                changePosted = false
                if (!disposed) sendChanges()
            }
        }
    }

    private val writableListener = PropertyChangeListener { e ->
        if (e.propertyName == Document.PROP_WRITABLE) scheduler.post { if (!disposed) sendWritable() }
    }

    init {
        document.addDocumentListener(documentListener, this)
        document.addPropertyChangeListener(writableListener)
    }

    /** The page has this document's state. */
    val isOpened: Boolean
        get() = opened

    /** Asks the page to create the document's state (call when the page is ready). */
    fun open() {
        reset()
        log.clear()
        logging = true
        lastSeq = 0
        sentWritable = document.isWritable
        send("open") { addProperty("writable", sentWritable) }
    }

    /** Asks the page to load the text again. Changes wait until the page replies `opened`. */
    fun reload() {
        reset()
        send("reload")
    }

    /** Tells the page to drop the document's state. */
    fun close() {
        stop()
        send("close")
    }

    /** The page is gone (crash, release, new page load): nothing is open there any more. */
    fun pageGone() = stop()

    /** Number of logged document events (tests). */
    internal val logSize: Int
        get() = log.size

    private fun stop() {
        reset()
        logging = false
        log.clear()
    }

    private fun reset() {
        opened = false
        completeFlush()
    }

    /**
     * Asks the page to send its pending edits, then runs [onDone] when the reply is acked or after
     * [timeoutMs] (default [FLUSH_TIMEOUT_MS]; [CLOSE_FLUSH_TIMEOUT_MS] where nothing waits on screen).
     * Runs [onDone] at once when the page does not have the document open.
     * A flush that is still waiting is not completed early: its callbacks run, in order, before
     * [onDone] when this newer flush completes.
     */
    fun flush(timeoutMs: Long = FLUSH_TIMEOUT_MS, onDone: () -> Unit) {
        if (!opened) {
            onDone()
            return
        }
        val previous = pending
        previous?.cancelTimeout()
        val seq = ++lastSeq
        val cancel = scheduler.schedule(timeoutMs) {
            if (pending?.seq == seq) {
                LOG.warn("No flush reply for seq $seq within $timeoutMs ms")
                completeFlush()
            }
        }
        val done: () -> Unit = if (previous == null) onDone else ({ previous.onDone(); onDone() })
        pending = PendingFlush(seq, done, cancel)
        send("flush") { addProperty("seq", seq) }
    }

    /** Sends the writable flag when it changed since the page last got it. */
    fun sendWritable() {
        if (!opened || document.isWritable == sentWritable) return
        sentWritable = document.isWritable
        send("writable") { addProperty("writable", sentWritable) }
    }

    /**
     * Sends the document events that the page does not have as one `change` (in event order), with
     * [selection] if given. Sends `reload` instead when they are too many or too large, or not in the log.
     */
    fun sendChanges(selection: Selection? = null) {
        if (!opened) return
        val current = version.value
        val entries = log.since(pageStamp, current)
        if (entries == null || entries.size > MAX_CHANGE_EVENTS || entries.sumOf { it.newText.length.toLong() } > MAX_CHANGE_CHARS) {
            reload()
            return
        }
        if (entries.isEmpty() && selection == null) return
        val changes = JsonArray(entries.size)
        for (e in entries) {
            changes.add(JsonObject().apply {
                addProperty("from", e.offset)
                addProperty("to", e.offset + e.oldLength)
                addProperty("insert", e.newText)
            })
        }
        send("change") {
            addProperty("stamp", current)
            addProperty("length", document.textLength)
            add("changes", changes)
            if (selection != null) {
                add("selection", JsonObject().apply {
                    addProperty("anchor", selection.anchor)
                    addProperty("head", selection.head)
                })
            }
        }
        pageStamp = current
    }

    /** Handles `opened`, `patch` and the `undo`/`redo` commands of this document. */
    fun receive(message: PageMessage.ForDoc) {
        when (message) {
            is PageMessage.Opened -> {
                opened = true
                pageStamp = message.docStamp
                log.dropBefore(message.docStamp)
                sendWritable()
                sendChanges()
                if (opened) listener.onOpened()
            }
            is PageMessage.Patch -> receivePatch(message)
            is PageMessage.Diverged -> if (opened) {
                // Without `opened`, a reload is already on its way.
                LOG.warn("Page text of $fileName diverged (page ${message.pageLength}, expected ${message.expectedLength} chars); reloading")
                reload()
            }
            is PageMessage.Command -> when (message.name) {
                "undo" -> undoRedo(redo = false)
                "redo" -> undoRedo(redo = true)
            }
            else -> Unit
        }
    }

    private fun receivePatch(message: PageMessage.Patch) {
        // Events not sent yet go first, so the page gets stamps in order (change, then ack).
        sendChanges()
        lastSeq = maxOf(lastSeq, message.seq)
        if (!opened) {
            // A reload is on its way; the page waits for it.
            send("reject") { addProperty("seq", message.seq) }
        } else if (apply(message)) {
            pageStamp = version.value
            send("ack") {
                addProperty("seq", message.seq)
                addProperty("stamp", pageStamp)
                addProperty("length", document.textLength)
            }
            // The page has every event up to here, and its next patch is based on this stamp or later.
            log.dropBefore(pageStamp)
        } else {
            send("reject") { addProperty("seq", message.seq) }
            reload()
        }
        val p = pending
        if (p != null && message.seq >= p.seq) completeFlush()
    }

    /** Applies [message] directly or mapped over the events since its base stamp; `false` = reject. */
    private fun apply(message: PageMessage.Patch): Boolean {
        val events = log.since(message.baseStamp, version.value)
        if (events == null) {
            LOG.info("Patch seq ${message.seq}: base stamp ${message.baseStamp} is not in the event log")
            return false
        }
        log.dropBefore(message.baseStamp)
        val patches = message.patches
        if (patches.isEmpty()) return true
        if (!PatchApplier.isValid(patches, PatchApplier.lengthBefore(document.textLength, events))) {
            LOG.warn("Patch seq ${message.seq}: invalid patch list")
            return false
        }
        val mapped = PatchApplier.map(patches, events)
        if (mapped == null) {
            LOG.info("Patch seq ${message.seq} overlaps a document change; rejected")
            return false
        }
        if (!document.isWritable) {
            LOG.info("Patch seq ${message.seq} for a read-only document; rejected")
            return false
        }
        val now = scheduler.nanoTime()
        val newGroup = burstId == null || patches.any { '\n' in it.text } ||
            now - lastPatchNanos > BURST_GAP_MS * 1_000_000 || now - burstStartNanos > BURST_MAX_MS * 1_000_000
        if (newGroup) {
            burstId = "markdone.typing.$docId.${burstCount++}"
            burstStartNanos = now
        }
        lastPatchNanos = now
        applying = true
        try {
            // A flush on close can be answered after the project is closed: the edit then has no project.
            PatchApplier.apply(project?.takeIf { !it.isDisposed }, document, mapped, burstId)
        } catch (e: Exception) {
            if (e is ControlFlowException) throw e
            // A part of the patch can be in the document now: the reload gives the page the real text.
            LOG.warn("Patch seq ${message.seq} could not be applied; rejected", e)
            return false
        } finally {
            applying = false
        }
        Perf.record("patchApplyMs", (scheduler.nanoTime() - now) / 1_000_000, fileName)
        return true
    }

    /**
     * Flushes the page, then runs the IDE undo (or redo) for the text editor, and sends the
     * resulting events as one `change` with the caret at the end of the last changed range.
     */
    fun undoRedo(redo: Boolean) {
        val start = System.nanoTime()
        flush {
            // Edits flushed now still belong to the burst that undo reverts; the next edit starts a new one.
            burstId = null
            val editor = listener.undoEditor()
            val p = project
            if (disposed || editor == null || p == null || p.isDisposed) return@flush
            val undo = UndoManager.getInstance(p)
            if (if (redo) !undo.isRedoAvailable(editor) else !undo.isUndoAvailable(editor)) return@flush
            sendChanges()
            val before = version.value
            if (redo) undo.redo(editor) else undo.undo(editor)
            val last = log.since(before, version.value)?.lastOrNull()
            sendChanges(last?.let { Selection(it.offset + it.newText.length, it.offset + it.newText.length) })
            Perf.record("undoRoundTripMs", (System.nanoTime() - start) / 1_000_000, fileName)
        }
    }

    private fun send(type: String, fill: JsonObject.() -> Unit = {}) {
        val message = JsonObject()
        message.addProperty("type", type)
        message.addProperty("docId", docId)
        message.fill()
        view.send(message)
    }

    private fun completeFlush() {
        val p = pending ?: return
        pending = null
        p.cancelTimeout()
        p.onDone()
    }

    override fun dispose() {
        disposed = true
        document.removePropertyChangeListener(writableListener)
        stop()
    }

    companion object {
        const val FLUSH_TIMEOUT_MS = 500L

        /** Flush before a close, a browser release, a project close or the IDE exit: nothing waits on screen. */
        const val CLOSE_FLUSH_TIMEOUT_MS = 5_000L
        const val BURST_GAP_MS = 1_000L
        const val BURST_MAX_MS = 3_000L

        /** Above these, Kotlin sends `reload` instead of `change`. */
        const val MAX_CHANGE_EVENTS = 1_000
        const val MAX_CHANGE_CHARS = 1_000_000L

        private val LOG = logger<DocumentSync>()
    }
}
