package ch.nmeylan.markdone.e2e

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.net.Socket
import java.util.concurrent.TimeUnit

/** Page side through the JCEF remote debugging port: runs `scripts/e2e/cdp.mjs` (Playwright `connectOverCDP`). */
class Cdp(private val port: Int) {
    private val script = E2e.root.resolve("scripts/e2e/cdp.mjs").toString()

    /** The port is open (JCEF starts on the first browser, not with the IDE). */
    fun available(): Boolean = try {
        Socket("127.0.0.1", port).close(); true
    } catch (_: Exception) {
        false
    }

    fun pages(): List<String> = run("pages").jsonArray.map { it.jsonPrimitive.content }

    /** Runs [expression] in the shared page (PROTOCOL v2: one page, URL [PAGE_URL]). */
    fun eval(expression: String): JsonElement = run("eval", PAGE_URL, expression)

    fun evalString(expression: String): String = eval(expression).jsonPrimitive.content

    /** `[type, url]` of every CDP target (`/json/list`): pages, workers, other. */
    fun targets(): List<Pair<String, String>> =
        Json.parseToJsonElement(java.net.URI("http://127.0.0.1:$port/json/list").toURL().readText()).jsonArray.map {
            val o = it.jsonObject
            o["type"]!!.jsonPrimitive.content to o["url"]!!.jsonPrimitive.content
        }

    /** Starts recording all requests; [Watch.stop] returns them. */
    fun watch(): Watch {
        val p = ProcessBuilder("node", script, port.toString(), "watch").redirectError(ProcessBuilder.Redirect.INHERIT).start()
        val reader = p.inputStream.bufferedReader()
        val first = reader.readLine()
        check(first == "WATCHING") { "cdp watch did not start: $first" }
        return Watch(p, reader)
    }

    class Watch(private val p: Process, private val reader: java.io.BufferedReader) {
        fun stop(): JsonArray {
            p.outputStream.close()
            val line = reader.readLine()
            p.waitFor(15, TimeUnit.SECONDS)
            return Json.parseToJsonElement(line).jsonArray
        }
    }

    companion object {
        const val PAGE_URL = "https://markdone.local/app/index.html"
    }

    private fun run(vararg args: String): JsonElement {
        val p = ProcessBuilder(listOf("node", script, port.toString()) + args).start()
        val out = p.inputStream.bufferedReader().readText()
        val err = p.errorStream.bufferedReader().readText()
        check(p.waitFor(60, TimeUnit.SECONDS) && p.exitValue() == 0) { "cdp ${args.first()} failed: $err" }
        return Json.parseToJsonElement(out.trim())
    }
}
