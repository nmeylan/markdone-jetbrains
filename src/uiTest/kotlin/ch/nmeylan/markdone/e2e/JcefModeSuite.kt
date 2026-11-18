package ch.nmeylan.markdone.e2e

import com.intellij.driver.model.OnDispatcher
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.FixMethodOrder
import org.junit.Test
import org.junit.runners.MethodSorters
import java.awt.event.InputEvent
import java.awt.event.KeyEvent
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.createDirectories
import kotlin.io.path.exists
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.writeText
import kotlin.math.abs

/**
 * L5 tests that run once per JCEF mode in one IDE session.
 * The methods run in name order and share the session: each step leaves the IDE in a known state.
 * PROTOCOL v2: one shared page (`https://markdone.local/app/index.html`) hosts all documents.
 */
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
abstract class JcefModeSuite(private val mode: String, private val outOfProcess: Boolean) {

    @get:org.junit.Rule
    val testName = org.junit.rules.TestName()

    @org.junit.Before
    fun selected() {
        assumeTrue("E2E_TESTS does not select ${testName.methodName}", E2e.testFilter?.containsMatchIn(testName.methodName) ?: true)
    }

    private val session: IdeSession
        get() {
            assumeTrue("JCEF mode $mode not selected", mode in E2e.modes)
            failedStart[mode]?.let { throw AssertionError("IDE did not start", it) }
            return sessions.getOrPut(mode) {
                val session = IdeSession(mode, outOfProcess, ::setupProject)
                try {
                    session.start()
                } catch (e: Throwable) {
                    failedStart[mode] = e
                    session.close()
                    throw e
                }
            }
        }

    private fun setupProject(project: Path) {
        IdeSession.copy(
            project,
            "medium.md" to "medium.md",
            "medium.md" to "medium-2.md",
            "small.md" to "small.md",
            "small.md" to "keys.md",
            "small.md" to "read-only.md",
            "large.md" to "large.md",
            "small.md" to "three/small.md",
            "medium.md" to "three/medium.md",
            "large.md" to "three/large.md",
            "small.md" to "typing.md",
            "small.md" to "external.md",
            "small.md" to "diverge.md",
            "small.md" to "source-menu.md",
            "small.md" to "undo.md",
            "small.md" to "menu.md",
            // t20-t27.
            "styles/live-preview.md" to "m2/live-preview.md",
            "styles/live-preview.md" to "m2/goto.md",
            "styles/tables-m2.md" to "m2/tables.md",
            "styles/tables-edge.md" to "m2/tables-edge.md",
            "small.md" to "cssdir/css.md",
            "small.md" to "undo-timing.md",
            // t28a, t28b.
            "m4/math-heavy.md" to "m4/math-heavy.md",
            "m4/mermaid-heavy.md" to "m4/mermaid-heavy.md",
            // t28d.
            "small.md" to "m5/zoom.md",
            // t28f-t28h.
            "medium.md" to "m5/wheel.md",
            "medium.md" to "m5/sync.md",
            "small.md" to "m5/title.md",
        )
        for (dir in listOf("styles", "readmes")) {
            for (f in E2e.corpus.resolve(dir).listDirectoryEntries("*.md")) IdeSession.copy(project, "$dir/${f.name}" to "$dir/${f.name}")
        }
        IdeSession.makeReadOnly(project.resolve("read-only.md"))
        // Images (t25, t26): pics/page.md loads img/a.png, ../shared/b.png and a file outside the project.
        val png = E2e.root.resolve("web/test/e2e/assets/logo.png")
        for (target in listOf(project.resolve("pics/img/a.png"), project.resolve("shared/b.png"), project.parent.resolve("outside.png"))) {
            target.parent.createDirectories()
            Files.copy(png, target)
        }
        project.resolve("pics/page.md").writeText("# Images\n\n![a](img/a.png)\n\n![b](../shared/b.png)\n\n![out](../../outside.png)\n")
        project.resolve("remote/remote.md").also { it.parent.createDirectories() }.writeText("# Remote\n\n![r](https://example.com/x.png)\n")
        // t28e: above a large-file limit of 1 MB (2 MB in whole MB).
        project.resolve(LARGE_LIMIT_FILE).also { it.parent.createDirectories() }
            .writeText("# Big\n\n" + "Some text in a paragraph of the big file.\n".repeat(2 * 1024 * 1024 / 42 + 100))
    }

    private fun metric(key: String, value: Double) = Metrics.put(mode, key, value)

    private fun log(message: String) = E2e.log("[$mode] $message")

    @Test
    fun t01_oneTabAndSourceModeOnOpen() {
        val s = session
        val opened = s.open("medium.md")
        val names = s.editorNames("medium.md")
        log("editors for medium.md: $names (openFile returned $opened)")
        assertEquals("only one editor (bundled Markdown editor hidden)", listOf("markdone"), names)
        assertEquals("opens in Source", "SHOW_EDITOR", s.layout("medium.md"))
        assertTrue("no browser in Source mode", s.cdp.available().not() || s.cdp.pages().isEmpty())
    }

    /** First Edit mode in the session: creates the shared browser. `editModeColdOpenMs` = `toggleToActivatedMs`. */
    @Test
    fun t02_coldEditModeByShortcut() {
        val s = session
        s.open("medium.md")
        val text = s.mdEditor("medium.md").getTextEditor()
        val target = text.getPreferredFocusedComponent() ?: text.getComponent()
        s.focus(target)
        Thread.sleep(300)
        s.press(KeyEvent.VK_CONTROL, KeyEvent.VK_ALT, KeyEvent.VK_SHIFT, KeyEvent.VK_W)
        var byShortcut = true
        val ms = try {
            s.waitActivated("medium.md", 0, 5_000)
        } catch (_: AssertionError) {
            byShortcut = false
            log("Ctrl+Alt+Shift+W did not reach the IDE action; toggling through the Driver")
            if (s.layout("medium.md") != "SHOW_PREVIEW") s.toggle("medium.md")
            s.waitActivated("medium.md", 0, 60_000)
        }
        metric("editModeColdOpenMs", ms.toDouble())
        assertEquals("one page", listOf(Cdp.PAGE_URL), s.cdp.pages())
        log("JCEF: ${s.cdp.evalString("navigator.userAgent")}; page perf: ${s.cdp.eval("window.markdone.perf()")}, " +
            "document: ${s.cdp.eval("window.markdone.perf(window.markdone.__debug.activeDocId())")}")
        checkPage("medium.md")
        assertTrue("Ctrl+Alt+Shift+W toggles the mode", byShortcut)
    }

    /**
     * Another 5000-line document after the browser exists, 20 times: each round
     * closes the tab (the page drops the document), opens it in Source and switches to Edit, so
     * the page fetches the text and builds a new state. Value = p95 of the plugin's `toggleToActivatedMs`.
     */
    @Test
    fun t03_warmEditMode5000Lines() {
        val s = session
        val file = "medium-2.md"
        val values = mutableListOf<Double>()
        var docId = ""
        repeat(WARM_OPENS) { i ->
            if (i > 0) {
                s.close(file)
                Thread.sleep(300)
            }
            val (ms, id) = s.openInEdit(file)
            values += ms.toDouble()
            docId = id
        }
        log("warm open toggleToActivatedMs (${values.size}): ${values.joinToString { "%.0f".format(it) }}")
        metric("editModeWarmOpen5000LinesMs", Metrics.p95(values))
        metric("editModeWarmOpen5000LinesMedianMs", Metrics.median(values))
        log("page perf warm: ${s.cdp.eval("window.markdone.perf(${js(docId)})")}")
        checkPage(file)
    }

    @Test
    fun t04_modeSwitchNoChange() {
        val s = session
        val file = "medium-2.md"
        val docId = s.ensureEdit(file)
        val md = s.mdEditor(file)
        val text = md.getTextEditor().getComponent()
        val preview = md.getPreviewEditor().getComponent()
        val rounds = mutableListOf<Double>()
        repeat(6) { i ->
            val t0 = System.nanoTime()
            s.toggle(file)
            E2e.waitFor("Source shown", 2_000, 1) { true.takeIf { s.layout(file) == "SHOW_EDITOR" && text.isShowing() } }
            val t1 = System.nanoTime()
            s.toggle(file)
            E2e.waitFor("Edit shown", 2_000, 1) { true.takeIf { s.layout(file) == "SHOW_PREVIEW" && preview.isShowing() } }
            val t2 = System.nanoTime()
            val toSource = (t1 - t0) / 1e6
            val toEdit = (t2 - t1) / 1e6
            log("switch round $i: Edit->Source %.1f ms, Source->Edit %.1f ms".format(toSource, toEdit))
            if (i > 0) rounds += toSource + toEdit // round 0 is a warm-up
        }
        metric("modeSwitchNoChangeMs", Metrics.median(rounds))
        s.waitPageEqualsDocument(file)
        checkZeroChanges(docId, file)
    }

    /**
     * Network capture (CDP) while a document opens in the shared page: `/doc/<id>` with
     * `X-Markdone-Stamp`, nothing outside https://markdone.local/. The page cannot load again in place
     * (the plugin blocks every navigation, also a reload), so the CSP header of `index.html` is
     * checked in t18, where a new browser loads the page.
     */
    @Test
    fun t05_headersCspAndNoForeignRequests() {
        val s = session
        val watch = s.cdp.watch()
        try {
            s.openInEdit("small.md")
            Thread.sleep(300)
        } catch (e: Throwable) {
            watch.stop()
            throw e
        }
        val requests = checkRequests(watch.stop(), "requests-$mode.json")
        val stamp = header(requests, "/doc/", "x-markdone-stamp")
        assertTrue("X-Markdone-Stamp on /doc", stamp?.toLongOrNull() != null)
        /*
         * The CSP is enforced: an inline <script> does not run. (Not tested with eval: CDP
         * Runtime.evaluate allows eval by default, allowUnsafeEvalBlockedByCSP.)
         */
        val inline = s.cdp.evalString(
            "(() => { const e = document.createElement('script'); e.textContent = 'window.__e2eInline = 1'; " +
                "document.head.append(e); e.remove(); return window.__e2eInline === 1 ? 'ran' : 'blocked'; })()",
        )
        assertEquals("inline script blocked by the CSP", "blocked", inline)
        checkPage("small.md")
    }

    /** Saves [requests] to [reportName], asserts that all are on https://markdone.local/, returns them. */
    private fun checkRequests(requests: JsonArray, reportName: String): List<kotlinx.serialization.json.JsonObject> {
        Files.writeString(E2e.reports.resolve(reportName), requests.toString())
        val list = requests.map { it.jsonObject }
        val urls = list.map { it["url"]!!.jsonPrimitive.content }
        log("requests: ${urls.size}, ${urls.map { it.substringBefore('?').substringAfterLast('/').take(16) }}")
        assertEquals("requests outside https://markdone.local/", emptyList<String>(), urls.filterNot { it.startsWith("https://markdone.local/") })
        return list
    }

    private fun header(requests: List<kotlinx.serialization.json.JsonObject>, path: String, name: String): String? {
        val response = requests.firstOrNull { it["url"]!!.jsonPrimitive.content.substringBefore('?').startsWith("https://markdone.local$path") }
            ?: throw AssertionError("no response for $path in ${requests.map { it["url"] }}")
        return response["headers"]?.jsonObject?.get(name)?.jsonPrimitive?.content
    }

    @Test
    fun t06_corpusZeroChangesAfterLoadAndModeSwitch() {
        val s = session
        val files = (s.project.resolve("styles").listDirectoryEntries("*.md") + s.project.resolve("readmes").listDirectoryEntries("*.md"))
            .map { s.project.relativize(it).toString() }.sorted() + "large.md"
        val failures = mutableListOf<String>()
        for (f in files) {
            try {
                val (ms, _) = s.openInEdit(f)
                log("$f activated in $ms ms")
                checkPage(f)
            } catch (e: Throwable) {
                failures += "$f: ${e.message}"
                log("FAIL $f: ${e.message}")
            } finally {
                s.close(f)
            }
        }
        log("corpus: ${files.size - failures.size}/${files.size} files: page text = Document, zero doc changes")
        assertEquals(emptyList<String>(), failures)
    }

    @Test
    fun t07_readOnlyFileIsNotEditable() {
        val s = session
        assertTrue(!s.isWritable("read-only.md"))
        s.openInEdit("read-only.md")
        val editable = E2e.waitFor("contenteditable=false", 5_000) {
            s.cdp.evalString("String(document.querySelector('.cm-content')?.getAttribute('contenteditable'))").takeIf { it == "false" }
        }
        assertEquals("false", editable)
    }

    @Test
    fun t08_keyRouting() {
        val s = session
        s.openInEdit("keys.md")
        val preview = s.mdEditor("keys.md").getPreviewEditor()
        s.cdp.eval(
            "(() => { if (!window.__e2eKeys) { window.__e2eKeys = []; window.addEventListener('keydown', (e) => " +
                "window.__e2eKeys.push([e.keyCode, e.key, e.code, e.ctrlKey, e.shiftKey, e.altKey].join(' ')), true); } return true; })()",
        )
        log("keymap: ${s.keymapName()}")
        val rows = mutableListOf<String>()
        var reachedAny = false
        for (k in KEYS) {
            val target = preview.getPreferredFocusedComponent() ?: preview.getComponent()
            s.focus(target)
            Thread.sleep(200)
            val focused = s.cdp.eval("document.hasFocus()").jsonPrimitive.boolean
            s.cdp.eval("window.__e2eKeys.length = 0")
            s.press(*k.codes)
            Thread.sleep(400)
            val seen = s.cdp.eval("window.__e2eKeys").jsonArray.map { it.jsonPrimitive.content }
            val reached = seen.any { it.startsWith("${k.domKeyCode} ") && it.endsWith(k.modifiers) }
            reachedAny = reachedAny || reached
            val actions = s.keymapActions(k.keyStroke)
            val row = "| ${k.label} | ${if (reached) "yes" else "no"} | ${actions.joinToString(", ").ifEmpty { "-" }} | " +
                "page focus before: $focused; page keydowns: ${seen.joinToString("; ").ifEmpty { "none" }} |"
            rows += row
            log("key $row")
        }
        Files.writeString(
            E2e.reports.resolve("key-routing-$mode.md"),
            "| Shortcut | Reaches page | IDE keymap actions (${s.keymapName()}) | Notes |\n|---|---|---|---|\n" + rows.joinToString("\n") + "\n",
        )
        assertTrue("no key reached the page: does the IDE window have the X input focus?", reachedAny)
    }

    /**
     * The platform's startup measurer charges each plugin for the time of its components,
     * services, listeners and activities during startup (`StartUpPerformanceService.getPluginCostMap`).
     * Values are nanoseconds; startupImpactMs is their sum.
     */
    @Test
    fun t09_startupImpact() {
        val s = session
        val (plugins, markdone) = s.driver.withContext {
            val map = s.driver.service(StartUpPerformanceService::class).getPluginCostMap()
            map.size() to map.get("ch.nmeylan.markdone")?.toString()
        }
        val ns = markdone?.let { Regex("=>?(\\d+)").findAll(it).sumOf { m -> m.groupValues[1].toLong() } } ?: 0L
        log("startup plugin cost map: $plugins plugins; ch.nmeylan.markdone = ${markdone ?: "no entry"}")
        // Judged by perf-report against the budget, not asserted here.
        metric("startupImpactMs", ns / 1e6)
    }

