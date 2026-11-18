import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import type { Page } from '@playwright/test';

import { DIST, expect, gotoHarness, mergeReport, openHarness, readCorpus, test } from './fixtures';
import { frames, round } from './helpers';

/*
 * L2 heavy blocks: KaTeX math, Mermaid diagrams, highlight.js code
 * blocks. Security (KaTeX trust off and limits; Mermaid strict, no links/handlers/foreignObject,
 * `%%{init}%%` cannot weaken it), lazy chunks (nothing heavy without math/Mermaid/code), visible-only
 * rendering and caches. The fixture guard fails a test on any CSP violation and any request outside
 * https://markdone.local/.
 */

const caret = (page: Page, pos: number) => page.evaluate((p) => window.__harness.edit({ kind: 'cursor', from: p }), pos);
const heavy = (page: Page) => page.evaluate(() => window.__harness.heavyStats());

/** Files under /app/assets/ requested by the page, in order. */
function assets(page: Page): string[] {
  const out: string[] = [];
  page.on('request', (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith('/app/assets/')) out.push(path.slice('/app/'.length));
  });
  return out;
}

const gzipKB = (files: string[]): number => round(files.filter((f) => /\.(js|css)$/.test(f)).reduce((n, f) => n + gzipSync(readFileSync(join(DIST, f)), { level: 9 }).length, 0) / 1024);

async function noPending(page: Page, selector: string, timeout = 30_000): Promise<void> {
  await page.waitForFunction((s) => document.querySelectorAll(s).length === 0, selector, { timeout, polling: 'raf' });
}

/** Elements and attributes inside `selector` that must never be there. */
async function forbidden(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const all = Array.from(document.querySelectorAll(`${sel} *`));
    return {
      anchors: document.querySelectorAll(`${sel} a`).length,
      images: document.querySelectorAll(`${sel} img, ${sel} image`).length,
      foreignObject: document.querySelectorAll(`${sel} foreignObject`).length,
      scripts: document.querySelectorAll(`${sel} script`).length,
      use: document.querySelectorAll(`${sel} use`).length,
      onAttrs: all.filter((e) => Array.from(e.attributes).some((a) => a.name.toLowerCase().startsWith('on'))).length,
      hrefs: all.filter((e) => e.hasAttribute('href') || e.hasAttribute('xlink:href')).length,
      urlStyles: all.filter((e) => /url\(/i.test(e.getAttribute('style') ?? '')).length,
    };
  }, selector);
}

const NONE = { anchors: 0, images: 0, foreignObject: 0, scripts: 0, use: 0, onAttrs: 0, hrefs: 0, urlStyles: 0 };

test('nothing heavy loads for a document without math, Mermaid or a known code language', async ({ page, guard }) => {
  void guard;
  const requested = assets(page);
  await gotoHarness(page);
  const atStart = requested.length;
  await page.evaluate(() => window.__harness.load('d1', '# Title\n\nText with *emphasis*, 5 $ and 10 $.\n\n```\nplain fence\n```\n\n```unknownlang\nx\n```\n'));
  await frames(page, 3);
  await page.waitForTimeout(300);
  expect(requested.slice(atStart), 'no lazy chunk requested').toEqual([]);
  expect((await heavy(page)).chunks).toEqual([]);
});

test('math: math-heavy.md renders the visible formulas with KaTeX; fonts are files from /app/assets/', async ({ page, guard }) => {
  void guard;
  test.setTimeout(120_000);
  const requested = assets(page);
  await gotoHarness(page);
  const atStart = requested.length;
  const text = readCorpus('m4/math-heavy.md');
  await page.evaluate((t) => window.__harness.load('d1', t), text);
  await noPending(page, '.md-math-pending');
  await frames(page, 2);
  const s = await heavy(page);
  expect(s.chunks).toEqual(['math']);
  expect(await page.locator('.md-math .katex').count()).toBeGreaterThan(10);
  expect(await page.locator('.md-math-block .katex-display').count()).toBeGreaterThan(0);
  /*
   * No KaTeX error, except on the first line: "Prices like $5 and $10 stay text; `$x$` in code"
   * opens at `$5` and closes at the `$` in the code span (left to right, Pandoc rules; known
   * limits).
   */
  const errors = await page.evaluate(() => Array.from(document.querySelectorAll('.md-math .katex-error'), (e) => e.closest('.cm-line')?.textContent?.slice(0, 11)));
  expect(errors.filter((e) => e !== 'Prices like'), 'KaTeX errors in math-heavy.md').toEqual([]);
  // Fonts: woff2 files under /app/assets/ (never `data:`), loaded under font-src.
  await page.evaluate(() => document.fonts.ready);
  const fonts = requested.slice(atStart).filter((f) => f.endsWith('.woff2'));
  expect(fonts.length).toBeGreaterThan(0);
  expect(await page.evaluate(() => [...document.fonts].filter((f) => f.family.startsWith('KaTeX') && f.status === 'loaded').length)).toBeGreaterThan(0);
  const css = requested.slice(atStart).filter((f) => f.endsWith('.css'));
  expect(css.length).toBe(1);
  expect(readFileSync(join(DIST, css[0] as string), 'utf8')).not.toContain('data:font');
  // Lazy JS + CSS for math (KaTeX + glue).
  const lazy = gzipKB(requested.slice(atStart));
  console.log(`math lazy chunks: ${requested.slice(atStart).filter((f) => /\.(js|css)$/.test(f)).join(', ')} = ${lazy} KB gzip; fonts ${fonts.length}`);
  mergeReport('perf.json', { webLazyMathGzipKB: lazy });
  expect(await forbidden(page, '.md-math')).toEqual(NONE);
});

