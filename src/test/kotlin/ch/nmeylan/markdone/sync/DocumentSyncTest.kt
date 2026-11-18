package ch.nmeylan.markdone.sync

import com.google.gson.JsonObject
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.command.CommandProcessor
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.command.undo.UndoManager
import com.intellij.openapi.editor.Document
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.TextEditor
import com.intellij.openapi.fileEditor.impl.text.TextEditorProvider
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase

/** Per-document sync against a fake page. */
class DocumentSyncTest : BasePlatformTestCase() {
    private val docId = "0123456789abcdef0123456789abcdef"
    private val view = FakeWebView()
    private val scheduler = FakeScheduler()
    private var undoEditor: FileEditor? = null
    private lateinit var document: Document
    private lateinit var version: DocVersion
    private lateinit var sync: DocumentSync

    private fun newSync(doc: Document, listener: DocumentSync.Listener = object : DocumentSync.Listener {}): DocumentSync {
        version = DocVersion(doc)
        Disposer.register(testRootDisposable, version)
        return DocumentSync(docId, project, doc, version, view, listener, scheduler).also { Disposer.register(testRootDisposable, it) }
    }

    /** A file-backed document (undo needs a file) and its sync, opened in the fake page. */
    private fun open(text: String) {
        val file = myFixture.addFileToProject("doc${System.nanoTime()}.md", text).virtualFile
        document = FileDocumentManager.getInstance().getDocument(file)!!
        sync = newSync(document, object : DocumentSync.Listener {
            override fun undoEditor() = undoEditor
        })
        sync.open()
        sync.receive(PageMessage.Opened(docId, version.value))
        view.sent.clear()
    }

    private fun write(edit: () -> Unit) = WriteCommandAction.runWriteCommandAction(project, edit)

    private fun patch(seq: Long, base: Long, vararg patches: TextPatch) =
        sync.receive(PageMessage.Patch(docId, seq, base, patches.toList()))

    private fun types() = view.sent.map { it["type"].asString }

    private fun changes(message: JsonObject): List<Triple<Int, Int, String>> = message["changes"].asJsonArray.map {
        val o = it.asJsonObject
        Triple(o["from"].asInt, o["to"].asInt, o["insert"].asString)
    }

    fun testOpenAndOpenedAtCurrentStamp() {
        val file = myFixture.addFileToProject("a.md", "x").virtualFile
        val doc = FileDocumentManager.getInstance().getDocument(file)!!
        val s = newSync(doc)
        s.open()
        assertEquals(listOf("open"), types())
        assertEquals(docId, view.sent[0]["docId"].asString)
        assertTrue(view.sent[0]["writable"].asBoolean)
        assertFalse(s.isOpened)
        s.receive(PageMessage.Opened(docId, 0L))
        assertTrue(s.isOpened)
        assertEquals(listOf("open"), types())
    }

    fun testFlushWithoutOpenedDocumentCompletesAtOnce() {
        val file = myFixture.addFileToProject("a.md", "x").virtualFile
        val s = newSync(FileDocumentManager.getInstance().getDocument(file)!!)
        var done = 0
        s.flush { done++ }
        assertEquals(1, done)
        assertTrue(view.sent.isEmpty())
    }

    fun testFlushReplyIsAcked() {
        open("# Title\n")
        var done = 0
        val order = mutableListOf<Int>()
        sync.flush { done++; order += 1 }
        sync.flush { done++; order += 2 } // The first flush waits for this one.
        assertEquals(0, done)
        assertEquals(listOf(1L, 2L), view.sent.filter { it["type"].asString == "flush" }.map { it["seq"].asLong })
        patch(1, version.value)
        assertEquals("The reply to the older flush does not complete the newer one", 0, done)
        patch(2, version.value)
        assertEquals(listOf(1, 2), order)
        val ack = view.sent.last()
        assertEquals("ack", ack["type"].asString)
        assertEquals(2L, ack["seq"].asLong)
        assertEquals(version.value, ack["stamp"].asLong)
        assertEquals(document.textLength, ack["length"].asInt)
        assertEquals(2, scheduler.cancelled)
        // The timeout of a completed flush does nothing.
        scheduler.timeouts.forEach { it() }
        assertEquals(2, done)
    }

    fun testFlushTimeoutAndPageGone() {
        open("x")
        var done = 0
        sync.flush { done++ }
        scheduler.timeouts.single()()
        assertEquals(1, done)
        sync.flush { done++ }
        sync.pageGone()
        assertEquals(2, done)
        assertFalse(sync.isOpened)
    }

