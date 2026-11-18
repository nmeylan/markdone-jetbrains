package ch.nmeylan.markdone.sync

import com.google.gson.JsonObject

/** Records what Kotlin sends to the page. */
class FakeWebView : WebView {
    val sent = mutableListOf<JsonObject>()

    override fun send(message: JsonObject) {
        sent += message
    }
}
