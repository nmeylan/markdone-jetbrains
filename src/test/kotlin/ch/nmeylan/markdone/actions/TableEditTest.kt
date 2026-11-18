package ch.nmeylan.markdone.actions

import ch.nmeylan.markdone.actions.TableEdit.Action
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Path

/** L3: text-level table actions. */
class TableEditTest {
    private val before = "Intro\n\n"
    private val after = "\n\nOutro\n"

    /** Runs [action] on [table] placed between [before] and [after]; returns the new table text, or `null` when refused. */
    private fun run(table: String, action: Action, row: Int = 0, column: Int = 0): String? {
        val text = before + table + after
        val prefix = table.takeWhile { it == ' ' || it == '\t' || it == '>' }.length
        val edits = TableEdit.edits(text, before.length + prefix, before.length + table.length, action, row, column) ?: return null
        checkEdits(edits)
        val result = TableEdit.apply(text, edits)
        assertTrue(result.startsWith(before) && result.endsWith(after))
        return result.substring(before.length, result.length - after.length)
    }

    private fun checkEdits(edits: List<TableEdit.Edit>) {
        for (i in 1 until edits.size) assertTrue("sorted, no overlap", edits[i - 1].to <= edits[i].from)
    }

    /** The cells (trimmed) of each row, as GFM reads them. */
    private fun cells(table: String): List<List<String>> {
        val parsed = TableEdit.parse(table, table.takeWhile { it == ' ' || it == '>' }.length, table.length)
        assertNotNull("still a table:\n$table", parsed)
        return parsed!!.rows.map { r -> r.cells.map { it.trim() } }
    }

    private val piped = """
        | A | B |
        |---|---|
        | 1 | 2 |
        | 3 | 4 |
    """.trimIndent()

    // Rows

    @Test
    fun insertRowBelowAndAbove() {
        assertEquals("| A | B |\n|---|---|\n| 1 | 2 |\n|  |  |\n| 3 | 4 |", run(piped, Action.INSERT_ROW_BELOW, 1))
        assertEquals("| A | B |\n|---|---|\n|  |  |\n| 1 | 2 |\n| 3 | 4 |", run(piped, Action.INSERT_ROW_ABOVE, 1))
        assertEquals("| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n|  |  |", run(piped, Action.INSERT_ROW_BELOW, 2))
    }

    @Test
    fun insertRowBelowHeaderGoesAfterTheAlignmentRow() {
        assertEquals("| A | B |\n|---|---|\n|  |  |\n| 1 | 2 |\n| 3 | 4 |", run(piped, Action.INSERT_ROW_BELOW, 0))
        assertEquals("| A |\n|---|\n|  |", run("| A |\n|---|", Action.INSERT_ROW_BELOW, 0))
    }

    @Test
    fun noRowAboveTheHeaderAndHeaderNotRemoved() {
        assertNull(run(piped, Action.INSERT_ROW_ABOVE, 0))
        assertNull(run(piped, Action.REMOVE_ROW, 0))
    }

    @Test
    fun insertRowIsOneInsertion() {
        val text = before + piped + after
        val edits = TableEdit.edits(text, before.length, before.length + piped.length, Action.INSERT_ROW_BELOW, 1, 0)!!
        val e = edits.single()
        assertEquals(e.from, e.to)
    }

    @Test
    fun removeRow() {
        assertEquals("| A | B |\n|---|---|\n| 3 | 4 |", run(piped, Action.REMOVE_ROW, 1))
        // The last row takes the newline before it.
        assertEquals("| A | B |\n|---|---|\n| 1 | 2 |", run(piped, Action.REMOVE_ROW, 2))
        // The only body row can go: header + alignment row is a table.
        assertEquals("| A |\n|---|", run("| A |\n|---|\n| 1 |", Action.REMOVE_ROW, 1))
    }

    @Test
    fun rowAndColumnOutsideTheTableAreRefused() {
        assertNull(run(piped, Action.REMOVE_ROW, 3))
        assertNull(run(piped, Action.REMOVE_ROW, -1))
        assertNull(run(piped, Action.INSERT_COLUMN_LEFT, 0, 2))
        assertNull(run(piped, Action.ALIGN_LEFT, 0, -1))
    }

