package ch.nmeylan.markdone.actions

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataKey
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.editor.Document
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.TextRange
import com.intellij.openapi.util.text.StringUtil
import ch.nmeylan.markdone.sync.DocumentSync
import java.awt.datatransfer.DataFlavor
import java.awt.datatransfer.StringSelection

/**
 * The page's main selection (`Document` offsets) when the Edit-mode context menu opened. A range marker
 * keeps [from]..[to] right when the document changes while the menu is open.
 */
class PageSelection(val project: Project?, val document: Document, val sync: DocumentSync, from: Int, to: Int) {
    private val marker = document.createRangeMarker(from, to)

    /** `false` when a document change removed the range. */
    val isValid: Boolean
        get() = marker.isValid

    val from: Int
        get() = marker.startOffset

    val to: Int
        get() = marker.endOffset

    companion object {
        val KEY: DataKey<PageSelection> = DataKey.create("markdone.pageSelection")
    }
}

/**
 * Clipboard and selection operations of the Edit-mode context menu. They work on the
 * exact `Document` range (Markdown source). Edits are `Document` edits; they reach the page as `change`.
 */
object PageClipboard {
    fun copy(s: PageSelection) {
        if (!s.isValid || s.from >= s.to) return
        CopyPasteManager.getInstance().setContents(StringSelection(s.document.getText(TextRange(s.from, s.to))))
    }

    fun cut(s: PageSelection) {
        if (!s.isValid || s.from >= s.to || !s.document.isWritable) return
        copy(s)
        val from = s.from
        val to = s.to
        write(s, "Cut") { s.document.deleteString(from, to) }
        s.sync.sendChanges(DocumentSync.Selection(from, from))
    }

    fun paste(s: PageSelection) {
        if (!s.isValid || !s.document.isWritable) return
        val text = CopyPasteManager.getInstance().getContents<String>(DataFlavor.stringFlavor) ?: return
        val normalized = StringUtil.convertLineSeparators(text)
        val from = s.from
        val to = s.to
        write(s, "Paste") { s.document.replaceString(from, to, normalized) }
        val caret = from + normalized.length
        s.sync.sendChanges(DocumentSync.Selection(caret, caret))
    }

    /** Selects the whole document in the page: a `change` with no changes and a selection. */
    fun selectAll(s: PageSelection) = s.sync.sendChanges(DocumentSync.Selection(0, s.document.textLength))

    private fun write(s: PageSelection, name: String, edit: () -> Unit) {
        WriteCommandAction.writeCommandAction(s.project).withName(name).shouldRecordActionForActiveDocument(false).run<RuntimeException>(edit)
    }
}

/** An action that works on the [PageSelection] of the context menu; hidden elsewhere. */
abstract class PageAction : AnAction(), DumbAware {
    override fun getActionUpdateThread() = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        val s = e.getData(PageSelection.KEY)
        e.presentation.isVisible = s != null
        e.presentation.isEnabled = s != null && s.isValid && isEnabled(s)
    }

    override fun actionPerformed(e: AnActionEvent) {
        e.getData(PageSelection.KEY)?.let(::perform)
    }

    protected abstract fun isEnabled(s: PageSelection): Boolean

    protected abstract fun perform(s: PageSelection)
}

class PageCutAction : PageAction() {
    override fun isEnabled(s: PageSelection) = s.from < s.to && s.document.isWritable
    override fun perform(s: PageSelection) = PageClipboard.cut(s)
}

class PageCopyAction : PageAction() {
    override fun isEnabled(s: PageSelection) = s.from < s.to
    override fun perform(s: PageSelection) = PageClipboard.copy(s)
}

class PagePasteAction : PageAction() {
    override fun isEnabled(s: PageSelection) = s.document.isWritable
    override fun perform(s: PageSelection) = PageClipboard.paste(s)
}

class PageSelectAllAction : PageAction() {
    override fun isEnabled(s: PageSelection) = true
    override fun perform(s: PageSelection) = PageClipboard.selectAll(s)
}
