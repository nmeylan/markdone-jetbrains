The goal is a fast Markdown editor for JetBrains IDEs: one tab, a Source mode and an editable live preview, with no network access.

It is a safe alternative to closed-source Markdown plugins: no CDN scripts, no remote rendering services, no code execution.

The IDE ↔ page protocol is in [protocol/PROTOCOL.md](protocol/PROTOCOL.md).

Custom styling is documented in [docs/css.md](docs/css.md).

# Why yet another Markdown plugin?
The bundled Markdown editor is slow on big files and shows the preview side by side. Other plugins rebuild the whole HTML document on each change, or load scripts from the network.

I wanted one tab where I edit the formatted text directly, that stays fast on a 20 MB file, and that I can read and audit.

# Principles
- The IDE `Document` is the only source of truth: both directions send exact changes, and there is one IDE undo stack
- Never render the whole document to the DOM: only the visible part is drawn
- No network: all scripts are in the plugin; a strict Content Security Policy blocks remote loads
- No raw HTML in the page; Mermaid SVG only through DOMPurify
- Markdown markers show only on the lines that the caret or the selection touches (Obsidian style)

# Features

**Editor**
- One `.md` tab with two modes: **Source** (platform text editor) and **Edit** (live preview that you can edit)
- Toggle the mode with `Ctrl+Alt+Shift+W` or the context menu
- Ctrl/Cmd-click on text goes to that line in Source mode; Alt-click adds a cursor
- Undo/redo (`Ctrl+Z` / `Ctrl+Shift+Z`) use the IDE undo stack in both modes
- Find in the page (`Ctrl+F`), styled like the IDE find bar
- Read-only files open read-only in Edit mode; their tab is gray
- Vim key bindings in Edit mode (setting, off by default): CodeMirror's Vim emulation, not IdeaVim; it uses the `map` commands and `let mapleader` of your `.ideavimrc`, and reports the lines it skips
- File Path in `inline code` are rendered as link if they are valid file path, you can ctrl+click to open it in an IDE tab

**Rendering**
- Headings, emphasis, strike, inline code, links, quotes, lists, task lists, rules, footnotes, front matter
- Tables as widgets
- Images: relative paths and `data:`; remote images are off by default
- Math with KaTeX (`$…$`, `$$…$$`)
- Mermaid diagrams (strict mode)
- Drawio diagrams (when using a pattern: by default(configurable)  `drawio:path/to/my.drawio#Super diagram`) 
- Code highlighting with highlight.js (visible blocks only)
- Math, Mermaid and highlighting load only when a document uses them, and you can turn each one off

**IDE-native context menu**
- Cut, Copy, Paste, Select All: they copy the Markdown source, through the IDE clipboard
- Table actions: insert row above/below, insert column left/right, remove row/column, align left/center/right/none, reformat
- Zoom In, Zoom Out, Reset Zoom
- Style: Default, Compact, Serif

**Styling**
- Built-in styles Default, Compact and Serif, each in light and dark; the page follows the IDE theme
- Global custom CSS (settings) and project CSS (`.markdone/style.css`, trusted projects only)
- CSS changes apply live, without reload; caret and scroll stay

**Big files**
- Files above 2 MB use a windowed parse from safe block boundaries
- A 20 MB file opens in Edit mode in about 0.4 s; a jump to the end takes about 50 ms
- Edit mode limit: 20 MB by default (setting); bigger files open in Source mode with a banner
- The IDE opens files bigger than `idea.max.content.load.filesize` (default 20 000 KiB) as read-only, in both modes. To raise this limit, add `idea.max.content.load.filesize=<KiB>` with `Help → Edit Custom Properties…`, then restart the IDE

**Settings** (`Settings → Tools → Markdone`)
- Global CSS, project CSS path, Reset
- Remote images (off by default)
- Large-file limit (1–20 MB)
- Style, zoom (50–300 %)
- Feature toggles: Math, Mermaid, Code highlighting
- Vim key bindings

# Prerequisites

- **IDE.** Any JetBrains IDE 2026.1 or later (build 261+).
- **JDK 25.** The Gradle build uses a Kotlin JVM toolchain 25. Gradle finds an installed JDK 25 (for example a JBR in `~/.jdks`).
- **Node.js and npm** on the `PATH`. The build does not download Node: it uses the system one to build the web editor (`web/`). Tested with Node 26.
- **Xvfb** (`xvfb-run`), only for the real-IDE tests.

