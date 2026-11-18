import type { Page } from '@playwright/test';

import { expect, gotoHarness, openHarness, readCorpus, test } from './fixtures';
import { frames, sent, stableTopLine } from './helpers';

/*
 * L2 settings, styles and zoom (PROTOCOL.md 2.3 "Settings, style and zoom"): the full `settings`
 * message, feature toggles (source when off, no lazy chunk, no reload, no change, scroll kept),
 * built-in styles (`data-md-style`, user CSS wins), zoom requests (Ctrl/Cmd+wheel, Mod-= / Mod-+ /
 * Mod-- / Mod-0) and the `theme` font size with the scroll kept.
 */

interface Settings {
  remoteImages: boolean;
  math: boolean;
  mermaid: boolean;
  highlight: boolean;
  style: 'default' | 'compact' | 'serif';
}
const DEFAULTS: Settings = { remoteImages: false, math: true, mermaid: true, highlight: true, style: 'default' };

/** Sends a full 2.3 `settings` message; the page applies it in the next frame (after a scroll snapshot). */
async function settings(page: Page, s: Partial<Settings>): Promise<void> {
  await page.evaluate((m) => window.__harness.send(m), { type: 'settings', ...DEFAULTS, ...s });
  await frames(page, 2);
}

const theme = (page: Page, fontSizePx: number, zoom: number, dark = false) =>
  page.evaluate(([f, z, d]) => window.__harness.send({ type: 'theme', dark: d, fontFamily: 'sans-serif', fontSizePx: f, zoom: z }), [fontSizePx, zoom, dark] as const);

const caret = (page: Page, pos: number) => page.evaluate((p) => window.__harness.edit({ kind: 'cursor', from: p }), pos);

async function noPending(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelectorAll('.md-math-pending, .md-mermaid-pending').length === 0, null, { timeout: 30_000, polling: 'raf' });
}

/** Lazy chunk files under /app/assets/ requested by the page, in order. */
function assets(page: Page): string[] {
  const out: string[] = [];
  page.on('request', (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith('/app/assets/')) out.push(path.slice('/app/'.length));
  });
  return out;
}

const commands = async (page: Page) => (await sent(page, 'command')).map((c) => c['name']);
const markNoReload = (page: Page) => page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true));
const noReload = (page: Page) => page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload);

test('settings 2.3: the full message is accepted and remote images apply; other shapes are ignored', async ({ page, guard }) => {
  const text = '# T\n\n![remote](https://img.example/r.png)\n\nend\n';
  await openHarness(page, text);
  await caret(page, text.length);
  await page.route('https://img.example/**', (route) => route.fulfill({ status: 404 }));
  // The page CSP (img-src https://markdone.local/ data:) blocks the image in the browser test.
  guard.expectedViolations.push('img-src https://img.example/r.png');
  const placeholder = page.locator('.md-img-placeholder');
  await expect(placeholder).toHaveText('https://img.example/r.png');
  // The 2.2 shape, an unknown key, a wrong style: ignored (strict validation).
  for (const msg of [
    { type: 'settings', remoteImages: true },
    { type: 'settings', ...DEFAULTS, remoteImages: true, zoom: 1 },
    { type: 'settings', ...DEFAULTS, remoteImages: true, style: 'fancy' },
  ]) {
    await page.evaluate((m) => window.__harness.send(m), msg);
    await frames(page, 2);
    await expect(placeholder).toHaveCount(1);
    await expect(page.locator('html')).toHaveAttribute('data-md-style', 'default');
  }
  await settings(page, { remoteImages: true, style: 'serif' });
  await expect(page.locator('img.md-img[alt="remote"]')).toHaveAttribute('src', 'https://img.example/r.png');
  await expect(placeholder).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-md-style', 'serif');
  await settings(page, { remoteImages: false });
  await expect(placeholder).toHaveText('https://img.example/r.png');
  await expect(page.locator('html')).toHaveAttribute('data-md-style', 'default');
  expect(await page.evaluate(() => window.markdone?.__debug.docChanges('d1'))).toBe(0);
});

const HEAVY_DOC = [
  '# T',
  '',
  'Inline $x^2$ here.',
  '',
  '$$',
  '\\frac{a}{b}',
  '$$',
  '',
  '```mermaid',
  'flowchart LR',
  '  A --> B',
  '```',
  '',
  '```ts',
  'const x: number = 1;',
  '```',
  '',
  'end',
].join('\n');

