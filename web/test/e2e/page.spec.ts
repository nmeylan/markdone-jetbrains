import { expect, gotoHarness, idle, injectHost, openHarness, readCorpus, test } from './fixtures';
import { frames, sent } from './helpers';

/*
 * L2: the real page (index.html, host injected like Kotlin after load end) and the harness page
 * (mock host): boot, open/activate, loadError, BOM/CRLF, theme, writable, keys, context menu,
 * links, raw HTML. Every test runs with the CSP header and fails on a CSP violation or a request
 * outside https://markdone.local/ (fixtures.ts guard).
 */

type HostLog = { fn: string; msg: Record<string, unknown> }[];
const hostLog = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as { __hostLog: HostLog }).__hostLog);

test('real page: ready v2 when the host appears; open, activate, flush; perf marks', async ({ page, guard }) => {
  guard.docs.set('d1', { text: readCorpus('small.md'), stamp: 4242 });
  await page.goto('/app/index.html');
  await page.waitForFunction(() => 'markdone' in window);
  await injectHost(page);
  await page.evaluate(() => window.markdone?.receive({ type: 'open', docId: 'd1', writable: true }));
  await page.waitForFunction(() => (window as unknown as { __hostLog: unknown[] }).__hostLog.length >= 2);
  await page.evaluate(() => window.markdone?.receive({ type: 'activate', docId: 'd1' }));
  await page.waitForFunction(() => (window as unknown as { __hostLog: unknown[] }).__hostLog.length >= 3);
  await page.evaluate(() => window.markdone?.receive({ type: 'flush', docId: 'd1', seq: 9 }));
  await idle(page);
  expect(await hostLog(page)).toEqual([
    { fn: 'ready', msg: { type: 'ready', protocol: 2 } },
    { fn: 'ready', msg: { type: 'opened', docId: 'd1', docStamp: 4242 } },
    { fn: 'ready', msg: { type: 'activated', docId: 'd1' } },
    // Protocol 2.4: the viewport of the active document just before the flush reply.
    { fn: 'ready', msg: { type: 'viewport', docId: 'd1', top: 0, anchor: 0, head: 0 } },
    { fn: 'patch', msg: { type: 'patch', docId: 'd1', seq: 9, baseStamp: 4242, patches: [] } },
  ]);
  expect(Object.keys(await page.evaluate(() => window.markdone?.perf() ?? {})).sort()).toEqual(['bootMs', 'readyMs']);
  expect(Object.keys(await page.evaluate(() => window.markdone?.perf('d1') ?? {})).sort()).toEqual(['activateMs', 'docFetchMs', 'openTotalMs', 'stateMs']);
  expect(await page.evaluate(() => window.markdone?.__debug.docChanges('d1'))).toBe(0);
  expect(await page.evaluate(() => [window.markdone?.__debug.activeDocId(), window.markdone?.__debug.docIds()])).toEqual(['d1', ['d1']]);
  // The caret is on line 1: its `#` is visible as a marker.
  await expect(page.locator('.md-h1').first()).toHaveText('# Project notes');
  await expect(page.locator('.md-h1 .md-marker').first()).toHaveText('#');
});

for (const [name, stamp, reason] of [
  ['no stamp header', null, 'stamp'],
  ['empty stamp', '', 'stamp'],
  ['stamp 1.5', '1.5', 'stamp'],
  ['stamp abc', 'abc', 'stamp'],
  ['HTTP 404', 'missing', 'fetch'],
] as const) {
  test(`real page: ${name} -> loadError ${reason}, no state`, async ({ page, guard }) => {
    if (stamp !== 'missing') guard.docs.set('d1', { text: '# Title\n', stamp });
    await page.goto('/app/index.html');
    await injectHost(page);
    await page.evaluate(() => window.markdone?.receive({ type: 'open', docId: 'd1', writable: true }));
    await page.waitForFunction(() => (window as unknown as { __hostLog: unknown[] }).__hostLog.length >= 2);
    expect((await hostLog(page))[1]).toEqual({ fn: 'ready', msg: { type: 'loadError', docId: 'd1', reason } });
    expect(await page.evaluate(() => window.markdone?.__debug.docIds())).toEqual([]);
  });
}

test('a leading BOM and CR characters are kept (offsets equal the Document)', async ({ page, guard }) => {
  const text = '﻿# Title\r\n\r\nText.\r\n';
  guard.docs.set('bom', { text, stamp: 3 });
  await gotoHarness(page);
  await page.evaluate(() => window.markdone?.receive({ type: 'open', docId: 'bom', writable: true }));
  await page.waitForFunction(() => window.__harness.log().some((e) => e.msg.type === 'opened'));
  expect(await page.evaluate(() => window.__harness.docText('bom'))).toBe(text);
});

test('theme, writable and invalid messages', async ({ page, guard }) => {
  void guard;
  await openHarness(page, '# Title\n\n- [ ] task\n');
  await page.evaluate(() => {
    window.markdone?.receive({ type: 'theme', dark: true, fontFamily: 'Inter', fontSizePx: 13, zoom: 2 });
    window.markdone?.receive({ type: 'writable', docId: 'd1', writable: false });
    window.markdone?.receive({ type: 'writable', docId: 'd1', writable: 'no' });
  });
  await expect(page.locator('html')).toHaveAttribute('data-ide-theme', 'dark');
  expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe('26px');
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
  // Read-only: a click on the check box does not change the text.
  await page.locator('input.md-task').click();
  await page.keyboard.type('x');
  await idle(page);
  expect(await page.evaluate(() => window.__harness.docText('d1'))).toBe('# Title\n\n- [ ] task\n');
  await page.evaluate(() => window.markdone?.receive({ type: 'writable', docId: 'd1', writable: true }));
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true');
  await page.evaluate(() => window.markdone?.receive({ type: 'theme', dark: false, fontFamily: 'Inter', fontSizePx: 13, zoom: 1 }));
  await expect(page.locator('html')).toHaveAttribute('data-ide-theme', 'light');
});

