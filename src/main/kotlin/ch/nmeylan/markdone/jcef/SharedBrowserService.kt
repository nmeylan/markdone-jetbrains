package ch.nmeylan.markdone.jcef

import com.google.gson.JsonObject
import com.intellij.ide.BrowserUtil
import com.intellij.ide.DataManager
import com.intellij.ide.trustedProjects.TrustedProjects
import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.ActionGroup
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.PlatformCoreDataKeys
import com.intellij.openapi.actionSystem.impl.SimpleDataContext
import com.intellij.openapi.application.ApplicationListener
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ex.ApplicationManagerEx
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.ReadAction
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.editor.Document
import com.intellij.openapi.editor.colors.EditorColorsListener
import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileDocumentManagerListener
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.project.VetoableProjectManagerListener
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.ui.JBColor
import ch.nmeylan.markdone.actions.PageSelection
import ch.nmeylan.markdone.actions.PageTable
import ch.nmeylan.markdone.actions.TableActions
import ch.nmeylan.markdone.actions.TableEdit
import ch.nmeylan.markdone.css.UserCssService
import ch.nmeylan.markdone.editor.Perf
import ch.nmeylan.markdone.editor.WebEditor
import ch.nmeylan.markdone.settings.MdProjectSettings
import ch.nmeylan.markdone.settings.MdSettings
import ch.nmeylan.markdone.sync.DocVersion
import ch.nmeylan.markdone.sync.DocumentSync
import ch.nmeylan.markdone.sync.LinkKind
import ch.nmeylan.markdone.sync.PageMessage
import ch.nmeylan.markdone.sync.WebView
import java.net.URI
import java.nio.file.Path
import java.security.SecureRandom
import java.util.HexFormat
import java.util.concurrent.ConcurrentHashMap

/**
 * The browsers of the Edit views. One page hosts many documents: one browser is
 * created on the first Edit-mode use; a second one only while two Edit views are on screen at the
 * same time. The browser component moves into the visible [WebEditor]. All methods run on the EDT.
 */
@Service(Service.Level.APP)
class SharedBrowserService : Disposable {

    // Test seams: the default values are the JCEF browser and the EDT.
    internal var factory: PageFactory = JcefPage.FACTORY
    internal var runOnEdt: (() -> Unit) -> Unit = { ApplicationManager.getApplication().invokeLater(it, ModalityState.nonModal()) }
    internal var syncScheduler: DocumentSync.Scheduler = DocumentSync.Scheduler.EDT
    internal var remoteImagesSetting: () -> Boolean = { MdSettings.getInstance().remoteImages }
    internal var projectTrusted: (Project) -> Boolean = { TrustedProjects.isProjectTrusted(it) }

    /** Requests the project close again after the flush (see [canCloseProject]). */
    internal var closeProject: (Project) -> Unit = { ProjectManager.getInstance().closeAndDispose(it) }

    /** Requests the IDE exit ([restart] = false) or restart again after the flush (see [canExit]). */
    internal var exitApplication: (Boolean) -> Unit = { restart ->
        val app = ApplicationManagerEx.getApplicationEx()
        if (restart) app.restart(true) else app.exit(false, true)
    }

    /** Loads the user CSS of a project (with its projectToken) off the EDT and calls back on the EDT. */
    internal var loadCss: (Project, String, (UserCssService.UserCss) -> Unit) -> Unit = { project, token, done ->
        ApplicationManager.getApplication().executeOnPooledThread {
            val css = UserCssService.getInstance().load(project, token)
            ApplicationManager.getApplication().invokeLater({ done(css) }, ModalityState.any())
        }
    }

    /** One open `Document`, shared by all tabs of the file. */
    internal class DocRef(val docId: String, val document: Document, val source: AssetRequestHandler.DocSource) {
        val editors = LinkedHashSet<WebEditor>()
    }