test('feature toggles: off shows the source and loads no chunk; on renders again; no reload, no change', async ({ page, guard }) => {
  void guard;
  test.setTimeout(60_000);
  const requested = assets(page);
  await gotoHarness(page);
  await settings(page, { math: false, mermaid: false, highlight: false });
  const atStart = requested.length;
  await page.evaluate((t) => window.__harness.load('d1', t), HEAVY_DOC);
  await caret(page, HEAVY_DOC.length);
  await markNoReload(page);
  await frames(page, 3);
  await page.waitForTimeout(500);
  const source = async () => ({
    math: await page.locator('.md-math').count(),
    mermaid: await page.locator('.md-mermaid').count(),
    hljs: await page.locator('[class*="hljs-"]').count(),
    mermaidLines: await page.locator('.md-codeblock[data-lang="mermaid"]').count(),
    inline: await page.locator('.cm-line', { hasText: 'Inline $x^2$ here.' }).locator('.md-marker').allTextContents(),
    block: await page.locator('.cm-line', { hasText: '\\frac{a}{b}' }).count(),
  });
  const SOURCE = { math: 0, mermaid: 0, hljs: 0, mermaidLines: 4, inline: ['$', '$'], block: 1 };
  expect(await source()).toEqual(SOURCE);
  expect(requested.slice(atStart), 'no lazy chunk while the features are off').toEqual([]);
  expect((await page.evaluate(() => window.__harness.heavyStats())).chunks).toEqual([]);

  await settings(page, { math: true, mermaid: false, highlight: false });
  await noPending(page);
  await expect(page.locator('.md-math .katex')).toHaveCount(2);
  await expect(page.locator('.md-math-block')).toHaveCount(1);
  expect((await page.evaluate(() => window.__harness.heavyStats())).chunks).toEqual(['math']);
  await settings(page, { math: true, mermaid: true, highlight: false });
  await noPending(page);
  await expect(page.locator('.md-mermaid svg')).toHaveCount(1);
  expect((await page.evaluate(() => window.__harness.heavyStats())).chunks).toEqual(['math', 'mermaid']);
  await settings(page, { math: true, mermaid: true, highlight: true });
  await expect(page.locator('.cm-line', { hasText: 'const x' }).locator('.hljs-keyword')).toHaveText('const');
  expect((await page.evaluate(() => window.__harness.heavyStats())).chunks).toEqual(['math', 'mermaid', 'hljs', 'hljs:typescript']);

  await settings(page, { math: false, mermaid: false, highlight: false });
  await expect.poll(source).toEqual(SOURCE);
  await settings(page, {});
  await noPending(page);
  await expect(page.locator('.md-math .katex')).toHaveCount(2);
  await expect(page.locator('.md-mermaid svg')).toHaveCount(1);
  await expect(page.locator('.hljs-keyword').first()).toBeVisible();
  expect(await noReload(page)).toBe(true);
  expect(await page.evaluate(() => window.markdone?.__debug.docChanges('d1'))).toBe(0);
  expect(await sent(page, 'patch')).toEqual([]);
  expect(await page.evaluate(() => window.__harness.docText('d1'))).toBe(HEAVY_DOC);
});

test('feature toggles: a document activated after a toggle is drawn with the new settings', async ({ page, guard }) => {
  void guard;
  await gotoHarness(page);
  await page.evaluate((t) => window.__harness.load('a', t), HEAVY_DOC);
  await caret(page, HEAVY_DOC.length);
  await noPending(page);
  await expect(page.locator('.md-math-block')).toHaveCount(1);
  await page.evaluate(() => window.__harness.load('b', '# B\n'));
  await settings(page, { math: false, mermaid: false });
  await page.evaluate(() => window.__harness.activate('a'));
  await frames(page, 3);
  expect(await page.locator('.md-math').count()).toBe(0);
  expect(await page.locator('.md-mermaid').count()).toBe(0);
  await page.evaluate(() => window.__harness.activate('b'));
  await settings(page, {});
  await page.evaluate(() => window.__harness.activate('a'));
  await noPending(page);
  await expect(page.locator('.md-math-block')).toHaveCount(1);
  await expect(page.locator('.md-mermaid svg')).toHaveCount(1);
});

const OFF = { math: false, mermaid: false, highlight: false };

test('feature toggles: a document opened while on and activated after a toggle off loads no chunk', async ({ page, guard }) => {
  void guard;
  const requested = assets(page);
  await gotoHarness(page);
  await page.evaluate(() => window.__harness.load('b', '# B\n'));
  // Built with all features on (its block widgets too), not shown.
  await page.evaluate((t) => window.__harness.open('a', t), HEAVY_DOC);
  await settings(page, OFF);
  const atStart = requested.length;
  await page.evaluate(() => window.__harness.activate('a'));
  await frames(page, 3);
  await page.waitForTimeout(500);
  expect(requested.slice(atStart), 'no lazy chunk for a feature that is off').toEqual([]);
  expect((await page.evaluate(() => window.__harness.heavyStats())).chunks).toEqual([]);
  expect(await page.locator('.md-math, .md-mermaid').count()).toBe(0);
});

