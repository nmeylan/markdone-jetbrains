# Custom CSS for Edit mode

Edit mode shows Markdown as a live preview (CodeMirror 6 in an embedded browser). You can change
how it looks with your own CSS:

- **Global CSS**: in the plugin settings. It applies to every project.
- **Project CSS**: the file `.markdone/style.css` in the project. It applies only to that project, and
  only when the project is trusted.

A change applies at once. It does not reload the page, it does not change the document, and the
caret and the scroll position stay where they are.

## Rules

- Each source (global, project) can be at most **512 KB**. A larger source is ignored.
- Each source must be complete CSS. A source with unbalanced braces (a `}` too many or a `{` that
  is not closed) is ignored, because it could leave its layer.
- CSS can load files only from the plugin's own origin, `https://markdone.local/`. After the page
  parses your CSS, it removes every declaration whose `url()`, `image-set()`, `-webkit-image-set()`,
  `image()`, `cross-fade()` or `src()` refers to another place. This applies to all properties and
  descriptors (`background`, `cursor`, `list-style-image`, `border-image`, `mask`, `content`, custom
  properties, `@font-face src`, …), inside `@media`, `@supports`, nested rules and all other rules,
  and also to escaped forms such as `u\72l(`. Thus CSS never loads a remote file, also when remote
  images are on.
- Relative `url()` in project CSS refer to files relative to the CSS file (for example a font in
  `.markdone/fonts/`). The plugin serves them from `https://markdone.local/proj/…`, with the same path
  rules as images: only files in the project content roots.
- `data:` URLs are kept (they cause no request), except in `@font-face` `src`.
- `@import` is ignored.
- Remote images are only possible as Markdown images (`![alt](https://…)`), and only when the
  setting "remote images" is on.
- Raw HTML in Markdown is never rendered, so CSS cannot style HTML from the document.

## Cascade layers

The page CSS declares this layer order first:

```css
@layer base, theme, user, editor-ui;
```

| Layer | Content |
|---|---|
| `base` | Page reset and structure |
| `theme` | Built-in light and dark theme: the `--md-*` variables and the `md-*` classes |
| `user` | Your CSS. The page wraps the global CSS and then the project CSS each in `@layer user { … }` |
| `editor-ui` | Caret, selection, search panel (Mod-F), table buttons, read-only state |

Because `user` comes after `theme`, any rule you write wins over the built-in theme, whatever its
specificity. Because `editor-ui` comes after `user`, your CSS cannot hide or break the caret, the
selection, the search panel or the table buttons with normal declarations. (`!important`
declarations reverse the layer order; do not use them for the editor UI.) The project CSS comes
after the global CSS, so it wins when both set the same thing.

Do not write `@layer` yourself; the page does it for you.

## Variables

Set them on `:root`. All colours are CSS colours, all fonts are `font-family` lists.

| Variable | Default (light) | Use |
|---|---|---|
| `--md-font-body` | IDE editor font, then `system-ui, sans-serif` | Text font |
| `--md-font-mono` | `ui-monospace, 'JetBrains Mono', monospace` | Inline code, code blocks, front matter, table source, raw HTML |
| `--md-font-size` | IDE editor font size × zoom | Base font size |
| `--md-line-height` | `1.8` | Line height |
| `--md-code-line-height` | `1.6` | Line height of code block lines |
| `--md-max-width` | `none` | Maximum width of the text column (it is centred) |
| `--md-fg` | `#1f2328` | Text colour |
| `--md-bg` | `#ffffff` | Background |
| `--md-accent` | `#0969da` | Footnotes |
| `--md-muted` | `#59636e` | Quotes, bullets, list numbers, front matter, raw HTML |
| `--md-heading-fg` | `#0969da` | Heading colour |
| `--md-heading-font` | `var(--md-font-body)` | Heading font |
| `--md-heading-weight` | `600` | Heading weight |
| `--md-h1-size` … `--md-h6-size` | `2em`, `1.5em`, `1.25em`, `1.1em`, `1em`, `1em` | Heading font size (relative to `--md-font-size`) |
| `--md-heading-space` | `0px` | Space above each heading line |
| `--md-content-padding` | `16px 32px 64px` | Padding of the text column (top, sides, bottom) |
| `--md-code-bg` | `#f6f8fa` | Code and table header background |
| `--md-border` | `#d1d9e0` | Quote bar, table borders, horizontal rule |
| `--md-link` | `#0969da` | Link colour |
| `--md-marker` | `#8c959f` | Colour of visible Markdown markers (`#`, `**`, `>`, …) |
| `--md-error` | `#cf222e` | Mermaid error message |
| `--md-code-keyword` | `#cf222e` | Code highlighting: keywords, built-ins (`.hljs-keyword`, `.hljs-built_in`, `.hljs-selector-tag`) |
| `--md-code-string` | `#0a3069` | Strings, regular expressions, template parts (`.hljs-string`, `.hljs-regexp`, `.hljs-template-*`) |
| `--md-code-comment` | `#6e7781` | Comments, quotes (`.hljs-comment`, `.hljs-quote`) |
| `--md-code-number` | `#0550ae` | Numbers, literals, symbols, bullets (`.hljs-number`, `.hljs-literal`, `.hljs-symbol`, `.hljs-bullet`) |
| `--md-code-type` | `#953800` | Types, titles, names, selectors (`.hljs-type`, `.hljs-title`, `.hljs-section`, `.hljs-name`, `.hljs-selector-class`, `.hljs-selector-id`) |
| `--md-code-attr` | `#8250df` | Attributes, properties, variables, parameters (`.hljs-attr`, `.hljs-attribute`, `.hljs-property`, `.hljs-variable`, `.hljs-params`) |
| `--md-code-meta` | `#116329` | Meta, doc tags, tags (`.hljs-meta`, `.hljs-doctag`, `.hljs-tag`) |

