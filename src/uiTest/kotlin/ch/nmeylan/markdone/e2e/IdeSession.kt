package ch.nmeylan.markdone.e2e

import com.intellij.driver.client.Driver
import com.intellij.driver.client.impl.JmxHost
import com.intellij.driver.model.LockSemantics
import com.intellij.driver.model.OnDispatcher
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.net.ServerSocket
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.PosixFilePermissions
import java.util.concurrent.TimeUnit
import kotlin.io.path.absolutePathString
import kotlin.io.path.createDirectories
import kotlin.io.path.exists
import kotlin.io.path.readLines
import kotlin.io.path.writeText

/** Paths and options passed by the `uiTest` Gradle task. */
object E2e {
    val root: Path = Path.of(System.getProperty("markdone.e2e.root") ?: error("run through ./gradlew uiTest"))
    val ide: Path = Path.of(System.getProperty("markdone.e2e.ide")!!)
    val plugin: Path = Path.of(System.getProperty("markdone.e2e.plugin")!!)
    val corpus: Path = root.resolve("src/test/resources/corpus")
    val work: Path = root.resolve("build/e2e")
    val reports: Path = root.resolve("build/reports/e2e")

    /** Comma list of JCEF modes to run: `inprocess`, `oop`. */
    val modes: Set<String> = (System.getProperty("markdone.e2e.modes") ?: "inprocess,oop").split(',').map { it.trim() }.toSet()
    val huge: Boolean = System.getProperty("markdone.e2e.huge") != "false"

    /** Environment `E2E_TESTS`: a regex; only test methods whose name matches it run (unset: all). */
    val testFilter: Regex? = System.getenv("E2E_TESTS")?.takeIf { it.isNotBlank() }?.let(::Regex)

    fun log(message: String) {
        val line = "[${java.time.LocalTime.now().withNano(0)}] $message"
        println(line)
        reports.createDirectories()
        Files.writeString(
            reports.resolve("l5.log"), line + "\n",
            java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.APPEND,
        )
    }

    fun freePort(): Int = ServerSocket(0).use { it.localPort }

    /** Polls [condition] until it is not null or [timeoutMs] passes. */
    fun <T : Any> waitFor(what: String, timeoutMs: Long, intervalMs: Long = 100, condition: () -> T?): T {
        val end = System.nanoTime() + timeoutMs * 1_000_000
        var last: Throwable? = null
        while (System.nanoTime() < end) {
            try {
                condition()?.let { return it }
            } catch (e: Exception) {
                last = e
            }
            Thread.sleep(intervalMs)
        }
        throw AssertionError("Timeout after $timeoutMs ms: $what (last error: $last)", last)
    }
}

/**
 * One sandbox IDE process: the resolved IDE (`bin/idea.sh`) with fresh config/system dirs, the
 * built plugin, a test project with a copy of the corpus, the Driver over JMX and the JCEF remote
 * debugging port.
 */