    /**
     * Shared browser: all tabs closed, then small, medium and large open in Edit mode
     * in turn. One CDP page target for the page and one renderer process. Memory (PSS from
     * `/proc/<pid>/smaps_rollup`): `rendererPss3DocsMB` = the renderer process of the
     * page; `jcefTotalPss3DocsMB` (not budgeted) = all JCEF child processes with `--type=`
     * (renderer, GPU, utility, zygote); the browser process (the IDE JVM in-process, `cef_server`
     * out-of-process) is not counted and is logged apart.
     */
    @Test
    fun t10_sharedBrowserOneRendererFor3Docs() {
        val s = session
        s.closeAll()
        Thread.sleep(3_000)
        fun snapshot(label: String): List<IdeSession.JcefProcess> {
            val ps = s.jcefProcesses()
            log("JCEF processes $label: " + ps.joinToString("; ") { "${it.type} ${it.pid} ${it.pssKb / 1024} MB" })
            return ps
        }
        fun pss(ps: List<IdeSession.JcefProcess>, types: Set<String>) = ps.filter { it.type in types }.sumOf { it.pssKb } / 1024.0
        val children = setOf("renderer", "gpu-process", "utility", "zygote")
        val renderer = setOf("renderer")
        val steps = mutableListOf(pss(snapshot("with the page and no document"), renderer))
        for (f in listOf("three/small.md", "three/medium.md", "three/large.md")) {
            s.openInEdit(f)
            Thread.sleep(2_000)
            steps += pss(snapshot("after $f"), renderer)
        }
        val ps = s.jcefProcesses()
        val targets = s.cdp.targets()
        val pageTargets = targets.filter { (type, url) -> type == "page" && url.startsWith("https://markdone.local/app/") }
        val docIds = s.cdp.eval("window.markdone.__debug.docIds()").jsonArray.size
        val renderers = ps.filter { it.type == "renderer" }
        log("CDP targets: $targets; page documents: $docIds; renderers: ${renderers.map { it.pid }}")
        log("renderer PSS MB with 0..3 documents: ${steps.joinToString { "%.1f".format(it) }}; " +
            "all JCEF children: %.1f; browser process (cef_server): %.1f".format(pss(ps, children), pss(ps, setOf("cef_server"))))
        metric("rendererPss3DocsMB", pss(ps, renderer))
        metric("jcefTotalPss3DocsMB", pss(ps, children))
        metric("rendererPssPageNoDocMB", steps[0])
        metric("rendererPssPerDocSmallMB", steps[1] - steps[0])
        metric("rendererPssPerDocMediumMB", steps[2] - steps[1])
        metric("rendererPssPerDocLargeMB", steps[3] - steps[2])
        assertEquals("CDP page targets for the page", 1, pageTargets.size)
        assertEquals("documents in the page", 3, docIds)
        assertEquals("renderer processes", 1, renderers.size)
    }

    /**
     * Tab switch between the 3 Edit documents of t10 (FileEditorManager.openFile through the Driver),
     * 101 counted switches (>= 100 samples; the first switch is not counted).
     * tabSwitchMs = p95 of the plugin's own `tabSwitchMs` line (TabSwitchPerfListener: editor
     * selection event → `activated` received, IDE clock).
     * Cross-check (`tabSwitchHoldMs`): the same switches also give a `toggleToActivatedMs` line from
     * `WebEditor.markToggle()` put next to the selection event: a Driver call blocks the EDT for
     * [EDT_HOLD_MS]; meanwhile `markToggle()` and then `openFile()` (both EDT calls, from two
     * threads, [QUEUE_GAP_MS] apart) wait in the EDT queue and run one after the other (calibrated
     * gap: `tabSwitchQueueGapMs`). The test also checks that the switches keep one page and one renderer.
     */
    @Test
    fun t11_tabSwitch() {
        val s = session
        val files = listOf("three/small.md", "three/medium.md", "three/large.md")
        for (f in files) {
            s.open(f)
            if (s.layout(f) != "SHOW_PREVIEW") s.openInEdit(f)
        }
        /*
         * Calibration: two EDT calls queued the same way as markToggle() and openFile() below; the
         * IDE-clock gap between them is the part of the JMX gap that is still in the value.
         */
        val gaps = (1..10).map {
            val clock = s.driver.utility(SystemStatics::class)
            var first = 0L
            val hold = Thread { s.driver.withContext(OnDispatcher.EDT) { s.driver.utility(ThreadStatics::class).sleep(EDT_HOLD_MS) } }
            val mark = Thread { first = s.driver.withContext(OnDispatcher.EDT) { clock.nanoTime() } }
            hold.start()
            Thread.sleep(QUEUE_GAP_MS)
            mark.start()
            Thread.sleep(QUEUE_GAP_MS)
            val second = s.driver.withContext(OnDispatcher.EDT) { clock.nanoTime() }
            hold.join()
            mark.join()
            (second - first) / 1e6
        }
        log("queued EDT calls: IDE-clock gap ms ${gaps.joinToString { "%.2f".format(it) }}")
        metric("tabSwitchQueueGapMs", Metrics.median(gaps))
        val total = mutableListOf<Double>()
        val pluginValues = mutableListOf<Double>()
        val pageCounts = mutableListOf<String>()
        for (i in 0..TAB_SWITCHES) {
            val f = files[i % 3]
            val name = Path.of(f).fileName.toString()
            val before = s.activatedCount(name)
            val switchesBefore = s.perfValues("tabSwitchMs", name).size
            val web = s.driver.withContext { s.driver.cast(s.mdEditor(f).getPreviewEditor(), WebEditor::class) }
            val hold = Thread { s.driver.withContext(OnDispatcher.EDT) { s.driver.utility(ThreadStatics::class).sleep(EDT_HOLD_MS) } }
            val mark = Thread { s.driver.withContext(OnDispatcher.EDT) { web.markToggle() } }
            hold.start()
            Thread.sleep(QUEUE_GAP_MS)
            mark.start()
            Thread.sleep(QUEUE_GAP_MS)
            s.open(f)
            hold.join()
            mark.join()
            val ms = try {
                s.waitActivated(name, before, 10_000)
            } catch (e: AssertionError) {
                throw AssertionError("switch $i to $f: ${e.message}; CDP pages: ${s.cdp.pages()}; " +
                    "renderers: ${s.jcefProcesses().count { it.type == "renderer" }}", e)
            }
            Thread.sleep(100)
            val pages = s.cdp.targets().count { (type, url) -> type == "page" && url.startsWith("https://markdone.local/app/") }
            val renderers = s.jcefProcesses().count { it.type == "renderer" }
            if (pages != 1 || renderers != 1) pageCounts += "switch $i to $f: $pages pages, $renderers renderers"
            if (i > 0) {
                // The first switch can be to the tab that is already selected.
                total += ms.toDouble()
                val plugin = E2e.waitFor("tabSwitchMs line for switch $i to $f", 5_000, 20) { s.perfValues("tabSwitchMs", name).getOrNull(switchesBefore) }
                pluginValues += plugin.toDouble()
            }
        }
        log("tab switch plugin tabSwitchMs (${pluginValues.size}): ${pluginValues.joinToString { "%.0f".format(it) }}")
        log("tab switch toggleToActivatedMs with the EDT hold (${total.size}): ${total.joinToString { "%.0f".format(it) }}")
        log("switches with more than one page or renderer: ${pageCounts.size}/${TAB_SWITCHES + 1}: ${pageCounts.take(6)}")
        metric("tabSwitchMs", Metrics.p95(pluginValues))
        metric("tabSwitchMedianMs", Metrics.median(pluginValues))
        metric("tabSwitchHoldMs", Metrics.p95(total))
        metric("tabSwitchHoldMedianMs", Metrics.median(total))
        assertEquals("tab switches keep one page and one renderer", emptyList<String>(), pageCounts)
    }

    /**
     * Typing in the real page (java.awt.Robot keys, OS-level). keystrokeToDocumentMs = page
     * keydown (capture listener) → page receives the `ack` of the patch with that key (the IDE
     * sends `ack` after the `Document` change). Keys are 150 ms apart: one patch per key.
     * [TYPED_KEYS] keys (>= 100 samples).
     */
    @Test
    fun t12_typingReachesDocument() {
        val s = session
        val file = "typing.md"
        s.ensureEdit(file)
        val before = s.documentText(file)
        val at = before.indexOf('\n')
        focusPage(file)
        s.setPageSelection(at)
        installRecorder()
        s.cdp.eval("window.__e2e.keys.length = 0, window.__e2e.acks.length = 0")
        val typed = StringBuilder()
        repeat(TYPED_KEYS) { i ->
            s.press(KeyEvent.VK_A + i % 10)
            typed.append('a' + i % 10)
            Thread.sleep(150)
        }
        val expected = before.substring(0, at) + typed + before.substring(at)
        try {
            E2e.waitFor("Document has the typed text", 5_000) { true.takeIf { s.documentText(file) == expected } }
        } catch (e: AssertionError) {
            throw AssertionError("${e.message}; first line now: '${s.documentText(file).substringBefore('\n')}'", e)
        }
        s.waitPageEqualsDocument(file)
        val keys = s.cdp.eval("window.__e2e.keys").jsonArray.map { it.jsonArray[0].jsonPrimitive.double }
        val acks = s.cdp.eval("window.__e2e.acks").jsonArray.map { it.jsonArray[0].jsonPrimitive.double }
        val values = keys.mapNotNull { k -> acks.firstOrNull { it >= k }?.minus(k) }
        log("keydowns ${keys.size}, acks ${acks.size}; keydown -> ack ms: ${values.joinToString { "%.1f".format(it) }}")
        assertEquals("keydowns seen by the page", TYPED_KEYS, keys.size)
        log("keystrokeToDocumentMs samples: ${values.size}")
        metric("keystrokeToDocumentMs", Metrics.p95(values))
        metric("keystrokeToDocumentMedianMs", Metrics.median(values))
        val apply = s.perfValues("patchApplyMs", file)
        if (apply.isNotEmpty()) metric("patchApplyEdtMs", Metrics.p95(apply.map { it.toDouble() }))
        log("patchApplyMs (integer ms) for $file: $apply")
    }

    /** IDE edits (one write command through the Driver) reach the page: active document, then inactive + activate. */
    @Test
    fun t13_externalChange() {
        val s = session
        val file = "external.md"
        val docId = s.ensureEdit(file)
        s.writeCommand(file) { it.insertString(10, "EXT-ONE ") }
        s.waitPageEqualsDocument(file)
        s.writeCommand(file) { it.deleteString(0, 2) }
        s.writeCommand(file) { it.insertString(it.getTextLength(), "\nEXT-END\n") }
        s.waitPageEqualsDocument(file)
        log("active document: page = Document after 3 external commands")
        // Inactive: another Edit tab is selected (Edit -> Edit tab switch).
        s.ensureEdit("typing.md")
        assertTrue("external.md is inactive in the page", s.activeDocId() != docId)
        s.writeCommand(file) { it.insertString(5, "EXT-INACTIVE ") }
        s.writeCommand(file) { it.deleteString(20, 30) }
        val expected = s.documentText(file)
        s.open(file)
        E2e.waitFor("$file active", 5_000) { true.takeIf { s.activeDocId() == docId } }
        assertEquals(expected, s.waitPageEqualsDocument(file))
        Thread.sleep(500)
        assertEquals("no echo: Document unchanged after the page took the changes", expected, s.documentText(file))
        checkZeroChanges(docId, file)
    }

    /**
     * Undo/redo with a non-empty IDE undo stack: two typing groups in the page ("xyz", then
     * "uvw" after > 1 s; each group is one page transaction, so an IDE stall cannot split it), then Ctrl+Z, Ctrl+Shift+Z, Ctrl+Z, Ctrl+Y ×3 (Robot). Each key must undo or
     * redo exactly one group (a double undo would also remove "xyz"); the page caret is at the end
     * of the changed range. Ctrl+Z/Ctrl+Shift+Z go through the IDE actions PageUndo/PageRedo (the
     * page does not see the key); Ctrl+Y reaches the page (`command redo`).
     * The plugin's `undoRoundTripMs` lines (undo/redo start → `change` sent) are logged here;
     * the budget value (>= 100 samples) comes from t27.
     */
    @Test
    fun t14_undoRedo() {
        val s = session
        val file = "undo.md"
        s.ensureEdit(file)
        val original = s.documentText(file)
        val at = original.indexOf('\n')
        focusPage(file)
        s.setPageSelection(at)
        typeInPage(at, "xyz")
        val one = original.substring(0, at) + "xyz" + original.substring(at)
        E2e.waitFor("'xyz' in Document", 5_000) { true.takeIf { s.documentText(file) == one } }
        Thread.sleep(1_300) // new undo group
        typeInPage(at + 3, "uvw")
        val two = original.substring(0, at) + "xyzuvw" + original.substring(at)
        E2e.waitFor("'uvw' in Document", 5_000) { true.takeIf { s.documentText(file) == two } }
        s.waitPageEqualsDocument(file)
        Thread.sleep(1_300)
        installRecorder()
        val before = s.perfValues("undoRoundTripMs", file).size
        val pageTrips = mutableListOf<Double>()
        val problems = mutableListOf<String>()
        fun step(label: String, keys: IntArray, text: String, caret: Int) {
            s.cdp.eval("window.__e2e.keys.length = 0, window.__e2e.changes.length = 0")
            val lines = s.perfValues("undoRoundTripMs", file).size
            s.press(*keys)
            try {
                waitDocument(file, text, label)
            } catch (e: AssertionError) {
                throw AssertionError("${e.message}; ${undoDiagnostics(file)}", e)
            }
            s.waitPageEqualsDocument(file)
            Thread.sleep(400)
            // Exactly one step: the text is still the expected one after the key is handled.
            if (s.documentText(file) != text) problems += "$label: Document changed again (double undo/redo)"
            val selection = s.pageSelection()
            if (selection != caret to caret) problems += "$label: caret expected ($caret, $caret), page has $selection"
            val trip = s.cdp.eval(
                "(() => { const k = window.__e2e.keys.find((x) => x[2]); const c = k && window.__e2e.changes.find((x) => x[2] && x[0] >= k[0]); " +
                    "return c ? c[0] - k[0] : null; })()",
            )
            (trip as? JsonPrimitive)?.takeIf { it.content != "null" }?.let { pageTrips += it.double }
            val newLines = s.perfValues("undoRoundTripMs", file).size - lines
            if (newLines != 1) problems += "$label: $newLines undoRoundTripMs lines"
            log("$label: page keydowns ${s.cdp.eval("window.__e2e.keys.map((k) => k[1])")}, changes with selection " +
                "${s.cdp.eval("window.__e2e.changes.filter((c) => c[2]).length")}, undoRoundTripMs lines $newLines, page selection $selection")
        }
        repeat(3) {
            step("undo Ctrl+Z", intArrayOf(KeyEvent.VK_CONTROL, KeyEvent.VK_Z), one, at + 3)
            step("redo Ctrl+Shift+Z", intArrayOf(KeyEvent.VK_CONTROL, KeyEvent.VK_SHIFT, KeyEvent.VK_Z), two, at + 6)
            step("undo Ctrl+Z", intArrayOf(KeyEvent.VK_CONTROL, KeyEvent.VK_Z), one, at + 3)
            step("redo Ctrl+Y", intArrayOf(KeyEvent.VK_CONTROL, KeyEvent.VK_Y), two, at + 6)
        }
        val ide = s.perfValues("undoRoundTripMs", file).drop(before)
        log("undoRoundTripMs (perf log, integer ms): $ide; page modifier keydown -> change with selection received ms: ${pageTrips.joinToString { "%.1f".format(it) }}")
        if (pageTrips.isNotEmpty()) metric("undoRoundTripPageMs", Metrics.p95(pageTrips))
        assertEquals("undo/redo problems", emptyList<String>(), problems)
    }

    /** Types [text] at [pos] in the page as one user transaction (as one keystroke), caret after it. */
    private fun typeInPage(pos: Int, text: String) {
        session.cdp.eval(
            "(() => { const v = $VIEW_JS; v.dispatch({ changes: { from: $pos, insert: '$text' }, selection: { anchor: ${pos + text.length} }, " +
                "userEvent: 'input.type' }); return true; })()",
        )
    }

    /**
     * IDE context menu: right-click (Robot) on a selection in the page → the
     * `markdone.EditContextMenu` popup (found through `MenuSelectionManager`), no Chromium menu.
     * Copy, Paste and Cut through the menu items (Robot clicks).
     */
    @Test
    fun t15_contextMenu() {
        val s = session
        platformMenuOffset = platformEditorMenuOffset()
        log("platform editor context menu: popup - click = $platformMenuOffset px")
        val file = "menu.md"
        s.ensureEdit(file)
        val browser = previewComponent(file)
        val doc = s.documentText(file)
        installRecorder()

        // Copy "Project notes" of "# Project notes".
        val copyFrom = doc.indexOf("Project notes")
        clickItem(openMenu(browser, copyFrom, copyFrom + "Project notes".length), "Copy")
        E2e.waitFor("clipboard after menu Copy = 'Project notes' (now '${s.clipboardText()}')", 3_000) {
            true.takeIf { s.clipboardText() == "Project notes" }
        }

        // Cut "usual Markdown".
        val cutFrom = doc.indexOf("usual Markdown")
        clickItem(openMenu(browser, cutFrom, cutFrom + "usual Markdown".length), "Cut")
        val afterCut = doc.removeRange(cutFrom, cutFrom + "usual Markdown".length)
        E2e.waitFor("Document after menu Cut", 3_000) { true.takeIf { s.documentText(file) == afterCut } }
        s.waitPageEqualsDocument(file)
        assertEquals("clipboard after menu Cut", "usual Markdown", s.clipboardText())

        // Paste over "short document".
        s.setClipboard("PASTED **text**")
        val pasteFrom = afterCut.indexOf("short document")
        clickItem(openMenu(browser, pasteFrom, pasteFrom + "short document".length), "Paste")
        val afterPaste = afterCut.replaceRange(pasteFrom, pasteFrom + "short document".length, "PASTED **text**")
        E2e.waitFor("Document after menu Paste", 3_000) { true.takeIf { s.documentText(file) == afterPaste } }
        s.waitPageEqualsDocument(file)

        val prevented = s.cdp.eval("window.__e2e.contextMenus").jsonArray.map { it.jsonArray[0].jsonPrimitive.boolean }
        log("page contextmenu events, defaultPrevented: $prevented")
        assertTrue("page prevents Chromium's menu", prevented.isNotEmpty() && prevented.all { it })
        assertEquals("popup at the page's contextmenu point + platform menu offset (within 4 px)", emptyList<String>(), menuPositions)
    }