test('math: cache by source; caret inside a $$ block shows its source; a click on a formula moves the caret there', async ({ page, guard }) => {
  void guard;
  const text = '# M\n\nA $x^2$ and $x^2$ again.\n\n$$\n\\frac{a}{b}\n$$\n\nend\n';
  await openHarness(page, text);
  await caret(page, text.length);
  await noPending(page, '.md-math-pending');
  await frames(page, 2);
  const s1 = await heavy(page);
  // Two widgets of the same source: one render, one cache hit.
  expect(s1.mathRenders).toBe(2);
  expect(s1.mathCacheHits).toBeGreaterThanOrEqual(1);
  expect(await page.locator('.md-math-block').count()).toBe(1);
  await caret(page, text.indexOf('\\frac'));
  await frames(page, 2);
  expect(await page.locator('.md-math-block').count()).toBe(0);
  await expect(page.locator('.cm-line', { hasText: '\\frac{a}{b}' })).toBeVisible();
  await caret(page, text.length);
  await frames(page, 2);
  expect(await page.locator('.md-math-block').count()).toBe(1);
  expect((await heavy(page)).mathRenders, 'caret out: from the cache').toBe(2);
  await page.locator('.md-math').first().click();
  await frames(page, 2);
  expect(await page.evaluate(() => window.__harness.selection())).toEqual([[text.indexOf('$x^2$'), text.indexOf('$x^2$')]]);
});

test('math security: \\href, \\url, \\includegraphics, \\html* are error text; maxExpand and maxSize hold; inline math is clipped', async ({ page, guard }) => {
  void guard;
  const doc = [
    'A $\\href{javascript:window.__pwned=1}{click}$ B',
    '',
    'C $\\url{https://evil.example/}$ D',
    '',
    'E $\\includegraphics{https://evil.example/x.png}$ F',
    '',
    'G $\\htmlClass{x}{y}\\htmlStyle{background:url(https://evil.example/)}{z}\\htmlData{a=b}{c}\\htmlId{i}{d}$ H',
    '',
    'I $\\def\\a{\\a\\a}\\a$ J',
    '',
    'K $\\gdef\\leak{L}\\leak$ and $\\leak$ M',
    '',
    '$$',
    '\\rule{100000em}{100000em}',
    '$$',
    '',
    // Inline formulas that would move far out of their line.
    'N $\\raisebox{-500em}{x}$ O',
    '',
    'P $\\kern-1000em \\text{SPOOF}$ Q',
    '',
    'R $\\hspace{-900em}y$ S',
    '',
    'T $\\rule[-900em]{1em}{1em}$ U',
    '',
    'end',
  ].join('\n');
  await openHarness(page, doc);
  await caret(page, doc.length);
  await noPending(page, '.md-math-pending');
  await frames(page, 2);
  const dom = await page.evaluate(() => {
    const maths = Array.from(document.querySelectorAll('.md-math'));
    return {
      count: maths.length,
      // Parse errors (.katex-error) and unsupported commands (text in KaTeX's error colour).
      errors: maths.filter((m) => m.querySelector('.katex-error, [style*="color: rgb(204, 0, 0)"]')).map((m) => m.textContent?.slice(0, 16)),
      expandError: maths.some((m) => m.querySelector('.katex-error')?.getAttribute('title')?.includes('Too many expansions')),
      blockHeight: Math.max(...Array.from(document.querySelectorAll('.md-math-block'), (e) => (e as HTMLElement).offsetHeight)),
    };
  });
  console.log(`math security: ${JSON.stringify(dom)}`);
  expect(dom.count).toBe(12);
  // \href, \url, \includegraphics, \html*, the recursive macro, and \leak in the next formula (\gdef does not leak).
  expect(dom.errors).toEqual(['\\href', '\\url', '\\includegraphics', '\\htmlClass\\htmlS', '\\def\\a{\\a\\a}\\a', '\\leak']);
  expect(dom.expandError).toBe(true);
  expect(dom.blockHeight, 'maxSize caps \\rule').toBeLessThan(400);
  /*
   * Each hostile inline formula stays in a box of at most 6em (+ 0.5em clip margin) inside its
   * line and the content column; the line stays small and the next line starts below the box.
   */
  const boxes = await page.evaluate(() =>
    ['N ', 'P ', 'R ', 'T '].map((head) => {
      const line = Array.from(document.querySelectorAll('.cm-line')).find((l) => l.textContent?.startsWith(head)) as HTMLElement;
      const next = line.nextElementSibling?.nextElementSibling as HTMLElement;
      const box = (line.querySelector('.md-math') as HTMLElement).getBoundingClientRect();
      const content = (document.querySelector('.cm-content') as HTMLElement).getBoundingClientRect();
      const em = parseFloat(getComputedStyle(line).fontSize);
      return {
        head,
        lineHeightEm: line.getBoundingClientRect().height / em,
        insideColumn: box.left >= content.left - em && box.right <= content.right + em,
        overlapNextEm: (box.bottom - next.getBoundingClientRect().top) / em,
      };
    }),
  );
  console.log(`math security, hostile inline boxes: ${JSON.stringify(boxes)}`);
  for (const b of boxes) {
    expect(b.lineHeightEm, `${b.head}line height`).toBeLessThan(8);
    expect(b.insideColumn, `${b.head}box inside the column`).toBe(true);
    // The clip box may reach 0.5em into the blank line below, never into the next text line.
    expect(b.overlapNextEm, `${b.head}overlap of the next line`).toBeLessThanOrEqual(0.5);
  }
  expect(await forbidden(page, '.md-math')).toEqual(NONE);
  await page.locator('.md-math').first().click({ modifiers: ['ControlOrMeta'] });
  await frames(page, 2);
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned ?? null)).toBeNull();
});

