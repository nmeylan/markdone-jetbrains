package ch.nmeylan.markdone.settings

import java.nio.file.Files
import java.nio.file.Path

/** One key mapping for the page's Vim (protocol 2.5 `settings.vimrc`). [mode] is `all`, `normal`, `insert`, `visual` or `operator`. */
data class VimMapping(val mode: String, val remap: Boolean, val lhs: String, val rhs: String)

/** The mappings of an `.ideavimrc` that CodeMirror's Vim can run, and the lines that were left out. */
class VimRcResult(val source: Path?, val mappings: List<VimMapping>, val skipped: List<String>)

/**
 * Reads the user's `.ideavimrc` and keeps `map` commands and `let mapleader`.
 * Every other line (`set`, `:action`, plugins, Vimscript) is skipped and reported.
 */
object VimRc {
    private const val MAX_BYTES = 256 * 1024
    private const val MAX_MAPPINGS = 500

    private val COMMANDS: Map<String, Pair<String, Boolean>> = mapOf(
        "map" to ("all" to true), "nmap" to ("normal" to true), "vmap" to ("visual" to true), "xmap" to ("visual" to true),
        "imap" to ("insert" to true), "omap" to ("operator" to true),
        "noremap" to ("all" to false), "nnoremap" to ("normal" to false), "vnoremap" to ("visual" to false),
        "xnoremap" to ("visual" to false), "inoremap" to ("insert" to false), "onoremap" to ("operator" to false),
    )
    private val MODIFIERS = Regex("^<(silent|nowait|buffer|unique)>\\s*", RegexOption.IGNORE_CASE)
    private val UNSUPPORTED_MODIFIER = Regex("^<(expr|script|special)>", RegexOption.IGNORE_CASE)
    private val UNSUPPORTED_RHS = Regex("<(action|plug|cmd)>|:action\\b", RegexOption.IGNORE_CASE)
    private val LEADER = Regex("<leader>", RegexOption.IGNORE_CASE)
    private val LET_LEADER = Regex("^let\\s+(?:g:)?mapleader\\s*=\\s*(.+)$")
    private val COMMAND = Regex("^([A-Za-z]+)(!?)(?:\\s+(.*))?$")

    /** The file IdeaVim reads: `~/.ideavimrc`, `~/_ideavimrc`, then `$XDG_CONFIG_HOME/ideavim/ideavimrc`. */
    fun locate(home: Path, xdgConfigHome: String?): Path? {
        val config = if (xdgConfigHome.isNullOrBlank()) home.resolve(".config") else Path.of(xdgConfigHome)
        return listOf(home.resolve(".ideavimrc"), home.resolve("_ideavimrc"), config.resolve("ideavim/ideavimrc"))
            .firstOrNull { Files.isRegularFile(it) }
    }

    /** Reads and translates the file of the current user; no file: an empty result. */
    fun load(): VimRcResult {
        val file = locate(Path.of(System.getProperty("user.home")), System.getenv("XDG_CONFIG_HOME"))
            ?: return VimRcResult(null, emptyList(), emptyList())
        val text = try {
            if (Files.size(file) > MAX_BYTES) return VimRcResult(file, emptyList(), listOf("(file larger than ${MAX_BYTES / 1024} KB)"))
            Files.readString(file)
        } catch (e: Exception) {
            return VimRcResult(file, emptyList(), listOf("(cannot read the file: ${e.message})"))
        }
        return translate(text, file)
    }

    fun translate(text: String, source: Path? = null): VimRcResult {
        val mappings = ArrayList<VimMapping>()
        val skipped = ArrayList<String>()
        var leader = "\\"
        for (raw in text.lines()) {
            val line = raw.trim()
            if (line.isEmpty() || line.startsWith("\"")) continue
            LET_LEADER.matchEntire(line)?.let { m ->
                val value = leaderValue(m.groupValues[1])
                if (value == null) skipped += line else leader = value
                continue
            }
            val mapping = parseMapping(line, leader)
            when {
                mapping == null -> skipped += line
                mappings.size >= MAX_MAPPINGS -> skipped += line
                else -> mappings += mapping
            }
        }
        return VimRcResult(source, mappings, skipped)
    }

    /** The key a `mapleader` value stands for, as a Vim key name; null when it is not one key. */
    private fun leaderValue(raw: String): String? {
        val v = raw.trim()
        val quoted = v.length >= 2 && (v.first() == '"' || v.first() == '\'') && v.last() == v.first()
        if (!quoted) return null
        val inner = v.substring(1, v.length - 1)
        return when {
            inner == " " || inner.equals("\\<Space>", true) || inner.equals("<Space>", true) -> "<Space>"
            inner.length == 1 -> inner
            else -> null
        }
    }

    private fun parseMapping(line: String, leader: String): VimMapping? {
        val m = COMMAND.matchEntire(line) ?: return null
        val (mode, remap) = COMMANDS[m.groupValues[1]] ?: return null
        if (m.groupValues[2].isNotEmpty()) return null
        var rest = m.groupValues[3].trim()
        while (true) rest = MODIFIERS.find(rest)?.let { rest.substring(it.value.length) } ?: break
        if (UNSUPPORTED_MODIFIER.containsMatchIn(rest)) return null
        val parts = rest.split(Regex("\\s+"), limit = 2)
        if (parts.size < 2) return null
        val lhs = parts[0].replace(LEADER) { leader }
        val rhs = parts[1].trim().replace(LEADER) { leader }
        if (UNSUPPORTED_RHS.containsMatchIn(rhs)) return null
        return VimMapping(mode, remap, lhs, rhs)
    }
}
