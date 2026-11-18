# Agent Instructions

Plan: `PLAN.md`. Read the section of the milestone you work on before you start.

## Commands

All scripts are non-interactive, exit 0 on success, and write full logs to `build/reports/`.

| Command | Contents | When |
|---|---|---|
| `scripts/check-fast.sh` | tsc, eslint, vitest (L1, L4 web), `./gradlew test` (L3, L4 Kotlin) | After each change |
| `scripts/check-full.sh` | check-fast + Playwright (L2, L6 web) + `./gradlew buildPlugin verifyPluginStructure` + perf report | Before you hand over a task |
| `scripts/e2e.sh` | L5 + L6 IDE side, under Xvfb | Before a milestone is marked done |
| `scripts/perf-report.sh` | Compares `build/reports/perf.json` with `perf-budget.json`; fails if a value is > 10 % over budget | In check-full and e2e |

Single commands:

- Web (in `web/`): `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run e2e`, `npm run build`.
- Gradle: `./gradlew test`, `./gradlew buildPlugin`, `./gradlew verifyPluginStructure`.

## Project facts

- Kotlin package `ch.nmeylan.markdone`, sources in `src/main/kotlin/ch/nmeylan/markdone/`, tests in
  `src/test/kotlin/ch/nmeylan/markdone/` (JUnit 4, `BasePlatformTestCase` for tests that need the platform).
- `./gradlew processResources` runs `npmCi` and `webBuild`. Vite writes the bundle to
  `build/generated/web-resources/web/`; Gradle packages it into the plugin jar under `web/`.
- Playwright tests (`web/test/e2e/`) run against the built harness (`vite build --mode harness` →
  `web/dist-harness/`, never in the jar). Playwright request routing serves it as
  `https://markdone.local/app/**` with the PLAN.md §6.3 CSP header; any other request fails the test.
- `@playwright/test` is pinned to the version whose Chromium build is installed. Do not change it
  without a reason in the milestone file.

## Definition of done

- Task: `scripts/check-fast.sh` and `scripts/check-full.sh` pass. New behaviour has a test at the
  lowest layer that can catch it (PLAN.md §8.1). No budget regression in `perf.json`.
- Milestone: its exit criteria in PLAN.md §9 are met, with evidence (test names, `perf.json`
  numbers) written in `docs/milestones/Mx.md`.

## Hard rules

Security (PLAN.md §10). Do not break these:

1. No network access from the plugin or the page (only opt-in remote images).
2. All JS/CSS/fonts bundled. Exact npm versions (no `^` or `~`), `package-lock.json` in git,
   `npm ci` only.
3. Strict CSP as a response header (PLAN.md §6.3). No `unsafe-eval`, no `wasm-unsafe-eval`.
4. Raw HTML in Markdown is never executed; it is shown as read-only text. Mermaid in `strict`
   mode.
5. Bridge: four functions, size- and schema-checked; `command` names
   from an allowlist. No file-system or process operation from the page except "open this link"
   (validated) and "apply patch to this document".
6. No code execution feature.
7. Local files served only after canonicalization, from project content roots and the `.md`
   file's directory.
8. Navigation and pop-ups blocked. File drops into the page refused.
9. Project CSS only in trusted projects.

Without a note in the milestone file, add no network call, no `eval`, no new bridge function or
command name, and no new npm or Maven dependency. Stop and ask a human for the checkpoints in
PLAN.md §8.7.

Rendering: never add a feature that renders the whole document to DOM. Decorations and widgets
are built only for visible ranges (PLAN.md §6.4). Widgets use DOM APIs and `textContent`, never
`innerHTML` with document content. Exception: Mermaid SVG output is inserted only as the
`DocumentFragment` returned by DOMPurify (`RETURN_DOM_FRAGMENT`) with the SVG profile and
`foreignObject`, `a`, `use`, `image`, `script`, `href`, `xlink:href` forbidden. Libraries that
build DOM with DOM APIs (KaTeX `render` with `trust: false`) are allowed.

Generated files: do not edit `build/generated/web-resources/`, screenshot baselines or golden
files by hand. A change to baselines or golden files needs a written reason.

## Comment style (Java/Kotlin)

- `/** ... */` (Javadoc) is only for comments directly above a declaration (class, method, field).
  Using it elsewhere trips IntelliJ's "Dangling Javadoc comment" inspection, since there's no
  declaration for it to document.
  - Short, single-sentence: `/** Comment text. */` on one line.
  - Longer, multi-sentence:
    ```
    /**
     * First sentence.
     * Second sentence.
     */
    ```
- `/* ... */` (plain block comment) for multi-line explanations inside method bodies — above a
  statement, not a declaration.
- `//` for single-line asides.

Do not wrap a single continuous comment across several `//` lines — use a block form instead
(`/** */` above a declaration, `/* */` elsewhere).

## Commit messages

- Short and concise. Describe the end result once this commit has merged, not a changelog.
- Wrap the summary and body lines to 72 characters.
