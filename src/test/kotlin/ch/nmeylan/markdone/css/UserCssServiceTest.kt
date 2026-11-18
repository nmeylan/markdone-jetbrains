package ch.nmeylan.markdone.css

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.WriteAction
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.io.FileUtil
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import ch.nmeylan.markdone.settings.MdSettings
import java.nio.file.Files
import java.nio.file.Path

/** User CSS: global and project sources, trust, size limit, url() rewrite, VFS updates. */
class UserCssServiceTest : BasePlatformTestCase() {
    private val token = "0123456789abcdef0123456789abcdef"
    private lateinit var root: Path
    private lateinit var md: VirtualFile
    private lateinit var service: UserCssService
    private var trusted = true
    private val scheduled = mutableListOf<() -> Unit>()
    private var cancelled = 0

    override fun setUp() {
        super.setUp()
        root = FileUtil.createTempDirectory("markdone-css", null).toPath().toRealPath()
        Files.createDirectories(root.resolve("docs"))
        Files.writeString(root.resolve("docs/doc.md"), "# Doc\n")
        Files.write(root.resolve("docs/img.png"), byteArrayOf(1))
        md = LocalFileSystem.getInstance().refreshAndFindFileByNioFile(root.resolve("docs/doc.md"))!!
        service = UserCssService().apply {
            isTrusted = { trusted }
            projectDir = { LocalFileSystem.getInstance().refreshAndFindFileByNioFile(root) }
            schedule = { _, task -> scheduled += task; { cancelled++ } }
            openProjects = { listOf(project) }
            contentRoots = { listOf(root) }
        }
        Disposer.register(testRootDisposable, service)
    }

    override fun tearDown() {
        try {
            MdSettings.getInstance().globalCss = ""
        } finally {
            super.tearDown()
        }
    }

    private fun writeProjectCss(text: String) {
        Files.createDirectories(root.resolve(".markdone"))
        Files.writeString(root.resolve(".markdone/style.css"), text)
        // An existing VirtualFile keeps its cached length until it is refreshed.
        LocalFileSystem.getInstance().refreshAndFindFileByNioFile(root.resolve(".markdone/style.css"))!!.refresh(false, false)
    }

    fun testGlobalOnlyWithoutProjectFile() {
        MdSettings.getInstance().globalCss = "body { color: red }"
        assertEquals(UserCssService.UserCss("body { color: red }", null, false), service.load(project, token))
    }

    fun testProjectCssWhenTrustedWithRewrittenUrls() {
        writeProjectCss(".a { background: url(../docs/img.png) } .b { background: url('../../secret.png') } .c { background: url(x.png) }")
        val css = service.load(project, token)
        val p = "https://markdone.local/proj/$token"
        assertEquals(".a { background: url(\"$p/..%2Fdocs%2Fimg.png\") } .b { background: none } .c { background: url(\"$p/x.png\") }", css.project)
        assertFalse(css.untrusted)
    }

    fun testErrorInTheProjectCssGivesTheGlobalCssOnly() {
        MdSettings.getInstance().globalCss = "g {}"
        writeProjectCss(".a {}")
        service.projectDir = { throw IllegalStateException("test failure") }
        assertEquals(UserCssService.UserCss("g {}", null, false), service.load(project, token))
    }

    fun testProjectCssPathOutsideTheProjectIsIgnored() {
        val outside = root.parent.resolve("outside-${System.nanoTime()}.css")
        Files.writeString(outside, ".evil {}")
        LocalFileSystem.getInstance().refreshAndFindFileByNioFile(outside)
        val settings = ch.nmeylan.markdone.settings.MdProjectSettings.getInstance(project)
        try {
            for (path in listOf("../${outside.fileName}", "docs/../../${outside.fileName}", outside.toString())) {
                settings.projectCssPath = path
                assertEquals(path, UserCssService.UserCss("", null, false), service.load(project, token))
            }
            Files.createDirectories(root.resolve("docs"))
            Files.writeString(root.resolve("docs/in.css"), ".in {}")
            LocalFileSystem.getInstance().refreshAndFindFileByNioFile(root.resolve("docs/in.css"))
            settings.projectCssPath = "styles/../docs/in.css"
            assertEquals("A '..' that stays inside is fine", ".in {}", service.load(project, token).project)
        } finally {
            settings.projectCssPath = ".markdone/style.css"
            Files.deleteIfExists(outside)
        }
        assertEquals("docs/a.css", UserCssService.insideRelativePath("./docs//a.css"))
        for (bad in listOf("", "..", "../a.css", "a/../../b.css", "/etc/a.css", "\\server\\a.css")) {
            assertNull(bad, UserCssService.insideRelativePath(bad))
        }
    }

    fun testAssetDirIsTheCssDirectoryOfATrustedProject() {
        assertNull("No CSS file", service.assetDir(project))
        writeProjectCss(".a {}")
        assertEquals(root.resolve(".markdone"), service.assetDir(project))
        trusted = false
        assertNull(service.assetDir(project))
    }