    /** Ctrl+C, Ctrl+X, Ctrl+V in the page (Robot): CodeMirror and Chromium use the system clipboard; the IDE reads it. */
    @Test
    fun t16_clipboardByKeyboard() {
        val s = session
        val file = "menu.md"
        s.ensureEdit(file)
        focusPage(file)
        val doc = s.documentText(file)
        val from = doc.indexOf("## Setup")
        s.setClipboard("before Ctrl+C")
        s.setPageSelection(from, from + "## Setup".length)
        s.press(KeyEvent.VK_CONTROL, KeyEvent.VK_C)
        E2e.waitFor("clipboard after Ctrl+C = '## Setup'", 3_000) { true.takeIf { s.clipboardText() == "## Setup" } }

        val cutFrom = doc.indexOf("Install the tools")
        s.setPageSelection(cutFrom, cutFrom + "Install the tools".length)
        s.press(KeyEvent.VK_CONTROL, KeyEvent.VK_X)
        val afterCut = doc.removeRange(cutFrom, cutFrom + "Install the tools".length)
        E2e.waitFor("Document after Ctrl+X", 3_000) { true.takeIf { s.documentText(file) == afterCut } }
        E2e.waitFor("clipboard after Ctrl+X = 'Install the tools'", 3_000) { true.takeIf { s.clipboardText() == "Install the tools" } }

        s.setClipboard("KEY-PASTE")
        s.setPageSelection(cutFrom)
        s.press(KeyEvent.VK_CONTROL, KeyEvent.VK_V)
        val afterPaste = afterCut.substring(0, cutFrom) + "KEY-PASTE" + afterCut.substring(cutFrom)
        E2e.waitFor("Document after Ctrl+V", 3_000) { true.takeIf { s.documentText(file) == afterPaste } }
        s.waitPageEqualsDocument(file)
    }

    /** Edit → Source → Edit keeps the page text and the page selection. */
    @Test
    fun t17_modeSwitchKeepsTextAndSelection() {
        val s = session
        val file = "menu.md"
        s.ensureEdit(file)
        val doc = s.documentText(file)
        val anchor = doc.indexOf("## Features") + 3
        s.setPageSelection(anchor, anchor + 5)
        repeat(2) {
            val n = s.activatedCount(file)
            s.toggle(file)
            s.waitLayout(file, "SHOW_EDITOR")
            s.toggle(file)
            s.waitActivated(file, n)
            assertEquals("text after Edit -> Source -> Edit", doc, s.waitPageEqualsDocument(file))
            assertEquals("selection after Edit -> Source -> Edit", anchor to anchor + 5, s.pageSelection())
        }
    }

    /**
     * Length check (protocol 2.1): the recorder adds one character to the next IDE `change` the
     * page receives, so the page text no longer matches the `length` in that change. The page must
     * send `diverged`, the IDE `reload`, and the page must then show the `Document` text again.
     */
    @Test
    fun t18_divergedReloads() {
        val s = session
        val file = "diverge.md"
        val docId = s.ensureEdit(file)
        installRecorder()
        s.cdp.eval("window.__e2e.corrupt = ${js(docId)}, window.__e2e.reloads.length = 0")
        s.writeCommand(file) { it.insertString(10, "IDE-EDIT ") }
        val expected = s.documentText(file)
        E2e.waitFor("reload of $file after the corrupted change", 5_000, 100) {
            true.takeIf { s.cdp.eval("window.__e2e.reloads.filter((x) => x[1] === ${js(docId)}).length").jsonPrimitive.int > 0 }
        }
        assertEquals("corrupted changes", 1, s.cdp.eval("window.__e2e.corrupted").jsonPrimitive.int)
        assertEquals("page text after reload", expected, s.waitPageEqualsDocument(file))
        Thread.sleep(500)
        assertEquals("Document not changed by the page", expected, s.documentText(file))
        checkZeroChanges(docId, file)
        // Still in sync: one more IDE edit reaches the page.
        s.writeCommand(file) { it.insertString(0, "AFTER ") }
        s.waitPageEqualsDocument(file)
    }

    /**
     * Renderer crash: SIGKILL to the JCEF renderer process (a child of this sandbox IDE only).
     * The IDE creates a new browser; the page opens the documents again; no `Document` changes.
     */
    @Test
    fun t19_rendererCrashRecovery() {
        val s = session
        val file = "menu.md"
        s.ensureEdit(file)
        val files = listOf("menu.md", "three/small.md", "three/medium.md", "three/large.md", "typing.md", "external.md", "undo.md", "diverge.md")
        val stamps = files.associateWith { s.documentStamp(it) }
        val docIds = s.cdp.eval("window.markdone.__debug.docIds()").jsonArray.map { it.jsonPrimitive.content }.toSet()
        val renderers = s.jcefProcesses().filter { it.type == "renderer" }
        log("killing renderer(s) ${renderers.map { it.pid }}; page documents: ${docIds.size}")
        assertTrue("a renderer process", renderers.isNotEmpty())
        // Records the requests of the new browser: the page load with its CSP header.
        val watch = s.cdp.watch()
        val t0 = System.nanoTime()
        try {
            for (r in renderers) ProcessHandle.of(r.pid).ifPresent { it.destroyForcibly() }
            E2e.waitFor("new renderer and page with the same documents", 30_000, 200) {
                val alive = s.jcefProcesses().filter { it.type == "renderer" }.map { it.pid }
                true.takeIf {
                    alive.isNotEmpty() && alive.none { p -> renderers.any { it.pid == p } } && s.cdp.pages() == listOf(Cdp.PAGE_URL) &&
                        s.cdp.eval("window.markdone.__debug.docIds()").jsonArray.map { it.jsonPrimitive.content }.toSet() == docIds
                }
            }
            s.waitPageEqualsDocument(file, 10_000)
            metric("rendererCrashRecoveryMs", (System.nanoTime() - t0) / 1e6)
        } finally {
            Thread.sleep(300)
            val requests = checkRequests(watch.stop(), "requests-recovery-$mode.json")
            val csp = header(requests, "/app/index.html", "content-security-policy")
            log("CSP header of the page loaded again: $csp")
            assertTrue("CSP header on index.html", csp != null && "default-src 'none'" in csp && "script-src https://markdone.local/app/" in csp)
            assertTrue("X-Markdone-Stamp on /doc", header(requests, "/doc/", "x-markdone-stamp")?.toLongOrNull() != null)
        }
        Thread.sleep(500)
        assertEquals("Document stamps unchanged", stamps, files.associateWith { s.documentStamp(it) })
        checkZeroChanges(s.activeDocId(), file)
    }

    /**
     * Live preview on `styles/live-preview.md`: the stable classes on
     * inactive lines (one sample line per construct), no `.md-marker` on inactive lines (the front
     * matter fences are always markers: the block is source), and all markers visible on the caret line only. Three caret places: a blank line, the inline-styles
     * line, a heading line.
     */
    @Test
    fun t20_livePreviewClassesAndCaretLineMarkers() {
        val s = session
        val file = "m2/live-preview.md"
        val docId = s.ensureEdit(file)
        focusPage(file)
        val problems = mutableListOf<String>()
        for (caret in listOf("", INLINE_LINE, "# Heading 1")) {
            val r = s.cdp.eval("($LIVE_PREVIEW_CHECK)(${js(caret)}, ${js(INLINE_LINE)})").jsonObject
            val caretLine = r["caret"]!!.jsonPrimitive.int
            val markerLines = r["markerLines"]!!.jsonArray.map { it.jsonPrimitive.int }
            val failures = r["failures"]!!.jsonArray.map { it.jsonPrimitive.content }
            log("live preview, caret on line $caretLine ('$caret'): marker lines $markerLines, caret line text '${r["caretText"]}', " +
                "markers visible ${r["markersVisible"]}, failures $failures")
            problems += failures.map { "caret '$caret': $it" }
            val expectedMarkers = if (caret.isEmpty()) emptyList() else listOf(caretLine)
            if (markerLines != expectedMarkers) problems += "caret '$caret': lines with .md-marker $markerLines, expected $expectedMarkers"
            if (caret.isNotEmpty()) {
                if (r["caretText"]!!.jsonPrimitive.content != caret) problems += "caret line shows '${r["caretText"]}', expected the source '$caret'"
                if (r["markersVisible"]!!.jsonPrimitive.content != "true") problems += "caret '$caret': a marker is not visible"
            }
        }
        // The image (data: URL, 1x1) is near the end: scrolled into view, it must load.
        val img = s.cdp.eval(
            "(async () => { const i = document.querySelector('.cm-content img.md-img'); if (!i) return 'no img.md-img'; i.scrollIntoView(); " +
                "for (let k = 0; k < 40 && !(i.complete && i.naturalWidth); k++) await new Promise((r) => setTimeout(r, 50)); " +
                "return i.complete + ' ' + i.naturalWidth; })()",
        ).jsonPrimitive.content
        if (img != "true 1") problems += "md-img: $img"
        checkZeroChanges(docId, file)
        assertEquals("live preview problems", emptyList<String>(), problems)
    }

    /**
     * Table widget buttons with the real mouse (Robot hover, then click) on the first table of
     * `styles/tables-m2.md`: "+" row (insert above row 2), "+" column (after the last column), "×"
     * (remove the new row). Each click: `Document` text = the TableEdit result (written out here),
     * page = `Document`. Then Ctrl+Z three times: each undoes exactly one action.
     */
    @Test
    fun t21_tableButtonsRoundTrip() {
        val s = session
        val file = "m2/tables.md"
        val docId = s.ensureEdit(file)
        val orig = s.documentText(file)
        val step1 = orig.replaceFirst("| [link](https://example.com)", "|  |  |  |\n| [link](https://example.com)")
        val step2 = step1
            .replaceFirst("| Name | Value | Notes |\n", "| Name | Value | Notes |  |\n")
            .replaceFirst("|:-----|------:|:-----:|\n", "|:-----|------:|:-----:| --- |\n")
            .replaceFirst("**bold** and *em* |\n", "**bold** and *em* |  |\n")
            .replaceFirst("|  |  |  |\n", "|  |  |  |  |\n")
            .replaceFirst("~~old~~ 2 | |\n", "~~old~~ 2 | |  |\n")
            .replaceFirst("| extra | 4 | x | dropped |", "| extra | 4 | x |  | dropped |")
        val step3 = step2.replaceFirst("|  |  |  |  |\n", "")
        assertTrue("expected texts differ", setOf(orig, step1, step2, step3).size == 4)
        clickTableButton(file, """button[data-kind="addRow"][data-index="2"]""", step1, "+ row above row 2")
        clickTableButton(file, """button[data-kind="addColumn"][data-index="3"]""", step2, "+ column after the last")
        clickTableButton(file, """button[data-kind="removeRow"][data-index="2"]""", step3, "× row 2")
        focusPage(file)
        for ((label, text) in listOf("undo × row" to step2, "undo + column" to step1, "undo + row" to orig)) {
            s.press(KeyEvent.VK_CONTROL, KeyEvent.VK_Z)
            waitDocument(file, text, label)
            Thread.sleep(400)
            assertEquals("$label: one undo step (Document unchanged 400 ms later)", text, s.documentText(file))
            s.waitPageEqualsDocument(file)
        }
        log("table buttons: 3 actions and 3 undo steps, page = Document; docChanges ${s.cdp.eval("window.markdone.__debug.docChanges(${js(docId)})")}")
    }

    /**
     * Right-click (Robot) on the header cell "No" of the rendered table `Plain | No | Outer`: the
     * IDE popup has the "Table" submenu; "Align Center", then (second popup) "Reformat Table".
     */
    @Test
    fun t22_tableContextSubmenu() {
        val s = session
        val file = "m2/tables.md"
        s.ensureEdit(file)
        val orig = s.documentText(file)
        val plain = "Plain | No | Outer\n--- | --- | ---\n1 | 2 | 3"
        assertTrue("table in the file", plain in orig)
        val aligned = orig.replace(plain, "Plain | No | Outer\n--- | :-: | ---\n1 | 2 | 3")
        val reformatted = orig.replace(plain, "Plain | No  | Outer\n----- | :-: | -----\n1     |  2  | 3")
        tableMenuAction(file, "Align Center")
        waitDocument(file, aligned, "Align Center")
        s.waitPageEqualsDocument(file)
        tableMenuAction(file, "Reformat Table")
        waitDocument(file, reformatted, "Reformat Table")
        s.waitPageEqualsDocument(file)
    }

    /**
     * Ctrl+click (Robot) on text of an inactive line → Source mode, caret at that offset, text editor
     * focused (a typed key lands at the caret). Then Ctrl+Alt+Shift+W twice: Edit focuses the browser,
     * Source the text editor.
     */
    @Test
    fun t23_ctrlClickGoesToSource() {
        val s = session
        val file = "m2/goto.md"
        s.ensureEdit(file)
        val doc = s.documentText(file)
        val target = doc.indexOf(INLINE_LINE) + "Text ".length
        focusPage(file)
        s.setPageSelection(doc.indexOf("\n\n# Heading 1") + 1)
        Thread.sleep(200)
        // A point 2 px into the character at `target`: posAtCoords (as the page's handler) gives `target`.
        val p = s.cdp.eval(
            "(() => { const v = ${IdeSession.VIEW}; const c = v.coordsAtPos($target); const x = Math.round(c.left + 2), y = Math.round((c.top + c.bottom) / 2); " +
                "return [x, y, v.posAtCoords({ x, y })]; })()",
        ).jsonArray.map { it.jsonPrimitive.double }
        val pos = p[2].toInt()
        val (ox, oy) = origin(file)
        val x = (ox + p[0]).toInt()
        val y = (oy + p[1]).toInt()
        s.moveMouse(x, y)
        Thread.sleep(200)
        log("before ctrl-click: ${focusState()}")
        s.click(x, y, InputEvent.BUTTON1_DOWN_MASK, KeyEvent.VK_CONTROL)
        s.waitLayout(file, "SHOW_EDITOR")
        val editor = s.driver.withContext { s.driver.cast(s.mdEditor(file).getTextEditor(), TextEditor::class).getEditor() }
        val caret = s.driver.withContext(OnDispatcher.EDT) { editor.getCaretModel().getOffset() }
        val textFocused = { s.driver.withContext(OnDispatcher.EDT) { editor.getContentComponent().isFocusOwner() } }
        val focused = waitTrue("text editor focused", textFocused)
        log("ctrl-click at page point (${p[0]}, ${p[1]}): posAtCoords $pos (target $target); Source caret $caret; text editor focused $focused; ${focusState()}")
        if (!focused) {
            // Diagnostics: the plugin's request (IdeFocusManager.requestFocusInProject) made by the test now, then a plain one.
            s.driver.withContext(OnDispatcher.EDT) {
                s.driver.utility(IdeFocusManagerStatics::class).getInstance(s.ideProject).requestFocusInProject(editor.getContentComponent(), s.ideProject)
            }
            val byIdeFocusManager = waitTrue("focused by requestFocusInProject", textFocused)
            val byRequestFocusInWindow = byIdeFocusManager ||
                (s.driver.withContext(OnDispatcher.EDT) { editor.getContentComponent().requestFocusInWindow() } && waitTrue("focused by requestFocusInWindow", textFocused))
            log("not focused after the ctrl-click; requestFocusInProject from the test focuses: $byIdeFocusManager; requestFocusInWindow: $byRequestFocusInWindow; ${focusState()}")
        }
        // What a user sees: a typed key goes to the text editor at the caret.
        s.press(KeyEvent.VK_Q)
        Thread.sleep(500)
        val typedAtCaret = s.documentText(file).let { it.length == doc.length + 1 && it.substring(pos, pos + 1) == "q" }
        log("key 'q' after the ctrl-click: inserted at the caret $typedAtCaret")
        if (s.documentText(file) != doc) s.writeCommand(file) { it.deleteString(pos, pos + 1) }
        // The mode shortcut: Source -> Edit focuses the browser, Edit -> Source the text editor.
        s.press(KeyEvent.VK_CONTROL, KeyEvent.VK_ALT, KeyEvent.VK_SHIFT, KeyEvent.VK_W)
        s.waitLayout(file, "SHOW_PREVIEW")
        val browserFocused = waitTrue("browser focused after Source -> Edit") {
            // The focus owner is the JCEF component inside the browser panel (JBCefOsrComponent with off-screen rendering).
            s.driver.withContext(OnDispatcher.EDT) {
                s.driver.utility(KeyboardFocusManagerStatics::class).getCurrentKeyboardFocusManager().getFocusOwner()?.toString().orEmpty().startsWith("com.intellij.ui.jcef.")
            } && s.cdp.eval("document.hasFocus()").jsonPrimitive.boolean
        }
        log("Ctrl+Alt+Shift+W Source -> Edit: browser focused $browserFocused; ${focusState()}")
        s.waitPageEqualsDocument(file)
        s.press(KeyEvent.VK_CONTROL, KeyEvent.VK_ALT, KeyEvent.VK_SHIFT, KeyEvent.VK_W)
        s.waitLayout(file, "SHOW_EDITOR")
        val textFocusedAgain = waitTrue("text editor focused after Edit -> Source", textFocused)
        log("Ctrl+Alt+Shift+W Edit -> Source: text editor focused $textFocusedAgain; ${focusState()}")
        assertEquals("posAtCoords at the click point", target, pos)
        assertEquals("caret offset in Source mode", pos, caret)
        assertTrue("text editor has the focus after the ctrl-click", focused)
        assertTrue("a typed key reaches the caret after the ctrl-click", typedAtCaret)
        assertTrue("browser has the focus after Ctrl+Alt+Shift+W Source -> Edit", browserFocused)
        assertTrue("text editor has the focus after Ctrl+Alt+Shift+W Edit -> Source", textFocusedAgain)
        assertEquals("Document unchanged", doc, s.documentText(file))
    }