    fun testFlushSeqFollowsPageSeq() {
        open("abc")
        patch(5, version.value, TextPatch(0, 0, "x"))
        sync.flush {}
        assertEquals(6L, view.sent.last()["seq"].asLong)
    }

    fun testPatchesApplyInDescendingOrderWithoutEcho() {
        open("abcdef")
        val base = version.value
        patch(1, base, TextPatch(0, 1, "X"), TextPatch(2, 4, ""), TextPatch(6, 6, "!"))
        assertEquals("Xbef!", document.text)
        assertEquals(listOf("ack"), types())
        assertEquals(version.value, view.sent[0]["stamp"].asLong)
        scheduler.runPosts()
        assertEquals("Our own write is not sent back", listOf("ack"), types())
    }

    fun testStaleBaseIsMappedOverExternalChange() {
        open("abcdef")
        val base = version.value
        write { document.insertString(0, "12") }
        // The page typed at offset 3 before it got the change.
        patch(1, base, TextPatch(3, 3, "X"))
        assertEquals("12abcXdef", document.text)
        // The pending change goes out first, then the ack.
        assertEquals(listOf("change", "ack"), types())
        assertEquals(listOf(Triple(0, 0, "12")), changes(view.sent[0]))
        assertEquals(version.value, view.sent[1]["stamp"].asLong)
    }

    fun testStaleBaseAfterSentChangeIsMapped() {
        open("abcdef")
        val base = version.value
        write { document.deleteString(4, 6) }
        scheduler.runPosts()
        assertEquals(listOf("change"), types())
        patch(1, base, TextPatch(0, 1, "A"))
        assertEquals("Abcd", document.text)
        assertEquals(listOf("change", "ack"), types())
    }

    fun testOverlapIsRejectedAndReloaded() {
        open("abcdef")
        val base = version.value
        write { document.deleteString(2, 4) }
        patch(1, base, TextPatch(3, 5, "Z"))
        assertEquals("abef", document.text)
        assertEquals(listOf("change", "reject", "reload"), types())
        assertEquals(1L, view.sent[1]["seq"].asLong)
        assertFalse(sync.isOpened)
        // Insert at the same point as an external insert is also a conflict.
        sync.receive(PageMessage.Opened(docId, version.value))
        view.sent.clear()
        val base2 = version.value
        write { document.insertString(1, "q") }
        patch(2, base2, TextPatch(1, 1, "w"))
        assertEquals(listOf("change", "reject", "reload"), types())
    }

    fun testInvalidPatchesAreRejected() {
        open("abcdef")
        val base = version.value
        val invalid = listOf(
            listOf(TextPatch(3, 4, ""), TextPatch(0, 1, "")), // unsorted
            listOf(TextPatch(0, 3, ""), TextPatch(2, 4, "")), // overlapping
            listOf(TextPatch(2, 2, "a"), TextPatch(2, 3, "b")), // same start
            listOf(TextPatch(5, 7, "")), // out of range
            listOf(TextPatch(0, 0, "a\r\nb")), // CR
        )
        for ((i, patches) in invalid.withIndex()) {
            view.sent.clear()
            sync.receive(PageMessage.Opened(docId, version.value))
            sync.receive(PageMessage.Patch(docId, i.toLong() + 1, base, patches))
            assertEquals("case $i", listOf("reject", "reload"), types())
            assertEquals("abcdef", document.text)
        }
    }

    fun testUnknownBaseStampIsRejected() {
        open("abc")
        patch(1, version.value + 12345, TextPatch(0, 0, "x"))
        assertEquals(listOf("reject", "reload"), types())
        assertEquals("abc", document.text)
    }

    fun testReadOnlyDocumentRejectsPatch() {
        open("abc")
        document.setReadOnly(true)
        scheduler.runPosts()
        assertEquals(listOf("writable"), types())
        assertFalse(view.sent[0]["writable"].asBoolean)
        patch(1, version.value, TextPatch(0, 0, "x"))
        assertEquals(listOf("writable", "reject", "reload"), types())
        assertEquals("abc", document.text)
    }

