package ch.nmeylan.markdone.jcef

import com.intellij.openapi.application.runReadActionBlocking
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.editor.Document
import com.intellij.openapi.project.Project
import com.intellij.openapi.roots.ProjectRootManager
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.util.concurrency.AppExecutorUtil
import ch.nmeylan.markdone.sync.DocVersion
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.callback.CefCallback
import org.cef.handler.CefResourceHandler
import org.cef.handler.CefResourceHandlerAdapter
import org.cef.handler.CefResourceRequestHandlerAdapter
import org.cef.misc.IntRef
import org.cef.misc.StringRef
import org.cef.network.CefRequest
import org.cef.network.CefResponse
import java.nio.file.Files
import java.nio.file.Path

/**
 * Serves the origin `https://markdone.local` for the documents open in one page (protocol/PROTOCOL.md).
 * [docs] gives the document of a docId, or `null` when it is not open in this page; [projects] gives the
 * project of a projectToken (`/proj/`, protocol 2.2) the same way. Both are called on pooled threads. Requests to any other origin are cancelled, so nothing reaches the network, except
 * `https` image requests while [remoteImages] is true (the page CSP then allows `https:` images).
 * Responses are built on a pooled thread, not on the CEF IO thread, because `/doc` and `/file` take a read action.
 */
