package ch.nmeylan.markdone.jcef

import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import ch.nmeylan.markdone.editor.WebEditor
import ch.nmeylan.markdone.sync.FakeScheduler
import ch.nmeylan.markdone.sync.PageMessage

/** Browser and document bookkeeping of the shared page, with fake pages. */
class SharedBrowserServiceTest : BasePlatformTestCase() {
    private val factory = FakePageFactory()
    private lateinit var service: SharedBrowserService

    override fun setUp() {
        super.setUp()
        service = SharedBrowserService().apply {
            factory = this@SharedBrowserServiceTest.factory
            runOnEdt = { it() }
            loadCss = NO_CSS
            remoteImagesSetting = { false }
            projectTrusted = { true }
            syncScheduler = FakeScheduler()
        }
        Disposer.register(testRootDisposable, service)
    }

    override fun tearDown() {
        try {
            ch.nmeylan.markdone.settings.MdSettings.getInstance().loadState(ch.nmeylan.markdone.settings.MdSettings.SettingsState())
        } finally {
            super.tearDown()
        }
    }

    private fun editor(path: String): WebEditor {
        val file = myFixture.findFileInTempDir(path) ?: myFixture.addFileToProject(path, "# $path\n").virtualFile
        val web = WebEditor(project, file, FileDocumentManager.getInstance().getDocument(file)!!) { service }
        // Registered after the service: disposed before it.
        Disposer.register(testRootDisposable, web)
        return web
    }

    private fun FakePage.ready() {
        deliver(PageMessage.Ready(2))
    }

    private fun FakePage.opened(docId: String, web: WebEditor) = deliver(PageMessage.Opened(docId, 0))

    /** Replies with no edits to the last `flush` sent for [docId], which must be the last message sent. */
    private fun FakePage.flushReply(docId: String, patches: List<ch.nmeylan.markdone.sync.TextPatch> = emptyList(), baseStamp: Long = 0) {
        val flush = sent.last()
        assertEquals("flush" to docId, flush["type"].asString to flush["docId"].asString)
        sent.removeAt(sent.size - 1)
        deliver(PageMessage.Patch(docId, flush["seq"].asLong, baseStamp, patches))
    }

    /** Messages for documents (page-level `settings` and `css` are left out), then clears the list. */
    private fun FakePage.take(): List<Pair<String, String?>> =
        sent.filter { it["type"].asString !in setOf("settings", "css") }
            .map { it["type"].asString to it["docId"]?.asString }.also { sent.clear() }

    fun testOneBrowserForTabsOfOneFileAndForTwoFiles() {
        val a1 = editor("a.md")
        val a2 = editor("a.md")
        val b = editor("b.md")
        assertTrue("No browser before Edit mode", factory.pages.isEmpty())

        a1.onShown()
        val page = factory.pages.single()
        assertSame(a1.component, page.component.parent)
        assertTrue("Nothing before ready", page.sent.isEmpty())
        page.ready()
        val (theme, open) = page.take()
        assertEquals("theme", theme.first)
        assertEquals("open", open.first)
        val idA = open.second!!
        assertTrue(Regex("[0-9a-f]{32}").matches(idA))
        page.opened(idA, a1)
        assertEquals(listOf("activate" to idA), page.take())

        a1.onHidden()
        b.onShown()
        assertEquals(1, factory.pages.size)
        assertSame(b.component, page.component.parent)
        val openB = page.take().single()
        assertEquals("open", openB.first)
        val idB = openB.second!!
        assertFalse(idA == idB)
        page.opened(idB, b)
        assertEquals(listOf("activate" to idB), page.take())

        // A second tab of a.md: same document, same docId, no second open.
        b.onHidden()
        a2.onShown()
        assertSame(a2.component, page.component.parent)
        assertEquals(listOf("activate" to idA), page.take())

        Disposer.dispose(a1)
        assertTrue("a2 still shows a.md", page.take().isEmpty())
        // The last tab of a document: flush first, close after the reply.
        Disposer.dispose(a2)
        page.flushReply(idA)
        assertEquals(listOf("ack" to idA, "close" to idA), page.take())
        Disposer.dispose(b)
        page.flushReply(idB)
        assertEquals(listOf("ack" to idB, "close" to idB), page.take())
        assertFalse("The first browser stays", page.disposed)
    }