    fun testEventsOfOneCycleGoOutAsOneSequentialChange() {
        open("abcd")
        write { document.insertString(0, "A") }
        write { document.deleteString(2, 3) }
        assertTrue(view.sent.isEmpty())
        scheduler.runPosts()
        assertEquals(listOf("change"), types())
        val change = view.sent[0]
        assertEquals(listOf(Triple(0, 0, "A"), Triple(2, 3, "")), changes(change))
        assertEquals(version.value, change["stamp"].asLong)
        assertEquals(document.textLength, change["length"].asInt)
        assertFalse(change.has("selection"))
        assertEquals("Aacd", document.text)
    }

    fun testChangesBeforeOpenedAreSentAfterIt() {
        val file = myFixture.addFileToProject("b.md", "abc").virtualFile
        document = FileDocumentManager.getInstance().getDocument(file)!!
        sync = newSync(document)
        sync.open()
        val docStamp = version.value
        write { document.insertString(3, "d") } // After the page read /doc.
        scheduler.runPosts()
        assertEquals(listOf("open"), types())
        sync.receive(PageMessage.Opened(docId, docStamp))
        assertEquals(listOf("open", "change"), types())
        assertEquals(listOf(Triple(3, 3, "d")), changes(view.sent[1]))
    }

    fun testManyEventsReload() {
        open("")
        write { repeat(DocumentSync.MAX_CHANGE_EVENTS + 1) { document.insertString(0, "x") } }
        scheduler.runPosts()
        assertEquals(listOf("reload"), types())
        assertFalse(sync.isOpened)
        // No change while the page loads again.
        write { document.insertString(0, "y") }
        scheduler.runPosts()
        assertEquals(listOf("reload"), types())
    }

    fun testLargeInsertReloads() {
        open("")
        write { document.insertString(0, "x".repeat(DocumentSync.MAX_CHANGE_CHARS.toInt() + 1)) }
        scheduler.runPosts()
        assertEquals(listOf("reload"), types())
    }

    private fun textEditor(): TextEditor {
        val file = FileDocumentManager.getInstance().getFile(document)!!
        val editor = TextEditorProvider.getInstance().createEditor(project, file) as TextEditor
        Disposer.register(testRootDisposable, editor)
        undoEditor = editor
        return editor
    }

    /** The page answers the next flush with [patches]. */
    private fun answerFlush(vararg patches: TextPatch) {
        val flush = view.sent.last { it["type"].asString == "flush" }
        // The page has every change: its base is the current stamp.
        patch(flush["seq"].asLong, version.value, *patches)
    }

    fun testTypingBurstIsOneUndoStepAndRedoRestoresIt() {
        open("# T\n")
        textEditor()
        var stamp = version.value
        for ((i, c) in "abc".withIndex()) {
            patch(i + 1L, stamp, TextPatch(4 + i, 4 + i, c.toString()))
            stamp = version.value
        }
        assertEquals("# T\nabc", document.text)
        view.sent.clear()

        sync.receive(PageMessage.Command(docId, "undo"))
        assertEquals(listOf("flush"), types())
        answerFlush()
        assertEquals("# T\n", document.text)
        assertEquals(listOf("flush", "ack", "change"), types())
        val change = view.sent.last()
        assertEquals(version.value, change["stamp"].asLong)
        assertEquals(listOf(Triple(6, 7, ""), Triple(5, 6, ""), Triple(4, 5, "")), changes(change))
        assertEquals(4, change["selection"].asJsonObject["anchor"].asInt)
        assertEquals(4, change["selection"].asJsonObject["head"].asInt)

        view.sent.clear()
        sync.receive(PageMessage.Command(docId, "redo"))
        answerFlush()
        assertEquals("# T\nabc", document.text)
        val redo = view.sent.last()
        assertEquals("change", redo["type"].asString)
        assertEquals(7, redo["selection"].asJsonObject["head"].asInt)
        scheduler.runPosts()
        assertEquals("No second change", redo, view.sent.last())
    }

    fun testUndoAfterFlushIncludesThePendingEdit() {
        open("x")
        textEditor()
        patch(1, version.value, TextPatch(1, 1, "a"))
        view.sent.clear()
        sync.receive(PageMessage.Command(docId, "undo"))
        // The page had typed "b" that was not sent yet: it is the flush reply.
        answerFlush(TextPatch(2, 2, "b"))
        assertEquals(listOf("flush", "ack", "change"), types())
        assertEquals("x", document.text)
    }