    /**
     * Custom CSS (UserCssService): global CSS from MdSettings; project CSS
     * `.markdone/style.css` (trusted project) with a relative `url()` that loads through
     * `/proj/<projectToken>/` (protocol 2.2) with status 200; live update after a VFS refresh (< 1 s); untrusted
     * project (TrustedProjects API) → no project CSS and the notice; trusted again → CSS back.
     * No `Document` change.
     */
    @Test
    fun t24_customCss() {
        val s = session
        val file = "cssdir/css.md"
        val docId = s.ensureEdit(file)
        val text = s.documentText(file)
        val cssDir = s.project.resolve(".markdone")
        val cssFile = cssDir.resolve("style.css")
        val problems = mutableListOf<String>()
        fun settings(block: MdSettings.() -> Unit) = s.driver.withContext(OnDispatcher.EDT) { s.driver.service(MdSettings::class).block() }
        fun trust(trusted: Boolean) = s.driver.withContext(OnDispatcher.EDT) { s.driver.utility(TrustedProjectsStatics::class).setProjectTrusted(s.ideProject, trusted) }
        fun css(): String = s.cdp.evalString("document.getElementById('user-css')?.textContent ?? ''")
        fun accent(): String = s.cdp.evalString("getComputedStyle(document.documentElement).getPropertyValue('--md-accent').trim()")
        fun projectCss(color: String) = ":root { --md-accent: $color; }\n@font-face { font-family: E2eFont; src: url(fonts/x.woff2); }\n"
        fun soft(what: String, timeoutMs: Long = 5_000, condition: () -> Boolean) = try {
            E2e.waitFor(what, timeoutMs, 100) { true.takeIf { condition() } }
            true
        } catch (e: AssertionError) {
            problems += "${e.message}; user-css: '${css().take(300)}'"
            false
        }
        val defaultAccent = accent()
        try {
            // Global CSS.
            settings { setGlobalCss(":root { --md-max-width: 543px; }") }
            soft("global CSS in #user-css and computed") {
                "543px" in css() && s.cdp.evalString(
                    "getComputedStyle(document.documentElement).getPropertyValue('--md-max-width').trim() + ' ' + getComputedStyle(document.querySelector('.cm-content')).maxWidth",
                ) == "543px 543px"
            }
            // Project CSS in a trusted project: the file appears (VFS refresh).
            cssDir.resolve("fonts").createDirectories()
            Files.write(cssDir.resolve("fonts/x.woff2"), ByteArray(64) { it.toByte() })
            cssFile.writeText(projectCss("rgb(1, 2, 3)"))
            s.driver.withContext { s.file(".markdone/style.css") }
            soft("project CSS applied") { accent() == "rgb(1, 2, 3)" }
            // Protocol 2.2: relative to the CSS file, `/proj/<projectToken>/<path>`.
            val fontUrl = Regex("""https://markdone\.local/proj/[^/"]+/fonts/x\.woff2""").find(css())?.value
            if (fontUrl == null) problems += "url() not rewritten to https://markdone.local/proj/<token>/fonts/x.woff2: '${css()}'"
            val watch = s.cdp.watch()
            var fonts: Any? = null
            var requests = JsonArray(emptyList())
            try {
                fonts = s.cdp.eval("document.fonts.load('16px E2eFont').then((f) => 'loaded ' + f.length, (e) => 'error ' + e)")
                Thread.sleep(500)
            } finally {
                Thread.sleep(200)
                requests = watchStopToReport(watch, "requests-css-$mode.json")
            }
            val font = requests.map { it.jsonObject }.firstOrNull { "x.woff2" in it["url"]!!.jsonPrimitive.content }
            log("font request: $font; document.fonts.load: $fonts")
            if (font == null) problems += "no request for x.woff2"
            else if (font["url"]!!.jsonPrimitive.content != fontUrl || font["status"]?.jsonPrimitive?.content != "200") problems += "font request $font (url() $fontUrl)"
            // Live update: edit on disk + VFS refresh -> page within 1 s.
            s.cdp.eval(
                "(() => { window.__e2eCssAt = null; const check = () => { if (window.__e2eCssAt === null && " +
                    "(document.getElementById('user-css')?.textContent ?? '').includes('rgb(40, 50, 60)')) window.__e2eCssAt = Date.now(); }; " +
                    "new MutationObserver(check).observe(document.documentElement, { subtree: true, childList: true, characterData: true }); check(); return true; })()",
            )
            cssFile.writeText(projectCss("rgb(40, 50, 60)"))
            val t0 = System.currentTimeMillis()
            s.refresh(".markdone/style.css")
            val at = try {
                E2e.waitFor("page has the edited project CSS", 5_000, 50) { s.cdp.eval("window.__e2eCssAt").jsonPrimitive.content.toDoubleOrNull() }
            } catch (e: AssertionError) {
                problems += e.message.orEmpty()
                null
            }
            at?.let {
                val ms = it - t0
                log("project CSS live update: refresh -> #user-css changed in %.0f ms".format(ms))
                metric("projectCssLiveUpdateMs", ms)
                if (ms > 1_000) problems += "project CSS live update took $ms ms (> 1000)"
            }
            if (accent() != "rgb(40, 50, 60)") problems += "computed --md-accent after the edit: ${accent()}"
            // Untrusted project: idea.trust.all.projects (set by IdeSession) is turned off first.
            s.driver.withContext { s.driver.utility(SystemStatics::class).setProperty("idea.trust.all.projects", "false") }
            trust(false)
            val trusted = s.driver.withContext { s.driver.utility(TrustedProjectsStatics::class).isProjectTrusted(s.ideProject) }
            log("project trusted after setProjectTrusted(false): $trusted")
            assertTrue("project untrusted", !trusted)
            cssFile.writeText(projectCss("rgb(7, 8, 9)"))
            s.refresh(".markdone/style.css")
            soft("untrusted: project CSS removed, global CSS kept") { "E2eFont" !in css() && "543px" in css() && accent() == defaultAccent }
            soft("untrusted: notice in the Edit view") { projectCssNotice(file) }
            // Trusted again: TrustedProjectsListener -> the project CSS comes back, the notice goes.
            trust(true)
            soft("trusted again: project CSS applied") { accent() == "rgb(7, 8, 9)" }
            soft("trusted again: no notice") { !projectCssNotice(file) }
        } finally {
            s.driver.withContext { s.driver.utility(SystemStatics::class).setProperty("idea.trust.all.projects", "true") }
            trust(true)
            settings { setGlobalCss("") }
            cssDir.toFile().deleteRecursively()
            s.refresh("", recursive = true)
        }
        soft("CSS removed") { css().isBlank() || ("543px" !in css() && "E2eFont" !in css()) }
        assertEquals("Document unchanged", text, s.documentText(file))
        checkZeroChanges(docId, file)
        assertEquals("custom CSS problems", emptyList<String>(), problems)
    }

    /** Local images (`/file/`): `img/a.png` and `../shared/b.png` (in the project) load (200); a file outside the project → 404. */
    @Test
    fun t25_localImages() {
        val s = session
        val file = "pics/page.md"
        val watch = s.cdp.watch()
        var report: JsonArray? = null
        val images = try {
            s.ensureEdit(file)
            E2e.waitFor("3 images settled", 10_000, 200) {
                s.cdp.eval("[...document.querySelectorAll('.cm-content img.md-img')].map((i) => [i.getAttribute('src'), i.complete, i.naturalWidth])").jsonArray
                    .takeIf { a -> a.size == 3 && a.all { it.jsonArray[1].jsonPrimitive.boolean } }
            }
        } finally {
            Thread.sleep(300)
            report = watchStopToReport(watch, "requests-images-$mode.json")
        }
        log("images (src, complete, naturalWidth): $images")
        val requests = report!!.map { it.jsonObject }
        fun status(suffix: String) = requests.lastOrNull { it["url"]!!.jsonPrimitive.content.endsWith(suffix) }?.get("status")?.jsonPrimitive?.content
        val statuses = listOf("/img%2Fa.png", "/..%2Fshared%2Fb.png", "/..%2F..%2Foutside.png").associateWith { status(it) }
        log("image request statuses: $statuses")
        assertEquals("requests outside https://markdone.local/", emptyList<String>(),
            requests.map { it["url"]!!.jsonPrimitive.content }.filterNot { it.startsWith("https://markdone.local/") })
        assertEquals(mapOf("/img%2Fa.png" to "200", "/..%2Fshared%2Fb.png" to "200", "/..%2F..%2Foutside.png" to "404"), statuses)
        val widths = images.map { it.jsonArray[2].jsonPrimitive.int }
        assertTrue("a.png and b.png decoded, outside.png not: $widths", widths[0] > 0 && widths[1] > 0 && widths[2] == 0)
    }

    /**
     * Remote images: off (default) → placeholder, no request; on → the page loads again with
     * `https:` in the CSP `img-src` and the page requests the image (it may fail offline: only the
     * request is checked); off again → CSP without `https:`, placeholder, no request.
     */
    @Test
    fun t26_remoteImages() {
        val s = session
        val file = "remote/remote.md"
        val url = "https://example.com/x.png"
        fun remote(on: Boolean) = s.driver.withContext(OnDispatcher.EDT) { s.driver.service(MdSettings::class).setRemoteImages(on) }
        fun placeholder() = s.cdp.evalString("document.querySelector('.cm-content .md-img-placeholder')?.textContent ?? ''") == url
        fun remoteImg() = s.cdp.eval("!!document.querySelector('.cm-content img.md-img[src=\"$url\"]')").jsonPrimitive.boolean
        /** The requests while [action] runs (and 300 ms after it), also saved to requests-remote-<label>-<mode>.json. */
        fun watched(label: String, action: () -> Unit): List<kotlinx.serialization.json.JsonObject> {
            val watch = s.cdp.watch()
            var requests = JsonArray(emptyList())
            try {
                action()
            } finally {
                Thread.sleep(300)
                requests = watchStopToReport(watch, "requests-remote-$label-$mode.json")
            }
            return requests.map { it.jsonObject }
        }
        var docId = ""
        val off = watched("off") {
            docId = s.ensureEdit(file)
            E2e.waitFor("placeholder with the URL", 5_000) { true.takeIf { placeholder() } }
            Thread.sleep(500)
        }
        assertEquals("setting off: no remote request", emptyList<String>(), off.map { it["url"]!!.jsonPrimitive.content }.filterNot { it.startsWith("https://markdone.local/") })
        fun reloadWith(on: Boolean) = watched(if (on) "on" else "off-again") {
            remote(on)
            E2e.waitFor("page loaded again with remote images ${if (on) "on" else "off"}", 20_000, 200) {
                true.takeIf { s.activeDocId() == docId && (if (on) remoteImg() else placeholder()) }
            }
            Thread.sleep(if (on) 1_500 else 500)
        }
        val on = try {
            reloadWith(true)
        } catch (e: Throwable) {
            remote(false)
            throw e
        }
        val cspOn = header(on, "/app/index.html", "content-security-policy")
        val image = on.firstOrNull { it["url"]!!.jsonPrimitive.content == url }
        log("remote images on: CSP $cspOn; image request $image")
        s.waitPageEqualsDocument(file)
        val offAgain = reloadWith(false)
        val cspOff = header(offAgain, "/app/index.html", "content-security-policy")
        log("remote images off again: CSP $cspOff")
        s.waitPageEqualsDocument(file)
        checkZeroChanges(docId, file)
        assertTrue("CSP img-src with https: when on: $cspOn", cspOn != null && "img-src https://markdone.local/ data: https:;" in cspOn)
        assertTrue("the page requested $url when on", image != null)
        assertTrue("CSP img-src without https: when off: $cspOff", cspOff != null && "img-src https://markdone.local/ data:;" in cspOff)
        assertEquals("setting off again: no remote request", emptyList<String>(),
            offAgain.map { it["url"]!!.jsonPrimitive.content }.filterNot { it.startsWith("https://markdone.local/") })
    }

    /**
     * Undo round trip with >= 100 samples: one typing group, then Ctrl+Z and
     * Ctrl+Shift+Z alternately ([UNDO_STEPS] keys, Robot). Value = p95 of the plugin's
     * `undoRoundTripMs` lines (flush + undo/redo + `change` sent, IDE clock).
     */
    @Test
    fun t27_undoRedoTiming() {
        val s = session
        val file = "undo-timing.md"
        s.ensureEdit(file)
        val original = s.documentText(file)
        val at = original.indexOf('\n')
        focusPage(file)
        s.setPageSelection(at)
        for (c in listOf(KeyEvent.VK_A, KeyEvent.VK_B, KeyEvent.VK_C)) s.press(c)
        val typed = original.substring(0, at) + "abc" + original.substring(at)
        waitDocument(file, typed, "typed 'abc'")
        Thread.sleep(1_300)
        val before = s.perfValues("undoRoundTripMs", file).size
        repeat(UNDO_STEPS) { i ->
            val undo = i % 2 == 0
            if (undo) s.press(KeyEvent.VK_CONTROL, KeyEvent.VK_Z) else s.press(KeyEvent.VK_CONTROL, KeyEvent.VK_SHIFT, KeyEvent.VK_Z)
            try {
                E2e.waitFor<Boolean>("step $i (${if (undo) "undo" else "redo"})", 5_000, 10) { true.takeIf { s.documentText(file) == if (undo) original else typed } }
            } catch (e: AssertionError) {
                throw AssertionError("${e.message}; ${undoDiagnostics(file)}; ${focusState()}; page focus ${s.cdp.eval("document.hasFocus()")}", e)
            }
        }
        s.waitPageEqualsDocument(file)
        val values = E2e.waitFor("$UNDO_STEPS undoRoundTripMs lines", 5_000) {
            s.perfValues("undoRoundTripMs", file).drop(before).takeIf { it.size >= UNDO_STEPS }
        }.map { it.toDouble() }
        log("undoRoundTripMs (${values.size}): ${values.joinToString { "%.0f".format(it) }}")
        assertEquals("one undoRoundTripMs line per key", UNDO_STEPS, values.size)
        metric("undoRoundTripMs", Metrics.p95(values))
        metric("undoRoundTripMedianMs", Metrics.median(values))
    }