    /** One browser and the documents open in its page. */
    internal inner class Session {
        var page: PageHost? = null
        var ready = false
        var host: WebEditor? = null
        var activeDocId: String? = null
        val syncs = LinkedHashMap<String, DocumentSync>()

        // The last `viewport` per docId of this page load (protocol 2.4); a flush of the hosted editor removes its entry.
        val viewports = HashMap<String, WebEditor.Place>()

        // The remote-images setting of the loaded page: its CSP depends on it.
        @Volatile
        var remoteImages = false

        // The last `css` message sent to this page load; a new request makes older results stale.
        var cssSent: JsonObject? = null
        var cssGeneration = 0

        // Global CSS and project CSS path of the last CSS request: other setting changes do not load the CSS again.
        var cssInputs: Pair<String, String>? = null

        // The last `theme` and `settings` messages sent to this page load; an identical one is not sent again.
        var themeSent: JsonObject? = null
        var settingsSent: JsonObject? = null

        // Project and trust state of the last CSS request; while a request for a new one runs, `activate` waits.
        var cssKey: Pair<Project, Boolean>? = null
        var cssPending = false
        var cssUntrusted = false

        // One random projectToken per project with a document open in this page (protocol 2.2).
        val projectTokens = HashMap<Project, String>()

        // Read by the resource handler on pooled threads.
        val sources = ConcurrentHashMap<String, AssetRequestHandler.DocSource>()
        val projects = ConcurrentHashMap<String, AssetRequestHandler.ProjectSource>()

        // Before `ready` the page cannot receive messages; `ready` (re)sends everything.
        val view = object : WebView {
            override fun send(message: JsonObject) {
                if (ready) page?.send(message)
            }
        }
    }

    private val docs = LinkedHashMap<Document, DocRef>()
    private val byId = HashMap<String, DocRef>()
    internal val sessions = ArrayList<Session>()
    private val visible = LinkedHashSet<WebEditor>()
    private val crashTimes = ArrayDeque<Long>()

    // Documents that saveAgain saves now: their save does not flush again.
    private val saving = HashSet<Document>()

    // Project close and IDE exit (canCloseProject, canExit): flushes in progress, and requests let through.
    private val flushingBeforeClose = HashSet<Project>()
    private val allowedClose = HashSet<Project>()
    private var flushingBeforeExit = false
    private var exitAllowed = false

    /** The renderer crashed too often: no browser is created any more, Edit views show a message. */
    internal var unavailable = false
        private set

    init {
        val connection = ApplicationManager.getApplication().messageBus.connect(this)
        connection.subscribe(MdSettings.TOPIC, MdSettings.Listener { settingsChanged() })
        connection.subscribe(UserCssService.TOPIC, UserCssService.Listener { projectCssChanged(it) })
        // IDE theme follow (protocol 2.3): look-and-feel, color scheme, editor font (its apply switches the scheme).
        connection.subscribe(LafManagerListener.TOPIC, LafManagerListener { themeChanged() })
        connection.subscribe(EditorColorsManager.TOPIC, EditorColorsListener { themeChanged() })
        connection.subscribe(FileDocumentManagerListener.TOPIC, object : FileDocumentManagerListener {
            override fun beforeDocumentSaving(document: Document) = this@SharedBrowserService.beforeDocumentSaving(document)
        })
        val veto = object : VetoableProjectManagerListener {
            override fun canClose(project: Project) = canCloseProject(project)
        }
        ProjectManager.getInstance().addProjectManagerListener(veto)
        Disposer.register(this) { ProjectManager.getInstance().removeProjectManagerListener(veto) }
        ApplicationManager.getApplication().addApplicationListener(object : ApplicationListener {
            override fun canExitApplication() = canExit(restart = false)
            override fun canRestartApplication() = canExit(restart = true)
        }, this)
    }

    /**
     * [editor] is on screen in Edit mode: it gets a browser, and its document is opened and activated.
     * When every browser is in use by a visible view, the choice waits until the current EDT event is
     * done: in a tab switch the old view is often hidden after the new one is shown, and then the new
     * view takes its browser. A second browser is made only when the other view is still visible.
     */
    fun shown(editor: WebEditor) {
        if (unavailable) {
            editor.showUnavailable()
            return
        }
        val hosting = sessions.firstOrNull { it.host === editor }
        if (!visible.add(editor) && hosting != null) return
        val doc = docs.getOrPut(editor.document) {
            val version = DocVersion(editor.document)
            DocRef(newDocId(), editor.document, AssetRequestHandler.DocSource(editor.document, editor.file, editor.project, version))
                .also { byId[it.docId] = it }
        }
        doc.editors += editor
        val session = hosting ?: freeSession() ?: if (sessions.isEmpty()) newSession() else null
        if (session != null) {
            show(session, editor, doc)
            return
        }
        runOnEdt {
            if (!unavailable && editor in visible && sessions.none { it.host === editor } && docs[editor.document] === doc) {
                show(freeSession() ?: newSession(), editor, doc)
            }
        }
    }

