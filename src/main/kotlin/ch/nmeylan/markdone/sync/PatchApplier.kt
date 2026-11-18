package ch.nmeylan.markdone.sync

import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.editor.Document
import com.intellij.openapi.project.Project

/** Checks, maps and applies page patches. */
object PatchApplier {

    /**
     * Whether [patches] are sorted by start, do not overlap, lie in a text of [length] chars and use
     * `\n` line ends only. Two edits at the same start are refused: their order is not defined.
     */
    fun isValid(patches: List<TextPatch>, length: Int): Boolean {
        for ((i, p) in patches.withIndex()) {
            if (p.start < 0 || p.end < p.start || p.end > length || '\r' in p.text) return false
            if (i > 0) {
                val prev = patches[i - 1]
                if (prev.end > p.start || prev.start >= p.start) return false
            }
        }
        return true
    }

    /** The length of the text before [events]: [currentLength] minus their size changes. */
    fun lengthBefore(currentLength: Int, events: List<EventLog.Entry>): Int =
        currentLength - events.sumOf { it.newText.length - it.oldLength }

    /**
     * Moves [patches] (relative to the text before [events]) over [events], or `null` when an event
     * touches a patch range (or inserts at the same point as an insertion patch).
     */
    fun map(patches: List<TextPatch>, events: List<EventLog.Entry>): List<TextPatch>? {
        var current = patches
        for (e in events) {
            val delta = e.newText.length - e.oldLength
            val eventEnd = e.offset + e.oldLength
            current = current.map { p ->
                when {
                    e.oldLength == 0 && e.offset == p.start && p.start == p.end -> return null
                    eventEnd <= p.start -> p.copy(start = p.start + delta, end = p.end + delta)
                    e.offset >= p.end -> p
                    else -> return null
                }
            }
        }
        return current
    }

    /**
     * Applies valid [patches] in descending order inside one write command. Commands with the same
     * [groupId] merge into one undo step. The command is not recorded for the active editor's document.
     */
    fun apply(project: Project?, document: Document, patches: List<TextPatch>, groupId: String?) {
        if (patches.isEmpty()) return
        WriteCommandAction.writeCommandAction(project)
            .withName("Typing")
            .withGroupId(groupId)
            .shouldRecordActionForActiveDocument(false)
            .run<RuntimeException> {
                for (p in patches.asReversed()) document.replaceString(p.start, p.end, p.text)
            }
    }
}
