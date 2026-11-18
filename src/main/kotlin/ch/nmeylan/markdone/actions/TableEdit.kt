package ch.nmeylan.markdone.actions

import java.text.BreakIterator

/**
 * Text-level GFM table actions. Pure: it reads the text and returns
 * the edits; the caller applies them as one write command.
 *
 * Rules:
 * - The table is the full lines that hold `from..to` (Lezer/GFM table rules). The prefix of the first
 *   line is `text[lineStart, from)`: indentation, blockquote markers and list markers (a table can start
 *   on a list-marker line). The prefix of the other lines is their container indentation and blockquote
 *   markers (`[ \t>]*`). Each line keeps its prefix untouched.
 * - Only the header row and the alignment row need a pipe and the same number of cells. A body row is
 *   any non-blank line after them (also a lazy continuation line without the container prefix); its
 *   cells are split the same way, so a line without a pipe is one cell.
 * - Cells are split at every pipe that is not escaped (`\|`), also inside code spans (GFM, Lezer).
 * - Rows use the protocol numbering: row 0 is the header row, the alignment row is not counted.
 * - The header row and the alignment row cannot be removed, and no row goes above the header.
 *   The only column of a table cannot be removed.
 * - Without [Action.REFORMAT], only the changed cells are written; a new cell has one space of
 *   padding on each side. When an empty cell at an edge without a pipe would change the table
 *   (see [addNeededPipes]), or one column is left, the missing outer pipe is added to all rows.
 * - [Action.REFORMAT] pads every cell to its column width (by [displayWidth]) and aligns it as the
 *   column alignment says; it keeps the leading/trailing pipe style of the header row.
 */
object TableEdit {

    enum class Action(val id: String) {
        INSERT_ROW_ABOVE("insertRowAbove"), INSERT_ROW_BELOW("insertRowBelow"),
        INSERT_COLUMN_LEFT("insertColumnLeft"), INSERT_COLUMN_RIGHT("insertColumnRight"),
        REMOVE_ROW("removeRow"), REMOVE_COLUMN("removeColumn"),
        ALIGN_LEFT("alignLeft"), ALIGN_CENTER("alignCenter"), ALIGN_RIGHT("alignRight"), ALIGN_NONE("alignNone"),
        REFORMAT("reformat");

        companion object {
            fun of(id: String): Action? = entries.firstOrNull { it.id == id }
        }
    }

    enum class Align { NONE, LEFT, CENTER, RIGHT }

    /** Replace `from..to` (offsets in the text before all edits) by [text]. */
    data class Edit(val from: Int, val to: Int, val text: String)

    /** One line of a table: `prefix [|] cell | cell ... [|] trailing`. [render] gives the line back. */
    class Row(val prefix: String, var leadingPipe: Boolean, val cells: MutableList<String>, var trailingPipe: Boolean, val trailing: String) {
        fun render(): String =
            prefix + (if (leadingPipe) "|" else "") + cells.joinToString("|") + (if (trailingPipe) "|" else "") + trailing

        val hasPipe: Boolean
            get() = leadingPipe || trailingPipe || cells.size > 1
    }

    /** A parsed table: [lines] are the full source lines from [start] to [end] (no final newline). */
    class Table(val start: Int, val end: Int, val lines: List<String>, val rows: List<Row>) {
        /** Number of columns: the cells of the header row. */
        val columns: Int
            get() = rows[0].cells.size

        /** Header row and body rows (protocol numbering). */
        val rowCount: Int
            get() = rows.size - 1

        val alignments: List<Align>
            get() = rows[1].cells.map { alignOf(it.trim()) }

        /** Line index of protocol row [row]. */
        fun lineOf(row: Int): Int = if (row == 0) 0 else row + 1

        fun lineStart(line: Int): Int {
            var offset = start
            for (i in 0 until line) offset += lines[i].length + 1
            return offset
        }
    }

    private val DELIMITER_CELL = Regex(":?-+:?")

    /** Container prefix of the first table line: indentation, blockquote markers and list markers. */
    private val FIRST_LINE_PREFIX = Regex("""(?:[ \t]*(?:>|[-+*][ \t]|\d{1,9}[.)][ \t]))*[ \t]*""")

