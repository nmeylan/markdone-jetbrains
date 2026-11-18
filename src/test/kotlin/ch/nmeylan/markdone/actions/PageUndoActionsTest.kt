package ch.nmeylan.markdone.actions

import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.IdeActions
import com.intellij.openapi.actionSystem.PlatformCoreDataKeys
import com.intellij.openapi.actionSystem.impl.SimpleDataContext
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.keymap.KeymapManager
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.TestActionEvent
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import ch.nmeylan.markdone.editor.WebEditor
import ch.nmeylan.markdone.jcef.FakePageFactory
import ch.nmeylan.markdone.jcef.NO_CSS
import ch.nmeylan.markdone.jcef.SharedBrowserService
import ch.nmeylan.markdone.sync.FakeScheduler
import ch.nmeylan.markdone.sync.PageMessage
import java.awt.Component
import javax.swing.JPanel

/** Ctrl+Z / Ctrl+Shift+Z with the focus in the page run flush-then-undo. */
class PageUndoActionsTest : BasePlatformTestCase() {
    private val factory = FakePageFactory()

    private fun context(component: Component): DataContext =
        SimpleDataContext.getSimpleContext(PlatformCoreDataKeys.CONTEXT_COMPONENT, component)

    private fun event(action: AnAction, component: Component): AnActionEvent =
        TestActionEvent.createTestEvent(action, context(component))

    fun testActionsUseTheUndoRedoShortcutsAndArePromotedOnlyInThePage() {
        val actions = ActionManager.getInstance()
        val undo = actions.getAction("ch.nmeylan.markdone.PageUndo")
        val redo = actions.getAction("ch.nmeylan.markdone.PageRedo")
        assertTrue(undo is PageUndoAction)
        assertTrue(redo is PageRedoAction)
        val keymap = KeymapManager.getInstance().activeKeymap
        assertEquals(keymap.getShortcuts(IdeActions.ACTION_UNDO).toList(), keymap.getShortcuts("ch.nmeylan.markdone.PageUndo").toList())
        assertEquals(keymap.getShortcuts(IdeActions.ACTION_REDO).toList(), keymap.getShortcuts("ch.nmeylan.markdone.PageRedo").toList())

        val service = SharedBrowserService().apply {
            factory = this@PageUndoActionsTest.factory
            runOnEdt = { it() }
            loadCss = NO_CSS
            remoteImagesSetting = { false }
            syncScheduler = FakeScheduler()
        }
        Disposer.register(testRootDisposable, service)
        val file = myFixture.addFileToProject("u.md", "abc").virtualFile
        val web = WebEditor(project, file, FileDocumentManager.getInstance().getDocument(file)!!) { service }
        Disposer.register(testRootDisposable, web)
        web.onShown()
        val page = factory.pages.single()
        page.deliver(PageMessage.Ready(2))
        val docId = page.lastDocId()
        page.deliver(PageMessage.Opened(docId, 0))
        page.sent.clear()

        val platformUndo = actions.getAction(IdeActions.ACTION_UNDO)
        val promoter = PageUndoPromoter()
        // Focus in the browser: our action goes first and is enabled.
        assertEquals(listOf(undo), promoter.promote(listOf(platformUndo, undo), context(page.component)))
        val e = event(undo, page.component)
        undo.update(e)
        assertTrue(e.presentation.isEnabled)
        undo.actionPerformed(e)
        assertEquals("Flush first, undo after the reply", listOf("flush"), page.sent.map { it["type"].asString })

        // Focus elsewhere (or the empty Edit panel): no promotion, disabled.
        for (other in listOf<Component>(JPanel(), web.component)) {
            assertEquals(emptyList<AnAction>(), promoter.promote(listOf(platformUndo, undo), context(other)))
            val e2 = event(redo, other)
            redo.update(e2)
            assertFalse(e2.presentation.isEnabled)
        }
    }
}
