import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, gotoHarness, openHarness, readCorpus, test } from './fixtures';
import { frames, sent, stableTopLine } from './helpers';

/*
 * L2 custom CSS (PROTOCOL.md "CSS (M2)"): layer order, editor UI stays visible,
 * live update without change or reload, URLs outside https://markdone.local/ dropped, limits, screenshots.
 */

/** The example CSS of docs/css.md (first css block after "## Example"). */
const EXAMPLE_CSS = (() => {
  const doc = readFileSync(fileURLToPath(new URL('../../../docs/css.md', import.meta.url)), 'utf8');
  const m = /## Example[\s\S]*?```css\n([\s\S]*?)```/.exec(doc);
  if (!m?.[1]) throw new Error('docs/css.md: no example CSS');
  return m[1];
})();

/** Sends a `css` message; the page applies it in the next frame (after a measured scroll snapshot). */
const css = async (page: Page, global: string, project: string | null = null) => {
  await page.evaluate(([g, p]) => window.__harness.send({ type: 'css', global: g, project: p }), [global, project] as const);
  await frames(page, 2);
};
const violations = (page: Page) => page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);

test('layer order: the page CSS declares base, theme, user, editor-ui first; user CSS goes to layer user', async ({ page, guard }) => {
  void guard;
  await gotoHarness(page);
  const first = await page.evaluate(() => {
    const sheet = [...document.styleSheets].find((s) => s.href?.includes('/assets/'));
    const rule = sheet?.cssRules[0];
    return rule instanceof CSSLayerStatementRule ? [...rule.nameList] : null;
  });
  expect(first).toEqual(['base', 'theme', 'user', 'editor-ui']);
  // #user-css comes after the page CSS.
  expect(
    await page.evaluate(() => {
      const link = document.querySelector('link[rel="stylesheet"]') as Element;
      return !!(link.compareDocumentPosition(document.getElementById('user-css') as Element) & Node.DOCUMENT_POSITION_FOLLOWING);
    }),
  ).toBe(true);
  await css(page, '.a { color: red; }', '.b { color: blue; }');
  const rules = await page.evaluate(() =>
    [...((document.getElementById('user-css') as HTMLStyleElement).sheet?.cssRules ?? [])].map((r) => (r instanceof CSSLayerBlockRule ? `${r.name}:${r.cssRules.length}` : r.cssText)),
  );
  expect(rules).toEqual(['user:1', 'user:1']);
  // A user rule wins over the theme (any specificity), the IDE font goes through --md-ide-font.
  await openHarness(page, '# Title\n\ntext\n');
  await page.evaluate(() => window.__harness.send({ type: 'theme', dark: false, fontFamily: 'Inter', fontSizePx: 13, zoom: 1 }));
  await css(page, ':root { --md-font-body: monospace; } h1, .md-h1 { color: rgb(1, 2, 3); }');
  await expect(page.locator('.md-h1')).toHaveCSS('color', 'rgb(1, 2, 3)');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.cm-scroller') as Element).fontFamily)).toBe('monospace');
  await css(page, '');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.cm-scroller') as Element).fontFamily)).toBe('Inter, system-ui, sans-serif');
});

