package ch.nmeylan.markdone.actions

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.PlatformCoreDataKeys
import com.intellij.openapi.fileEditor.TextEditorWithPreview
import com.intellij.openapi.project.DumbAware
import ch.nmeylan.markdone.editor.MdEditor

/** Switches the focused Markdown tab between Source and Edit mode. */
class ToggleModeAction : AnAction(), DumbAware {
    override fun getActionUpdateThread() = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        val editor = editor(e)
        e.presentation.isVisible = editor != null
        // A file above the large-file limit stays in Source mode.
        e.presentation.isEnabled = editor != null && (editor.getLayout() == TextEditorWithPreview.Layout.SHOW_PREVIEW || !editor.isEditModeBlocked)
    }

    override fun actionPerformed(e: AnActionEvent) {
        editor(e)?.toggleMode()
    }

    private fun editor(e: AnActionEvent): MdEditor? = e.getData(PlatformCoreDataKeys.FILE_EDITOR) as? MdEditor
}
