# IDE ↔ page protocol (version 2.6)

Owner: orchestrator. Both sides implement this contract. A change needs a human checkpoint
(PLAN.md §8.7 item 4). Fixtures in `protocol/fixtures/*.json` replay these messages on both
sides (L4). Version 2 = PLAN.md revision 4 (CodeMirror 6, one shared page for many documents,
exact changes in both directions, one IDE undo stack, IDE context menu).

## Origin and URLs

| URL | Served by | Content |
|---|---|---|
| `https://markdone.local/app/index.html` | `AssetRequestHandler` | The page (from jar `web/index.html`). **CSP response header** (see "Page content security"). One page per browser; it hosts many documents. |
| `https://markdone.local/app/<path>` | same | Bundle assets from jar `web/<path>` (Vite `base: './'`). |
| `https://markdone.local/doc/<docId>` | same | Document text, UTF-8, `\n` line ends, BOM kept. Header `X-Markdone-Stamp: <long>` = the document **version** (see "Versions") read together with the text (required). Read under a read action off the CEF IO thread. |
| `https://markdone.local/file/<docId>/<relative path>` | same | Local file relative to the `.md` file's directory (PLAN.md §6.2 path rules). |
| `https://markdone.local/proj/<projectToken>/<path>` | same | Asset referenced by project CSS, relative to the **project CSS file**, served only from the project content roots (same path rules). `<projectToken>` = opaque random token per open project in this page (protocol 2.2). |

`<docId>` is an opaque random token (32 hex chars) per open `Document` in the IDE (not a path).

## Page content security

CSP of the page (response header; the lines joined with one space):

```
default-src 'none';
script-src https://markdone.local/app/;
style-src https://markdone.local/app/ 'unsafe-inline';
img-src https://markdone.local/ data:;
font-src https://markdone.local/app/ https://markdone.local/file/ https://markdone.local/proj/;
connect-src https://markdone.local/doc/;
base-uri 'none';
form-action 'none';
```

## Versions (protocol 2.1)

`stamp`, `docStamp` and `baseStamp` are a **per-document version counter** kept by the IDE: it
starts at 0 when the document is first opened in a page and increases by 1 for every
`DocumentEvent` of that document. It never goes back (unlike `Document.modificationStamp`, which
undo/redo restores to old values). Every message that carries a version for a document uses this
counter.

## Offsets

All offsets are **UTF-16 code unit offsets** in the document text (= `Document` offsets = JS string
indices = CodeMirror positions, because `lineSeparator` is `"\n"` and the IDE text has `\n` only).

## Host object (IDE → page functions)

After each main-frame load end, Kotlin runs `executeJavaScript` that defines
`window.__markdoneHost = { ready, patch, link, command }` (one `JBCefJSQuery` each, each takes one
JSON **string**) and dispatches `window` event `markdone-host`. The page waits for the host before
it sends anything. The harness defines a mock with the same shape.

## Page object

`window.markdone`:

| Member | Use |
|---|---|
| `receive(msg: object)` | IDE → page messages. Kotlin calls `window.markdone && window.markdone.receive(<json literal>)`. |
| `perf(docId?: string): Record<string, number>` | Performance measures (below). Without `docId`: page-level measures. |
| `__debug` | Test hooks: `docChanges(docId)`, `nonUserDocChanges(docId)`, `activeDocId()`, `docIds()`. |

## Page → IDE messages

JSON objects with a `type` field. Max size: 8 MB for `patch`, 4 KB for the others. Kotlin rejects
(ignores and logs) anything that does not match exactly (strict JSON, no unknown keys).

Through `ready` (lifecycle):

```ts
{ type: "ready",     protocol: 2 }                                  // page booted, host found
{ type: "opened",    docId: string, docStamp: number }              // after `open`: text loaded, state created
{ type: "activated", docId: string }                                // after `activate`: first frame painted
{ type: "loadError", docId: string, reason: "fetch" | "stamp" }     // `open`/`reload` failed
{ type: "diverged",  docId: string, pageLength: number, expectedLength: number } // length check failed; IDE replies `reload`
{ type: "viewport",  docId: string, top: number, anchor: number, head: number } // 2.4: active doc only; see "Mode switch sync"
```