    /**
     * Table on a list-marker line (`styles/tables-edge.md`, TableEdit follows Lezer): "+" column
     * after the last column (Robot) keeps the prefix of each line (`- ` on the first, two spaces on
     * the others); Ctrl+Z undoes it in one step.
     */
    @Test
    fun t28_tableButtonOnListMarkerTable() {
        val s = session
        val file = "m2/tables-edge.md"
        s.ensureEdit(file)
        val orig = s.documentText(file)
        val table = "- | a | b |\n  |---|---|\n  | 1 | 2 |\n"
        assertTrue("list-marker table in the file", table in orig)
        val expected = orig.replace(table, "- | a | b |  |\n  |---|---| --- |\n  | 1 | 2 |  |\n")
        val wrap = "[...document.querySelectorAll('.md-table-wrap')].find((w) => [...w.querySelectorAll('th')].map((t) => t.textContent).join('|') === 'a|b' && " +
            "w.querySelector('td')?.textContent === '1')"
        clickTableButton(file, """button[data-kind="addColumn"][data-index="2"]""", expected, "+ column after the last (list-marker table)", wrap)
        focusPage(file)
        s.press(KeyEvent.VK_CONTROL, KeyEvent.VK_Z)
        waitDocument(file, orig, "undo + column")
        Thread.sleep(400)
        assertEquals("one undo step", orig, s.documentText(file))
        s.waitPageEqualsDocument(file)
    }

    /**
     * Big files (t29-t32, only with `E2e.huge`). The files are copied into the project here, not
     * at the session start, so their indexing does not change the earlier measures.
     * t29: huge.md (20 MB) in Edit mode; `hugeEditModeOpenMs` = the plugin's `toggleToActivatedMs`.
     */
    @Test
    fun t29_hugeEditModeOpen() {
        val s = hugeSession()
        val (ms, docId) = s.openInEdit(HUGE, 120_000)
        metric("hugeEditModeOpenMs", ms.toDouble())
        log("huge.md page perf: ${s.cdp.eval("window.markdone.perf(${js(docId)})")}")
        waitBigPageEqualsDocument(HUGE)
        checkZeroChanges(docId, HUGE)
    }

    /**
     * t30: [TYPED_KEYS] Robot keys at the end of huge.md (window parse at the end of a 20 MB
     * document). Page text = `Document` after the keys; keydown → `ack` p95 is reported as
     * `keystrokeToDocumentHugeMs` (info, no budget).
     */
    @Test
    fun t30_hugeTypingAtEnd() {
        val s = hugeSession()
        showInEdit(HUGE)
        val patchesBefore = s.perfValues("patchApplyMs", "huge.md").size
        val before = s.documentLength(HUGE)
        focusPage(HUGE)
        s.setPageSelection(before)
        Thread.sleep(500)
        installRecorder()
        s.cdp.eval("window.__e2e.keys.length = 0, window.__e2e.acks.length = 0")
        val typed = StringBuilder()
        repeat(TYPED_KEYS) { i ->
            s.press(KeyEvent.VK_A + i % 10)
            typed.append('a' + i % 10)
            Thread.sleep(150)
        }
        E2e.waitFor("Document has the $TYPED_KEYS typed keys", 10_000) { true.takeIf { s.documentLength(HUGE) == before + TYPED_KEYS } }
        val doc = waitBigPageEqualsDocument(HUGE)
        assertTrue("typed text at the end of the Document", doc.endsWith(typed.toString()))
        val keys = s.cdp.eval("window.__e2e.keys").jsonArray.map { it.jsonArray[0].jsonPrimitive.double }
        val acks = s.cdp.eval("window.__e2e.acks").jsonArray.map { it.jsonArray[0].jsonPrimitive.double }
        val values = keys.mapNotNull { k -> acks.firstOrNull { it >= k }?.minus(k) }
        log("huge.md end: keydowns ${keys.size}, acks ${acks.size}; keydown -> ack ms: ${values.joinToString { "%.1f".format(it) }}")
        assertEquals("keydowns seen by the page", TYPED_KEYS, keys.size)
        metric("keystrokeToDocumentHugeMs", Metrics.p95(values))
        metric("keystrokeToDocumentHugeMedianMs", Metrics.median(values))
        patchApplyMetric("Huge", "huge.md", patchesBefore)
        /*
         * At most one patch per 300 ms on documents of 2 MB or more): info only. The keys are
         * one Driver Robot press + a 150 ms sleep apart; the Driver round trips add a time that is
         * not fixed, so the gap (logged below, page clock) can be below or above 300 ms and the
         * patch count is not a check. The pacing itself is tested in L1 (controller.test.ts) and
         * L2 (sync.spec.ts).
         */
        val patches = s.perfValues("patchApplyMs", "huge.md").size - patchesBefore
        val gaps = keys.zipWithNext { a, b -> b - a }
        log("huge.md end: $patches patches for $TYPED_KEYS keys (A25); keydown gap median %.0f ms, min %.0f ms"
            .format(if (gaps.isEmpty()) 0.0 else Metrics.median(gaps), gaps.minOrNull() ?: 0.0))
        metric("patchCountHuge", patches.toDouble())
    }

    /**
     * t31: Ctrl+End (Robot) from the start of huge.md → first painted frame with a decorated
     * viewport at the document end, measured in the page (keydown → after the paint of that frame,
     * page clock). [JUMPS] rounds; `jumpToEndHugeIdeMs` = median (info: the budget key
     * `jumpToEndHugeMs` comes from Playwright).
     */
    @Test
    fun t31_hugeJumpToEnd() {
        val s = hugeSession()
        showInEdit(HUGE)
        focusPage(HUGE)
        s.cdp.eval(JUMP_RECORDER)
        s.cdp.eval("window.__e2eJump.results.length = 0")
        val values = mutableListOf<Double>()
        repeat(JUMPS) { i ->
            s.setPageSelection(0)
            Thread.sleep(1_000)
            focusPage(HUGE)
            s.press(KeyEvent.VK_CONTROL, KeyEvent.VK_END)
            val ms = E2e.waitFor("jump $i: decorated frame at the end", 30_000, 20) {
                s.cdp.eval("window.__e2eJump.results").jsonArray.getOrNull(i)?.jsonPrimitive?.double
            }
            assertTrue("jump $i: decorated frame within 30 s", ms >= 0)
            values += ms
        }
        assertEquals("caret at the end", s.documentLength(HUGE), s.pageSelection().second)
        log("Ctrl+End on huge.md -> decorated frame ms: ${values.joinToString { "%.1f".format(it) }}")
        metric("jumpToEndHugeIdeMs", Metrics.median(values))
        metric("jumpToEndHugeIdeMaxMs", values.max())
    }

    /**
     * t32: a 6 MB document without safe boundaries (one loose list) uses the normal parser.
     * Robot keys at the end and in the middle, and one IDE edit: page text = `Document` after each.
     */
    @Test
    fun t32_noBoundaryListStaysCorrect() {
        val s = hugeSession()
        val (ms, docId) = s.openInEdit(LIST, 120_000)
        log("6 MB loose list: toggleToActivatedMs $ms; page perf: ${s.cdp.eval("window.markdone.perf(${js(docId)})")}")
        metric("noBoundaryListEditModeOpenMs", ms.toDouble())
        waitBigPageEqualsDocument(LIST)
        checkZeroChanges(docId, LIST)
        val original = s.documentText(LIST)
        val patchesBefore = s.perfValues("patchApplyMs", "list-6mb.md").size
        val middle = original.indexOf('\n', original.length / 2)
        focusPage(LIST)
        var expected = original
        for ((label, at) in listOf("end" to original.length, "middle" to middle)) {
            s.setPageSelection(at)
            Thread.sleep(500)
            focusPage(LIST)
            for (k in 0 until LIST_KEYS) {
                s.press(KeyEvent.VK_A + k % 10)
                Thread.sleep(100)
            }
            expected = expected.substring(0, at) + (0 until LIST_KEYS).joinToString("") { ('a' + it % 10).toString() } + expected.substring(at)
            E2e.waitFor("$label: Document has the typed keys", 10_000) { true.takeIf { s.documentLength(LIST) == expected.length } }
            assertEquals("$label: Document text", expected, s.documentText(LIST))
            waitBigPageEqualsDocument(LIST)
        }
        patchApplyMetric("List", "list-6mb.md", patchesBefore)
        s.writeCommand(LIST) { it.insertString(10, "EXT ") }
        expected = expected.substring(0, 10) + "EXT " + expected.substring(10)
        assertEquals(expected, waitBigPageEqualsDocument(LIST))
        log("6 MB loose list: page = Document after typing at the end, in the middle and one IDE edit")
    }

    /**
     * t33: Edit → Source on huge.md after the edits of t30/t31 (the Source editor gets its Markdown
     * highlighter back: one full lex). `modeSwitchHugeMs` = toggle call → layout `SHOW_EDITOR` (info).
     */
    @Test
    fun t33_hugeSwitchToSource() {
        val s = hugeSession()
        showInEdit(HUGE)
        val start = System.nanoTime()
        s.toggle(HUGE)
        E2e.waitFor("$HUGE in Source", 30_000, 10) { true.takeIf { s.layout(HUGE) == "SHOW_EDITOR" } }
        val ms = (System.nanoTime() - start) / 1_000_000.0
        log("huge.md Edit -> Source: $ms ms")
        metric("modeSwitchHugeMs", ms)
    }

    /**
     * t34 (protocol 2.4): mode switch sync on huge.md (windowed parse, plain Source highlighter):
     * Source at 70 % of the lines → Edit, then the page at 30 % → Source.
     */
    @Test
    fun t34_hugeModeSwitchKeepsFirstLine() {
        hugeSession()
        modeSwitchKeepsFirstLine(HUGE, { it * 7 / 10 }, { it * 3 / 10 }, 120_000)
    }

    /**
     * t28a: math-heavy.md in Edit mode: KaTeX formulas and fonts, no CSP violation, typing
     * reaches the Document. The heavy-block tests run before the big-file tests (t29+): after t33, huge.md
     * stays open in Source mode, where the IDE's highlighting daemon can hold the read lock for
     * minutes and block patches.
     */
    @Test
    fun t28a_mathHeavyRendered() = heavyBlocks("m4/math-heavy.md", ".md-math .katex", ".md-math-pending", "math")

    /** t28b: mermaid-heavy.md in Edit mode: Mermaid SVG diagrams (sanitized), no CSP violation (no eval), typing reaches the Document. */
    @Test
    fun t28b_mermaidHeavyRendered() = heavyBlocks("m4/mermaid-heavy.md", ".md-mermaid svg", ".md-mermaid-pending", "mermaid")

    /**
     * Opens [relative] in Edit mode and waits until no [pending] element is left and [rendered]
     * elements are in the page (DOM via CDP). Checks: no CSP violation, no request outside
     * https://markdone.local/, nothing forbidden inside the widgets (links, handlers, foreignObject,
     * images), KaTeX fonts (math) loaded from /app/assets/. Then [HEAVY_KEYS] Robot keys in a prose
     * line reach the `Document`.
     */
    private fun heavyBlocks(relative: String, rendered: String, pending: String, kind: String) {
        val s = session
        s.cdp.eval(CSP_RECORDER)
        s.cdp.eval("window.__e2eCsp.length = 0")
        val watch = s.cdp.watch()
        val count: Int
        val openMs: Long
        try {
            openMs = s.openInEdit(relative).first
            count = E2e.waitFor("$relative: $rendered in the page", 60_000, 100) {
                s.cdp.eval("document.querySelectorAll(${js(pending)}).length === 0 ? document.querySelectorAll(${js(rendered)}).length : 0").jsonPrimitive.int.takeIf { it > 0 }
            }
            s.cdp.eval("document.fonts.ready.then(() => true)")
            Thread.sleep(500)
        } catch (e: Throwable) {
            watch.stop()
            throw e
        }
        val requests = checkRequests(watch.stop(), "requests-$kind-$mode.json")
        val widget = if (kind == "math") ".md-math" else ".md-mermaid"
        val forbidden = s.cdp.eval(
            "(() => { const sel = ${js(widget)}; const all = [...document.querySelectorAll(sel + ' *')]; return [" +
                "document.querySelectorAll(sel + ' a, ' + sel + ' img, ' + sel + ' image, ' + sel + ' foreignObject, ' + sel + ' script, ' + sel + ' use').length, " +
                "all.filter((e) => [...e.attributes].some((a) => a.name.toLowerCase().startsWith('on') || a.name === 'href' || a.name === 'xlink:href')).length]; })()",
        ).jsonArray.map { it.jsonPrimitive.int }
        assertEquals("$relative: links, images, foreignObject, scripts, handlers in $widget", listOf(0, 0), forbidden)
        if (kind == "math") {
            val fonts = requests.filter { it["url"]!!.jsonPrimitive.content.substringBefore('?').endsWith(".woff2") }
            assertTrue("KaTeX fonts requested from /app/assets/", fonts.isNotEmpty() && fonts.all { it["url"]!!.jsonPrimitive.content.startsWith("https://markdone.local/app/assets/") })
            val loaded = s.cdp.eval("[...document.fonts].filter((f) => f.family.startsWith('KaTeX') && f.status === 'loaded').length").jsonPrimitive.int
            assertTrue("KaTeX fonts loaded under font-src", loaded > 0)
        }
        val violations = s.cdp.eval("window.__e2eCsp").jsonArray.map { it.jsonPrimitive.content }
        assertEquals("$relative: CSP violations", emptyList<String>(), violations)
        log("$relative: toggleToActivatedMs $openMs, $count $rendered in the page, ${requests.size} requests, 0 CSP violations")
        metric("${kind}HeavyRendered", count.toDouble())
        // Typing in a prose line between the blocks.
        val before = s.documentText(relative)
        val dot = before.indexOf(".\n", before.length / 2)
        assertTrue("$relative: a prose line ('.' at a line end) in the second half", dot >= 0)
        val at = dot + 1
        focusPage(relative)
        s.setPageSelection(at)
        Thread.sleep(300)
        focusPage(relative)
        val typed = StringBuilder()
        repeat(HEAVY_KEYS) { i ->
            s.press(KeyEvent.VK_A + i % 10)
            typed.append('a' + i % 10)
            Thread.sleep(100)
        }
        val expected = before.substring(0, at) + typed + before.substring(at)
        E2e.waitFor("$relative: Document has the typed keys", 10_000) { true.takeIf { s.documentText(relative) == expected } }
        s.waitPageEqualsDocument(relative)
        assertEquals("$relative: CSP violations after typing", emptyList<String>(), s.cdp.eval("window.__e2eCsp").jsonArray.map { it.jsonPrimitive.content })
    }

    /**
     * t28c: the settings page (Settings → Tools → Markdown Edit) builds its UI, shows the stored
     * values (not modified), applies without a change, and logs no error.
     */
    @Test
    fun t28c_settingsPageOpens() {
        val s = session
        val errorsBefore = ideErrors()
        val result = s.driver.withContext(OnDispatcher.EDT) {
            val page = s.driver.new(MdConfigurable::class, s.ideProject)
            try {
                val component = page.createComponent()
                page.reset()
                val modified = page.isModified()
                page.apply()
                Triple(page.getDisplayName(), component != null, modified)
            } finally {
                page.disposeUIResources()
            }
        }
        log("settings page: $result")
        assertEquals("settings page (name, has UI, modified after reset)", Triple("Markdone", true, false), result)
        assertEquals("idea.log errors while the settings page was open", emptyList<String>(), ideErrors() - errorsBefore.toSet())
    }

    /**
     * t28d (protocol 2.3): the page's `zoomIn`/`zoomReset` commands (sent through the host
     * bridge, as the page keymap does) change the zoom setting, and Kotlin sends `theme` with the new
     * zoom; the page font size follows.
     */
    @Test
    fun t28d_zoomCommandResendsTheme() {
        val s = session
        val file = "m5/zoom.md"
        val docId = s.ensureEdit(file)
        fun settings() = s.driver.service(MdSettings::class)
        s.cdp.eval(
            "(() => { const w = window; if (w.__e2eThemes) return true; w.__e2eThemes = []; const receive = w.markdone.receive; " +
                "w.markdone.receive = (m) => { if (m && m.type === 'theme') w.__e2eThemes.push(m.zoom); return receive(m); }; return true; })()",
        )
        s.cdp.eval("window.__e2eThemes.length = 0")
        fun fontSize() = s.cdp.evalString("getComputedStyle(document.documentElement).getPropertyValue('--md-ide-font-size').trim()")
        fun command(name: String) = s.cdp.eval("window.__markdoneHost.command(JSON.stringify({ type: 'command', docId: ${js(docId)}, name: ${js(name)} })), true")
        fun zooms() = s.cdp.eval("window.__e2eThemes").jsonArray.map { it.jsonPrimitive.double }
        val before = fontSize()
        try {
            assertEquals(1.0, s.driver.withContext(OnDispatcher.EDT) { settings().getZoom() }, 0.0)
            command("zoomIn")
            E2e.waitFor("theme with zoom 1.1", 5_000, 50) { true.takeIf { zooms() == listOf(1.1) } }
            assertEquals(1.1, s.driver.withContext(OnDispatcher.EDT) { settings().getZoom() }, 0.0)
            val zoomed = fontSize()
            log("zoom: --md-ide-font-size $before -> $zoomed")
            val px = { v: String -> v.removeSuffix("px").toDouble() }
            assertEquals("page font size x 1.1", px(before) * 1.1, px(zoomed), 0.01)
            command("zoomReset")
            E2e.waitFor("theme with zoom 1.0", 5_000, 50) { true.takeIf { zooms() == listOf(1.1, 1.0) } }
            assertEquals(before, fontSize())
        } finally {
            s.driver.withContext(OnDispatcher.EDT) { settings().zoomReset() }
        }
        checkZeroChanges(docId, file)
    }

