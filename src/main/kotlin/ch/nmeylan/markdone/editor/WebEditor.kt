package ch.nmeylan.markdone.editor

import com.intellij.openapi.editor.Document
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorState
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.UserDataHolderBase
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.EditorNotificationPanel
import com.intellij.ui.components.JBLabel
import com.intellij.ui.jcef.JBCefApp
import ch.nmeylan.markdone.jcef.SharedBrowserService
import java.awt.BorderLayout
import java.awt.Component
import java.awt.event.HierarchyEvent
import java.beans.PropertyChangeListener
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.SwingConstants

/**
 * Edit mode: a light panel. When it is on screen, [SharedBrowserService] moves the shared browser
 * into it and activates this document in the page.
 */
class WebEditor(
    internal val project: Project,
    private val file: VirtualFile,
    internal val document: Document,
    private val browsers: () -> SharedBrowserService = { SharedBrowserService.getInstance() },
) : UserDataHolderBase(), FileEditor {

    /** The tab that holds this view; set by [MdEditor]. */
    internal var owner: MdEditor? = null

    /** Start of a switch to Edit mode, for `toggleToActivatedMs`; 0 when none. */
    internal var toggleStartNanos = 0L

    /** Selection of this tab in Edit mode, for `tabSwitchMs`; 0 when none. */
    internal var tabSwitchStartNanos = 0L

    /** Source → Edit (protocol 2.4): the text editor's place, sent with the next `activate` of this view. */
    internal var sourcePlace: Place? = null

    private val panel = JPanel(BorderLayout())
    private var cssNotice: JComponent? = null

    // The service is used only after the first show, so Source-only tabs never load it.
    private var used = false
    private var disposed = false
    private var unavailable = false

    init {
        panel.putClientProperty(KEY, this)
        if (JBCefApp.isSupported()) {
            panel.addHierarchyListener { e ->
                if (e.changeFlags and HierarchyEvent.SHOWING_CHANGED.toLong() != 0L) {
                    if (panel.isShowing) onShown() else onHidden()
                }
            }
        } else {
            panel.add(JBLabel("Edit mode is not available: this IDE runs without JCEF. Use Source mode.", SwingConstants.CENTER))
        }
    }

    /** Asks the page to flush its edits; [onDone] gets the page's `viewport` for this flush, if any; see [SharedBrowserService.flush]. */
    fun flush(onDone: (Place?) -> Unit) {
        if (used && !disposed) browsers().flush(this, onDone) else onDone(null)
    }

    /** Starts the `toggleToActivatedMs` clock. */
    fun markToggle() {
        toggleStartNanos = System.nanoTime()
    }

    /** The view is on screen (also called by tests, which have no Swing hierarchy). */
    internal fun onShown() {
        if (disposed) return
        used = true
        browsers().shown(this)
    }

    internal fun onHidden() {
        tabSwitchStartNanos = 0L
        sourcePlace = null
        if (used && !disposed) browsers().hidden(this)
    }

    /** The browser stopped for good: shows a message instead of the page. */
    internal fun showUnavailable() {
        if (unavailable) return
        unavailable = true
        panel.removeAll()
        panel.add(JBLabel("Edit mode is not available: the embedded browser stopped. Use Source mode.", SwingConstants.CENTER))
        panel.revalidate()
        panel.repaint()
    }

    /** Whether the message of [showUnavailable] is shown (tests). */
    internal val isUnavailable: Boolean
        get() = unavailable

    /** Runs undo or redo for this view's document after a flush; see [SharedBrowserService.undoRedo]. */
    fun undoRedo(redo: Boolean) {
        if (used && !disposed) browsers().undoRedo(this, redo)
    }

    /** Shows or hides the one-line notice that the project CSS is not applied (untrusted project). */
    internal fun showProjectCssNotice(show: Boolean) {
        if (show == (cssNotice != null) || unavailable) return
        if (show) {
            cssNotice = EditorNotificationPanel(EditorNotificationPanel.Status.Warning).text(PROJECT_CSS_NOTICE)
                .also { panel.add(it, BorderLayout.NORTH) }
        } else {
            cssNotice?.let(panel::remove)
            cssNotice = null
        }
        panel.revalidate()
        panel.repaint()
    }

    /** Whether the notice of [showProjectCssNotice] is shown (tests). */
    internal val hasProjectCssNotice: Boolean
        get() = cssNotice != null

    /** Puts the browser [component] into this view. */
    internal fun attachBrowser(component: JComponent) {
        panel.add(component, BorderLayout.CENTER)
        panel.revalidate()
        panel.repaint()
    }

    /** Takes the browser [component] out of this view, if it is here. */
    internal fun detachBrowser(component: JComponent) {
        if (component.parent !== panel) return
        panel.remove(component)
        panel.revalidate()
        panel.repaint()
    }

    override fun getComponent(): JComponent = panel

    // The browser (or a message) is at CENTER; the project CSS notice at NORTH can come first in the child list.
    override fun getPreferredFocusedComponent(): JComponent? =
        (panel.layout as BorderLayout).getLayoutComponent(BorderLayout.CENTER) as? JComponent ?: panel

    override fun getName(): String = "Edit"

    override fun setState(state: FileEditorState) = Unit

    override fun isModified(): Boolean = false

    override fun isValid(): Boolean = file.isValid

    override fun selectNotify() {
        if (JBCefApp.isSupported() && panel.isShowing) onShown()
    }

    override fun addPropertyChangeListener(listener: PropertyChangeListener) = Unit

    override fun removePropertyChangeListener(listener: PropertyChangeListener) = Unit

    override fun getFile(): VirtualFile = file

    override fun dispose() {
        if (disposed) return
        disposed = true
        if (used) browsers().unregister(this)
    }

    /** Start offset of the first visible line, and the main selection (protocol 2.4 mode switch sync). */
    data class Place(val top: Int, val anchor: Int, val head: Int)

    companion object {
        private const val KEY = "markdone.webEditor"
        const val PROJECT_CSS_NOTICE = "Project CSS not applied: project not trusted"

        /** The Edit view whose browser holds [component] (for example the focus owner), if any. */
        fun ofBrowserComponent(component: Component?): WebEditor? {
            var c = component
            while (c != null) {
                val editor = (c as? JComponent)?.getClientProperty(KEY) as? WebEditor
                // Only a component below the panel: the panel itself (no browser yet, or the message) does not count.
                if (editor != null) return editor.takeIf { c !== component && !it.unavailable && !it.disposed }
                c = c.parent
            }
            return null
        }
    }
}
