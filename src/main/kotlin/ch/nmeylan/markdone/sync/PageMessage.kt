package ch.nmeylan.markdone.sync

import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonNull
import com.google.gson.JsonObject
import com.google.gson.JsonPrimitive
import com.google.gson.Strictness
import com.google.gson.stream.JsonReader
import com.google.gson.stream.JsonToken
import com.google.gson.stream.MalformedJsonException
import java.io.StringReader
import java.math.BigDecimal

/** A validated page → IDE message (protocol/PROTOCOL.md, version 2.4). */
sealed interface PageMessage {
    /** The page booted and found the host. */
    data class Ready(val protocol: Int) : PageMessage

    /** A message about one document of the page. */
    sealed interface ForDoc : PageMessage {
        val docId: String
    }

    data class Opened(override val docId: String, val docStamp: Long) : ForDoc
    data class Activated(override val docId: String) : ForDoc
    data class LoadError(override val docId: String, val reason: String) : ForDoc

    /** The length check of the page failed; the IDE replies `reload`. */
    data class Diverged(override val docId: String, val pageLength: Int, val expectedLength: Int) : ForDoc
    data class Patch(override val docId: String, val seq: Long, val baseStamp: Long, val patches: List<TextPatch>) : ForDoc
    data class Link(override val docId: String, val href: String, val kind: LinkKind) : ForDoc

    /** `toggleMode`, `find`, `undo`, `redo`, `zoomIn`, `zoomOut` or `zoomReset`. */
    data class Command(override val docId: String, val name: String) : ForDoc
    data class ContextMenu(
        override val docId: String, val x: Double, val y: Double, val from: Int, val to: Int, val table: TableCell? = null,
    ) : ForDoc

    data class TableAction(override val docId: String, val action: String, val cell: TableCell) : ForDoc

    /** Ctrl/Cmd-click on text that is not a link: Source mode with the caret at [pos]. */
    data class GotoSource(override val docId: String, val pos: Int) : ForDoc

    /** Protocol 2.6: which of [paths] (relative, as written in inline code) are project files; the IDE replies `paths`. */
    data class PathsExist(override val docId: String, val paths: List<String>) : ForDoc

    /** Protocol 2.4: start of the first visible line and the main selection of the page's active document. */
    data class Viewport(override val docId: String, val top: Int, val anchor: Int, val head: Int) : ForDoc
}

data class TextPatch(val start: Int, val end: Int, val text: String)

/** A cell of the table at [from]..[to] (source range of the Lezer `Table` node); row 0 is the header row. */
data class TableCell(val from: Int, val to: Int, val row: Int, val column: Int)

enum class LinkKind(val id: String) { EXTERNAL("external"), RELATIVE("relative"), ANCHOR("anchor") }

/**
 * Parses and validates page messages. Runs on a CEF thread, so it is pure and never blocks.
 * Anything that does not match the protocol exactly (strict JSON, the exact keys of its type) gives `null`.
 * Whether a docId belongs to the page is checked later, by the receiver.
 */
object PageMessages {
    const val PROTOCOL_VERSION = 2
    const val MAX_PATCH_BYTES = 8 * 1024 * 1024
    const val MAX_OTHER_BYTES = 4 * 1024

    // CSS px; far outside any screen.
    private const val MAX_COORDINATE = 1_000_000.0

    /** Bridge channels. */
    val CHANNELS = listOf("ready", "patch", "link", "command")

    /** Message types that each channel accepts. */
    private val TYPES = mapOf(
        "ready" to setOf("ready", "opened", "activated", "loadError", "diverged", "viewport"),
        "patch" to setOf("patch"),
        "link" to setOf("link"),
        "command" to setOf("command"),
    )

    /** Most paths of one `pathsExist`, and the longest path. */
    const val MAX_PATHS = 16
    const val MAX_PATH_LENGTH = 200

    /** Commands with only `type`, `docId` and `name`. */
    val SIMPLE_COMMANDS = setOf("toggleMode", "find", "undo", "redo", "zoomIn", "zoomOut", "zoomReset")

    private val DOC_ID = Regex("[0-9a-f]{32}")
    /** `tableAction` names (protocol 2.1). */
    val TABLE_ACTIONS = setOf(
        "insertRowAbove", "insertRowBelow", "insertColumnLeft", "insertColumnRight", "removeRow", "removeColumn",
        "alignLeft", "alignCenter", "alignRight", "alignNone", "reformat",
    )
    private val LOAD_ERRORS = setOf("fetch", "stamp")

