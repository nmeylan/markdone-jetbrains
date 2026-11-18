package ch.nmeylan.markdone.jcef

import com.google.gson.JsonParser
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.io.FileUtil
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import ch.nmeylan.markdone.editor.WebEditor
import ch.nmeylan.markdone.settings.MdSettings
import ch.nmeylan.markdone.sync.FakeScheduler
import ch.nmeylan.markdone.sync.PageMessage
import java.nio.file.Files
import java.nio.file.Path

/** `fileChanged` (protocol 2.7) and the `settings` fields of draw.io, with a fake page and real files. */
class DrawioFileChangeTest : BasePlatformTestCase() {
    private val factory = FakePageFactory()
    private lateinit var service: SharedBrowserService
    private lateinit var root: Path
    private lateinit var page: FakePage
    private lateinit var docId: String

    override fun setUp() {
        super.setUp()
        service = SharedBrowserService().apply {
            factory = this@DrawioFileChangeTest.factory
            runOnEdt = { it() }
            loadCss = NO_CSS
            remoteImagesSetting = { false }
            projectTrusted = { true }
            syncScheduler = FakeScheduler()
        }
        Disposer.register(testRootDisposable, service)
        root = FileUtil.createTempDirectory("markdone", null).toPath().toRealPath()
        val docs = Files.createDirectories(root.resolve("docs"))
        Files.writeString(docs.resolve("doc.md"), "drawio:a.drawio\n")
        Files.writeString(docs.resolve("a.drawio"), "<mxfile/>")
        Files.writeString(docs.resolve("my diagram.drawio"), "<mxfile/>")
        Files.writeString(docs.resolve("other.drawio"), "<mxfile/>")
        val file = LocalFileSystem.getInstance().refreshAndFindFileByNioFile(docs.resolve("doc.md"))!!
        val web = WebEditor(project, file, FileDocumentManager.getInstance().getDocument(file)!!) { service }
        Disposer.register(testRootDisposable, web)
        web.onShown()
        page = factory.pages.last()
        page.deliver(PageMessage.Ready(2))
        docId = page.lastDocId()
        page.deliver(PageMessage.Opened(docId, 0))
        page.sent.clear()
    }

    override fun tearDown() {
        try {
            MdSettings.getInstance().loadState(MdSettings.SettingsState())
        } finally {
            super.tearDown()
        }
    }

    private fun serve(path: String) = page.assets.respond("${AssetRequestHandler.ORIGIN}/drawio/$docId/$path").also { assertEquals(path, 200, it.status) }

    private fun fileChanged() = page.sent.filter { it["type"].asString == "fileChanged" }

    fun testFileChangedGoesOnlyForServedFiles() {
        val docs = root.resolve("docs")
        serve("a.drawio")
        serve("my%20diagram.drawio")
        service.drawioFilesChanged(listOf(docs.resolve("other.drawio")))
        assertTrue("A file the page never loaded", fileChanged().isEmpty())
        service.drawioFilesChanged(listOf(docs.resolve("a.drawio")))
        assertEquals(1, fileChanged().size)
        service.drawioFilesChanged(listOf(docs.resolve("my diagram.drawio")))
        val message = fileChanged().last()
        assertEquals(setOf("type", "docId", "path"), message.keySet())
        assertEquals(docId, message["docId"].asString)
        assertEquals("The path as the page wrote it, decoded", "my diagram.drawio", message["path"].asString)
    }

    fun testFileChangedMatchesTheFixture() {
        val fixture = JsonParser.parseString(Files.readString(Path.of("protocol/fixtures/messages/drawio.json"))).asJsonObject
        serve("my%20diagram.drawio")
        service.drawioFilesChanged(listOf(root.resolve("docs/my diagram.drawio")))
        val expected = fixture["fileChanged"].asJsonObject.deepCopy().apply { addProperty("docId", docId); addProperty("path", "my diagram.drawio") }
        assertEquals(expected, fileChanged().single())
    }

    fun testTwoPathsOfOneFileAndAFileThatGoesAway() {
        val docs = root.resolve("docs")
        serve("a.drawio")
        serve("./a.drawio")
        service.drawioFilesChanged(listOf(docs.resolve("a.drawio")))
        assertEquals(setOf("a.drawio", "./a.drawio"), fileChanged().map { it["path"].asString }.toSet())
        // A refused or missing file is not recorded.
        assertEquals(404, page.assets.respond("${AssetRequestHandler.ORIGIN}/drawio/$docId/missing.drawio").status)
        page.sent.clear()
        service.drawioFilesChanged(listOf(docs.resolve("missing.drawio")))
        assertTrue(fileChanged().isEmpty())
    }

    fun testNothingForAClosedPage() {
        serve("a.drawio")
        page.sent.clear()
        service.recover(service.sessions.single())
        service.drawioFilesChanged(listOf(root.resolve("docs/a.drawio")))
        assertTrue(factory.pages.last().sent.none { it["type"].asString == "fileChanged" })
    }

    fun testSettingsMessageHasTheDrawioFields() {
        val settings = MdSettings.getInstance()
        val fixture = JsonParser.parseString(Files.readString(Path.of("protocol/fixtures/messages/drawio.json"))).asJsonObject
        service.settingsChanged()
        val first = (service.sessions.single().settingsSent)!!
        assertEquals(fixture["settings"], first)
        settings.drawio = false
        settings.drawioPattern = "[[draw {path}@@{page}]]"
        val sent = page.sent.filter { it["type"].asString == "settings" }.last()
        assertFalse(sent["drawio"].asBoolean)
        assertEquals("[[draw {path}@@{page}]]", sent["drawioPattern"].asString)
    }
}