    private fun freeSession(): Session? = sessions.firstOrNull { s -> s.host.let { it == null || it !in visible } }

    private fun newSession(): Session = Session().also {
        sessions += it
        createPage(it)
    }

    /** Moves [session]'s browser into [editor] and activates [doc] there. */
    private fun show(session: Session, editor: WebEditor, doc: DocRef) {
        if (session.host !== editor) {
            val component = session.page!!.component
            session.host?.detachBrowser(component)
            editor.attachBrowser(component)
            session.host = editor
        }
        val sync = session.syncs.getOrPut(doc.docId) { newSync(session, doc) }
        session.activeDocId = doc.docId
        val project = doc.source.project
        if (session.ready && session.cssKey != (project to projectTrusted(project))) {
            // Another project or trust state: its `css` goes first, then `activate` (protocol 2.2).
            updateCss(session, gate = true)
            return
        }
        editor.showProjectCssNotice(session.cssUntrusted)
        if (sync.isOpened && !session.cssPending) sendActivate(session, doc.docId)
    }

    /** [editor] left the screen. An extra browser is released; the first one stays. */
    fun hidden(editor: WebEditor) {
        if (!visible.remove(editor)) return
        val session = sessions.firstOrNull { it.host === editor } ?: return
        if (session === sessions.first()) return
        // Later: in a tab switch the next view can be shown after this one is hidden.
        runOnEdt { if (session in sessions && session.host.let { it == null || it !in visible }) flushThenRelease(session) }
    }

    /** Runs undo or redo for [editor]'s document after a flush; nothing without a page. */
    fun undoRedo(editor: WebEditor, redo: Boolean) {
        val docId = docs[editor.document]?.docId
        sessions.firstOrNull { it.host === editor }?.syncs?.get(docId)?.undoRedo(redo)
    }

    /**
     * [editor] is disposed. When it was the last editor of its document, each page first flushes the
     * document (its pending edits reach the `Document`; ack or [DocumentSync.CLOSE_FLUSH_TIMEOUT_MS]), then
     * closes it. Until then the document stays known, so the flush reply is applied.
     */
    fun unregister(editor: WebEditor) {
        visible.remove(editor)
        for (session in sessions.toList()) {
            if (session.host !== editor) continue
            session.page?.let { editor.detachBrowser(it.component) }
            session.host = null
            if (session !== sessions.first()) flushThenRelease(session)
        }
        val doc = docs[editor.document] ?: return
        if (!doc.editors.remove(editor) || doc.editors.isNotEmpty()) return
        docs.remove(doc.document)
        val closing = sessions.mapNotNull { session -> session.syncs[doc.docId]?.let { session to it } }
        var waiting = closing.size + 1
        val forget = {
            if (--waiting == 0) {
                byId.remove(doc.docId)
                Disposer.dispose(doc.source.version)
            }
        }
        for ((session, sync) in closing) {
            if (session.activeDocId == doc.docId) session.activeDocId = null
            // A release or a new page load meanwhile completes the flush: then the sync is already gone.
            sync.flush(DocumentSync.CLOSE_FLUSH_TIMEOUT_MS) {
                if (session.syncs[doc.docId] === sync) {
                    session.syncs.remove(doc.docId)
                    session.viewports.remove(doc.docId)
                    session.sources.remove(doc.docId)
                    sync.close()
                    Disposer.dispose(sync)
                    // The last document of its project in this page: the token goes (no reference to a closed project).
                    val project = doc.source.project
                    if (session.syncs.keys.none { byId[it]?.source?.project === project }) {
                        session.projectTokens.remove(project)?.let { session.projects.remove(it) }
                    }
                }
                forget()
            }
        }
        forget()
    }

