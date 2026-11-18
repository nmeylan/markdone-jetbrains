package ch.nmeylan.markdone.jcef

import com.google.gson.JsonObject
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.util.Disposer
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefApp
import ch.nmeylan.markdone.sync.PageMessage
import ch.nmeylan.markdone.sync.PageMessages
import ch.nmeylan.markdone.sync.WebView
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.browser.CefMessageRouter
import org.cef.callback.CefQueryCallback
import org.cef.handler.CefMessageRouterHandlerAdapter

/**
 * The four page → IDE functions (`window.__markdoneHost`) and IDE → page messages for one browser.
 * Create it before the native browser is created: the message routers must exist before it.
 * Only the main frame of the page may call the functions ([ChannelHandler]): CEF defines them in every frame.
 * [onMessage] runs on a CEF thread with this bridge and a validated message; it must not block.
 */
class Bridge(
    private val browser: JBCefBrowser,
    parent: Disposable,
    private val onMessage: (WebView, PageMessage) -> Unit,
) : WebView {

    private val routers: Map<String, CefMessageRouter> = PageMessages.CHANNELS.associateWith { channel ->
        JBCefApp.getInstance().createMessageRouter(CefMessageRouter.CefMessageRouterConfig(queryFunction(channel), cancelFunction(channel)))
    }

    init {
        val cefClient = browser.jbCefClient.cefClient
        for ((channel, router) in routers) {
            router.addHandler(ChannelHandler(channel) { message -> onMessage(this, message) }, true)
            cefClient.addMessageRouter(router)
        }
        Disposer.register(parent) {
            for (router in routers.values) {
                cefClient.removeMessageRouter(router)
                router.dispose()
            }
        }
    }

    /** Handles the calls of one channel: only the main frame of the page gets through, before any parsing. */
    internal class ChannelHandler(private val channel: String, private val accept: (PageMessage) -> Unit) : CefMessageRouterHandlerAdapter() {
        override fun onQuery(
            browser: CefBrowser?, frame: CefFrame?, queryId: Long, request: String?, persistent: Boolean, callback: CefQueryCallback,
        ): Boolean {
            if (!isPageMainFrame(frame)) {
                LOG.warn("Rejected '$channel' call from a frame that is not the page (main=${frame?.isMain}, url=${frame?.url?.take(200)})")
                callback.failure(403, "rejected")
                return true
            }
            val json = request.orEmpty()
            val message = PageMessages.parse(channel, json)
            if (message == null) LOG.warn("Rejected invalid '$channel' message (${json.length} chars)") else accept(message)
            callback.success("")
            return true
        }
    }

    /** Defines `window.__markdoneHost` and fires `markdone-host`. Call after each main-frame load end. */
    fun installHost() {
        val functions = routers.keys.joinToString(",\n") { channel ->
            "  $channel: function (json) { window.${queryFunction(channel)}({ request: json, persistent: false, " +
                "onSuccess: function () {}, onFailure: function () {} }); }"
        }
        val script = "window.__markdoneHost = Object.freeze({\n$functions\n});\n" +
            "window.dispatchEvent(new Event('markdone-host'));"
        browser.cefBrowser.mainFrame?.executeJavaScript(script, AssetRequestHandler.ORIGIN + "/host.js", 0)
    }

    override fun send(message: JsonObject) {
        // JSON is a valid JS expression, so the message goes in as a literal.
        val script = "window.markdone && window.markdone.receive($message);"
        browser.cefBrowser.mainFrame?.executeJavaScript(script, AssetRequestHandler.ORIGIN + "/send.js", 0)
    }

    companion object {
        private val LOG = logger<Bridge>()

        private fun queryFunction(channel: String) = "markdoneQuery_$channel"

        private fun cancelFunction(channel: String) = "markdoneQueryCancel_$channel"

        /** True for the main frame of the page: a sub-frame, no frame or another main-frame URL is refused. */
        internal fun isPageMainFrame(frame: CefFrame?): Boolean =
            frame != null && frame.isMain && frame.url?.substringBefore('#') == JcefPage.PAGE_URL
    }
}
