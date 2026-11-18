package ch.nmeylan.markdone.editor

import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.editor.ex.EditorEx
import com.intellij.openapi.editor.highlighter.EditorHighlighterFactory
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.openapi.fileEditor.TextEditorWithPreview.Layout
import com.intellij.openapi.fileEditor.TextEditorWithPreview.MyFileEditorState
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.PlatformTestUtil
import com.intellij.testFramework.replaceService
import com.intellij.openapi.fileEditor.TextEditor
import com.intellij.openapi.fileEditor.impl.text.TextEditorProvider
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import ch.nmeylan.markdone.jcef.FakePage
import ch.nmeylan.markdone.jcef.FakePageFactory
import ch.nmeylan.markdone.jcef.NO_CSS
import ch.nmeylan.markdone.jcef.SharedBrowserService
import ch.nmeylan.markdone.sync.FakeScheduler
import ch.nmeylan.markdone.sync.PageMessage

class MdEditorTest : BasePlatformTestCase() {
    private val provider = MdFileEditorProvider()

    // TextEditorWithPreview stores the last layout under "<name>Layout".
    private val layoutKey = "markdoneLayout"

    fun testAcceptsMarkdownExtensions() {
        assertTrue(provider.accept(project, myFixture.addFileToProject("a.md", "").virtualFile))
        assertTrue(provider.accept(project, myFixture.addFileToProject("b.markdown", "").virtualFile))
        assertTrue(provider.accept(project, myFixture.addFileToProject("C.MD", "").virtualFile))
        assertFalse(provider.accept(project, myFixture.addFileToProject("c.txt", "").virtualFile))
        assertFalse(provider.accept(project, myFixture.addFileToProject("md", "").virtualFile))
    }

    fun testPolicyHidesOtherEditors() {
        assertEquals(FileEditorPolicy.HIDE_OTHER_EDITORS, provider.getPolicy())
        assertEquals("markdone-editor", provider.getEditorTypeId())
    }

    fun testStartsInSourceEvenWhenEditWasRestored() {
        withEditor { editor ->
            assertEquals(Layout.SHOW_EDITOR, editor.getLayout())
            editor.setState(MyFileEditorState(Layout.SHOW_PREVIEW, null, null, false))
            assertEquals(Layout.SHOW_EDITOR, editor.getLayout())
        }
    }

    fun testBigDocumentHasPlainHighlighterOnlyInEditMode() {
        withEditor("x".repeat(MdEditor.PLAIN_HIGHLIGHTER_ABOVE + 1)) { editor ->
            val source = editor.textEditor.editor as EditorEx
            val original = source.highlighter
            editor.setLayout(Layout.SHOW_PREVIEW)
            val plain = source.highlighter
            assertNotSame(original, plain)
            val fileHighlighter = { EditorHighlighterFactory.getInstance().createEditorHighlighter(project, editor.file!!) }
            // The platform sets the file's highlighter again (async editor loader): plain again.
            val outside = fileHighlighter()
            source.highlighter = outside
            val again = source.highlighter
            assertNotSame(outside, again)
            editor.setLayout(Layout.SHOW_EDITOR)
            assertNotSame(again, source.highlighter)
            val later = fileHighlighter()
            source.highlighter = later
            assertSame("no plain highlighter in Source mode", later, source.highlighter)
        }
    }

    fun testNormalDocumentKeepsItsHighlighter() {
        withEditor { editor ->
            val source = editor.textEditor.editor as EditorEx
            val original = source.highlighter
            editor.setLayout(Layout.SHOW_PREVIEW)
            assertSame(original, source.highlighter)
            editor.setLayout(Layout.SHOW_EDITOR)
            assertSame(original, source.highlighter)
        }
    }

    fun testOnlyTwoModes() {
        withEditor { editor ->
            editor.setLayout(Layout.SHOW_EDITOR_AND_PREVIEW)
            assertEquals(Layout.SHOW_EDITOR, editor.getLayout())
            editor.setLayout(Layout.SHOW_PREVIEW)
            assertEquals(Layout.SHOW_PREVIEW, editor.getLayout())
            editor.setLayout(Layout.SHOW_EDITOR_AND_PREVIEW)
            assertEquals(Layout.SHOW_PREVIEW, editor.getLayout())
            // No page is loaded (no JCEF in tests), so the flush completes at once.
            editor.toggleMode()
            assertEquals(Layout.SHOW_EDITOR, editor.getLayout())
        }
    }