    /**
     * A save of [document] first gets the page's pending edits. The EDT cannot wait for
     * the page's reply (it comes as a later EDT event), so this save writes the text it has; when
     * the flush then changes the document, it is saved once more (that second save does not flush).
     */
    internal fun beforeDocumentSaving(document: Document) {
        if (document in saving) return
        val doc = docs[document] ?: return
        val syncs = sessions.mapNotNull { it.syncs[doc.docId]?.takeIf { sync -> sync.isOpened } }
        if (syncs.isEmpty()) return
        val before = doc.source.version.value
        var waiting = syncs.size
        for (sync in syncs) {
            sync.flush {
                if (--waiting == 0 && doc.source.version.value != before) runOnEdt { saveAgain(document) }
            }
        }
    }

    /**
     * A project close would dispose the pages' documents of [project] at once, and edits that a page still
     * holds would be lost. When such a document is open in a page, the first request is refused,
     * every page flushes (ack or [DocumentSync.CLOSE_FLUSH_TIMEOUT_MS]), then the close is requested again
     * and let through. The EDT never waits.
     */
    internal fun canCloseProject(project: Project): Boolean {
        if (exitAllowed || project in allowedClose) return true
        if (project in flushingBeforeClose) return false
        val syncs = openedSyncs { it.source.project === project }
        if (syncs.isEmpty()) return true
        flushingBeforeClose += project
        flushAll(syncs) {
            flushingBeforeClose -= project
            runOnEdt {
                if (project.isDisposed) return@runOnEdt
                allowedClose += project
                try {
                    closeProject(project)
                } finally {
                    allowedClose -= project
                }
            }
        }
        return false
    }

    /** As [canCloseProject], for the IDE exit or restart: all documents of all pages. */
    internal fun canExit(restart: Boolean): Boolean {
        if (exitAllowed) return true
        if (flushingBeforeExit) return false
        val syncs = openedSyncs { true }
        if (syncs.isEmpty()) return true
        flushingBeforeExit = true
        flushAll(syncs) {
            flushingBeforeExit = false
            // Stays set: the exit closes the projects next, and they must not be refused.
            exitAllowed = true
            runOnEdt { exitApplication(restart) }
        }
        return false
    }

    /** The syncs of documents open in a page (the page can hold edits for them) whose [DocRef] matches. */
    private fun openedSyncs(filter: (DocRef) -> Boolean): List<DocumentSync> = sessions.flatMap { session ->
        session.syncs.entries.filter { (id, sync) -> sync.isOpened && byId[id]?.let(filter) == true }.map { it.value }
    }

    /** Flushes [syncs] with the long timeout; [done] once all are complete. */
    private fun flushAll(syncs: List<DocumentSync>, done: () -> Unit) {
        var waiting = syncs.size
        syncs.forEach { it.flush(DocumentSync.CLOSE_FLUSH_TIMEOUT_MS) { if (--waiting == 0) done() } }
    }

    private fun saveAgain(document: Document) {
        val manager = FileDocumentManager.getInstance()
        if (!manager.isDocumentUnsaved(document)) return
        saving += document
        try {
            manager.saveDocument(document)
        } finally {
            saving -= document
        }
    }

    /**
     * Flushes the page edits of [editor]'s document (see [DocumentSync.flush]); [onDone] at once without a page.
     * [onDone] gets the `viewport` that the page of [editor] sent after this flush (protocol 2.4), else null.
     */
    fun flush(editor: WebEditor, onDone: (WebEditor.Place?) -> Unit) {
        val docId = docs[editor.document]?.docId
        val session = sessions.firstOrNull { it.host === editor }
        val sync = session?.syncs?.get(docId)
        if (session == null || docId == null || sync == null) {
            onDone(null)
            return
        }
        session.viewports.remove(docId)
        sync.flush {
            val place = session.viewports[docId]
            if (place == null) LOG.debug("Flush of $docId completed without a viewport; the text editor keeps its place")
            onDone(place)
        }
    }