    // Columns

    @Test
    fun insertColumn() {
        assertEquals("|  | A | B |\n| --- |---|---|\n|  | 1 | 2 |\n|  | 3 | 4 |", run(piped, Action.INSERT_COLUMN_LEFT, 1, 0))
        assertEquals("| A |  | B |\n|---| --- |---|\n| 1 |  | 2 |\n| 3 |  | 4 |", run(piped, Action.INSERT_COLUMN_RIGHT, 0, 0))
        assertEquals("| A | B |  |\n|---|---| --- |\n| 1 | 2 |  |\n| 3 | 4 |  |", run(piped, Action.INSERT_COLUMN_RIGHT, 2, 1))
    }

    @Test
    fun insertColumnKeepsOtherCellsAndGivesOneEditPerLine() {
        val text = before + piped + after
        val edits = TableEdit.edits(text, before.length, before.length + piped.length, Action.INSERT_COLUMN_RIGHT, 0, 0)!!
        assertEquals(4, edits.size)
        assertTrue(edits.all { it.from == it.to })
    }

    @Test
    fun shortRowsGetNoCellAfterTheirEnd() {
        val table = "| A | B | C |\n|---|---|---|\n| 1 |"
        assertEquals("| A | B | C |  |\n|---|---|---| --- |\n| 1 |", run(table, Action.INSERT_COLUMN_RIGHT, 0, 2))
        assertEquals("| A |  | B | C |\n|---| --- |---|---|\n| 1 |  |", run(table, Action.INSERT_COLUMN_RIGHT, 0, 0))
    }

    @Test
    fun removeColumn() {
        assertEquals("| B |\n|---|\n| 2 |\n| 4 |", run(piped, Action.REMOVE_COLUMN, 0, 0))
        assertEquals("| A |\n|---|\n| 1 |\n| 3 |", run(piped, Action.REMOVE_COLUMN, 2, 1))
    }

    @Test
    fun theOnlyColumnIsNotRemoved() {
        assertNull(run("| A |\n|---|\n| 1 |", Action.REMOVE_COLUMN, 0, 0))
    }

    @Test
    fun removeColumnOfAShortRowKeepsATableRow() {
        val table = "| A | B |\n|---|---|\n| 1 |"
        assertEquals("| B |\n|---|\n|  |", run(table, Action.REMOVE_COLUMN, 0, 0))
        assertEquals("| A |\n|---|\n| 1 |", run(table, Action.REMOVE_COLUMN, 0, 1))
    }

    // No outer pipes (corpus styles/tables.md, second table)

    private val bare = "Name | Value\n--- | ---\nno pipes | at edges"

    @Test
    fun bareTableRows() {
        assertEquals("Name | Value\n--- | ---\n | \nno pipes | at edges", run(bare, Action.INSERT_ROW_BELOW, 0))
        assertEquals("Name | Value\n--- | ---", run(bare, Action.REMOVE_ROW, 1))
        // An empty row of a bare table is still a row with empty cells.
        assertEquals(listOf(listOf("")), cells(run(bare, Action.INSERT_ROW_BELOW, 0)!!).subList(2, 3))
    }

    @Test
    fun bareTableInteriorColumnKeepsTheStyle() {
        assertEquals("Name |  | Value\n--- | --- | ---\nno pipes |  | at edges", run(bare, Action.INSERT_COLUMN_RIGHT, 0, 0))
    }

    @Test
    fun bareTableEdgeColumnsAddTheNeededPipe() {
        // An empty first cell without a leading pipe would shift the cells: the leading pipe is added.
        val left = run(bare, Action.INSERT_COLUMN_LEFT, 0, 0)!!
        assertEquals("|  | Name | Value\n| --- | --- | ---\n|  | no pipes | at edges", left)
        assertEquals(listOf("", "Name", "Value"), cells(left)[0])
        // An empty last header cell would be read as a trailing pipe: the trailing pipe is added.
        val right = run(bare, Action.INSERT_COLUMN_RIGHT, 0, 1)!!
        assertEquals("Name | Value |  |\n--- | --- | --- |\nno pipes | at edges |  |", right)
        assertEquals(listOf("Name", "Value", ""), cells(right)[0])
    }