    fun testNoOpRequestKeepsPendingSwitchToSource() {
        withEditor { editor ->
            editor.setLayout(Layout.SHOW_PREVIEW)
            val (web, page) = readyPage(editor)
            editor.setLayout(Layout.SHOW_EDITOR) // Waits for the flush reply.
            assertEquals(Layout.SHOW_PREVIEW, editor.getLayout())
            // The global "Editor and Preview" action maps to the current mode: no change.
            editor.setLayout(Layout.SHOW_EDITOR_AND_PREVIEW)
            val flush = page.sent.last { it["type"].asString == "flush" }
            page.deliver(PageMessage.Patch(flush["docId"].asString, flush["seq"].asLong, 0, emptyList()))
            assertEquals(Layout.SHOW_EDITOR, editor.getLayout())
        }
    }

    fun testCloseDuringPendingFlushDoesNotSwitch() {
        withEditor { editor ->
            editor.setLayout(Layout.SHOW_PREVIEW)
            readyPage(editor)
            editor.setLayout(Layout.SHOW_EDITOR) // Waits for the flush reply.
            val stored = PropertiesComponent.getInstance().getValue(layoutKey)
            // Disposing the WebEditor completes the flush; the disposed MdEditor must not switch.
            Disposer.dispose(editor)
            assertEquals(Layout.SHOW_PREVIEW, editor.getLayout())
            assertEquals(stored, PropertiesComponent.getInstance().getValue(layoutKey))
        }
    }

    fun testToggleCommandFromThePageSwitchesToSourceAfterFlush() {
        withEditor { editor ->
            editor.setLayout(Layout.SHOW_PREVIEW)
            val (web, page) = readyPage(editor)
            val docId = page.lastDocId()
            page.deliver(PageMessage.Command(docId, "toggleMode"))
            assertEquals(Layout.SHOW_PREVIEW, editor.getLayout())
            val flush = page.sent.last()
            assertEquals("flush", flush["type"].asString)
            page.deliver(PageMessage.Patch(docId, flush["seq"].asLong, 0, emptyList()))
            assertEquals(Layout.SHOW_EDITOR, editor.getLayout())
        }
    }

    fun testGotoSourceSwitchesAfterFlushAndPlacesTheCaret() {
        withEditor { editor ->
            editor.setLayout(Layout.SHOW_PREVIEW)
            val (_, page) = readyPage(editor)
            val docId = page.lastDocId()
            page.deliver(PageMessage.GotoSource(docId, 4))
            assertEquals("Waits for the flush", Layout.SHOW_PREVIEW, editor.getLayout())
            val flush = page.sent.last()
            assertEquals("flush", flush["type"].asString)
            page.deliver(PageMessage.Patch(docId, flush["seq"].asLong, 0, emptyList()))
            assertEquals(Layout.SHOW_EDITOR, editor.getLayout())
            assertEquals(4, editor.textEditor.editor.caretModel.offset)
        }
    }

    fun testGotoSourceClampsTheOffset() {
        withEditor { editor ->
            editor.setLayout(Layout.SHOW_PREVIEW)
            val (_, page) = readyPage(editor)
            val docId = page.lastDocId()
            page.deliver(PageMessage.GotoSource(docId, 10_000))
            page.deliver(PageMessage.Patch(docId, page.sent.last()["seq"].asLong, 0, emptyList()))
            assertEquals(Layout.SHOW_EDITOR, editor.getLayout())
            assertEquals("# Title\n".length, editor.textEditor.editor.caretModel.offset)
            // Already in Source: the caret moves after the flush, the layout stays.
            editor.gotoSource(2)
            page.deliver(PageMessage.Patch(docId, page.sent.last()["seq"].asLong, 0, emptyList()))
            assertEquals(Layout.SHOW_EDITOR, editor.getLayout())
            assertEquals(2, editor.textEditor.editor.caretModel.offset)
        }
    }