test('mermaid: mermaid-heavy.md renders the visible diagrams (strict, sanitized SVG), no eval, caches, theme follows dark', async ({ page, guard }) => {
  void guard;
  test.setTimeout(180_000);
  const requested = assets(page);
  await gotoHarness(page);
  const atStart = requested.length;
  const text = readCorpus('m4/mermaid-heavy.md');
  await page.evaluate((t) => window.__harness.load('d1', t), text);
  await noPending(page, '.md-mermaid-pending', 60_000);
  const s1 = await heavy(page);
  expect(s1.chunks).toEqual(['mermaid']);
  expect(s1.mermaidErrors).toBe(0);
  const visible = await page.locator('.md-mermaid svg').count();
  expect(visible).toBeGreaterThan(0);
  // Visible only: far fewer renders than the 30 diagrams of the file.
  expect(s1.mermaidRenders).toBeLessThan(10);
  // Scroll through the whole file: every diagram type renders without error or CSP violation (no eval).
  for (let i = 0; i < 400; i++) {
    const end = await page.evaluate(() => {
      const s = document.querySelector('.cm-scroller') as HTMLElement;
      const before = s.scrollTop;
      s.scrollTop += s.clientHeight * 0.9;
      return s.scrollTop === before;
    });
    await frames(page, 2);
    await noPending(page, '.md-mermaid-pending', 60_000);
    if (end) break;
  }
  const s2 = await heavy(page);
  expect(s2.mermaidErrors).toBe(0);
  expect(s2.mermaidRenders).toBeGreaterThanOrEqual(25);
  expect(await forbidden(page, '.md-mermaid')).toEqual(NONE);
  // Back to the top: from the cache.
  await page.evaluate(() => ((document.querySelector('.cm-scroller') as HTMLElement).scrollTop = 0));
  await frames(page, 3);
  await noPending(page, '.md-mermaid-pending');
  const s3 = await heavy(page);
  expect(s3.mermaidRenders, 're-scroll: no new render').toBe(s2.mermaidRenders);
  expect(s3.mermaidCacheHits).toBeGreaterThan(s2.mermaidCacheHits);
  // Caret into a diagram: source; caret out: cache hit, no render.
  const inside = text.indexOf('sequenceDiagram');
  await caret(page, inside);
  await frames(page, 2);
  await expect(page.locator('.cm-line', { hasText: 'sequenceDiagram' })).toBeVisible();
  await caret(page, 0);
  await frames(page, 2);
  await noPending(page, '.md-mermaid-pending');
  expect((await heavy(page)).mermaidRenders).toBe(s2.mermaidRenders);
  // Dark theme: the visible diagrams are drawn again with Mermaid's dark theme.
  const lightFill = await page.evaluate(() => getComputedStyle(document.querySelector('.md-mermaid svg .node rect, .md-mermaid svg rect') as Element).fill);
  await page.evaluate(() => window.__harness.send({ type: 'theme', dark: true, fontFamily: 'sans-serif', fontSizePx: 14, zoom: 1 }));
  await frames(page, 2);
  await noPending(page, '.md-mermaid-pending', 60_000);
  expect((await heavy(page)).mermaidRenders).toBeGreaterThan(s2.mermaidRenders);
  const darkFill = await page.evaluate(() => getComputedStyle(document.querySelector('.md-mermaid svg .node rect, .md-mermaid svg rect') as Element).fill);
  expect(darkFill).not.toBe(lightFill);
  const lazy = gzipKB(requested.slice(atStart));
  console.log(`mermaid: ${visible} diagrams at open, ${s2.mermaidRenders} renders after a full scroll; lazy JS for 11 diagram types ${lazy} KB gzip in ${requested.slice(atStart).length} files`);
  mergeReport('perf.json', { webLazyMermaidGzipKB: lazy });
});