Through `patch`:

```ts
{ type: "patch", docId: string, seq: number, baseStamp: number,
  patches: { start: number, end: number, text: string }[] }
```

- `patches` are sorted by `start`, do not overlap, and are all relative to the document text at
  `baseStamp` (CodeMirror `ChangeSet.iterChanges` of the composed change set). Kotlin applies them
  in **descending** order inside one write command.
- `patches: []` is the reply to `flush`.
- One patch in flight per document. Changes made while a patch is in flight are composed into
  the next patch.

Through `link`:

```ts
{ type: "link", docId: string, href: string, kind: "external" | "relative" | "anchor" }
```

Through `command`:

```ts
{ type: "command", docId: string, name: "toggleMode" | "find" | "undo" | "redo"
                                      | "zoomIn" | "zoomOut" | "zoomReset" }   // zoom*: M5 (Ctrl/Cmd+wheel, Mod-= / Mod-- / Mod-0)
{ type: "command", docId: string, name: "contextMenu",
  x: number, y: number,          // CSS px, relative to the page viewport
  from: number, to: number,      // main selection range
  table?: { from: number, to: number, row: number, column: number } } // M2: present when the click is inside a table
{ type: "command", docId: string, name: "tableAction",                                   // M2
  action: "insertRowAbove" | "insertRowBelow" | "insertColumnLeft" | "insertColumnRight"
        | "removeRow" | "removeColumn" | "alignLeft" | "alignCenter" | "alignRight" | "alignNone"
        | "reformat",
  from: number, to: number,      // source range of the whole table (Lezer `Table` node)
  row: number, column: number }  // 0-based cell position; row 0 = header row (alignment row not counted)
{ type: "command", docId: string, name: "gotoSource", pos: number }                      // M2: Ctrl/Cmd-click on non-link text → Source mode, caret at pos
{ type: "command", docId: string, name: "pathsExist", paths: string[] }                  // 2.6: ≤ 16 paths, each 1..200 chars; see "File paths in code"
```

## IDE → page messages (`window.markdone.receive`)

```ts
{ type: "open",     docId: string, writable: boolean }   // page fetches /doc/<docId>, creates state, replies `opened`
{ type: "activate", docId: string,                       // show this document in the view (save scroll of the old one), reply `activated`
                    top?: number, selection?: { anchor: number, head: number } } // 2.4: mode switch Source → Edit
{ type: "close",    docId: string }                      // drop the state
{ type: "reload",   docId: string }                      // re-fetch /doc/<docId>, replace the text, keep scroll if possible, reply `opened`
{ type: "change",   docId: string, stamp: number, length: number,
                    changes: { from: number, to: number, insert: string }[],
                    selection?: { anchor: number, head: number } }
{ type: "ack",      docId: string, seq: number, stamp: number, length: number }
{ type: "reject",   docId: string, seq: number }         // page then waits for `reload` or `change`
{ type: "flush",    docId: string, seq: number }         // reply: patch with that seq (pending changes or [])
{ type: "writable", docId: string, writable: boolean }
{ type: "paths",    docId: string, exist: string[], missing: string[] }  // 2.6: answer to `pathsExist` (each ≤ 16)
{ type: "theme",    dark: boolean, fontFamily: string, fontSizePx: number, zoom: number }
{ type: "css",      global: string, project: string | null }   // M2
{ type: "settings", remoteImages: boolean,                        // M2 (default false)
                    math: boolean, mermaid: boolean, highlight: boolean,  // M5 feature toggles (default true)
                    softBreaks: boolean,                                  // single line feed: line break (true, default) or space
                    style: "default" | "compact" | "serif",               // M5 built-in style (default "default")
                    doubleClickEdit: boolean,                             // 2.5: editable only after a double-click (default false)
                    vim: boolean,                                         // 2.5: Vim key bindings (default false)
                    vimrc: { mode: "all"|"normal"|"insert"|"visual"|"operator", remap: boolean, lhs: string, rhs: string }[],  // 2.5: key mappings (max 500)
                    colorTheme: "ide" | "tokyo-night" | "tokyo-storm" | "tokyo-moon" | "tokyo-light" } // 2.5: color theme (default "ide")
```