test('feature toggles: `settings` and `activate` in the same frame: the document is drawn with the new toggles', async ({ page, guard }) => {
  void guard;
  const requested = assets(page);
  await gotoHarness(page);
  await page.evaluate(() => window.__harness.load('b', '# B\n'));
  // Like Kotlin at startup: `open` first, then `settings` and `activate` before the next frame.
  await page.evaluate((t) => window.__harness.open('a', t), HEAVY_DOC);
  const atStart = requested.length;
  await page.evaluate((s) => {
    window.__harness.send({ type: 'settings', ...s });
    window.__harness.send({ type: 'activate', docId: 'a' });
  }, { ...DEFAULTS, ...OFF });
  await frames(page, 3);
  await page.waitForTimeout(500);
  expect(requested.slice(atStart), 'no lazy chunk for a feature that is off').toEqual([]);
  expect((await page.evaluate(() => window.__harness.heavyStats())).chunks).toEqual([]);
  expect(await page.locator('.md-math, .md-mermaid').count()).toBe(0);
});

test('look change: a restore of the previous document is never applied to a newly activated document', async ({ page, guard }) => {
  void guard;
  const text = readCorpus('medium.md');
  await openHarness(page, text, 'a');
  /*
   * `b`: one short line per character of `a`. Shown for the first time, it keeps the pixel scroll
   * offset (about the same line number as in `a`); a snapshot of `a` (position based) would put it
   * near line text.length / 4.
   */
  await page.evaluate((t) => window.__harness.open('b', t), 'x\n'.repeat(text.length));
  await theme(page, 14, 1);
  await page.evaluate((p) => window.__harness.scrollTo(p), Math.floor(text.length / 2));
  expect(await stableTopLine(page)).toBeGreaterThan(100);
  await page.evaluate(async () => {
    window.__harness.send({ type: 'theme', dark: false, fontFamily: 'sans-serif', fontSizePx: 14, zoom: 1.5 });
    // This rAF callback runs after CodeMirror's measure of this frame: the look restore of `a` is in progress.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    window.__harness.send({ type: 'activate', docId: 'b' });
    window.__harness.send({ type: 'theme', dark: false, fontFamily: 'sans-serif', fontSizePx: 14, zoom: 2 });
  });
  expect(await page.evaluate(() => window.markdone?.__debug.activeDocId())).toBe('b');
  const top = await stableTopLine(page);
  console.log(`look change after a state swap: first visible line of b ${top} (a snapshot of a: ~${Math.floor(text.length / 4)})`);
  expect(top).toBeLessThan(text.length / 16);
});

test('look change during the activation scroll restore keeps the first visible line', async ({ page, guard }) => {
  void guard;
  const text = readCorpus('m4/math-heavy.md');
  await openHarness(page, text, 'a');
  await page.evaluate(() => window.__harness.load('b', '# B\n'));
  await page.evaluate(() => window.__harness.activate('a'));
  await theme(page, 14, 1);
  await page.evaluate((p) => window.__harness.scrollTo(p), Math.floor(text.length / 2));
  await noPending(page);
  const top = await stableTopLine(page);
  expect(top).toBeGreaterThan(50);
  await page.evaluate(() => window.__harness.activate('b'));
  await page.evaluate(async () => {
    window.__harness.send({ type: 'activate', docId: 'a' });
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    window.__harness.send({ type: 'theme', dark: false, fontFamily: 'sans-serif', fontSizePx: 14, zoom: 1.5 });
  });
  await noPending(page);
  const now = await stableTopLine(page);
  expect(Math.abs(now - top), `first visible line ${top} -> ${now}`).toBeLessThanOrEqual(1);
});

test('feature toggles and styles keep the first visible line', async ({ page, guard }) => {
  void guard;
  test.setTimeout(90_000);
  const text = readCorpus('m4/math-heavy.md');
  await openHarness(page, text);
  await theme(page, 14, 1);
  await page.evaluate((p) => window.__harness.scrollTo(p), Math.floor(text.length / 2));
  await noPending(page);
  const height = () => page.evaluate(() => (document.querySelector('.cm-content') as HTMLElement).offsetHeight);
  let top = await stableTopLine(page);
  expect(top).toBeGreaterThan(50);
  const deltas: string[] = [];
  for (const s of [{ math: false }, {}, { style: 'compact' }, { style: 'serif' }, { style: 'serif', math: false }, {}] as Partial<Settings>[]) {
    const h0 = await height();
    await settings(page, s);
    await noPending(page);
    const now = await stableTopLine(page);
    deltas.push(`${JSON.stringify(s)}:${now - top} (height ${h0} -> ${await height()})`);
    expect(Math.abs(now - top), deltas.join(', ')).toBeLessThanOrEqual(1);
    top = now;
  }
  console.log(`toggles and styles, first visible line deltas: ${deltas.join(', ')}`);
  expect(await page.evaluate(() => window.markdone?.__debug.docChanges('d1'))).toBe(0);
});

