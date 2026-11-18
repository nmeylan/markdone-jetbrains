package ch.nmeylan.markdone.e2e

import org.junit.AfterClass

/** L5 with out-of-process JCEF (the 261 default, `ide.browser.jcef.out-of-process.enabled=true`). */
class OutOfProcessE2eTest : JcefModeSuite("oop", outOfProcess = true) {
    companion object {
        @JvmStatic
        @AfterClass
        fun stop() = closeSession("oop")
    }
}
