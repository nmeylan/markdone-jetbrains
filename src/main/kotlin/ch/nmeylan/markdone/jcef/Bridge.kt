package ch.nmeylan.markdone.jcef

import com.google.gson.JsonObject
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.util.Disposer
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery
import ch.nmeylan.markdone.sync.PageMessage
import ch.nmeylan.markdone.sync.PageMessages
import ch.nmeylan.markdone.sync.WebView

/**
 * The four page → IDE functions (`window.__markdoneHost`) and IDE → page messages for one browser.
 * Create it before the native browser is created: [JBCefJSQuery] requires that.
 * [onMessage] runs on a CEF thread with this bridge and a validated message; it must not block.
 */
class Bridge(
    private val browser: JBCefBrowser,
    parent: Disposable,
    private val onMessage: (WebView, PageMessage) -> Unit,
) : WebView {

    // shortcut: 261 has no JBCefJSQuery.FramePolicy; create(browser) accepts calls from every frame of this browser.
    private val queries: Map<String, JBCefJSQuery> =
        PageMessages.CHANNELS.associateWith { JBCefJSQuery.create(browser as JBCefBrowserBase) }

    init {
        for ((channel, query) in queries) {
            Disposer.register(parent, query)
            query.addHandler { json ->
                val message = PageMessages.parse(channel, json)
                if (message == null) LOG.warn("Rejected invalid '$channel' message (${json.length} chars)")
                else onMessage(this, message)
                null
            }
        }
    }

    /** Defines `window.__markdoneHost` and fires `markdone-host`. Call after each main-frame load end. */
    fun installHost() {
        val functions = queries.entries.joinToString(",\n") { (channel, query) ->
            "  $channel: function (json) { ${query.inject("json")} }"
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
    }
}
