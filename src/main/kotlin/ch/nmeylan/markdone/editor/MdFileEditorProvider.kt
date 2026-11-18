package ch.nmeylan.markdone.editor

import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.openapi.fileEditor.FileEditorProvider
import com.intellij.openapi.fileEditor.TextEditor
import com.intellij.openapi.fileEditor.TextEditorWithPreview
import com.intellij.openapi.fileEditor.impl.text.TextEditorProvider
import ch.nmeylan.markdone.settings.MdSettings
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile

/**
 * Opens Markdown files in [MdEditor]. `HIDE_OTHER_EDITORS` also hides the bundled Markdown editor,
 * which uses `HIDE_DEFAULT_EDITOR`.
 */
class MdFileEditorProvider : FileEditorProvider, DumbAware {

    override fun accept(project: Project, file: VirtualFile): Boolean {
        if (file.isDirectory) return false
        // The file type name check avoids a dependency on the Markdown plugin.
        return file.extension?.lowercase() in EXTENSIONS || file.fileType.name == "Markdown"
    }

    override fun createEditor(project: Project, file: VirtualFile): FileEditor {
        val textEditor = TextEditorProvider.getInstance().createEditor(project, file) as TextEditor
        // Without a document (binary or too large) there is nothing to edit: Source only.
        val document = FileDocumentManager.getInstance().getDocument(file) ?: return textEditor
        val editor = MdEditor(textEditor, WebEditor(project, file, document))
        if (MdSettings.getInstance().openInEditMode) editor.setLayout(TextEditorWithPreview.Layout.SHOW_PREVIEW)
        return editor
    }

    override fun getEditorTypeId(): String = EDITOR_TYPE_ID

    override fun getPolicy(): FileEditorPolicy = FileEditorPolicy.HIDE_OTHER_EDITORS

    companion object {
        const val EDITOR_TYPE_ID = "markdone-editor"
        private val EXTENSIONS = setOf("md", "markdown")
    }
}