test('Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y send undo/redo commands and do not change the text', async ({ page, guard }) => {
  void guard;
  await openHarness(page, 'Hello\n');
  await page.evaluate(() => (window.__harness.options.autoUndo = false));
  await page.locator('.cm-content').click();
  await page.keyboard.press('End');
  await page.keyboard.type('abc');
  await page.evaluate(() => window.__harness.settled());
  const before = await page.evaluate(() => window.__harness.docText('d1'));
  const patches = (await sent(page, 'patch')).length;
  await page.keyboard.press('Control+z');
  // KeyZ with Shift gives key "Z" like a real keyboard ("Control+Shift+z" would send key "z").
  await page.keyboard.press('Control+Shift+KeyZ');
  await page.keyboard.press('Control+y');
  await page.keyboard.press('Control+Shift+Z');
  await idle(page);
  expect(await sent(page, 'command')).toEqual([
    { type: 'command', docId: 'd1', name: 'undo' },
    { type: 'command', docId: 'd1', name: 'redo' },
    { type: 'command', docId: 'd1', name: 'redo' },
    { type: 'command', docId: 'd1', name: 'redo' },
  ]);
  expect(await page.evaluate(() => window.__harness.docText('d1'))).toBe(before);
  expect((await sent(page, 'patch')).length).toBe(patches);
});

test('right click: no browser menu (preventDefault), command contextMenu with viewport coordinates and the main selection', async ({ page, guard }) => {
  void guard;
  await openHarness(page, 'First line\n\nSecond line with words\n');
  await page.evaluate(() => {
    const w = window as unknown as { __ctx: boolean[] };
    w.__ctx = [];
    window.addEventListener('contextmenu', (e) => w.__ctx.push(e.defaultPrevented));
  });
  const from = 'First line\n\n'.length;
  // Select the whole line, then right-click inside the selection.
  await page.evaluate((f) => window.__harness.edit({ kind: 'cursor', from: f }), from);
  await page.keyboard.press('Shift+End');
  const box = await page.locator('.cm-line', { hasText: 'Second' }).boundingBox();
  if (!box) throw new Error('no line');
  const x = Math.round(box.x + 20);
  const y = Math.round(box.y + box.height / 2);
  await page.mouse.click(x, y, { button: 'right' });
  await idle(page);
  expect(await page.evaluate(() => (window as unknown as { __ctx: boolean[] }).__ctx)).toEqual([true]);
  const commands = await sent(page, 'command');
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({ type: 'command', docId: 'd1', name: 'contextMenu', x, y });
  expect(commands[0]).toMatchObject({ from, to: from + 'Second line with words'.length });
});

test('Ctrl/Cmd-click on a link sends link and does not navigate', async ({ page, guard }) => {
  void guard;
  await openHarness(page, 'caret here\n\n[ext](https://example.com/x) [rel](docs/a.md) [anchor](#top) <https://auto.example/>\n');
  const url = page.url();
  for (const name of ['ext', 'rel', 'anchor']) {
    await page.locator('.md-link', { hasText: name }).click({ modifiers: ['ControlOrMeta'] });
  }
  await page.locator('.md-link', { hasText: 'auto.example' }).click({ modifiers: ['ControlOrMeta'] });
  await page.locator('.md-link', { hasText: 'ext' }).click();
  await idle(page);
  expect(page.url()).toBe(url);
  expect(await sent(page, 'link')).toEqual([
    { type: 'link', docId: 'd1', href: 'https://example.com/x', kind: 'external' },
    { type: 'link', docId: 'd1', href: 'docs/a.md', kind: 'relative' },
    { type: 'link', docId: 'd1', href: '#top', kind: 'anchor' },
    { type: 'link', docId: 'd1', href: 'https://auto.example/', kind: 'external' },
  ]);
});

test('raw HTML never executes and is shown as source', async ({ page, guard }) => {
  void guard;
  await openHarness(page, readCorpus('security/xss.md'));
  await frames(page, 2);
  await idle(page);
  expect(await page.evaluate(() => (window as unknown as { __xss?: string }).__xss)).toBeUndefined();
  // img.cm-widgetBuffer: CodeMirror's own cursor helpers next to widgets.
  expect(await page.locator('#app script, #app iframe, #app img:not(.cm-widgetBuffer), #app a').count()).toBe(0);
  await expect(page.locator('#app')).toContainText('<script>');
  await expect(page.locator('#app')).toContainText('<iframe');
  await expect(page.locator('.md-html-source').first()).toBeVisible();
  await page.locator('.md-link', { hasText: 'js link' }).click({ modifiers: ['ControlOrMeta'] });
  await idle(page);
  expect(await page.evaluate(() => (window as unknown as { __xss?: string }).__xss)).toBeUndefined();
});

test('Mod-f opens the CodeMirror search panel in the page (no command sent)', async ({ page, guard }) => {
  void guard;
  await openHarness(page, 'alpha beta\nbeta gamma\n');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+f');
  await expect(page.locator('.cm-search input[name="search"]')).toBeFocused();
  await page.keyboard.type('beta');
  await page.keyboard.press('Enter');
  await idle(page);
  expect(await sent(page, 'command')).toEqual([]);
  expect(await page.evaluate(() => window.__harness.docText('d1'))).toBe('alpha beta\nbeta gamma\n');
});
