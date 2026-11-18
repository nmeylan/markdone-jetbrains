package ch.nmeylan.markdone.jcef

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.nio.file.Files
import java.nio.file.InvalidPathException
import java.nio.file.Path

/** Local file rules for `/file/` requests and relative links. */
object PathRules {
    /**
     * Returns the real path of [rawRelative] (still percent-encoded) relative to [baseDir], or
     * `null` when it is not an existing file under one of [allowedRoots].
     * Symlinks are resolved before the root check.
     */
    fun resolve(baseDir: Path, rawRelative: String, allowedRoots: Collection<Path>): Path? {
        val decoded = percentDecode(rawRelative) ?: return null
        if (decoded.isEmpty() || decoded.contains('\u0000')) return null
        val real = try {
            val relative = Path.of(decoded)
            if (relative.isAbsolute || relative.root != null) return null
            baseDir.resolve(relative).normalize().toRealPath()
        } catch (_: InvalidPathException) {
            return null
        } catch (_: IOException) {
            return null
        }
        val inRoot = allowedRoots.any { root ->
            val realRoot = try {
                root.toRealPath()
            } catch (_: IOException) {
                return@any false
            }
            real.startsWith(realRoot)
        }
        return real.takeIf { inRoot && Files.isRegularFile(it) }
    }

    /** Decodes `%XX` escapes as UTF-8; `+` stays `+`. Returns `null` for a malformed escape. */
    fun percentDecode(s: String): String? {
        if ('%' !in s) return s
        val out = ByteArrayOutputStream(s.length)
        var i = 0
        while (i < s.length) {
            val c = s[i]
            if (c == '%') {
                if (i + 2 >= s.length) return null
                val hi = Character.digit(s[i + 1], 16)
                val lo = Character.digit(s[i + 2], 16)
                if (hi < 0 || lo < 0) return null
                out.write(hi * 16 + lo)
                i += 3
            } else {
                val next = s.indexOf('%', i).let { if (it < 0) s.length else it }
                out.writeBytes(s.substring(i, next).toByteArray(Charsets.UTF_8))
                i = next
            }
        }
        return out.toString(Charsets.UTF_8)
    }
}
