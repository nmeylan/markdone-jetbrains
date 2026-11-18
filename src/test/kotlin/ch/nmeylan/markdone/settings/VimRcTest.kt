package ch.nmeylan.markdone.settings

import java.nio.file.Files
import junit.framework.TestCase

class VimRcTest : TestCase() {
    fun testMappingsAndLeader() {
        val r = VimRc.translate(
            """
            " comment
            let mapleader = " "
            nnoremap <leader>w :w<CR>
            inoremap jk <Esc>
            xmap <silent> <Leader>y "+y
            map Y y${'$'}
            """.trimIndent(),
        )
        assertEquals(
            listOf(
                VimMapping("normal", false, "<Space>w", ":w<CR>"),
                VimMapping("insert", false, "jk", "<Esc>"),
                VimMapping("visual", true, "<Space>y", "\"+y"),
                VimMapping("all", true, "Y", "y$"),
            ),
            r.mappings,
        )
        assertTrue(r.skipped.isEmpty())
    }

    fun testDefaultLeaderIsBackslash() {
        assertEquals("\\a", VimRc.translate("nmap <leader>a x").mappings.single().lhs)
    }

    fun testUnsupportedLinesAreSkipped() {
        val lines = listOf(
            "set ideajoin",
            "Plug 'tpope/vim-surround'",
            "nnoremap gd :action GotoDeclaration<CR>",
            "nmap <leader>f <Action>(FindInPath)",
            "nnoremap <expr> j gj",
            "nmap! a b",
            "let mapleader = \",,\"",
            "nmap onlylhs",
        )
        val r = VimRc.translate(lines.joinToString("\n"))
        assertTrue(r.mappings.isEmpty())
        assertEquals(lines, r.skipped)
    }

    fun testLocatePrefersHomeFileThenXdg() {
        val home = Files.createTempDirectory("home")
        assertNull(VimRc.locate(home, null))
        val xdg = home.resolve(".config/ideavim/ideavimrc")
        Files.createDirectories(xdg.parent)
        Files.writeString(xdg, "map a b")
        assertEquals(xdg, VimRc.locate(home, null))
        val dot = home.resolve(".ideavimrc")
        Files.writeString(dot, "map c d")
        assertEquals(dot, VimRc.locate(home, null))
    }
}
