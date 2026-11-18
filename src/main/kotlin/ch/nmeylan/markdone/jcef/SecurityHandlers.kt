package ch.nmeylan.markdone.jcef

import com.intellij.openapi.diagnostic.logger
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.callback.CefDragData
import org.cef.handler.CefDragHandler
import org.cef.handler.CefLifeSpanHandlerAdapter
import org.cef.handler.CefRequestHandler
import org.cef.handler.CefRequestHandlerAdapter
import org.cef.handler.CefResourceRequestHandler
import org.cef.misc.BoolRef
import org.cef.network.CefRequest

/** Navigation, pop-up and drop rules for one browser. */
object SecurityHandlers {
    private val LOG = logger<SecurityHandlers>()

    /**
     * Allows only the first main-frame load of [pageUrl] (and one more after each [allowPageLoad]) and
     * routes every resource request to [assets]. One request handler does both, so no other handler
     * decides about our requests. [onRendererGone] runs on a CEF thread when the renderer process ends.
     */
    class Requests(
        private val pageUrl: String,
        private val assets: AssetRequestHandler,
        private val onRendererGone: () -> Unit,
    ) : CefRequestHandlerAdapter() {
        @Volatile
        private var pageLoaded = false

        /** Allows one more main-frame load of the page; the IDE calls this before it reloads the page. */
        fun allowPageLoad() {
            pageLoaded = false
        }

        override fun onBeforeBrowse(
            browser: CefBrowser?, frame: CefFrame?, request: CefRequest, userGesture: Boolean, isRedirect: Boolean,
        ): Boolean {
            val url = request.url
            // The platform can load about:blank before the page; it has no content and no bridge.
            if (url == "about:blank") return false
            if (frame?.isMain == true && !pageLoaded && !isRedirect && url == pageUrl) {
                pageLoaded = true
                return false
            }
            LOG.info("Blocked navigation to ${url.take(200)}")
            return true
        }

        override fun onOpenURLFromTab(browser: CefBrowser?, frame: CefFrame?, targetUrl: String?, userGesture: Boolean) = true

        override fun getResourceRequestHandler(
            browser: CefBrowser?, frame: CefFrame?, request: CefRequest,
            isNavigation: Boolean, isDownload: Boolean, requestInitiator: String?, disableDefaultHandling: BoolRef?,
        ): CefResourceRequestHandler = assets

        override fun onRenderProcessTerminated(
            browser: CefBrowser?, status: CefRequestHandler.TerminationStatus?, errorCode: Int, errorString: String?,
        ) {
            LOG.warn("Renderer process terminated: $status ($errorCode ${errorString?.take(200)})")
            onRendererGone()
        }
    }

    /** Pop-ups are always cancelled. */
    class LifeSpan : CefLifeSpanHandlerAdapter() {
        override fun onBeforePopup(browser: CefBrowser?, frame: CefFrame?, targetUrl: String?, targetFrameName: String?): Boolean {
            LOG.info("Blocked pop-up to ${targetUrl?.take(200)}")
            return true
        }
    }

    /** File drops are refused, so no local path gets into the page. */
    class Drag : CefDragHandler {
        override fun onDragEnter(browser: CefBrowser?, dragData: CefDragData, mask: Int): Boolean = dragData.isFile
    }
}