    /**
     * Parses the table whose source range is [from]..[to] in [text], or returns `null` when that range
     * is not exactly a table: `from` must be at the start of a line's content (after its container
     * prefix), the rest of the line after `to` must be blank, and the lines must be a header row, a valid
     * alignment row with the same number of cells, and non-blank body rows.
     */
    fun parse(text: CharSequence, from: Int, to: Int): Table? {
        if (from < 0 || to > text.length || from >= to) return null
        val start = lineStartOf(text, from)
        if (!FIRST_LINE_PREFIX.matches(text.subSequence(start, from))) return null
        val end = lineEndOf(text, to)
        if (!(to until end).all { text[it].isWhitespace() }) return null
        val lines = text.subSequence(start, end).toString().split('\n')
        if (lines.size < 2) return null
        val rows = lines.mapIndexed { i, line -> if (i == 0) parseRow(line, from - start) else parseRow(line) }
        val header = rows[0]
        val delimiter = rows[1]
        if (!header.hasPipe || !delimiter.hasPipe) return null
        if (header.cells.size != delimiter.cells.size) return null
        if (!delimiter.cells.all { DELIMITER_CELL.matches(it.trim()) }) return null
        for (i in 2 until rows.size) {
            if (lines[i].substring(rows[i].prefix.length).isBlank()) return null
        }
        return Table(start, end, lines, rows)
    }

    /**
     * Splits one table line into its parts; `parseRow(line).render() == line` for every line. The prefix
     * is the first [prefixLength] chars, or `[ \t>]*` when [prefixLength] is negative.
     */
    fun parseRow(line: String, prefixLength: Int = -1): Row {
        var p = maxOf(prefixLength, 0)
        if (prefixLength < 0) while (p < line.length && (line[p] == ' ' || line[p] == '\t' || line[p] == '>')) p++
        val prefix = line.substring(0, p)
        val body = line.substring(p)
        val pipes = separatorPipes(body)
        val contentEnd = body.trimEnd().length
        val leading = pipes.firstOrNull() == 0
        val trailing = pipes.isNotEmpty() && pipes.last() == contentEnd - 1 && !(leading && pipes.size == 1)
        val cutStart = if (leading) 1 else 0
        val cutEnd = if (trailing) contentEnd - 1 else body.length
        val cells = ArrayList<String>()
        var cellStart = cutStart
        for (pipe in pipes) {
            if (pipe < cutStart || pipe >= cutEnd) continue
            cells += body.substring(cellStart, pipe)
            cellStart = pipe + 1
        }
        cells += body.substring(cellStart, maxOf(cellStart, cutEnd))
        return Row(prefix, leading, cells, trailing, if (trailing) body.substring(contentEnd) else "")
    }

    /**
     * Indexes of the pipes in [s] that separate cells: every pipe that is not escaped (`\|`). As in GFM
     * and Lezer, a code span does not protect a pipe.
     */
    fun separatorPipes(s: String): List<Int> {
        val pipes = ArrayList<Int>()
        var i = 0
        while (i < s.length) {
            when (s[i]) {
                '\\' -> i += 2
                '|' -> pipes += i++
                else -> i++
            }
        }
        return pipes
    }

    /**
     * The edits for [action] on the cell ([row], [column]) of the table at [from]..[to] in [text].
     * `null` when the range is not a table, the cell is outside it, or the action is refused
     * (see the class rules). An empty list means nothing to change.
     */
    fun edits(text: CharSequence, from: Int, to: Int, action: Action, row: Int, column: Int): List<Edit>? =
        parse(text, from, to)?.let { edits(it, action, row, column) }

