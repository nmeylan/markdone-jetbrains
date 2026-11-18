package ch.nmeylan.markdone

import com.intellij.openapi.editor.EditorFactory
import com.intellij.testFramework.fixtures.BasePlatformTestCase

/** Proves that the IntelliJ test framework runs headless with a light fixture. */
class FrameworkSmokeTest : BasePlatformTestCase() {

    fun testDocumentHoldsText() {
        val document = EditorFactory.getInstance().createDocument("# Title\n")
        assertEquals("# Title\n", document.text)
    }
}
