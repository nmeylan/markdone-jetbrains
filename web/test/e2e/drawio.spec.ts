import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { FrameLocator, Page } from '@playwright/test';

import { expect, gotoHarness, openHarness, test } from './fixtures';
import { frames } from './helpers';

/*
 * L2 draw.io (nmey/DRAWIO.md §7): the vendored viewer in a sandboxed frame under the frame CSP. The fixture
 * guard fails a test on any CSP violation of the page and any request outside https://markdone.local/.
 */

const SETTINGS = { type: 'settings', remoteImages: false, math: true, mermaid: true, highlight: true, softBreaks: true, drawio: true, drawioPattern: 'drawio:{path}#{page}', style: 'default', doubleClickEdit: false, vim: false, colorTheme: 'ide', vimrc: [] } as const;
const THEME = { type: 'theme', fontFamily: 'Arial', fontSizePx: 14, zoom: 1 } as const;

const asset = (name: string): string => readFileSync(fileURLToPath(new URL(`./assets/drawio/${name}`, import.meta.url)), 'utf8');

const frame = (page: Page, n = 0): FrameLocator => page.frameLocator('iframe.md-drawio-frame').nth(n);

/** The viewer builds its toolbar when the pointer enters the frame; true when its page buttons show (more than one page). */
async function hasPageButtons(page: Page, n: number): Promise<boolean> {
  const box = await page.locator('iframe.md-drawio-frame').nth(n).boundingBox();
  if (!box) throw new Error('no frame box');
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.move(box.x + 40, box.y + 30, { steps: 5 });
  await expect.poll(() => frame(page, n).locator('[title="Zoom In"]').count()).toBe(1);
  return frame(page, n).locator('[title="Next Page"]').isVisible();
}

/** Waits until a diagram is drawn in the n-th frame: SVG shapes in it, and the widget has its height. */
async function drawn(page: Page, n = 0): Promise<void> {
  await expect(page.locator('iframe.md-drawio-frame').nth(n)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => frame(page, n).locator('svg *').count(), { timeout: 30_000 }).toBeGreaterThan(3);
  await expect.poll(async () => (await page.locator('iframe.md-drawio-frame').nth(n).boundingBox())?.height ?? 0).toBeGreaterThan(40);
}

/** The caret starts at 0 and a paragraph that it touches shows its source: every document starts with a plain paragraph. */
const INTRO = 'Intro\n\n';

async function open(page: Page, text: string): Promise<void> {
  await openHarness(page, INTRO + text);
}

const header = (page: Page, n = 0) => page.locator('.md-drawio-header').nth(n);

test('the drawio: line draws the diagram in a sandboxed frame; the page runs no draw.io code', async ({ page, guard }) => {
  await open(page, 'Before\n\ndrawio:drawio/basic.drawio\n\nAfter\n');
  await drawn(page);
  await expect(header(page)).toHaveText('drawio/basic.drawio');
  expect(guard.drawioRequests).toEqual(['d1/drawio/basic.drawio']);
  const iframe = page.locator('iframe.md-drawio-frame');
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
  // The labels are in the frame, not in the page.
  await expect(frame(page).locator('body')).toContainText('Start');
  expect(await page.evaluate(() => document.querySelector('.md-drawio svg, .md-drawio .geDiagramContainer'))).toBeNull();
  expect(await page.evaluate(() => 'GraphViewer' in window || 'mxUtils' in window)).toBe(false);
  expect((await page.evaluate(() => window.__harness.heavyStats())).chunks).toEqual(['drawio']);
  // The frame is opaque: the page cannot read it.
  expect(await page.evaluate(() => { try { return (document.querySelector('iframe.md-drawio-frame') as HTMLIFrameElement).contentDocument === null; } catch { return true; } })).toBe(true);
});

