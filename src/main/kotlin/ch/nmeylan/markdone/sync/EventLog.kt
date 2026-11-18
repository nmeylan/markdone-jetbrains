package ch.nmeylan.markdone.sync

import com.intellij.openapi.editor.event.DocumentEvent

/**
 * The `DocumentEvent`s of one document, in order, with the versions ([DocVersion]) before and after
 * each one. Used to send `change` messages and to map a patch made at an older stamp.
 * When it is larger than [MAX_ENTRIES] or [MAX_CHARS], the oldest entries go; a lookup that needs them
 * then fails and the caller reloads the page.
 */
class EventLog {
    /** One event: [oldLength] chars at [offset] were replaced by [newText]. */
    data class Entry(val oldStamp: Long, val newStamp: Long, val offset: Int, val oldLength: Int, val newText: String)

    private val entries = ArrayDeque<Entry>()
    private var chars = 0L

    val size: Int
        get() = entries.size

    /** Adds [event], which made the document version [version]. */
    fun add(event: DocumentEvent, version: Long) {
        add(Entry(version - 1, version, event.offset, event.oldLength, event.newFragment.toString()))
    }

    fun add(entry: Entry) {
        entries.addLast(entry)
        chars += entry.newText.length
        while (entries.size > MAX_ENTRIES || chars > MAX_CHARS) removeFirst()
    }

    fun clear() {
        entries.clear()
        chars = 0
    }

    /**
     * The entries that lead from [stamp] to [current], in order. Empty when the stamps are equal;
     * `null` when the log does not hold an unbroken chain from [stamp] to [current].
     */
    fun since(stamp: Long, current: Long): List<Entry>? {
        if (stamp == current) return emptyList()
        val start = entries.indexOfLast { it.oldStamp == stamp }
        if (start < 0) return null
        val result = entries.subList(start, entries.size)
        for (i in 1 until result.size) if (result[i].oldStamp != result[i - 1].newStamp) return null
        return if (result.last().newStamp == current) result.toList() else null
    }

    /** Drops the entries that end at or before [stamp] (versions only increase). */
    fun dropBefore(stamp: Long) {
        while (entries.isNotEmpty() && entries.first().newStamp <= stamp) removeFirst()
    }

    private fun removeFirst() {
        chars -= entries.removeFirst().newText.length
    }

    companion object {
        const val MAX_ENTRIES = 5_000
        const val MAX_CHARS = 4L * 1024 * 1024
    }
}