    /** Returns the message that [json] holds, if it is a valid message for [channel]. */
    fun parse(channel: String, json: String): PageMessage? {
        val types = TYPES[channel] ?: return null
        val limit = if (channel == "patch") MAX_PATCH_BYTES else MAX_OTHER_BYTES
        // A UTF-8 byte count is never smaller than the char count, so check that first.
        if (json.length > limit || utf8Length(json) > limit) return null
        val obj = try {
            parseStrict(json) as? JsonObject
        } catch (_: Exception) {
            null
        } ?: return null
        val type = string(obj, "type")?.takeIf { it in types } ?: return null
        if (type == "ready") {
            if (!hasKeys(obj, "type", "protocol")) return null
            return long(obj, "protocol")?.takeIf { it == PROTOCOL_VERSION.toLong() }?.let { PageMessage.Ready(it.toInt()) }
        }
        val docId = string(obj, "docId")?.takeIf { DOC_ID.matches(it) } ?: return null
        return when (type) {
            "opened" -> if (!hasKeys(obj, "type", "docId", "docStamp")) null
            else long(obj, "docStamp")?.let { PageMessage.Opened(docId, it) }
            "activated" -> if (!hasKeys(obj, "type", "docId")) null else PageMessage.Activated(docId)
            "loadError" -> if (!hasKeys(obj, "type", "docId", "reason")) null
            else string(obj, "reason")?.takeIf { it in LOAD_ERRORS }?.let { PageMessage.LoadError(docId, it) }
            "diverged" -> if (!hasKeys(obj, "type", "docId", "pageLength", "expectedLength")) null else {
                val pageLength = offset(obj, "pageLength")
                val expectedLength = offset(obj, "expectedLength")
                if (pageLength == null || expectedLength == null) null else PageMessage.Diverged(docId, pageLength, expectedLength)
            }
            "viewport" -> if (!hasKeys(obj, "type", "docId", "top", "anchor", "head")) null else {
                val top = offset(obj, "top")
                val anchor = offset(obj, "anchor")
                val head = offset(obj, "head")
                if (top == null || anchor == null || head == null) null else PageMessage.Viewport(docId, top, anchor, head)
            }
            "patch" -> parsePatch(obj, docId)
            "link" -> parseLink(obj, docId)
            "command" -> parseCommand(obj, docId)
            else -> null
        }
    }

    private fun parsePatch(obj: JsonObject, docId: String): PageMessage? {
        if (!hasKeys(obj, "type", "docId", "seq", "baseStamp", "patches")) return null
        val seq = long(obj, "seq")?.takeIf { it >= 0 } ?: return null
        val baseStamp = long(obj, "baseStamp") ?: return null
        val array = obj.get("patches")?.takeIf { it.isJsonArray }?.asJsonArray ?: return null
        val patches = ArrayList<TextPatch>(array.size())
        for (element in array) {
            val p = element as? JsonObject ?: return null
            if (!hasKeys(p, "start", "end", "text")) return null
            val start = offset(p, "start") ?: return null
            val end = offset(p, "end") ?: return null
            val text = string(p, "text") ?: return null
            if (end < start) return null
            patches += TextPatch(start, end, text)
        }
        return PageMessage.Patch(docId, seq, baseStamp, patches)
    }

    private fun parseLink(obj: JsonObject, docId: String): PageMessage? {
        if (!hasKeys(obj, "type", "docId", "href", "kind")) return null
        val href = string(obj, "href")?.takeIf { it.isNotEmpty() } ?: return null
        val kindId = string(obj, "kind") ?: return null
        val kind = LinkKind.entries.firstOrNull { it.id == kindId } ?: return null
        return PageMessage.Link(docId, href, kind)
    }

    private fun parseCommand(obj: JsonObject, docId: String): PageMessage? {
        return when (val name = string(obj, "name")) {
            in SIMPLE_COMMANDS -> if (hasKeys(obj, "type", "docId", "name")) PageMessage.Command(docId, name!!) else null
            "contextMenu" -> {
                val withTable = obj.has("table")
                if (!hasKeys(obj, "type", "docId", "name", "x", "y", "from", "to", *(if (withTable) arrayOf("table") else emptyArray()))) return null
                val x = coordinate(obj, "x") ?: return null
                val y = coordinate(obj, "y") ?: return null
                val from = offset(obj, "from") ?: return null
                val to = offset(obj, "to")?.takeIf { it >= from } ?: return null
                val table = if (withTable) (obj.get("table") as? JsonObject)
                    ?.takeIf { hasKeys(it, "from", "to", "row", "column") }?.let(::tableCell) ?: return null else null
                PageMessage.ContextMenu(docId, x, y, from, to, table)
            }
            "tableAction" -> {
                if (!hasKeys(obj, "type", "docId", "name", "action", "from", "to", "row", "column")) return null
                val action = string(obj, "action")?.takeIf { it in TABLE_ACTIONS } ?: return null
                val cell = tableCell(obj) ?: return null
                PageMessage.TableAction(docId, action, cell)
            }
            "gotoSource" -> {
                if (!hasKeys(obj, "type", "docId", "name", "pos")) return null
                offset(obj, "pos")?.let { PageMessage.GotoSource(docId, it) }
            }
            "pathsExist" -> {
                if (!hasKeys(obj, "type", "docId", "name", "paths")) return null
                val array = obj.get("paths")?.takeIf { it.isJsonArray }?.asJsonArray ?: return null
                if (array.size() > MAX_PATHS) return null
                val paths = array.map { e ->
                    if (!e.isJsonPrimitive || !e.asJsonPrimitive.isString) return null
                    e.asString.takeIf { it.isNotEmpty() && it.length <= MAX_PATH_LENGTH } ?: return null
                }
                PageMessage.PathsExist(docId, paths)
            }
            else -> null
        }
    }

