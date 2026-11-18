package ch.nmeylan.markdone.jcef

import com.google.gson.JsonObject
import ch.nmeylan.markdone.css.UserCssService
import ch.nmeylan.markdone.sync.PageMessage
import java.awt.Point
import javax.swing.JComponent
import javax.swing.JPanel

/** A page without JCEF: records what Kotlin sends; the test plays the page with [deliver]. */
class FakePage(
    val assets: AssetRequestHandler,
    private val onMessage: (PageMessage) -> Unit,
    private val onCrash: () -> Unit,
) : PageHost {
    val sent = mutableListOf<JsonObject>()
    var disposed = false
    var reloads = 0
    override val component: JComponent = JPanel()

    override fun send(message: JsonObject) {
        sent += message
    }

    override fun toComponentPoint(x: Double, y: Double) = Point(x.toInt(), y.toInt())

    override fun reload() {
        reloads++
    }

    override fun dispose() {
        disposed = true
    }

    fun deliver(message: PageMessage) = onMessage(message)

    fun crash() = onCrash()

    fun sentTypes(): List<String> = sent.map { it["type"].asString }

    /** The docId of the last message that has one. */
    fun lastDocId(): String = sent.last { it.has("docId") }["docId"].asString
}

/** A CSS loader that answers at once with no user CSS. */
val NO_CSS: (com.intellij.openapi.project.Project, String, (UserCssService.UserCss) -> Unit) -> Unit =
    { _, _, done -> done(UserCssService.UserCss("", null, false)) }

/** Creates [FakePage]s and keeps them in creation order. */
class FakePageFactory : PageFactory {
    val pages = mutableListOf<FakePage>()

    override fun create(assets: AssetRequestHandler, onMessage: (PageMessage) -> Unit, onCrash: () -> Unit): PageHost =
        FakePage(assets, onMessage, onCrash).also { pages += it }
}