    /** Handles a validated message of [session]'s current page. */
    internal fun receive(session: Session, message: PageMessage) {
        if (message is PageMessage.Ready) {
            onReady(session)
            return
        }
        message as PageMessage.ForDoc
        val sync = session.syncs[message.docId]
        val doc = byId[message.docId]
        if (sync == null || doc == null) {
            LOG.warn("Dropped a '${message.javaClass.simpleName}' message for a document that is not open in this page")
            return
        }
        when (message) {
            is PageMessage.Opened, is PageMessage.Patch, is PageMessage.Diverged -> sync.receive(message)
            is PageMessage.Activated -> {
                val editor = session.host?.takeIf { it.document === doc.document } ?: return
                val start = editor.toggleStartNanos
                if (start != 0L) {
                    editor.toggleStartNanos = 0L
                    Perf.record("toggleToActivatedMs", (System.nanoTime() - start) / 1_000_000, doc.source.file.name)
                }
                val switchStart = editor.tabSwitchStartNanos
                if (switchStart != 0L) {
                    editor.tabSwitchStartNanos = 0L
                    Perf.record("tabSwitchMs", (System.nanoTime() - switchStart) / 1_000_000, doc.source.file.name)
                }
            }
            is PageMessage.LoadError -> LOG.warn("The page could not load ${doc.source.file.name}: ${message.reason}")
            is PageMessage.Link -> openLink(doc, message)
            is PageMessage.Command -> when (message.name) {
                "undo", "redo" -> sync.receive(message)
                "toggleMode" -> editorOf(session, doc)?.owner?.toggleMode()
                // The page handles Mod-f itself (find panel).
                "find" -> LOG.debug("find command ignored")
                // The setting change sends `theme` to every page (settingsChanged).
                "zoomIn" -> MdSettings.getInstance().zoomIn()
                "zoomOut" -> MdSettings.getInstance().zoomOut()
                "zoomReset" -> MdSettings.getInstance().zoomReset()
            }
            is PageMessage.ContextMenu -> sync.flush {
                if (session.syncs[doc.docId] === sync) showContextMenu(session, doc, sync, message)
            }
            // The table range is in page coordinates: after the flush they are Document offsets.
            is PageMessage.TableAction -> {
                val action = TableEdit.Action.of(message.action) ?: return
                sync.flush {
                    if (session.syncs[doc.docId] === sync) TableActions.perform(doc.source.project, doc.document, message.cell, action)
                }
            }
            is PageMessage.GotoSource -> editorOf(session, doc)?.owner?.gotoSource(message.pos)
            is PageMessage.Viewport -> session.viewports[doc.docId] = WebEditor.Place(message.top, message.anchor, message.head)
        }
    }

    /**
     * Settings changed: a page whose CSP no longer matches is loaded again; the others get the new
     * `settings`, `theme` (zoom) and CSS.
     */
    internal fun settingsChanged() {
        val remote = remoteImagesSetting()
        for (session in sessions) {
            if (session.remoteImages != remote) {
                reloadPage(session, remote)
            } else {
                sendIfChanged(session, settingsMessage(session))
                sendIfChanged(session, theme())
                val project = session.activeDocId?.let { byId[it] }?.source?.project
                if (project != null && cssInputs(project) != session.cssInputs) updateCss(session)
            }
        }
    }

    private fun cssInputs(project: Project) = MdSettings.getInstance().globalCss to MdProjectSettings.getInstance(project).projectCssPath

    /** The IDE look-and-feel, color scheme or editor font changed: every page gets the new `theme`. */
    internal fun themeChanged() {
        val message = theme()
        sessions.forEach { sendIfChanged(it, message) }
    }

    /** Sends a `theme` or `settings` [message] to a ready page unless it is the last one of its type sent there. */
    private fun sendIfChanged(session: Session, message: JsonObject) {
        if (!session.ready) return
        val settings = message["type"].asString == "settings"
        if (message == (if (settings) session.settingsSent else session.themeSent)) return
        if (settings) session.settingsSent = message else session.themeSent = message
        session.view.send(message)
    }

