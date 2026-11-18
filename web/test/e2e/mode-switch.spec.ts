import type { Page } from '@playwright/test';

import { expect, gotoHarness, readCorpus, test } from './fixtures';
import { frames, hugeText, sent, stableTopLine } from './helpers';

/*
 * L2 mode switch sync (protocol 2.4): `viewport` (throttled, and before the flush reply) and
 * `activate` with `top` and `selection` (the IDE's Source -> Edit).
 */

/** Offset of the start of line `n` (1-based) of `text`. */
function lineStart(text: string, n: number): number {
  let pos = 0;
  for (let i = 1; i < n; i++) pos = text.indexOf('\n', pos) + 1;
  return pos;
}

/** `activate` with `top` and `selection`, as Kotlin sends it on Source -> Edit; waits for `activated`. */
async function activateAt(page: Page, docId: string, top: number, anchor: number, head: number): Promise<void> {
  const before = (await sent(page, 'activated')).length;
  await page.evaluate((m) => window.__harness.send(m), { type: 'activate', docId, top, selection: { anchor, head } });
  await page.waitForFunction((n) => window.__harness.log().filter((e) => e.msg.type === 'activated').length > n, before);
}

test('viewport: wheel scrolls send at most one per 100 ms; the last one has the first visible line and the selection', async ({ page, guard }) => {
  void guard;
  await gotoHarness(page);
  const text = readCorpus('medium.md');
  await page.evaluate(([t]) => window.__harness.load('m', t), [text] as const);
  await page.evaluate(() => window.__harness.edit({ kind: 'select', ranges: [[30, 40]] }));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__harness.clearLog());
  const box = await page.locator('.cm-scroller').boundingBox();
  if (!box) throw new Error('no .cm-scroller');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 30; i++) {
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(400);
  const log = (await page.evaluate(() => window.__harness.log())).filter((e) => e.msg.type === 'viewport');
  const gaps = log.slice(1).map((e, i) => e.t - (log[i]?.t ?? 0));
  console.log(`viewport: ${log.length} messages for 30 wheel events over ~${30 * 16} ms; gaps ${gaps.map((g) => Math.round(g)).join(' ')} ms`);
  expect(log.length).toBeGreaterThan(1);
  for (const g of gaps) expect(g).toBeGreaterThanOrEqual(99);
  expect(log.every((e) => e.fn === 'ready')).toBe(true);
  const top = await stableTopLine(page);
  expect(top).toBeGreaterThan(50);
  expect(log.at(-1)?.msg).toEqual({ type: 'viewport', docId: 'm', top: lineStart(text, top), anchor: 30, head: 40 });
});

test('viewport: sent just before the flush reply, with the current values', async ({ page, guard }) => {
  void guard;
  await gotoHarness(page);
  const text = readCorpus('medium.md');
  await page.evaluate(([t]) => window.__harness.load('m', t), [text] as const);
  await page.evaluate((p) => window.__harness.scrollTo(p), Math.floor(text.length / 2));
  const top = await stableTopLine(page);
  const anchor = lineStart(text, top + 3);
  await page.evaluate((a) => window.__harness.edit({ kind: 'select', ranges: [[a + 5, a]] }), anchor);
  await page.evaluate(() => window.__harness.clearLog());
  // Kotlin's flush (as before undo, and before the Edit -> Source switch).
  await page.evaluate(() => window.__harness.undo('m'));
  const log = (await page.evaluate(() => window.__harness.log())).map((e) => e.msg);
  const reply = log.findIndex((m) => m.type === 'patch');
  expect(reply).toBeGreaterThan(0);
  expect(log[reply - 1]).toEqual({ type: 'viewport', docId: 'm', top: lineStart(text, await stableTopLine(page)), anchor: anchor + 5, head: anchor });
});

test('activate with top and selection: that line at the top and the selection, also for the active document and a 20 MB document', async ({ page, guard }) => {
  void guard;
  test.setTimeout(180_000);
  await gotoHarness(page);
  const medium = readCorpus('medium.md');
  await page.evaluate(([t]) => window.__harness.load('m', t), [medium] as const);
  await page.evaluate(() => window.__harness.load('o', '# Other\n'));
  // Another document is active (Source mode of `m` shown elsewhere): `m` comes back at line 2000, not at its saved scroll.
  const cases: [string, number][] = [
    ['m', 2000],
    // The active document again (one tab: Source -> Edit -> Source -> Edit).
    ['m', 300],
  ];
  const huge = hugeText();
  for (const [docId, line] of cases) {
    const top = lineStart(medium, line) + 3;
    await activateAt(page, docId, top, lineStart(medium, line + 2), lineStart(medium, line + 2) + 4);
    // ±1 as the tab-switch restore (editor.spec): lazy highlighting can change heights after the restore frames.
    expect(Math.abs((await stableTopLine(page)) - line), `${docId} at line ${line}`).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => window.__harness.selection())).toEqual([[lineStart(medium, line + 2), lineStart(medium, line + 2) + 4]]);
  }
  // Without the fields (tab switch): the saved scroll position stays.
  const saved = await stableTopLine(page);
  await page.evaluate(() => window.__harness.activate('o'));
  await page.evaluate(() => window.__harness.activate('m'));
  await frames(page, 2);
  expect(Math.abs((await stableTopLine(page)) - saved)).toBeLessThanOrEqual(1);
  // 20 MB (windowed parse): the target is parsed and decorated in the first frame.
  await page.evaluate(([t]) => window.__harness.open('h', t), [huge] as const);
  const line = Math.floor(huge.split('\n').length * 0.7);
  const pos = lineStart(huge, line);
  await activateAt(page, 'h', pos, pos, pos);
  expect(await page.evaluate(() => window.__harness.viewportNodes()), 'decorated at the first paint').toBeGreaterThan(0);
  expect(Math.abs((await stableTopLine(page)) - line)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => window.__harness.selection())).toEqual([[pos, pos]]);
  // Values outside the document are clamped.
  await activateAt(page, 'o', 10_000_000, 10_000_000, 3);
  expect(await page.evaluate(() => window.__harness.selection())).toEqual([[8, 3]]);
});
