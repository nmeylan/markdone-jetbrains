package ch.nmeylan.markdone.jcef

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.nio.file.Files
import java.nio.file.Path

class PathRulesTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private lateinit var project: Path
    private lateinit var docs: Path
    private lateinit var outside: Path

    @Before
    fun setUp() {
        val root = tmp.root.toPath().toRealPath()
        project = Files.createDirectories(root.resolve("project"))
        docs = Files.createDirectories(project.resolve("docs"))
        Files.writeString(docs.resolve("img.png"), "png")
        Files.writeString(docs.resolve("a b.png"), "png")
        outside = Files.createDirectories(root.resolve("outside"))
        Files.writeString(outside.resolve("secret.txt"), "secret")
    }

    private fun resolve(raw: String, base: Path = docs, roots: List<Path> = listOf(project, docs)) =
        PathRules.resolve(base, raw, roots)

    @Test
    fun allowedFile() {
        assertEquals(docs.resolve("img.png"), resolve("img.png"))
        assertEquals(docs.resolve("img.png"), resolve("./img.png"))
        assertEquals(docs.resolve("a b.png"), resolve("a%20b.png"))
    }

    @Test
    fun dotDotEscape() {
        assertNull(resolve("../../outside/secret.txt"))
    }

    @Test
    fun encodedDotDot() {
        assertNull(resolve("%2e%2e/%2e%2e/outside/secret.txt"))
        assertNull(resolve("%2E%2E/%2E%2E/outside/secret.txt"))
    }

    @Test
    fun encodedSlash() {
        assertNull(resolve("..%2f..%2foutside%2fsecret.txt"))
        assertNull(resolve("%2f" + outside.resolve("secret.txt").toString().removePrefix("/")))
    }

    @Test
    fun absolutePath() {
        assertNull(resolve(outside.resolve("secret.txt").toString()))
    }

    @Test
    fun symlinkPointingOutside() {
        Files.createSymbolicLink(docs.resolve("link.txt"), outside.resolve("secret.txt"))
        assertNull(resolve("link.txt"))
    }

    @Test
    fun fileOutsideProjectInMarkdownDirectory() {
        // The .md file lies outside the project: its own directory is an allowed root.
        assertEquals(outside.resolve("secret.txt"), resolve("secret.txt", base = outside, roots = listOf(project, outside)))
    }

    @Test
    fun nonexistentOrMalformed() {
        assertNull(resolve("missing.png"))
        assertNull(resolve("img%2"))
        assertNull(resolve("img%zz.png"))
        assertNull(resolve(""))
        assertNull(resolve("%00img.png"))
        assertNull(resolve("."))
    }
}