test('editor-ui stays visible with user CSS that hides everything', async ({ page, guard }) => {
  void guard;
  await openHarness(page, 'alpha beta gamma\nsecond line\n');
  await css(page, '*, *::before, *::after { display: none; visibility: hidden; opacity: 0; background: none; border-color: transparent; }');
  await page.evaluate(() => window.__harness.edit({ kind: 'cursor', from: 3 }));
  await frames(page, 2);
  const cursor = page.locator('.cm-cursor').first();
  await expect(cursor).toBeVisible();
  expect(await cursor.evaluate((e) => getComputedStyle(e).borderLeftStyle)).toBe('solid');
  await page.evaluate(() => window.__harness.edit({ kind: 'select', ranges: [[0, 10]] }));
  const selection = page.locator('.cm-selectionBackground').first();
  await expect(selection).toBeVisible();
  expect(await selection.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  await page.keyboard.press('Control+f');
  await expect(page.locator('.cm-search')).toBeVisible();
  await expect(page.locator('.cm-search input[name="search"]')).toBeVisible();
  await expect(page.locator('.cm-search button[name="next"]')).toBeVisible();
});

test('find panel: IDE font, theme colours, compact; usable with user CSS that hides everything', async ({ page, guard }) => {
  void guard;
  await openHarness(page, 'alpha beta alpha\nsecond alpha line\n');
  await page.evaluate(() => window.__harness.send({ type: 'theme', dark: true, fontFamily: 'Inter', fontSizePx: 15, zoom: 2 }));
  await css(page, '*, *::before, *::after { display: none; visibility: hidden; opacity: 0; background: none; border-color: transparent; font-size: 40px; font-family: monospace; padding: 30px; }');
  await page.evaluate(() => window.__harness.edit({ kind: 'cursor', from: 0 }));
  await page.keyboard.press('Control+f');
  const panel = page.locator('.cm-panel.cm-search');
  const field = panel.locator('input[name="search"]');
  await expect(field).toBeVisible();
  const look = await page.evaluate(() => {
    const cs = (sel: string) => getComputedStyle(document.querySelector(sel) as Element);
    const field = cs('.cm-search input[name="search"]');
    const button = cs('.cm-search button[name="next"]');
    const label = cs('.cm-search label');
    const panels = cs('.cm-panels');
    return {
      fieldFont: field.fontFamily,
      fieldSize: field.fontSize,
      fieldRadius: field.borderRadius,
      fieldBg: field.backgroundColor,
      buttonSize: button.fontSize,
      buttonBg: button.backgroundColor,
      buttonImage: button.backgroundImage,
      labelSize: label.fontSize,
      panelBg: panels.backgroundColor,
      panelColor: panels.color,
      panelHeight: (document.querySelector('.cm-panel.cm-search') as HTMLElement).offsetHeight,
    };
  });
  console.log(`find panel: ${JSON.stringify(look)}`);
  expect(look).toMatchObject({
    // The IDE editor font in the field (not the zoomed size), the IDE theme colours (dark).
    fieldFont: 'Inter, system-ui, sans-serif',
    fieldSize: '13px',
    fieldRadius: '4px',
    fieldBg: 'rgb(26, 27, 38)',
    buttonSize: '13px',
    buttonBg: 'rgb(22, 22, 30)',
    buttonImage: 'none',
    labelSize: '13px',
    panelBg: 'rgb(22, 22, 30)',
    panelColor: 'rgb(192, 202, 245)',
  });
  // Compact: two rows (find, replace) of about 28px; the 40px user font and padding do not apply.
  expect(look.panelHeight).toBeLessThan(70);
  // Usable: typing searches, Enter goes to the next match.
  await field.pressSequentially('alpha');
  await field.press('Enter');
  expect((await page.evaluate(() => window.__harness.selection()))[0]).toEqual([0, 5]);
  await field.press('Enter');
  expect((await page.evaluate(() => window.__harness.selection()))[0]).toEqual([11, 16]);
});

test('css update: zero changes, no reload, caret and scroll kept; each source wrapped and checked', async ({ page, guard }) => {
  void guard;
  const text = readCorpus('medium.md');
  await openHarness(page, text);
  const pos = Math.floor(text.length / 2);
  await page.evaluate((p) => window.__harness.edit({ kind: 'select', ranges: [[p, p + 7]] }), pos);
  await page.evaluate((p) => window.__harness.scrollTo(p), pos);
  await frames(page, 3);
  await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true));
  const before = { sel: await page.evaluate(() => window.__harness.selection()), top: await stableTopLine(page) };
  for (let i = 0; i < 5; i++) {
    await css(page, i % 2 ? '' : EXAMPLE_CSS, i % 2 ? null : '.md-strong { color: rgb(9, 9, 9); }');
    await frames(page, 2);
  }
  await expect(page.locator('.md-strong').first()).toHaveCSS('color', 'rgb(9, 9, 9)');
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
  expect(await page.evaluate(() => window.markdone?.__debug.docChanges('d1'))).toBe(0);
  expect(await sent(page, 'patch')).toEqual([]);
  expect(await page.evaluate(() => window.__harness.selection())).toEqual(before.sel);
  // The example CSS changes line heights; the first visible line stays (± 1).
  expect(Math.abs((await stableTopLine(page)) - before.top)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => window.markdone?.perf()['cssSwapMs'])).toBeGreaterThan(0);
  // Over 512 KB: dropped; unbalanced braces: dropped (it would leave the layer); the other source stays.
  const big = `/* ${'x'.repeat(512 * 1024)} */`;
  await css(page, big, '.md-strong { color: rgb(7, 7, 7); }');
  await expect(page.locator('.md-strong').first()).toHaveCSS('color', 'rgb(7, 7, 7)');
  expect(await page.evaluate(() => document.getElementById('user-css')?.textContent?.length)).toBeLessThan(100);
  await css(page, '.md-strong { color: rgb(5, 5, 5); } } .cm-cursor { display: none !important; }', '.md-em { color: rgb(6, 6, 6) } .md-strong {');
  await expect(page.locator('.md-strong').first()).not.toHaveCSS('color', 'rgb(5, 5, 5)');
  expect(await page.evaluate(() => document.getElementById('user-css')?.textContent)).toBe('');
});