    /**
     * Protocol 2.4: Source → Edit sends `activate` with the text editor's first visible line and selection;
     * Edit → Source applies the page's last `viewport` after the flush (selection, first visible line; clamped).
     */
    fun testModeSwitchKeepsTheFirstVisibleLineAndTheSelection() {
        val text = (1..400).joinToString("") { "line $it\n" }
        val start = { line: Int -> text.indexOf("line $line\n") }
        withEditor(text) { editor ->
            val source = editor.textEditor.editor
            source.component.setSize(600, 300)
            source.component.validate()
            val y = { line: Int -> source.logicalPositionToXY(com.intellij.openapi.editor.LogicalPosition(line - 1, 0)).y }
            source.scrollingModel.scrollVertically(y(50) + 3)
            source.caretModel.moveToOffset(start(61) + 2)
            source.selectionModel.setSelection(start(60), start(61) + 2)
            assertEquals("caret at the selection end", start(61) + 2, source.caretModel.offset)

            editor.setLayout(Layout.SHOW_PREVIEW)
            val (web, page) = readyPage(editor)
            val activate = page.sent.last { it["type"].asString == "activate" }
            assertEquals(start(50), activate["top"].asInt)
            assertEquals(start(60), activate["selection"].asJsonObject["anchor"].asInt)
            assertEquals(start(61) + 2, activate["selection"].asJsonObject["head"].asInt)
            // Once: a later `activate` (tab switch) has no fields.
            web.onHidden()
            web.onShown()
            assertEquals(setOf("type", "docId"), page.sent.last { it["type"].asString == "activate" }.keySet())

            val docId = page.lastDocId()
            editor.setLayout(Layout.SHOW_EDITOR)
            assertEquals("Waits for the flush", Layout.SHOW_PREVIEW, editor.getLayout())
            page.deliver(PageMessage.Viewport(docId, start(120) + 2, start(130) + 4, start(130)))
            page.deliver(PageMessage.Patch(docId, page.sent.last()["seq"].asLong, 0, emptyList()))
            assertEquals(Layout.SHOW_EDITOR, editor.getLayout())
            assertEquals("caret = head", start(130), source.caretModel.offset)
            assertEquals(start(130) to start(130) + 4, source.selectionModel.selectionStart to source.selectionModel.selectionEnd)
            assertEquals("anchor = lead", start(130) + 4, source.selectionModel.leadSelectionOffset)
            assertEquals("line 120 at the top", y(120), source.scrollingModel.verticalScrollOffset)

            // Values outside the document are clamped; an empty selection has no selection.
            editor.setLayout(Layout.SHOW_PREVIEW)
            web.onShown()
            editor.setLayout(Layout.SHOW_EDITOR)
            page.deliver(PageMessage.Viewport(docId, 1_000_000, 1_000_000, 1_000_000))
            page.deliver(PageMessage.Patch(docId, page.sent.last()["seq"].asLong, 0, emptyList()))
            assertEquals(text.length, source.caretModel.offset)
            assertFalse(source.selectionModel.hasSelection())

            // Ctrl-click (gotoSource) keeps its own caret, not the viewport.
            editor.setLayout(Layout.SHOW_PREVIEW)
            web.onShown()
            page.deliver(PageMessage.GotoSource(docId, 4))
            page.deliver(PageMessage.Patch(docId, page.sent.last()["seq"].asLong, 0, emptyList()))
            assertEquals(4, source.caretModel.offset)
        }
    }

    /** Edit → Source with the page's viewport: secondary carets of the text editor go. */
    fun testModeSwitchToSourceRemovesSecondaryCarets() {
        withEditor("one\ntwo\nthree\n") { editor ->
            val source = editor.textEditor.editor
            source.caretModel.moveToOffset(1)
            source.caretModel.addCaret(com.intellij.openapi.editor.VisualPosition(1, 1))
            source.caretModel.addCaret(com.intellij.openapi.editor.VisualPosition(2, 1))
            assertEquals(3, source.caretModel.caretCount)
            editor.setLayout(Layout.SHOW_PREVIEW)
            val (_, page) = readyPage(editor)
            val docId = page.lastDocId()
            editor.setLayout(Layout.SHOW_EDITOR)
            page.deliver(PageMessage.Viewport(docId, 0, 4, 6))
            page.deliver(PageMessage.Patch(docId, page.sent.last { it["type"].asString == "flush" }["seq"].asLong, 0, emptyList()))
            assertEquals(Layout.SHOW_EDITOR, editor.getLayout())
            assertEquals(1, source.caretModel.caretCount)
            assertEquals(6, source.caretModel.offset)
            assertEquals(4 to 6, source.selectionModel.selectionStart to source.selectionModel.selectionEnd)
        }
    }