    @Test
    fun bareTableDownToOneColumnGetsBothPipes() {
        val one = run(bare, Action.REMOVE_COLUMN, 0, 1)!!
        assertEquals("| Name |\n| --- |\n| no pipes |", one)
        assertEquals(listOf(listOf("Name"), listOf("---"), listOf("no pipes")), cells(one))
        assertEquals("| Value |\n| --- |\n| at edges |", run(bare, Action.REMOVE_COLUMN, 0, 0))
    }

    @Test
    fun leadingPipeOnly() {
        val table = "| A | B\n|---|---\n| 1 | 2"
        val right = run(table, Action.INSERT_COLUMN_RIGHT, 0, 1)!!
        assertEquals("| A | B |  |\n|---|--- | --- |\n| 1 | 2 |  |", right)
        assertEquals(listOf("A", "B", ""), cells(right)[0])
    }

    // Escapes and code spans

    @Test
    fun onlyEscapedPipesStayInTheCell() {
        // GFM spec "Tables (extension)": a pipe inside a code span splits the cell unless it is escaped.
        val table = "| f\\|oo  |\n| ------ |\n| `\\|` |\n| `a|b` |"
        assertEquals(listOf(listOf("f\\|oo"), listOf("------"), listOf("`\\|`"), listOf("`a", "b`")), cells(table))
        assertEquals(
            "| f\\|oo  |  |\n| ------ | --- |\n| `\\|` |  |\n| `a|  |b` |",
            run(table, Action.INSERT_COLUMN_RIGHT, 0, 0),
        )
    }

    @Test
    fun separatorPipes() {
        assertEquals(listOf(4), TableEdit.separatorPipes("a\\|b|c"))
        assertEquals(listOf(2), TableEdit.separatorPipes("`a|b`"))
        assertEquals(listOf(4), TableEdit.separatorPipes("`\\|`|"))
    }

    // Alignment

    @Test
    fun alignKeepsTheCellWidth() {
        assertEquals("| A | B |\n|:--|---|\n| 1 | 2 |\n| 3 | 4 |", run(piped, Action.ALIGN_LEFT, 0, 0))
        assertEquals("| A | B |\n|---|:-:|\n| 1 | 2 |\n| 3 | 4 |", run(piped, Action.ALIGN_CENTER, 2, 1))
        assertEquals("| A | B |\n|--:|---|\n| 1 | 2 |\n| 3 | 4 |", run(piped, Action.ALIGN_RIGHT, 1, 0))
        val wide = "| A |\n| :--------: |"
        assertEquals("| A |\n| ---------- |", run(wide, Action.ALIGN_NONE))
        assertEquals("| A |\n| :--------- |", run(wide, Action.ALIGN_LEFT))
        assertEquals("| A |\n| ---------: |", run(wide, Action.ALIGN_RIGHT))
    }

    @Test
    fun alignShortCellsKeepADash() {
        assertEquals("| A |\n|:-:|", run("| A |\n|-|", Action.ALIGN_CENTER))
        assertEquals("| A |\n|:-|", run("| A |\n|-|", Action.ALIGN_LEFT))
        assertEquals("| A |\n|---|", run("| A |\n|:-:|", Action.ALIGN_NONE))
    }

    @Test
    fun alignIsOneEditOnTheAlignmentRow() {
        val text = before + piped + after
        val edits = TableEdit.edits(text, before.length, before.length + piped.length, Action.ALIGN_RIGHT, 0, 1)!!
        val e = edits.single()
        assertEquals("|---|--:|", TableEdit.apply(text, edits).lines()[3])
        assertEquals(1, e.to - e.from)
    }

    @Test
    fun sameAlignmentGivesNoEdit() {
        val text = before + piped + after
        assertEquals(emptyList<TableEdit.Edit>(), TableEdit.edits(text, before.length, before.length + piped.length, Action.ALIGN_NONE, 0, 0))
    }

    // Reformat

    @Test
    fun reformatCorpusTable() {
        val table = "| Left | Center | Right | None |\n|:-----|:------:|------:|------|\n| a    |   b    |     c | d    |\n| long cell text | x | 1.5 | |"
        assertEquals(
            "| Left           | Center | Right | None |\n" +
                "| :------------- | :----: | ----: | ---- |\n" +
                "| a              |   b    |     c | d    |\n" +
                "| long cell text |   x    |   1.5 |      |",
            run(table, Action.REFORMAT),
        )
    }

