package ch.nmeylan.markdone.actions

import com.intellij.openapi.actionSystem.ActionPromoter
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.PlatformCoreDataKeys
import com.intellij.openapi.project.DumbAware
import ch.nmeylan.markdone.editor.WebEditor

/**
 * Undo or redo while the Edit view's browser has the focus. The actions use the
 * shortcuts of `$Undo`/`$Redo` (plugin.xml); [PageUndoPromoter] puts them first, so the IDE runs the
 * flush-then-undo path of the page and not `$Undo` directly. The IDE consumes the key, so the page
 * does not get it and does not send its own `command undo`: one undo per key press.
 */
abstract class PageUndoRedoAction(private val redo: Boolean) : AnAction(), DumbAware {
    override fun getActionUpdateThread() = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = target(e.dataContext) != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        target(e.dataContext)?.undoRedo(redo)
    }

    companion object {
        /** The Edit view whose browser is the context component, if any. */
        fun target(context: DataContext): WebEditor? =
            WebEditor.ofBrowserComponent(context.getData(PlatformCoreDataKeys.CONTEXT_COMPONENT))
    }
}

class PageUndoAction : PageUndoRedoAction(redo = false)

class PageRedoAction : PageUndoRedoAction(redo = true)

/** Puts [PageUndoRedoAction]s before the other actions of the same shortcut while the page has the focus. */
class PageUndoPromoter : ActionPromoter {
    override fun promote(actions: List<AnAction>, context: DataContext): List<AnAction> {
        if (PageUndoRedoAction.target(context) == null) return emptyList()
        return actions.filterIsInstance<PageUndoRedoAction>()
    }
}
