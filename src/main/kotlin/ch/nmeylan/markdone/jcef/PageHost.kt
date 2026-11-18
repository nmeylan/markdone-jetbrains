package ch.nmeylan.markdone.jcef

import ch.nmeylan.markdone.sync.PageMessage
import ch.nmeylan.markdone.sync.WebView
import java.awt.Point
import javax.swing.JComponent

/** One browser with the page loaded (JCEF: [JcefPage]; tests use a fake). Used on the EDT. */
interface PageHost : WebView {
    /** The Swing component that shows the page. */
    val component: JComponent

    /** Converts a point in page viewport CSS px to [component] coordinates. */
    fun toComponentPoint(x: Double, y: Double): Point

    /** Loads the page again (new CSP); the page then sends `ready`. */
    fun reload()

    fun dispose()
}

/** Creates pages for [SharedBrowserService]. */
fun interface PageFactory {
    /**
     * Creates a browser that loads the page. Requests go to [assets]. [onMessage] gets validated page
     * messages and [onCrash] the end of the renderer process; both run on a CEF thread and must not block.
     */
    fun create(assets: AssetRequestHandler, onMessage: (PageMessage) -> Unit, onCrash: () -> Unit): PageHost
}