    fun testSecondBrowserOnlyWhileTwoViewsAreVisible() {
        val a = editor("a.md")
        val b = editor("b.md")
        a.onShown()
        b.onShown()
        assertEquals(2, factory.pages.size)
        val (first, second) = factory.pages
        assertSame(a.component, first.component.parent)
        assertSame(b.component, second.component.parent)
        second.ready()
        assertEquals(listOf("theme", "open", "settings", "css"), second.sentTypes())

        b.onHidden()
        assertTrue(second.disposed)
        assertNull(second.component.parent)
        assertEquals(1, service.sessions.size)
        // b shown again while a is hidden: it takes the first browser.
        a.onHidden()
        b.onShown()
        assertEquals(2, factory.pages.size)
        assertSame(b.component, first.component.parent)
    }

    fun testRendererCrashRecreatesTheBrowserAndReopensDocuments() {
        val a = editor("a.md")
        val b = editor("b.md")
        b.onShown()
        val old = factory.pages.single()
        old.ready()
        val idB = old.take().last().second!!
        old.opened(idB, b)
        old.sent.clear()
        b.onHidden()
        a.onShown()
        val idA = old.take().single().second!!
        old.opened(idA, a)
        old.sent.clear()

        old.crash()
        assertTrue(old.disposed)
        val fresh = factory.pages[1]
        assertSame(a.component, fresh.component.parent)
        // A late message of the old page is dropped.
        old.deliver(PageMessage.Command(idA, "toggleMode"))
        old.ready()
        assertTrue(old.sent.isEmpty())

        fresh.ready()
        val reopened = fresh.take()
        assertEquals("theme", reopened[0].first)
        assertEquals(setOf("open" to idA, "open" to idB), reopened.drop(1).toSet())
        fresh.opened(idB, b)
        assertTrue("b is not the visible document", fresh.take().isEmpty())
        fresh.opened(idA, a)
        assertEquals(listOf("activate" to idA), fresh.take())
    }

    fun testMessagesForDocumentsNotOpenInThePageAreDropped() {
        val a = editor("a.md")
        a.onShown()
        val page = factory.pages.single()
        page.ready()
        page.sent.clear()
        val text = a.document.text
        page.deliver(PageMessage.Patch("ffffffffffffffffffffffffffffffff", 1, 0, listOf(ch.nmeylan.markdone.sync.TextPatch(0, 0, "x"))))
        assertTrue(page.sent.isEmpty())
        assertEquals(text, a.document.text)
    }

    fun testAssetsServeOnlyDocumentsOpenInThatPage() {
        val a = editor("a.md")
        a.onShown()
        val page = factory.pages.single()
        page.ready()
        val idA = page.lastDocId()
        val origin = AssetRequestHandler.ORIGIN
        assertEquals(200, page.assets.respond("$origin/doc/$idA").status)
        assertEquals(404, page.assets.respond("$origin/doc/ffffffffffffffffffffffffffffffff").status)
        Disposer.dispose(a)
        assertEquals(404, page.assets.respond("$origin/doc/$idA").status)
    }

    /** Protocol 2.2: `css` before `activate` when the project or its trust state changes; never an identical `css` again. */
    fun testCssGoesBeforeActivateForAnotherProjectOrTrustState() {
        val loads = mutableListOf<Pair<com.intellij.openapi.project.Project, String>>()
        val pending = mutableListOf<(ch.nmeylan.markdone.css.UserCssService.UserCss) -> Unit>()
        service.loadCss = { p, token, done -> loads += p to token; pending += done }
        var trusted = true
        service.projectTrusted = { trusted }
        val a = editor("a.md")
        val b = editor("b.md")
        a.onShown()
        val page = factory.pages.single()
        page.ready()
        val idA = page.lastDocId()
        page.opened(idA, a)
        assertEquals("activate waits for the css", listOf("theme", "open", "settings"), page.sentTypes())
        pending.removeAt(0)(ch.nmeylan.markdone.css.UserCssService.UserCss("g {}", ".p {}", false))
        assertEquals(listOf("css", "activate"), page.sentTypes().drop(3))
        page.sent.clear()

        // Same project and trust: no new load, no css, activate at once.
        a.onHidden()
        b.onShown()
        val idB = page.lastDocId()
        page.opened(idB, b)
        assertEquals(1, loads.size)
        assertEquals(listOf("open", "activate"), page.sentTypes())
        page.sent.clear()

        // The trust state changed: the css goes first.
        trusted = false
        b.onHidden()
        a.onShown()
        assertTrue(page.sent.isEmpty())
        assertEquals(2, loads.size)
        assertEquals("One projectToken per project in the page", loads[0].second, loads[1].second)
        pending.removeAt(0)(ch.nmeylan.markdone.css.UserCssService.UserCss("g {}", null, true))
        assertEquals(listOf("css", "activate"), page.sentTypes())
        assertTrue(a.hasProjectCssNotice)
        page.sent.clear()

        // Back to trusted with the CSS sent before that: it differs from the last one, so it is sent.
        trusted = true
        a.onHidden()
        b.onShown()
        pending.removeAt(0)(ch.nmeylan.markdone.css.UserCssService.UserCss("g {}", null, true))
        assertEquals("Identical css is not sent again", listOf("activate"), page.sentTypes())
        assertTrue(b.hasProjectCssNotice)
    }

