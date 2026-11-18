package ch.nmeylan.markdone.e2e

import org.junit.AfterClass

/** L5 with in-process JCEF (`ide.browser.jcef.out-of-process.enabled=false`). Its numbers go to perf.json. */
class InProcessE2eTest : JcefModeSuite("inprocess", outOfProcess = false) {
    companion object {
        @JvmStatic
        @AfterClass
        fun stop() = closeSession("inprocess")
    }
}