    /**
     * t28e: with a large-file limit of 1 MB, a file just above it opens in
     * Source mode, stays there on Toggle Mode, and its tab shows the banner. A limit of 20 MB again
     * removes the banner.
     */
    @Test
    fun t28e_largeFileSourceOnlyWithBanner() {
        val s = session
        val file = LARGE_LIMIT_FILE
        fun limit(mb: Int) = s.driver.withContext(OnDispatcher.EDT) { s.driver.service(MdSettings::class).setLargeFileLimitMb(mb) }
        val expected = "This file is larger than 1 MB. Edit mode is off. Change the limit in Settings → Tools → Markdown Edit."
        try {
            limit(1)
            s.open(file)
            assertEquals("opens in Source", "SHOW_EDITOR", s.layout(file))
            s.toggle(file)
            Thread.sleep(1_000)
            assertEquals("Toggle Mode keeps Source", "SHOW_EDITOR", s.layout(file))
            val banners = E2e.waitFor("large-file banner", 10_000, 200) { banners(file).takeIf { it.isNotEmpty() } }
            log("large-file banners: $banners")
            assertEquals(listOf(expected), banners)
            limit(20)
            E2e.waitFor("no banner with a 20 MB limit", 10_000, 200) { true.takeIf { banners(file).isEmpty() } }
        } finally {
            limit(20)
            s.close(file)
        }
    }

    /**
     * t28f: one mouse-wheel notch (Robot) scrolls the Edit view about as many lines as the
     * Source editor (±1 line); Ctrl+wheel still zooms and does not scroll. Logs what the page gets
     * for a notch (wheel `deltaY`, `deltaMode`, `wheelDeltaY`) and the JCEF wheel factor.
     */
    @Test
    fun t28f_wheelNotchScrollsLikeSource() {
        val s = session
        val file = "m5/wheel.md"
        s.open(file)
        if (s.layout(file) != "SHOW_EDITOR") {
            s.toggle(file)
            s.waitLayout(file, "SHOW_EDITOR")
        }
        val factor = s.driver.utility(RegistryStatics::class).intValue("ide.browser.jcef.osr.wheelRotation.factor")
        // Source: the text editor's scroll offset before and after one notch (smooth scrolling animates it).
        val md = s.mdEditor(file)
        val editor = s.driver.withContext { s.driver.cast(md.getTextEditor(), TextEditor::class).getEditor() }
        val (sx, sy) = center(md.getTextEditor().getComponent())
        val lineHeight = s.driver.withContext(OnDispatcher.EDT) { editor.getLineHeight() }
        fun sourceOffset() = s.driver.withContext(OnDispatcher.EDT) { editor.getScrollingModel().getVerticalScrollOffset() }
        val source0 = sourceOffset()
        s.wheel(sx, sy, 1)
        val source1 = settled { sourceOffset().toDouble() }
        val sourceLines = (source1 - source0) / lineHeight
        // Edit: the page's scrollTop before and after one notch, and the wheel events it got.
        val name = Path.of(file).fileName.toString()
        val n = s.activatedCount(name)
        s.toggle(file)
        s.waitActivated(name, n)
        s.cdp.eval(
            "(() => { const w = window; if (!w.__e2eWheel) { w.__e2eWheel = []; document.getElementById('app').addEventListener('wheel', (e) => " +
                "w.__e2eWheel.push([e.deltaY, e.deltaMode, e.wheelDeltaY, e.ctrlKey]), { capture: true, passive: true }); } w.__e2eWheel.length = 0; return true; })()",
        )
        val (px, py) = center(previewComponent(file))
        s.moveMouse(px, py)
        Thread.sleep(300)
        fun pageTop() = s.cdp.eval("$VIEW_JS.scrollDOM.scrollTop").jsonPrimitive.double
        val pageLineHeight = s.cdp.eval("$VIEW_JS.defaultLineHeight").jsonPrimitive.double
        val page0 = pageTop()
        s.wheel(px, py, 1)
        val page1 = settled { pageTop() }
        val pageLines = (page1 - page0) / pageLineHeight
        val events = s.cdp.eval("window.__e2eWheel").toString()
        // One notch up: the same step back.
        s.wheel(px, py, -1)
        val upLines = (page1 - settled { pageTop() }) / pageLineHeight
        log("wheel notch up: Edit %.2f lines".format(upLines))
        log("wheel notch: JCEF factor $factor; Source ${source1 - source0} px / line height $lineHeight = %.2f lines; ".format(sourceLines) +
            "Edit ${page1 - page0} px / line height $pageLineHeight = %.2f lines; page wheel events [deltaY, deltaMode, wheelDeltaY, ctrl] $events; ".format(pageLines) +
            "browser component ${previewComponent(file).toString().substringBefore('[')}, devicePixelRatio ${s.cdp.eval("devicePixelRatio")}")
        metric("wheelNotchSourceLines", sourceLines)
        metric("wheelNotchEditLines", pageLines)
        // Ctrl+wheel: zoom requests only (the page does not scroll; the zoom keeps the first visible line); notches up to the first zoom step.
        fun zoom() = s.driver.withContext(OnDispatcher.EDT) { s.driver.service(MdSettings::class).getZoom() }
        s.cdp.eval("window.__e2eWheel.length = 0")
        val zoomTop = settled { pageTopLine().toDouble() }
        var notches = 0
        try {
            while (notches < 15 && zoom() == 1.0) {
                s.wheel(px, py, -1, KeyEvent.VK_CONTROL)
                notches++
                Thread.sleep(150)
            }
            log("Ctrl+wheel: zoom ${zoom()} after $notches notch(es); page events ${s.cdp.eval("window.__e2eWheel")}")
            assertEquals("Ctrl+wheel up zooms in", 1.1, zoom(), 0.0)
            assertEquals("Ctrl+wheel does not scroll (first visible line)", zoomTop, settled { pageTopLine().toDouble() }, 1.0)
        } finally {
            s.driver.withContext(OnDispatcher.EDT) { s.driver.service(MdSettings::class).zoomReset() }
        }
        assertTrue("one notch: Edit %.2f lines, Source %.2f lines (±1)".format(pageLines, sourceLines), abs(pageLines - sourceLines) <= 1.0)
        assertTrue("one notch up: Edit %.2f lines, Source %.2f lines (±1)".format(upLines, sourceLines), abs(upLines - sourceLines) <= 1.0)
    }

    /**
     * t28g (protocol 2.4): a mode switch keeps the first visible source line (±1) and the caret
     * or selection, in both directions. Source → Edit: Source scrolled to line 1500, a backward selection in line 1503;
     * Edit → Source: the page scrolled to line 3000, a backward selection in line 3002.
     */
    @Test
    fun t28g_modeSwitchKeepsFirstLineAndCaret() = modeSwitchKeepsFirstLine("m5/sync.md", { 1500 }, { 3000 }, 30_000)

    /**
     * Toggles [relative] Source → Edit → Source: the first visible line ([sourceLine] in Source, then
     * [pageLine] in the page, of the document's line count) and the caret/selection must follow (±1 line).
     */
    private fun modeSwitchKeepsFirstLine(relative: String, sourceLine: (Int) -> Int, pageLine: (Int) -> Int, timeoutMs: Long) {
        val s = session
        val name = Path.of(relative).fileName.toString()
        s.open(relative)
        if (s.layout(relative) != "SHOW_EDITOR") {
            s.toggle(relative)
            E2e.waitFor("$relative in Source", timeoutMs, 10) { true.takeIf { s.layout(relative) == "SHOW_EDITOR" } }
        }
        val document = s.driver.withContext { s.driver.utility(FileDocumentManagerStatics::class).getInstance().getDocument(s.file(relative))!! }
        val lines = s.driver.withReadAction { document.getLineCount() }
        fun start(line: Int) = s.driver.withReadAction { document.getLineStartOffset(line - 1) }
        val editor = s.driver.withContext { s.driver.cast(s.mdEditor(relative).getTextEditor(), TextEditor::class).getEditor() }
        // Source -> Edit.
        val n = sourceLine(lines)
        val caret = start(n + 3) + 5
        val top = start(n)
        s.driver.withContext(OnDispatcher.EDT) {
            val impl = s.driver.cast(editor, EditorImpl::class)
            val scrolling = editor.getScrollingModel()
            scrolling.disableAnimation()
            scrolling.scrollVertically(impl.visualLineToY(impl.offsetToVisualLine(top, false)))
            scrolling.enableAnimation()
            // A backward selection (anchor > head): the caret at its start.
            editor.getCaretModel().moveToOffset(caret - 4)
            editor.getSelectionModel().setSelection(caret - 4, caret)
        }
        val sourceTop = settled { sourceTopLine(editor).toDouble() }.toInt()
        val count = s.activatedCount(name)
        s.toggle(relative)
        val toEditMs = s.waitActivated(name, count, timeoutMs)
        val pageTop = settled { pageTopLine().toDouble() }.toInt()
        val pageSelection = s.pageSelection()
        // Edit -> Source.
        val m = pageLine(lines)
        val anchor = start(m + 2) + 7
        s.cdp.eval(
            "(async () => { const v = $VIEW_JS; const from = v.state.doc.line($m).from; " +
                "v.dispatch({ selection: { anchor: $anchor, head: ${anchor - 4} }, effects: v.constructor.scrollIntoView(from, { y: 'start', yMargin: 0 }) }); " +
                "for (let i = 0; i < 5; i++) { await new Promise((r) => requestAnimationFrame(r)); v.dispatch({ effects: v.constructor.scrollIntoView(from, { y: 'start', yMargin: 0 }) }); } return true; })()",
        )
        val pageTopBefore = settled { pageTopLine().toDouble() }.toInt()
        val t0 = System.nanoTime()
        s.toggle(relative)
        E2e.waitFor("$relative in Source", timeoutMs, 10) { true.takeIf { s.layout(relative) == "SHOW_EDITOR" } }
        val toSourceMs = (System.nanoTime() - t0) / 1_000_000
        val sourceTopAfter = settled { sourceTopLine(editor).toDouble() }.toInt()
        val (offset, lead, range) = s.driver.withContext(OnDispatcher.EDT) {
            val selection = editor.getSelectionModel()
            Triple(editor.getCaretModel().getOffset(), selection.getLeadSelectionOffset(), selection.getSelectionStart() to selection.getSelectionEnd())
        }
        log("$relative mode switch: Source top $sourceTop (asked $n), caret $caret -> Edit (toggleToActivatedMs $toEditMs) top $pageTop, selection $pageSelection; " +
            "Edit top $pageTopBefore (asked $m), selection $anchor..${anchor - 4} -> Source ($toSourceMs ms) top $sourceTopAfter, caret $offset, lead $lead, range $range")
        assertTrue("Source scrolled to line $n: $sourceTop", abs(sourceTop - n) <= 1)
        assertTrue("Source -> Edit: first visible line $pageTop, Source had $sourceTop (±1)", abs(pageTop - sourceTop) <= 1)
        assertEquals("Source -> Edit: selection (anchor, head)", caret to caret - 4, pageSelection)
        assertTrue("Edit -> Source: first visible line $sourceTopAfter, page had $pageTopBefore (±1)", abs(sourceTopAfter - pageTopBefore) <= 1)
        assertEquals("Edit -> Source: caret = head", anchor - 4, offset)
        assertEquals("Edit -> Source: lead = anchor", anchor, lead)
        assertEquals("Edit -> Source: selection", anchor - 4 to anchor, range)
    }

    /** 1-based number of the first visible line of the Source [editor] (soft wraps: through its visual lines). */
    private fun sourceTopLine(editor: Editor): Int = session.driver.withContext(OnDispatcher.EDT) {
        val impl = session.driver.cast(editor, EditorImpl::class)
        val offset = impl.visualLineStartOffset(impl.yToVisualLine(editor.getScrollingModel().getVerticalScrollOffset()))
        editor.getDocument().getLineNumber(offset) + 1
    }

    /** 1-based number of the page's first visible line (as the page computes `viewport.top`). */
    private fun pageTopLine(): Int = session.cdp.eval(
        "(() => { const v = $VIEW_JS; return v.state.doc.lineAt(v.lineBlockAtHeight(v.scrollDOM.getBoundingClientRect().top - v.documentTop).from).number; })()",
    ).jsonPrimitive.int

    /**
     * t28h: the tab of a Markdown file has the file color "Gray" while its document or file is not
     * writable, in both modes, and no color when the document is writable again. The title has no suffix.
     */
    @Test
    fun t28h_readOnlyTabColor() {
        val s = session
        val file = "m5/title.md"
        s.open(file)
        val gray = s.driver.withContext { s.driver.utility(FileColorManagerStatics::class).getInstance(s.ideProject).getColor("Gray")!!.getRGB() }
        fun tab(name: String) = E2e.waitFor("tab of $name", 5_000, 50) { tabs().firstOrNull { it.first == name } }
        fun waitColor(name: String, expected: Int?) =
            E2e.waitFor("tab color of $name: $expected", 5_000, 50) { true.takeIf { tab(name) == name to expected } }
        assertEquals("title.md" to null, tab("title.md"))
        val document = s.driver.withContext { s.driver.utility(FileDocumentManagerStatics::class).getInstance().getDocument(s.file(file))!! }
        try {
            s.driver.withContext(OnDispatcher.EDT) { document.setReadOnly(true) }
            waitColor("title.md", gray)
            s.toggle(file)
            s.waitLayout(file, "SHOW_PREVIEW")
            assertEquals("Edit mode", "title.md" to gray, tab("title.md"))
            s.driver.withContext(OnDispatcher.EDT) { document.setReadOnly(false) }
            waitColor("title.md", null)
        } finally {
            s.driver.withContext(OnDispatcher.EDT) { document.setReadOnly(false) }
            s.close(file)
        }
        // A file that is not writable on disk.
        s.open("read-only.md")
        assertEquals("read-only.md" to gray, tab("read-only.md"))
        log("tabs (text, color): ${tabs()}, Gray $gray")
    }

    /** Text and tab color (RGB, null for none) of the tabs of the current editor window. */
    private fun tabs(): List<Pair<String, Int?>> = session.driver.withContext(OnDispatcher.EDT) {
        val manager = session.driver.utility(FileEditorManagerExStatics::class).getInstanceEx(session.ideProject)
        val tabs = manager.getCurrentWindow()?.getTabbedPane()?.getTabs() ?: return@withContext emptyList()
        (0 until tabs.getTabCount()).map { tabs.getTabAt(it).let { tab -> tab.getText() to tab.getTabColor()?.getRGB() } }
    }

    /** Screen point at the centre of [component]. */
    private fun center(component: Component): Pair<Int, Int> = session.driver.withContext {
        val p = component.getLocationOnScreen()
        (p.getX() + component.getWidth() / 2).toInt() to (p.getY() + component.getHeight() / 2).toInt()
    }

    /** Polls [value] until it does not change for 400 ms (at most 5 s); returns it. */
    private fun settled(value: () -> Double): Double {
        var last = value()
        var since = System.nanoTime()
        val end = since + 5_000_000_000L
        while (System.nanoTime() < end) {
            Thread.sleep(50)
            val now = value()
            if (now != last) {
                last = now
                since = System.nanoTime()
            } else if (System.nanoTime() - since > 400_000_000L) {
                break
            }
        }
        return last
    }