    /**
     * Edit → Source uses only a `viewport` sent after the flush: an older one, or a flush without a round
     * trip (page loaded again, no `opened` yet), keeps the text editor's own caret and scroll.
     */
    fun testModeSwitchToSourceIgnoresAViewportThatDoesNotAnswerTheFlush() {
        val text = (1..400).joinToString("") { "line $it\n" }
        withEditor(text) { editor ->
            val source = editor.textEditor.editor
            source.component.setSize(600, 300)
            source.component.validate()
            source.scrollingModel.scrollVertically(500)
            source.caretModel.moveToOffset(30)
            val scroll = source.scrollingModel.verticalScrollOffset
            editor.setLayout(Layout.SHOW_PREVIEW)
            val (web, page) = readyPage(editor)
            val docId = page.lastDocId()

            // Sent before the flush (a scroll): not the answer.
            page.deliver(PageMessage.Viewport(docId, text.length / 2, 100, 100))
            editor.setLayout(Layout.SHOW_EDITOR)
            page.deliver(PageMessage.Patch(docId, page.sent.last { it["type"].asString == "flush" }["seq"].asLong, 0, emptyList()))
            assertEquals(Layout.SHOW_EDITOR, editor.getLayout())
            assertEquals(30, source.caretModel.offset)
            assertEquals(scroll, source.scrollingModel.verticalScrollOffset)

            // The page loads again: the flush completes at once, the old viewport is not used.
            editor.setLayout(Layout.SHOW_PREVIEW)
            web.onShown()
            page.deliver(PageMessage.Viewport(docId, text.length / 2, 200, 200))
            page.deliver(PageMessage.Ready(2))
            val flushes = page.sentTypes().count { it == "flush" }
            editor.setLayout(Layout.SHOW_EDITOR)
            assertEquals("no round trip", flushes, page.sentTypes().count { it == "flush" })
            assertEquals(Layout.SHOW_EDITOR, editor.getLayout())
            assertEquals(30, source.caretModel.offset)
            assertEquals(scroll, source.scrollingModel.verticalScrollOffset)
        }
    }

    /**
     * A `viewport` that answers the flush, then the page loads again (`ready`) or crashes before the reply: the
     * flush completes without a viewport, so the text editor keeps its own caret and scroll.
     */
    fun testModeSwitchToSourceIgnoresTheViewportOfAPageThatWentAway() {
        val text = (1..400).joinToString("") { "line $it\n" }
        withEditor(text) { editor ->
            val source = editor.textEditor.editor
            source.component.setSize(600, 300)
            source.component.validate()
            source.scrollingModel.scrollVertically(500)
            source.caretModel.moveToOffset(30)
            val scroll = source.scrollingModel.verticalScrollOffset
            editor.setLayout(Layout.SHOW_PREVIEW)
            val (web, page) = readyPage(editor)
            val docId = page.lastDocId()

            editor.setLayout(Layout.SHOW_EDITOR)
            assertEquals("Waits for the flush", Layout.SHOW_PREVIEW, editor.getLayout())
            page.deliver(PageMessage.Viewport(docId, text.length / 2, 100, 100))
            page.deliver(PageMessage.Ready(2))
            assertEquals(Layout.SHOW_EDITOR, editor.getLayout())
            assertEquals("reload: caret", 30, source.caretModel.offset)
            assertEquals("reload: scroll", scroll, source.scrollingModel.verticalScrollOffset)

            editor.setLayout(Layout.SHOW_PREVIEW)
            web.onShown()
            page.deliver(PageMessage.Opened(docId, 0))
            editor.setLayout(Layout.SHOW_EDITOR)
            assertEquals("Waits for the flush", Layout.SHOW_PREVIEW, editor.getLayout())
            page.deliver(PageMessage.Viewport(docId, text.length / 2, 200, 200))
            page.crash()
            assertEquals(Layout.SHOW_EDITOR, editor.getLayout())
            assertEquals("crash: caret", 30, source.caretModel.offset)
            assertEquals("crash: scroll", scroll, source.scrollingModel.verticalScrollOffset)
        }
    }

    /** Two pages show the document (split): Edit → Source of one tab uses only its own page's `viewport`. */
    fun testModeSwitchToSourceIgnoresTheViewportOfAnotherPage() {
        val file = myFixture.addFileToProject("split.md", "one\ntwo\nthree\nfour\n").virtualFile
        val service = newService()
        Disposer.register(testRootDisposable, service)
        val document = FileDocumentManager.getInstance().getDocument(file)!!
        val editors = List(2) {
            MdEditor(TextEditorProvider.getInstance().createEditor(project, file) as TextEditor, WebEditor(project, file, document) { service })
        }
        try {
            val pages = editors.map { editor ->
                editor.component
                PlatformTestUtil.dispatchAllEventsInIdeEventQueue()
                editor.setLayout(Layout.SHOW_PREVIEW)
                (editor.previewEditor as WebEditor).onShown()
                factory.pages.last().also { page ->
                    page.deliver(PageMessage.Ready(2))
                    page.deliver(PageMessage.Opened(page.lastDocId(), 0))
                }
            }
            assertEquals(2, factory.pages.size)
            val (first, second) = editors
            val docId = pages[0].lastDocId()
            val flushSeq = { page: FakePage -> page.sent.last { it["type"].asString == "flush" }["seq"].asLong }
            first.textEditor.editor.caretModel.moveToOffset(2)

            first.setLayout(Layout.SHOW_EDITOR)
            pages[1].deliver(PageMessage.Viewport(docId, 0, 8, 10))
            pages[0].deliver(PageMessage.Patch(docId, flushSeq(pages[0]), 0, emptyList()))
            assertEquals(Layout.SHOW_EDITOR, first.getLayout())
            assertEquals("the other page's viewport is not used", 2, first.textEditor.editor.caretModel.offset)

            second.setLayout(Layout.SHOW_EDITOR)
            pages[1].deliver(PageMessage.Viewport(docId, 0, 8, 10))
            pages[1].deliver(PageMessage.Patch(docId, flushSeq(pages[1]), 0, emptyList()))
            assertEquals(Layout.SHOW_EDITOR, second.getLayout())
            assertEquals("its own page's viewport", 10, second.textEditor.editor.caretModel.offset)
        } finally {
            editors.forEach(Disposer::dispose)
        }
    }