    fun testProjectTokenServesProjectAssetsUntilTheLastDocumentOfTheProjectCloses() {
        val tokens = mutableListOf<String>()
        service.loadCss = { _, token, done -> tokens += token; done(ch.nmeylan.markdone.css.UserCssService.UserCss("", null, false)) }
        val a = editor("a.md")
        val (page, _) = openedPage(a)
        val token = tokens.single()
        val session = service.sessions.single()
        assertNotNull(session.projects[token])
        Disposer.dispose(a)
        page.flushReply(page.lastDocId())
        assertNull("No reference to the project after its last document", session.projects[token])
        assertEquals(404, page.assets.respond("${AssetRequestHandler.ORIGIN}/proj/$token/x.png").status)
    }

    fun testFlushGoesToThePageOfTheEditor() {
        val a = editor("a.md")
        var done = 0
        a.flush { done++ }
        assertEquals("No page yet", 1, done)
        a.onShown()
        val page = factory.pages.single()
        page.ready()
        val idA = page.lastDocId()
        page.opened(idA, a)
        page.sent.clear()
        a.flush { done++ }
        assertEquals(1, done)
        val flush = page.sent.single()
        assertEquals("flush", flush["type"].asString)
        page.deliver(PageMessage.Patch(idA, flush["seq"].asLong, 0, emptyList()))
        assertEquals(2, done)
    }

    /** Tasks that [SharedBrowserService.runOnEdt] posts, run when the test wants (end of the EDT event). */
    private val edt = mutableListOf<() -> Unit>()

    private fun queueEdt() {
        service.runOnEdt = { edt += it }
    }

    private fun runEdt() {
        while (edt.isNotEmpty()) edt.removeAt(0)()
    }

    /** A tab switch between two Edit tabs reuses the one browser, in both event orders. */
    fun testTabSwitchReusesTheBrowserInBothEventOrders() {
        queueEdt()
        val a = editor("a.md")
        val b = editor("b.md")
        a.onShown()
        val page = factory.pages.single()
        page.ready()
        runEdt()
        val idA = page.take().last().second!!
        page.opened(idA, a)
        runEdt()
        var (from, to) = a to b
        for (i in 0 until 6) {
            if (i % 2 == 0) {
                // New view shown before the old one is hidden (the order seen in L5).
                to.onShown()
                from.onHidden()
            } else {
                from.onHidden()
                to.onShown()
            }
            runEdt()
            assertEquals("switch $i", 1, factory.pages.size)
            assertSame("switch $i", to.component, page.component.parent)
            assertEquals(1, service.sessions.size)
            from = to.also { to = from }
        }
    }

    fun testSplitEditorStillGetsASecondBrowser() {
        queueEdt()
        val a = editor("a.md")
        val b = editor("b.md")
        a.onShown()
        b.onShown()
        assertEquals("Decided at the end of the EDT event", 1, factory.pages.size)
        runEdt()
        assertEquals(2, factory.pages.size)
        assertSame(b.component, factory.pages[1].component.parent)
    }

    fun testDivergedReloadsTheDocument() {
        val a = editor("a.md")
        a.onShown()
        val page = factory.pages.single()
        page.ready()
        val idA = page.take().last().second!!
        page.opened(idA, a)
        page.sent.clear()
        page.deliver(PageMessage.Diverged(idA, 3, 4))
        assertEquals(listOf("reload" to idA), page.take())
    }