    /** The texts of the showing editor notification panels in the tab of [relative]. */
    private fun banners(relative: String): List<String> = session.driver.withContext(OnDispatcher.EDT) {
        val d = session.driver
        // Up to the tab's composite (it holds the notification panels above the editor).
        var top = session.mdEditor(relative).getComponent()
        repeat(8) {
            if ("EditorCompositePanel" in top.toString()) return@repeat
            top = top.getParent() ?: return@repeat
        }
        val found = mutableListOf<String>()
        fun walk(c: Component, depth: Int) {
            val name = c.toString()
            // The class itself (JComponent.toString = "<class>[...]"), not its inner classes (EditorNotificationPanel$3).
            if (name.startsWith("com.intellij.ui.EditorNotificationPanel[") && c.isShowing()) found += d.cast(c, EditorNotificationPanel::class).getText()
            // Not every component is a java.awt.Container (the JCEF canvas): the call then fails in the IDE.
            val children = if (depth < 6) try {
                d.cast(c, Container::class).getComponents().toList()
            } catch (_: Exception) {
                emptyList()
            } else emptyList()
            children.forEach { walk(it, depth + 1) }
        }
        walk(top, 0)
        found
    }

    /** The ERROR lines of the IDE's idea.log so far. */
    private fun ideErrors(): List<String> =
        Files.readAllLines(session.dir.resolve("log/idea.log")).filter { " ERROR - " in it }

    /** Logs the `patchApplyMs` lines of [fileName] after the first [before] ones; p95 as `patchApply<label>P95Ms` (info). */
    private fun patchApplyMetric(label: String, fileName: String, before: Int) {
        val values = session.perfValues("patchApplyMs", fileName).drop(before).map { it.toDouble() }
        log("patchApplyMs $fileName (${values.size}): ${values.joinToString { "%.0f".format(it) }}")
        if (values.isNotEmpty()) {
            metric("patchApply${label}P95Ms", Metrics.p95(values))
            metric("patchApply${label}MedianMs", Metrics.median(values))
        }
    }

    /** The session with huge.md and the 6 MB list in the project (copied and indexed once). */
    private fun hugeSession(): IdeSession {
        val s = session
        assumeTrue("E2E_HUGE=false", E2e.huge)
        assumeTrue("huge.md missing: node web/scripts/gen-corpus.mjs huge", E2e.corpus.resolve("huge.md").exists())
        if (!s.project.resolve(HUGE).exists()) {
            IdeSession.copy(s.project, "huge.md" to HUGE)
            s.project.resolve(LIST).writeText((0 until 200_000).joinToString("\n") { "- item $it with some *text*\n" })
            s.refresh("huge", recursive = true)
            E2e.waitFor("smart mode after adding the big files", 120_000, 500) {
                true.takeIf { !s.driver.service(DumbService::class, s.ideProject).isDumb() }
            }
        }
        return s
    }

    /** Selects the tab of [relative] (already in Edit mode from an earlier test, else opened in Edit). */
    private fun showInEdit(relative: String) {
        val s = session
        s.open(relative)
        if (s.layout(relative) != "SHOW_PREVIEW") s.openInEdit(relative, 120_000)
        E2e.waitFor("$relative active in the page", 30_000) { true.takeIf { s.activeDocId().isNotEmpty() && s.cdp.eval("$VIEW_JS.state.doc.length").jsonPrimitive.int == s.documentLength(relative) } }
    }

    /** [IdeSession.waitPageEqualsDocument] for big files: polls the lengths, then compares the texts once. */
    private fun waitBigPageEqualsDocument(relative: String): String {
        val s = session
        E2e.waitFor("page length = Document length of $relative", 30_000, 100) {
            true.takeIf { s.cdp.eval("$VIEW_JS.state.doc.length").jsonPrimitive.int == s.documentLength(relative) }
        }
        return s.waitPageEqualsDocument(relative, 30_000)
    }

    /**
     * For a t14 failure: the plugin's perf lines of [relative] with their idea.log times (patch
     * timings) and the undo/redo stack tops of its text editor.
     */
    private fun undoDiagnostics(relative: String): String {
        val s = session
        val name = Path.of(relative).fileName.toString()
        val lines = try {
            Files.readAllLines(s.dir.resolve("log/idea.log")).filter { "#ch.nmeylan.markdone.perf" in it && "($name)" in it }.takeLast(12)
                .map { it.substring(11, 23) + " " + it.substringAfter("#ch.nmeylan.markdone.perf - ") }
        } catch (e: Exception) {
            listOf("idea.log: $e")
        }
        val stack = try {
            s.driver.withContext(OnDispatcher.EDT) {
                val editor = s.mdEditor(relative).getTextEditor()
                val undo = s.driver.service(UndoManager::class, s.ideProject)
                "undo available ${undo.isUndoAvailable(editor)}, undo top ${undo.getUndoActionNameAndDescription(editor)}, " +
                    "redo top ${undo.getRedoActionNameAndDescription(editor)}"
            }
        } catch (e: Exception) {
            "undo stack: $e"
        }
        val text = s.documentText(relative).lineSequence().first()
        return "first line now '$text'; perf lines $lines; $stack".also { log("undo diagnostics ($relative): $it") }
    }

    /** Whether [condition] becomes true within 3 s. */
    private fun waitTrue(what: String, condition: () -> Boolean): Boolean = try {
        E2e.waitFor(what, 3_000, 50) { true.takeIf { condition() } }
    } catch (_: AssertionError) {
        false
    }

    /** Swing focus owner and whether the IDE frame is the focused window (diagnostics). */
    private fun focusState(): String = session.driver.withContext(OnDispatcher.EDT) {
        val owner = session.driver.utility(KeyboardFocusManagerStatics::class).getCurrentKeyboardFocusManager().getFocusOwner()?.toString()?.take(120)
        "focus owner $owner, frame focused ${session.driver.service(WindowManager::class).getFrame(session.ideProject)?.isFocused()}"
    }

    /** Waits until the `Document` text of [relative] is [expected]; the error shows the first difference. */
    private fun waitDocument(relative: String, expected: String, label: String) {
        try {
            E2e.waitFor("$label: Document text", 5_000, 50) { true.takeIf { session.documentText(relative) == expected } }
        } catch (e: AssertionError) {
            val now = session.documentText(relative)
            val i = now.zip(expected).indexOfFirst { (a, b) -> a != b }.let { if (it < 0) minOf(now.length, expected.length) else it }
            throw AssertionError("${e.message}; first difference at $i: Document '${now.substring(i, minOf(now.length, i + 60))}' " +
                "expected '${expected.substring(i, minOf(expected.length, i + 60))}'", e)
        }
    }

    /** Screen position of the browser component of [relative] (page CSS px = Swing px: zoom 1). */
    private fun origin(relative: String): Pair<Double, Double> {
        val browser = previewComponent(relative)
        return session.driver.withContext { browser.getLocationOnScreen().let { it.getX() to it.getY() } }
    }

    /**
     * Hovers the table widget [wrap] (a page expression; default: the first), then the button [selector] in it (Robot), clicks it and waits
     * for the `Document` text [expected]. The caret is put on line 1 first, so the table is rendered.
     */
    private fun clickTableButton(
        file: String,
        selector: String,
        expected: String,
        label: String,
        wrap: String = "document.querySelector('.md-table-wrap')",
    ) {
        val s = session
        s.setPageSelection(0)
        Thread.sleep(200)
        val p = s.cdp.eval(
            "(() => { const w = $wrap; const b = w && w.querySelector(${js(selector)}); if (!b) return null; " +
                "const r = b.getBoundingClientRect(), t = w.getBoundingClientRect(); " +
                "return [t.left + t.width / 2, t.top + t.height / 2, r.left + r.width / 2, r.top + r.height / 2]; })()",
        ).let { if (it is JsonNull) throw AssertionError("$label: no button $selector in the first table widget") else it.jsonArray.map { v -> v.jsonPrimitive.double } }
        val (ox, oy) = origin(file)
        s.moveMouse((ox + p[0]).toInt(), (oy + p[1]).toInt())
        Thread.sleep(200)
        val x = (ox + p[2]).toInt()
        val y = (oy + p[3]).toInt()
        s.moveMouse(x, y)
        Thread.sleep(200)
        val hover = s.cdp.evalString(
            "(() => { const b = ($wrap).querySelector(${js(selector)}); return getComputedStyle(b).visibility + ' hover=' + b.matches(':hover'); })()",
        )
        s.click(x, y, InputEvent.BUTTON1_DOWN_MASK)
        log("table button '$label' ($selector) at page (${p[2].toInt()}, ${p[3].toInt()}): $hover")
        waitDocument(file, expected, label)
        s.waitPageEqualsDocument(file)
    }

    /** Items (text, element) of the open popup menu at [level] of the selected path (0 = the popup, 2 = its open submenu). */
    private fun menuLevel(level: Int): List<Pair<String, MenuElement>>? = session.driver.withContext(OnDispatcher.EDT) {
        val path = session.driver.utility(MenuSelectionManagerStatics::class).defaultManager().getSelectedPath()
        val popup = path.getOrNull(level) ?: return@withContext null
        if (!popup.getComponent().isShowing()) return@withContext null
        popup.getSubElements().map { session.driver.cast(it, JMenuItem::class).getText().orEmpty() to it }
    }

    private fun itemCenter(item: MenuElement): Pair<Int, Int> = session.driver.withContext(OnDispatcher.EDT) {
        val c = item.getComponent()
        val loc = c.getLocationOnScreen()
        (loc.getX() + c.getWidth() / 2).toInt() to (loc.getY() + c.getHeight() / 2).toInt()
    }

    /**
     * Right-click (Robot) on the header cell "No" of the rendered table "Plain | No | Outer", then
     * "Table" → [action] in the IDE popup.
     */
    private fun tableMenuAction(file: String, action: String) {
        val s = session
        s.setPageSelection(0)
        Thread.sleep(200)
        s.cdp.eval(
            "(() => { if (!window.__e2eCtx) { window.__e2eCtx = []; window.addEventListener('contextmenu', (e) => { const t = e.target instanceof Element ? e.target : null; " +
                "const c = t && t.closest('[data-row]'); window.__e2eCtx.push([e.clientX, e.clientY, !!(t && t.closest('.md-table-wrap')), c ? +c.dataset.row : -1, c ? +c.dataset.col : -1]); }, true); } return true; })()",
        )
        val p = s.cdp.eval(
            "(() => { const v = ${IdeSession.VIEW}; const w = [...document.querySelectorAll('.md-table-wrap')].find((x) => x.querySelector('th')?.textContent === 'Plain'); " +
                "const r = w.querySelector('th[data-col=\"1\"]').getBoundingClientRect(); const h = v.coordsAtPos(4); " +
                "return [r.left + r.width / 2, r.top + r.height / 2, h.left, (h.top + h.bottom) / 2]; })()",
        ).jsonArray.map { it.jsonPrimitive.double }
        val (ox, oy) = origin(file)
        // A left click on line 1 (outside the table) syncs JCEF's off-screen mouse position (see openMenu).
        s.click((ox + p[2]).toInt(), (oy + p[3]).toInt(), InputEvent.BUTTON1_DOWN_MASK)
        Thread.sleep(150)
        s.setPageSelection(0)
        val x = (ox + p[0]).toInt()
        val y = (oy + p[1]).toInt()
        s.moveMouse(x, y)
        Thread.sleep(200)
        s.click(x, y, InputEvent.BUTTON3_DOWN_MASK)
        val top = E2e.waitFor("IDE context menu", 5_000, 100) { menuLevel(0) }
        val event = s.cdp.eval("window.__e2eCtx.at(-1)")
        log("table context menu: page contextmenu [clientX, clientY, in table widget, row, column] = $event; items ${top.map { it.first }}")
        assertEquals("contextmenu on the rendered table, header cell 'No'", "true,0,1", event.jsonArray.drop(2).joinToString(",") { it.jsonPrimitive.content })
        val table = top.firstOrNull { it.first == "Table" } ?: throw AssertionError("no 'Table' submenu in ${top.map { it.first }}")
        val (tx, ty) = itemCenter(table.second)
        s.click(tx, ty, InputEvent.BUTTON1_DOWN_MASK)
        val sub = E2e.waitFor("Table submenu", 5_000, 100) { menuLevel(2)?.takeIf { it.isNotEmpty() } }
        val enabled = s.driver.withContext(OnDispatcher.EDT) { sub.map { "${it.first}=${s.driver.cast(it.second, JMenuItem::class).isEnabled()}" } }
        log("Table submenu: $enabled")
        assertEquals(
            "Table submenu items",
            listOf("Insert Row Above", "Insert Row Below", "Insert Column Left", "Insert Column Right", "Remove Row", "Remove Column",
                "Align Left", "Align Center", "Align Right", "No Alignment", "Reformat Table"),
            sub.map { it.first },
        )
        val (ax, ay) = itemCenter(sub.first { it.first == action }.second)
        s.click(ax, ay, InputEvent.BUTTON1_DOWN_MASK)
        E2e.waitFor("menu closed", 3_000, 100) {
            true.takeIf { s.driver.withContext(OnDispatcher.EDT) { s.driver.utility(MenuSelectionManagerStatics::class).defaultManager().getSelectedPath().isEmpty() } }
        }
    }

    /** Whether the Edit view of [relative] shows the "project CSS not applied" notice (an `EditorNotificationPanel`). */
    private fun projectCssNotice(relative: String): Boolean = session.driver.withContext(OnDispatcher.EDT) {
        val panel = session.mdEditor(relative).getPreviewEditor().getComponent()
        session.driver.cast(panel, Container::class).getComponents().any { "EditorNotificationPanel" in it.toString() && it.isShowing() }
    }

    /** Stops [watch], writes its requests to [reportName] and returns them. */
    private fun watchStopToReport(watch: Cdp.Watch, reportName: String): JsonArray =
        watch.stop().also { Files.writeString(E2e.reports.resolve(reportName), it.toString()) }

    private fun previewComponent(relative: String): Component {
        val preview = session.mdEditor(relative).getPreviewEditor()
        return preview.getPreferredFocusedComponent() ?: preview.getComponent()
    }

    /** Gives the X input focus to the IDE and the Swing focus to the browser of [relative]. */
    private fun focusPage(relative: String) {
        val s = session
        s.focus(previewComponent(relative))
        Thread.sleep(200)
        E2e.waitFor("page has focus", 3_000, 200) { true.takeIf { s.cdp.eval("document.hasFocus()").jsonPrimitive.boolean } }
    }

    /**
     * Page recorder (once per page load): keydowns, `contextmenu` events, and the IDE → page
     * `ack`, `change` and `reload` messages; `corrupt = docId` adds 'Q' to the next `change` of it (wrapped `window.markdone.receive`; Kotlin calls it by
     * name). Times are epoch ms of the page's `performance` clock.
     */
    private fun installRecorder() {
        session.cdp.eval(
            "(() => { const w = window; if (w.__e2e) return true; const now = () => performance.timeOrigin + performance.now(); " +
                "const r = w.__e2e = { keys: [], acks: [], changes: [], reloads: [], contextMenus: [], corrupt: null, corrupted: 0 }; " +
                "w.addEventListener('keydown', (e) => r.keys.push([now(), e.key, e.ctrlKey]), true); " +
                "w.addEventListener('contextmenu', (e) => r.contextMenus.push([e.defaultPrevented, e.clientX, e.clientY])); " +
                "const receive = w.markdone.receive; w.markdone.receive = (m) => { const t = now(); " +
                "if (m && m.type === 'ack') r.acks.push([t, m.docId, m.seq]); " +
                "if (m && m.type === 'change') r.changes.push([t, m.docId, !!m.selection]); " +
                "if (m && m.type === 'reload') r.reloads.push([t, m.docId]); " +
                "if (m && m.type === 'change' && m.docId === r.corrupt && m.changes.length) { r.corrupt = null; r.corrupted++; " +
                "m = { ...m, changes: m.changes.map((c, i) => (i === 0 ? { ...c, insert: c.insert + 'Q' } : c)) }; } " +
                "return receive(m); }; return true; })()",
        )
    }

    private class Menu(val items: List<Pair<String, MenuElement>>)

    /** Popup position problems found in this test (checked at its end). */
    private val menuPositions = mutableListOf<String>()

    /** Offset (dx, dy) of the platform's own editor context menu from its right-click point (Source mode). */
    private var platformMenuOffset = 0.0 to 0.0

