package ch.nmeylan.markdone.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PageMessagesTest {
    private val id = "0123456789abcdef0123456789abcdef"

    @Test
    fun lifecycleMessages() {
        assertEquals(PageMessage.Ready(2), PageMessages.parse("ready", """{"type":"ready","protocol":2}"""))
        assertEquals(PageMessage.Opened(id, 42), PageMessages.parse("ready", """{"type":"opened","docId":"$id","docStamp":42}"""))
        assertEquals(PageMessage.Activated(id), PageMessages.parse("ready", """{"type":"activated","docId":"$id"}"""))
        assertEquals(PageMessage.LoadError(id, "stamp"), PageMessages.parse("ready", """{"type":"loadError","docId":"$id","reason":"stamp"}"""))
        assertEquals(
            PageMessage.Diverged(id, 10, 12),
            PageMessages.parse("ready", """{"type":"diverged","docId":"$id","pageLength":10,"expectedLength":12}"""),
        )
    }

    @Test
    fun invalidDiverged() {
        fun d(body: String) = PageMessages.parse("ready", """{"type":"diverged","docId":"$id",$body}""")
        assertNull(d(""""pageLength":10"""))
        assertNull(d(""""pageLength":-1,"expectedLength":2"""))
        assertNull(d(""""pageLength":1.5,"expectedLength":2"""))
        assertNull(d(""""pageLength":"1","expectedLength":2"""))
        assertNull(d(""""pageLength":1,"expectedLength":2,"extra":0"""))
        assertNull(PageMessages.parse("command", """{"type":"diverged","docId":"$id","pageLength":1,"expectedLength":2}"""))
    }

    @Test
    fun invalidLifecycleMessages() {
        assertNull(PageMessages.parse("ready", """{"type":"ready","protocol":1}"""))
        assertNull(PageMessages.parse("ready", """{"type":"ready","protocol":2,"docStamp":1}"""))
        assertNull(PageMessages.parse("ready", """{"type":"opened","docId":"$id"}"""))
        assertNull(PageMessages.parse("ready", """{"type":"opened","docId":"$id","docStamp":1.5}"""))
        assertNull(PageMessages.parse("ready", """{"type":"opened","docId":"$id","docStamp":"1"}"""))
        assertNull(PageMessages.parse("ready", """{"type":"loadError","docId":"$id","reason":"other"}"""))
        assertNull(PageMessages.parse("ready", """{"type":"activated","docId":"$id","extra":true}"""))
        // A lifecycle type on another channel.
        assertNull(PageMessages.parse("command", """{"type":"opened","docId":"$id","docStamp":1}"""))
    }

    /** Protocol 2.4: exact keys, offsets ≥ 0, `ready` channel only, at most 4 KB. */
    @Test
    fun viewport() {
        fun v(body: String, channel: String = "ready") = PageMessages.parse(channel, """{"type":"viewport","docId":"$id",$body}""")
        assertEquals(PageMessage.Viewport(id, 120, 5, 3), v(""""top":120,"anchor":5,"head":3"""))
        assertEquals(PageMessage.Viewport(id, 0, 0, 0), v(""""head":0,"top":0,"anchor":0"""))
        assertNull(v(""""top":120,"anchor":5"""))
        assertNull(v(""""top":120,"anchor":5,"head":3,"extra":0"""))
        assertNull(v(""""top":-1,"anchor":5,"head":3"""))
        assertNull(v(""""top":1.5,"anchor":5,"head":3"""))
        assertNull(v(""""top":"1","anchor":5,"head":3"""))
        assertNull(v(""""top":1,"anchor":null,"head":3"""))
        assertNull(v(""""top":1,"anchor":5,"head":3000000000"""))
        assertNull(v(""""top":1,"anchor":5,"head":3""", "command"))
        assertNull(v(""""top":1,"anchor":5,"head":3""", "patch"))
        assertNull(v(""""top":1,"anchor":5,"head":3""" + " ".repeat(PageMessages.MAX_OTHER_BYTES)))
    }

    @Test
    fun docIdMustBe32LowercaseHex() {
        for (bad in listOf("0123", "0123456789ABCDEF0123456789ABCDEF", "0123456789abcdef0123456789abcdeg", "../x", "")) {
            assertNull(bad, PageMessages.parse("ready", """{"type":"activated","docId":"$bad"}"""))
        }
        assertNull(PageMessages.parse("ready", """{"type":"activated","docId":1}"""))
    }

    @Test
    fun validPatch() {
        assertEquals(
            PageMessage.Patch(id, 3, 7, listOf(TextPatch(0, 2, "ab"))),
            PageMessages.parse("patch", """{"type":"patch","docId":"$id","seq":3,"baseStamp":7,"patches":[{"start":0,"end":2,"text":"ab"}]}"""),
        )
        assertEquals(
            PageMessage.Patch(id, 4, 7, emptyList()),
            PageMessages.parse("patch", """{"type":"patch","docId":"$id","seq":4,"baseStamp":7,"patches":[]}"""),
        )
    }

    @Test
    fun patchWithBadFields() {
        fun p(body: String) = PageMessages.parse("patch", """{"type":"patch","docId":"$id",$body}""")
        assertNull(p(""""seq":1,"baseStamp":7,"patches":[{"start":-1,"end":2,"text":""}]"""))
        assertNull(p(""""seq":1,"baseStamp":7,"patches":[{"start":5,"end":2,"text":""}]"""))
        assertNull(p(""""seq":1,"baseStamp":7,"patches":[{"start":0,"end":3000000000,"text":""}]"""))
        assertNull(p(""""seq":-1,"baseStamp":7,"patches":[]"""))
        assertNull(p(""""seq":1,"baseStamp":7,"patches":[{"start":0,"end":1}]"""))
        assertNull(p(""""seq":1,"baseStamp":7,"patches":[{"start":0,"end":1,"text":"a","x":1}]"""))
        assertNull(p(""""seq":1,"baseStamp":7,"patches":{}"""))
        assertNull(p(""""seq":1,"patches":[]"""))
        assertNull(PageMessages.parse("patch", """{"type":"patch","seq":1,"baseStamp":7,"patches":[]}"""))
    }

    @Test
    fun validLink() {
        assertEquals(
            PageMessage.Link(id, "https://example.com", LinkKind.EXTERNAL),
            PageMessages.parse("link", """{"type":"link","docId":"$id","href":"https://example.com","kind":"external"}"""),
        )
        assertEquals(PageMessage.Link(id, "a.md", LinkKind.RELATIVE), PageMessages.parse("link", """{"type":"link","docId":"$id","href":"a.md","kind":"relative"}"""))
        assertEquals(PageMessage.Link(id, "#x", LinkKind.ANCHOR), PageMessages.parse("link", """{"type":"link","docId":"$id","href":"#x","kind":"anchor"}"""))
    }

    @Test
    fun invalidLink() {
        assertNull(PageMessages.parse("link", """{"type":"link","docId":"$id","href":"a.md","kind":"file"}"""))
        assertNull(PageMessages.parse("link", """{"type":"link","docId":"$id","href":"","kind":"relative"}"""))
        assertNull(PageMessages.parse("link", """{"type":"link","docId":"$id","href":1,"kind":"relative"}"""))
        assertNull(PageMessages.parse("link", """{"type":"link","href":"a.md","kind":"relative"}"""))
    }

    @Test
    fun simpleCommands() {
        for (name in listOf("toggleMode", "find", "undo", "redo")) {
            assertEquals(PageMessage.Command(id, name), PageMessages.parse("command", """{"type":"command","docId":"$id","name":"$name"}"""))
        }
        assertNull(PageMessages.parse("command", """{"type":"command","docId":"$id","name":"exec"}"""))
        assertNull(PageMessages.parse("command", """{"type":"command","docId":"$id","name":"undo","from":1}"""))
        assertNull(PageMessages.parse("command", """{"type":"command","name":"undo"}"""))
    }

    /** Protocol 2.3: zoom requests have no other key; other names and spellings are refused. */
    @Test
    fun zoomCommands() {
        for (name in listOf("zoomIn", "zoomOut", "zoomReset")) {
            assertEquals(PageMessage.Command(id, name), PageMessages.parse("command", """{"type":"command","docId":"$id","name":"$name"}"""))
            assertNull(PageMessages.parse("command", """{"type":"command","docId":"$id","name":"$name","step":1}"""))
            assertNull(PageMessages.parse("ready", """{"type":"command","docId":"$id","name":"$name"}"""))
        }
        for (name in listOf("zoom", "zoomin", "ZoomIn", "zoomSet", "zoomIn ")) {
            assertNull(name, PageMessages.parse("command", """{"type":"command","docId":"$id","name":"$name"}"""))
        }
    }

    @Test
    fun contextMenu() {
        assertEquals(
            PageMessage.ContextMenu(id, 10.5, 20.0, 3, 7),
            PageMessages.parse("command", """{"type":"command","docId":"$id","name":"contextMenu","x":10.5,"y":20,"from":3,"to":7}"""),
        )
        fun cm(body: String) = PageMessages.parse("command", """{"type":"command","docId":"$id","name":"contextMenu",$body}""")
        assertNull(cm(""""x":1,"y":2,"from":7,"to":3"""))
        assertNull(cm(""""x":1,"y":2,"from":-1,"to":3"""))
        assertNull(cm(""""x":1,"y":2,"from":1.5,"to":3"""))
        assertNull(cm(""""x":"1","y":2,"from":1,"to":3"""))
        assertNull(cm(""""x":1e300,"y":2,"from":1,"to":3"""))
        assertNull(cm(""""x":1,"y":2,"from":1"""))
        assertNull(cm(""""x":1,"y":2,"from":1,"to":3,"extra":0"""))
    }

    @Test
    fun contextMenuWithTable() {
        fun cm(table: String) =
            PageMessages.parse("command", """{"type":"command","docId":"$id","name":"contextMenu","x":1,"y":2,"from":3,"to":3,"table":$table}""")
        assertEquals(PageMessage.ContextMenu(id, 1.0, 2.0, 3, 3, TableCell(0, 20, 1, 2)), cm("""{"from":0,"to":20,"row":1,"column":2}"""))
        assertNull(cm("""{"from":0,"to":20,"row":1}"""))
        assertNull(cm("""{"from":0,"to":20,"row":1,"column":2,"x":0}"""))
        assertNull(cm("""{"from":20,"to":20,"row":1,"column":2}"""))
        assertNull(cm("""{"from":0,"to":20,"row":-1,"column":2}"""))
        assertNull(cm("""null"""))
        assertNull(cm("""[0,20,1,2]"""))
    }

    @Test
    fun tableAction() {
        fun ta(body: String) = PageMessages.parse("command", """{"type":"command","docId":"$id","name":"tableAction",$body}""")
        for (action in PageMessages.TABLE_ACTIONS) {
            assertEquals(PageMessage.TableAction(id, action, TableCell(0, 10, 2, 1)), ta(""""action":"$action","from":0,"to":10,"row":2,"column":1"""))
        }
        assertEquals(11, PageMessages.TABLE_ACTIONS.size)
        assertNull(ta(""""action":"rm -rf","from":0,"to":10,"row":0,"column":0"""))
        assertNull(ta(""""action":"insertRow","from":0,"to":10,"row":0,"column":0"""))
        assertNull(ta(""""action":"","from":0,"to":10,"row":0,"column":0"""))
        assertNull(ta(""""from":0,"to":10,"row":0,"column":0"""))
        assertNull(ta(""""action":"reformat","from":0,"to":10"""))
        assertNull(ta(""""action":"reformat","from":10,"to":0,"row":0,"column":0"""))
        assertNull(ta(""""action":"reformat","from":0,"to":10,"row":0.5,"column":0"""))
        assertNull(ta(""""action":"reformat","from":0,"to":10,"row":0,"column":-1"""))
        assertNull(ta(""""action":"reformat","from":0,"to":10,"row":0,"column":0,"extra":1"""))
    }

    @Test
    fun gotoSource() {
        fun gs(body: String) = PageMessages.parse("command", """{"type":"command","docId":"$id","name":"gotoSource"$body}""")
        assertEquals(PageMessage.GotoSource(id, 42), gs(""","pos":42"""))
        assertEquals(PageMessage.GotoSource(id, 0), gs(""","pos":0"""))
        assertNull(gs(""))
        assertNull(gs(""","pos":-1"""))
        assertNull(gs(""","pos":"4""""))
        assertNull(gs(""","pos":1,"to":2"""))
    }

    @Test
    fun pathsExist() {
        fun pe(body: String) = PageMessages.parse("command", """{"type":"command","docId":"$id","name":"pathsExist"$body}""")
        assertEquals(PageMessage.PathsExist(id, listOf("src/A.kt", "README.md")), pe(""","paths":["src/A.kt","README.md"]"""))
        assertEquals(PageMessage.PathsExist(id, emptyList()), pe(""","paths":[]"""))
        assertNull(pe(""))
        assertNull(pe(""","paths":"a.kt""""))
        assertNull(pe(""","paths":[1]"""))
        assertNull(pe(""","paths":[""]"""))
        assertNull(pe(""","paths":["${"a".repeat(201)}"]"""))
        assertNull(pe(""","paths":[${List(17) { "\"a.kt\"" }.joinToString(",")}]"""))
        assertNull(pe(""","paths":["a.kt"],"extra":1"""))
    }

    @Test
    fun unknownTypeOrWrongChannel() {
        assertNull(PageMessages.parse("command", """{"type":"eval","docId":"$id","name":"toggleMode"}"""))
        assertNull(PageMessages.parse("link", """{"type":"command","docId":"$id","name":"toggleMode"}"""))
        assertNull(PageMessages.parse("other", """{"type":"other"}"""))
        assertNull(PageMessages.parse("ready", """{"type":"patch","docId":"$id","seq":1,"baseStamp":7,"patches":[]}"""))
    }

    @Test
    fun malformedJson() {
        assertNull(PageMessages.parse("ready", "{"))
        assertNull(PageMessages.parse("ready", "[]"))
        assertNull(PageMessages.parse("ready", "null"))
    }

    @Test
    fun oversize() {
        val pad = "x".repeat(PageMessages.MAX_OTHER_BYTES)
        assertNull(PageMessages.parse("link", """{"type":"link","docId":"$id","href":"$pad","kind":"relative"}"""))
        // 1400 chars of 3 bytes each: under the limit in chars, over it in UTF-8 bytes.
        val wide = "€".repeat(1400)
        assertNull(PageMessages.parse("link", """{"type":"link","docId":"$id","href":"$wide","kind":"relative"}"""))
        // The same size is fine for a patch (8 MB limit).
        assertEquals(
            PageMessage.Patch(id, 1, 1, listOf(TextPatch(0, 0, pad))),
            PageMessages.parse("patch", """{"type":"patch","docId":"$id","seq":1,"baseStamp":1,"patches":[{"start":0,"end":0,"text":"$pad"}]}"""),
        )
        val big = "x".repeat(PageMessages.MAX_PATCH_BYTES)
        assertNull(PageMessages.parse("patch", """{"type":"patch","docId":"$id","seq":1,"baseStamp":1,"patches":[{"start":0,"end":0,"text":"$big"}]}"""))
    }

    @Test
    fun lenientJsonIsRejected() {
        assertNull(PageMessages.parse("ready", """{type:"ready","protocol":2}"""))
        assertNull(PageMessages.parse("ready", """{'type':'ready','protocol':2}"""))
        assertNull(PageMessages.parse("ready", """{"type":"opened","docId":"$id","docStamp":NaN}"""))
        assertNull(PageMessages.parse("ready", """{"type":"ready","protocol":2} x"""))
        assertNull(PageMessages.parse("ready", """{"type":"ready";"protocol":2}"""))
    }

    @Test
    fun duplicateKeysAreRejected() {
        assertNull(PageMessages.parse("ready", """{"type":"ready","protocol":2,"protocol":2}"""))
        assertNull(PageMessages.parse("command", """{"type":"command","docId":"$id","name":"find","name":"toggleMode"}"""))
        assertNull(
            PageMessages.parse("patch", """{"type":"patch","docId":"$id","seq":1,"baseStamp":7,"patches":[{"start":0,"end":1,"text":"a","text":"b"}]}"""),
        )
    }
}
