package ch.nmeylan.markdone.settings

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.components.BaseState
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.SimplePersistentStateComponent
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.ui.EditorNotifications
import com.intellij.util.messages.Topic

/** Built-in page style (protocol 2.3 `settings.style`). */
enum class MdStyle(val id: String, val label: String) {
    DEFAULT("default", "Default"),
    COMPACT("compact", "Compact"),
    SERIF("serif", "Serif"),
}

/** Application settings; the page is [MdConfigurable]. Use on the EDT. */
@Service(Service.Level.APP)
@State(name = "MarkdoneSettings", storages = [Storage("markdone.xml")])
class MdSettings : SimplePersistentStateComponent<MdSettings.SettingsState>(SettingsState()) {

    class SettingsState : BaseState() {
        var globalCss by string("")
        var remoteImages by property(false)
        var largeFileLimitMb by property(MAX_LARGE_FILE_MB)
        var style by enum(MdStyle.DEFAULT)
        var math by property(true)
        var mermaid by property(true)
        var highlight by property(true)
        var softBreaks by property(true)

        // Percent: an exact step of 0.1.
        var zoomPercent by property(100)
    }

    /** Global user CSS. */
    var globalCss: String
        get() = state.globalCss ?: ""
        set(value) {
            if (value == globalCss) return
            state.globalCss = value
            changed()
        }

    /** Remote `http(s)` images in the page (off by default). A change reloads the pages: the CSP changes. */
    var remoteImages: Boolean
        get() = state.remoteImages
        set(value) {
            if (value == remoteImages) return
            state.remoteImages = value
            changed()
        }

    /** Files above this size open in Source mode only; 1..20 MB. */
    var largeFileLimitMb: Int
        get() = state.largeFileLimitMb.coerceIn(1, MAX_LARGE_FILE_MB)
        set(value) {
            val v = value.coerceIn(1, MAX_LARGE_FILE_MB)
            if (v == largeFileLimitMb) return
            state.largeFileLimitMb = v
            changed()
            EditorNotifications.updateAll()
        }

    /**
     * Whether a file of [length] bytes is above the limit: its size in whole MB (MiB, rounded down) is
     * larger than [largeFileLimitMb]. So the 20 MB corpus file (20 MiB + a few bytes) is still allowed.
     */
    fun isAboveLargeFileLimit(length: Long): Boolean = length / (1024L * 1024L) > largeFileLimitMb

    var style: MdStyle
        get() = state.style
        set(value) {
            if (value == style) return
            state.style = value
            changed()
        }

    var math: Boolean
        get() = state.math
        set(value) {
            if (value == math) return
            state.math = value
            changed()
        }

    var mermaid: Boolean
        get() = state.mermaid
        set(value) {
            if (value == mermaid) return
            state.mermaid = value
            changed()
        }

    var highlight: Boolean
        get() = state.highlight
        set(value) {
            if (value == highlight) return
            state.highlight = value
            changed()
        }

    /** On: a single line feed in a paragraph shows as a line break. Off: it shows as a space. */
    var softBreaks: Boolean
        get() = state.softBreaks
        set(value) {
            if (value == softBreaks) return
            state.softBreaks = value
            changed()
        }

    /** Edit-mode zoom (protocol 2.3 `theme.zoom`), 0.5..3.0. */
    val zoom: Double
        get() = zoomPercent / 100.0

    /** [zoom] in percent, [MIN_ZOOM_PERCENT]..[MAX_ZOOM_PERCENT] (the settings page edits this value). */
    var zoomPercent: Int
        get() = zoomPercentClamped
        set(value) = changeZoomPercent(value)

    fun zoomIn() = changeZoomPercent(zoomPercentClamped + ZOOM_STEP_PERCENT)

    fun zoomOut() = changeZoomPercent(zoomPercentClamped - ZOOM_STEP_PERCENT)

    fun zoomReset() = changeZoomPercent(100)

    private val zoomPercentClamped: Int
        get() = state.zoomPercent.coerceIn(MIN_ZOOM_PERCENT, MAX_ZOOM_PERCENT)

    private fun changeZoomPercent(percent: Int) {
        val v = percent.coerceIn(MIN_ZOOM_PERCENT, MAX_ZOOM_PERCENT)
        if (v == zoomPercentClamped) return
        state.zoomPercent = v
        changed()
    }

    /** Also after Settings Sync or a settings import: the pages and the banners follow. */
    override fun loadState(state: SettingsState) {
        super.loadState(state)
        // Later: the first load runs while the service is being created.
        ApplicationManager.getApplication().invokeLater({
            changed()
            EditorNotifications.updateAll()
        }, ModalityState.any())
    }

    private fun changed() = ApplicationManager.getApplication().messageBus.syncPublisher(TOPIC).settingsChanged()

    fun interface Listener {
        fun settingsChanged()
    }

    companion object {
        const val MAX_LARGE_FILE_MB = 20
        const val MIN_ZOOM_PERCENT = 50
        const val MAX_ZOOM_PERCENT = 300
        const val ZOOM_STEP_PERCENT = 10

        @Topic.AppLevel
        val TOPIC = Topic(Listener::class.java, Topic.BroadcastDirection.NONE)

        fun getInstance(): MdSettings = service()
    }
}

/** Project settings: the project CSS file, relative to the project directory. */
@Service(Service.Level.PROJECT)
@State(name = "MarkdoneProjectSettings", storages = [Storage("markdone.xml")])
class MdProjectSettings : SimplePersistentStateComponent<MdProjectSettings.ProjectState>(ProjectState()) {

    class ProjectState : BaseState() {
        var projectCssPath by string(DEFAULT_CSS_PATH)
    }

    /** Also after Settings Sync or a settings import: the CSS follows. */
    override fun loadState(state: ProjectState) {
        super.loadState(state)
        // Later: the first load runs while the service is being created.
        ApplicationManager.getApplication().invokeLater({
            ApplicationManager.getApplication().messageBus.syncPublisher(MdSettings.TOPIC).settingsChanged()
        }, ModalityState.any())
    }

    var projectCssPath: String
        get() = state.projectCssPath ?: DEFAULT_CSS_PATH
        set(value) {
            if (value == projectCssPath) return
            state.projectCssPath = value
            ApplicationManager.getApplication().messageBus.syncPublisher(MdSettings.TOPIC).settingsChanged()
        }

    companion object {
        const val DEFAULT_CSS_PATH = ".markdone/style.css"

        fun getInstance(project: Project): MdProjectSettings = project.service()
    }
}
