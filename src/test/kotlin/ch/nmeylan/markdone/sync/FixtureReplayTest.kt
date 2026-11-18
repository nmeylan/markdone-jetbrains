package ch.nmeylan.markdone.sync

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.google.gson.JsonPrimitive
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.TextEditor
import com.intellij.openapi.fileEditor.impl.text.TextEditorProvider
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import ch.nmeylan.markdone.editor.MdEditor
import ch.nmeylan.markdone.editor.WebEditor
import ch.nmeylan.markdone.jcef.FakePageFactory
import ch.nmeylan.markdone.jcef.NO_CSS
import ch.nmeylan.markdone.jcef.SharedBrowserService
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.extension
import kotlin.io.path.listDirectoryEntries

/**
 * Replays every .json file in protocol/fixtures (L4) through [SharedBrowserService] with a fake
 * page and one Markdown tab in Edit mode. Page steps go through [PageMessages]. Each IDE step must equal the
 * next message of its type that Kotlin sent, in order; at the end every other message Kotlin sent must be a
 * `theme`, `activate`, `settings` or `css` (the fixtures leave them out). IDE steps that the IDE starts itself are started
 * by the test: `flush` (the tab asks for a flush) and a `change` without selection (the test makes the
 * changes as separate commands). DocIds are mapped between the fixture and the IDE; stamps are the
 * per-document version counter (protocol 2.1), so they must match exactly.
 */
class FixtureReplayTest : BasePlatformTestCase() {

    fun testReplayFixtures() {
        val fixtures = Path.of("protocol/fixtures").listDirectoryEntries().filter { it.extension == "json" }.sorted()
        assertTrue("No fixtures found", fixtures.size >= 2)
        for ((i, fixture) in fixtures.withIndex()) replay(fixture, i)
    }

    /** Values that the fixture and the IDE choose independently. */
    private class Mapping {
        private val toIde = HashMap<String, String>()
        private val toFixture = HashMap<String, String>()

        fun learn(fixture: String, ide: String) {
            if (toIde.putIfAbsent(fixture, ide) != null || toFixture.putIfAbsent(ide, fixture) != null) {
                assertEquals("mapping of $fixture", ide, toIde[fixture])
            }
        }

        fun ide(fixture: String) = toIde[fixture] ?: error("No IDE value for fixture value $fixture yet")
        fun fixture(ide: String) = toFixture[ide]
    }

    private fun replay(fixture: Path, index: Int) {
        val name = fixture.fileName.toString()
        val root = JsonParser.parseString(Files.readString(fixture)).asJsonObject
        val steps = root["steps"].asJsonArray.map { it.asJsonObject }
        val file = myFixture.addFileToProject("fixture$index.md", root["initialText"].asString).virtualFile
        val document = FileDocumentManager.getInstance().getDocument(file)!!
        val factory = FakePageFactory()
        val scheduler = FakeScheduler()
        val service = SharedBrowserService().apply {
            this.factory = factory
            runOnEdt = { it() }
            loadCss = NO_CSS
            remoteImagesSetting = { false }
            syncScheduler = scheduler
        }
        val textEditor = TextEditorProvider.getInstance().createEditor(project, file) as TextEditor
        val web = WebEditor(project, file, document) { service }
        val editor = MdEditor(textEditor, web)
        try {
            web.onShown()
            val page = factory.pages.single()
            val ids = Mapping()
            val matched = HashSet<Int>()
            var next = 0
            var flushes = 0
            var flushed = 0
            for ((i, step) in steps.withIndex()) {
                val msg = step["msg"].asJsonObject
                val where = "$name step $i"
                if (step["from"].asString == "page") {
                    val ideMsg = msg.deepCopy()
                    if (msg.has("docId")) ideMsg.addProperty("docId", ids.ide(msg["docId"].asString))
                    val message = PageMessages.parse(step["fn"].asString, ideMsg.toString())
                    assertNotNull("$where: page message rejected", message)
                    page.deliver(message!!)
                } else {
                    val type = msg["type"].asString
                    val ofType = { (next until page.sent.size).firstOrNull { page.sent[it]["type"].asString == type } }
                    if (ofType() == null && type == "flush") {
                        flushes++
                        web.flush { flushed++ }
                    }
                    if (ofType() == null && type == "change" && !msg.has("selection")) {
                        for (c in msg["changes"].asJsonArray.map { it.asJsonObject }) {
                            WriteCommandAction.runWriteCommandAction(project) {
                                document.replaceString(c["from"].asInt, c["to"].asInt, c["insert"].asString)
                            }
                        }
                        scheduler.runPosts()
                    }
                    val found = ofType()
                    assertNotNull("$where: IDE did not send $msg; sent ${page.sent}", found)
                    val actual = page.sent[found!!].deepCopy()
                    matched += found
                    next = found + 1
                    if (type == "open") ids.learn(msg["docId"].asString, actual["docId"].asString)
                    if (actual.has("docId")) actual.addProperty("docId", ids.fixture(actual["docId"].asString))
                    assertEquals(where, normalize(msg), normalize(actual))
                }
                root["textAfterStep"]?.asJsonObject?.get(i.toString())?.let { assertEquals("$where text", it.asString, document.text) }
            }
            root["finalText"]?.let { assertEquals("$name final text", it.asString, document.text) }
            assertEquals("$name: a flush did not complete", flushes, flushed)
            val others = page.sent.indices.filter { it !in matched }.map { page.sent[it]["type"].asString }
            assertTrue("$name: unexpected IDE messages $others", others.all { it in setOf("theme", "activate", "settings", "css") })
        } finally {
            Disposer.dispose(editor)
            Disposer.dispose(service)
        }
    }

    /** Numbers compared by value (Gson keeps 5 and 5.0 apart). */
    private fun normalize(e: JsonElement): JsonElement = when {
        e.isJsonObject -> JsonObject().also { o -> e.asJsonObject.entrySet().forEach { (k, v) -> o.add(k, normalize(v)) } }
        e.isJsonArray -> e.deepCopy().asJsonArray.let { a -> com.google.gson.JsonArray().also { r -> a.forEach { r.add(normalize(it)) } } }
        e.isJsonPrimitive && e.asJsonPrimitive.isNumber -> JsonPrimitive(e.asBigDecimal.stripTrailingZeros())
        else -> e
    }
}