Gradle itself comes from the wrapper (`./gradlew`, Gradle 9.8.1).

# Run in the IDE while developing

Start a sandbox IDE with the plugin installed:

```bash
./gradlew runIde
```

The first run downloads IntelliJ IDEA 2026.1 (`platformType`/`platformVersion` in `gradle.properties`). Each run rebuilds the web editor (`npmCi`, `webBuild`) and the plugin. Open a `.md` file and press `Ctrl+Alt+Shift+W` to go to Edit mode.

For fast work on the page only, use the web tests (no IDE). They run against a browser harness that mocks the IDE:

```bash
cd web
npm ci
npm test             # unit tests (vitest)
npm run e2e          # builds the harness, then the browser tests (Playwright)
```

# Build a release

Set the version in `gradle.properties` (`pluginVersion`), then:

```bash
./gradlew buildPlugin
```

The plugin archive is `build/distributions/markdone-<version>.zip` (it holds the plugin jar with the web bundle inside). Install it in an IDE with `Settings → Plugins → ⚙ → Install Plugin from Disk…`.

Check the plugin before you share it:

```bash
./gradlew verifyPluginStructure   # plugin.xml and archive structure
./gradlew verifyPlugin            # JetBrains Plugin Verifier against the recommended IDEs
```

## Sign and publish

The first upload to the Marketplace is manual (upload the signed zip on the plugin page). Later versions can go out from a GitHub Actions workflow or from your machine.

**GitHub Actions** (`.github/workflows/release.yml`): set `pluginVersion`, then push a tag `v<version>`. The workflow checks that the tag matches `pluginVersion`, runs `scripts/check-full.sh`, signs, publishes and creates a GitHub Release with the signed zip. In the repository, create an environment `release` (add required reviewers to approve each release) with these secrets: `CERTIFICATE_CHAIN` and `PRIVATE_KEY` (the PEM file contents), `PRIVATE_KEY_PASSWORD`, `PUBLISH_TOKEN` (Marketplace token).

**From your machine**: keep the PEM files outside the repository and name them in `~/.gradle/gradle.properties`:

```
markdone.signing.keyFile=/path/to/private_encrypted.pem
markdone.signing.chainFile=/path/to/chain.crt
```

Store the key password and the Marketplace token in the OS secret store:

```bash
secret-tool store --label="markdone signing password" service markdone key signing-password
secret-tool store --label="markdone publish token" service markdone key publish-token
./gradlew signPlugin publishPlugin
```

Environment variables (`PRIVATE_KEY_PASSWORD`, `PUBLISH_TOKEN`, `PRIVATE_KEY`, `CERTIFICATE_CHAIN`) take priority over these local settings.

# Test

```bash
scripts/check-fast.sh        # typecheck, lint, web unit tests, Kotlin tests
scripts/check-full.sh        # check-fast + browser tests (Playwright) + plugin build and verify + perf report
scripts/e2e.sh               # real IDE tests under Xvfb, both JCEF modes
E2E_HUGE=1 scripts/e2e.sh    # also the 20 MB file tests
```

Single commands:

```bash
./gradlew test               # Kotlin tests (IntelliJ test framework)
cd web && npm test           # web unit tests (vitest)
cd web && npm run e2e        # browser tests (Playwright)
```

`scripts/e2e.sh` refuses to run on your real display, so the test IDE does not take your mouse and keyboard. To allow it, set `E2E_ALLOW_DISPLAY=1`. Logs and reports are in `build/reports/`. Performance values are compared with [perf-budget.json](perf-budget.json) by `scripts/perf-report.sh`.

More details for contributors (and coding agents) are in [AGENTS.md](AGENTS.md).

# Customize the rendering

Put your CSS in the settings page (global) or in `.markdone/style.css` in the project. Your rules go to the `user` cascade layer, so they win over the built-in theme:

```css
:root {
  --md-font-body: "Inter", sans-serif;
  --md-max-width: 80ch;
}
.md-h1 { border-bottom: 1px solid var(--md-border); }
```

The stable classes and variables are listed in [docs/css.md](docs/css.md). URLs in user CSS can point only to files of the project.

# License

Apache License 2.0. See [LICENSE](LICENSE).
