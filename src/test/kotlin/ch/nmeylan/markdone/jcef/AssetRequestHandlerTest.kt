package ch.nmeylan.markdone.jcef

import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.util.io.FileUtil
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.nio.file.Files
import java.nio.file.Path

/** Request routing of the `https://markdone.local` origin, without CEF. */
class AssetRequestHandlerTest : BasePlatformTestCase() {
    private val docId = "0123456789abcdef0123456789abcdef"
    private val origin = AssetRequestHandler.ORIGIN
    private lateinit var root: Path
    private lateinit var handler: AssetRequestHandler

    override fun setUp() {
        super.setUp()
        // A real local directory: /file/ serves only files of the local file system.
        root = FileUtil.createTempDirectory("markdone", null).toPath().toRealPath()
        val docs = Files.createDirectories(root.resolve("docs"))
        Files.writeString(docs.resolve("doc.md"), "# Doc\n")
        Files.write(docs.resolve("img.png"), byteArrayOf(1, 2, 3))
        for (name in listOf("a.jpg", "b.jpeg", "c.gif", "d.webp", "e.svg", "F.PNG")) Files.write(docs.resolve(name), byteArrayOf(1))
        Files.createDirectories(docs.resolve("img sub"))
        Files.write(docs.resolve("img sub/x.png"), byteArrayOf(1))
        Files.writeString(root.resolve("secret.txt"), "secret")
        val file = LocalFileSystem.getInstance().refreshAndFindFileByNioFile(docs.resolve("doc.md"))!!
        val document = FileDocumentManager.getInstance().getDocument(file)!!
        val version = ch.nmeylan.markdone.sync.DocVersion(document).also { com.intellij.openapi.util.Disposer.register(testRootDisposable, it) }
        val source = AssetRequestHandler.DocSource(document, file, project, version)
        handler = AssetRequestHandler({ if (it == docId) source else null })
    }

    fun testPageHasProtocolCsp() {
        val protocol = Files.readString(Path.of("protocol/PROTOCOL.md")).substringAfter("## Page content security")
        val expected = protocol.substringAfter("```\n").substringBefore("\n```").lines().joinToString(" ") { it.trim() }
        val page = handler.respond("$origin/app/index.html")
        assertEquals(200, page.status)
        assertEquals("text/html", page.mime)
        assertEquals(expected, page.headers["Content-Security-Policy"])
    }

    fun testTraversalAndUnknownPathsAre404() {
        for (path in listOf(
            "/app/../x", "/app/%2e%2e/x", "/app/assets/%2e%2e/index.html", "/app/missing.js",
            "/doc/ffffffffffffffffffffffffffffffff", "/doc/", "/file/ffffffffffffffffffffffffffffffff/img.png", "/file/$docId",
            "/file/$docId/../secret.txt", "/file/$docId/%2e%2e/secret.txt", "/file/$docId/%2e%2e%2fsecret.txt",
            "/file/$docId/missing.png", "/other",
        )) {
            assertEquals(path, 404, handler.respond(origin + path).status)
        }
    }

    fun testDocumentHasStamp() {
        val doc = handler.respond("$origin/doc/$docId")
        assertEquals(200, doc.status)
        assertEquals("# Doc\n", doc.body.toString(Charsets.UTF_8))
        assertNotNull(doc.headers["X-Markdone-Stamp"]?.toLongOrNull())
    }

    fun testNonPageResponsesAreSandboxed() {
        val file = handler.respond("$origin/file/$docId/img.png")
        assertEquals(200, file.status)
        assertEquals("image/png", file.mime)
        // An asset that the page loads (Vite hashed name).
        val page = handler.respond("$origin/app/index.html").body.toString(Charsets.UTF_8)
        val asset = handler.respond("$origin/app/" + Regex("assets/[^\"']+").find(page)!!.value)
        assertEquals(200, asset.status)
        for (response in listOf(file, asset, handler.respond("$origin/doc/$docId"), handler.respond("$origin/app/x"))) {
            assertEquals("default-src 'none'; sandbox", response.headers["Content-Security-Policy"])
        }
    }