    fun testUndoOfExternalChangeAndNothingToRedo() {
        open("abcd")
        textEditor()
        sync.receive(PageMessage.Command(docId, "redo"))
        answerFlush()
        assertEquals("Nothing to redo: no change", listOf("flush", "ack"), types())
        write { document.insertString(0, "A") }
        write { document.deleteString(2, 3) }
        scheduler.runPosts()
        view.sent.clear()
        sync.receive(PageMessage.Command(docId, "undo"))
        answerFlush()
        assertEquals("Aabcd", document.text)
        val change = view.sent.last()
        assertEquals(listOf(Triple(2, 2, "b")), changes(change))
        assertEquals(3, change["selection"].asJsonObject["anchor"].asInt)
    }

    fun testStampsAreVersionsThatNeverGoBack() {
        open("abc")
        assertEquals(0L, version.value)
        write { document.insertString(0, "x") }
        write { document.deleteString(0, 1) }
        assertEquals(2L, version.value)
    }

    /**
     * ABA: a patch is in flight; the IDE makes X, an undo-transparent Y, then undoes X. The modification
     * stamp could come back to the patch's base; the version does not, so the patch is mapped (or rejected).
     */
    fun testPatchInFlightOverUndoIsMappedNotAppliedAsIs() {
        open("abcdef")
        val editor = textEditor()
        val base = version.value
        write { document.insertString(0, "XX") }
        CommandProcessor.getInstance().runUndoTransparentAction {
            ApplicationManager.getApplication().runWriteAction { document.insertString(0, "Y") }
        }
        UndoManager.getInstance(project).undo(editor)
        assertTrue("version went back", version.value > base + 2)
        val before = document.text
        // The page typed P after "abc" in the text at base.
        patch(1, base, TextPatch(3, 3, "P"))
        val types = types()
        if (types.last() == "ack") {
            assertTrue(document.text, "abcPdef" in document.text)
            assertEquals(before.replace("abcdef", "abcPdef"), document.text)
        } else {
            assertEquals(listOf("reject", "reload"), types.takeLast(2))
            assertEquals(before, document.text)
        }
    }

    fun testDivergedReloads() {
        open("abc")
        sync.receive(PageMessage.Diverged(docId, 2, 3))
        assertEquals(listOf("reload"), types())
        assertFalse(sync.isOpened)
        // A second report before the reload is answered: no second reload.
        sync.receive(PageMessage.Diverged(docId, 2, 3))
        assertEquals(listOf("reload"), types())
    }

    fun testExceptionDuringApplyRejectsAndReloads() {
        open("abcdef")
        // Guarded blocks throw ReadOnlyFragmentModificationException only while checking is on.
        document.createGuardedBlock(0, 3)
        document.startGuardedBlockChecking()
        Disposer.register(testRootDisposable) { document.stopGuardedBlockChecking() }
        patch(1, version.value, TextPatch(1, 2, "Z"))
        assertEquals(listOf("reject", "reload"), types())
        assertEquals("abcdef", document.text)
        assertFalse(sync.isOpened)
    }

    fun testHeldUndoWaitsForEachFlushReply() {
        open("x")
        val editor = textEditor()
        patch(1, version.value, TextPatch(1, 1, "a"))
        scheduler.now = 2_000_000_000L // New undo group.
        patch(2, version.value, TextPatch(2, 2, "b"))
        view.sent.clear()
        // Key repeat: the second undo comes before the reply to the first flush.
        sync.receive(PageMessage.Command(docId, "undo"))
        sync.receive(PageMessage.Command(docId, "undo"))
        assertEquals(listOf("flush", "flush"), types())
        assertEquals("No undo before the flush reply", "xab", document.text)
        val (first, second) = view.sent.map { it["seq"].asLong }
        patch(first, version.value)
        assertEquals("xab", document.text)
        // The page typed "c" in between: the reply to the second flush has it (same group as "b").
        patch(second, version.value, TextPatch(3, 3, "c"))
        assertTrue(UndoManager.getInstance(project).isRedoAvailable(editor))
        assertEquals("Both undos ran after the last reply", "x", document.text)
        assertEquals(listOf("flush", "flush", "ack", "ack", "change", "change"), types())
    }

    private fun typeAt(seconds: Double, offset: Int, text: String) {
        scheduler.now = (seconds * 1_000_000_000).toLong()
        patch(++typed, version.value, TextPatch(offset, offset, text))
    }

    private var typed = 0L

    private fun undo(editor: TextEditor) = UndoManager.getInstance(project).undo(editor)

