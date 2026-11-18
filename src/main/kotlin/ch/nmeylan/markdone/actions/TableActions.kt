package ch.nmeylan.markdone.actions

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataKey
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.editor.Document
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import ch.nmeylan.markdone.actions.TableEdit.Action
import ch.nmeylan.markdone.sync.TableCell

/** Applies [TableEdit] actions to a `Document`. Runs on the EDT. */
object TableActions {
    private val LOG = logger<TableActions>()

    /**
     * Runs [action] on [cell] as one write command (one undo step); the `DocumentEvent`s reach the page
     * as `change`. Returns `false` and logs when the range is not a table in the current text, the cell is
     * outside it, the action is refused, or the document is read-only.
     */
    fun perform(project: Project?, document: Document, cell: TableCell, action: Action): Boolean {
        if (!document.isWritable) return false
        val edits = TableEdit.edits(document.immutableCharSequence, cell.from, cell.to, action, cell.row, cell.column)
        if (edits == null) {
            LOG.info("Table action '${action.id}' ignored: no table at ${cell.from}..${cell.to}, or cell ${cell.row}/${cell.column} refused")
            return false
        }
        if (edits.isEmpty()) return true
        WriteCommandAction.writeCommandAction(project).withName("Table: ${action.id}").shouldRecordActionForActiveDocument(false)
            .run<RuntimeException> {
                for (e in edits.sortedByDescending { it.from }) document.replaceString(e.from, e.to, e.text)
            }
        return true
    }
}

/** The table cell under the Edit-mode context menu. A range marker keeps the table range right while the menu is open. */
class PageTable(val project: Project?, val document: Document, from: Int, to: Int, val row: Int, val column: Int) {
    private val marker = document.createRangeMarker(from, to)

    /** The cell in the current text, or `null` when a document change removed the range. */
    val cell: TableCell?
        get() = if (marker.isValid && marker.startOffset < marker.endOffset) TableCell(marker.startOffset, marker.endOffset, row, column) else null

    private var parsedStamp = -1L
    private var parsed: TableEdit.Table? = null

    /**
     * The parsed table of [cell] in the current text, or `null` when it is not a table. Parsed once per
     * document version: the submenu updates its actions on every update tick.
     */
    val table: TableEdit.Table?
        get() {
            val stamp = document.modificationStamp
            if (stamp != parsedStamp) {
                parsed = cell?.let { TableEdit.parse(document.immutableCharSequence, it.from, it.to) }
                parsedStamp = stamp
            }
            return parsed
        }

    companion object {
        val KEY: DataKey<PageTable> = DataKey.create("markdone.pageTable")
    }
}

/** The "Table" submenu (`markdone.EditContextMenu.Table`): shown only when the menu opened in a table. */
class PageTableGroup : DefaultActionGroup(), DumbAware {
    override fun getActionUpdateThread() = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        e.presentation.isVisible = e.getData(PageTable.KEY) != null
    }
}

/** One table action on the [PageTable] of the context menu; disabled when [TableEdit] refuses it. */
abstract class PageTableAction(private val action: Action) : AnAction(), DumbAware {
    override fun getActionUpdateThread() = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        val pageTable = e.getData(PageTable.KEY)
        e.presentation.isVisible = pageTable != null
        val table = pageTable?.table
        e.presentation.isEnabled = table != null && pageTable.document.isWritable &&
            TableEdit.isAllowed(table, action, pageTable.row, pageTable.column)
    }

    override fun actionPerformed(e: AnActionEvent) {
        val table = e.getData(PageTable.KEY) ?: return
        val cell = table.cell ?: return
        TableActions.perform(table.project, table.document, cell, action)
    }
}

class TableInsertRowAboveAction : PageTableAction(Action.INSERT_ROW_ABOVE)
class TableInsertRowBelowAction : PageTableAction(Action.INSERT_ROW_BELOW)
class TableInsertColumnLeftAction : PageTableAction(Action.INSERT_COLUMN_LEFT)
class TableInsertColumnRightAction : PageTableAction(Action.INSERT_COLUMN_RIGHT)
class TableRemoveRowAction : PageTableAction(Action.REMOVE_ROW)
class TableRemoveColumnAction : PageTableAction(Action.REMOVE_COLUMN)
class TableAlignLeftAction : PageTableAction(Action.ALIGN_LEFT)
class TableAlignCenterAction : PageTableAction(Action.ALIGN_CENTER)
class TableAlignRightAction : PageTableAction(Action.ALIGN_RIGHT)
class TableAlignNoneAction : PageTableAction(Action.ALIGN_NONE)
class TableReformatAction : PageTableAction(Action.REFORMAT)
