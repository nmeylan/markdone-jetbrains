package ch.nmeylan.markdone.e2e

import com.intellij.driver.client.ProjectRef
import com.intellij.driver.client.Remote

/*
 * Driver proxies of IDE classes (calls go over JMX to the sandbox IDE). Only the members the
 * L5 tests use.
 */

@Remote("com.intellij.openapi.project.ProjectManager")
interface ProjectManager {
    fun getOpenProjects(): Array<Project>
}

@Remote("com.intellij.openapi.project.Project")
interface Project : ProjectRef {
    fun getName(): String
    fun isInitialized(): Boolean
}

@Remote("com.intellij.openapi.project.DumbService")
interface DumbService {
    fun isDumb(): Boolean
}

@Remote("com.intellij.openapi.vfs.LocalFileSystem")
interface LocalFileSystemStatics {
    fun getInstance(): LocalFileSystem
}

@Remote("com.intellij.openapi.vfs.LocalFileSystem")
interface LocalFileSystem {
    fun refreshAndFindFileByPath(path: String): VirtualFile?
}

@Remote("com.intellij.openapi.vfs.VirtualFile")
interface VirtualFile {
    fun getName(): String
    fun isWritable(): Boolean
    /** Synchronous refresh (`asynchronous = false`) sends the VFS events of an external change. Not on the EDT. */
    fun refresh(asynchronous: Boolean, recursive: Boolean)
}

@Remote("com.intellij.openapi.fileEditor.FileEditorManager")
interface FileEditorManager {
    fun openFile(file: VirtualFile, focusEditor: Boolean): Array<FileEditor>
    fun getAllEditors(file: VirtualFile): Array<FileEditor>
    fun getSelectedEditor(file: VirtualFile): FileEditor?
    fun closeFile(file: VirtualFile)
    fun getOpenFiles(): Array<VirtualFile>
}

@Remote("com.intellij.openapi.fileEditor.FileEditor")
interface FileEditor {
    fun getName(): String
    fun getComponent(): Component
    fun getPreferredFocusedComponent(): Component?
}

@Remote("ch.nmeylan.markdone.editor.MdEditor", plugin = "ch.nmeylan.markdone")
interface MdEditor {
    fun getComponent(): Component
    fun getLayout(): Layout?
    fun toggleMode()
    fun getTextEditor(): FileEditor
    fun getPreviewEditor(): FileEditor
}

/** Edit view of the tab. `markToggle()` starts the clock of the plugin's `toggleToActivatedMs` line. */
@Remote("ch.nmeylan.markdone.editor.WebEditor", plugin = "ch.nmeylan.markdone")
interface WebEditor {
    fun markToggle()
}

@Remote("com.intellij.openapi.fileEditor.TextEditorWithPreview\$Layout")
interface Layout {
    fun name(): String
}

@Remote("java.awt.Component")
interface Component {
    fun isShowing(): Boolean
    fun requestFocusInWindow(): Boolean
    /** java.awt.Point is Serializable: the Driver returns it by value. */
    fun getLocationOnScreen(): java.awt.Point
    fun getWidth(): Int
    fun getHeight(): Int
    fun isFocusOwner(): Boolean
    /** The parent is a `java.awt.Container`; cast it to [Container] for its children. */
    fun getParent(): Component?
    override fun toString(): String
}

@Remote("java.awt.Container")
interface Container {
    fun getComponents(): Array<Component>
}

@Remote("com.intellij.openapi.fileEditor.TextEditor")
interface TextEditor {
    fun getEditor(): Editor
}

@Remote("com.intellij.openapi.editor.Editor")
interface Editor {
    fun getCaretModel(): CaretModel
    fun getContentComponent(): Component
    // Mode switch sync, wheel step.
    fun getScrollingModel(): ScrollingModel
    fun getSelectionModel(): SelectionModel
    fun getLineHeight(): Int
    fun getDocument(): Document
}

/** Visual lines (soft wraps on for Markdown): first visible line and scroll targets. */
@Remote("com.intellij.openapi.editor.impl.EditorImpl")
interface EditorImpl {
    fun yToVisualLine(y: Int): Int
    fun visualLineToY(line: Int): Int
    fun offsetToVisualLine(offset: Int, beforeSoftWrap: Boolean): Int
    fun visualLineStartOffset(line: Int): Int
}

@Remote("com.intellij.openapi.editor.ScrollingModel")
interface ScrollingModel {
    fun getVerticalScrollOffset(): Int
    fun scrollVertically(scrollOffset: Int)
    fun disableAnimation()
    fun enableAnimation()
}