    /** After the crash limit: no new browser, a message in the view, flushes do not wait. */
    fun testCrashLimitShowsMessageAndStopsWaiting() {
        val a = editor("a.md")
        val b = editor("b.md")
        a.onShown()
        factory.pages.single().ready()
        val idA = factory.pages.single().take().last().second!!
        factory.pages.single().opened(idA, a)
        repeat(3) { factory.pages.last().crash() }
        assertEquals(4, factory.pages.size)
        assertFalse(a.isUnavailable)
        factory.pages.last().ready()
        factory.pages.last().opened(idA, a)
        factory.pages.last().crash()
        assertTrue(service.unavailable)
        assertEquals("No fifth browser", 4, factory.pages.size)
        assertTrue(factory.pages.all { it.disposed })
        assertTrue(a.isUnavailable)
        assertNull(factory.pages.last().component.parent)
        var done = 0
        a.flush { done++ }
        assertEquals("Flush completes at once", 1, done)
        a.onHidden()
        b.onShown()
        assertTrue(b.isUnavailable)
        assertEquals(4, factory.pages.size)
    }
    /** A page with [a] open; returns its docId. */
    private fun openedPage(a: WebEditor): Pair<FakePage, String> {
        a.onShown()
        val page = factory.pages.last()
        page.ready()
        val id = page.lastDocId()
        page.opened(id, a)
        page.sent.clear()
        return page to id
    }

    private fun tableEditor(): WebEditor {
        val file = myFixture.addFileToProject("t.md", "# T\n\n| A | B |\n|---|---|\n| 1 | 2 |\n").virtualFile
        return WebEditor(project, file, FileDocumentManager.getInstance().getDocument(file)!!) { service }
            .also { Disposer.register(testRootDisposable, it) }
    }

    fun testTableActionFlushesThenEditsTheDocument() {
        val t = tableEditor()
        val (page, id) = openedPage(t)
        val scheduler = service.syncScheduler as FakeScheduler
        page.deliver(PageMessage.TableAction(id, "insertRowBelow", ch.nmeylan.markdone.sync.TableCell(5, 34, 1, 0)))
        val flush = page.sent.single()
        assertEquals("flush", flush["type"].asString)
        assertEquals("No edit before the flush reply", "# T\n\n| A | B |\n|---|---|\n| 1 | 2 |\n", t.document.text)
        page.deliver(PageMessage.Patch(id, flush["seq"].asLong, 0, emptyList()))
        assertEquals("# T\n\n| A | B |\n|---|---|\n| 1 | 2 |\n|  |  |\n", t.document.text)
        scheduler.runPosts()
        val change = page.sent.last()
        assertEquals("change", change["type"].asString)
        val c = change["changes"].asJsonArray.single().asJsonObject
        assertEquals(34, c["from"].asInt)
        assertEquals(34, c["to"].asInt)
        assertEquals("\n|  |  |", c["insert"].asString)
        // One undo step.
        val undo = com.intellij.openapi.command.undo.UndoManager.getInstance(project)
        val textEditor = com.intellij.openapi.fileEditor.impl.text.TextEditorProvider.getInstance().createEditor(project, t.file)
        Disposer.register(testRootDisposable, textEditor)
        undo.undo(textEditor)
        assertEquals("# T\n\n| A | B |\n|---|---|\n| 1 | 2 |\n", t.document.text)
    }

    fun testTableActionForARangeThatIsNotATableIsIgnored() {
        val t = tableEditor()
        val (page, id) = openedPage(t)
        val text = t.document.text
        for (cell in listOf(
            ch.nmeylan.markdone.sync.TableCell(0, 34, 1, 0), // starts at the heading
            ch.nmeylan.markdone.sync.TableCell(5, 32, 1, 0), // ends inside a line
            ch.nmeylan.markdone.sync.TableCell(5, 34, 0, 0), // removeRow of the header row
            ch.nmeylan.markdone.sync.TableCell(5, 999, 1, 0), // outside the text
        )) {
            page.deliver(PageMessage.TableAction(id, "removeRow", cell))
            val flush = page.sent.last()
            page.deliver(PageMessage.Patch(id, flush["seq"].asLong, 0, emptyList()))
            assertEquals(text, t.document.text)
        }
    }