test('image and link forms: alone in the paragraph a widget; with other text a normal link', async ({ page, guard }) => {
  await open(page, '![Arch](drawio/basic.drawio)\n\n[Link form](drawio/layers.drawio)\n\nSee [the diagram](drawio/basic.drawio) for details.\n');
  await expect(page.locator('.md-drawio')).toHaveCount(2);
  await drawn(page, 0);
  await drawn(page, 1);
  expect(guard.drawioRequests.sort()).toEqual(['d1/drawio/basic.drawio', 'd1/drawio/layers.drawio']);
  await expect(page.locator('.md-link', { hasText: 'the diagram' })).toBeVisible();
});

test('a page name draws only that page: no page tabs; without it all pages with tabs', async ({ page, guard }) => {
  void guard;
  await open(page, 'drawio:drawio/multi.drawio#Beta\n\ndrawio:drawio/multi.drawio\n');
  await drawn(page, 0);
  await drawn(page, 1);
  await expect(header(page, 0)).toHaveText('drawio/multi.drawio · Beta');
  await expect(frame(page, 0).locator('body')).toContainText('Beta only');
  // All pages: the first page shows, and the page buttons are in the toolbar (a one-page diagram has none).
  await expect(frame(page, 1).locator('body')).not.toContainText('Beta only');
  await expect(frame(page, 1).locator('#g[aria-label^="Alpha"]')).toHaveCount(1);
  expect(await hasPageButtons(page, 1)).toBe(true);
  expect(await hasPageButtons(page, 0)).toBe(false);
});

test('the dark theme draws the diagram in dark mode; a theme change rebuilds the frame', async ({ page, guard }) => {
  void guard;
  await open(page, 'drawio:drawio/basic.drawio\n');
  await drawn(page);
  await expect(frame(page).locator('.geDarkMode')).toHaveCount(0);
  await page.evaluate((m) => window.__harness.send({ ...m, dark: true }), THEME);
  await expect(frame(page).locator('.geDarkMode').first()).toBeAttached({ timeout: 30_000 });
  await drawn(page);
  expect(await page.locator('iframe.md-drawio-frame').count()).toBe(1);
});

test('the caret in the paragraph shows the source; a click on the header puts the caret in the source', async ({ page, guard }) => {
  void guard;
  const text = 'First\n\ndrawio:drawio/basic.drawio\n\nLast\n';
  await open(page, text);
  await drawn(page);
  await header(page).click();
  await expect(page.locator('.md-drawio')).toHaveCount(0);
  expect(await page.evaluate(() => window.__harness.selection())).toEqual([[INTRO.length + text.indexOf('drawio:'), INTRO.length + text.indexOf('drawio:')]]);
  await expect(page.locator('.cm-line', { hasText: 'drawio:drawio/basic.drawio' })).toBeVisible();
  // The caret leaves: the widget is back.
  await page.evaluate(() => window.__harness.edit({ kind: 'cursor', from: 0 }));
  await drawn(page);
});

test('error boxes: file not found, too large, not draw.io, page not found; text only', async ({ page, guard }) => {
  guard.drawio.set('d1/big.drawio', { body: '', status: 413 });
  guard.drawio.set('d1/html.drawio', { body: '<html><body><img src=x onerror=alert(1)></body></html>' });
  await open(page, 'drawio:missing.drawio\n\ndrawio:big.drawio\n\ndrawio:html.drawio\n\ndrawio:drawio/multi.drawio#Nope\n');
  const errors = page.locator('.md-drawio-error');
  await expect(errors).toHaveCount(4);
  await expect(errors.nth(0)).toHaveText('File not found: missing.drawio');
  await expect(errors.nth(1)).toHaveText('File too large: big.drawio');
  await expect(errors.nth(2)).toHaveText('Not a draw.io file');
  await expect(errors.nth(3)).toHaveText("Page 'Nope' not found");
  await expect(page.locator('iframe.md-drawio-frame')).toHaveCount(0);
  await expect(page.locator('.md-drawio img')).toHaveCount(0);
});