test('mermaid: rendered only when visible and the caret is outside; invalid diagram shows the error text', async ({ page, guard }) => {
  void guard;
  const filler = Array.from({ length: 300 }, (_, i) => `Line ${i} of text.\n`).join('\n');
  const text = `# Far\n\n${filler}\n\`\`\`mermaid\nflowchart LR\n  A --> B\n\`\`\`\n\n\`\`\`mermaid\nflowchart LR\n  A --> --> B ((\n\`\`\`\n\nend\n`;
  await openHarness(page, text);
  await frames(page, 3);
  await page.waitForTimeout(500);
  expect((await heavy(page)).chunks, 'diagram far below the viewport: Mermaid not loaded').toEqual([]);
  await page.evaluate((p) => window.__harness.scrollTo(p), text.indexOf('```mermaid'));
  await frames(page, 3);
  await noPending(page, '.md-mermaid-pending');
  const s = await heavy(page);
  expect(s.mermaidRenders).toBe(1);
  expect(s.mermaidErrors).toBe(1);
  await expect(page.locator('.md-mermaid-error .md-mermaid-message')).toHaveCount(1);
});

test('mermaid security: labels with HTML, click/href/link directives and an init directive do nothing', async ({ page, guard }) => {
  test.setTimeout(60_000);
  const doc = [
    '```mermaid',
    'flowchart LR',
    '  A["<img src=https://evil.example/p.png onerror=window.__pwned=1> <b>bold</b>"] --> B["<a href=\'javascript:window.__pwned=2\'>x</a>"]',
    '  click A call alert(1)',
    '  click B href "javascript:window.__pwned=3"',
    '  click A "https://evil.example/" _blank',
    '```',
    '',
    '```mermaid',
    '%%{init: {"securityLevel": "loose", "htmlLabels": true, "flowchart": {"htmlLabels": true}, "themeCSS": ".node rect { fill: url(https://evil.example/x) }"}}%%',
    'flowchart LR',
    '  C["<i>html</i> label"] --> D',
    '  click C call alert(3)',
    '```',
    '',
    '```mermaid',
    'sequenceDiagram',
    '  A->>B: <script>window.__pwned=4</script>',
    '  link A: Dashboard @ javascript:window.__pwned=5',
    '```',
    '',
    'end',
  ].join('\n');
  await openHarness(page, doc);
  await caret(page, doc.length);
  await noPending(page, '.md-mermaid-pending');
  /*
   * Mermaid 11.17.2 decodes label entities with `innerHTML` on a detached element of the page
   * (entityDecode), before its own sanitizer: the <img onerror> label makes Chromium try the handler
   * (blocked: script-src-attr) and the remote image (blocked: img-src). The CSP is the defence there;
   * these two kinds of violation are expected in this test only, and the handler never runs (below).
   */
  const violations = await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations.slice());
  console.log(`mermaid hostile input: CSP violations ${JSON.stringify(violations)}`);
  guard.expectedViolations.push('script-src-attr inline', ...violations.filter((v) => v.startsWith('img-src https://evil.example')));
  const dom = await page.evaluate(() => ({
    svgs: document.querySelectorAll('.md-mermaid svg').length,
    evilCss: Array.from(document.querySelectorAll('.md-mermaid style'), (s) => s.textContent ?? '').filter((t) => t.includes('evil')).length,
  }));
  expect(dom).toEqual({ svgs: 3, evilCss: 0 });
  expect(await forbidden(page, '.md-mermaid')).toEqual(NONE);
  // Synthetic clicks reach any handler Mermaid might have attached: nothing may run or navigate.
  await page.evaluate(() => {
    for (const n of Array.from(document.querySelectorAll('.md-mermaid *'))) n.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await frames(page, 2);
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned ?? null)).toBeNull();
  // `click` directives: no handler and no link in strict mode (Mermaid keeps only its `clickable` class).
  expect(await page.evaluate(() => document.querySelectorAll('.md-mermaid [onclick], .md-mermaid a').length)).toBe(0);
});

