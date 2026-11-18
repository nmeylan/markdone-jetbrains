package ch.nmeylan.markdone.actions

import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Path

/**
 * L3 cross-check: [TableEdit.parse] reads every table of the corpus as Lezer does. The models come from
 * the page side (`src/test/resources/table-models.json`, generated from the Lezer tree): rows header first
 * without the alignment row, each with the header's cell count, cell text = trimmed raw source, and the
 * column alignments.
 */
class TableModelsCrossCheckTest {
    private val corpus = Path.of("src/test/resources/corpus")
    private val models = Path.of("src/test/resources/table-models.json")

    @Test
    fun tableEditReadsEveryCorpusTableAsLezer() {
        assertTrue("$models is missing", Files.exists(models))
        val entries = JsonParser.parseString(Files.readString(models)).asJsonArray
        assertTrue("no table models", entries.size() > 0)
        val texts = HashMap<String, String>()
        val problems = ArrayList<String>()
        for (element in entries) {
            val entry = element.asJsonObject
            val file = entry["file"].asString
            val from = entry["from"].asInt
            val to = entry["to"].asInt
            // CodeMirror (and so Lezer) uses "\n" line ends.
            val text = texts.getOrPut(file) {
                val path = corpus.resolve(file).takeIf { Files.exists(it) } ?: Path.of(file)
                Files.readString(path).replace("\r\n", "\n")
            }
            val expectedRows = entry["rows"].asJsonArray.map { row -> row.asJsonArray.map { it.asString } }
            val expectedAligns = entry["aligns"].asJsonArray.map { if (it.isJsonNull) "none" else it.asString.lowercase() }
            val label = "$file $from..$to"
            val table = TableEdit.parse(text, from, to)
            if (table == null) {
                problems += "$label: not a table"
                continue
            }
            // GFM table model: a short row gets empty cells, cells after the header width are not part of the table.
            val rows = table.rows.filterIndexed { i, _ -> i != 1 }
                .map { r -> List(table.columns) { j -> r.cells.getOrNull(j)?.trim() ?: "" } }
            if (rows != expectedRows) problems += "$label: rows $rows, Lezer $expectedRows"
            val aligns = table.alignments.map { it.name.lowercase() }
            if (aligns != expectedAligns) problems += "$label: aligns $aligns, Lezer $expectedAligns"
        }
        assertEquals("${entries.size()} tables; differences:\n" + problems.joinToString("\n"), emptyList<String>(), problems)
    }
}
