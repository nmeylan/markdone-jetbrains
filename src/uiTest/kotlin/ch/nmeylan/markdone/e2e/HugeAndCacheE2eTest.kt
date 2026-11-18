package ch.nmeylan.markdone.e2e

import org.junit.Assume.assumeTrue
import org.junit.Test
import java.nio.file.Files
import kotlin.io.path.exists

/** In-process JCEF: the compiled-script cache ("measure, do not count on it"). huge.md tests are in [JcefModeSuite] (t29-t32). */
class HugeAndCacheE2eTest {

    /**
     * Two IDE sessions with the same JCEF cache dir: the first starts with it empty, the second
     * keeps it. Each session: cold Edit open of medium.md, then warm open of medium-2.md.
     */
    @Test
    fun compiledScriptCache() {
        assumeTrue("inprocess" in E2e.modes)
        assumeTrue("E2E_TESTS does not select compiledScriptCache", E2e.testFilter?.containsMatchIn("compiledScriptCache") ?: true)
        val cache = E2e.work.resolve("script-cache-jcef")
        for ((label, keep) in listOf("cleared" to false, "kept" to true)) {
            val setup = { p: java.nio.file.Path -> IdeSession.copy(p, "medium.md" to "medium.md", "medium.md" to "medium-2.md") }
            IdeSession("cache-$label", outOfProcess = false, setup, cacheDir = cache, keepCache = keep).start().use { s ->
                val (cold, coldId) = s.openInEdit("medium.md", 60_000)
                val (warm, warmId) = s.openInEdit("medium-2.md")
                Metrics.put("cache", "coldOpenCache${label.replaceFirstChar(Char::uppercase)}Ms", cold.toDouble())
                Metrics.put("cache", "warmOpenCache${label.replaceFirstChar(Char::uppercase)}Ms", warm.toDouble())
                E2e.log("[cache-$label] page perf: ${s.cdp.eval("window.markdone.perf()")}, cold: ${s.cdp.eval("window.markdone.perf('$coldId')")}, " +
                    "warm: ${s.cdp.eval("window.markdone.perf('$warmId')")}")
                Metrics.put("startup", "ideStartToSmartMs.$label", s.startupMs.toDouble())
            }
            val size = if (cache.exists()) Files.walk(cache).use { w -> w.filter(Files::isRegularFile).mapToLong(Files::size).sum() } else 0
            val codeCache = Files.walk(cache).use { w -> w.anyMatch { it.fileName.toString() == "Code Cache" } }
            E2e.log("[cache-$label] JCEF cache dir after the session: ${size / 1024} KB, 'Code Cache' dir present: $codeCache")
        }
    }
}