test('code: highlight.js marks for visible blocks only; one lazy chunk per language; typing never highlights on the keystroke', async ({ page, guard }) => {
  void guard;
  test.setTimeout(120_000);
  const requested = assets(page);
  await gotoHarness(page);
  const atStart = requested.length;
  const text = readCorpus('m4/code-heavy.md');
  await page.evaluate((t) => window.__harness.load('d1', t), text);
  await page.waitForFunction(() => document.querySelectorAll('[class*="hljs-"]').length > 20, null, { timeout: 15_000 });
  const s1 = await heavy(page);
  // 400 blocks in the file; only the visible ones (and only their languages) are loaded/highlighted.
  expect(s1.hljsHighlights).toBeGreaterThan(0);
  expect(s1.hljsHighlights).toBeLessThan(15);
  expect(s1.chunks[0]).toBe('hljs');
  expect(s1.chunks.length).toBeLessThan(8);
  await expect(page.locator('.md-codeblock .hljs-keyword').first()).toBeVisible();
  // Typing inside a ts block: tokens are mapped; the block is highlighted again in an idle callback.
  const tsBlock = text.indexOf('```ts\n');
  const inBlock = text.indexOf('\n', text.indexOf('name: string;', tsBlock));
  await page.evaluate((p) => window.__harness.scrollTo(p), inBlock);
  await caret(page, inBlock);
  await page.waitForFunction(() => document.querySelectorAll('.md-codeblock .hljs-keyword').length > 0);
  await frames(page, 3);
  const before = await heavy(page);
  for (const key of ['Enter', 'KeyC', 'KeyO', 'KeyN', 'KeyS', 'KeyT', 'Space', 'KeyX']) {
    await page.keyboard.press(key);
    // Right after the keystroke's update: no highlight in it.
    const s = await heavy(page);
    expect(s.hljsSync, `no sync highlight after ${key}`).toBe(before.hljsSync);
  }
  await page.waitForFunction((n) => window.__harness.heavyStats().hljsIdle > n, before.hljsIdle, { timeout: 5000 });
  await expect(page.locator('.cm-line', { hasText: 'const x' }).locator('.hljs-keyword')).toHaveText('const');
  // A document with one python block: core + python only.
  const lazyAll = gzipKB(requested.slice(atStart));
  const one = assets(page);
  await gotoHarness(page);
  const oneStart = one.length;
  await page.evaluate(() => window.__harness.load('p', '# P\n\n```py\ndef f(x):\n    return x  # c\n```\n'));
  await page.waitForFunction(() => document.querySelectorAll('.hljs-keyword').length > 0);
  expect((await heavy(page)).chunks).toEqual(['hljs', 'hljs:python']);
  const lazyOne = gzipKB(one.slice(oneStart));
  console.log(`hljs lazy JS: code-heavy.md visible languages ${lazyAll} KB gzip; core + python ${lazyOne} KB gzip`);
  mergeReport('perf.json', { webLazyHljsCorePythonGzipKB: lazyOne });
});

test('bundle: initial JS + CSS < 250 KB gzip (no lazy chunk preloaded); largest lazy chunks', async ({ page, guard }) => {
  void page;
  void guard;
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  const initial = [...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*rel="(?:modulepreload|stylesheet)"[^>]*\shref)="\.\/([^"]+\.(?:js|css))"/g)].map((m) => m[1] as string);
  const initialKB = gzipKB(initial);
  const lazy = readdirSync(join(DIST, 'assets'))
    .map((f) => `assets/${f}`)
    .filter((f) => /\.(js|css)$/.test(f) && !initial.includes(f))
    .map((f): [string, number] => [f.replace(/^assets\//, ''), gzipKB([f])])
    .sort((a, b) => b[1] - a[1]);
  console.log(`bundle: initial ${initialKB} KB gzip (${initial.join(', ')}); ${lazy.length} lazy JS/CSS files; largest ${JSON.stringify(lazy.slice(0, 12))}`);
  expect(initialKB).toBeLessThan(250);
  expect(initial.filter((f) => /katex|mermaid|math|core-/.test(f)), 'no lazy chunk in the page').toEqual([]);
  mergeReport('perf.json', { webInitialJsCssGzipKB: initialKB });
});

test('mermaid styles (A37): each SVG <style> keeps only rules scoped to the diagram id, without remote URLs', async ({ page, guard }) => {
  void guard;
  await gotoHarness(page);
  // The filter itself, with CSS that Mermaid would never write.
  const hostile = String.raw`
#d .a { fill: red; }
#d, body { display: none; }
body { display: none; }
#dx .a { color: red; }
#d1 .a { color: red; }
:is(#d, body) .a { color: red; }
#d :is(.a, .b) { stroke: blue; }
#d .b { background-image: url(https://evil.example/x.png); fill: blue; }
#d .c { color: green; & ~ .x { color: red; } }
@media screen { #d .a { fill: green; } }
@font-face { font-family: X; src: url(https://markdone.local/f.woff2); }
@keyframes k { from { background-image: url(https://evil.example/k.png); opacity: 0; } }
:root { --x: 1; }
#d .e { fill: url(#local-gradient); }`;
  const out = await page.evaluate((css) => window.__harness.scopedCss(css, 'd'), hostile);
  expect(out.split('\n')).toEqual([
    '#d .a { fill: red; }',
    '#d :is(.a, .b) { stroke: blue; }',
    '#d .b { fill: blue; }',
    '#d .c { color: green; }',
    '@keyframes k { \n  0% { opacity: 0; }\n}',
    '#d .e { fill: url("#local-gradient"); }',
  ].join('\n').split('\n'));
  expect(await page.evaluate(() => window.__harness.scopedCss('#d { color: red; } } body { display: none }', 'd'))).toBe('#d { color: red; }');
  /*
   * A real diagram: a classDef with a remote URL (a class diagram writes it into its <style>). Mermaid
   * also writes it into `style` attributes of the class shapes: those declarations are removed too
   * so the browser never tries the image (the guard fails the test on a CSP violation).
   */
  const doc = ['```mermaid', 'classDiagram', '  class A', '  cssClass "A" q', '  classDef q background:url(//evil.example/l.png),stroke:#f00', '```', '', 'end'].join('\n');
  await page.evaluate((t) => window.__harness.load('d1', t), doc);
  await caret(page, doc.length);
  await noPending(page, '.md-mermaid-pending');
  const styles = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.md-mermaid svg'), (svg) => ({
      id: svg.id,
      texts: Array.from(svg.querySelectorAll('style'), (s) => s.textContent ?? ''),
    })),
  );
  expect(styles).toHaveLength(1);
  const { id, texts } = styles[0] as { id: string; texts: string[] };
  expect(texts.join('\n')).not.toContain('evil');
  // The rest of the classDef stays (the URL declaration and its shorthand are removed).
  expect(texts.join('\n')).toMatch(new RegExp(`#${id} \\.A rect \\{[^}]*stroke: rgb\\(255, 0, 0\\) !important; \\}`));
  // `style` attributes: no URL left, the other classDef declarations stay.
  const attrs = await page.evaluate(() => Array.from(document.querySelectorAll('.md-mermaid svg [style]'), (e) => e.getAttribute('style') ?? ''));
  console.log(`mermaid classDef style attributes: ${JSON.stringify(attrs)}`);
  expect(attrs.filter((a) => /url\(/i.test(a))).toEqual([]);
  expect(attrs.some((a) => /stroke:\s*#f00/.test(a))).toBe(true);
  await frames(page, 5);
  expect(await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations)).toEqual([]);
  // The filter changes nothing more on its own output.
  expect(await page.evaluate(([t, i]) => window.__harness.scopedCss(t, i), [texts.join('\n'), id] as const)).toBe(texts.join('\n'));
});