@Remote("com.intellij.openapi.editor.SelectionModel")
interface SelectionModel {
    fun getSelectionStart(): Int
    fun getSelectionEnd(): Int
    fun getLeadSelectionOffset(): Int
    fun setSelection(startOffset: Int, endOffset: Int)
}

@Remote("com.intellij.openapi.editor.CaretModel")
interface CaretModel {
    fun getOffset(): Int
    fun moveToOffset(offset: Int)
}

/** Application settings of the plugin (global CSS, remote images). Use on the EDT. */
@Remote("ch.nmeylan.markdone.settings.MdSettings", plugin = "ch.nmeylan.markdone")
interface MdSettings {
    fun getGlobalCss(): String
    fun setGlobalCss(value: String)
    fun getRemoteImages(): Boolean
    fun setRemoteImages(value: Boolean)
    fun getZoom(): Double
    fun zoomReset()
    fun getLargeFileLimitMb(): Int
    fun setLargeFileLimitMb(value: Int)
}

/** Settings page (Settings → Tools → Markdown Edit). Use on the EDT. */
@Remote("ch.nmeylan.markdone.settings.MdConfigurable", plugin = "ch.nmeylan.markdone")
interface MdConfigurable {
    fun getDisplayName(): String
    fun createComponent(): Component?
    fun reset()
    fun isModified(): Boolean
    fun apply()
    fun disposeUIResources()
}

@Remote("com.intellij.ui.EditorNotificationPanel")
interface EditorNotificationPanel {
    fun getText(): String
}

@Remote("com.intellij.ide.trustedProjects.TrustedProjects")
interface TrustedProjectsStatics {
    fun isProjectTrusted(project: Project): Boolean
    fun setProjectTrusted(project: Project, trusted: Boolean)
}

@Remote("java.lang.System")
interface SystemStatics {
    fun setProperty(key: String, value: String): String?
    fun nanoTime(): Long
    fun getProperty(key: String): String?
}

@Remote("java.awt.KeyboardFocusManager")
interface KeyboardFocusManagerStatics {
    fun getCurrentKeyboardFocusManager(): KeyboardFocusManager
}

@Remote("java.awt.KeyboardFocusManager")
interface KeyboardFocusManager {
    fun getFocusOwner(): Component?
}

@Remote("java.lang.Thread")
interface ThreadStatics {
    fun sleep(millis: Long)
}

@Remote("java.awt.Robot")
interface Robot {
    fun keyPress(keyCode: Int)
    fun keyRelease(keyCode: Int)
    fun mouseMove(x: Int, y: Int)
    fun mousePress(buttons: Int)
    fun mouseRelease(buttons: Int)
    fun mouseWheel(wheelAmt: Int)
    fun waitForIdle()
}

@Remote("com.intellij.openapi.wm.WindowManager")
interface WindowManager {
    fun getFrame(project: Project): Window?
}

@Remote("java.awt.Window")
interface Window {
    fun toFront()
    fun isShowing(): Boolean
    fun isFocused(): Boolean
    fun setBounds(x: Int, y: Int, width: Int, height: Int)
}

@Remote("java.awt.Window")
interface WindowStatics {
    fun getWindows(): Array<Window>
}

@Remote("com.intellij.openapi.fileEditor.FileDocumentManager")
interface FileDocumentManagerStatics {
    fun getInstance(): FileDocumentManager
}

@Remote("com.intellij.openapi.fileEditor.FileDocumentManager")
interface FileDocumentManager {
    fun getDocument(file: VirtualFile): Document?
}

@Remote("com.intellij.openapi.editor.Document")
interface Document {
    fun getLineNumber(offset: Int): Int
    fun getLineStartOffset(line: Int): Int
    fun getLineCount(): Int
    fun getText(): String
    fun getTextLength(): Int
    fun getModificationStamp(): Long
    fun setReadOnly(isReadOnly: Boolean)
    fun insertString(offset: Int, s: CharSequence)
    fun deleteString(start: Int, end: Int)
}

@Remote("com.intellij.openapi.command.CommandProcessor")
interface CommandProcessorStatics {
    fun getInstance(): CommandProcessorEx
}

/** `startCommand`/`finishCommand`: a command without a Runnable (the Driver cannot send one). */
@Remote("com.intellij.openapi.command.CommandProcessorEx")
interface CommandProcessorEx {
    fun startCommand(project: Project, name: String, groupId: Any?, policy: UndoConfirmationPolicy): CommandToken?
    fun finishCommand(token: CommandToken, throwable: Throwable?)
}

@Remote("com.intellij.openapi.command.CommandToken")
interface CommandToken