    @Test
    fun reformatBareTableKeepsNoPipes() {
        assertEquals("Name     | Value\n-------- | --------\nno pipes | at edges", run(bare, Action.REFORMAT))
    }

    @Test
    fun reformatIsIdempotent() {
        val once = run(piped, Action.REFORMAT)!!
        assertEquals(once, run(once, Action.REFORMAT))
        assertEquals("| A   | B   |\n| --- | --- |\n| 1   | 2   |\n| 3   | 4   |", once)
    }

    @Test
    fun reformatFillsShortRowsAndKeepsExtraCells() {
        val table = "| A | B |\n|---|---|\n| 1 |\n| 1 | 2 | extra |"
        assertEquals("| A   | B   |\n| --- | --- |\n| 1   |     |\n| 1   | 2   | extra |", run(table, Action.REFORMAT))
    }

    @Test
    fun reformatUsesDisplayWidth() {
        val table = "| 名前 | x |\n|---|---|\n| ab | 😀 |\n| é | y |"
        assertEquals(
            "| 名前 | x   |\n| ---- | --- |\n| ab   | 😀  |\n| é    | y   |",
            run(table, Action.REFORMAT),
        )
    }

    @Test
    fun reformatKeepsEscapesAndCode() {
        val table = "|a|b|\n|-|-|\n|`x\\|y`|\\||"
        assertEquals("| a      | b   |\n| ------ | --- |\n| `x\\|y` | \\|  |", run(table, Action.REFORMAT))
    }

    @Test
    fun reformatEmptyFirstCellOfBareTableAddsTheLeadingPipe() {
        val table = "A | B\n--- | ---\n | 2"
        // " | 2" has a leading pipe in GFM: its cells are ["2"]. The line keeps its prefix " ".
        assertEquals(listOf("2"), cells(table)[2])
        assertEquals("A   | B\n--- | ---\n 2   |", run(table, Action.REFORMAT))
    }

    // Prefixes

    @Test
    fun indentedAndQuotedTablesKeepTheirPrefix() {
        assertEquals("  | A | B |\n  |---|---|\n  |  |  |\n  | 1 | 2 |", run("  | A | B |\n  |---|---|\n  | 1 | 2 |", Action.INSERT_ROW_BELOW, 0))
        val quoted = "> | A | B |\n> |---|---|\n> | 1 | 2 |"
        assertEquals("> | A | B |\n> |---|---|\n> | 1 | 2 |\n> |  |  |", run(quoted, Action.INSERT_ROW_BELOW, 1))
        assertEquals("> | A |  | B |\n> |---| --- |---|\n> | 1 |  | 2 |", run(quoted, Action.INSERT_COLUMN_RIGHT, 0, 0))
        assertEquals("> | A   | B   |\n> | --- | --- |\n> | 1   | 2   |", run(quoted, Action.REFORMAT))
    }

    @Test
    fun tableOnAListMarkerLineKeepsEachLinePrefix() {
        val bullet = "- | A | B |\n  |---|---|\n  | 1 | 2 |"
        val text = before + bullet + after
        val from = before.length + 2
        val table = TableEdit.parse(text, from, before.length + bullet.length)!!
        assertEquals(listOf("- ", "  ", "  "), table.rows.map { it.prefix })
        assertEquals(listOf(listOf("A", "B"), listOf("---", "---"), listOf("1", "2")), table.rows.map { r -> r.cells.map { it.trim() } })
        fun runAt(source: String, prefix: Int, action: Action, row: Int = 0, column: Int = 0): String {
            val t = before + source + after
            val result = TableEdit.apply(t, TableEdit.edits(t, before.length + prefix, before.length + source.length, action, row, column)!!)
            return result.substring(before.length, result.length - after.length)
        }
        assertEquals("- | A | B |\n  |---|---|\n  |  |  |\n  | 1 | 2 |", runAt(bullet, 2, Action.INSERT_ROW_BELOW))
        assertEquals("- | A   | B   |\n  | --- | --- |\n  | 1   | 2   |", runAt(bullet, 2, Action.REFORMAT))
        assertEquals("- | B |\n  |---|\n  | 2 |", runAt(bullet, 2, Action.REMOVE_COLUMN))
        val ordered = "1. | A |\n   |:-|\n   | 1 |"
        assertEquals("1. | A   |\n   | :-- |\n   | 1   |", runAt(ordered, 3, Action.REFORMAT))
        val nested = "> - | A |\n>   |---|\n>   | 1 |"
        assertEquals("> - | A |\n>   |---|\n>   | 1 |\n>   |  |", runAt(nested, 4, Action.INSERT_ROW_BELOW, 1))
        assertNull("prose before the table", TableEdit.parse("x | A |\n|---|", 2, 13))
    }