    /** The edits for [action] on the cell ([row], [column]) of the parsed [table]; see [edits]. */
    fun edits(table: Table, action: Action, row: Int, column: Int): List<Edit>? {
        if (!isAllowed(table, action, row, column)) return null
        return when (action) {
            Action.INSERT_ROW_ABOVE -> insertRow(table, table.lineOf(row), before = true)
            Action.INSERT_ROW_BELOW -> insertRow(table, if (row == 0) 1 else table.lineOf(row), before = false)
            Action.REMOVE_ROW -> removeRow(table, table.lineOf(row))
            Action.INSERT_COLUMN_LEFT -> lineEdits(table, insertColumn(table, column))
            Action.INSERT_COLUMN_RIGHT -> lineEdits(table, insertColumn(table, column + 1))
            Action.REMOVE_COLUMN -> lineEdits(table, removeColumn(table, column))
            Action.ALIGN_LEFT -> lineEdits(table, align(table, column, Align.LEFT))
            Action.ALIGN_CENTER -> lineEdits(table, align(table, column, Align.CENTER))
            Action.ALIGN_RIGHT -> lineEdits(table, align(table, column, Align.RIGHT))
            Action.ALIGN_NONE -> lineEdits(table, align(table, column, Align.NONE))
            Action.REFORMAT -> lineEdits(table, reformat(table))
        }
    }

    /**
     * Whether [edits] gives edits (not `null`) for [action] on the cell ([row], [column]) of [table],
     * without computing them. [Action.REFORMAT] needs only the table.
     */
    fun isAllowed(table: Table, action: Action, row: Int, column: Int): Boolean {
        if (action == Action.REFORMAT) return true
        if (row !in 0 until table.rowCount || column !in 0 until table.columns) return false
        return when (action) {
            Action.INSERT_ROW_ABOVE, Action.REMOVE_ROW -> row != 0
            Action.REMOVE_COLUMN -> table.columns != 1
            else -> true
        }
    }

    /** Applies [edits] (sorted, not overlapping) to [text]; for tests and checks. */
    fun apply(text: String, edits: List<Edit>): String {
        val sb = StringBuilder(text)
        for (e in edits.sortedByDescending { it.from }) sb.replace(e.from, e.to, e.text)
        return sb.toString()
    }

    private fun insertRow(table: Table, line: Int, before: Boolean): List<Edit> {
        val header = table.rows[0]
        val row = Row(table.rows[line].prefix, header.leadingPipe, ArrayList(), header.trailingPipe, "")
        for (j in 0 until table.columns) {
            row.cells += newCell("", j == 0 && !row.leadingPipe, j == table.columns - 1 && !row.trailingPipe)
        }
        val newLine = row.render()
        return if (before) {
            listOf(Edit(table.lineStart(line), table.lineStart(line), newLine + "\n"))
        } else {
            val end = table.lineStart(line) + table.lines[line].length
            listOf(Edit(end, end, "\n" + newLine))
        }
    }

    private fun removeRow(table: Table, line: Int): List<Edit> {
        val start = table.lineStart(line)
        val end = start + table.lines[line].length
        // The last line takes the newline before it; the others take the newline after them.
        return if (line == table.lines.lastIndex) listOf(Edit(start - 1, end, "")) else listOf(Edit(start, end + 1, ""))
    }

    /** Copies of the rows, for actions that change cells. */
    private fun copyRows(table: Table): List<Row> =
        table.rows.map { Row(it.prefix, it.leadingPipe, ArrayList(it.cells), it.trailingPipe, it.trailing) }

    private fun insertColumn(table: Table, index: Int): List<String> {
        val rows = copyRows(table)
        for ((i, row) in rows.withIndex()) {
            val cells = row.cells
            // Cells after the end of a short row are empty already.
            if (index > cells.size) continue
            val noLead = index == 0 && !row.leadingPipe
            val noTrail = index == cells.size && !row.trailingPipe
            if (noLead && !cells[0].startsWithSpace()) cells[0] = " " + cells[0]
            if (noTrail && !cells.last().endsWithSpace()) cells[cells.lastIndex] = cells.last() + " "
            cells.add(index, newCell(if (i == 1) "---" else "", noLead, noTrail))
        }
        addNeededPipes(rows)
        return rows.map { it.render() }
    }

