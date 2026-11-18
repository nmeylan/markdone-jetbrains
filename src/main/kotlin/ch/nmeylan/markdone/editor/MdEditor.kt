package ch.nmeylan.markdone.editor

import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionGroup
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.actionSystem.ToggleAction
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.editor.Document
import com.intellij.openapi.editor.LogicalPosition
import com.intellij.openapi.editor.ScrollType
import com.intellij.openapi.editor.ex.EditorEx
import com.intellij.openapi.editor.highlighter.EditorHighlighter
import com.intellij.openapi.editor.highlighter.EditorHighlighterFactory
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.FileEditorState
import com.intellij.openapi.fileEditor.TextEditor
import com.intellij.openapi.fileEditor.TextEditorWithPreview
import com.intellij.openapi.fileEditor.impl.text.AsyncEditorLoader
import com.intellij.openapi.fileTypes.PlainSyntaxHighlighter
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.openapi.vfs.newvfs.BulkFileListener
import com.intellij.openapi.vfs.newvfs.events.VFileContentChangeEvent
import com.intellij.openapi.vfs.newvfs.events.VFileEvent
import com.intellij.openapi.vfs.newvfs.events.VFilePropertyChangeEvent
import com.intellij.openapi.wm.IdeFocusManager
import com.intellij.ui.EditorNotifications
import ch.nmeylan.markdone.settings.MdSettings
import java.awt.Point
import java.awt.event.HierarchyEvent
import java.awt.event.HierarchyListener
import java.beans.PropertyChangeListener
import javax.swing.Icon
import javax.swing.JComponent
import javax.swing.SwingUtilities

/**
 * The Markdown tab: Source mode (`SHOW_EDITOR`, platform text editor) and Edit mode
 * (`SHOW_PREVIEW`, [WebEditor]). There is no split mode. An open starts in Source, unless the "open in Edit mode" setting is on.
 */