    @Test
    fun bodyRowsNeedNoPipeAndLazyRowsSplitTheSameWay() {
        // GFM/Lezer: after the header and alignment rows every non-blank line is a row.
        val source = "| A | B |\n|---|---|\ntext\nx | y"
        val table = TableEdit.parse(source, 0, source.length)!!
        assertEquals(listOf(listOf("A", "B"), listOf("---", "---"), listOf("text"), listOf("x", "y")), table.rows.map { r -> r.cells.map { it.trim() } })
        assertEquals("| A    | B   |\n| ---- | --- |\n| text |     |\n| x    | y   |",
            TableEdit.apply(source, TableEdit.edits(source, 0, source.length, Action.REFORMAT, 0, 0)!!))
        // A lazy line of a blockquote table: no "> " prefix.
        val quoted = "> | A | B |\n> |---|---|\n| 1 | 2 |"
        val lazy = TableEdit.parse(quoted, 2, quoted.length)!!
        assertEquals(listOf("> ", "> ", ""), lazy.rows.map { it.prefix })
        assertEquals(listOf("1", "2"), lazy.rows[2].cells.map { it.trim() })
        assertEquals("> | A | B |\n> |---|---|\n| 1 | 2 |\n|  |  |",
            TableEdit.apply(quoted, TableEdit.edits(quoted, 2, quoted.length, Action.INSERT_ROW_BELOW, 1, 0)!!))
    }

    @Test
    fun isAllowedMatchesEdits() {
        val text = before + piped + after
        val table = TableEdit.parse(text, before.length, before.length + piped.length)!!
        for (action in Action.entries) for (row in -1..4) for (column in -1..3) {
            val edits = TableEdit.edits(table, action, row, column)
            assertEquals("$action $row $column", edits != null, TableEdit.isAllowed(table, action, row, column))
        }
        assertTrue("reformat needs only the table", TableEdit.isAllowed(table, Action.REFORMAT, 99, 99))
    }

    // Range validation

    @Test
    fun rangeMustBeATable() {
        val text = before + piped + after
        val from = before.length
        val to = before.length + piped.length
        assertNotNull(TableEdit.parse(text, from, to))
        // The page range may stop before trailing spaces of the last line.
        assertNotNull(TableEdit.parse("| A |\n|---|  \n", 0, 11))
        assertNull("not at a line start", TableEdit.parse(text, from + 1, to))
        assertNull("ends inside a line", TableEdit.parse(text, from, to - 1))
        assertNull("one line", TableEdit.parse(text, from, from + 9))
        assertNull("prose before", TableEdit.parse(text, 0, to))
        assertNull("into the next paragraph", TableEdit.parse(text, from, text.length - 1))
        assertNull("empty", TableEdit.parse(text, from, from))
        assertNull("outside", TableEdit.parse(text, from, text.length + 1))
        assertNull("cell count", TableEdit.parse("| A | B |\n|---|", 0, 15))
        assertNull("alignment row", TableEdit.parse("| A |\n| x |", 0, 11))
        assertNull("setext heading", TableEdit.parse("A\n---", 0, 5))
        assertNull("blank body row", TableEdit.parse("> | A |\n> |---|\n>  ", 0, 19))
        assertNull(TableEdit.edits(text, from + 1, to, Action.REFORMAT, 0, 0))
    }

