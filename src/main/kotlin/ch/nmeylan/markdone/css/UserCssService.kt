package ch.nmeylan.markdone.css

import com.intellij.ide.trustedProjects.TrustedProjects
import com.intellij.ide.trustedProjects.TrustedProjectsListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.runReadActionBlocking
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.ControlFlowException
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.project.guessProjectDir
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.openapi.vfs.newvfs.BulkFileListener
import com.intellij.openapi.vfs.newvfs.events.VFileEvent
import com.intellij.openapi.vfs.newvfs.events.VFileMoveEvent
import com.intellij.openapi.vfs.newvfs.events.VFilePropertyChangeEvent
import com.intellij.util.messages.Topic
import ch.nmeylan.markdone.jcef.AssetRequestHandler
import ch.nmeylan.markdone.jcef.PathRules
import ch.nmeylan.markdone.settings.MdProjectSettings
import ch.nmeylan.markdone.settings.MdSettings
import ch.nmeylan.markdone.sync.scheduleOnEdt
import java.io.IOException
import java.net.URLEncoder
import java.nio.file.InvalidPathException
import java.nio.file.Path

/**
 * User CSS of the page (protocol "CSS (M2)"): global CSS from [MdSettings] and the
 * project CSS file ([MdProjectSettings.projectCssPath], trusted projects only). Watches the project
 * CSS files in the VFS and publishes [TOPIC] for a project 300 ms after the last change.
 */
@Service(Service.Level.APP)
class UserCssService : Disposable {

    /** The CSS for the documents of one project. [untrusted]: a project CSS file exists but the project is not trusted. */
    data class UserCss(val global: String, val project: String?, val untrusted: Boolean)

    fun interface Listener {
        /** The project CSS of [project] may have changed. */
        fun projectCssChanged(project: Project)
    }

    // Test seams.
    internal var isTrusted: (Project) -> Boolean = { TrustedProjects.isProjectTrusted(it) }
    internal var projectDir: (Project) -> VirtualFile? = { it.guessProjectDir() }
    internal var schedule: (Long, () -> Unit) -> () -> Unit = { delay, task -> scheduleOnEdt(delay, ModalityState.any(), task) }
    internal var openProjects: () -> List<Project> = { ProjectManager.getInstance().openProjects.toList() }
    internal var contentRoots: (Project) -> List<Path> = { runReadActionBlocking { AssetRequestHandler.contentRoots(it) } }

    private val pending = HashMap<Project, () -> Unit>()

    init {
        val connection = ApplicationManager.getApplication().messageBus.connect(this)
        connection.subscribe(VirtualFileManager.VFS_CHANGES, object : BulkFileListener {
            override fun after(events: List<VFileEvent>) = onVfsEvents(events)
        })
        connection.subscribe(TrustedProjectsListener.TOPIC, object : TrustedProjectsListener {
            override fun onProjectTrusted(project: Project) = publish(project)
        })
    }

    /**
     * The CSS for the documents of [project]; its relative `url()`s use [projectToken] (protocol 2.2). Reads
     * the project CSS file through the VFS: call it on a pooled thread, not on the EDT. When reading the
     * project CSS fails, it logs and gives the global CSS only.
     */
    fun load(project: Project, projectToken: String): UserCss {
        val global = MdSettings.getInstance().globalCss.let { if (tooLarge(it.toByteArray().size.toLong(), "global CSS")) "" else it }
        return try {
            loadProject(project, projectToken, global)
        } catch (e: Exception) {
            if (e !is ControlFlowException) LOG.warn("Project CSS not applied: it could not be read", e)
            UserCss(global, null, false)
        }
    }

    private fun loadProject(project: Project, projectToken: String, global: String): UserCss {
        if (project.isDisposed) return UserCss(global, null, false)
        val css = runReadActionBlocking { cssFile(project, warn = true) } ?: return UserCss(global, null, false)
        if (!isTrusted(project)) return UserCss(global, null, true)
        if (tooLarge(css.length, css.path)) return UserCss(global, null, false)
        val text = try {
            String(css.contentsToByteArray(), Charsets.UTF_8)
        } catch (_: IOException) {
            return UserCss(global, null, false)
        }
        // The file can grow between the length check and the read.
        if (tooLarge(text.toByteArray().size.toLong(), css.path)) return UserCss(global, null, false)
        val cssDir = css.parent?.let(::nioPath)
        return UserCss(global, rewriteUrls(text, cssDir, contentRoots(project), projectToken), false)
    }

    /**
     * The directory of the project CSS file of [project], which `/proj/` asset paths are relative to;
     * `null` when there is no such file or the project is not trusted. Call it on a pooled thread.
     */
    fun assetDir(project: Project): Path? {
        if (project.isDisposed || !isTrusted(project)) return null
        return runReadActionBlocking { cssFile(project, warn = false)?.parent }?.let(::nioPath)
    }

    /** The project CSS file, if it exists. Call it inside a read action. */
    private fun cssFile(project: Project, warn: Boolean): VirtualFile? {
        val dir = projectDir(project) ?: return null
        val path = cssPath(project, dir, warn) ?: return null
        return dir.findFileByRelativePath(path)?.takeIf { !it.isDirectory && it.isValid }
    }

    /**
     * [MdProjectSettings.projectCssPath], normalized relative to the project directory [dir]; `null` (and a
     * warning when [warn]) when it leaves that directory (`..`, absolute path).
     */
    private fun cssPath(project: Project, dir: VirtualFile, warn: Boolean): String? {
        val raw = MdProjectSettings.getInstance(project).projectCssPath
        val relative = insideRelativePath(raw)
        if (relative == null && warn) LOG.warn("Project CSS path ignored: '$raw' is not inside the project directory ${dir.path}")
        return relative
    }

