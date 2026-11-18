package ch.nmeylan.markdone.settings

import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.xmlb.XmlSerializer

/** Settings: persistence, ranges, change events, settings page. */
class MdSettingsTest : BasePlatformTestCase() {
    private val settings get() = MdSettings.getInstance()

    override fun tearDown() {
        try {
            settings.loadState(MdSettings.SettingsState())
            MdProjectSettings.getInstance(project).loadState(MdProjectSettings.ProjectState())
        } finally {
            super.tearDown()
        }
    }

    private fun countChanges(): () -> Int {
        var n = 0
        ApplicationManager.getApplication().messageBus.connect(testRootDisposable).subscribe(MdSettings.TOPIC, MdSettings.Listener { n++ })
        return { n }
    }

    fun testDefaults() {
        assertEquals("", settings.globalCss)
        assertFalse(settings.remoteImages)
        assertEquals(20, settings.largeFileLimitMb)
        val mib = 1024L * 1024
        assertFalse("20 MiB + some bytes: still 20 MB", settings.isAboveLargeFileLimit(20 * mib + 113))
        assertFalse(settings.isAboveLargeFileLimit(21 * mib - 1))
        assertTrue(settings.isAboveLargeFileLimit(21 * mib))
        assertEquals(MdStyle.DEFAULT, settings.style)
        assertEquals(MdColorTheme.IDE, settings.colorTheme)
        assertTrue(settings.math && settings.mermaid && settings.highlight && settings.softBreaks)
        assertFalse(settings.doubleClickEdit || settings.vim || settings.openInEditMode)
        assertEquals(1.0, settings.zoom)
        assertEquals(".markdone/style.css", MdProjectSettings.getInstance(project).projectCssPath)
    }

    fun testStateSurvivesSerialization() {
        settings.globalCss = "p { color: red }"
        settings.remoteImages = true
        settings.largeFileLimitMb = 3
        settings.style = MdStyle.SERIF
        settings.colorTheme = MdColorTheme.TOKYO_MOON
        settings.math = false
        settings.mermaid = false
        settings.highlight = false
        settings.softBreaks = false
        settings.doubleClickEdit = true
        settings.vim = true
        settings.openInEditMode = true
        settings.zoomIn()
        val xml = XmlSerializer.serialize(settings.state)
        val copy = MdSettings()
        copy.loadState(XmlSerializer.deserialize(xml, MdSettings.SettingsState::class.java))
        assertEquals("p { color: red }", copy.globalCss)
        assertTrue(copy.remoteImages)
        assertEquals(3, copy.largeFileLimitMb)
        assertEquals(MdStyle.SERIF, copy.style)
        assertEquals(MdColorTheme.TOKYO_MOON, copy.colorTheme)
        assertFalse(copy.math || copy.mermaid || copy.highlight || copy.softBreaks)
        assertTrue(copy.doubleClickEdit && copy.vim && copy.openInEditMode)
        assertEquals(1.1, copy.zoom)
    }

    fun testZoomStepsAndClamps() {
        val changes = countChanges()
        settings.zoomIn()
        assertEquals(1.1, settings.zoom)
        settings.zoomOut()
        settings.zoomOut()
        assertEquals(0.9, settings.zoom)
        repeat(30) { settings.zoomIn() }
        assertEquals(3.0, settings.zoom)
        val atMax = changes()
        settings.zoomIn()
        assertEquals("No event at the limit", atMax, changes())
        repeat(30) { settings.zoomOut() }
        assertEquals(0.5, settings.zoom)
        settings.zoomReset()
        assertEquals(1.0, settings.zoom)
        settings.zoomPercent = 130
        assertEquals(1.3, settings.zoom)
        settings.zoomPercent = 900
        assertEquals(3.0, settings.zoom)
        settings.zoomPercent = 0
        assertEquals(0.5, settings.zoom)
    }

    fun testLargeFileLimitRangeAndEvents() {
        val changes = countChanges()
        settings.largeFileLimitMb = 0
        assertEquals(1, settings.largeFileLimitMb)
        settings.largeFileLimitMb = 50
        assertEquals(20, settings.largeFileLimitMb)
        assertEquals(2, changes())
        settings.largeFileLimitMb = 20
        settings.style = MdStyle.DEFAULT
        settings.math = true
        assertEquals("Same values: no event", 2, changes())
        settings.style = MdStyle.COMPACT
        settings.mermaid = false
        settings.highlight = false
        assertEquals(5, changes())
    }