    fun testImagesHaveTheirMimeTypeAndTheSandboxCsp() {
        for ((name, mime) in listOf(
            "img.png" to "image/png", "a.jpg" to "image/jpeg", "b.jpeg" to "image/jpeg", "c.gif" to "image/gif",
            "d.webp" to "image/webp", "e.svg" to "image/svg+xml", "F.PNG" to "image/png", "img%20sub/x.png" to "image/png",
            "./img.png" to "image/png", "img%20sub/../img.png" to "image/png",
        )) {
            val response = handler.respond("$origin/file/$docId/$name")
            assertEquals(name, 200, response.status)
            assertEquals(name, mime, response.mime)
            assertEquals(name, "default-src 'none'; sandbox", response.headers["Content-Security-Policy"])
            assertEquals(name, "nosniff", response.headers["X-Content-Type-Options"])
        }
    }

    fun testProjectAssetsAreRelativeToTheCssFileAndInsideTheContentRoots() {
        val token = "fedcba9876543210fedcba9876543210"
        val proj = Files.createDirectories(root.resolve("proj"))
        Files.createDirectories(proj.resolve(".markdone/fonts"))
        Files.write(proj.resolve(".markdone/fonts/x.woff2"), byteArrayOf(1))
        Files.createDirectories(proj.resolve("img"))
        Files.write(proj.resolve("img/a.png"), byteArrayOf(1))
        var cssDir: Path? = proj.resolve(".markdone")
        val source = AssetRequestHandler.ProjectSource({ cssDir }, { listOf(proj) })
        val handler = AssetRequestHandler({ null }, { false }, { if (it == token) source else null })
        for ((path, mime) in listOf("fonts/x.woff2" to "font/woff2", "..%2Fimg%2Fa.png" to "image/png", "./fonts/x.woff2" to "font/woff2")) {
            val response = handler.respond("$origin/proj/$token/$path")
            assertEquals(path, 200, response.status)
            assertEquals(path, mime, response.mime)
            assertEquals(path, "default-src 'none'; sandbox", response.headers["Content-Security-Policy"])
            assertEquals(path, "nosniff", response.headers["X-Content-Type-Options"])
        }
        for (path in listOf(
            "/proj/$token/..%2F..%2Fsecret.txt", "/proj/$token/../../secret.txt", "/proj/$token/missing.png", "/proj/$token",
            "/proj/ffffffffffffffffffffffffffffffff/fonts/x.woff2", "/proj/$token/%2Fetc%2Fpasswd",
        )) {
            assertEquals(path, 404, handler.respond(origin + path).status)
        }
        cssDir = null
        assertEquals("No project CSS file", 404, handler.respond("$origin/proj/$token/fonts/x.woff2").status)
        assertEquals("Not a docId", 404, handler.respond("$origin/file/$token/fonts/x.woff2").status)
    }

    fun testPageCspFollowsTheRemoteImagesSetting() {
        var remote = false
        val handler = AssetRequestHandler({ null }, { remote })
        val off = handler.respond("$origin/app/index.html").headers["Content-Security-Policy"]!!
        assertEquals(AssetRequestHandler.CSP, off)
        assertTrue(off.contains("img-src https://markdone.local/ data:;"))
        remote = true
        val on = handler.respond("$origin/app/index.html").headers["Content-Security-Policy"]!!
        assertEquals(AssetRequestHandler.CSP.replace("img-src https://markdone.local/ data:;", "img-src https://markdone.local/ data: https:;"), on)
        assertFalse(on.contains("http:"))
        assertFalse(on.contains("unsafe-eval"))
        // Only the page has the CSP: other responses stay sandboxed.
        assertEquals("default-src 'none'; sandbox", handler.respond("$origin/app/x").headers["Content-Security-Policy"])
    }