    /** Source → Edit: Source edits not sent yet go to the page before the `activate` with `top` and `selection`. */
    fun testActivateWithSourcePlaceFollowsThePendingChanges() {
        withEditor("one\ntwo\n") { editor ->
            editor.setLayout(Layout.SHOW_PREVIEW)
            val (web, page) = readyPage(editor)
            val docId = page.lastDocId()
            editor.setLayout(Layout.SHOW_EDITOR)
            page.deliver(PageMessage.Patch(docId, page.sent.last()["seq"].asLong, 0, emptyList()))
            assertEquals(Layout.SHOW_EDITOR, editor.getLayout())
            web.onHidden()
            val source = editor.textEditor.editor
            com.intellij.openapi.command.WriteCommandAction.runWriteCommandAction(project) { source.document.insertString(0, "zero\n") }
            source.caretModel.moveToOffset(7)
            page.sent.clear()
            editor.setLayout(Layout.SHOW_PREVIEW)
            web.onShown()
            assertEquals(listOf("change", "activate"), page.sentTypes())
            assertEquals("zero\n", page.sent[0]["changes"].asJsonArray[0].asJsonObject["insert"].asString)
            assertEquals(7, page.sent[1]["selection"].asJsonObject["head"].asInt)
        }
    }

    /**
     * Source → Edit with too many pending Source edits: `reload` instead of `change`, then the `activate` with `top`
     * and `selection` (the page applies it after the reload, on the new text).
     */
    fun testActivateWithSourcePlaceAfterAReload() {
        withEditor("one\ntwo\n") { editor ->
            editor.setLayout(Layout.SHOW_PREVIEW)
            val (web, page) = readyPage(editor)
            val docId = page.lastDocId()
            editor.setLayout(Layout.SHOW_EDITOR)
            page.deliver(PageMessage.Patch(docId, page.sent.last()["seq"].asLong, 0, emptyList()))
            assertEquals(Layout.SHOW_EDITOR, editor.getLayout())
            web.onHidden()
            val source = editor.textEditor.editor
            com.intellij.openapi.command.WriteCommandAction.runWriteCommandAction(project) {
                repeat(ch.nmeylan.markdone.sync.DocumentSync.MAX_CHANGE_EVENTS + 1) { source.document.insertString(0, "x") }
            }
            source.caretModel.moveToOffset(1005)
            page.sent.clear()
            editor.setLayout(Layout.SHOW_PREVIEW)
            web.onShown()
            assertEquals(listOf("reload", "activate"), page.sentTypes())
            val activate = page.sent[1]
            assertEquals(docId, activate["docId"].asString)
            assertEquals(0, activate["top"].asInt)
            assertEquals(1005, activate["selection"].asJsonObject["head"].asInt)
        }
    }

