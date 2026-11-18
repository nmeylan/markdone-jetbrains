package ch.nmeylan.markdone.sync

import com.intellij.openapi.Disposable
import com.intellij.openapi.editor.Document
import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.editor.event.DocumentListener

/**
 * The version counter of one document (protocol/PROTOCOL.md "Versions"): 0 when it is made, +1 for
 * every `DocumentEvent`, never back (unlike `Document.modificationStamp`, which undo restores).
 * It counts in `beforeDocumentChange`, so every `documentChanged` listener already sees the new value,
 * whatever the listener order. It changes only inside a write action: read it with the text under a read action.
 */
class DocVersion(document: Document) : Disposable {
    @Volatile
    var value = 0L
        private set

    init {
        document.addDocumentListener(object : DocumentListener {
            override fun beforeDocumentChange(event: DocumentEvent) {
                value++
            }
        }, this)
    }

    override fun dispose() = Unit
}