test('a file change rebuilds the widget with the new file; other files are not fetched again', async ({ page, guard }) => {
  await open(page, 'drawio:drawio/basic.drawio\n\ndrawio:drawio/layers.drawio\n');
  await drawn(page, 0);
  await drawn(page, 1);
  expect(guard.drawioRequests).toHaveLength(2);
  guard.drawio.set('d1/drawio/basic.drawio', { body: asset('multi.drawio').replace('Beta only', 'Changed') });
  await page.evaluate(() => window.__harness.send({ type: 'fileChanged', docId: 'd1', path: 'drawio/basic.drawio' }));
  await expect.poll(() => guard.drawioRequests.length, { timeout: 30_000 }).toBe(3);
  expect(guard.drawioRequests[2]).toBe('d1/drawio/basic.drawio');
  await expect(page.locator('iframe.md-drawio-frame')).toHaveCount(2);
  await expect.poll(() => frame(page, 0).locator('svg *').count(), { timeout: 30_000 }).toBeGreaterThan(3);
  expect(await hasPageButtons(page, 0)).toBe(true);
  // A message for another document or another path changes nothing.
  await page.evaluate(() => window.__harness.send({ type: 'fileChanged', docId: 'other', path: 'drawio/basic.drawio' }));
  await frames(page, 3);
  expect(guard.drawioRequests).toHaveLength(3);
});

test('at most 6 live frames; the others wait with a placeholder and take a free frame', async ({ page, guard }) => {
  void guard;
  await page.setViewportSize({ width: 1000, height: 3500 });
  await open(page, Array.from({ length: 8 }, (_, i) => `drawio:drawio/basic.drawio\n\nParagraph ${i}\n`).join('\n'));
  await expect(page.locator('.md-drawio')).toHaveCount(8);
  await expect.poll(() => page.locator('iframe.md-drawio-frame').count(), { timeout: 60_000 }).toBe(6);
  await frames(page, 5);
  expect(await page.locator('iframe.md-drawio-frame').count()).toBe(6);
  await expect(page.locator('.md-drawio-pending')).toHaveCount(2);
  // The caret goes into a paragraph with a frame: the frame is released and a waiting widget gets it.
  await page.evaluate((p) => window.__harness.edit({ kind: 'cursor', from: p }), 10);
  await expect.poll(() => page.locator('.md-drawio-pending').count(), { timeout: 60_000 }).toBe(1);
  await expect(page.locator('iframe.md-drawio-frame')).toHaveCount(6, { timeout: 60_000 });
});

test('the feature toggle off shows the source and loads no draw.io chunk', async ({ page, guard }) => {
  await gotoHarness(page);
  await page.evaluate((m) => window.__harness.send({ ...m, drawio: false }), SETTINGS);
  await page.evaluate(() => window.__harness.load('d1', 'Intro\n\ndrawio:drawio/basic.drawio\n\n![a](drawio/basic.drawio)\n'));
  await frames(page, 3);
  await expect(page.locator('.md-drawio')).toHaveCount(0);
  await expect(page.locator('.cm-line', { hasText: 'drawio:drawio/basic.drawio' })).toBeVisible();
  expect(guard.drawioRequests).toEqual([]);
  expect((await page.evaluate(() => window.__harness.heavyStats())).chunks).toEqual([]);
  // On again: the widgets come.
  await page.evaluate((m) => window.__harness.send(m), SETTINGS);
  await expect(page.locator('.md-drawio')).toHaveCount(2);
});

test('a custom pattern changes the drawio: line and the separator of the image form', async ({ page, guard }) => {
  void guard;
  await gotoHarness(page);
  await page.evaluate((m) => window.__harness.send({ ...m, drawioPattern: '[[draw {path}@@{page}]]' }), SETTINGS);
  await page.evaluate(() => window.__harness.load('d1', 'Intro\n\n[[draw drawio/multi.drawio@@Beta]]\n\n![x](drawio/multi.drawio@@Gamma)\n\ndrawio:drawio/basic.drawio\n'));
  await expect(page.locator('.md-drawio')).toHaveCount(2);
  await expect(header(page, 0)).toHaveText('drawio/multi.drawio · Beta');
  await expect(header(page, 1)).toHaveText('drawio/multi.drawio · Gamma');
  await expect(page.locator('.cm-line', { hasText: 'drawio:drawio/basic.drawio' })).toBeVisible();
});