    fun testRemoteImagesGoOnlyWhenTheSettingIsOn() {
        val image = true
        assertTrue("default off", AssetRequestHandler.cancels("GET", "https://example.com/x.png", image))
        assertTrue(AssetRequestHandler.cancels("GET", "https://example.com/x.png", image, remoteImages = false))
        assertFalse(AssetRequestHandler.cancels("GET", "https://example.com/x.png", image, remoteImages = true))
        assertTrue("http: stays cancelled", AssetRequestHandler.cancels("GET", "http://example.com/x.png", image, remoteImages = true))
        // Other resource types, methods and schemes stay cancelled.
        assertTrue(AssetRequestHandler.cancels("GET", "https://example.com/x.js", image = false, remoteImages = true))
        assertTrue(AssetRequestHandler.cancels("POST", "https://example.com/x.png", image, remoteImages = true))
        assertTrue(AssetRequestHandler.cancels("GET", "file:///etc/passwd", image, remoteImages = true))
        assertTrue(AssetRequestHandler.cancels("GET", "ftp://example.com/x.png", image, remoteImages = true))
        assertFalse(AssetRequestHandler.cancels("GET", "$origin/file/$docId/img.png", image, remoteImages = false))
    }

    fun testOnlyGetToTheOriginGoesOn() {
        assertFalse(AssetRequestHandler.cancels("GET", "$origin/app/index.html"))
        assertTrue(AssetRequestHandler.cancels("GET", "https://example.com/x.png"))
        assertTrue(AssetRequestHandler.cancels("GET", "https://markdone.local.example.com/app/x"))
        assertTrue(AssetRequestHandler.cancels("GET", origin))
        assertTrue(AssetRequestHandler.cancels("POST", "$origin/doc/$docId"))
        assertTrue(AssetRequestHandler.cancels("PUT", "$origin/app/index.html"))
    }

    fun testDrawioFilesFollowTheFileRulesAndHaveTheirOwnHeaders() {
        val docs = root.resolve("docs")
        Files.writeString(docs.resolve("a.drawio"), "<mxfile/>")
        Files.writeString(docs.resolve("B.DRAWIO.XML"), "<mxfile/>")
        Files.writeString(docs.resolve("my diagram.drawio"), "<mxfile/>")
        Files.writeString(root.resolve("top.drawio"), "<mxfile/>")
        for (path in listOf("a.drawio", "B.DRAWIO.XML", "my%20diagram.drawio", "./a.drawio", "../docs/a.drawio")) {
            val response = handler.respond("$origin/drawio/$docId/$path")
            assertEquals(path, 200, response.status)
            assertEquals(path, "text/plain", response.mime)
            assertEquals(path, "<mxfile/>", response.body.toString(Charsets.UTF_8))
            assertEquals(path, "no-store", response.headers["Cache-Control"])
            assertEquals(path, "nosniff", response.headers["X-Content-Type-Options"])
            assertEquals(path, "default-src 'none'; sandbox", response.headers["Content-Security-Policy"])
        }
    }

    fun testDrawioRefusesOtherFilesPathsAndDocuments() {
        Files.writeString(root.resolve("secret.drawio"), "<mxfile/>")
        Files.writeString(root.resolve("docs/a.drawio.txt"), "x")
        Files.writeString(root.resolve("docs/drawio"), "x")
        for (path in listOf(
            "/drawio/$docId/doc.md", "/drawio/$docId/img.png", "/drawio/$docId/a.drawio.txt", "/drawio/$docId/drawio",
            "/drawio/$docId/missing.drawio", "/drawio/$docId/..%2F..%2Fsecret.drawio", "/drawio/$docId/%2Fetc%2Fpasswd.drawio",
            "/drawio/$docId/../secret.drawio", "/drawio/$docId/..%2Ftop.drawio", "/drawio/$docId", "/drawio/", "/drawio/ffffffffffffffffffffffffffffffff/a.drawio",
        )) {
            assertEquals(path, 404, handler.respond(origin + path).status)
        }
        // /file/ stays as it was: it does not need the extension, and /drawio/ is separate.
        assertEquals(200, handler.respond("$origin/file/$docId/a.drawio.txt").status)
    }

