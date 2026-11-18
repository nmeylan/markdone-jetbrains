package ch.nmeylan.markdone.jcef

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Path

class CspTest {

    /** The header must equal the CSP block of protocol/PROTOCOL.md "Page content security", joined into one line. */
    @Test
    fun cspEqualsProtocol() {
        val protocol = Files.readString(Path.of("protocol/PROTOCOL.md"))
        val section = protocol.substringAfter("## Page content security")
        val block = section.substringAfter("```\n").substringBefore("\n```")
        val expected = block.lines().joinToString(" ") { it.trim() }
        assertEquals(expected, AssetRequestHandler.CSP)
    }

    @Test
    fun noEvalSources() {
        assertFalse("unsafe-eval" in AssetRequestHandler.CSP)
    }
}