test('mermaid styles (M5 fix): upper-case keywords, `;;`, escapes and image-set in a stateDiagram load no remote URL', async ({ page, guard }) => {
  void guard;
  await gotoHarness(page);
  // stateDiagram's lexer ignores case: `CLASSDEF` is a classDef there.
  const doc = [
    '```mermaid',
    'stateDiagram-v2',
    '  [*] --> S',
    '  S --> T',
    '  T --> U',
    '  CLASSDEF bad fill:#f00,background:url(https://evil.example/a.png)',
    '  classDef worse fill:#0f0;;background:url(https://evil.example/b.png)',
    '  ClassDef esc stroke:#00f,background:u\\72l(https://evil.example/c.png),background-image:image-set("https://evil.example/d.png" 1x)',
    '  class S bad',
    '  class T worse',
    '  class U esc',
    '```',
    '',
    'end',
  ].join('\n');
  await page.evaluate((t) => window.__harness.load('d1', t), doc);
  await caret(page, doc.length);
  await noPending(page, '.md-mermaid-pending');
  await expect(page.locator('.md-mermaid svg')).toHaveCount(1);
  const svg = await page.evaluate(() => (document.querySelector('.md-mermaid svg') as SVGElement).outerHTML);
  expect(svg).not.toContain('evil');
  await frames(page, 5);
  expect(await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations)).toEqual([]);
});

test('mermaid: more than 200 edges is an error (A36); cache weight is the serialized SVG length', async ({ page, guard }) => {
  void guard;
  test.setTimeout(60_000);
  const edges = (n: number) => Array.from({ length: n }, (_, i) => `  N${i} --> N${i + 1}`).join('\n');
  const doc = ['```mermaid', 'flowchart TD', edges(201), '```', '', '```mermaid', 'flowchart LR', edges(20), '```', '', 'end'].join('\n');
  await openHarness(page, doc);
  await caret(page, doc.length);
  await noPending(page, '.md-mermaid-pending', 30_000);
  await expect(page.locator('.md-mermaid-error .md-mermaid-message')).toHaveCount(1);
  expect(await page.locator('.md-mermaid-message').textContent()).toMatch(/edge/i);
  await expect(page.locator('.md-mermaid svg')).toHaveCount(1);
  // One SVG and one error message in the cache: the weight follows the SVG size, not the source size.
  const { weight, svg, error } = await page.evaluate(() => ({
    weight: window.__harness.heavyStats().mermaidCacheWeight,
    svg: (document.querySelector('.md-mermaid svg') as Element).outerHTML.length,
    error: (document.querySelector('.md-mermaid-message') as Element).textContent?.length ?? 0,
  }));
  console.log(`mermaid cache weight ${weight}, svg outerHTML ${svg} chars, error ${error} chars`);
  expect(weight).toBeGreaterThan(error + svg * 0.5);
  expect(weight).toBeLessThan(error + svg * 2);
});

