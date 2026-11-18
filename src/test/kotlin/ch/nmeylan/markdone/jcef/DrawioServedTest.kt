package ch.nmeylan.markdone.jcef

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Path

class DrawioServedTest {
    private val a = Path.of("/p/a.drawio")
    private val b = Path.of("/p/b.drawio")

    @Test
    fun remembersPathsPerDocument() {
        val served = DrawioServed()
        served.add("d1", "a.drawio", a)
        served.add("d1", "./a.drawio", a)
        served.add("d2", "x/a.drawio", a)
        served.add("d1", "b.drawio", b)
        assertEquals(setOf("a.drawio", "./a.drawio"), served.pathsFor("d1", a).toSet())
        assertEquals(listOf("x/a.drawio"), served.pathsFor("d2", a))
        assertTrue(served.pathsFor("d3", a).isEmpty())
        assertTrue(served.pathsFor("d1", Path.of("/p/c.drawio")).isEmpty())
    }

    @Test
    fun keepsAtMost256PathsPerDocumentAndForgets() {
        val served = DrawioServed()
        for (i in 0 until 300) served.add("d1", "f$i.drawio", Path.of("/p/f$i.drawio"))
        assertEquals(256, DrawioServed.MAX_PER_DOCUMENT)
        assertTrue("The oldest are gone", served.pathsFor("d1", Path.of("/p/f0.drawio")).isEmpty())
        assertEquals(listOf("f299.drawio"), served.pathsFor("d1", Path.of("/p/f299.drawio")))
        assertEquals(listOf("f44.drawio"), served.pathsFor("d1", Path.of("/p/f44.drawio")))
        assertTrue(served.pathsFor("d1", Path.of("/p/f43.drawio")).isEmpty())
        served.forget("d1")
        assertTrue(served.pathsFor("d1", Path.of("/p/f299.drawio")).isEmpty())
    }

    @Test
    fun aRepeatedPathIsNewestAgain() {
        val served = DrawioServed(max = 2)
        served.add("d", "a", a)
        served.add("d", "b", b)
        served.add("d", "a", a)
        served.add("d", "c", Path.of("/p/c.drawio"))
        assertEquals(listOf("a"), served.pathsFor("d", a))
        assertTrue(served.pathsFor("d", b).isEmpty())
    }
}