    private fun onVfsEvents(events: List<VFileEvent>) {
        for (project in openProjects()) {
            if (project.isDisposed) continue
            val dir = projectDir(project) ?: continue
            val relative = cssPath(project, dir, warn = false) ?: continue
            val cssPath = dir.path.trimEnd('/') + "/" + relative
            // The file itself, or a directory above it (created, deleted, moved, renamed).
            val hit = events.any { e ->
                affects(e.path, cssPath) || e is VFileMoveEvent && affects(e.oldPath, cssPath) ||
                    e is VFilePropertyChangeEvent && affects(e.oldPath, cssPath)
            }
            if (hit) debounce(project)
        }
    }

    private fun affects(path: String, cssPath: String) = path == cssPath || cssPath.startsWith("$path/")

    private fun debounce(project: Project) {
        pending.remove(project)?.invoke()
        pending[project] = schedule(DEBOUNCE_MS) {
            pending.remove(project)
            publish(project)
        }
    }

    private fun publish(project: Project) {
        if (!project.isDisposed) ApplicationManager.getApplication().messageBus.syncPublisher(TOPIC).projectCssChanged(project)
    }

    override fun dispose() {
        pending.values.forEach { it() }
        pending.clear()
    }

    companion object {
        const val MAX_BYTES = 512 * 1024
        const val DEBOUNCE_MS = 300L

        @Topic.AppLevel
        val TOPIC = Topic(Listener::class.java, Topic.BroadcastDirection.NONE)

        private val LOG = logger<UserCssService>()

        // url( "x" ) | url( 'x' ) | url( x ); CSS functions are case-insensitive.
        private val URL = Regex("""url\(\s*(?:"([^"]*)"|'([^']*)'|([^'"()\s]*))\s*\)""", RegexOption.IGNORE_CASE)
        private val SCHEME = Regex("^[A-Za-z][A-Za-z0-9+.-]*:")
        private val SUFFIX = Regex("[A-Za-z0-9._~!$&*+,;=:@/?#%-]*")

        fun getInstance(): UserCssService = service()

        private fun tooLarge(bytes: Long, what: String): Boolean {
            if (bytes <= MAX_BYTES) return false
            LOG.warn("User CSS not applied: $what is larger than ${MAX_BYTES / 1024} KB")
            return true
        }

        private fun nioPath(file: VirtualFile): Path? = file.fileSystem.getNioPath(file)
            ?: try {
                // Not a local file (for example temp:// in tests): its VFS path still gives the relations.
                Path.of(file.path)
            } catch (_: InvalidPathException) {
                null
            }

        /**
         * [path] as a normalized relative path with `/` separators, or `null` when it is empty, absolute or
         * leaves its base directory (`..`).
         */
        internal fun insideRelativePath(path: String): String? {
            if (path.isBlank() || path.startsWith('/') || path.startsWith('\\') || '\u0000' in path) return null
            val normalized = try {
                Path.of(path).takeIf { !it.isAbsolute && it.root == null }?.normalize() ?: return null
            } catch (_: InvalidPathException) {
                return null
            }
            val parts = normalized.map { it.toString() }
            if (parts.isEmpty() || parts == listOf("") || parts.first() == "..") return null
            return parts.joinToString("/")
        }

        /**
         * Rewrites the `url()` values of project CSS: a relative URL is resolved against [cssDir] and becomes
         * `https://markdone.local/proj/<projectToken>/<path relative to cssDir>` when the result is under one of
         * [roots]; else, and for every absolute or remote URL, it becomes `none`. `data:` URLs and fragment-only
         * URLs stay. The result does not depend on the document (protocol 2.2).
         */
        fun rewriteUrls(css: String, cssDir: Path?, roots: List<Path>, projectToken: String): String =
            URL.replace(css) { m ->
                val raw = m.groupValues[1].ifEmpty { m.groupValues[2] }.ifEmpty { m.groupValues[3] }
                when {
                    raw.isEmpty() || raw.startsWith('#') || raw.lowercase().startsWith("data:") -> m.value
                    else -> projectUrl(raw, cssDir, roots, projectToken)?.let { "url(\"$it\")" } ?: "none"
                }
            }

        private fun projectUrl(raw: String, cssDir: Path?, roots: List<Path>, projectToken: String): String? {
            if (cssDir == null) return null
            if (SCHEME.containsMatchIn(raw) || raw.startsWith('/') || raw.startsWith('\\')) return null
            val cut = raw.indexOfAny(charArrayOf('?', '#')).let { if (it < 0) raw.length else it }
            // The query or fragment is copied as is: only characters that cannot end the url("...") value.
            if (!SUFFIX.matches(raw.substring(cut))) return null
            val decoded = PathRules.percentDecode(raw.substring(0, cut)) ?: return null
            if (decoded.isEmpty() || '\u0000' in decoded || '\\' in decoded) return null
            val target = try {
                cssDir.resolve(decoded).normalize()
            } catch (_: InvalidPathException) {
                return null
            }
            if (roots.none { target.startsWith(it.normalize()) }) return null
            val relative = cssDir.normalize().relativize(target).map { it.toString() }
            if (relative.isEmpty() || relative == listOf("")) return null
            val segments = relative.map { URLEncoder.encode(it, Charsets.UTF_8).replace("+", "%20") }
            // Chromium removes "/../" (also "%2e%2e") from URL paths: a path above the CSS directory keeps
            // its slashes encoded, and the IDE decodes them (PathRules.resolve checks the roots again).
            val path = segments.joinToString(if (".." in relative) "%2F" else "/")
            return "${AssetRequestHandler.ORIGIN}/proj/$projectToken/$path" + raw.substring(cut)
        }
    }
}