    fun testSettingsPageAppliesWithoutRestart() {
        val changes = countChanges()
        val ep = com.intellij.openapi.options.Configurable.PROJECT_CONFIGURABLE.getExtensions(project).single { it.id == "ch.nmeylan.markdone.settings" }
        assertEquals("tools", ep.parentId)
        assertEquals("Markdone", ep.displayName)
        val page = MdConfigurable(project)
        try {
            assertNotNull(page.createComponent())
            page.reset()
            assertFalse("A new page has no changes", page.isModified)
            page.apply()
            assertEquals("Apply without a change publishes nothing", 0, changes())
            settings.zoomIn()
            settings.style = MdStyle.SERIF
            assertTrue("The page shows other values than the settings", page.isModified)
            page.reset()
            assertFalse(page.isModified)
        } finally {
            page.disposeUIResources()
        }
    }

    fun testZoomAndStyleActionsOfTheContextMenu() {
        val event = { com.intellij.testFramework.TestActionEvent.createTestEvent() }
        ch.nmeylan.markdone.actions.ZoomInAction().actionPerformed(event())
        ch.nmeylan.markdone.actions.ZoomInAction().actionPerformed(event())
        assertEquals(1.2, settings.zoom)
        ch.nmeylan.markdone.actions.ZoomOutAction().actionPerformed(event())
        assertEquals(1.1, settings.zoom)
        ch.nmeylan.markdone.actions.ZoomResetAction().actionPerformed(event())
        assertEquals(1.0, settings.zoom)
        val serif = ch.nmeylan.markdone.actions.StyleSerifAction()
        val default = ch.nmeylan.markdone.actions.StyleDefaultAction()
        assertTrue(default.isSelected(event()))
        assertFalse(serif.isSelected(event()))
        serif.setSelected(event(), true)
        assertEquals(MdStyle.SERIF, settings.style)
        assertTrue(serif.isSelected(event()))
        assertFalse(default.isSelected(event()))
        // Clicking the selected item again keeps it (radio-like).
        serif.setSelected(event(), false)
        assertEquals(MdStyle.SERIF, settings.style)
    }

    private fun <T : javax.swing.JComponent> find(root: javax.swing.JComponent, type: Class<T>): T =
        com.intellij.util.ui.UIUtil.findComponentOfType(root, type) ?: error("no ${type.simpleName}")

    /** An integer percent spinner; after a step and apply the page is not modified. */
    fun testZoomSpinnerStepThenApplyIsNotModified() {
        val page = MdConfigurable(project)
        try {
            val root = page.createComponent()!!
            page.reset()
            val spinner = find(root, com.intellij.ui.JBIntSpinner::class.java)
            spinner.value = spinner.nextValue
            assertTrue(page.isModified)
            page.apply()
            assertEquals(1.1, settings.zoom)
            assertFalse(page.isModified)
        } finally {
            page.disposeUIResources()
        }
    }

    fun testSettingsPageRefusesTooLargeCssAndPathsOutsideTheProject() {
        val page = MdConfigurable(project)
        try {
            val root = page.createComponent()!!
            page.reset()
            val css = find(root, com.intellij.ui.components.JBTextArea::class.java)
            css.text = "a".repeat(ch.nmeylan.markdone.css.UserCssService.MAX_BYTES + 1)
            assertThrows(com.intellij.openapi.options.ConfigurationException::class.java) { page.apply() }
            assertEquals("", settings.globalCss)
            css.text = "p {}"
            val path = find(root, com.intellij.ui.components.JBTextField::class.java)
            for (bad in listOf("../x.css", "/etc/x.css", "")) {
                path.text = bad
                assertThrows(com.intellij.openapi.options.ConfigurationException::class.java) { page.apply() }
            }
            assertEquals(".markdone/style.css", MdProjectSettings.getInstance(project).projectCssPath)
            path.text = "docs/style.css"
            page.apply()
            assertEquals("p {}", settings.globalCss)
            assertEquals("docs/style.css", MdProjectSettings.getInstance(project).projectCssPath)
        } finally {
            page.disposeUIResources()
        }
    }

    /** A state loaded from outside (Settings Sync, import) publishes the change. */
    fun testLoadStatePublishesTheChange() {
        val changes = countChanges()
        settings.loadState(MdSettings.SettingsState().apply { zoomPercent = 120 })
        com.intellij.testFramework.PlatformTestUtil.dispatchAllInvocationEventsInIdeEventQueue()
        assertEquals(1.2, settings.zoom)
        assertEquals(1, changes())
        MdProjectSettings.getInstance(project).loadState(MdProjectSettings.ProjectState().apply { projectCssPath = "a.css" })
        com.intellij.testFramework.PlatformTestUtil.dispatchAllInvocationEventsInIdeEventQueue()
        assertEquals(2, changes())
    }
}