    /** The file color "Gray" on the tab of a Markdown file that is not writable, or whose document is not (File Colors used in tabs). */
    fun testReadOnlyTabColor() {
        val provider = ReadOnlyTabColorProvider()
        val gray = com.intellij.ui.FileColorManager.getInstance(project).getColor("Gray")
        assertNotNull(gray)
        val md = myFixture.addFileToProject("ro.md", "# x\n").virtualFile
        val txt = myFixture.addFileToProject("ro.txt", "x\n").virtualFile
        assertNull("writable", provider.getEditorTabColor(project, md))
        val document = FileDocumentManager.getInstance().getDocument(md)!!
        document.setReadOnly(true)
        try {
            assertEquals(gray, provider.getEditorTabColor(project, md))
        } finally {
            document.setReadOnly(false)
        }
        com.intellij.openapi.application.WriteAction.run<Exception> { md.isWritable = false; txt.isWritable = false }
        val tabsEnabled = com.intellij.ui.tabs.FileColorManagerImpl._isEnabledForTabs()
        try {
            assertEquals(gray, provider.getEditorTabColor(project, md))
            assertNull("not Markdown", provider.getEditorTabColor(project, txt))
            com.intellij.ui.tabs.FileColorManagerImpl.setEnabledForTabs(false)
            assertNull("File Colors not used in editor tabs", provider.getEditorTabColor(project, md))
        } finally {
            com.intellij.ui.tabs.FileColorManagerImpl.setEnabledForTabs(tabsEnabled)
            com.intellij.openapi.application.WriteAction.run<Exception> { md.isWritable = true; txt.isWritable = true }
        }
        assertNull(provider.getEditorTabColor(project, md))
    }

    /** In the platform's tab color, a color of the File Colors scopes comes before the gray of a read-only file. */
    fun testReadOnlyTabColorComesAfterTheFileColorsScopes() {
        val md = myFixture.addFileToProject("scope.md", "# x\n").virtualFile
        val colors = com.intellij.ui.FileColorManager.getInstance(project)
        val document = FileDocumentManager.getInstance().getDocument(md)!!
        document.setReadOnly(true)
        try {
            assertEquals(colors.getColor("Gray"), com.intellij.openapi.fileEditor.impl.EditorTabPresentationUtil.getEditorTabBackgroundColor(project, md))
            colors.addScopeColor("All", "Blue", true)
            assertEquals(colors.getColor("Blue"), com.intellij.openapi.fileEditor.impl.EditorTabPresentationUtil.getEditorTabBackgroundColor(project, md))
        } finally {
            document.setReadOnly(false)
        }
    }

    /** A writability change of the file (VFS) or of its document asks for a new tab color. */
    fun testWritabilityChangeUpdatesTheTabColor() {
        withEditor { editor ->
            var updates = 0
            editor.updateTabColor = { updates++ }
            val file = editor.file!!
            val document = FileDocumentManager.getInstance().getDocument(file)!!
            // A VFS change also changes the document's writability: one or two updates.
            val steps = listOf<Pair<String, () -> Unit>>(
                "VFS read-only" to { com.intellij.openapi.application.WriteAction.run<Exception> { file.isWritable = false } },
                "VFS writable" to { com.intellij.openapi.application.WriteAction.run<Exception> { file.isWritable = true } },
                "Document read-only" to { document.setReadOnly(true) },
                "Document writable" to { document.setReadOnly(false) },
            )
            for ((name, step) in steps) {
                updates = 0
                step()
                assertTrue(name, updates > 0)
            }
        }
    }

    /** The view of the new mode gets the focus on a later EDT event, after the layout change. */
    fun testFocusFollowsTheModeAfterTheLayoutChange() {
        withEditor { editor ->
            val focused = mutableListOf<javax.swing.JComponent>()
            editor.requestFocus = { focused += it }
            editor.setLayout(Layout.SHOW_PREVIEW)
            val (web, page) = readyPage(editor)
            assertTrue("Not during the layout change", focused.isEmpty())
            PlatformTestUtil.dispatchAllInvocationEventsInIdeEventQueue()
            assertSame("Edit: the browser", page.component, focused.single())
            assertSame(page.component, web.preferredFocusedComponent)

            // Ctrl-click → gotoSource: the text editor after the flush.
            val docId = page.lastDocId()
            page.deliver(PageMessage.GotoSource(docId, 2))
            page.deliver(PageMessage.Patch(docId, page.sent.last()["seq"].asLong, 0, emptyList()))
            PlatformTestUtil.dispatchAllInvocationEventsInIdeEventQueue()
            assertSame("Source: the text editor", editor.textEditor.editor.contentComponent, focused.last())

            // Toggle from the page (Edit → Source); a newer switch drops the older focus request.
            focused.clear()
            editor.setLayout(Layout.SHOW_PREVIEW)
            page.deliver(PageMessage.Command(docId, "toggleMode"))
            page.deliver(PageMessage.Patch(docId, page.sent.last()["seq"].asLong, 0, emptyList()))
            PlatformTestUtil.dispatchAllInvocationEventsInIdeEventQueue()
            assertEquals(listOf(editor.textEditor.editor.contentComponent), focused)
        }
    }

