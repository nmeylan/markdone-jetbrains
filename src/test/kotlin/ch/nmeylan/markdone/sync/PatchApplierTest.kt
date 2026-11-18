package ch.nmeylan.markdone.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PatchApplierTest {
    private fun entry(offset: Int, oldLength: Int, newText: String) = EventLog.Entry(0, 0, offset, oldLength, newText)

    @Test
    fun validation() {
        assertTrue(PatchApplier.isValid(emptyList(), 0))
        assertTrue(PatchApplier.isValid(listOf(TextPatch(0, 1, "a"), TextPatch(1, 1, "b"), TextPatch(3, 5, "")), 5))
        assertFalse("unsorted", PatchApplier.isValid(listOf(TextPatch(3, 4, ""), TextPatch(0, 1, "")), 5))
        assertFalse("overlap", PatchApplier.isValid(listOf(TextPatch(0, 3, ""), TextPatch(2, 4, "")), 5))
        assertFalse("same start", PatchApplier.isValid(listOf(TextPatch(1, 1, "a"), TextPatch(1, 2, "")), 5))
        assertFalse("out of range", PatchApplier.isValid(listOf(TextPatch(4, 6, "")), 5))
        assertFalse("reversed", PatchApplier.isValid(listOf(TextPatch(3, 2, "")), 5))
        assertFalse("CR", PatchApplier.isValid(listOf(TextPatch(0, 0, "\r")), 5))
    }

    @Test
    fun mapShiftsPatchesAfterAnEvent() {
        val patches = listOf(TextPatch(2, 3, "x"), TextPatch(5, 5, "y"))
        // Insert 2 chars at 0, then delete [3, 4) of the new text (it is before the first patch: 2 + 2 = 4).
        val mapped = PatchApplier.map(patches, listOf(entry(0, 0, "ab"), entry(3, 1, "")))
        assertEquals(listOf(TextPatch(3, 4, "x"), TextPatch(6, 6, "y")), mapped)
    }

    @Test
    fun mapKeepsPatchesBeforeAnEventAndAdjacentEvents() {
        val patches = listOf(TextPatch(1, 2, "x"))
        assertEquals(patches, PatchApplier.map(patches, listOf(entry(2, 3, "zz"))))
        assertEquals(listOf(TextPatch(2, 3, "x")), PatchApplier.map(patches, listOf(entry(0, 1, "ab"))))
        // An insertion at the start of a replaced range comes before it.
        assertEquals(listOf(TextPatch(2, 3, "x")), PatchApplier.map(patches, listOf(entry(1, 0, "q"))))
    }

    @Test
    fun mapRefusesOverlaps() {
        val patches = listOf(TextPatch(2, 4, "x"))
        assertNull(PatchApplier.map(patches, listOf(entry(3, 1, ""))))
        assertNull(PatchApplier.map(patches, listOf(entry(1, 2, ""))))
        assertNull(PatchApplier.map(patches, listOf(entry(3, 0, "q"))))
        // Two insertions at one point: the order is not defined.
        assertNull(PatchApplier.map(listOf(TextPatch(2, 2, "x")), listOf(entry(2, 0, "q"))))
    }

    @Test
    fun lengthBefore() {
        assertEquals(5, PatchApplier.lengthBefore(6, listOf(entry(0, 0, "ab"), entry(0, 1, ""))))
    }
}