    fun testSettingsAfterReadyAndReloadWhenRemoteImagesChange() {
        var remote = false
        service.remoteImagesSetting = { remote }
        val a = editor("a.md")
        val (page, _) = openedPage(a)
        assertFalse(page.assets.respond("${AssetRequestHandler.ORIGIN}/app/index.html").headers["Content-Security-Policy"]!!.contains("https:;"))
        service.settingsChanged()
        assertEquals("Same setting: no reload", 0, page.reloads)
        remote = true
        service.settingsChanged()
        // The page edits are flushed first: no reload before the flush reply.
        val flush = page.sent.single()
        assertEquals("flush", flush["type"].asString)
        assertEquals(0, page.reloads)
        page.deliver(PageMessage.Patch(page.lastDocId(), flush["seq"].asLong, 0, listOf(ch.nmeylan.markdone.sync.TextPatch(0, 0, "x"))))
        assertTrue("In-flight edit kept", a.document.text.startsWith("x"))
        assertEquals(1, page.reloads)
        page.sent.clear()
        assertTrue(page.assets.respond("${AssetRequestHandler.ORIGIN}/app/index.html").headers["Content-Security-Policy"]!!.contains("img-src https://markdone.local/ data: https:;"))
        assertTrue("Nothing is sent before the new ready", page.sent.isEmpty())
        page.ready()
        val settings = page.sent.single { it["type"].asString == "settings" }
        assertTrue(settings["remoteImages"].asBoolean)
        assertEquals(setOf("type", "remoteImages", "math", "mermaid", "highlight", "softBreaks", "style"), settings.keySet())
        assertEquals(listOf("theme", "open", "settings", "css"), page.sentTypes())
    }

    fun testReloadAfterFlushTimeout() {
        var remote = false
        service.remoteImagesSetting = { remote }
        val (page, _) = openedPage(editor("a.md"))
        remote = true
        service.settingsChanged()
        assertEquals(0, page.reloads)
        (service.syncScheduler as FakeScheduler).timeouts.single()()
        assertEquals(1, page.reloads)
    }

    fun testCssGoesToThePagesOfThatProjectOnly() {
        var css = ch.nmeylan.markdone.css.UserCssService.UserCss("g {}", ".p {}", false)
        val loads = mutableListOf<String>()
        service.loadCss = { _, token, done -> loads += token; done(css) }
        val a = editor("a.md")
        val (page, id) = openedPage(a)
        page.sent.clear()
        // Sent once per page load; the same CSS again sends nothing.
        service.projectCssChanged(project)
        assertTrue(page.sent.isEmpty())
        css = css.copy(project = ".p { color: red }")
        service.projectCssChanged(com.intellij.openapi.project.ProjectManager.getInstance().defaultProject)
        assertTrue("Other project: nothing", page.sent.isEmpty())
        service.projectCssChanged(project)
        val message = page.sent.single()
        assertEquals("css", message["type"].asString)
        assertEquals("g {}", message["global"].asString)
        assertEquals(".p { color: red }", message["project"].asString)
        assertEquals(setOf("type", "global", "project"), message.keySet())
        assertTrue("A projectToken, not the docId", Regex("[0-9a-f]{32}").matches(loads.last()) && loads.last() != id)
        css = css.copy(project = null, untrusted = true)
        // A global CSS change loads the CSS again (other setting changes do not).
        ch.nmeylan.markdone.settings.MdSettings.getInstance().globalCss = "g2 {}"
        assertTrue(page.sent.last()["project"].isJsonNull)
        assertTrue(a.hasProjectCssNotice)
        css = css.copy(untrusted = false)
        service.projectCssChanged(project)
        assertFalse(a.hasProjectCssNotice)
    }

    /** Protocol 2.3: `settings` has all fields after `ready` and after each change; an identical one is not sent again. */
    fun testSettingsMessageHasAllFieldsAndFollowsChanges() {
        val settings = ch.nmeylan.markdone.settings.MdSettings.getInstance()
        val (page, _) = openedPageWithReadyMessages(editor("a.md"))
        val first = page.sent.single { it["type"].asString == "settings" }
        assertEquals(
            com.google.gson.JsonParser.parseString("""{"type":"settings","remoteImages":false,"math":true,"mermaid":true,"highlight":true,"softBreaks":true,"style":"default"}"""),
            first,
        )
        page.sent.clear()
        // The setters publish MdSettings.TOPIC; the service listens to it.
        settings.math = false
        settings.style = ch.nmeylan.markdone.settings.MdStyle.COMPACT
        val sent = page.sent.filter { it["type"].asString == "settings" }
        assertEquals(2, sent.size)
        assertEquals(
            com.google.gson.JsonParser.parseString("""{"type":"settings","remoteImages":false,"math":false,"mermaid":true,"highlight":true,"softBreaks":true,"style":"compact"}"""),
            sent.last(),
        )
        assertTrue("No theme: the zoom did not change", page.sent.none { it["type"].asString == "theme" })
        page.sent.clear()
        service.settingsChanged()
        assertTrue("Identical settings are not sent again", page.sent.none { it["type"].asString == "settings" })
    }