    /** The "open in Edit mode" setting: the provider opens a file in Edit mode, but not one above the limit. */
    fun testProviderOpensInEditModeWhenSet() {
        val settings = ch.nmeylan.markdone.settings.MdSettings.getInstance()
        val provider = MdFileEditorProvider()
        fun open(text: String): MdEditor {
            val file = myFixture.addFileToProject("open${System.nanoTime()}.md", text).virtualFile
            return (provider.createEditor(project, file) as MdEditor).also { it.component; Disposer.register(testRootDisposable, it) }
        }
        try {
            assertEquals(Layout.SHOW_EDITOR, open("a").getLayout())
            settings.openInEditMode = true
            assertEquals(Layout.SHOW_PREVIEW, open("a").getLayout())
            settings.largeFileLimitMb = 1
            assertEquals(Layout.SHOW_EDITOR, open("x".repeat(2 * 1024 * 1024)).getLayout())
        } finally {
            settings.loadState(ch.nmeylan.markdone.settings.MdSettings.SettingsState())
        }
    }

    /** Above the large-file limit the tab stays in Source mode, Toggle Mode is off, a banner says why. */
    fun testFileAboveTheLimitStaysInSourceWithABanner() {
        val settings = ch.nmeylan.markdone.settings.MdSettings.getInstance()
        settings.largeFileLimitMb = 1
        try {
            val provider = LargeFileNotificationProvider()
            withEditor("x".repeat(2 * 1024 * 1024)) { editor ->
                assertTrue(editor.isEditModeBlocked)
                editor.setLayout(Layout.SHOW_PREVIEW)
                assertEquals(Layout.SHOW_EDITOR, editor.getLayout())
                editor.toggleMode()
                assertEquals(Layout.SHOW_EDITOR, editor.getLayout())
                val action = toggleActionEvent(editor)
                assertTrue(action.presentation.isVisible)
                assertFalse("Toggle Mode disabled", action.presentation.isEnabled)
                val banner = provider.collectNotificationData(project, editor.file!!).apply(editor)
                assertEquals(
                    "This file is larger than 1 MB. Edit mode is off. Change the limit in Settings → Tools → Markdown Edit.",
                    (banner as com.intellij.ui.EditorNotificationPanel).text,
                )
                // A higher limit: Edit mode again, no banner.
                settings.largeFileLimitMb = 2
                assertFalse(editor.isEditModeBlocked)
                assertNull(provider.collectNotificationData(project, editor.file!!).apply(editor))
                assertTrue(toggleActionEvent(editor).presentation.isEnabled)
                editor.setLayout(Layout.SHOW_PREVIEW)
                assertEquals(Layout.SHOW_PREVIEW, editor.getLayout())
            }
            withEditor("x".repeat(2 * 1024 * 1024 - 1), "at-limit.md") { editor ->
                settings.largeFileLimitMb = 1
                assertFalse("Below 2 MB, so not larger than 1 MB in whole MB: allowed", editor.isEditModeBlocked)
                assertNull(provider.collectNotificationData(project, editor.file!!).apply(editor))
            }
        } finally {
            settings.loadState(ch.nmeylan.markdone.settings.MdSettings.SettingsState())
        }
    }

    /** A tab kept in Edit mode after the limit went down shows no banner; in Source it does. */
    fun testNoLargeFileBannerInEditMode() {
        val settings = ch.nmeylan.markdone.settings.MdSettings.getInstance()
        try {
            val provider = LargeFileNotificationProvider()
            withEditor("x".repeat(2 * 1024 * 1024)) { editor ->
                editor.setLayout(Layout.SHOW_PREVIEW)
                settings.largeFileLimitMb = 1
                assertTrue(editor.isEditModeBlocked)
                assertEquals(Layout.SHOW_PREVIEW, editor.getLayout())
                assertNull(provider.collectNotificationData(project, editor.file!!).apply(editor))
                assertTrue("Back to Source is allowed", toggleActionEvent(editor).presentation.isEnabled)
                editor.setLayout(Layout.SHOW_EDITOR)
                assertEquals(Layout.SHOW_EDITOR, editor.getLayout())
                assertNotNull(provider.collectNotificationData(project, editor.file!!).apply(editor))
            }
        } finally {
            settings.loadState(ch.nmeylan.markdone.settings.MdSettings.SettingsState())
        }
    }