test('user CSS URLs outside https://markdone.local/ are dropped from the CSSOM: no request, no CSP violation', async ({ page, guard }) => {
  await openHarness(page, '# Title\n\n- item\n\ntext\n');
  const evil = String.raw`
@import url(https://evil.example/a.css);
@font-face { font-family: Evil; src: url(https://evil.example/f.woff2) format('woff2'); }
@font-face { font-family: EvilData; src: url(data:font/woff2;base64,AAAA); }
.md-h1 { font-family: Evil, EvilData; background-image: u\72l(https://evil.example/escaped.png); color: rgb(1, 2, 3); }
.cm-content { background-image: image-set("https://evil.example/set.png" 1x); cursor: url(https://evil.example/c.cur), auto; }
.cm-line { list-style-image: url(//evil.example/list.png); border-image: url(https://evil.example/b.png) 30; mask-image: -webkit-image-set(url(https://evil.example/m.png) 1x); }
.cm-line::before { content: url(https://evil.example/content.png); }
:root { --evil: url(https://evil.example/var.png); }
.md-h1 { background: var(--evil) url(https://evil.example/shorthand.png); }
@media screen { @supports (display: grid) { .cm-scroller { .cm-content { background-image: /* c */url(https://evil.example/nested.png); } } } }
@layer inner { .md-quote { background-image: url(https://evil.example/layer.png); } }
@keyframes k { from { background-image: url(https://evil.example/kf.png); } }
`;
  const local = `
.md-h1 { background-image: url(https://markdone.local/file/d1/.%2Flogo.png); background-color: rgb(4, 5, 6); }
.cm-content { background-image: url(data:image/png;base64,iVBORw0KGgo=); }
@media screen { .cm-gutters { background-image: url(x.png); } }
`;
  await css(page, evil + local);
  const text = await page.evaluate(() =>
    [...((document.getElementById('user-css') as HTMLStyleElement).sheet?.cssRules ?? [])].map((r) => r.cssText).join('\n'),
  );
  expect(text).not.toContain('evil.example');
  expect(text).not.toContain('base64,AAAA');
  // Local targets and other declarations stay.
  expect(text).toContain('https://markdone.local/file/d1/.%2Flogo.png');
  expect(text).toContain('data:image/png;base64,iVBORw0KGgo=');
  expect(text).toContain('url("x.png")');
  await expect(page.locator('.md-h1')).toHaveCSS('color', 'rgb(1, 2, 3)');
  await expect(page.locator('.md-h1')).toHaveCSS('background-color', 'rgb(4, 5, 6)');
  await expect.poll(() => guard.fileRequests).toContain('d1/.%2Flogo.png');
  await frames(page, 5);
  // The guard fails the test on any request outside https://markdone.local/ and on any CSP violation.
  expect(await violations(page)).toEqual([]);
});

/* ---------- Screenshot baselines (light, dark, docs/css.md example) ---------- */

const SHOT = { maxDiffPixelRatio: 0.02, animations: 'disabled', caret: 'hide' } as const;

async function shotPage(page: Page, file: string): Promise<void> {
  await page.setViewportSize({ width: 900, height: 760 });
  await openHarness(page, readCorpus(file));
  await page.evaluate(() => window.__harness.send({ type: 'theme', dark: false, fontFamily: 'sans-serif', fontSizePx: 14, zoom: 1 }));
  await page.evaluate(() => window.__harness.edit({ kind: 'cursor', from: 0 }));
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(0, 0);
  await frames(page, 3);
}

for (const [file, name] of [
  ['small.md', 'small'],
  ['styles/tables-m2.md', 'tables'],
] as const) {
  test(`screenshots: ${file} light, dark, css example`, async ({ page, guard }) => {
    void guard;
    await shotPage(page, file);
    await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => undefined))));
    await expect(page).toHaveScreenshot(`${name}-light.png`, SHOT);
    await page.evaluate(() => window.__harness.send({ type: 'theme', dark: true, fontFamily: 'sans-serif', fontSizePx: 14, zoom: 1 }));
    await frames(page, 3);
    await expect(page).toHaveScreenshot(`${name}-dark.png`, SHOT);
    await page.evaluate(() => window.__harness.send({ type: 'theme', dark: false, fontFamily: 'sans-serif', fontSizePx: 14, zoom: 1 }));
    await css(page, EXAMPLE_CSS);
    await frames(page, 3);
    await expect(page).toHaveScreenshot(`${name}-css-example.png`, SHOT);
  });
}

/* Built-in styles: Compact and Serif, light and dark. Default = the light/dark baselines above. */
for (const [file, name] of [
  ['small.md', 'small'],
  ['styles/tables-m2.md', 'tables'],
] as const) {
  test(`screenshots: ${file} compact and serif, light and dark`, async ({ page, guard }) => {
    void guard;
    await shotPage(page, file);
    for (const style of ['compact', 'serif'] as const) {
      for (const dark of [false, true]) {
        await page.evaluate(
          ([s, d]) => {
            window.__harness.send({ type: 'theme', dark: d, fontFamily: 'sans-serif', fontSizePx: 14, zoom: 1 });
            window.__harness.send({ type: 'settings', remoteImages: false, math: true, mermaid: true, highlight: true, softBreaks: true, drawio: true, drawioPattern: 'drawio:{path}#{page}', style: s, doubleClickEdit: false, vim: false, colorTheme: 'ide', vimrc: [] });
          },
          [style, dark] as const,
        );
        await frames(page, 3);
        await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => undefined))));
        await expect(page).toHaveScreenshot(`${name}-${style}-${dark ? 'dark' : 'light'}.png`, SHOT);
      }
    }
  });
}