The light colours follow GitHub Light; the dark theme sets other values (Tokyo Night). To change one theme only, use the selector
`:root[data-ide-theme="dark"]` or `:root[data-ide-theme="light"]`; the page sets this attribute
from the IDE theme.

Editor UI variables are in the `editor-ui` layer: `--md-caret`, `--md-selection-bg`,
`--md-panel-bg`, `--md-panel-fg`, `--md-panel-border`, `--md-panel-hover-bg`, `--md-panel-focus`,
`--md-panel-font`, `--md-panel-input-font`, `--md-panel-font-size`, `--md-search-match`,
`--md-search-match-selected`, `--md-control-bg`, `--md-control-remove-bg`, `--md-control-fg`. A
`user` rule cannot change them.

## Built-in styles

In the plugin settings (and in the Edit-mode context menu, "Style") you select one of three
built-in styles. The page sets the attribute `data-md-style` on the `<html>` element:

| Value | Look |
|---|---|
| `default` | The look described above |
| `compact` | Smaller text, less space: more text on the screen |
| `serif` | A serif font, larger text, a narrow column and more space, for reading |

The built-in styles are in the `theme` layer. They change only the variables of this table; the
colours do not change, so each style has the light and the dark colours of the IDE theme.

| Variable | `compact` | `serif` |
|---|---|---|
| `--md-font-body` | (default) | `Charter, 'Bitstream Charter', 'Iowan Old Style', Georgia, Cambria, 'Noto Serif', 'DejaVu Serif', serif` |
| `--md-font-size` | IDE size × zoom × 0.93 | IDE size × zoom × 1.15 |
| `--md-line-height` | `1.4` | `1.75` |
| `--md-code-line-height` | `1.4` | `1.75` |
| `--md-max-width` | `1100px` | `720px` |
| `--md-heading-weight` | (default) | `700` |
| `--md-h1-size` … `--md-h4-size` | `1.5em`, `1.3em`, `1.15em`, `1.05em` | `2.2em`, `1.7em`, `1.35em`, `1.15em` |
| `--md-heading-space` | (default) | `0.5em` |
| `--md-content-padding` | `8px 20px 32px` | `32px 40px 96px` |

Your CSS is in the `user` layer, so it wins over every built-in style. A rule on `:root` applies
to all styles. To change one style only, use the attribute in the selector, for example:

```css
:root[data-md-style='serif'] {
  --md-font-body: 'Literata', serif;
}

:root[data-md-style='serif'][data-ide-theme='dark'] {
  --md-heading-fg: #e6c07b;
}
```

The heading font (`--md-heading-font`) follows `--md-font-body` unless you set it.

## Classes

These classes are stable. CodeMirror's own classes (`.cm-*`) are **not** part of this contract:
they can change in any version. This includes the classes of the search panel (`.cm-panels`,
`.cm-search`, `.cm-textfield`, `.cm-button`). The panel gets its look (IDE fonts, theme colours)
from the `editor-ui` layer, so your CSS cannot hide it or change that look with normal declarations.

A line is **active** when the caret or the selection touches it. On active lines all Markdown
markers are visible (class `md-marker`); on other lines they are hidden or replaced by widgets.