    /** All fields of `settings` (protocol 2.3); `remoteImages` is the one of the loaded page (its CSP). */
    private fun settingsMessage(session: Session): JsonObject {
        val settings = MdSettings.getInstance()
        return JsonObject().apply {
            addProperty("type", "settings")
            addProperty("remoteImages", session.remoteImages)
            addProperty("math", settings.math)
            addProperty("mermaid", settings.mermaid)
            addProperty("highlight", settings.highlight)
            addProperty("softBreaks", settings.softBreaks)
            addProperty("style", settings.style.id)
        }
    }

    /** The project CSS of [project] changed: pages that show a document of [project] get the new CSS. */
    internal fun projectCssChanged(project: Project) {
        for (session in sessions) {
            val doc = session.activeDocId?.let { byId[it] } ?: continue
            if (doc.source.project === project) updateCss(session)
        }
    }

    /** Flushes every document of [session] (ack or 500 ms timeout each), then loads the page again. */
    private fun reloadPage(session: Session, remoteImages: Boolean) {
        val page = session.page ?: return
        session.remoteImages = remoteImages
        val syncs = session.syncs.values.toList()
        var waiting = syncs.size + 1
        val done = {
            if (--waiting == 0 && session.page === page && session in sessions) {
                session.viewports.clear()
                session.syncs.values.toList().forEach { it.pageGone() }
                session.ready = false
                // `ready` of the new page load opens the documents again.
                page.reload()
            }
        }
        syncs.forEach { it.flush(onDone = done) }
        done()
    }

    /**
     * Sends the `css` of the project of [session]'s active document when it differs from the last one sent.
     * With [gate], `activate` of the active document waits for it (sent after it, or after `opened`).
     */
    private fun updateCss(session: Session, gate: Boolean = false) {
        if (!session.ready) return
        val doc = session.activeDocId?.let { byId[it] } ?: return
        val project = doc.source.project
        session.cssKey = project to projectTrusted(project)
        session.cssInputs = cssInputs(project)
        if (gate) session.cssPending = true
        val token = session.projectTokens.getOrPut(project) {
            newDocId().also { session.projects[it] = projectSource(project) }
        }
        val generation = ++session.cssGeneration
        loadCss(project, token) { css ->
            if (session !in sessions || !session.ready || session.cssGeneration != generation) return@loadCss
            session.cssUntrusted = css.untrusted
            doc.editors.forEach { it.showProjectCssNotice(css.untrusted) }
            val message = JsonObject().apply {
                addProperty("type", "css")
                addProperty("global", css.global)
                addProperty("project", css.project)
            }
            if (message != session.cssSent) {
                session.cssSent = message
                session.view.send(message)
            }
            // A newer request drops the older result, so the last result sends the waiting `activate`.
            if (session.cssPending) {
                session.cssPending = false
                val active = session.activeDocId
                if (active != null && session.syncs[active]?.isOpened == true) sendActivate(session, active)
            }
        }
    }

    private fun onReady(session: Session) {
        // A second `ready` means the page loaded again: it has no document state.
        session.viewports.clear()
        if (session.ready) session.syncs.values.toList().forEach { it.pageGone() }
        session.ready = true
        session.themeSent = null
        session.settingsSent = null
        sendIfChanged(session, theme())
        session.syncs.values.forEach { it.open() }
        // `activate` follows each `opened` of the active document.
        sendIfChanged(session, settingsMessage(session))
        session.cssSent = null
        session.cssKey = null
        updateCss(session, gate = true)
    }

    private fun newSync(session: Session, doc: DocRef): DocumentSync {
        session.sources[doc.docId] = doc.source
        val listener = object : DocumentSync.Listener {
            override fun onOpened() {
                if (session.activeDocId == doc.docId && !session.cssPending) sendActivate(session, doc.docId)
            }

            override fun undoEditor() = editorOf(session, doc)?.owner?.textEditor
        }
        return DocumentSync(doc.docId, doc.source.project, doc.document, doc.source.version, session.view, listener, syncScheduler)
            .also { if (session.ready) it.open() }
    }