    fun testUndoGroupEndsAfterAGap() {
        open("")
        val editor = textEditor()
        typeAt(0.0, 0, "a")
        typeAt(0.5, 1, "b")
        typeAt(2.0, 2, "c")
        undo(editor)
        assertEquals("ab", document.text)
        undo(editor)
        assertEquals("", document.text)
    }

    fun testUndoGroupEndsWhenOlderThanThreeSeconds() {
        open("")
        val editor = textEditor()
        for (i in 0..8) typeAt(i * 0.5, i, "x")
        undo(editor)
        assertEquals("Chars at 3.5 s and 4.0 s are a new group", "xxxxxxx", document.text)
    }

    /** L5 t14 flake: "uvw" as two patches 75 ms apart, after a 1.3 s pause, is one undo step. */
    fun testTwoPatchesSeventyFiveMsApartAreOneUndoStep() {
        open("")
        val editor = textEditor()
        typeAt(0.0, 0, "x")
        typeAt(0.05, 1, "yz")
        typeAt(1.4, 3, "uv")
        typeAt(1.475, 5, "w")
        undo(editor)
        assertEquals("xyz", document.text)
        undo(editor)
        assertEquals("", document.text)
    }

    /** Same, with "w" as the reply to the flush of the undo command (the page had not sent it yet). */
    fun testFlushReplyOfTheUndoBelongsToTheBurst() {
        open("")
        textEditor()
        typeAt(0.0, 0, "xyz")
        typeAt(1.4, 3, "uv")
        view.sent.clear()
        sync.receive(PageMessage.Command(docId, "undo"))
        scheduler.now = 1_475_000_000L
        answerFlush(TextPatch(5, 5, "w"))
        assertEquals("xyz", document.text)
    }

    fun testNewlineStartsAnUndoGroup() {
        open("")
        val editor = textEditor()
        typeAt(0.0, 0, "a")
        typeAt(0.1, 1, "\n")
        typeAt(0.2, 2, "b")
        undo(editor)
        assertEquals("a", document.text)
        undo(editor)
        assertEquals("", document.text)
    }

    fun testEventLogOnlyWhileOpenAndTrimmedOnAck() {
        val file = myFixture.addFileToProject("log.md", "abc").virtualFile
        document = FileDocumentManager.getInstance().getDocument(file)!!
        sync = newSync(document)
        write { document.insertString(0, "1") }
        assertEquals("Not open in a page: no log", 0, sync.logSize)
        sync.open()
        write { document.insertString(0, "2") }
        assertEquals("Logged while the page loads", 1, sync.logSize)
        sync.receive(PageMessage.Opened(docId, version.value - 1))
        assertEquals(1, sync.logSize)
        patch(1, version.value, TextPatch(0, 0, "3"))
        assertEquals("ack", view.sent.last()["type"].asString)
        assertEquals("Trimmed on ack", 0, sync.logSize)
        write { document.insertString(0, "4") }
        assertEquals(1, sync.logSize)
        sync.close()
        assertEquals("Dropped on close", 0, sync.logSize)
        write { document.insertString(0, "5") }
        assertEquals(0, sync.logSize)
    }

    /** A flush reply after the project closed (close flush) is applied without a project. */
    fun testPatchForADisposedProjectIsAppliedWithoutProject() {
        val file = myFixture.addFileToProject("closed.md", "abc").virtualFile
        val doc = FileDocumentManager.getInstance().getDocument(file)!!
        val closed = java.lang.reflect.Proxy.newProxyInstance(javaClass.classLoader, arrayOf(com.intellij.openapi.project.Project::class.java)) { _, m, _ ->
            when (m.name) {
                "isDisposed" -> true
                "hashCode" -> 0
                "equals" -> false
                "toString" -> "closed project"
                else -> null
            }
        } as com.intellij.openapi.project.Project
        version = DocVersion(doc)
        Disposer.register(testRootDisposable, version)
        val s = DocumentSync(docId, closed, doc, version, view, object : DocumentSync.Listener {}, scheduler)
        Disposer.register(testRootDisposable, s)
        s.open()
        s.receive(PageMessage.Opened(docId, 0))
        view.sent.clear()
        s.receive(PageMessage.Patch(docId, 1, 0, listOf(TextPatch(3, 3, "d"))))
        assertEquals("abcd", doc.text)
        assertEquals(listOf("ack"), types())
    }
}