class IdeSession(
    val name: String,
    private val outOfProcess: Boolean,
    /** Copies corpus files into the project; called once before the start. */
    private val setupProject: (Path) -> Unit,
    /** JCEF cache dir (`ide.browser.jcef.cache.path`); cleared before the start unless [keepCache]. */
    private val cacheDir: Path = E2e.work.resolve("$name-jcef-cache"),
    private val keepCache: Boolean = false,
) : AutoCloseable {
    val dir: Path = E2e.work.resolve(name)
    val project: Path = dir.resolve("project")
    val perfFile: Path = E2e.reports.resolve("perf-ide-$name.jsonl")
    val cdpPort = E2e.freePort()
    private val jmxPort = E2e.freePort()
    @Volatile
    private var process: Process? = null
    lateinit var driver: Driver
    lateinit var ideProject: Project
    val cdp = Cdp(cdpPort)

    /** Wall time from process start to "project open and smart". */
    var startupMs = 0L

    fun start(): IdeSession {
        dir.toFile().deleteRecursively()
        if (!keepCache) cacheDir.toFile().deleteRecursively()
        for (sub in listOf("config", "system", "plugins", "log", "project/.idea")) dir.resolve(sub).createDirectories()
        // Without it, Git writes .idea/.gitignore some seconds after the open: an unnamed global undo step that a
        // test's Ctrl+Z then meets (confirmation dialog) or that splits a typing burst (t14/t27 flake).
        project.resolve(".idea/.gitignore").writeText("# Default ignored files\n/shelf/\n/workspace.xml\n")
        unzip(E2e.plugin, dir.resolve("plugins"))
        setupProject(project)
        Files.deleteIfExists(perfFile)
        E2e.reports.createDirectories()

        dir.resolve("idea.properties").writeText(
            """
            idea.config.path=${dir.resolve("config")}
            idea.system.path=${dir.resolve("system")}
            idea.plugins.path=${dir.resolve("plugins")}
            idea.log.path=${dir.resolve("log")}
            idea.max.content.load.filesize=40000
            """.trimIndent() + "\n",
        )
        dir.resolve("idea.vmoptions").writeText(
            listOf(
                // JBR picks the native Wayland toolkit on Wayland; java.awt.Robot needs X11 (Xvfb or Xwayland).
                "-Dawt.toolkit.name=XToolkit",
                "-Didea.trust.all.projects=true",
                "-Didea.initially.ask.config=never",
                "-Djb.consents.confirmation.enabled=false",
                "-Djb.privacy.policy.text=<!--999.999-->",
                "-Dide.show.tips.on.startup.default.value=false",
                "-Dide.no.platform.update=true",
                "-Dnosplash=true",
                // First-start "new UI" onboarding is a modal dialog that keeps the project in dumb mode.
                "-Dide.experimental.ui.onboarding=false",
                "-Dcom.sun.management.jmxremote=true",
                "-Dcom.sun.management.jmxremote.port=$jmxPort",
                "-Dcom.sun.management.jmxremote.rmi.port=$jmxPort",
                "-Dcom.sun.management.jmxremote.authenticate=false",
                "-Dcom.sun.management.jmxremote.ssl=false",
                "-Dcom.sun.management.jmxremote.host=127.0.0.1",
                // JDK 25 rejects the Driver's call arguments by default. Local test IDE only.
                "-Dcom.sun.management.jmxremote.serial.filter.pattern=*",
                "-Djava.rmi.server.hostname=127.0.0.1",
                "-Dide.browser.jcef.debug.port=$cdpPort",
                "-Dide.browser.jcef.out-of-process.enabled=$outOfProcess",
                "-Dide.browser.jcef.cache.path=${cacheDir.absolutePathString()}",
                "-Dmarkdone.perf.file=${perfFile.absolutePathString()}",
                "-Didea.log.debug.categories=#ch.nmeylan.markdone.perf",
            ).joinToString("\n") + "\n",
        )

        E2e.log("[$name] starting IDE (JCEF ${if (outOfProcess) "out-of-process" else "in-process"}, cdp $cdpPort, jmx $jmxPort)")
        val started = System.nanoTime()
        process = ProcessBuilder(E2e.ide.resolve("bin/idea.sh").toString(), project.toString())
            .redirectErrorStream(true)
            .redirectOutput(dir.resolve("log/stdout.log").toFile())
            .apply {
                environment()["IDEA_PROPERTIES"] = dir.resolve("idea.properties").toString()
                environment()["IDEA_VM_OPTIONS"] = dir.resolve("idea.vmoptions").toString()
            }
            .start()
        Runtime.getRuntime().addShutdownHook(Thread { kill() })
        if (Hypr.enabled) {
            // Keeps the IDE windows (also dialogs opened later) on the test workspace.
            val pid = process!!.pid()
            Thread {
                while (process?.isAlive == true) {
                    Hypr.moveWindows(pid)
                    Thread.sleep(500)
                }
            }.apply { isDaemon = true; name = "hypr-$name" }.start()
        }

        driver = E2e.waitFor("Driver connection on JMX port $jmxPort", 180_000, 1000) {
            check(process!!.isAlive) { "IDE exited with ${process!!.exitValue()}, see ${dir.resolve("log")}" }
            Driver.create(JmxHost(null, null, "127.0.0.1:$jmxPort"), false).takeIf { it.isConnected }
        }
        ideProject = E2e.waitFor("project open", 180_000, 500) {
            driver.service(ProjectManager::class).getOpenProjects().firstOrNull()?.takeIf { it.isInitialized() }
        }
        E2e.waitFor("smart mode", 120_000, 500) {
            true.takeIf { !driver.service(DumbService::class, ideProject).isDumb() }
        }
        startupMs = (System.nanoTime() - started) / 1_000_000
        E2e.log("[$name] IDE ready in $startupMs ms")
        // Without a window manager the frame can extend past the screen, where java.awt.Robot cannot click.
        if (System.getenv("MARKDONE_E2E_UNDER_XVFB") != null) {
            driver.withContext(OnDispatcher.EDT) { driver.service(WindowManager::class).getFrame(ideProject)?.setBounds(0, 0, 1800, 1000) }
        }
        return this
    }

    val pid: Long get() = process!!.pid()

    fun file(relative: String): VirtualFile =
        driver.utility(LocalFileSystemStatics::class).getInstance()
            .refreshAndFindFileByPath(project.resolve(relative).toString())
            ?: error("no file $relative")

    private fun editors(): FileEditorManager = driver.service(FileEditorManager::class, ideProject)

    /*
     * The Driver holds IDE objects by weak reference outside `withContext`; short-lived ones
     * (VirtualFile, events) are looked up and used inside one `withContext` block.
     */
    fun open(relative: String): Int = driver.withContext(OnDispatcher.EDT) { editors().openFile(file(relative), true).size }

    fun editorNames(relative: String): List<String> =
        driver.withContext(OnDispatcher.EDT) { editors().getAllEditors(file(relative)).map { it.getName() } }

    fun isWritable(relative: String): Boolean = driver.withContext { file(relative).isWritable() }

    fun close(relative: String) = driver.withContext(OnDispatcher.EDT) { editors().closeFile(file(relative)) }

    fun waitLayout(relative: String, layout: String) {
        E2e.waitFor("$relative in $layout", 3_000, 10) { true.takeIf { layout(relative) == layout } }
    }

    fun closeAll() = driver.withContext(OnDispatcher.EDT) {
        val fem = editors()
        for (f in fem.getOpenFiles()) fem.closeFile(f)
    }

    /** The open editor of [relative]; it stays valid while the file is open. */
    fun mdEditor(relative: String): MdEditor = driver.withContext {
        val editor = editors().getSelectedEditor(file(relative)) ?: error("$relative is not open")
        driver.cast(editor, MdEditor::class)
    }

    fun layout(relative: String): String? = driver.withContext(OnDispatcher.EDT) { mdEditor(relative).getLayout()?.name() }

    fun toggle(relative: String) {
        val editor = mdEditor(relative)
        driver.withContext(OnDispatcher.EDT) { editor.toggleMode() }
    }

    /** Brings the frame to the front and focuses [component]. */
    fun focus(component: Component) {
        // Robot keys go to the window that has the compositor's input focus.
        Hypr.focus(pid)
        focusInIde(component)
    }

    private fun focusInIde(component: Component) = driver.withContext(OnDispatcher.EDT) {
        driver.service(WindowManager::class).getFrame(ideProject)?.toFront()
        component.requestFocusInWindow()
    }

    /**
     * Presses [keys] (java.awt.event.KeyEvent codes, modifiers first) and releases them in
     * reverse, with java.awt.Robot in the IDE: OS-level events (XTest), so they go through the
     * IDE key dispatcher like real typing. The IDE window must have the X input focus.
     */
    fun press(vararg keys: Int) = driver.withContext {
        val robot = driver.new(Robot::class)
        for (k in keys) robot.keyPress(k)
        for (k in keys.reversed()) robot.keyRelease(k)
        robot.waitForIdle()
    }

    fun keymapActions(keyStroke: String): List<String> = driver.withContext {
        val ks = driver.utility(KeyStrokeStatics::class).getKeyStroke(keyStroke)
        driver.service(KeymapManager::class).getActiveKeymap().getActionIds(ks).toList()
    }

    fun keymapName(): String = driver.service(KeymapManager::class).getActiveKeymap().getName()

    /** `{"metric", "ms", "file"}` lines that the plugin wrote to `markdone.perf.file`. */
    fun perfLines(): List<Triple<String, Long, String>> {
        if (!perfFile.exists()) return emptyList()
        return perfFile.readLines().filter { it.isNotBlank() }.map {
            val o = Json.parseToJsonElement(it).jsonObject
            Triple(o["metric"]!!.jsonPrimitive.content, o["ms"]!!.jsonPrimitive.long, o["file"]!!.jsonPrimitive.content)
        }
    }

    fun perfValues(metric: String, fileName: String? = null): List<Long> =
        perfLines().filter { it.first == metric && (fileName == null || it.third == fileName) }.map { it.second }

    fun activatedCount(fileName: String) = perfValues(TOGGLE_METRIC, fileName).size

    /** Waits for the next `toggleToActivatedMs` of [fileName] after [before] earlier ones and returns its value. */
    fun waitActivated(fileName: String, before: Int, timeoutMs: Long = 30_000): Long =
        E2e.waitFor("$TOGGLE_METRIC for $fileName", timeoutMs, 20) { perfValues(TOGGLE_METRIC, fileName).getOrNull(before) }

    /**
     * Opens [relative] (Source), switches it to Edit and waits for `activated`.
     * Returns (toggleToActivatedMs, docId of the document in the page).
     */
    fun openInEdit(relative: String, timeoutMs: Long = 30_000): Pair<Long, String> {
        val name = Path.of(relative).fileName.toString()
        val before = activatedCount(name)
        open(relative)
        toggle(relative)
        val ms = waitActivated(name, before, timeoutMs)
        return ms to activeDocId()
    }

    /** Opens [relative] in Edit mode if it is not in Edit mode already; returns its docId. */
    fun ensureEdit(relative: String): String {
        open(relative)
        if (layout(relative) != "SHOW_PREVIEW") return openInEdit(relative).second
        return try {
            E2e.waitFor("$relative active in the page", 10_000) { activeDocId().takeIf { it.isNotEmpty() && pageText() == documentText(relative) } }
        } catch (e: AssertionError) {
            throw AssertionError("${e.message}; CDP pages: ${cdp.pages()}; renderers: ${jcefProcesses().count { it.type == "renderer" }}", e)
        }
    }

    fun activeDocId(): String = cdp.eval("window.markdone.__debug.activeDocId()").let { if (it is JsonNull) "" else it.jsonPrimitive.content }

    /** Text of the active document in the page (`EditorView` found from its DOM, as `EditorView.findFromDOM`). */
    fun pageText(): String = cdp.evalString("$VIEW.state.doc.toString()")

    /** Main selection `[anchor, head]` in the page. */
    fun pageSelection(): Pair<Int, Int> = cdp.eval("[$VIEW.state.selection.main.anchor, $VIEW.state.selection.main.head]").jsonArray
        .let { it[0].jsonPrimitive.int to it[1].jsonPrimitive.int }

    /** Sets the selection in the page and gives the editor DOM focus (not a document change). */
    fun setPageSelection(anchor: Int, head: Int = anchor) {
        cdp.eval("(() => { const v = $VIEW; v.dispatch({ selection: { anchor: $anchor, head: $head }, scrollIntoView: true }); v.focus(); return true; })()")
    }

    /** Waits until the page text equals the `Document` text; returns it. */
    fun waitPageEqualsDocument(relative: String, timeoutMs: Long = 5_000): String {
        var last = ""
        return try {
            E2e.waitFor("page text = Document text of $relative", timeoutMs, 50) {
                val doc = documentText(relative)
                last = doc
                doc.takeIf { pageText() == it }
            }
        } catch (e: AssertionError) {
            val page = pageText()
            val i = page.zip(last).indexOfFirst { (a, b) -> a != b }.let { if (it < 0) minOf(page.length, last.length) else it }
            throw AssertionError("${e.message}; lengths page ${page.length}, Document ${last.length}; first difference at $i: " +
                "page '${page.substring(i, minOf(page.length, i + 40))}' Document '${last.substring(i, minOf(last.length, i + 40))}'")
        }
    }

    private fun document(relative: String): Document =
        driver.utility(FileDocumentManagerStatics::class).getInstance().getDocument(file(relative)) ?: error("no Document for $relative")

    fun documentText(relative: String): String = driver.withReadAction { document(relative).getText() }

    fun documentLength(relative: String): Int = driver.withReadAction { document(relative).getTextLength() }

    fun documentStamp(relative: String): Long = driver.withReadAction { document(relative).getModificationStamp() }

    /** Runs [edit] on the `Document` of [relative] in one write command (as `WriteCommandAction`), on the EDT. */
    fun writeCommand(relative: String, edit: (Document) -> Unit) = driver.withContext(OnDispatcher.EDT, LockSemantics.WRITE_ACTION) {
        val commands = driver.utility(CommandProcessorStatics::class).getInstance()
        val policy = driver.utility(UndoConfirmationPolicyStatics::class).valueOf("DEFAULT")
        val token = commands.startCommand(ideProject, "e2e external change", "e2e", policy) ?: error("startCommand returned null")
        try {
            edit(document(relative))
        } finally {
            commands.finishCommand(token, null)
        }
    }

    /** Text content of the IDE clipboard (`CopyPasteManager`, which reads the system clipboard). */
    fun clipboardText(): String? = driver.withContext {
        val flavor = driver.new(DataFlavor::class, "application/x-java-serialized-object; class=java.lang.String")
        driver.utility(CopyPasteManagerStatics::class).getInstance().getContents(flavor)?.toString()
    }

    fun setClipboard(text: String) = driver.withContext(OnDispatcher.EDT) {
        driver.utility(CopyPasteManagerStatics::class).getInstance().setContents(driver.new(StringSelection::class, text))
    }

    /**
     * Moves the mouse to the screen point ([x], [y]) and clicks [buttonMask] (`InputEvent.BUTTONn_DOWN_MASK`) with java.awt.Robot,
     * with the keys [modifiers] (java.awt.event.KeyEvent codes) held down.
     */
    fun click(x: Int, y: Int, buttonMask: Int, vararg modifiers: Int) = driver.withContext {
        val robot = driver.new(Robot::class)
        robot.mouseMove(x, y)
        robot.waitForIdle()
        for (k in modifiers) robot.keyPress(k)
        robot.mousePress(buttonMask)
        robot.mouseRelease(buttonMask)
        for (k in modifiers.reversed()) robot.keyRelease(k)
        robot.waitForIdle()
    }

    /**
     * Moves the mouse to the screen point ([x], [y]) and turns the wheel [notches] (java.awt.Robot; positive = down,
     * one wheel button event per notch), with the keys [modifiers] held down.
     */
    fun wheel(x: Int, y: Int, notches: Int, vararg modifiers: Int) = driver.withContext {
        val robot = driver.new(Robot::class)
        robot.mouseMove(x, y)
        robot.waitForIdle()
        for (k in modifiers) robot.keyPress(k)
        robot.mouseWheel(notches)
        for (k in modifiers.reversed()) robot.keyRelease(k)
        robot.waitForIdle()
    }

    /** Moves the mouse to the screen point ([x], [y]) with java.awt.Robot (hover). */
    fun moveMouse(x: Int, y: Int) = driver.withContext {
        val robot = driver.new(Robot::class)
        robot.mouseMove(x, y)
        robot.waitForIdle()
    }

    /** Synchronous VFS refresh of [relative] (a file or directory that the VFS knows), as after an external change. */
    fun refresh(relative: String, recursive: Boolean = false) = driver.withContext { file(relative).refresh(false, recursive) }

    /** One JCEF helper process (or `cef_server`) under the IDE process. */
    data class JcefProcess(val pid: Long, val type: String, val pssKb: Long, val cmd: String)

    /**
     * The JCEF processes under the IDE process: type from `--type=` (`renderer`, `gpu-process`,
     * `utility`, `zygote`), or `cef_server` for the out-of-process CEF server itself. PSS from
     * `/proc/<pid>/smaps_rollup`.
     */
    fun jcefProcesses(): List<JcefProcess> = ProcessHandle.of(pid).orElseThrow().descendants().toList().mapNotNull { p ->
        val cmd = try {
            Files.readString(Path.of("/proc/${p.pid()}/cmdline")).replace('\u0000', ' ')
        } catch (_: Exception) {
            return@mapNotNull null
        }
        val type = Regex("--type=([a-z-]+)").find(cmd)?.groupValues?.get(1) ?: if ("cef_server" in cmd || "jcef_helper" in cmd) "cef_server" else return@mapNotNull null
        val pss = try {
            Path.of("/proc/${p.pid()}/smaps_rollup").readLines().firstOrNull { it.startsWith("Pss:") }?.split(Regex("\\s+"))?.get(1)?.toLong() ?: 0
        } catch (_: Exception) {
            0L
        }
        JcefProcess(p.pid(), type, pss, cmd.take(160))
    }

    override fun close() {
        val p = process ?: return
        E2e.log("[$name] stopping IDE")
        try {
            driver.exitApplication()
        } catch (_: Exception) {
        }
        try {
            driver.close()
        } catch (_: Exception) {
        }
        if (!p.waitFor(30, TimeUnit.SECONDS)) kill()
        process = null
    }

    private fun kill() {
        val p = process ?: return
        p.descendants().forEach { it.destroyForcibly() }
        p.destroyForcibly()
    }

    companion object {
        const val TOGGLE_METRIC = "toggleToActivatedMs"

        /** The page's `EditorView`, found from its DOM as `EditorView.findFromDOM` does (CodeMirror 6.43 tiles). */
        const val VIEW = "document.querySelector('.cm-content').cmTile.root.view"

        fun unzip(zip: Path, target: Path) {
            val code = ProcessBuilder("unzip", "-q", "-o", zip.toString(), "-d", target.toString()).inheritIO().start().waitFor()
            check(code == 0) { "unzip failed: $zip" }
        }

        /** Copies corpus files (paths relative to the corpus) into the project. */
        fun copy(project: Path, vararg pairs: Pair<String, String>) {
            for ((from, to) in pairs) {
                val target = project.resolve(to)
                target.parent.createDirectories()
                Files.copy(E2e.corpus.resolve(from), target)
            }
        }

        fun makeReadOnly(file: Path) = Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("r--r--r--"))
    }
}