    private fun sendActivate(session: Session, docId: String) {
        // Source → Edit (protocol 2.4): the text editor's first visible line and selection, once.
        val editor = session.host?.takeIf { it.document === byId[docId]?.document }
        val place = editor?.sourcePlace
        editor?.sourcePlace = null
        // The page gets the pending Source edits first, so the offsets refer to its text.
        if (place != null) session.syncs[docId]?.sendChanges()
        session.view.send(JsonObject().apply {
            addProperty("type", "activate")
            addProperty("docId", docId)
            if (place != null) {
                addProperty("top", place.top)
                add("selection", JsonObject().apply {
                    addProperty("anchor", place.anchor)
                    addProperty("head", place.head)
                })
            }
        })
    }

    /** The editor that shows [doc] in [session], else any editor of [doc]. */
    private fun editorOf(session: Session, doc: DocRef): WebEditor? =
        session.host?.takeIf { it.document === doc.document } ?: doc.editors.firstOrNull()

    private fun createPage(session: Session) {
        var created: PageHost? = null
        val isCurrent = { created != null && session.page === created && session in sessions }
        session.remoteImages = remoteImagesSetting()
        created = factory.create(
            AssetRequestHandler({ session.sources[it] }, { session.remoteImages }, { session.projects[it] }),
            { message -> runOnEdt { if (isCurrent()) receive(session, message) } },
            { runOnEdt { if (isCurrent()) recover(session) } },
        )
        session.page = created
        session.ready = false
    }

    /** The renderer process ended: a new browser loads the page; `ready` then opens the documents again. */
    internal fun recover(session: Session) {
        val now = System.currentTimeMillis()
        crashTimes.addLast(now)
        while (crashTimes.first() < now - 60_000) crashTimes.removeFirst()
        if (crashTimes.size > MAX_CRASHES_PER_MINUTE) {
            LOG.warn("The renderer ended ${crashTimes.size} times in one minute; the browser is not created again")
            // The syncs are disposed with their sessions: flushes complete at once, nothing waits for the page.
            unavailable = true
            val editors = LinkedHashSet<WebEditor>(visible)
            sessions.forEach { s -> s.host?.let { editors += it } }
            sessions.toList().forEach(::release)
            editors.forEach { it.showUnavailable() }
            return
        }
        val old = session.page ?: return
        session.viewports.clear()
        session.syncs.values.toList().forEach { it.pageGone() }
        session.host?.detachBrowser(old.component)
        old.dispose()
        createPage(session)
        session.host?.attachBrowser(session.page!!.component)
    }

    /**
     * Releases an extra browser after its documents are flushed (their pending edits reach the
     * `Document`); not when a view took it again meanwhile.
     */
    private fun flushThenRelease(session: Session) {
        val syncs = session.syncs.values.toList()
        var waiting = syncs.size + 1
        val done = {
            if (--waiting == 0 && session in sessions && session !== sessions.first() && session.host.let { it == null || it !in visible }) {
                release(session)
            }
        }
        syncs.forEach { it.flush(DocumentSync.CLOSE_FLUSH_TIMEOUT_MS, done) }
        done()
    }

    private fun release(session: Session) {
        sessions.remove(session)
        session.viewports.clear()
        // Cleared first: a flush that the dispose completes then finds its sync gone.
        val syncs = session.syncs.values.toList()
        session.syncs.clear()
        syncs.forEach { Disposer.dispose(it) }
        session.sources.clear()
        session.projectTokens.clear()
        session.projects.clear()
        session.page?.let {
            session.host?.detachBrowser(it.component)
            it.dispose()
        }
        session.page = null
        session.host = null
    }

    private fun showContextMenu(session: Session, doc: DocRef, sync: DocumentSync, message: PageMessage.ContextMenu) {
        val page = session.page ?: return
        val editor = session.host?.takeIf { it.document === doc.document } ?: return
        if (!page.component.isShowing) return
        val actions = ActionManager.getInstance()
        val group = actions.getAction(CONTEXT_MENU_GROUP) as? ActionGroup ?: return
        val length = doc.document.textLength
        val selection = PageSelection(doc.source.project, doc.document, sync, message.from.coerceAtMost(length), message.to.coerceAtMost(length))
        val table = message.table?.takeIf { it.to <= length }?.let { PageTable(doc.source.project, doc.document, it.from, it.to, it.row, it.column) }
        val menu = actions.createActionPopupMenu(ActionPlaces.getPopupPlace(CONTEXT_MENU_GROUP), group)
        menu.setTargetComponent(page.component)
        menu.setDataContext { contextMenuData(DataManager.getInstance().getDataContext(page.component), editor, selection, table) }
        val point = page.toComponentPoint(message.x, message.y)
        menu.component.show(page.component, point.x, point.y)
    }

