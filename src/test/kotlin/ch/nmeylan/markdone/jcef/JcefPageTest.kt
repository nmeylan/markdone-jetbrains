package ch.nmeylan.markdone.jcef

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.awt.Point
import java.awt.event.InputEvent
import java.awt.event.MouseEvent
import java.awt.event.MouseWheelEvent
import javax.swing.JPanel

/** Context-menu position, page CSS px → component px. */
class JcefPageTest {
    @Test
    fun noPageZoomKeepsCssPx() {
        // L5 (OSR, HiDPI scale 2): clientX/clientY equal component px; the popup must open there.
        assertEquals(Point(311, 36), JcefPage.toComponentPoint(311.0, 36.0, 1.0))
        assertEquals(Point(447, 88), JcefPage.toComponentPoint(447.0, 88.0, 1.0))
    }

    @Test
    fun pageZoomScales() {
        // JBCefBrowserBase.getZoomLevel() is already the factor (1.2^level).
        assertEquals(Point(373, 43), JcefPage.toComponentPoint(311.0, 36.0, 1.2))
        assertEquals(Point(156, 18), JcefPage.toComponentPoint(311.0, 36.0, 0.5))
    }

    private val panel = JPanel()

    private fun wheel(rotation: Int, precise: Double = rotation.toDouble(), type: Int = MouseWheelEvent.WHEEL_UNIT_SCROLL, modifiers: Int = 0) =
        MouseWheelEvent(panel, MouseEvent.MOUSE_WHEEL, 0, modifiers, 1, 1, 1, 1, 0, false, type, 3, rotation, precise)

    @Test
    fun wheelNotchIsScaledToLineHeightTimesRotation() {
        // JCEF scrolls (int) (precise × factor) × scrollAmount px: 22 px lines, 3 units per notch -> 66 px.
        val down = JcefPage.WheelStep.scaledRotation(1, 22, 10)!!
        assertEquals(22, (down * 10).toInt())
        val up = JcefPage.WheelStep.scaledRotation(-1, 22, 10)!!
        assertEquals(-22, (up * 10).toInt())
        assertEquals(44, (JcefPage.WheelStep.scaledRotation(2, 22, 10)!! * 10).toInt())
        assertEquals(-66, (JcefPage.WheelStep.scaledRotation(-3, 22, 10)!! * 10).toInt())
        // Half a pixel more: a factor that does not divide the height does not round down.
        assertEquals(17, (JcefPage.WheelStep.scaledRotation(1, 17, 3)!! * 3).toInt())
        assertNull(JcefPage.WheelStep.scaledRotation(1, 22, 0))
        assertNull(JcefPage.WheelStep.scaledRotation(1, 22, -1))
    }

    @Test
    fun onlyAWheelNotchWithoutModifierIsScaled() {
        assertTrue(JcefPage.WheelStep.isNotch(wheel(1)))
        assertTrue(JcefPage.WheelStep.isNotch(wheel(-1)))
        assertTrue(JcefPage.WheelStep.isNotch(wheel(2)))
        assertFalse("fractional (touchpad)", JcefPage.WheelStep.isNotch(wheel(0, 0.4)))
        assertFalse("fractional", JcefPage.WheelStep.isNotch(wheel(1, 1.25)))
        assertFalse("block scroll", JcefPage.WheelStep.isNotch(wheel(1, type = MouseWheelEvent.WHEEL_BLOCK_SCROLL)))
        // TouchScrollUtil: scroll types 2-4 are touch events.
        for (type in 2..4) assertFalse("touch $type", JcefPage.WheelStep.isNotch(wheel(1, type = type)))
        for (mask in listOf(InputEvent.SHIFT_DOWN_MASK, InputEvent.ALT_DOWN_MASK, InputEvent.CTRL_DOWN_MASK, InputEvent.META_DOWN_MASK)) {
            assertFalse("modifier $mask", JcefPage.WheelStep.isNotch(wheel(1, modifiers = mask)))
        }
        assertFalse("consumed", JcefPage.WheelStep.isNotch(wheel(1).apply { consume() }))
    }

    @Test
    fun wheelStepConsumesTheNotchAndDispatchesOneScaledEvent() {
        val received = mutableListOf<MouseWheelEvent>()
        val step = JcefPage.WheelStep(lineHeight = { 22 }, factor = { 10 })
        // As in JCEF's component: this listener first, then the component's own handling.
        panel.addMouseWheelListener(step)
        panel.addMouseWheelListener { e -> if (!e.isConsumed) received += e }
        val notch = wheel(-1)
        panel.dispatchEvent(notch)
        assertTrue(notch.isConsumed)
        // The re-dispatched event passes the listener once, unchanged.
        assertEquals(1, received.size)
        assertEquals(-1, received[0].wheelRotation)
        assertEquals(-2.25, received[0].preciseWheelRotation, 1e-9)
        received.clear()
        val touchpad = wheel(0, 0.4)
        panel.dispatchEvent(touchpad)
        assertEquals(listOf(touchpad), received)
        received.clear()
        // Without a Source editor (no line height) the event passes.
        val other = JPanel()
        other.addMouseWheelListener(JcefPage.WheelStep(lineHeight = { null }, factor = { 10 }))
        other.addMouseWheelListener { e -> if (!e.isConsumed) received += e }
        val plain = MouseWheelEvent(other, MouseEvent.MOUSE_WHEEL, 0, 0, 1, 1, 1, 1, 0, false, MouseWheelEvent.WHEEL_UNIT_SCROLL, 3, 1, 1.0)
        other.dispatchEvent(plain)
        assertEquals(listOf(plain), received)
    }
}