    /**
     * Selects [from]..[to] in the page, right-clicks (Robot) inside the selection and returns the
     * IDE popup. Logs the offset between the click and the popup's top-left corner.
     */
    private fun openMenu(browser: Component, from: Int, to: Int): Menu {
        val s = session
        s.setPageSelection(from, to)
        Thread.sleep(150)
        val box = s.cdp.eval(
            "(() => { const v = ${IdeSession.VIEW}; const a = v.coordsAtPos(${from + 1}), b = v.coordsAtPos(${to - 1}); " +
                "return [(a.left + b.left) / 2, (a.top + a.bottom) / 2]; })()",
        ).jsonArray.map { it.jsonPrimitive.double }
        val (originX, originY) = s.driver.withContext { browser.getLocationOnScreen().let { it.getX() to it.getY() } }
        val x = (originX + box[0]).toInt()
        val y = (originY + box[1]).toInt()
        /*
         * After a menu item click, JCEF off-screen rendering took the next right-click at the
         * position of that item click (contextmenu clientX of the old point; seen in L5). A left
         * click first syncs the position; then the selection is set again.
         */
        s.click(x, y, InputEvent.BUTTON1_DOWN_MASK)
        Thread.sleep(150)
        s.setPageSelection(from, to)
        Thread.sleep(150)
        val windowsBefore = showingWindows()
        s.click(x, y, InputEvent.BUTTON3_DOWN_MASK)
        val (items, loc) = E2e.waitFor("IDE context menu", 5_000, 100) {
            s.driver.withContext(OnDispatcher.EDT) {
                val root = s.driver.utility(MenuSelectionManagerStatics::class).defaultManager().getSelectedPath().firstOrNull()
                if (root == null || !root.getComponent().isShowing()) return@withContext null
                val loc = root.getComponent().getLocationOnScreen()
                root.getSubElements().map { s.driver.cast(it, JMenuItem::class).getText().orEmpty() to it } to (loc.getX() to loc.getY())
            }
        }
        val newWindows = showingWindows() - windowsBefore
        val event = s.cdp.eval("window.__e2e.contextMenus.at(-1)").jsonArray
        log("page contextmenu event (defaultPrevented, clientX, clientY): $event; " +
            "browser component origin ($originX, $originY) size ${s.driver.withContext { browser.getWidth() to browser.getHeight() }}, " +
            "Robot point in the page ${box.map { it.toInt() }}, page viewport ${s.cdp.eval("[innerWidth, innerHeight, devicePixelRatio]")}")
        val dx = loc.first - x
        val dy = loc.second - y
        log("context menu on $from..$to: items ${items.map { it.first }}; click ($x, $y), popup (${loc.first.toInt()}, ${loc.second.toInt()}), " +
            "offset (${dx.toInt()}, ${dy.toInt()}) px; new windows: $newWindows")
        metric("contextMenuOffsetPx", maxOf(abs(dx), abs(dy)))
        assertEquals("menu entries", listOf("Cut", "Copy", "Paste", "Select All", "Toggle Markdown Source/Edit Mode", "Zoom In", "Zoom Out", "Reset Zoom", "Style"), items.map { it.first })
        assertTrue("at most one new window (the popup), no Chromium menu: $newWindows", newWindows.size <= 1)
        /*
         * The popup must be where the platform puts its own editor context menu for a click at the
         * point the page reported (event clientX/Y), within 4 px; checked at the end of the test.
         */
        val px = originX + event[1].jsonPrimitive.double + platformMenuOffset.first
        val py = originY + event[2].jsonPrimitive.double + platformMenuOffset.second
        if (abs(loc.first - px) > 4 || abs(loc.second - py) > 4) {
            menuPositions += "page point (${px.toInt()}, ${py.toInt()}), popup (${loc.first.toInt()}, ${loc.second.toInt()})"
        }
        return Menu(items)
    }

    /**
     * Right-click (Robot) in the platform text editor of `source-menu.md` (Source mode): returns
     * the offset of its popup's top-left corner from the click point, then closes the popup.
     */
    private fun platformEditorMenuOffset(): Pair<Double, Double> {
        val s = session
        val file = "source-menu.md"
        s.open(file)
        val text = s.mdEditor(file).getTextEditor()
        val component = text.getPreferredFocusedComponent() ?: text.getComponent()
        val (ox, oy) = s.driver.withContext { component.getLocationOnScreen().let { it.getX() to it.getY() } }
        val x = (ox + 120).toInt()
        val y = (oy + 30).toInt()
        s.click(x, y, InputEvent.BUTTON3_DOWN_MASK)
        val loc = E2e.waitFor("platform editor context menu", 5_000, 100) {
            s.driver.withContext(OnDispatcher.EDT) {
                val root = s.driver.utility(MenuSelectionManagerStatics::class).defaultManager().getSelectedPath().firstOrNull()
                if (root == null || !root.getComponent().isShowing()) null else root.getComponent().getLocationOnScreen().let { it.getX() to it.getY() }
            }
        }
        s.driver.withContext(OnDispatcher.EDT) { s.driver.utility(MenuSelectionManagerStatics::class).defaultManager().clearSelectedPath() }
        s.close(file)
        return (loc.first - x) to (loc.second - y)
    }

    /** Clicks the menu item [text] with the Robot (left button at its centre). */
    private fun clickItem(menu: Menu, text: String) {
        val s = session
        val item = menu.items.first { it.first == text }.second
        val (x, y) = s.driver.withContext(OnDispatcher.EDT) {
            val c = item.getComponent()
            val loc = c.getLocationOnScreen()
            (loc.getX() + c.getWidth() / 2).toInt() to (loc.getY() + c.getHeight() / 2).toInt()
        }
        s.click(x, y, InputEvent.BUTTON1_DOWN_MASK)
        E2e.waitFor("menu closed", 3_000, 100) {
            true.takeIf {
                s.driver.withContext(OnDispatcher.EDT) { s.driver.utility(MenuSelectionManagerStatics::class).defaultManager().getSelectedPath().isEmpty() }
            }
        }
    }

    private fun showingWindows(): Set<String> = session.driver.withContext(OnDispatcher.EDT) {
        session.driver.utility(WindowStatics::class).getWindows().filter { it.isShowing() }.map { it.toString().substringBefore(',') }.toSet()
    }

    private fun checkPage(relative: String) {
        val s = session
        val name = Path.of(relative).fileName.toString()
        assertTrue("window.__markdoneHost defined (executeJavaScript under the CSP)",
            s.cdp.eval("typeof window.__markdoneHost === 'object' && typeof window.__markdoneHost.ready === 'function'").jsonPrimitive.boolean)
        s.waitPageEqualsDocument(relative)
        val docId = s.activeDocId()
        checkZeroChanges(docId, relative)
        // Edit -> Source -> Edit twice; the page must not change the document.
        repeat(2) {
            val n = s.activatedCount(name)
            s.toggle(relative)
            s.waitLayout(relative, "SHOW_EDITOR")
            s.toggle(relative)
            s.waitActivated(name, n)
        }
        s.waitPageEqualsDocument(relative)
        checkZeroChanges(docId, relative)
    }

    private fun checkZeroChanges(docId: String, relative: String) {
        val counts = session.cdp.eval("[window.markdone.__debug.docChanges(${js(docId)}), window.markdone.__debug.nonUserDocChanges(${js(docId)})]")
            .jsonArray.map { it.jsonPrimitive.int }
        assertEquals("$relative: page doc changes since open [all, non-user]", listOf(0, 0), counts)
    }

    private class Key(val label: String, val keyStroke: String, val domKeyCode: Int, val modifiers: String, vararg val codes: Int)

    companion object {
        private val sessions = mutableMapOf<String, IdeSession>()
        private val failedStart = mutableMapOf<String, Throwable>()

        private fun js(s: String) = JsonPrimitive(s).toString()

        /** t28e: a file above a large-file limit of 1 MB (a little more than 2 MiB). */
        private const val LARGE_LIMIT_FILE = "m5/large-limit.md"

        // Sample counts.
        private const val WARM_OPENS = 20
        private const val TAB_SWITCHES = 101
        private const val TYPED_KEYS = 100
        private const val UNDO_STEPS = 100
        private const val JUMPS = 5
        private const val LIST_KEYS = 30
        private const val HEAVY_KEYS = 20

        /** CSP violation recorder in the shared page (once per page load): `window.__e2eCsp` = "directive blockedURI". */
        private const val CSP_RECORDER =
            "(() => { if (window.__e2eCsp) return true; window.__e2eCsp = []; " +
                "document.addEventListener('securitypolicyviolation', (e) => window.__e2eCsp.push(e.violatedDirective + ' ' + e.blockedURI)); return true; })()"

        // Big files (t29-t32).
        private const val HUGE = "huge/huge.md"
        private const val LIST = "huge/list-6mb.md"
        private const val VIEW_JS = IdeSession.VIEW

        /**
         * Page recorder for t31 (once per page load): on a Ctrl+End keydown, waits for the first
         * frame where the caret is at the end, the viewport reaches the end and a visible line has an
         * `md-*` decoration, then pushes keydown → after that frame's paint (ms, -1 after 30 s).
         */
        private val JUMP_RECORDER = """
            (() => {
              const w = window;
              if (w.__e2eJump) return true;
              const r = (w.__e2eJump = { results: [] });
              const view = () => $VIEW_JS;
              const decorated = (v) => {
                const box = v.scrollDOM.getBoundingClientRect();
                return [...v.contentDOM.querySelectorAll('.cm-line')].some((l) => {
                  const b = l.getBoundingClientRect();
                  return b.bottom > box.top && b.top < box.bottom && (l.className.includes('md-') || !!l.querySelector('[class*="md-"]'));
                });
              };
              w.addEventListener('keydown', (e) => {
                if (e.key !== 'End' || !e.ctrlKey) return;
                const t0 = performance.now();
                const tick = () => {
                  const v = view();
                  const len = v.state.doc.length;
                  if (v.state.selection.main.head === len && v.viewport.to === len && decorated(v)) {
                    const ch = new MessageChannel();
                    ch.port1.onmessage = () => r.results.push(performance.now() - t0);
                    ch.port2.postMessage(null);
                  } else if (performance.now() - t0 > 30000) r.results.push(-1);
                  else requestAnimationFrame(tick);
                };
                requestAnimationFrame(tick);
              }, true);
              return true;
            })()
        """.trimIndent()

        // t11: EDT hold and the delay between the queued Driver calls.
        private const val EDT_HOLD_MS = 300L
        private const val QUEUE_GAP_MS = 80L

        /** The inline-styles line of `styles/live-preview.md`. */
        private const val INLINE_LINE =
            "Text with **strong**, *em*, ~~strike~~, `code`, [link](https://example.com), <https://auto.example> and https://bare.example."

        /**
         * Page function (caretText, inlineLine) for t20: puts the caret on the first line with the text
         * caretText, waits two frames, checks one sample line per construct (lines other than the caret
         * line), and returns {caret, failures, markerLines, caretText, markersVisible}.
         */
        private val LIVE_PREVIEW_CHECK = """
            async (caretText, T) => {
              const v = document.querySelector('.cm-content').cmTile.root.view;
              const doc = v.state.doc;
              const find = (text, last) => { let n = -1; for (let i = 1; i <= doc.lines; i++) if (doc.line(i).text === text) { n = i; if (!last) break; } return n; };
              v.dispatch({ selection: { anchor: doc.line(find(caretText, false)).from + (caretText ? 1 : 0) } });
              for (let k = 0; k < 2; k++) await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
              const caret = doc.lineAt(v.state.selection.main.head).number;
              const lines = new Map();
              for (const el of v.contentDOM.querySelectorAll('.cm-line')) lines.set(doc.lineAt(v.posAtDOM(el)).number, el);
              const failures = [];
              const check = (label, text, last, test) => {
                const n = find(text, last);
                if (n < 0) { failures.push(label + ': no source line'); return; }
                if (n === caret) return;
                const el = lines.get(n);
                if (!el) failures.push(label + ': line ' + n + ' not in the DOM');
                else if (!test(el)) failures.push(label + ': line ' + n + ' class ' + JSON.stringify(el.className) + ' text ' + JSON.stringify(el.textContent.slice(0, 100)));
              };
              const has = (sel, text) => (el) => { const e = el.querySelector(sel); return !!e && (text === undefined || e.textContent === text); };
              const cls = (name) => (el) => el.classList.contains(name);
              const noMarkers = (el) => !el.querySelector('.md-marker');
              const both = (...tests) => (el) => tests.every((t) => t(el));
              check('md-frontmatter', 'title: Live preview', false, cls('md-frontmatter'));
              for (let i = 1; i <= 6; i++) check('md-h' + i, '#'.repeat(i) + ' Heading ' + i, false, both(cls('md-h' + i), (el) => el.textContent === 'Heading ' + i, noMarkers));
              check('md-strong', T, false, has('.md-strong', 'strong'));
              check('md-em', T, false, has('.md-em', 'em'));
              check('md-strike', T, false, has('.md-strike', 'strike'));
              check('md-code', T, false, has('.md-code', 'code'));
              check('md-link', T, false, has('.md-link', 'link'));
              check('inline markers hidden', T, false, both(noMarkers, (el) => !/\*|~~|`|\]\(|<https/.test(el.textContent)));
              check('md-bullet', '- bullet', false, has('.md-bullet'));
              check('md-task', '- [ ] open task', false, has('.md-task'));
              check('md-task (done)', '- [x] done task', false, has('.md-task'));
              check('md-list-number', '1. first', false, has('.md-list-number'));
              check('md-quote', '> quote line', false, cls('md-quote'));
              check('md-codeblock', 'print("fenced")', false, (el) => el.classList.contains('md-codeblock') && el.getAttribute('data-lang') === 'python');
              check('md-hr', '---', true, has('.md-hr'));
              check('md-footnote', 'Footnote reference[^note].', false, has('.md-footnote'));
              const html = (el) => el.classList.contains('md-html-source') || !!el.querySelector('.md-html-source');
              check('md-html-source (block)', '<div class="raw">raw <b>HTML</b></div>', false, html);
              check('md-html-source (inline)', 'Inline <span>html</span> tag.', false, html);
              const table = v.contentDOM.querySelector('.md-table');
              const cells = table ? [...table.querySelectorAll('th, td')].map((x) => x.textContent + ':' + (x.style.textAlign || '-')).join(' ') : '';
              if (cells !== 'A:- B:right 1:- 2:right') failures.push('md-table: ' + JSON.stringify(cells));
              const markerLines = [...lines].filter(([, el]) => !el.classList.contains('md-frontmatter') && el.querySelector('.md-marker')).map(([n]) => n).sort((a, b) => a - b);
              const caretEl = lines.get(caret);
              const markers = caretEl ? [...caretEl.querySelectorAll('.md-marker')] : [];
              const markersVisible = markers.every((m) => { const st = getComputedStyle(m); return st.display !== 'none' && st.visibility === 'visible' && m.getBoundingClientRect().width > 0; });
              return { caret, failures, markerLines, caretText: caretEl ? caretEl.textContent : null, markersVisible };
            }
        """.trimIndent()

        // DOM keyCode, and modifiers " <ctrl> <shift> <alt>" as the page listener writes them. e.code is not
        // usable: JCEF off-screen rendering reports wrong codes (Ctrl+Z gives "AudioVolumeDown").
        private val KEYS = listOf(
            Key("Ctrl+Z", "control Z", 90, "true false false", KeyEvent.VK_CONTROL, KeyEvent.VK_Z),
            Key("Ctrl+Shift+Z", "control shift Z", 90, "true true false", KeyEvent.VK_CONTROL, KeyEvent.VK_SHIFT, KeyEvent.VK_Z),
            Key("Ctrl+Y", "control Y", 89, "true false false", KeyEvent.VK_CONTROL, KeyEvent.VK_Y),
            Key("Ctrl+B", "control B", 66, "true false false", KeyEvent.VK_CONTROL, KeyEvent.VK_B),
            Key("Ctrl+I", "control I", 73, "true false false", KeyEvent.VK_CONTROL, KeyEvent.VK_I),
            Key("Tab", "TAB", 9, "false false false", KeyEvent.VK_TAB),
            Key("Shift+Tab", "shift TAB", 9, "false true false", KeyEvent.VK_SHIFT, KeyEvent.VK_TAB),
            Key("Enter", "ENTER", 13, "false false false", KeyEvent.VK_ENTER),
            Key("Ctrl+F", "control F", 70, "true false false", KeyEvent.VK_CONTROL, KeyEvent.VK_F),
            Key("Ctrl+A", "control A", 65, "true false false", KeyEvent.VK_CONTROL, KeyEvent.VK_A),
            Key("Ctrl+C", "control C", 67, "true false false", KeyEvent.VK_CONTROL, KeyEvent.VK_C),
            Key("Ctrl+V", "control V", 86, "true false false", KeyEvent.VK_CONTROL, KeyEvent.VK_V),
        )

        fun closeSession(mode: String) {
            sessions.remove(mode)?.close()
        }
    }
}