@Remote("com.intellij.openapi.command.UndoConfirmationPolicy")
interface UndoConfirmationPolicyStatics {
    fun valueOf(name: String): UndoConfirmationPolicy
}

@Remote("com.intellij.openapi.command.UndoConfirmationPolicy")
interface UndoConfirmationPolicy

@Remote("com.intellij.openapi.ide.CopyPasteManager")
interface CopyPasteManagerStatics {
    fun getInstance(): CopyPasteManager
}

@Remote("com.intellij.openapi.ide.CopyPasteManager")
interface CopyPasteManager {
    fun getContents(flavor: DataFlavor): Any?
    fun setContents(content: StringSelection)
}

@Remote("java.awt.datatransfer.DataFlavor")
interface DataFlavor

@Remote("java.awt.datatransfer.StringSelection")
interface StringSelection

@Remote("javax.swing.MenuSelectionManager")
interface MenuSelectionManagerStatics {
    fun defaultManager(): MenuSelectionManager
}

@Remote("javax.swing.MenuSelectionManager")
interface MenuSelectionManager {
    fun getSelectedPath(): Array<MenuElement>
    fun clearSelectedPath()
}

@Remote("javax.swing.MenuElement")
interface MenuElement {
    fun getSubElements(): Array<MenuElement>
    fun getComponent(): Component
}

@Remote("javax.swing.JMenuItem")
interface JMenuItem {
    fun getText(): String?
    fun isEnabled(): Boolean
}

@Remote("com.intellij.openapi.keymap.KeymapManager")
interface KeymapManager {
    fun getActiveKeymap(): Keymap
}

@Remote("com.intellij.openapi.keymap.Keymap")
interface Keymap {
    fun getName(): String
    fun getActionIds(keyStroke: KeyStroke): Array<String>
}

@Remote("javax.swing.KeyStroke")
interface KeyStrokeStatics {
    fun getKeyStroke(s: String): KeyStroke
}

@Remote("javax.swing.KeyStroke")
interface KeyStroke

@Remote("com.intellij.diagnostic.StartUpPerformanceService")
interface StartUpPerformanceService {
    fun getPluginCostMap(): RemoteMap
}

@Remote("java.util.Map")
interface RemoteMap {
    fun get(key: String): RemoteObject?
    fun size(): Int
    override fun toString(): String
}

@Remote("java.lang.Object")
interface RemoteObject {
    override fun toString(): String
}

@Remote("com.intellij.openapi.command.undo.UndoManager")
interface UndoManager {
    fun isUndoAvailable(editor: FileEditor?): Boolean
    fun getUndoActionNameAndDescription(editor: FileEditor?): RemoteObject
    fun getRedoActionNameAndDescription(editor: FileEditor?): RemoteObject
}

@Remote("com.intellij.openapi.wm.IdeFocusManager")
interface IdeFocusManagerStatics {
    fun getInstance(project: Project?): IdeFocusManager
}

@Remote("com.intellij.openapi.wm.IdeFocusManager")
interface IdeFocusManager {
    fun requestFocusInProject(c: Component, project: Project?): RemoteObject?
    fun getFocusOwner(): Component?
}

@Remote("com.intellij.openapi.util.registry.Registry")
interface RegistryStatics {
    fun intValue(key: String): Int
}

/** Tabs of the current editor window (read-only tab color). */
@Remote("com.intellij.openapi.fileEditor.ex.FileEditorManagerEx")
interface FileEditorManagerExStatics {
    fun getInstanceEx(project: Project): FileEditorManagerEx
}

@Remote("com.intellij.openapi.fileEditor.ex.FileEditorManagerEx")
interface FileEditorManagerEx {
    fun getCurrentWindow(): EditorWindow?
}

@Remote("com.intellij.openapi.fileEditor.impl.EditorWindow")
interface EditorWindow {
    fun getTabbedPane(): EditorTabbedContainer
}

@Remote("com.intellij.openapi.fileEditor.impl.EditorTabbedContainer")
interface EditorTabbedContainer {
    fun getTabs(): JBTabs
}

@Remote("com.intellij.ui.tabs.JBTabs")
interface JBTabs {
    fun getTabCount(): Int
    fun getTabAt(index: Int): TabInfo
}

@Remote("com.intellij.ui.tabs.TabInfo")
interface TabInfo {
    fun getText(): String
    fun getTabColor(): Color?
}

@Remote("java.awt.Color")
interface Color {
    fun getRGB(): Int
}

@Remote("com.intellij.ui.FileColorManager")
interface FileColorManagerStatics {
    fun getInstance(project: Project): FileColorManager
}

@Remote("com.intellij.ui.FileColorManager")
interface FileColorManager {
    fun getColor(name: String): Color?
}
