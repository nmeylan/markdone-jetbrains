package ch.nmeylan.markdone.e2e

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.util.concurrent.TimeUnit

/**
 * Hyprland only: puts the windows of a test IDE on workspace `E2E_WORKSPACE` (default 3; empty
 * disables it) and gives a window the input focus for java.awt.Robot keys. Does nothing under
 * Xvfb (scripts/e2e.sh sets `MARKDONE_E2E_UNDER_XVFB`), or without `hyprctl` or `HYPRLAND_INSTANCE_SIGNATURE`.
 */
object Hypr {
    private val workspace: String? = (System.getenv("E2E_WORKSPACE") ?: "3").takeIf { it.isNotBlank() }

    val enabled: Boolean = workspace != null && System.getenv("MARKDONE_E2E_UNDER_XVFB") == null &&
        !System.getenv("HYPRLAND_INSTANCE_SIGNATURE").isNullOrBlank() &&
        System.getenv("PATH").orEmpty().split(':').any { java.io.File(it, "hyprctl").canExecute() }

    /** Moves every window of [pid] or its descendants that is not on the workspace yet. */
    fun moveWindows(pid: Long) {
        if (!enabled) return
        for ((address, ws) in windows(pid)) {
            if (ws != workspace) {
                dispatch(
                    "hl.dsp.window.move({ workspace = \"$workspace\", follow = false, window = \"address:$address\" })",
                    "movetoworkspacesilent", "$workspace,address:$address",
                )
            }
        }
    }

    /** Gives the input focus to the main (first) window of [pid]; moves the user's focus to that monitor. */
    fun focus(pid: Long) {
        if (!enabled) return
        moveWindows(pid)
        windows(pid).firstOrNull()?.let { (address, _) ->
            dispatch("hl.dsp.focus({ window = \"address:$address\" })", "focuswindow", "address:$address")
        }
    }

    /** (address, workspace name) of the mapped windows of [pid] and its descendants, most recently focused first. */
    private fun windows(pid: Long): List<Pair<String, String>> {
        val pids = buildSet {
            add(pid)
            ProcessHandle.of(pid).ifPresent { h -> h.descendants().forEach { add(it.pid()) } }
        }
        val out = run("clients", "-j") ?: return emptyList()
        return try {
            Json.parseToJsonElement(out).jsonArray.map { it.jsonObject }
                .filter { it["pid"]?.jsonPrimitive?.long in pids && it["mapped"]?.jsonPrimitive?.content == "true" }
                .sortedBy { it["focusHistoryID"]?.jsonPrimitive?.int ?: Int.MAX_VALUE }
                .map { it["address"]!!.jsonPrimitive.content to it["workspace"]!!.jsonObject["name"]!!.jsonPrimitive.content }
        } catch (e: Exception) {
            E2e.log("hyprctl clients: cannot parse output: ${e.message}")
            emptyList()
        }
    }

    /** Hyprland 0.56+ takes a Lua dispatcher; older versions take [legacy] (dispatcher name and argument). */
    private fun dispatch(lua: String, vararg legacy: String) {
        if (run("dispatch", lua)?.trim() != "ok") run("dispatch", *legacy)
    }

    private fun run(vararg args: String): String? = try {
        val p = ProcessBuilder(listOf("hyprctl") + args).redirectErrorStream(true).start()
        val out = p.inputStream.bufferedReader().readText()
        if (p.waitFor(5, TimeUnit.SECONDS) && p.exitValue() == 0) out else null
    } catch (_: Exception) {
        null
    }
}