test('lazy chunks: a failed load is tried again (math, Mermaid, a Mermaid diagram type, hljs language)', async ({ page, guard }) => {
  void guard;
  test.setTimeout(60_000);
  const failed = new Set<string>();
  // Requests of these chunks fail (network error) until `blocked` is cleared.
  const blocked = new Set(['math', 'mermaid', 'python']);
  await page.route(/\/app\/assets\/(math|mermaid|flowDiagram-[A-Z0-9]+|python)-[\w-]{8}\.js$/, async (route) => {
    const name = /assets\/([a-z]+)/i.exec(route.request().url())?.[1] ?? '';
    if (!blocked.has(name)) return route.fallback();
    failed.add(name);
    return route.abort('failed');
  });
  const doc = ['# T', '', 'A $x^2$ b', '', '```mermaid', 'flowchart LR', '  A --> B', '```', '', '```py', 'def f(x):', '    return x', '```', '', 'end'].join('\n');
  await openHarness(page, doc);
  await caret(page, doc.length);
  await expect.poll(() => [...failed].sort(), { timeout: 15_000 }).toEqual(['math', 'mermaid', 'python']);
  await frames(page, 3);
  await page.waitForTimeout(300);
  expect(await page.locator('.md-math .katex').count()).toBe(0);
  expect(await page.locator('.hljs-keyword').count()).toBe(0);
  expect(await page.locator('.md-mermaid svg').count()).toBe(0);
  // Served from now on, except the flowchart chunk: it fails once, during the first diagram render.
  blocked.clear();
  blocked.add('flowDiagram');
  // Caret through the document: every widget is drawn again and every decoration rebuilt.
  for (const at of [doc.indexOf('$x'), doc.indexOf('flowchart'), doc.indexOf('def f'), doc.length]) {
    await caret(page, at);
    await frames(page, 2);
  }
  await expect(page.locator('.md-math .katex')).toHaveCount(1, { timeout: 15_000 });
  // The Mermaid chunk loaded; its flowchart chunk failed: an error, not cached.
  await expect.poll(() => failed.has('flowDiagram'), { timeout: 15_000 }).toBe(true);
  await noPending(page, '.md-mermaid-pending', 15_000);
  await expect(page.locator('.md-mermaid-error')).toHaveCount(1);
  blocked.clear();
  for (const at of [doc.indexOf('flowchart'), doc.length]) {
    await caret(page, at);
    await frames(page, 2);
  }
  await expect(page.locator('.md-mermaid svg')).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator('.hljs-keyword').first()).toBeVisible({ timeout: 15_000 });
  expect([...failed].sort()).toEqual(['flowDiagram', 'math', 'mermaid', 'python']);
  const s = await heavy(page);
  expect(s.chunks).toEqual(expect.arrayContaining(['math', 'mermaid', 'hljs', 'hljs:python']));
});

test('a $$ block and a Mermaid fence inside a blockquote or a list item get their source without `>` or indentation', async ({ page, guard }) => {
  void guard;
  const doc = [
    '> $$',
    '> x > 1',
    '> $$',
    '',
    '> ```mermaid',
    '> flowchart LR',
    '>   A --> B',
    '> ```',
    '',
    '- item',
    '',
    '  ```mermaid',
    '  sequenceDiagram',
    '    A->>B: hi',
    '  ```',
    '',
    '> - $$',
    '>   y',
    '>   $$',
    '',
    'end',
  ].join('\n');
  await openHarness(page, doc);
  await caret(page, doc.length);
  await noPending(page, '.md-math-pending');
  await noPending(page, '.md-mermaid-pending', 30_000);
  await expect(page.locator('.md-mermaid svg')).toHaveCount(2);
  expect(await page.locator('.md-mermaid-error').count()).toBe(0);
  // KaTeX text of the formulas: one `>` (the relation in `x > 1`), no quote marker.
  expect(await page.locator('.md-math-block').allTextContents()).toEqual([expect.stringMatching(/^x>1/), expect.stringMatching(/^y/)]);
});