class AssetRequestHandler(
    private val docs: (String) -> DocSource?,
    private val remoteImages: () -> Boolean = { false },
    private val projects: (String) -> ProjectSource? = { null },
    private val onDrawioServed: (docId: String, path: String, file: Path) -> Unit = { _, _, _ -> },
) : CefResourceRequestHandlerAdapter() {

    /** A document that the page can load. */
    class DocSource(val document: Document, val file: VirtualFile, val project: Project, val version: DocVersion)

    /**
     * A project whose CSS assets the page can load: [cssDir] (the project CSS file's directory, `null` when
     * none) and [roots] (the project content roots) are read on each request, on a pooled thread.
     */
    class ProjectSource(val cssDir: () -> Path?, val roots: () -> List<Path>)

    class Response(val status: Int, val mime: String, val headers: Map<String, String>, val body: ByteArray)

    override fun onBeforeResourceLoad(browser: CefBrowser?, frame: CefFrame?, request: CefRequest): Boolean {
        val image = request.resourceType == CefRequest.ResourceType.RT_IMAGE
        val cancel = cancels(request.method, request.url, image, remoteImages())
        if (cancel) LOG.info("Cancelled request: ${request.method} ${request.url.take(200)}")
        return cancel
    }

    override fun getResourceHandler(browser: CefBrowser?, frame: CefFrame?, request: CefRequest): CefResourceHandler? {
        val url = request.url
        // A remote image that onBeforeResourceLoad let through: CEF loads it from the network.
        if (!url.startsWith("$ORIGIN/")) return null
        return BytesResourceHandler { respond(url) }
    }

    /** Builds the response for [url]; unknown or refused paths get 404. Can block: not for CEF threads. */
    fun respond(url: String): Response {
        if (!url.startsWith("$ORIGIN/")) return NOT_FOUND
        val path = url.substring(ORIGIN.length).substringBefore('#').substringBefore('?')
        return when {
            path.startsWith("/app/") -> appAsset(path.removePrefix("/app/"))
            path.startsWith("/doc/") -> docs(path.removePrefix("/doc/"))?.let(::documentText) ?: NOT_FOUND
            path.startsWith("/file/") -> {
                val rest = path.removePrefix("/file/")
                val source = docs(rest.substringBefore('/')) ?: return NOT_FOUND
                if ('/' !in rest) NOT_FOUND else localFile(source, rest.substringAfter('/'))
            }
            path.startsWith("/drawio/") -> {
                val rest = path.removePrefix("/drawio/")
                val docId = rest.substringBefore('/')
                val source = docs(docId) ?: return NOT_FOUND
                if ('/' !in rest) NOT_FOUND else drawioFile(docId, source, rest.substringAfter('/'))
            }
            path.startsWith("/proj/") -> {
                val rest = path.removePrefix("/proj/")
                val source = projects(rest.substringBefore('/')) ?: return NOT_FOUND
                if ('/' !in rest) NOT_FOUND else projectFile(source, rest.substringAfter('/'))
            }
            else -> NOT_FOUND
        }
    }

    private fun appAsset(relative: String): Response {
        val segments = relative.split('/')
        if (segments.any { it.isEmpty() || it == "." || it == ".." || '%' in it || '\\' in it }) return NOT_FOUND
        val bytes = AssetRequestHandler::class.java.classLoader.getResourceAsStream("web/$relative")
            ?.use { it.readAllBytes() } ?: return NOT_FOUND
        val headers = linkedMapOf("X-Content-Type-Options" to "nosniff")
        if (relative == "index.html") {
            headers["Content-Security-Policy"] = csp(remoteImages())
            headers["Cache-Control"] = "no-store"
        } else if (relative == DRAWIO_FRAME_PATH) {
            headers["Content-Security-Policy"] = FRAME_CSP
        } else {
            headers["Content-Security-Policy"] = RESOURCE_CSP
            // Vite puts a content hash in every file name under assets/.
            if (relative.startsWith("assets/")) headers["Cache-Control"] = "public, max-age=31536000, immutable"
        }
        return Response(200, mimeType(relative), headers, bytes)
    }

    private fun documentText(source: DocSource): Response {
        val document = source.document
        // The version changes only in a write action, so it matches the text.
        val (text, stamp) = runReadActionBlocking { document.text to source.version.value }
        return Response(
            200, "text/plain",
            mapOf(
                "X-Markdone-Stamp" to stamp.toString(), "Cache-Control" to "no-store",
                "X-Content-Type-Options" to "nosniff", "Content-Security-Policy" to RESOURCE_CSP,
            ),
            text.toByteArray(Charsets.UTF_8),
        )
    }

    private fun localFile(source: DocSource, raw: String): Response {
        val baseDir = markdownDir(source.file) ?: return NOT_FOUND
        val roots = runReadActionBlocking { allowedRoots(source.project, source.file) }
        return fileResponse(PathRules.resolve(baseDir, raw, roots) ?: return NOT_FOUND)
    }

    /**
     * A `/drawio/` file: the rules of `/file/`, and only a `.drawio` or `.drawio.xml` file of at most
     * [MAX_DRAWIO_BYTES] (413 above), as plain text that is never cached.
     */
    private fun drawioFile(docId: String, source: DocSource, raw: String): Response {
        val baseDir = markdownDir(source.file) ?: return NOT_FOUND
        val roots = runReadActionBlocking { allowedRoots(source.project, source.file) }
        val path = PathRules.resolve(baseDir, raw, roots) ?: return NOT_FOUND
        if (!isDrawioName(path.fileName.toString())) return NOT_FOUND
        // Recorded before the read: a file that is too large or gone later is a file change to report.
        onDrawioServed(docId, PathRules.percentDecode(raw) ?: raw, path)
        val bytes = try {
            if (Files.size(path) > MAX_DRAWIO_BYTES) return TOO_LARGE
            Files.readAllBytes(path)
        } catch (_: java.io.IOException) {
            return NOT_FOUND
        }
        val headers = mapOf("X-Content-Type-Options" to "nosniff", "Content-Security-Policy" to RESOURCE_CSP, "Cache-Control" to "no-store")
        return Response(200, "text/plain", headers, bytes)
    }

    /** A `/proj/` asset: relative to the project CSS file, only inside the project content roots. */
    private fun projectFile(source: ProjectSource, raw: String): Response {
        val baseDir = source.cssDir() ?: return NOT_FOUND
        return fileResponse(PathRules.resolve(baseDir, raw, source.roots()) ?: return NOT_FOUND)
    }

    private fun fileResponse(path: Path): Response {
        val bytes = try {
            Files.readAllBytes(path)
        } catch (_: java.io.IOException) {
            return NOT_FOUND
        }
        val headers = mapOf("X-Content-Type-Options" to "nosniff", "Content-Security-Policy" to RESOURCE_CSP)
        return Response(200, mimeType(path.fileName.toString()), headers, bytes)
    }

    companion object {
        const val ORIGIN = "https://markdone.local"

        /** Sent as a response header on the page. */
        const val CSP = "default-src 'none'; " +
            "script-src https://markdone.local/app/; " +
            "style-src https://markdone.local/app/ 'unsafe-inline'; " +
            "img-src https://markdone.local/ data:; " +
            "font-src https://markdone.local/app/ https://markdone.local/file/ https://markdone.local/proj/; " +
            "connect-src https://markdone.local/doc/ https://markdone.local/drawio/; " +
            "frame-src https://markdone.local/app/drawio/viewer.html; " +
            "base-uri 'none'; " +
            "form-action 'none';"

        /** The page CSP: [CSP], plus `https:` images when remote images are on. */
        fun csp(remoteImages: Boolean): String =
            if (remoteImages) CSP.replace(IMG_SRC, "img-src https://markdone.local/ data: https:;") else CSP

        private const val IMG_SRC = "img-src https://markdone.local/ data:;"

        /** Path under `/app/` of the draw.io frame document, the only sub-frame the page loads. */
        const val DRAWIO_FRAME_PATH = "drawio/viewer.html"

        /** URL of the draw.io frame document. */
        const val DRAWIO_FRAME_URL = "$ORIGIN/app/$DRAWIO_FRAME_PATH"

        /** Largest `.drawio` file that `/drawio/` serves. */
        const val MAX_DRAWIO_BYTES = 5L * 1024 * 1024

        /** Sent as a response header on [DRAWIO_FRAME_URL]: the frame runs scripts of its own folder only, in an opaque origin. */
        const val FRAME_CSP = "default-src 'none'; " +
            "script-src https://markdone.local/app/drawio/; " +
            "style-src https://markdone.local/app/drawio/ 'unsafe-inline'; " +
            "img-src https://markdone.local/app/drawio/ data:; " +
            "font-src https://markdone.local/app/drawio/; " +
            "connect-src https://markdone.local/app/drawio/; " +
            "base-uri 'none'; " +
            "form-action 'none'; " +
            "sandbox allow-scripts;"

        /** True for the file name of a draw.io diagram: `.drawio` or `.drawio.xml`, in any case. */
        fun isDrawioName(name: String): Boolean = name.lowercase().let { it.endsWith(".drawio") || it.endsWith(".drawio.xml") }

        /** CSP of every response that is not the page: if a resource is opened as a document, it gets no rights. */
        const val RESOURCE_CSP = "default-src 'none'; sandbox"

        private val LOG = logger<AssetRequestHandler>()
        private val NOT_FOUND = Response(404, "text/plain", mapOf("Content-Security-Policy" to RESOURCE_CSP), ByteArray(0))
        private val TOO_LARGE = Response(413, "text/plain", mapOf("Content-Security-Policy" to RESOURCE_CSP), ByteArray(0))

        /**
         * Whether a request is cancelled before it is sent: only GET requests to [ORIGIN] go on, and
         * GET `https` requests for an [image] when [remoteImages] is on (`http:` stays cancelled).
         */
        fun cancels(method: String, url: String, image: Boolean = false, remoteImages: Boolean = false): Boolean {
            if (method != "GET") return true
            if (url.startsWith("$ORIGIN/")) return false
            return !(remoteImages && image && url.startsWith("https://"))
        }

        private val MIME = mapOf(
            "html" to "text/html", "js" to "text/javascript", "mjs" to "text/javascript", "css" to "text/css",
            "json" to "application/json", "map" to "application/json", "svg" to "image/svg+xml",
            "png" to "image/png", "jpg" to "image/jpeg", "jpeg" to "image/jpeg", "gif" to "image/gif",
            "webp" to "image/webp", "avif" to "image/avif", "bmp" to "image/bmp", "ico" to "image/x-icon",
            "woff2" to "font/woff2", "woff" to "font/woff", "ttf" to "font/ttf", "otf" to "font/otf",
        )

        fun mimeType(name: String): String =
            MIME[name.substringAfterLast('.', "").lowercase()] ?: "application/octet-stream"

        fun markdownDir(file: VirtualFile): Path? =
            file.parent?.takeIf { it.isInLocalFileSystem }?.toNioPath()

        /** Project content roots and the directory of the `.md` file. Call it inside a read action. */
        fun allowedRoots(project: Project, file: VirtualFile): List<Path> = contentRoots(project) + listOfNotNull(markdownDir(file))

        /** The local project content roots. Call it inside a read action. */
        fun contentRoots(project: Project): List<Path> =
            if (project.isDisposed) emptyList() else {
                ProjectRootManager.getInstance(project).contentRoots
                    .filter { it.isInLocalFileSystem }
                    // getNioPath, not toNioPath: a root that has no NIO path (for example temp:// in tests) is skipped.
                    .mapNotNull { it.fileSystem.getNioPath(it) }
            }
    }
}