`change` rules:

- `changes` are in **sequential** order: each one is relative to the text after the previous one
  (the order of the IDE `DocumentEvent`s). The page applies them as one transaction; the page
  does not send them back as a patch.
- `stamp` is the document stamp after the changes. The page uses it as its next `baseStamp`.
- If the page has a patch in flight when a `change` arrives, the page rebases its pending
  changes over the incoming changes (CodeMirror `ChangeSet.map`). Kotlin maps or rejects the
  in-flight patch with its event log (PLAN.md §6.5).
- `selection` (after undo/redo): the page sets the selection and scrolls it into view.

Length check (`ack` and `change`): `length` = `Document.textLength` at `stamp`. After applying a
`change` (and rebasing pending local changes), or on `ack` when nothing is pending or in flight,
the page compares `length` with the host text length it derives (base text at `stamp`). On a
mismatch it sends `diverged` and makes the document read-only until `opened` after the `reload`.

Text normalization: the page never sends `\r`. A paste, drop or IME input that contains `\r\n`
or `\r` is normalized to `\n` by a transaction filter before it becomes a change.

While a document is loading (`open`/`reload` fetch in progress) it is read-only in the page.

## Keys

Keys reach the page (verified in M0). The page keymap binds Mod-z → `command undo`,
Mod-Shift-z and Mod-y → `command redo` (no CodeMirror history). Before running undo/redo, Kotlin
flushes the document (flush → patch → ack). Use `KeyboardEvent.key` (not `code`): in off-screen
rendering `code` can be wrong (M0 finding).

## Performance marks

Page-level (`perf()`): `bootMs` (navigation start → `main.ts` start), `readyMs` (navigation start →
`ready` sent), `cssSwapMs` (last `css` message received → next frame after the style swap).

Per document (`perf(docId)`): `docFetchMs` (fetch start → text received), `stateMs` (text →
`EditorState` created), `activateMs` (`activate` received → first paint after `setState`;
end mark in a task posted from the next `requestAnimationFrame` callback), `openTotalMs` (`open`
received → `opened` sent).

Kotlin logs (debug, category `#ch.nmeylan.markdone.perf`, and JSON lines to `markdone.perf.file` when set):
`toggleToActivatedMs` (mode toggle → `activated` received), `undoRoundTripMs` (`command undo`
received → `change` sent), `patchApplyMs`.

## CSS (M2)

The page keeps one `<style id="user-css">` element. On `css` it sets its text to

```css
@layer user { <global> }
@layer user { <project> }   /* only if project != null */
```

The page's own CSS declares `@layer base, theme, user, editor-ui;` first. Each source is at most
512 KB (Kotlin enforces; the page drops a larger one and logs). Relative `url()` in project CSS
are rewritten by Kotlin to `https://markdone.local/proj/<projectToken>/<path>` (relative to the CSS
file; independent of the document, so all documents of one project get the identical `css`
message — protocol 2.2). Kotlin sends `css` after `ready`, on each change, and **before**
`activate` when the newly active document belongs to another project (or another trust state)
than the previous one; it does not resend an identical message.

The page drops every `url()`/`image-set()` target in user CSS whose origin is not
`https://markdone.local/` (after parsing: it walks the CSSOM of the user sheet and removes such
declarations), so user CSS can never cause a remote request, even with `remoteImages` on.

## Images (M2)

The page renders `![alt](src)` with:
- relative `src` → `https://markdone.local/file/<docId>/<src>` (the IDE serves it with the path rules);
- `data:` → as is;
- `http(s):` → only if `settings.remoteImages` is true (the IDE then lets these image requests
  through to the network); otherwise a placeholder showing the URL as text.

## Settings, style and zoom (M5, protocol 2.3)

- Kotlin sends `settings` after `ready` and on each change (all fields, every time). The page
  re-renders only what changed: a toggle that goes off shows that construct as source (like a
  construct the page does not render); `style` sets `<html data-md-style="...">`.
