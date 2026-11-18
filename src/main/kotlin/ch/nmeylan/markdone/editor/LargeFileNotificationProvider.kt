package ch.nmeylan.markdone.editor

import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.TextEditorWithPreview
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.EditorNotificationPanel
import com.intellij.ui.EditorNotificationProvider
import ch.nmeylan.markdone.settings.MdSettings
import java.util.function.Function
import javax.swing.JComponent

/**
 * The banner of a Markdown tab in Source mode whose file is above the large-file limit: Edit mode is off.
 * Not in Edit mode (a tab kept in Edit mode after the limit went down).
 */
class LargeFileNotificationProvider : EditorNotificationProvider, DumbAware {

    override fun collectNotificationData(project: Project, file: VirtualFile): Function<in FileEditor, out JComponent?> =
        Function { editor ->
            if (editor !is MdEditor || editor.getLayout() == TextEditorWithPreview.Layout.SHOW_PREVIEW || !editor.isEditModeBlocked) {
                return@Function null
            }
            EditorNotificationPanel(editor, EditorNotificationPanel.Status.Info).text(text(MdSettings.getInstance().largeFileLimitMb))
        }

    companion object {
        fun text(limitMb: Int) =
            "This file is larger than $limitMb MB. Edit mode is off. Change the limit in Settings → Tools → Markdown Edit."
    }
}