class MdEditor(textEditor: TextEditor, private val web: WebEditor) :
    TextEditorWithPreview(textEditor, web, "markdone", Layout.SHOW_EDITOR, false, Layout.SHOW_EDITOR) {

    // Each switch request gets a new number, so a late flush reply cannot undo a newer switch.
    private var switchGeneration = 0

    // The base class disposes the text editor before the preview; a flush that WebEditor completes then must not switch.
    private var disposed = false

    // The plain-text highlighter of the hidden Source editor while it is set (see setPlainHighlighter).
    private var plainHighlighter: EditorHighlighter? = null

    // Document writability: the tab color shows it (ReadOnlyTabColorProvider).
    private val writableListener = PropertyChangeListener { e -> if (e.propertyName == Document.PROP_WRITABLE) updateTabColor() }

    /** Asks the platform for a new tab color (test seam). */
    internal var updateTabColor: () -> Unit = {
        if (!web.project.isDisposed) FileEditorManager.getInstance(web.project).updateFilePresentation(web.file)
    }

    /** Moves the keyboard focus to a component (test seam). */
    internal var requestFocus: (JComponent) -> Unit = { IdeFocusManager.getInstance(web.project).requestFocusInProject(it, web.project) }

    init {
        web.owner = this
        // The large-file banner depends on the file size (and the layout, see onLayoutChange).
        ApplicationManager.getApplication().messageBus.connect(this).subscribe(VirtualFileManager.VFS_CHANGES, object : BulkFileListener {
            override fun after(events: List<VFileEvent>) {
                if (events.any { it is VFileContentChangeEvent && it.file == web.file }) updateBanner()
                // The platform updates only the tab icon on a writable change, not the color.
                if (events.any { it is VFilePropertyChangeEvent && it.propertyName == VirtualFile.PROP_WRITABLE && it.file == web.file }) updateTabColor()
            }
        })
        web.document.addPropertyChangeListener(writableListener)
        // The platform can set the file's highlighter later (the async loader of a big file): plain again.
        (textEditor.editor as? EditorEx)?.addPropertyChangeListener({ e ->
            if (e.propertyName == EditorEx.PROP_HIGHLIGHTER && plainHighlighter != null && e.newValue !== plainHighlighter) {
                installPlainHighlighter(textEditor.editor as EditorEx)
            }
        }, this)
        /*
         * The platform does not update the banners of this editor while the text editor loads, and after the load
         * it updates them only for the text editor. So update the banner here (on the EDT; at once when loaded).
         */
        AsyncEditorLoader.performWhenLoaded(textEditor.editor) { if (!disposed) updateBanner() }
    }

    /** The file is larger than the large-file limit: no switch to Edit mode. */
    val isEditModeBlocked: Boolean
        get() = MdSettings.getInstance().isAboveLargeFileLimit(web.file.length)

    /** Switches between Source and Edit. */
    fun toggleMode() {
        setLayout(if (getLayout() == Layout.SHOW_PREVIEW) Layout.SHOW_EDITOR else Layout.SHOW_PREVIEW)
    }

    /**
     * Ctrl/Cmd-click in the page: after the flush (as for the mode switch), Source mode with the caret
     * at [pos] (clamped to the text), scrolled into view, and the focus in the text editor.
     */
    fun gotoSource(pos: Int) {
        val generation = ++switchGeneration
        web.flush {
            if (disposed || generation != switchGeneration) return@flush
            if (getLayout() != Layout.SHOW_EDITOR) applyLayout(Layout.SHOW_EDITOR)
            val editor = textEditor.editor
            editor.selectionModel.removeSelection()
            editor.caretModel.moveToOffset(pos.coerceIn(0, editor.document.textLength))
            editor.scrollingModel.scrollToCaret(ScrollType.CENTER)
            focusLater()
        }
    }

    override fun setState(state: FileEditorState) {
        // Drop the restored layout, keep the text editor state.
        if (state is MyFileEditorState) {
            super.setState(MyFileEditorState(null, state.firstState, state.secondState, state.isVerticalSplit))
        } else {
            super.setState(state)
        }
    }

    override fun setLayout(layout: Layout) {
        val current = getLayout() ?: Layout.SHOW_EDITOR
        // The global "Editor and Preview" action can still ask for the split mode.
        val target = if (layout == Layout.SHOW_EDITOR_AND_PREVIEW) current else layout
        if (target == current || target == Layout.SHOW_PREVIEW && isEditModeBlocked) return
        val generation = ++switchGeneration
        if (target == Layout.SHOW_PREVIEW) {
            web.markToggle()
            web.sourcePlace = sourcePlace()
            setPlainHighlighter(true)
            super.setLayout(target)
            focusLater()
            return
        }
        // Edit → Source: the page flushes its edits (and sends its viewport) first; DocumentSync times out after 500 ms.
        web.flush { viewport ->
            if (!disposed && generation == switchGeneration) {
                applyLayout(target)
                viewport?.let(::showInSource)
            }
        }
    }

    /** Start offset of the first visible line and the selection of the text editor (Source → Edit, protocol 2.4). */
    private fun sourcePlace(): WebEditor.Place {
        val editor = textEditor.editor
        val document = editor.document
        val line = editor.xyToLogicalPosition(Point(0, editor.scrollingModel.verticalScrollOffset)).line
        val top = if (document.lineCount == 0) 0 else document.getLineStartOffset(line.coerceIn(0, document.lineCount - 1))
        val caret = editor.caretModel.primaryCaret
        return WebEditor.Place(top, caret.leadSelectionOffset, caret.offset)
    }

    /** Edit → Source (protocol 2.4): the page's selection, and the line of its first visible line at the top (values clamped). */
    private fun showInSource(place: WebEditor.Place) {
        val editor = textEditor.editor
        val length = editor.document.textLength
        val anchor = place.anchor.coerceIn(0, length)
        val head = place.head.coerceIn(0, length)
        editor.caretModel.removeSecondaryCarets()
        val caret = editor.caretModel.primaryCaret
        caret.moveToOffset(head)
        if (anchor == head) caret.removeSelection() else caret.setSelection(minOf(anchor, head), maxOf(anchor, head))
        val line = editor.document.getLineNumber(place.top.coerceIn(0, length))
        val scrolling = editor.scrollingModel
        scrolling.disableAnimation()
        scrolling.scrollVertically(editor.logicalPositionToXY(LogicalPosition(line, 0)).y)
        scrolling.enableAnimation()
    }

    override fun onLayoutChange(oldValue: Layout?, newValue: Layout?) {
        super.onLayoutChange(oldValue, newValue)
        updateBanner()
    }

    private fun updateBanner() {
        if (!web.project.isDisposed) EditorNotifications.getInstance(web.project).updateNotifications(web.file)
    }

    private fun applyLayout(layout: Layout) {
        if (layout == Layout.SHOW_EDITOR) setPlainHighlighter(false)
        super.setLayout(layout)
        focusLater()
    }

    /**
     * [plain] = true: a document above [PLAIN_HIGHLIGHTER_ABOVE] chars gets a plain-text highlighter in the
     * hidden Source editor. The Markdown highlighter lexes the whole document again on each change (full
     * Markdown parse in `MarkdownToplevelLexer.start`), ~40 ms per MB on the EDT for each page patch.
     * [plain] = false: the file's highlighter again (one full lex).
     */
    private fun setPlainHighlighter(plain: Boolean) {
        if (plain == (plainHighlighter != null)) return
        val editor = textEditor.editor as? EditorEx ?: return
        if (!plain) {
            plainHighlighter = null
            editor.highlighter = EditorHighlighterFactory.getInstance().createEditorHighlighter(web.file, editor.colorsScheme, web.project)
        } else if (editor.document.textLength > PLAIN_HIGHLIGHTER_ABOVE) {
            installPlainHighlighter(editor)
        }
    }

    private fun installPlainHighlighter(editor: EditorEx) {
        val highlighter = EditorHighlighterFactory.getInstance().createEditorHighlighter(PlainSyntaxHighlighter(), editor.colorsScheme)
        plainHighlighter = highlighter
        editor.highlighter = highlighter
    }

    /**
     * Focuses the view of the current mode (text editor or browser) on a later EDT event: a request made
     * while the layout changes does not take, and the hidden browser left no focus owner.
     * A target that is not on screen yet in a shown window gets the focus when it is: the platform text
     * editor shows its inner panel only on its own COMPONENT_SHOWN event, after this one, and AWT drops a
     * request for a component that is not showing (L5 t23).
     */
    private fun focusLater() {
        val generation = switchGeneration
        ApplicationManager.getApplication().invokeLater({
            if (disposed || generation != switchGeneration) return@invokeLater
            val target = (if (getLayout() == Layout.SHOW_PREVIEW) web.preferredFocusedComponent else textEditor.editor.contentComponent)
                ?: return@invokeLater
            if (target.isShowing || SwingUtilities.getWindowAncestor(target)?.isShowing != true) {
                requestFocus(target)
                return@invokeLater
            }
            target.addHierarchyListener(object : HierarchyListener {
                override fun hierarchyChanged(e: HierarchyEvent) {
                    if (e.changeFlags and HierarchyEvent.SHOWING_CHANGED.toLong() == 0L || !target.isShowing) return
                    target.removeHierarchyListener(this)
                    if (!disposed && generation == switchGeneration) requestFocus(target)
                }
            })
        }, ModalityState.nonModal())
    }

    override fun dispose() {
        disposed = true
        web.document.removePropertyChangeListener(writableListener)
        super.dispose()
    }

    override fun createViewActionGroup(): ActionGroup = DefaultActionGroup(
        ModeAction(Layout.SHOW_EDITOR, "Source", "Show the Markdown source", AllIcons.General.LayoutEditorOnly),
        ModeAction(Layout.SHOW_PREVIEW, "Edit", "Show the formatted editor", AllIcons.General.LayoutPreviewOnly),
    )

    companion object {
        /** As the page's windowed parse (`minLength`). */
        const val PLAIN_HIGHLIGHTER_ABOVE = 2_000_000
    }

    private inner class ModeAction(
        private val mode: Layout,
        text: String,
        description: String,
        icon: Icon,
    ) : ToggleAction(text, description, icon), DumbAware {
        override fun getActionUpdateThread() = ActionUpdateThread.EDT

        override fun isSelected(e: AnActionEvent): Boolean = getLayout() == mode

        override fun update(e: AnActionEvent) {
            super.update(e)
            if (mode == Layout.SHOW_PREVIEW && getLayout() != mode && isEditModeBlocked) e.presentation.isEnabled = false
        }

        override fun setSelected(e: AnActionEvent, state: Boolean) {
            if (state) setLayout(mode)
        }
    }
}