    private fun removeColumn(table: Table, column: Int): List<String> {
        val rows = copyRows(table)
        for (row in rows) {
            val cells = row.cells
            if (column >= cells.size) continue
            if (cells.size == 1) {
                // The row keeps one empty cell, so it stays a table row.
                cells[0] = newCell("", !row.leadingPipe, !row.trailingPipe)
                continue
            }
            cells.removeAt(column)
            if (column == 0 && !row.leadingPipe) cells[0] = cells[0].trimStart()
            if (column == cells.size && !row.trailingPipe) cells[cells.lastIndex] = cells.last().trimEnd()
        }
        addNeededPipes(rows)
        return rows.map { it.render() }
    }

    private fun align(table: Table, column: Int, align: Align): List<String> {
        val rows = copyRows(table)
        val cells = rows[1].cells
        val cell = cells[column]
        val content = cell.trim()
        val lead = cell.substring(0, cell.length - cell.trimStart().length)
        val trail = cell.substring(cell.trimEnd().length)
        cells[column] = lead + delimiter(align, content.length) + trail
        return rows.map { it.render() }
    }

    /** An alignment cell of [width] chars when possible (at least one dash). */
    private fun delimiter(align: Align, width: Int): String = when (align) {
        Align.NONE -> "-".repeat(maxOf(1, width))
        Align.LEFT -> ":" + "-".repeat(maxOf(1, width - 1))
        Align.RIGHT -> "-".repeat(maxOf(1, width - 1)) + ":"
        Align.CENTER -> ":" + "-".repeat(maxOf(1, width - 2)) + ":"
    }

    private fun reformat(table: Table): List<String> {
        val n = table.columns
        val alignments = table.alignments
        val contents = table.rows.mapIndexed { i, row ->
            val c = row.cells.map { it.trim() }.toMutableList()
            if (i != 1) while (c.size < n) c += ""
            c
        }
        val widths = IntArray(contents.maxOf { it.size }) { if (it < n) 3 else 0 }
        for ((i, c) in contents.withIndex()) {
            if (i == 1) continue
            for ((j, s) in c.withIndex()) widths[j] = maxOf(widths[j], displayWidth(s))
        }
        var lead = table.rows[0].leadingPipe
        var trail = table.rows[0].trailingPipe
        if (n == 1 && !lead && !trail) {
            lead = true
            trail = true
        }
        if (contents.any { it.first().isEmpty() }) lead = true
        if (contents[0].last().isEmpty()) trail = true
        return table.rows.indices.map { i ->
            val prefix = table.rows[i].prefix
            val cells = contents[i].mapIndexed { j, s ->
                if (i == 1) delimiter(alignments[j], widths[j]) else pad(s, widths[j], alignments.getOrElse(j) { Align.NONE })
            }
            val line = prefix + (if (lead) "| " else "") + cells.joinToString(" | ") + (if (trail) " |" else "")
            if (trail) line else line.trimEnd()
        }
    }

    private fun pad(s: String, width: Int, align: Align): String {
        val space = width - displayWidth(s)
        if (space <= 0) return s
        return when (align) {
            Align.RIGHT -> " ".repeat(space) + s
            Align.CENTER -> " ".repeat(space / 2) + s + " ".repeat(space - space / 2)
            else -> s + " ".repeat(space)
        }
    }

    /**
     * An empty first cell without a leading pipe is read as the leading pipe (the cells shift), an empty
     * last header cell without a trailing pipe is read as the trailing pipe (the header loses a cell),
     * and one column without outer pipes is not a table: then that outer pipe goes on every row.
     * An empty last body cell is harmless: missing cells are empty.
     */
    private fun addNeededPipes(rows: List<Row>) {
        val oneColumn = rows[0].cells.size == 1
        val needLead = rows.any { !it.leadingPipe && it.cells.first().isBlank() } ||
            oneColumn && rows.any { !it.leadingPipe && !it.trailingPipe }
        val needTrail = !rows[0].trailingPipe && rows[0].cells.last().isBlank() ||
            oneColumn && rows.any { !it.leadingPipe && !it.trailingPipe }
        for (row in rows) {
            if (needLead && !row.leadingPipe) {
                row.leadingPipe = true
                row.cells[0] = if (row.cells[0].isBlank()) "  " else if (row.cells[0].startsWithSpace()) row.cells[0] else " " + row.cells[0]
            }
            if (needTrail && !row.trailingPipe) {
                row.trailingPipe = true
                val last = row.cells.last()
                row.cells[row.cells.lastIndex] = if (last.isBlank()) "  " else if (last.endsWithSpace()) last else "$last "
            }
        }
    }