    /** Zoom commands: the setting changes in steps of 0.1 within 0.5..3.0 and every page gets `theme`. */
    fun testZoomCommandsChangeTheSettingAndResendThemeToEveryPage() {
        val a = editor("a.md")
        val b = editor("b.md")
        a.onShown()
        b.onShown()
        val (first, second) = factory.pages
        first.ready()
        second.ready()
        val idA = first.lastDocId()
        first.opened(idA, a)
        assertEquals(1.0, first.sent.single { it["type"].asString == "theme" }["zoom"].asDouble)
        first.sent.clear()
        second.sent.clear()
        fun zooms(page: FakePage) = page.sent.filter { it["type"].asString == "theme" }.map { it["zoom"].asDouble }
        first.deliver(PageMessage.Command(idA, "zoomIn"))
        assertEquals(1.1, ch.nmeylan.markdone.settings.MdSettings.getInstance().zoom)
        assertEquals(listOf(1.1), zooms(first))
        assertEquals("The other page too", listOf(1.1), zooms(second))
        first.deliver(PageMessage.Command(idA, "zoomOut"))
        first.deliver(PageMessage.Command(idA, "zoomOut"))
        assertEquals(listOf(1.1, 1.0, 0.9), zooms(first))
        repeat(40) { first.deliver(PageMessage.Command(idA, "zoomIn")) }
        assertEquals(3.0, zooms(first).last())
        val count = zooms(first).size
        first.deliver(PageMessage.Command(idA, "zoomIn"))
        assertEquals("At the limit: no new theme", count, zooms(first).size)
        first.deliver(PageMessage.Command(idA, "zoomReset"))
        assertEquals(1.0, zooms(first).last())
        assertEquals(zooms(first), zooms(second))
        val theme = first.sent.last { it["type"].asString == "theme" }
        assertEquals(setOf("type", "dark", "fontFamily", "fontSizePx", "zoom"), theme.keySet())
    }

    /** IDE theme follow: a look-and-feel or color-scheme event resends `theme` only when it differs. */
    fun testThemeChangeResendsOnlyADifferentTheme() {
        val (page, _) = openedPage(editor("a.md"))
        service.themeChanged()
        assertTrue("Same theme: nothing", page.sent.isEmpty())
        com.intellij.openapi.application.ApplicationManager.getApplication().messageBus
            .syncPublisher(com.intellij.openapi.editor.colors.EditorColorsManager.TOPIC).globalSchemeChange(null)
        assertTrue(page.sent.isEmpty())
        ch.nmeylan.markdone.settings.MdSettings.getInstance().zoomIn()
        assertEquals("Zoom change: theme only", listOf("theme"), page.sentTypes())
    }

    /** As [openedPage], but keeps the messages sent after `ready`. */
    private fun openedPageWithReadyMessages(a: WebEditor): Pair<FakePage, String> {
        a.onShown()
        val page = factory.pages.last()
        page.ready()
        val id = page.lastDocId()
        page.opened(id, a)
        return page to id
    }

    /** Closing the last tab flushes first, so edits the page still holds reach the Document. */
    fun testCloseFlushesPendingPageEditsFirst() {
        val a = editor("a.md")
        val (page, id) = openedPage(a)
        val document = a.document
        Disposer.dispose(a)
        assertEquals("No close before the flush reply", listOf("flush"), page.sentTypes())
        page.flushReply(id, listOf(ch.nmeylan.markdone.sync.TextPatch(0, 0, "typed ")))
        assertEquals("typed # a.md\n", document.text)
        assertEquals(listOf("ack", "close"), page.sentTypes())
        assertEquals(404, page.assets.respond("${AssetRequestHandler.ORIGIN}/doc/$id").status)
    }

    fun testCloseWithoutReplyClosesAfterTheFlushTimeout() {
        val a = editor("a.md")
        val (page, _) = openedPage(a)
        Disposer.dispose(a)
        assertEquals(listOf("flush"), page.sentTypes())
        (service.syncScheduler as FakeScheduler).timeouts.last()()
        assertEquals(listOf("flush", "close"), page.sentTypes())
    }