    @Test
    fun parseRowRoundTrips() {
        for (line in listOf(
            "| a | b |", "a | b", "| a | b", "a | b |", "|a|b|", "  | a |  ", "> | x |", "| `a|b` | \\| |", "|", "||", "| a | b |\t",
            "a\\|b | c", "``x`` | y", "",
        )) {
            assertEquals(line, TableEdit.parseRow(line).render())
        }
    }

    // Corpus

    @Test
    fun corpusTablesSurviveEveryAction() {
        val corpus = Path.of("src/test/resources/corpus")
        val files = Files.walk(corpus).use { s -> s.filter { it.toString().endsWith(".md") }.toList() }
        val seen = HashSet<String>()
        var tables = 0
        for (file in files) {
            val text = Files.readString(file).replace("\r\n", "\n")
            for ((start, end) in findTables(text)) {
                // Each table alone (the big corpus files repeat the same tables).
                val lineStart = text.lastIndexOf('\n', start - 1) + 1
                val source = text.substring(lineStart, end)
                if (!seen.add(source)) continue
                val from = start - lineStart
                val to = source.length
                val table = TableEdit.parse(source, from, to) ?: continue
                tables++
                for (action in Action.entries) {
                    for (row in 0 until minOf(table.rowCount, 3)) {
                        for (column in 0 until minOf(table.columns, 3)) {
                            val edits = TableEdit.edits(source, from, to, action, row, column) ?: continue
                            checkEdits(edits)
                            val result = TableEdit.apply(source, edits)
                            val newTable = TableEdit.parse(result, from, result.length)
                            assertNotNull("$file $action $row $column:\n$result", newTable)
                            val n = table.columns + when (action) {
                                Action.INSERT_COLUMN_LEFT, Action.INSERT_COLUMN_RIGHT -> 1
                                Action.REMOVE_COLUMN -> -1
                                else -> 0
                            }
                            assertEquals("$file $action", n, newTable!!.columns)
                            val rows = table.rowCount + when (action) {
                                Action.INSERT_ROW_ABOVE, Action.INSERT_ROW_BELOW -> 1
                                Action.REMOVE_ROW -> -1
                                else -> 0
                            }
                            assertEquals("$file $action", rows, newTable.rowCount)
                        }
                    }
                }
            }
        }
        assertTrue("corpus has tables: $tables", tables >= 3)
    }

    /** Header lines followed by an alignment row; the table ends at the first blank line. */
    private fun findTables(text: String): List<Pair<Int, Int>> {
        val lines = text.split('\n')
        val starts = IntArray(lines.size)
        for (i in 1 until lines.size) starts[i] = starts[i - 1] + lines[i - 1].length + 1
        val result = ArrayList<Pair<Int, Int>>()
        var i = 0
        while (i + 1 < lines.size) {
            if ('|' in lines[i] && Regex("^[ >]*\\|?\\s*:?-+:?\\s*(\\|\\s*:?-+:?\\s*)*\\|?\\s*$").matches(lines[i + 1]) && '|' in lines[i + 1]) {
                var j = i + 2
                while (j < lines.size && lines[j].isNotBlank() && '|' in lines[j]) j++
                val prefix = lines[i].takeWhile { it == ' ' || it == '>' }.length
                result += (starts[i] + prefix) to (starts[j - 1] + lines[j - 1].length)
                i = j
            } else {
                i++
            }
        }
        return result
    }

    // Display width

    @Test
    fun displayWidth() {
        assertEquals(0, TableEdit.displayWidth(""))
        assertEquals(5, TableEdit.displayWidth("hello"))
        assertEquals(4, TableEdit.displayWidth("名前"))
        assertEquals(4, TableEdit.displayWidth("한국"))
        assertEquals(2, TableEdit.displayWidth("ＡＢ".substring(0, 1)))
        assertEquals(2, TableEdit.displayWidth("😀"))
        // Combining accent: one column.
        assertEquals(1, TableEdit.displayWidth("é"))
        // ZWJ family and flag: one cluster each, two columns.
        assertEquals(2, TableEdit.displayWidth("👨‍👩‍👧"))
        assertEquals(2, TableEdit.displayWidth("🇫🇷"))
        // Emoji presentation selector.
        assertEquals(2, TableEdit.displayWidth("❤️"))
        assertEquals(1, TableEdit.displayWidth("❤"))
        assertEquals(0, TableEdit.displayWidth("​"))
    }
}
