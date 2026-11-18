package ch.nmeylan.markdone.jcef

import java.nio.file.Path

/**
 * The `.drawio` files that one page loaded through `/drawio/` (nmey/DRAWIO.md §5.5): per docId, the path as the page
 * wrote it (decoded) and the real file it resolved to, at most [max] per document (the oldest go first).
 * Written on pooled threads by the resource handler, read on the EDT.
 */
internal class DrawioServed(private val max: Int = MAX_PER_DOCUMENT) {
    private val byDoc = HashMap<String, LinkedHashMap<String, Path>>()

    @Synchronized
    fun add(docId: String, path: String, file: Path) {
        val served = byDoc.getOrPut(docId) { LinkedHashMap() }
        served.remove(path)
        served[path] = file
        while (served.size > max) served.remove(served.keys.first())
    }

    /** The paths of [docId] that resolved to [file]. */
    @Synchronized
    fun pathsFor(docId: String, file: Path): List<String> = byDoc[docId]?.filterValues { it == file }?.keys?.toList().orEmpty()

    @Synchronized
    fun forget(docId: String) {
        byDoc.remove(docId)
    }

    @Synchronized
    fun clear() = byDoc.clear()

    companion object {
        const val MAX_PER_DOCUMENT = 256
    }
}
