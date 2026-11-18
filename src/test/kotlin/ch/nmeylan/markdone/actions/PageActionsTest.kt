package ch.nmeylan.markdone.actions

import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import ch.nmeylan.markdone.sync.DocVersion
import ch.nmeylan.markdone.sync.DocumentSync
import ch.nmeylan.markdone.sync.FakeScheduler
import ch.nmeylan.markdone.sync.FakeWebView
import ch.nmeylan.markdone.sync.PageMessage
import java.awt.datatransfer.DataFlavor
import java.awt.datatransfer.StringSelection

/** Context-menu clipboard actions on exact `Document` ranges, headless clipboard. */
class PageActionsTest : BasePlatformTestCase() {
    private val docId = "0123456789abcdef0123456789abcdef"
    private val view = FakeWebView()
    private val scheduler = FakeScheduler()

    private fun selection(text: String, from: Int, to: Int): PageSelection {
        val file = myFixture.addFileToProject("doc.md", text).virtualFile
        val document = FileDocumentManager.getInstance().getDocument(file)!!
        val version = DocVersion(document).also { Disposer.register(testRootDisposable, it) }
        val sync = DocumentSync(docId, project, document, version, view, scheduler = scheduler)
        Disposer.register(testRootDisposable, sync)
        sync.open()
        sync.receive(PageMessage.Opened(docId, version.value))
        view.sent.clear()
        return PageSelection(project, document, sync, from, to)
    }

    private fun clipboard(): String? = CopyPasteManager.getInstance().getContents<String>(DataFlavor.stringFlavor)

    fun testCopyTakesTheMarkdownSource() {
        val s = selection("a **bold** b", 2, 10)
        PageClipboard.copy(s)
        assertEquals("**bold**", clipboard())
        assertEquals("a **bold** b", s.document.text)
        assertTrue(view.sent.isEmpty())
    }

    fun testCutRemovesTheRangeAndSendsAChange() {
        val s = selection("a **bold** b", 2, 10)
        PageClipboard.cut(s)
        assertEquals("**bold**", clipboard())
        assertEquals("a  b", s.document.text)
        val change = view.sent.single()
        assertEquals("change", change["type"].asString)
        assertEquals(2, change["changes"].asJsonArray[0].asJsonObject["from"].asInt)
        assertEquals(10, change["changes"].asJsonArray[0].asJsonObject["to"].asInt)
        assertEquals(2, change["selection"].asJsonObject["head"].asInt)
        scheduler.runPosts()
        assertEquals(1, view.sent.size)
    }

    fun testPasteReplacesTheRangeWithNormalizedText() {
        val s = selection("one two", 4, 7)
        CopyPasteManager.getInstance().setContents(StringSelection("x\r\ny"))
        PageClipboard.paste(s)
        assertEquals("one x\ny", s.document.text)
        val change = view.sent.single()
        assertEquals("x\ny", change["changes"].asJsonArray[0].asJsonObject["insert"].asString)
        assertEquals(7, change["selection"].asJsonObject["anchor"].asInt)
    }

    /** The range follows document changes made after the menu opened (for example while the popup is open). */
    fun testRangeFollowsLaterChanges() {
        val s = selection("a **bold** b", 2, 10)
        com.intellij.openapi.command.WriteCommandAction.runWriteCommandAction(project) { s.document.insertString(0, "zz") }
        PageClipboard.cut(s)
        assertEquals("**bold**", clipboard())
        assertEquals("zza  b", s.document.text)
        com.intellij.openapi.command.WriteCommandAction.runWriteCommandAction(project) { s.document.deleteString(0, s.document.textLength) }
        assertTrue(s.document.text.isEmpty())
    }

    fun testSelectAllSendsOnlyASelection() {
        val s = selection("abc", 1, 1)
        PageClipboard.selectAll(s)
        val change = view.sent.single()
        assertEquals("change", change["type"].asString)
        assertEquals(0, change["changes"].asJsonArray.size())
        assertEquals(0, change["selection"].asJsonObject["anchor"].asInt)
        assertEquals(3, change["selection"].asJsonObject["head"].asInt)
    }

