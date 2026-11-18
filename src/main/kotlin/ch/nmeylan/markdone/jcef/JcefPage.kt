package ch.nmeylan.markdone.jcef

import com.google.gson.JsonObject
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.registry.Registry
import com.intellij.ui.jcef.JBCefBrowser
import ch.nmeylan.markdone.editor.WebEditor
import ch.nmeylan.markdone.sync.PageMessage
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter
import java.awt.Component
import java.awt.Point
import java.awt.event.InputEvent
import java.awt.event.MouseWheelEvent
import java.awt.event.MouseWheelListener
import javax.swing.JComponent
import kotlin.math.roundToInt
import kotlin.math.sign

/** A JCEF browser with the page, its bridge and the security handlers. */
class JcefPage private constructor(
    assets: AssetRequestHandler,
    onMessage: (PageMessage) -> Unit,
    onCrash: () -> Unit,
) : PageHost {
    private val disposable = Disposer.newDisposable("markdone browser")

    // Not created yet: the JS queries and handlers must exist before the native browser.
    private val browser = JBCefBrowser.createBuilder().setUrl(PAGE_URL).build()
    private val bridge: Bridge
    private val requests = SecurityHandlers.Requests(PAGE_URL, assets, onCrash)

    init {
        Disposer.register(disposable, browser)
        bridge = Bridge(browser, disposable) { _, message -> onMessage(message) }
        val client = browser.jbCefClient
        val cefBrowser = browser.cefBrowser
        client.addRequestHandler(requests, cefBrowser)
        client.addLifeSpanHandler(SecurityHandlers.LifeSpan(), cefBrowser)
        client.addDragHandler(SecurityHandlers.Drag(), cefBrowser)
        client.addContextMenuHandler(ContextMenuHandler(), cefBrowser)
        client.addLoadHandler(object : CefLoadHandlerAdapter() {
            override fun onLoadEnd(browser: CefBrowser?, frame: CefFrame?, httpStatusCode: Int) {
                if (frame?.isMain == true && frame.url == PAGE_URL) bridge.installHost()
            }
        }, cefBrowser)
        cefBrowser.uiComponent.addMouseWheelListener(WheelStep())
        // Load the page now, not when the component is first added to the UI.
        browser.createImmediately()
    }

    /**
     * Mouse-wheel step in Edit mode. JCEF's off-screen component sends a wheel event to the page as
     * `(int) (preciseWheelRotation × factor) × scrollAmount` px (registry `ide.browser.jcef.osr.wheelRotation.factor`,
     * default 10; L5 t28f): 30 px for one notch, where the Source editor scrolls `unitsToScroll × line height`
     * (66 px with a 22 px line). This listener runs before JCEF's own handling: it consumes a notch (unit scroll, whole
     * rotation, no modifier key) and dispatches it again with a scaled rotation, so the page gets `unitsToScroll × line
     * height` px of the Source editor. Touch and precise (fractional) scrolling and Ctrl/Cmd+wheel (zoom) pass unchanged.
     */
    internal class WheelStep(
        private val lineHeight: (Component) -> Int? = { WebEditor.ofBrowserComponent(it)?.owner?.textEditor?.editor?.lineHeight },
        private val factor: () -> Int = { Registry.intValue(WHEEL_FACTOR_KEY, 10) },
    ) : MouseWheelListener {
        // The scaled event while it is dispatched: it passes this listener.
        private var scaled: MouseWheelEvent? = null

        override fun mouseWheelMoved(e: MouseWheelEvent) {
            if (e === scaled || !isNotch(e)) return
            val rotation = e.wheelRotation
            val precise = scaledRotation(rotation, lineHeight(e.component) ?: return, factor()) ?: return
            val event = MouseWheelEvent(
                e.component, e.id, e.`when`, e.modifiersEx, e.x, e.y, e.xOnScreen, e.yOnScreen, e.clickCount,
                e.isPopupTrigger, e.scrollType, e.scrollAmount, rotation, precise,
            )
            e.consume()
            scaled = event
            try {
                e.component.dispatchEvent(event)
            } finally {
                scaled = null
            }
        }

        companion object {
            /** True for a wheel notch to scale: unit scroll, whole rotation, no modifier key, not consumed. */
            internal fun isNotch(e: MouseWheelEvent): Boolean =
                !e.isConsumed && e.scrollType == MouseWheelEvent.WHEEL_UNIT_SCROLL &&
                    e.preciseWheelRotation == e.wheelRotation.toDouble() && e.modifiersEx and MODIFIER_KEYS == 0

            /** Precise rotation that makes JCEF scroll `rotation × lineHeight` px, or null for a [factor] ≤ 0. */
            internal fun scaledRotation(rotation: Int, lineHeight: Int, factor: Int): Double? {
                if (factor <= 0) return null
                // Half a pixel more: JCEF's int cast of precise × factor must not round down.
                return (rotation * lineHeight + 0.5 * rotation.toDouble().sign) / factor
            }
        }
    }

    override val component: JComponent
        get() = browser.component

    override fun send(message: JsonObject) = bridge.send(message)

    /*
     * CSS px are DIP at 100 % zoom, and Swing coordinates are DIP too (the HiDPI scale is applied
     * below Swing; L5 with OSR and scale 2: clientX = component x). JBCefBrowserBase.getZoomLevel()
     * already returns the factor 1.2^(CEF zoom level), and the platform does not set a CEF zoom level,
     * so the factor is 1 unless the page zoom was changed.
     */
    override fun toComponentPoint(x: Double, y: Double): Point = toComponentPoint(x, y, browser.zoomLevel)

    override fun reload() {
        requests.allowPageLoad()
        browser.cefBrowser.reloadIgnoreCache()
    }

    override fun dispose() = Disposer.dispose(disposable)

    companion object {
        const val PAGE_URL = "${AssetRequestHandler.ORIGIN}/app/index.html"

        private const val WHEEL_FACTOR_KEY = "ide.browser.jcef.osr.wheelRotation.factor"
        private const val MODIFIER_KEYS = InputEvent.SHIFT_DOWN_MASK or InputEvent.CTRL_DOWN_MASK or InputEvent.META_DOWN_MASK or
            InputEvent.ALT_DOWN_MASK or InputEvent.ALT_GRAPH_DOWN_MASK

        val FACTORY = PageFactory { assets, onMessage, onCrash -> JcefPage(assets, onMessage, onCrash) }

        /** Page viewport CSS px → component px for the page zoom [zoomFactor] (1.0 = 100 %). */
        internal fun toComponentPoint(x: Double, y: Double, zoomFactor: Double): Point =
            Point((x * zoomFactor).roundToInt(), (y * zoomFactor).roundToInt())
    }
}