/* ---------- Built-in styles ---------- */

test('styles: data-md-style sets the style variables in light and dark; user CSS wins', async ({ page, guard }) => {
  void guard;
  await openHarness(page, '# Title\n\nSome text.\n');
  await theme(page, 14, 1);
  await caret(page, 0);
  await frames(page, 2);
  const look = () =>
    page.evaluate(() => {
      const content = document.querySelector('.cm-content') as HTMLElement;
      const scroller = getComputedStyle(document.querySelector('.cm-scroller') as Element);
      const h1 = document.querySelector('.md-h1') as HTMLElement;
      return {
        fontSize: getComputedStyle(document.body).fontSize,
        lineHeight: scroller.lineHeight,
        font: scroller.fontFamily.split(',')[0],
        maxWidth: getComputedStyle(content).maxWidth,
        padding: getComputedStyle(content).padding,
        h1: getComputedStyle(h1).fontSize,
        h1Weight: getComputedStyle(h1).fontWeight,
        h1Space: getComputedStyle(h1).paddingTop,
        bg: getComputedStyle(document.querySelector('.cm-editor') as Element).backgroundColor,
      };
    });
  const DEFAULT = { fontSize: '14px', lineHeight: '22.4px', font: '"sans-serif"', maxWidth: '916px', padding: '16px 32px 64px', h1: '28px', h1Weight: '600', h1Space: '0px', bg: 'rgb(255, 255, 255)' };
  expect(await look()).toEqual(DEFAULT);
  await expect(page.locator('html')).toHaveAttribute('data-md-style', 'default');
  await settings(page, { style: 'compact' });
  const compact = { fontSize: '13.02px', lineHeight: '18.228px', font: '"sans-serif"', maxWidth: '1100px', padding: '8px 20px 32px', h1: '19.53px', h1Weight: '600', h1Space: '0px', bg: 'rgb(255, 255, 255)' };
  expect(await look()).toEqual(compact);
  await settings(page, { style: 'serif' });
  const serif = { fontSize: '16.1px', lineHeight: '28.175px', font: 'Charter', maxWidth: '720px', padding: '32px 40px 96px', h1: '35.42px', h1Weight: '700', h1Space: '17.71px', bg: 'rgb(255, 255, 255)' };
  expect(await look()).toEqual(serif);
  // Dark: the same style, the dark colours.
  await theme(page, 14, 1, true);
  await frames(page, 2);
  expect(await look()).toEqual({ ...serif, bg: 'rgb(30, 31, 34)' });
  await settings(page, { style: 'compact' });
  expect(await look()).toEqual({ ...compact, bg: 'rgb(30, 31, 34)' });
  // User CSS (layer user) wins over the style variables.
  await page.evaluate(() => window.__harness.send({ type: 'css', global: ':root { --md-max-width: 500px; --md-line-height: 2; --md-h1-size: 3em; }', project: null }));
  await frames(page, 2);
  expect(await look()).toMatchObject({ maxWidth: '500px', lineHeight: '26.04px', h1: '39.06px', padding: '8px 20px 32px' });
  await settings(page, {});
  expect(await look()).toMatchObject({ maxWidth: '500px', lineHeight: '28px', h1: '42px', padding: '16px 32px 64px', fontSize: '14px' });
  // The heading space and the content padding (set through editorTheme, unlayered) follow user CSS too, in every style.
  await page.evaluate(() => window.__harness.send({ type: 'css', global: ':root { --md-heading-space: 5px; --md-content-padding: 1px 2px 3px; }', project: null }));
  await frames(page, 2);
  for (const style of ['default', 'compact', 'serif'] as const) {
    await settings(page, { style });
    expect(await look(), style).toMatchObject({ h1Space: '5px', padding: '1px 2px 3px' });
  }
});

/* ---------- Zoom ---------- */

