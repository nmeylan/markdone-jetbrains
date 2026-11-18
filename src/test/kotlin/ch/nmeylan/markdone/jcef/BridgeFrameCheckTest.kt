package ch.nmeylan.markdone.jcef

import ch.nmeylan.markdone.sync.PageMessage
import org.cef.browser.CefFrame
import org.cef.callback.CefQueryCallback
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.lang.reflect.Proxy

/** The bridge accepts calls from the main frame of the page only (protocol/PROTOCOL.md; draw.io frame). */
class BridgeFrameCheckTest {
    private val ready = """{"type":"ready","protocol":2}"""

    private fun frame(isMain: Boolean, url: String?): CefFrame =
        Proxy.newProxyInstance(javaClass.classLoader, arrayOf(CefFrame::class.java)) { _, method, _ ->
            when (method.name) {
                "isMain" -> isMain
                "getURL" -> url
                else -> throw UnsupportedOperationException(method.name)
            }
        } as CefFrame

    private class Callback : CefQueryCallback {
        var success: String? = null
        var failure: Pair<Int, String?>? = null
        override fun success(response: String?) {
            success = response
        }

        override fun failure(errorCode: Int, errorMessage: String?) {
            failure = errorCode to errorMessage
        }
    }

    /** Calls the handler of channel `ready` with [json] from [frame]; returns the accepted messages and the callback. */
    private fun call(frame: CefFrame?, json: String = ready): Pair<List<PageMessage>, Callback> {
        val accepted = mutableListOf<PageMessage>()
        val callback = Callback()
        val handled = Bridge.ChannelHandler("ready") { accepted += it }.onQuery(null, frame, 1, json, false, callback)
        assertTrue(handled)
        return accepted to callback
    }

    @Test
    fun mainFrameOfThePageIsAccepted() {
        val (accepted, callback) = call(frame(true, JcefPage.PAGE_URL))
        assertEquals(listOf<PageMessage>(PageMessage.Ready(2)), accepted)
        assertEquals("", callback.success)
    }

    @Test
    fun mainFrameWithFragmentIsAccepted() {
        assertEquals(1, call(frame(true, JcefPage.PAGE_URL + "#x")).first.size)
    }

    @Test
    fun subFrameIsRejected() {
        val (accepted, callback) = call(frame(false, JcefPage.PAGE_URL))
        assertTrue(accepted.isEmpty())
        assertEquals(403, callback.failure?.first)
    }

    @Test
    fun drawioSubFrameIsRejected() {
        val (accepted, callback) = call(frame(false, "${AssetRequestHandler.ORIGIN}/app/drawio/viewer.html"))
        assertTrue(accepted.isEmpty())
        assertEquals(403, callback.failure?.first)
    }

    @Test
    fun nullFrameIsRejected() {
        val (accepted, callback) = call(null)
        assertTrue(accepted.isEmpty())
        assertEquals(403, callback.failure?.first)
    }

    @Test
    fun mainFrameWithOtherUrlIsRejected() {
        for (url in listOf("https://example.com/app/index.html", "${AssetRequestHandler.ORIGIN}/app/other.html", "about:blank", null)) {
            val (accepted, callback) = call(frame(true, url))
            assertTrue(url ?: "null", accepted.isEmpty())
            assertEquals(403, callback.failure?.first)
        }
    }

    @Test
    fun invalidMessageFromMainFrameIsNotAccepted() {
        val (accepted, _) = call(frame(true, JcefPage.PAGE_URL), """{"type":"ready","protocol":2,"x":1}""")
        assertTrue(accepted.isEmpty())
    }
}