test('code: one idle callback highlights at most one block', async ({ page, guard }) => {
  void guard;
  const block = (i: number) => ['```ts', `const a${i}: number = ${i};`, `function f${i}(x: string) { return x; }`, '```', ''].join('\n');
  const doc = `# T\n\n${Array.from({ length: 6 }, (_, i) => block(i)).join('\n')}\nend\n`;
  await openHarness(page, doc);
  await page.waitForFunction(() => document.querySelectorAll('.md-codeblock .hljs-keyword').length >= 12);
  // Count the blocks highlighted by each idle callback.
  await page.evaluate(() => {
    const w = window as unknown as { __perIdle: number[] };
    w.__perIdle = [];
    const ric = window.requestIdleCallback.bind(window);
    window.requestIdleCallback = (cb, opts) =>
      ric((deadline) => {
        const before = window.__harness.heavyStats().hljsIdle;
        cb(deadline);
        w.__perIdle.push(window.__harness.heavyStats().hljsIdle - before);
      }, opts);
  });
  const before = (await heavy(page)).hljsIdle;
  // One cursor in each block: one key makes all six blocks stale.
  const ranges = Array.from({ length: 6 }, (_, i) => doc.indexOf(` = ${i};`)).map((p) => [p, p] as [number, number]);
  await page.evaluate((r) => window.__harness.edit({ kind: 'select', ranges: r }), ranges);
  await page.keyboard.press('KeyZ');
  await page.waitForFunction((n) => window.__harness.heavyStats().hljsIdle >= n + 6, before, { timeout: 10_000 });
  const perIdle = await page.evaluate(() => (window as unknown as { __perIdle: number[] }).__perIdle);
  expect(Math.max(...perIdle)).toBe(1);
  expect(perIdle.filter((n) => n === 1).length).toBeGreaterThanOrEqual(6);
});

test('a $$ block is bounded: a hostile formula cannot make a huge widget; math-heavy.md formulas are not clipped', async ({ page, guard }) => {
  void guard;
  test.setTimeout(120_000);
  const doc = ['A', '', '$$', '\\raisebox{-500em}{x}', '$$', '', '$$', '\\raisebox{500em}{y} + \\rule{1em}{900em}', '$$', '', 'next line', '', 'end'].join('\n');
  await openHarness(page, doc);
  await caret(page, doc.length);
  await noPending(page, '.md-math-pending');
  await frames(page, 2);
  const boxes = await page.evaluate(() => {
    const next = Array.from(document.querySelectorAll('.cm-line')).find((l) => l.textContent === 'next line') as HTMLElement;
    return Array.from(document.querySelectorAll('.md-math-block'), (e) => {
      const el = e as HTMLElement;
      const em = parseFloat(getComputedStyle(el).fontSize);
      const r = el.getBoundingClientRect();
      return { heightEm: r.height / em, belowNext: next.getBoundingClientRect().top >= r.bottom - 1 };
    });
  });
  console.log(`hostile $$ blocks: ${JSON.stringify(boxes)}`);
  expect(boxes).toHaveLength(2);
  for (const b of boxes) {
    // max-height 30em + 0.8em padding.
    expect(b.heightEm).toBeLessThanOrEqual(31);
    expect(b.belowNext).toBe(true);
  }
  // Normal formulas: scroll through math-heavy.md; no $$ block is clipped.
  await page.evaluate((t) => window.__harness.load('m', t), readCorpus('m4/math-heavy.md'));
  const seen = new Map<string, { height: number; content: number }>();
  for (let i = 0; i < 400; i++) {
    await noPending(page, '.md-math-pending');
    await frames(page, 2);
    for (const [k, v] of await page.evaluate(() =>
      Array.from(document.querySelectorAll('.md-math-block'), (e) => [e.textContent ?? '', { height: (e as HTMLElement).clientHeight, content: e.scrollHeight }] as const),
    ))
      seen.set(k, v);
    const end = await page.evaluate(() => {
      const s = document.querySelector('.cm-scroller') as HTMLElement;
      const before = s.scrollTop;
      s.scrollTop += s.clientHeight * 0.9;
      return s.scrollTop === before;
    });
    if (end) break;
  }
  expect(seen.size).toBeGreaterThan(10);
  expect([...seen.entries()].filter(([, v]) => v.content > v.height).map(([k]) => k.slice(0, 40)), 'clipped $$ blocks').toEqual([]);
});

test('code: a fenced block in a blockquote is highlighted without the `>` markers', async ({ page, guard }) => {
  void guard;
  // YAML: a `>` at the start of a value is a folded scalar, so with the markers `key:` is not a key.
  const doc = ['# Q', '', '> ```yaml', '> key: value', '> other: "two', '>   lines"', '> ```', '', '- item', '', '  ```yaml', '  name: x', '  ```', '', 'end'].join('\n');
  await openHarness(page, doc);
  await caret(page, doc.indexOf('lines"'));
  await page.waitForFunction(() => document.querySelectorAll('.hljs-attr').length >= 3);
  await frames(page, 2);
  expect(await page.locator('.hljs-attr').allTextContents()).toEqual(['key:', 'other:', 'name:']);
  // The string spans two lines: two marks, and the `>` marker of the second line (visible on the caret line) is in none.
  expect(await page.locator('.hljs-string').allTextContents()).toEqual(['value', '"two', '  lines"', 'x']);
  expect(await page.locator('[class*="hljs-"] .md-marker, .md-marker [class*="hljs-"]').count()).toBe(0);
  expect(await page.locator('.cm-line', { hasText: 'lines"' }).locator('.md-marker').allTextContents()).toEqual(['>']);
});