test('zoom: Mod-= / Mod-+ / Mod-- / Mod-0 and Ctrl+wheel send zoom commands; the page does not zoom or scroll', async ({ page, guard }) => {
  void guard;
  const text = readCorpus('medium.md');
  await openHarness(page, text);
  await page.locator('.cm-content').click();
  await page.evaluate(() => window.__harness.clearLog());
  await page.keyboard.press('Control+Equal');
  await page.keyboard.press('Control+Shift+Equal');
  await page.keyboard.press('Control+Minus');
  await page.keyboard.press('Control+0');
  await expect.poll(() => commands(page)).toEqual(['zoomIn', 'zoomIn', 'zoomOut', 'zoomReset']);
  expect(await page.evaluate(() => window.__harness.docText('d1'))).toBe(text);

  // Ctrl+wheel (real input): a zoom request, no scroll and no browser zoom.
  await page.evaluate(() => window.__harness.clearLog());
  await page.mouse.move(300, 300);
  const before = await page.evaluate(() => ({ top: window.__harness.scrollTop(), scale: window.visualViewport?.scale, dpr: window.devicePixelRatio }));
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(80);
  await page.mouse.wheel(0, 120);
  await page.keyboard.up('Control');
  await frames(page, 2);
  await expect.poll(() => commands(page)).toEqual(['zoomIn', 'zoomOut']);
  expect(await page.evaluate(() => ({ top: window.__harness.scrollTop(), scale: window.visualViewport?.scale, dpr: window.devicePixelRatio }))).toEqual(before);
  // Without Ctrl the wheel still scrolls.
  await page.mouse.wheel(0, 400);
  await expect.poll(() => page.evaluate(() => window.__harness.scrollTop())).toBeGreaterThan(before.top);

  // Throttle: a burst of Ctrl+wheel events gives one command; every event is default-prevented.
  await page.evaluate(() => window.__harness.clearLog());
  const prevented = await page.evaluate(() => {
    const target = document.querySelector('.cm-content') as HTMLElement;
    const out: boolean[] = [];
    for (let i = 0; i < 20; i++) {
      const e = new WheelEvent('wheel', { deltaY: -10, ctrlKey: true, bubbles: true, cancelable: true });
      target.dispatchEvent(e);
      out.push(e.defaultPrevented);
    }
    const meta = new WheelEvent('wheel', { deltaY: 100, metaKey: true, bubbles: true, cancelable: true });
    setTimeout(() => target.dispatchEvent(meta), 60);
    return out;
  });
  expect(prevented.every(Boolean)).toBe(true);
  await page.waitForTimeout(100);
  expect(await commands(page)).toEqual(['zoomIn', 'zoomOut']);

  // A touchpad: many small deltas over time give one step per 100 px (not one per 50 ms); lines count 40 px.
  await page.evaluate(() => window.__harness.clearLog());
  const small = await page.evaluate(async () => {
    const target = document.querySelector('.cm-content') as HTMLElement;
    let prevented = 0;
    for (let i = 0; i < 60; i++) {
      const e = new WheelEvent('wheel', { deltaY: -4, ctrlKey: true, bubbles: true, cancelable: true });
      target.dispatchEvent(e);
      if (e.defaultPrevented) prevented++;
      await new Promise((r) => setTimeout(r, 10));
    }
    await new Promise((r) => setTimeout(r, 60));
    for (let i = 0; i < 3; i++) {
      target.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, deltaMode: WheelEvent.DOM_DELTA_LINE, ctrlKey: true, bubbles: true, cancelable: true }));
    }
    return prevented;
  });
  expect(small).toBe(60);
  expect(await commands(page)).toEqual(['zoomIn', 'zoomIn', 'zoomOut']);
  expect(await sent(page, 'patch')).toEqual([]);
});

test('zoom: a theme with another zoom changes the font size and keeps the first visible line', async ({ page, guard }) => {
  void guard;
  const text = readCorpus('medium.md');
  await openHarness(page, text);
  await theme(page, 14, 1);
  await page.evaluate((p) => window.__harness.scrollTo(p), Math.floor(text.length / 2));
  let top = await stableTopLine(page);
  expect(top).toBeGreaterThan(100);
  const deltas: string[] = [];
  for (const zoom of [1.5, 2, 0.7, 1]) {
    await theme(page, 14, zoom);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe(`${Math.round(14 * zoom * 100) / 100}px`);
    const now = await stableTopLine(page);
    deltas.push(`${zoom}:${now - top}`);
    expect(Math.abs(now - top), deltas.join(' ')).toBeLessThanOrEqual(1);
    top = now;
  }
  console.log(`zoom theme, first visible line deltas: ${deltas.join(' ')}`);
  expect(await page.evaluate(() => window.markdone?.__debug.docChanges('d1'))).toBe(0);
});