    fun testReadOnlyDocumentIsNotChanged() {
        val s = selection("abc", 0, 2)
        s.document.setReadOnly(true)
        CopyPasteManager.getInstance().setContents(StringSelection("zz"))
        PageClipboard.cut(s)
        PageClipboard.paste(s)
        assertEquals("abc", s.document.text)
        assertEquals("zz", clipboard())
    }

    fun testContextMenuGroupIsRegistered() {
        val group = com.intellij.openapi.actionSystem.ActionManager.getInstance()
            .getAction(ch.nmeylan.markdone.jcef.SharedBrowserService.CONTEXT_MENU_GROUP) as com.intellij.openapi.actionSystem.DefaultActionGroup
        val ids = group.childActionsOrStubs.mapNotNull { com.intellij.openapi.actionSystem.ActionManager.getInstance().getId(it) }
        assertEquals(
            listOf(
                "ch.nmeylan.markdone.PageCut", "ch.nmeylan.markdone.PageCopy", "ch.nmeylan.markdone.PagePaste", "ch.nmeylan.markdone.PageSelectAll", "ch.nmeylan.markdone.ToggleMode",
                "ch.nmeylan.markdone.ZoomIn", "ch.nmeylan.markdone.ZoomOut", "ch.nmeylan.markdone.ZoomReset", "markdone.EditContextMenu.Style", "markdone.EditContextMenu.Table",
            ),
            ids,
        )
        val style = com.intellij.openapi.actionSystem.ActionManager.getInstance().getAction("markdone.EditContextMenu.Style") as com.intellij.openapi.actionSystem.DefaultActionGroup
        assertEquals(
            listOf("ch.nmeylan.markdone.StyleDefault", "ch.nmeylan.markdone.StyleCompact", "ch.nmeylan.markdone.StyleSerif"),
            style.childActionsOrStubs.mapNotNull { com.intellij.openapi.actionSystem.ActionManager.getInstance().getId(it) },
        )
        val table = com.intellij.openapi.actionSystem.ActionManager.getInstance().getAction("markdone.EditContextMenu.Table") as PageTableGroup
        val tableIds = table.childActionsOrStubs.mapNotNull { com.intellij.openapi.actionSystem.ActionManager.getInstance().getId(it) }
        assertEquals(11, tableIds.size)
        assertTrue(tableIds.all { com.intellij.openapi.actionSystem.ActionManager.getInstance().getAction(it) is PageTableAction })
    }

    private fun tableEvent(action: com.intellij.openapi.actionSystem.AnAction, table: PageTable?) =
        com.intellij.testFramework.TestActionEvent.createTestEvent(
            action,
            com.intellij.openapi.actionSystem.impl.SimpleDataContext.builder().add(PageTable.KEY, table).build(),
        )

    fun testTableMenuActionsWorkOnTheCellOfTheMenu() {
        val file = myFixture.addFileToProject("t.md", "| A | B |\n|---|---|\n| 1 | 2 |").virtualFile
        val document = FileDocumentManager.getInstance().getDocument(file)!!
        val table = PageTable(project, document, 0, document.textLength, 1, 1)
        val manager = com.intellij.openapi.actionSystem.ActionManager.getInstance()
        val group = manager.getAction("markdone.EditContextMenu.Table")
        val hidden = tableEvent(group, null)
        group.update(hidden)
        assertFalse("No table: no submenu", hidden.presentation.isVisible)
        val shown = tableEvent(group, table)
        group.update(shown)
        assertTrue(shown.presentation.isVisible)

        val removeRow = manager.getAction("ch.nmeylan.markdone.TableRemoveRow")
        val headerRow = tableEvent(removeRow, PageTable(project, document, 0, document.textLength, 0, 0))
        removeRow.update(headerRow)
        assertFalse("Header row cannot be removed", headerRow.presentation.isEnabled)

        val right = manager.getAction("ch.nmeylan.markdone.TableAlignRight")
        val e = tableEvent(right, table)
        right.update(e)
        assertTrue(e.presentation.isEnabled)
        right.actionPerformed(e)
        assertEquals("| A | B |\n|---|--:|\n| 1 | 2 |", document.text)
        // The range marker follows the edit: reformat still finds the table.
        val reformat = manager.getAction("ch.nmeylan.markdone.TableReformat")
        reformat.actionPerformed(tableEvent(reformat, table))
        assertEquals("| A   |   B |\n| --- | --: |\n| 1   |   2 |", document.text)
    }
}