    /** The banner is updated when the text editor has loaded (the platform does not update it for this editor). */
    fun testBannerIsUpdatedWhenTheTextEditorHasLoaded() {
        val updated = mutableListOf<com.intellij.openapi.vfs.VirtualFile>()
        val notifications = object : com.intellij.ui.EditorNotifications() {
            override fun updateNotifications(file: com.intellij.openapi.vfs.VirtualFile) { updated += file }
            override fun updateNotifications(provider: com.intellij.ui.EditorNotificationProvider) {}
            override fun updateAllNotifications() {}
        }
        project.replaceService(com.intellij.ui.EditorNotifications::class.java, notifications, testRootDisposable)
        val file = myFixture.addFileToProject("loading.md", "# x\n").virtualFile
        val document = FileDocumentManager.getInstance().getDocument(file)!!
        val service = newService()
        Disposer.register(testRootDisposable, service)
        val loaderKey = com.intellij.openapi.fileEditor.impl.text.AsyncEditorLoader.ASYNC_LOADER
        val scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob())
        try {
            /** A text editor that still loads; the load completes after [beforeLoad]. */
            fun loadLater(beforeLoad: (MdEditor) -> Unit) {
                val textEditor = TextEditorProvider.getInstance().createEditor(project, file) as com.intellij.openapi.fileEditor.impl.text.TextEditorImpl
                // The constructor is Kotlin-internal (public in the bytecode).
                val loader = com.intellij.openapi.fileEditor.impl.text.AsyncEditorLoader::class.java
                    .getConstructor(com.intellij.openapi.project.Project::class.java, TextEditorProvider::class.java, kotlinx.coroutines.CoroutineScope::class.java)
                    .newInstance(project, TextEditorProvider.getInstance(), scope)
                textEditor.editor.putUserData(loaderKey, loader)
                updated.clear() // the text editor itself updates the banners when it is created
                val editor = MdEditor(textEditor, WebEditor(project, file, document) { service })
                editor.component // builds the UI before a dispose
                try {
                    assertEquals("not before the load", emptyList<Any>(), updated)
                    beforeLoad(editor)
                    textEditor.editor.putUserData(loaderKey, null)
                    loader.start(textEditor, kotlinx.coroutines.CompletableDeferred(Unit))
                } finally {
                    Disposer.dispose(editor)
                }
            }
            loadLater {}
            assertEquals(listOf(file), updated)
            loadLater { Disposer.dispose(it) }
            assertEquals("disposed before the load", emptyList<Any>(), updated)
        } finally {
            scope.coroutineContext[kotlinx.coroutines.Job]!!.cancel()
        }
        // A text editor that has loaded: at once.
        val loaded = TextEditorProvider.getInstance().createEditor(project, file) as TextEditor
        updated.clear()
        val editor = MdEditor(loaded, WebEditor(project, file, document) { service })
        editor.component
        Disposer.dispose(editor)
        assertEquals(listOf(file), updated)
    }

    /** The update of [ch.nmeylan.markdone.actions.ToggleModeAction] in a data context with [editor]. */
    private fun toggleActionEvent(editor: MdEditor): com.intellij.openapi.actionSystem.AnActionEvent {
        val context = com.intellij.openapi.actionSystem.impl.SimpleDataContext.getSimpleContext(
            com.intellij.openapi.actionSystem.PlatformCoreDataKeys.FILE_EDITOR, editor,
        )
        val event = com.intellij.testFramework.TestActionEvent.createTestEvent(context)
        ch.nmeylan.markdone.actions.ToggleModeAction().update(event)
        return event
    }

    private val factory = FakePageFactory()

    /** Shows the Edit view with a fake page that has the document open, so a flush waits for its reply. */
    private fun readyPage(editor: MdEditor): Pair<WebEditor, FakePage> {
        val web = editor.previewEditor as WebEditor
        web.onShown()
        val page = factory.pages.single()
        page.deliver(PageMessage.Ready(2))
        page.deliver(PageMessage.Opened(page.lastDocId(), 0))
        return web to page
    }

    private fun newService() = SharedBrowserService().apply {
        factory = this@MdEditorTest.factory
        runOnEdt = { it() }
        loadCss = NO_CSS
        remoteImagesSetting = { false }
        syncScheduler = FakeScheduler()
    }

    private fun withEditor(text: String = "# Title\n", name: String = "doc.md", body: (MdEditor) -> Unit) {
        val file = myFixture.addFileToProject(name, text).virtualFile
        val service = newService()
        val textEditor = TextEditorProvider.getInstance().createEditor(project, file) as TextEditor
        val document = FileDocumentManager.getInstance().getDocument(file)!!
        val editor = MdEditor(textEditor, WebEditor(project, file, document) { service })
        Disposer.register(testRootDisposable, service)
        try {
            editor.component // builds the UI, which reads the initial layout
            PlatformTestUtil.dispatchAllEventsInIdeEventQueue()
            body(editor)
        } finally {
            Disposer.dispose(editor)
        }
    }
}