/**
 * Builds the response with [build] on a pooled thread, then sends it from memory.
 * IDE 2026.2 and later add `open`, `read` and `skip` to the interface. The adapter implements them so that
 * CEF falls back to `processRequest` and `readResponse`; this class compiles and runs on 2026.1 too.
 */
private class BytesResourceHandler(private val build: () -> AssetRequestHandler.Response) : CefResourceHandlerAdapter() {
    @Volatile
    private var response = AssetRequestHandler.Response(404, "text/plain", emptyMap(), ByteArray(0))

    @Volatile
    private var cancelled = false
    private var offset = 0

    override fun processRequest(request: CefRequest, callback: CefCallback): Boolean {
        // The CEF IO thread must not wait for a read action; CEF reads the headers after Continue().
        AppExecutorUtil.getAppExecutorService().execute {
            try {
                response = build()
            } finally {
                if (!cancelled) callback.Continue()
            }
        }
        return true
    }

    override fun getResponseHeaders(response: CefResponse, responseLength: IntRef, redirectUrl: StringRef) {
        response.status = this.response.status
        response.mimeType = this.response.mime
        if (this.response.headers.isNotEmpty()) response.setHeaderMap(this.response.headers)
        responseLength.set(this.response.body.size)
    }

    override fun readResponse(dataOut: ByteArray, bytesToRead: Int, bytesRead: IntRef, callback: CefCallback): Boolean {
        val body = response.body
        if (offset >= body.size) {
            bytesRead.set(0)
            return false
        }
        val n = minOf(bytesToRead, body.size - offset)
        System.arraycopy(body, offset, dataOut, 0, n)
        offset += n
        bytesRead.set(n)
        return true
    }

    override fun cancel() {
        cancelled = true
    }
}
