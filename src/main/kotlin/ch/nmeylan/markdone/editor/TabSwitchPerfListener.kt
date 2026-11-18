package ch.nmeylan.markdone.editor

import com.intellij.openapi.fileEditor.FileEditorManagerEvent
import com.intellij.openapi.fileEditor.FileEditorManagerListener
import com.intellij.openapi.fileEditor.TextEditorWithPreview.Layout

/**
 * Starts the `tabSwitchMs` clock: a Markdown tab in Edit mode is selected. The clock stops
 * when the page reports `activated` for its document ([ch.nmeylan.markdone.jcef.SharedBrowserService]).
 */
class TabSwitchPerfListener : FileEditorManagerListener {
    override fun selectionChanged(event: FileEditorManagerEvent) {
        val editor = event.newEditor as? MdEditor ?: return
        if (editor.getLayout() != Layout.SHOW_PREVIEW) return
        (editor.previewEditor as? WebEditor)?.tabSwitchStartNanos = System.nanoTime()
    }
}