    fun testDrawioLimitsTheSize() {
        val limit = AssetRequestHandler.MAX_DRAWIO_BYTES.toInt()
        Files.write(root.resolve("docs/ok.drawio"), ByteArray(limit) { 'a'.code.toByte() })
        Files.write(root.resolve("docs/big.drawio"), ByteArray(limit + 1) { 'a'.code.toByte() })
        assertEquals(200, handler.respond("$origin/drawio/$docId/ok.drawio").status)
        val big = handler.respond("$origin/drawio/$docId/big.drawio")
        assertEquals(413, big.status)
        assertEquals(0, big.body.size)
    }

    fun testDrawioDoesNotFollowASymlinkToAnotherFileType() {
        val link = root.resolve("docs/link.drawio")
        try {
            Files.createSymbolicLink(link, root.resolve("secret.txt"))
        } catch (_: UnsupportedOperationException) {
            return
        }
        assertEquals(404, handler.respond("$origin/drawio/$docId/link.drawio").status)
    }

    fun testFrameCspIsOnTheFrameDocumentOnly() {
        val protocol = Files.readString(Path.of("protocol/PROTOCOL.md")).substringAfter("## Draw.io frame content security")
        val expected = protocol.substringAfter("```\n").substringBefore("\n```").lines().joinToString(" ") { it.trim() }
        assertEquals(expected, AssetRequestHandler.FRAME_CSP)
        val frame = handler.respond("$origin/app/drawio/viewer.html")
        assertEquals(200, frame.status)
        assertEquals("text/html", frame.mime)
        assertEquals(AssetRequestHandler.FRAME_CSP, frame.headers["Content-Security-Policy"])
        assertFalse(AssetRequestHandler.FRAME_CSP.contains("unsafe-eval"))
        assertTrue(AssetRequestHandler.FRAME_CSP.contains("sandbox allow-scripts"))
        for (name in listOf("frame.js", "viewer-static.min.js")) {
            val script = handler.respond("$origin/app/drawio/$name")
            assertEquals(name, 200, script.status)
            assertEquals(name, "text/javascript", script.mime)
            assertEquals(name, "default-src 'none'; sandbox", script.headers["Content-Security-Policy"])
        }
        assertEquals(AssetRequestHandler.CSP, handler.respond("$origin/app/index.html").headers["Content-Security-Policy"])
    }

    fun testPageCspAllowsOnlyTheDrawioFrameDocumentAndFiles() {
        val csp = AssetRequestHandler.CSP
        assertTrue(csp.contains("frame-src https://markdone.local/app/drawio/viewer.html;"))
        assertTrue(csp.contains("connect-src https://markdone.local/doc/ https://markdone.local/drawio/;"))
        assertFalse(csp.contains("unsafe-eval"))
    }

    fun testOnlyTheDrawioFrameDocumentMayNavigateAsSubFrame() {
        val frameUrl = AssetRequestHandler.DRAWIO_FRAME_URL
        assertEquals("$origin/app/drawio/viewer.html", frameUrl)
        assertTrue(SecurityHandlers.allowsDrawioFrame(false, false, frameUrl))
        assertFalse("main frame", SecurityHandlers.allowsDrawioFrame(true, false, frameUrl))
        assertFalse("no frame", SecurityHandlers.allowsDrawioFrame(null, false, frameUrl))
        assertFalse("redirect", SecurityHandlers.allowsDrawioFrame(false, true, frameUrl))
        for (url in listOf(
            "$frameUrl?x=1", "$frameUrl#x", "$origin/app/index.html", "$origin/app/drawio/frame.js", "$origin/app/drawio/",
            "https://example.com/app/drawio/viewer.html", "javascript:1", "about:blank", "",
        )) {
            assertFalse(url, SecurityHandlers.allowsDrawioFrame(false, false, url))
        }
    }
}