test('a hostile diagram runs no script in the page, makes no request, causes no navigation', async ({ page, guard }) => {
  await open(page, 'drawio:drawio/hostile.drawio\n');
  await drawn(page);
  await frames(page, 10);
  const before = page.url();
  // Click every kind of link and cell in the frame.
  const inner = frame(page);
  for (const id of ['#jslink', '#extlink']) {
    if (await inner.locator(id).count()) await inner.locator(id).first().click({ force: true, timeout: 2000 }).catch(() => undefined);
  }
  await frames(page, 10);
  expect(page.url()).toBe(before);
  expect(page.frames().map((f) => f.url()).filter((u) => !u.startsWith('https://markdone.local/'))).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { __pwn?: unknown }).__pwn)).toBeUndefined();
  expect(await page.evaluate(() => Array.from(document.documentElement.attributes).filter((a) => a.name.startsWith('data-pwn')).length)).toBe(0);
  // Nor in the frame (the attribute that each payload sets on its own document).
  for (const f of page.frames().filter((x) => x !== page.mainFrame())) {
    expect(await f.evaluate(() => Array.from(document.documentElement.attributes).filter((a) => a.name.startsWith('data-pwn')).length)).toBe(0);
  }
  expect(guard.drawioRequests).toEqual(['d1/drawio/hostile.drawio']);
});

test('the frame cannot reach the page or the bridge, and has no way out', async ({ page, guard }) => {
  void guard;
  await open(page, 'drawio:drawio/basic.drawio\n');
  await drawn(page);
  const child = page.frames().find((f) => f !== page.mainFrame());
  if (!child) throw new Error('no child frame');
  const result = await child.evaluate(async () => {
    const out: Record<string, string> = {};
    const t = (k: string, fn: () => unknown) => {
      try {
        out[k] = String(fn());
      } catch (e) {
        out[k] = `throws ${(e as Error).name}`;
      }
    };
    t('origin', () => window.origin);
    t('parent.document', () => parent.document.title);
    t('top.location', () => top?.location.href);
    t('open', () => window.open('https://markdone.local/app/index.html'));
    const f = (url: string) => fetch(url).then((r) => String(r.status), () => 'blocked');
    out['fetch /doc'] = await f('https://markdone.local/doc/d1');
    out['fetch /drawio'] = await f('https://markdone.local/drawio/d1/drawio/basic.drawio');
    out['fetch /file'] = await f('https://markdone.local/file/d1/drawio%2Fbasic.drawio');
    out['fetch evil'] = await f('https://evil.example/a');
    return out;
  });
  expect(result['origin']).toBe('null');
  expect(result['parent.document']).toBe('throws SecurityError');
  expect(result['top.location']).toBe('throws SecurityError');
  expect(result['open']).toBe('null');
  expect(result['fetch /doc']).toBe('blocked');
  expect(result['fetch /drawio']).toBe('blocked');
  expect(result['fetch /file']).toBe('blocked');
  expect(result['fetch evil']).toBe('blocked');
});

test('messages that do not come from the frame are ignored', async ({ page, guard }) => {
  void guard;
  await open(page, 'drawio:drawio/basic.drawio\n');
  await drawn(page);
  const height = (await page.locator('iframe.md-drawio-frame').boundingBox())?.height ?? 0;
  await page.evaluate(() => {
    window.postMessage({ type: 'size', height: 5000 }, '*');
    window.postMessage({ type: 'error', message: 'fake' }, '*');
  });
  await frames(page, 5);
  expect((await page.locator('iframe.md-drawio-frame').boundingBox())?.height).toBe(height);
  await expect(page.locator('.md-drawio-error')).toHaveCount(0);
});

test('a diagram of the project: libraries and layers draw without error', async ({ page, guard }) => {
  void guard;
  await open(page, 'drawio:drawio/libs.drawio\n\ndrawio:drawio/layers.drawio\n\ndrawio:drawio/compressed.drawio\n');
  await drawn(page, 0);
  await drawn(page, 1);
  await drawn(page, 2);
  await expect(page.locator('.md-drawio-error')).toHaveCount(0);
});