| Class | Element | Notes |
|---|---|---|
| `.md-h1` … `.md-h6` | Line | Heading lines (ATX and setext). Every heading line also has `.md-h` |
| `.md-strong`, `.md-em`, `.md-strike` | Inline | `**strong**`, `*em*`, `~~strike~~` |
| `.md-code` | Inline | Inline code (also inside table cells) |
| `.md-path` | Inline | Inline code that is a relative file path (with `.md-code`); Ctrl/Cmd-click opens the file |
| `.md-link` | Inline | Link text, autolinks, bare URLs |
| `.md-marker` | Inline | A visible Markdown marker (active line), front matter fences |
| `.md-quote` | Line | Blockquote lines |
| `.md-codeblock` | Line | Fenced and indented code lines, with `data-lang` = the fence language (`""` when none) |
| `.md-hr` | Widget | Horizontal rule |
| `.md-bullet` | Widget | Bullet of an unordered list item |
| `.md-list-number` | Inline | Number of an ordered list item (`1.`, `2)`) |
| `.md-task` | Widget | Task check box (`<input type="checkbox">`) |
| `.md-table` | Widget | Rendered table (`<table>` with `th`/`td`), inside `.md-table-wrap` |
| `.md-table-src` | Line | Table source lines (caret inside the table) |
| `.md-img` | Widget | Image (`<img>`), or the placeholder of an image that is not loaded (also `.md-img-placeholder`) |
| `.md-frontmatter` | Line | Front matter lines |
| `.md-footnote` | Inline | Footnote references and labels |
| `.md-html-source` | Inline | Raw HTML, shown as text |
| `.md-math` | Widget | A rendered formula (KaTeX). Inline formulas (`$…$`, `$$…$$` in a paragraph) are a clipped box of at most 6em height and the column width |
| `.md-math-block` | Widget | A `$$` block (display formula); it also has `.md-math`. It is at most 30em high; a formula that is higher is clipped |
| `.md-math-source` | Widget | A formula shown as its source (longer than 8 000 characters, or KaTeX failed); with `.md-math` |
| `.md-mermaid` | Widget | A Mermaid diagram (`<svg>` inside) |
| `.md-mermaid-error` | Widget | A Mermaid fence that does not render; the message is in `.md-mermaid-message` |
| `.md-drawio` | Widget | A draw.io diagram: `.md-drawio-header` (path and page, click shows the source) above `.md-drawio-body` with the sandboxed `iframe.md-drawio-frame`. The diagram itself is in the frame and cannot be styled |
| `.md-drawio-message` | Widget | Text in `.md-drawio-body` instead of a frame: `.md-drawio-pending` (waiting for data or a free frame), `.md-drawio-error` (file missing, too large, not draw.io, page not found, viewer error) |
| `.hljs-*` | Inline | Code highlighting tokens in `.md-codeblock` lines (highlight.js scope names, for example `.hljs-keyword`, `.hljs-string`). Colours: the `--md-code-*` variables |

KaTeX's own CSS (`.katex …`) is not in a layer. Mermaid writes its styles into each diagram's
`<svg>`, not in a layer, as rules scoped to the diagram's id (`#markdone-mermaid-<n> …`); the page
removes all other rules from it. Rules that are not in a layer win over every normal declaration
in a layer, whatever the specificity. Thus, to change what KaTeX or Mermaid set inside a formula
or a diagram, a `user` rule needs `!important` (an `!important` declaration in a layer wins over
one that is not in a layer). The `.md-math`, `.md-math-block` and `.md-mermaid` boxes themselves
are in the `theme` layer: a normal `user` rule changes them.

## Example

This example changes the font, the text width and the heading colours. It is the CSS of the
screenshot test `css example` (`web/test/e2e/css.spec.ts`).

```css
:root {
  --md-font-body: Georgia, 'Times New Roman', serif;
  --md-heading-font: 'Helvetica Neue', Arial, sans-serif;
  --md-max-width: 640px;
  --md-line-height: 1.75;
  --md-heading-fg: #8250df;
}

:root[data-ide-theme='dark'] {
  --md-heading-fg: #d2a8ff;
}

.md-h2 {
  color: #bf3989;
  border-bottom: 1px solid var(--md-border);
}

.md-quote {
  font-style: italic;
}
```

## Color themes

`<html data-md-color-theme>` is `ide` (the colors above), `tokyo-night`, `tokyo-storm`, `tokyo-moon`
or `tokyo-light`, from the setting "Color theme". The Tokyo Night themes are ported from
[obsidian-tokyonight](https://github.com/tcmmichaelb139/obsidian-tokyonight) (MIT). Each sets
`--tn-*` palette variables, which map onto the `--md-*` variables. They also set these variables
(by default they follow `--md-heading-fg`, `--md-muted` and `--md-code-bg`):
`--md-h1-fg` … `--md-h6-fg` (heading colors per level), `--md-strong-fg`, `--md-em-fg` (bold and
italic text) and `--md-table-header-bg`. To change one theme only, use
`:root[data-md-color-theme="tokyo-night"]` in user CSS.