    /** An extra browser is released only after its documents are flushed. */
    fun testExtraBrowserIsReleasedAfterTheFlush() {
        val a = editor("a.md")
        val b = editor("b.md")
        a.onShown()
        b.onShown()
        val second = factory.pages[1]
        second.ready()
        val idB = second.lastDocId()
        second.opened(idB, b)
        second.sent.clear()
        b.onHidden()
        assertFalse("Waits for the flush reply", second.disposed)
        second.flushReply(idB, listOf(ch.nmeylan.markdone.sync.TextPatch(0, 0, "x")))
        assertEquals("x# b.md\n", b.document.text)
        assertTrue(second.disposed)
    }

    /** A save asks the page for its edits; when they change the document, it is saved again. */
    fun testSaveFlushesAndSavesAgainWhenThePageHadEdits() {
        val a = editor("a.md")
        val (page, id) = openedPage(a)
        val manager = FileDocumentManager.getInstance()
        com.intellij.openapi.command.WriteCommandAction.runWriteCommandAction(project) { a.document.insertString(0, "ide ") }
        page.sent.clear()
        var saved = 0
        val saves = { saved }
        com.intellij.openapi.application.ApplicationManager.getApplication().messageBus.connect(testRootDisposable)
            .subscribe(com.intellij.openapi.fileEditor.FileDocumentManagerListener.TOPIC, object : com.intellij.openapi.fileEditor.FileDocumentManagerListener {
                override fun beforeDocumentSaving(document: com.intellij.openapi.editor.Document) {
                    if (document === a.document) saved++
                }
            })
        manager.saveDocument(a.document)
        assertFalse(manager.isDocumentUnsaved(a.document))
        assertEquals(1, saves())
        // The flush reply brings the page's edit after the save; it is saved once more, without a new flush.
        page.flushReply(id, listOf(ch.nmeylan.markdone.sync.TextPatch(0, 0, "page ")), baseStamp = 1)
        assertEquals("page ide # a.md\n", a.document.text)
        assertFalse("Saved again", manager.isDocumentUnsaved(a.document))
        assertTrue("No second flush", page.sent.none { it["type"].asString == "flush" })
        assertEquals("The save, then one more", 2, saves())
        // A save with no page edits: one flush, nothing saved again.
        com.intellij.openapi.command.WriteCommandAction.runWriteCommandAction(project) { a.document.insertString(0, "x") }
        page.sent.clear()
        manager.saveDocument(a.document)
        assertEquals(3, saves())
        page.flushReply(id, baseStamp = 3)
        assertFalse(manager.isDocumentUnsaved(a.document))
        assertEquals("No extra save without page edits", 3, saves())
    }

    private val scheduler get() = service.syncScheduler as FakeScheduler

    /** Close waits up to 5 s (not 500 ms), so a late reply is still applied; a mode-switch flush keeps 500 ms. */
    fun testCloseWaitsForALateReplyButModeSwitchFlushKeeps500Ms() {
        val a = editor("a.md")
        val (page, id) = openedPage(a)
        a.flush { }
        assertEquals(500L, scheduler.delays.last())
        page.flushReply(id)
        page.sent.clear()
        val document = a.document
        Disposer.dispose(a)
        assertEquals(ch.nmeylan.markdone.sync.DocumentSync.CLOSE_FLUSH_TIMEOUT_MS, scheduler.delays.last())
        // The reply comes after 500 ms (no timeout has fired): still applied, then close.
        page.flushReply(id, listOf(ch.nmeylan.markdone.sync.TextPatch(0, 0, "late ")))
        assertEquals("late # a.md\n", document.text)
        assertEquals(listOf("ack", "close"), page.sentTypes())
    }

    /** Closing the editor that hosts an extra browser: flush, then the document is closed and the browser released. */
    fun testClosingTheHostOfAnExtraBrowserFlushesThenReleasesAndCloses() {
        val a = editor("a.md")
        val b = editor("b.md")
        a.onShown()
        b.onShown()
        val second = factory.pages[1]
        second.ready()
        val idB = second.lastDocId()
        second.opened(idB, b)
        second.sent.clear()
        val document = b.document
        Disposer.dispose(b)
        assertFalse("Waits for the flush reply", second.disposed)
        assertTrue(scheduler.delays.takeLast(2).all { it == ch.nmeylan.markdone.sync.DocumentSync.CLOSE_FLUSH_TIMEOUT_MS })
        val flush = second.sent.last { it["type"].asString == "flush" }
        second.deliver(PageMessage.Patch(idB, flush["seq"].asLong, 0, listOf(ch.nmeylan.markdone.sync.TextPatch(0, 0, "x"))))
        assertEquals("x# b.md\n", document.text)
        assertTrue(second.disposed)
        assertEquals(1, service.sessions.size)
        assertEquals(404, second.assets.respond("${AssetRequestHandler.ORIGIN}/doc/$idB").status)
    }

