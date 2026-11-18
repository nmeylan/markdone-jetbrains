package ch.nmeylan.markdone.actions

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.ToggleAction
import com.intellij.openapi.project.DumbAware
import ch.nmeylan.markdone.settings.MdSettings
import ch.nmeylan.markdone.settings.MdStyle

/** Edit-mode zoom: changes the application setting; every page gets the new `theme`. */
abstract class ZoomAction(private val change: (MdSettings) -> Unit) : AnAction(), DumbAware {
    override fun getActionUpdateThread() = ActionUpdateThread.EDT

    override fun actionPerformed(e: AnActionEvent) = change(MdSettings.getInstance())
}

class ZoomInAction : ZoomAction(MdSettings::zoomIn)

class ZoomOutAction : ZoomAction(MdSettings::zoomOut)

class ZoomResetAction : ZoomAction(MdSettings::zoomReset)

/** One item of the "Style" submenu: selected when it is the current style. */
abstract class StyleAction(private val style: MdStyle) : ToggleAction(), DumbAware {
    override fun getActionUpdateThread() = ActionUpdateThread.EDT

    override fun isSelected(e: AnActionEvent) = MdSettings.getInstance().style == style

    override fun setSelected(e: AnActionEvent, state: Boolean) {
        if (state) MdSettings.getInstance().style = style
    }
}

class StyleDefaultAction : StyleAction(MdStyle.DEFAULT)

class StyleCompactAction : StyleAction(MdStyle.COMPACT)

class StyleSerifAction : StyleAction(MdStyle.SERIF)