    fun testUntrustedProjectGetsNoProjectCssAndANotice() {
        writeProjectCss(".a { color: red }")
        trusted = false
        assertEquals(UserCssService.UserCss("", null, true), service.load(project, token))
        // No file: nothing to tell.
        Files.delete(root.resolve(".markdone/style.css"))
        LocalFileSystem.getInstance().refreshAndFindFileByNioFile(root.resolve(".markdone"))!!.refresh(false, true)
        assertEquals(UserCssService.UserCss("", null, false), service.load(project, token))
    }

    fun testSizeLimitPerSource() {
        writeProjectCss("a{}" + " ".repeat(UserCssService.MAX_BYTES))
        assertNull(service.load(project, token).project)
        writeProjectCss(" ".repeat(UserCssService.MAX_BYTES))
        assertNotNull("exactly 512 KB is accepted", service.load(project, token).project)
        MdSettings.getInstance().globalCss = "é".repeat(UserCssService.MAX_BYTES / 2 + 1)
        assertEquals("", service.load(project, token).global)
    }

    fun testCustomProjectCssPath() {
        Files.createDirectories(root.resolve("styles"))
        Files.writeString(root.resolve("styles/my.css"), ".x {}")
        LocalFileSystem.getInstance().refreshAndFindFileByNioFile(root.resolve("styles/my.css"))
        val settings = ch.nmeylan.markdone.settings.MdProjectSettings.getInstance(project)
        assertEquals(".markdone/style.css", settings.projectCssPath)
        try {
            settings.projectCssPath = "styles/my.css"
            assertEquals(".x {}", service.load(project, token).project)
        } finally {
            settings.projectCssPath = ".markdone/style.css"
        }
    }

    fun testVfsChangeIsDebouncedAndNamesTheProject() {
        writeProjectCss(".a {}")
        val published = mutableListOf<Project>()
        ApplicationManager.getApplication().messageBus.connect(testRootDisposable)
            .subscribe(UserCssService.TOPIC, UserCssService.Listener { published += it })
        scheduled.clear()
        val css = LocalFileSystem.getInstance().findFileByNioFile(root.resolve(".markdone/style.css"))!!
        WriteAction.run<Exception> { css.setBinaryContent(".a { color: red }".toByteArray()) }
        val cancelledBefore = cancelled
        WriteAction.run<Exception> { css.setBinaryContent(".a { color: blue }".toByteArray()) }
        assertEquals(2, scheduled.size)
        assertEquals("The first timer is cancelled", cancelledBefore + 1, cancelled)
        assertTrue("Nothing before the timer", published.isEmpty())
        scheduled.last()()
        assertEquals(listOf(project), published)

        // Another file of the project: no update.
        scheduled.clear()
        val other = LocalFileSystem.getInstance().findFileByNioFile(root.resolve("docs/img.png"))!!
        WriteAction.run<Exception> { other.setBinaryContent(byteArrayOf(2)) }
        assertTrue(scheduled.isEmpty())

        // The directory above the file is deleted: update.
        val dir = css.parent
        WriteAction.run<Exception> { dir.delete(this) }
        assertEquals(1, scheduled.size)
    }

    // url() rewrite (pure)

    private val cssDir = Path.of("/p/.markdone")
    private val roots = listOf(Path.of("/p"))

    private fun rewrite(css: String) = UserCssService.rewriteUrls(css, cssDir, roots, token)

    fun testRewriteRelativeUrls() {
        val f = "https://markdone.local/proj/$token"
        assertEquals("url(\"$f/a.png\")", rewrite("url(a.png)"))
        assertEquals("url(\"$f/sub/a%20b.png\")", rewrite("url( \"sub/a b.png\" )"))
        assertEquals("url(\"$f/a.png\")", rewrite("URL(./a.png)"))
        assertEquals("url(\"$f/fonts/x.woff2?#iefix\")", rewrite("url(fonts/x.woff2?#iefix)"))
        // Above the CSS directory: the slashes are encoded so that Chromium keeps the "..".
        assertEquals("url(\"$f/..%2Fdocs%2Fa.png\")", rewrite("url('../docs/a.png')"))
        assertEquals("a{b:url(\"$f/a.png\"),url(\"$f/b.png\")}", rewrite("a{b:url(a.png),url(b.png)}"))
    }

    fun testRewriteDropsUrlsOutsideTheRootsAndRemoteUrls() {
        for (url in listOf(
            "../../etc/passwd", "%2e%2e/%2e%2e/etc/passwd", "https://example.com/x.png", "http://x/y", "//example.com/x.png",
            "/abs.png", "file:///etc/passwd", "javascript:alert(1)", "https://markdone.local/file/x/y", "a\\b.png", "%zz",
        )) {
            assertEquals(url, "none", rewrite("url(\"$url\")"))
        }
        assertEquals("none", rewrite("url('a.png#\"x')"))
        assertEquals("No CSS file location: no local URL", "none", UserCssService.rewriteUrls("url(a.png)", null, emptyList(), token))
    }

    fun testRewriteKeepsDataAndFragmentUrls() {
        for (css in listOf("url(data:image/png;base64,AAAA)", "url(\"data:image/svg+xml;utf8,<svg/>\")", "url(#filter)", "url()")) {
            assertEquals(css, rewrite(css))
        }
        assertEquals("no url here", rewrite("no url here"))
    }
}