- Built-in styles live in `@layer theme` and each has a light and a dark variant
  (`:root[data-ide-theme]`). User CSS (`@layer user`) still wins.
- `theme` is sent after `ready`, and again when the IDE look-and-feel, the editor color scheme or
  the editor font changes, and when the zoom changes. `zoom` is the plugin's own Edit-mode zoom
  (application setting, 0.5 … 3.0, step 0.1, default 1.0); the page uses
  `fontSizePx * zoom`. The page never changes the CEF zoom level.
- `zoomIn`/`zoomOut`/`zoomReset` are requests; Kotlin changes the setting and sends `theme` to
  every page.

## File paths in code (protocol 2.6)

Inline code that is a relative file path (`src/Foo.kt`, `README.md`) opens the file on Ctrl/Cmd-click, in
the text and in table cells. The page styles it (`.md-path`) only when the file exists, so it asks the
IDE with `pathsExist` for the visible candidates (one message after 30 ms, at most 16 paths, each 1..200
chars). The IDE answers `paths` with every asked path in `exist` or `missing`. It resolves a path as a
relative link does: next to the `.md` file first, then relative to each project content root; never
absolute, never outside those roots (canonicalized, symlinks resolved). The click sends the existing
`link` message with `kind: "relative"`. The page keeps the answers per document; `reload` and `close`
clear them, `activate` clears the `missing` ones.

## Edit start and Vim (protocol 2.5)

- `doubleClickEdit` true: a document starts not editable. A double-click (not on a check box or a
  table button) makes it editable with the caret at the click; Escape, a click outside the block
  of the edit (paragraph, list item, table, code block), leaving the page, or showing another
  document ends it. Single clicks on check boxes, table buttons and Ctrl/Cmd-click
  keep working. The IDE `writable` message still wins: a read-only document never becomes editable.
- `vim` true: the page loads the Vim extension (lazy chunk). `u` and Ctrl-r send the `undo` and
  `redo` commands. With both settings on, Escape ends the edit only in Normal mode.
- `vimrc`: key mappings that Kotlin takes from the user's `.ideavimrc` (`map` commands and
  `let mapleader` only; `<Leader>` is already replaced; empty when `vim` is false). The page clears
  the old mappings and adds these. Other lines of the file are skipped and listed in Settings.

## Color theme (protocol 2.5)

- `colorTheme` goes to `<html data-md-color-theme>`. `ide` uses the light or dark colors of the IDE
  theme (`theme.dark`). The other values set their own palette, light or dark, whatever the IDE
  theme is. An unknown value makes the whole message invalid.
- The Tokyo Night palettes are ported from https://github.com/tcmmichaelb139/obsidian-tokyonight (MIT).

## Mode switch sync (protocol 2.4)

Source and Edit mode show the same place after a mode switch: the first visible **source line**
(not pixels: line heights differ) and the caret/selection.

- `viewport` (page → IDE, `ready` channel): `top` = offset of the start of the first visible line
  of the active document; `anchor`/`head` = main selection. The page sends it at most every 100 ms
  after a scroll of the active document (not after a selection change alone), and **always just
  before** its reply to a `flush`, with the selection and first visible line read at that moment
  (so the IDE has the exact values when it switches Edit → Source). When the reply waits for the
  ack of an in-flight patch, the page reads and sends the `viewport` when it sends the reply.
  When the in-flight patch is the reply (same `seq`), the page sends no `viewport` for that
  `flush`. While the scroll restore of an `activate` runs, `top` is the restore target (the
  view can still show the old place). Offsets follow
  "Offsets" and refer to the document version of the patch that follows or was last sent.
- Edit → Source: Kotlin moves the text editor caret/selection to `anchor`/`head` and scrolls so
  that the line of `top` is the first visible line. It uses only a `viewport` that the page of
  that editor sent after the `flush`; without one, the text editor keeps its own caret and scroll.
- Source → Edit: Kotlin sends `activate` with `top` (start of the first visible line of the text
  editor) and `selection`. The page puts that line at the top (instead of its saved scroll) and
  sets the selection, with the same stable restore as a saved scroll. Without these fields,
  `activate` behaves as before (tab switch).
- Values outside the document are clamped by the receiver.