    /** Opens a link of [doc]: checks the syntax here, resolves a relative path on a pooled thread, opens it on the EDT. */
    private fun openLink(doc: DocRef, link: PageMessage.Link) {
        val href = link.href
        val project = doc.source.project
        when (link.kind) {
            LinkKind.ANCHOR -> Unit
            LinkKind.EXTERNAL -> {
                val scheme = try {
                    URI(href).scheme?.lowercase()
                } catch (_: Exception) {
                    null
                }
                if (scheme !in EXTERNAL_SCHEMES) {
                    LOG.info("Refused external link with scheme $scheme")
                    return
                }
                BrowserUtil.browse(href)
            }
            LinkKind.RELATIVE -> {
                val path = href.substringBefore('#').substringBefore('?')
                // No scheme and no absolute path: only paths relative to the .md file.
                if (path.isEmpty() || path.startsWith('/') || ':' in path) return
                val file = doc.source.file
                ApplicationManager.getApplication().executeOnPooledThread {
                    val baseDir = AssetRequestHandler.markdownDir(file) ?: return@executeOnPooledThread
                    val roots = ReadAction.nonBlocking<List<Path>> { AssetRequestHandler.allowedRoots(project, file) }
                        .executeSynchronously()
                    // File IO outside the read action.
                    val target = PathRules.resolve(baseDir, path, roots)
                    if (target == null) {
                        LOG.info("Refused relative link outside the allowed roots or not found")
                        return@executeOnPooledThread
                    }
                    runOnEdt {
                        if (!project.isDisposed) {
                            LocalFileSystem.getInstance().findFileByNioFile(target)
                                ?.let { FileEditorManager.getInstance(project).openFile(it, true) }
                        }
                    }
                }
            }
        }
    }

    override fun dispose() {
        sessions.toList().forEach(::release)
        docs.values.forEach { Disposer.dispose(it.source.version) }
        docs.clear()
        byId.clear()
        visible.clear()
    }

    companion object {
        /** `ActionGroup` of the Edit-mode context menu (plugin.xml). */
        const val CONTEXT_MENU_GROUP = "markdone.EditContextMenu"
        private const val MAX_CRASHES_PER_MINUTE = 3
        private val LOG = logger<SharedBrowserService>()
        private val EXTERNAL_SCHEMES = setOf("http", "https", "mailto")
        private val random = SecureRandom()

        fun getInstance(): SharedBrowserService = service()

        private fun newDocId(): String = HexFormat.of().formatHex(ByteArray(16).also { random.nextBytes(it) })

        /** The `/proj/` assets of [project]: relative to its CSS file, inside its content roots. */
        private fun projectSource(project: Project) = AssetRequestHandler.ProjectSource(
            { UserCssService.getInstance().assetDir(project) },
            { ReadAction.nonBlocking<List<Path>> { AssetRequestHandler.contentRoots(project) }.executeSynchronously() },
        )

        /** Data of the context menu: project, `MdEditor`, page selection, table cell, over the component's own data. */
        internal fun contextMenuData(parent: DataContext, editor: WebEditor, selection: PageSelection, table: PageTable? = null): DataContext {
            val builder = SimpleDataContext.builder().setParent(parent)
                .add(CommonDataKeys.PROJECT, selection.project)
                .add(PageSelection.KEY, selection)
            table?.let { builder.add(PageTable.KEY, it) }
            editor.owner?.let { builder.add(PlatformCoreDataKeys.FILE_EDITOR, it) }
            return builder.build()
        }

        private fun theme(): JsonObject {
            val scheme = EditorColorsManager.getInstance().globalScheme
            return JsonObject().apply {
                addProperty("type", "theme")
                addProperty("dark", !JBColor.isBright())
                addProperty("fontFamily", scheme.editorFontName)
                addProperty("fontSizePx", scheme.editorFontSize)
                addProperty("zoom", MdSettings.getInstance().zoom)
            }
        }
    }
}
