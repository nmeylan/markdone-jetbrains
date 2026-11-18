package ch.nmeylan.markdone.settings

import com.intellij.openapi.options.BoundConfigurable
import com.intellij.openapi.options.ConfigurationException
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogPanel
import com.intellij.ui.SimpleListCellRenderer
import com.intellij.ui.dsl.builder.Align
import com.intellij.ui.dsl.builder.AlignX
import com.intellij.ui.dsl.builder.bindIntValue
import com.intellij.ui.dsl.builder.bindItem
import com.intellij.ui.dsl.builder.bindSelected
import com.intellij.ui.dsl.builder.bindText
import com.intellij.ui.dsl.builder.panel
import com.intellij.ui.dsl.builder.rows
import ch.nmeylan.markdone.css.UserCssService

/**
 * Settings → Tools → Markdone. Application settings ([MdSettings]) and the
 * project CSS path of [project] ([MdProjectSettings]). Apply publishes [MdSettings.TOPIC]: no restart.
 */
class MdConfigurable(private val project: Project) : BoundConfigurable(DISPLAY_NAME) {

    private var dialogPanel: DialogPanel? = null

    /** BoundConfigurable does not run the `validationOnApply` checks itself: an error keeps the old settings. */
    override fun apply() {
        dialogPanel?.validateAll()?.firstOrNull()?.let { throw ConfigurationException(it.message) }
        super.apply()
    }

    override fun createPanel(): DialogPanel {
        val settings = MdSettings.getInstance()
        val projectSettings = MdProjectSettings.getInstance(project)
        return panel {
            group("Custom CSS") {
                row {
                    label("Global CSS:")
                }
                row {
                    val css = textArea().rows(12).align(Align.FILL)
                        .bindText(settings::globalCss)
                        .validationOnApply {
                            if (it.text.toByteArray().size > UserCssService.MAX_BYTES) error("Larger than ${UserCssService.MAX_BYTES / 1024} KB") else null
                        }
                    button("Reset") { css.component.text = "" }
                }.resizableRow()
                row("Project CSS file:") {
                    val path = textField().align(AlignX.FILL)
                        .bindText(projectSettings::projectCssPath)
                        .comment("Relative to the project directory. Used only in trusted projects.")
                        .validationOnApply {
                            if (UserCssService.insideRelativePath(it.text) == null) error("Must be a relative path inside the project directory") else null
                        }
                    button("Reset") { path.component.text = MdProjectSettings.DEFAULT_CSS_PATH }
                }
            }
            group("Edit Mode") {
                row("Style:") {
                    comboBox(MdStyle.entries, SimpleListCellRenderer.create("") { it.label })
                        .bindItem({ settings.style }, { settings.style = it ?: MdStyle.DEFAULT })
                }
                row("Color theme:") {
                    comboBox(MdColorTheme.entries, SimpleListCellRenderer.create("") { it.label })
                        .bindItem({ settings.colorTheme }, { settings.colorTheme = it ?: MdColorTheme.IDE })
                        .comment("Tokyo Night themes: https://github.com/tcmmichaelb139/obsidian-tokyonight")
                }
                row("Zoom (%):") {
                    // Integer percent: a double spinner gives values like 1.1000000000000003 (never equal to the setting).
                    spinner(MdSettings.MIN_ZOOM_PERCENT..MdSettings.MAX_ZOOM_PERCENT, MdSettings.ZOOM_STEP_PERCENT)
                        .bindIntValue(settings::zoomPercent)
                }
                row {
                    checkBox("Math").bindSelected(settings::math)
                }
                row {
                    checkBox("Mermaid diagrams").bindSelected(settings::mermaid)
                }
                row {
                    checkBox("Code highlighting").bindSelected(settings::highlight)
                }
                row {
                    checkBox("Soft line breaks").bindSelected(settings::softBreaks)
                        .comment("Shows a single line feed in a paragraph as a line break. Off: as a space.")
                }
                row {
                    checkBox("Open files in Edit mode").bindSelected(settings::openInEditMode)
                        .comment("Opens a Markdown file in Edit mode instead of Source. A file above the large-file limit opens in Source.")
                }
                row {
                    checkBox("Edit on double-click").bindSelected(settings::doubleClickEdit)
                        .comment("The page is editable only after a double-click. Escape or leaving the page ends the edit.")
                }
                row {
                    checkBox("Vim key bindings").bindSelected(settings::vim)
                        .comment("CodeMirror's Vim emulation, not IdeaVim. It takes the key mappings of your .ideavimrc.")
                }
                val vimrc = VimRc.load()
                row {
                    label(
                        if (vimrc.source == null) "No .ideavimrc found."
                        else "${vimrc.source}: ${vimrc.mappings.size} mappings used, ${vimrc.skipped.size} lines skipped."
                    )
                }
                if (vimrc.skipped.isNotEmpty()) {
                    row {
                        textArea().rows(4).align(Align.FILL).applyToComponent {
                            isEditable = false
                            text = vimrc.skipped.joinToString("\n")
                        }
                    }
                }
                row {
                    checkBox("Remote images").bindSelected(settings::remoteImages)
                        .comment("Loads http(s) images from the network.")
                }
                row("Large-file limit (MB):") {
                    spinner(1..MdSettings.MAX_LARGE_FILE_MB).bindIntValue(settings::largeFileLimitMb)
                        .comment("Larger files open in Source mode only.")
                }
            }
        }.also { dialogPanel = it }
    }

    companion object {
        const val DISPLAY_NAME = "Markdone"
    }
}