    /** A file opened again while its close flush runs gets a new docId; the old reply still reaches the Document. */
    fun testReopenDuringTheCloseFlush() {
        val a = editor("a.md")
        val (page, oldId) = openedPage(a)
        val document = a.document
        Disposer.dispose(a)
        val again = editor("a.md")
        again.onShown()
        val open = page.sent.last()
        assertEquals("open", open["type"].asString)
        val newId = open["docId"].asString
        assertFalse(newId == oldId)
        val flush = page.sent.first { it["type"].asString == "flush" }
        page.sent.clear()
        page.deliver(PageMessage.Patch(oldId, flush["seq"].asLong, 0, listOf(ch.nmeylan.markdone.sync.TextPatch(0, 0, "old "))))
        assertEquals("old # a.md\n", document.text)
        assertEquals(listOf("ack" to oldId, "close" to oldId), page.take().filter { it.first != "change" })
        assertEquals(200, page.assets.respond("${AssetRequestHandler.ORIGIN}/doc/$newId").status)
        assertEquals(404, page.assets.respond("${AssetRequestHandler.ORIGIN}/doc/$oldId").status)
    }

    /** A project close is refused once, the pages flush, then the close is requested again and let through. */
    fun testProjectCloseWaitsForTheFlush() {
        val closes = mutableListOf<Boolean>()
        service.closeProject = { closes += service.canCloseProject(it) }
        val a = editor("a.md")
        val (page, id) = openedPage(a)
        val other = com.intellij.openapi.project.ProjectManager.getInstance().defaultProject
        assertTrue("No document of that project", service.canCloseProject(other))
        assertFalse(service.canCloseProject(project))
        assertEquals(ch.nmeylan.markdone.sync.DocumentSync.CLOSE_FLUSH_TIMEOUT_MS, scheduler.delays.last())
        assertFalse("Still flushing", service.canCloseProject(project))
        assertEquals("One flush", 1, page.sent.count { it["type"].asString == "flush" })
        page.flushReply(id, listOf(ch.nmeylan.markdone.sync.TextPatch(0, 0, "held ")))
        assertEquals("held # a.md\n", a.document.text)
        assertEquals("Requested again and let through", listOf(true), closes)
        page.sent.clear()
        assertFalse("A new request flushes again", service.canCloseProject(project))
        // No reply: the timeout lets it close.
        scheduler.timeouts.last()()
        assertEquals(listOf(true, true), closes)
    }

    fun testExitAndRestartWaitForTheFlush() {
        val exits = mutableListOf<Boolean>()
        service.exitApplication = { restart -> exits += restart }
        assertTrue("No page: no veto", service.canExit(restart = false))
        val a = editor("a.md")
        val (page, id) = openedPage(a)
        assertFalse(service.canExit(restart = true))
        assertFalse(service.canExit(restart = true))
        page.flushReply(id)
        assertEquals(listOf(true), exits)
        assertTrue("Let through", service.canExit(restart = true))
        assertTrue("The exit closes the projects next", service.canCloseProject(project))
    }

    /** Zoom, style and toggles do not load the CSS again; the global CSS does. */
    fun testOnlyCssSettingsLoadTheCssAgain() {
        var loads = 0
        service.loadCss = { _, _, done -> loads++; done(ch.nmeylan.markdone.css.UserCssService.UserCss("", null, false)) }
        openedPage(editor("a.md"))
        assertEquals(1, loads)
        val settings = ch.nmeylan.markdone.settings.MdSettings.getInstance()
        settings.zoomIn()
        settings.style = ch.nmeylan.markdone.settings.MdStyle.SERIF
        settings.math = false
        assertEquals(1, loads)
        settings.globalCss = "p {}"
        assertEquals(2, loads)
        ch.nmeylan.markdone.settings.MdProjectSettings.getInstance(project).projectCssPath = "x.css"
        assertEquals(3, loads)
        ch.nmeylan.markdone.settings.MdProjectSettings.getInstance(project).loadState(ch.nmeylan.markdone.settings.MdProjectSettings.ProjectState())
    }
}
