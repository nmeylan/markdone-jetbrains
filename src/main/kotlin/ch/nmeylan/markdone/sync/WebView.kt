package ch.nmeylan.markdone.sync

import com.google.gson.JsonObject

/**
 * The page as [DocumentSync] sees it. The JCEF implementation is `jcef.Bridge`; tests use a fake,
 * because JCEF does not run in the headless test framework.
 * Messages from the page reach [DocumentSync.receive] with the view that sent them.
 */
interface WebView {
    /** Sends an IDE → page message. Called on the EDT. */
    fun send(message: JsonObject)
}