    /** The `from`, `to`, `row` and `column` of [obj]. */
    private fun tableCell(obj: JsonObject): TableCell? {
        val from = offset(obj, "from") ?: return null
        val to = offset(obj, "to")?.takeIf { it > from } ?: return null
        val row = offset(obj, "row") ?: return null
        val column = offset(obj, "column") ?: return null
        return TableCell(from, to, row, column)
    }

    /** Strict RFC 8259 JSON (no lenient syntax, no NaN), with duplicate keys refused. Throws on bad input. */
    private fun parseStrict(json: String): JsonElement {
        val reader = JsonReader(StringReader(json))
        // The reader's nesting limit (default 255) also limits the recursion of read().
        reader.setStrictness(Strictness.STRICT)
        val element = read(reader)
        if (reader.peek() != JsonToken.END_DOCUMENT) throw MalformedJsonException("Data after the JSON value")
        return element
    }

    private fun read(reader: JsonReader): JsonElement = when (reader.peek()) {
        JsonToken.BEGIN_OBJECT -> {
            val obj = JsonObject()
            reader.beginObject()
            while (reader.hasNext()) {
                val name = reader.nextName()
                if (obj.has(name)) throw MalformedJsonException("Duplicate key")
                obj.add(name, read(reader))
            }
            reader.endObject()
            obj
        }
        JsonToken.BEGIN_ARRAY -> {
            val array = JsonArray()
            reader.beginArray()
            while (reader.hasNext()) array.add(read(reader))
            reader.endArray()
            array
        }
        JsonToken.STRING -> JsonPrimitive(reader.nextString())
        JsonToken.NUMBER -> JsonPrimitive(BigDecimal(reader.nextString()))
        JsonToken.BOOLEAN -> JsonPrimitive(reader.nextBoolean())
        JsonToken.NULL -> {
            reader.nextNull()
            JsonNull.INSTANCE
        }
        else -> throw MalformedJsonException("Unexpected token")
    }

    /** Exactly these keys: no key missing, no other key. */
    private fun hasKeys(obj: JsonObject, vararg keys: String): Boolean =
        obj.size() == keys.size && keys.all { obj.has(it) }

    private fun string(obj: JsonObject, key: String): String? {
        val e: JsonElement = obj.get(key) ?: return null
        return if (e.isJsonPrimitive && e.asJsonPrimitive.isString) e.asString else null
    }

    /** An integral JSON number that fits a Long, else `null`. */
    private fun long(obj: JsonObject, key: String): Long? {
        val e = obj.get(key) ?: return null
        if (!e.isJsonPrimitive || !e.asJsonPrimitive.isNumber) return null
        return try {
            BigDecimal(e.asString).longValueExact()
        } catch (_: ArithmeticException) {
            null
        } catch (_: NumberFormatException) {
            null
        }
    }

    /** A document offset: an integer in 0..Int.MAX_VALUE. */
    private fun offset(obj: JsonObject, key: String): Int? =
        long(obj, key)?.takeIf { it in 0..Int.MAX_VALUE.toLong() }?.toInt()

    /** Any finite JSON number within ±[MAX_COORDINATE]. */
    private fun coordinate(obj: JsonObject, key: String): Double? {
        val e = obj.get(key) ?: return null
        if (!e.isJsonPrimitive || !e.asJsonPrimitive.isNumber) return null
        val value = BigDecimal(e.asString)
        if (value.abs() > BigDecimal.valueOf(MAX_COORDINATE)) return null
        return value.toDouble()
    }

    private fun utf8Length(s: String): Int {
        var n = 0
        var i = 0
        while (i < s.length) {
            val c = s[i]
            n += when {
                c.code < 0x80 -> 1
                c.code < 0x800 -> 2
                Character.isHighSurrogate(c) && i + 1 < s.length && Character.isLowSurrogate(s[i + 1]) -> { i++; 4 }
                else -> 3
            }
            i++
        }
        return n
    }
}
