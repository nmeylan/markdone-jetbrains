package ch.nmeylan.markdone.editor

import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.ex.FileEditorProviderManager
import com.intellij.openapi.fileEditor.impl.EditorTabColorProvider
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.FileColorManager
import java.awt.Color

/**
 * The file color "Gray" (Settings → Appearance → File Colors) on the editor tab of a Markdown file of
 * [MdFileEditorProvider] when the file or its document is not writable (both modes), and only when the File Colors
 * option "Use in editor tabs" is on. Registered last:
 * a color of the File Colors scopes comes first. [MdEditor] asks for a new color when the writability changes.
 */
class ReadOnlyTabColorProvider : EditorTabColorProvider, DumbAware {

    override fun getEditorTabColor(project: Project, file: VirtualFile): Color? {
        val colors = FileColorManager.getInstance(project)
        if (!colors.isEnabledForTabs || !isReadOnly(file) || provider?.accept(project, file) != true) return null
        return colors.getColor(COLOR)
    }

    private fun isReadOnly(file: VirtualFile): Boolean =
        !file.isWritable || FileDocumentManager.getInstance().getCachedDocument(file)?.isWritable == false

    private val provider by lazy { FileEditorProviderManager.getInstance().getProvider(MdFileEditorProvider.EDITOR_TYPE_ID) }

    companion object {
        const val COLOR = "Gray"
    }
}