    private fun newCell(content: String, noLead: Boolean, noTrail: Boolean): String =
        (if (noLead) "" else " ") + content + (if (noTrail) "" else " ")

    private fun String.startsWithSpace() = isNotEmpty() && this[0].isWhitespace()

    private fun String.endsWithSpace() = isNotEmpty() && this[length - 1].isWhitespace()

    private fun alignOf(cell: String): Align {
        val left = cell.startsWith(':')
        val right = cell.length > 1 && cell.endsWith(':')
        return when {
            left && right -> Align.CENTER
            left -> Align.LEFT
            right -> Align.RIGHT
            else -> Align.NONE
        }
    }

    /** One edit per changed line: the part between the common prefix and suffix of the old and new line. */
    private fun lineEdits(table: Table, newLines: List<String>): List<Edit> {
        val edits = ArrayList<Edit>()
        for ((i, old) in table.lines.withIndex()) {
            val new = newLines[i]
            if (old == new) continue
            var p = 0
            val max = minOf(old.length, new.length)
            while (p < max && old[p] == new[p]) p++
            var s = 0
            while (s < max - p && old[old.length - 1 - s] == new[new.length - 1 - s]) s++
            // Do not cut a surrogate pair.
            if (p > 0 && Character.isHighSurrogate(old[p - 1])) p--
            if (s > 0 && Character.isLowSurrogate(old[old.length - s])) s--
            val start = table.lineStart(i)
            edits += Edit(start + p, start + old.length - s, new.substring(p, new.length - s))
        }
        return edits
    }

    private fun lineStartOf(text: CharSequence, offset: Int): Int {
        var i = offset
        while (i > 0 && text[i - 1] != '\n') i--
        return i
    }

    private fun lineEndOf(text: CharSequence, offset: Int): Int {
        var i = offset
        while (i < text.length && text[i] != '\n') i++
        return i
    }

    /**
     * Columns that [s] takes in a monospace editor font, per grapheme cluster (JDK `BreakIterator`,
     * extended clusters since JDK 20): 2 when the cluster has an East Asian Wide/Fullwidth or emoji
     * code point (or an emoji presentation selector U+FE0F), 0 when it has only combining marks or
     * format characters, else 1. An approximation of `wcwidth`; ambiguous-width characters count 1.
     */
    fun displayWidth(s: String): Int {
        if (s.all { it.code < 0x300 }) return s.length
        val it = BreakIterator.getCharacterInstance()
        it.setText(s)
        var width = 0
        var start = it.first()
        var end = it.next()
        while (end != BreakIterator.DONE) {
            width += clusterWidth(s, start, end)
            start = end
            end = it.next()
        }
        return width
    }

    private fun clusterWidth(s: String, start: Int, end: Int): Int {
        var visible = false
        var i = start
        while (i < end) {
            val cp = s.codePointAt(i)
            if (isWide(cp) || cp == 0xFE0F) return 2
            val type = Character.getType(cp)
            if (type != Character.NON_SPACING_MARK.toInt() && type != Character.ENCLOSING_MARK.toInt() &&
                type != Character.FORMAT.toInt()
            ) visible = true
            i += Character.charCount(cp)
        }
        return if (visible) 1 else 0
    }

    private fun isWide(cp: Int): Boolean =
        cp in 0x1100..0x115F || cp in 0x2E80..0x303E || cp in 0x3041..0x33FF || cp in 0x3400..0x4DBF ||
            cp in 0x4E00..0x9FFF || cp in 0xA000..0xA4CF || cp in 0xAC00..0xD7A3 || cp in 0xF900..0xFAFF ||
            cp in 0xFE30..0xFE4F || cp in 0xFF00..0xFF60 || cp in 0xFFE0..0xFFE6 ||
            cp in 0x1F000..0x1FAFF || cp in 0x20000..0x2FFFD || cp in 0x30000..0x3FFFD
}
