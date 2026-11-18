import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import type { Page } from '@playwright/test';

import { DIST, dropReportKey, expect, gotoHarness, mergeReport, readCorpus, test } from './fixtures';
import { frames, hugeText, round, stats } from './helpers';

/*
 * L6 web perf. Results are merged into build/reports/perf.json with the keys of
 * perf-budget.json; web-only values use `web*` keys (reported, no budget).
 */
test.describe.configure({ mode: 'serial' });

// Keys from the earlier Milkdown editor, replaced by the keys below.
for (const key of ['webLoadSmallMs', 'webLoadMediumMs', 'webLoadLargeMs', 'webLoadHugeMs', 'webTypingMedianMs']) dropReportKey('perf.json', key);

/** open + activate through the mock host; returns the page measures of the document. */
async function openDoc(page: Page, id: string, text: string): Promise<Record<string, number>> {
  await page.evaluate(([d, t]) => window.__harness.load(d, t), [id, text] as const);
  return page.evaluate((d) => window.markdone?.perf(d) ?? {}, id);
}

test('open and activate: small, medium, large, huge (web* measures)', async ({ page, guard }) => {
  void guard;
  test.setTimeout(240_000);
  await gotoHarness(page);
  const out: Record<string, number> = {};
  for (const [name, key] of [
    ['small.md', 'Small'],
    ['medium.md', 'Medium'],
    ['large.md', 'Large'],
    ['huge.md', 'Huge'],
  ] as const) {
    const text = name === 'huge.md' ? hugeText() : readCorpus(name);
    // load() resolves on `activated`, which the page sends after the first paint of the document.
    const ms = await page.evaluate(async ([d, t]) => {
      const t0 = performance.now();
      await window.__harness.load(d, t);
      return performance.now() - t0;
    }, [key, text] as const);
    const p = await page.evaluate((d) => window.markdone?.perf(d) ?? {}, key);
    console.log(`${name}: open -> first frame ${round(ms)} ms, ${JSON.stringify(p)}`);
    expect(await page.evaluate(() => window.__harness.viewportNodes()), `${name}: viewport decorated at the first frame`).toBeGreaterThan(0);
    // Page side of hugeEditModeOpenMs (open -> first decorated frame; includes the /doc fetch).
    if (key === 'Huge') out['webHugeOpenMs'] = round(ms);
    out[`webOpenTotal${key}Ms`] = round(p['openTotalMs'] ?? NaN);
    out[`webActivate${key}Ms`] = round(p['activateMs'] ?? NaN);
    await page.evaluate((d) => window.__harness.close(d), key);
  }
  mergeReport('perf.json', out);
});

interface Typing {
  processing: ReturnType<typeof stats>;
  toFrame: ReturnType<typeof stats>;
  longTasks: number;
}

/*
 * 50 keystrokes at the caret:
 * - processing: keydown (event.timeStamp, capture listener) -> view update with the doc change
 *   done (DOM updated);
 * - toFrame: keydown -> next requestAnimationFrame callback.
 */
async function typing(page: Page, text: string, at: number, ready?: () => Promise<void>): Promise<Typing> {
  await gotoHarness(page);
  await openDoc(page, 't', text);
  const pos = await page.evaluate((p) => {
    const t = window.__harness.docText('t') ?? '';
    const i = t.indexOf('\n\n', p);
    return i < 0 ? t.length : i;
  }, at);
  await page.evaluate((p) => {
    window.__harness.scrollTo(p);
    window.__harness.edit({ kind: 'cursor', from: p });
  }, pos);
  await frames(page, 2);
  // Heavy blocks: the widgets around the caret are rendered before typing starts.
  await ready?.();
  await page.evaluate(() => window.__harness.forceViewport());
  await page.evaluate(() => {
    window.__harness.recordViewUpdates();
    const w = window as unknown as { __keys: { t0: number; frame?: number }[]; __long: number[] };
    w.__keys = [];
    w.__long = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__long.push(e.duration);
    }).observe({ type: 'longtask' });
    document.addEventListener(
      'keydown',
      (e) => {
        const key = { t0: e.timeStamp } as { t0: number; frame?: number };
        w.__keys.push(key);
        requestAnimationFrame(() => (key.frame = performance.now()));
      },
      true,
    );
  });
  for (let i = 0; i < 50; i++) {
    await page.keyboard.press(i % 10 === 9 ? 'Space' : 'KeyA');
    await frames(page, 2);
  }
  const { keys, updates, long } = await page.evaluate(() => ({
    keys: (window as unknown as { __keys: { t0: number; frame: number }[] }).__keys,
    updates: (window as unknown as { __viewUpdates: number[] }).__viewUpdates,
    long: (window as unknown as { __long: number[] }).__long,
  }));
  expect(keys).toHaveLength(50);
  const processing = keys.map((k, i) => {
    const next = keys[i + 1]?.t0 ?? Number.POSITIVE_INFINITY;
    const update = updates.find((t) => t >= k.t0 && t < next);
    expect(update, `view update for keystroke ${i}`).toBeDefined();
    return (update ?? NaN) - k.t0;
  });
  expect(await page.evaluate(() => window.__harness.docText('t')?.includes('aaaaaaaaa'))).toBe(true);
  await page.evaluate(() => window.__harness.settled());
  expect(await page.evaluate(() => window.__harness.docText('t') === window.__harness.hostText('t'))).toBe(true);
  expect(await page.evaluate(() => window.__harness.viewportNodes()), 'viewport decorated after typing').toBeGreaterThan(0);
  return { processing: stats(processing), toFrame: stats(keys.map((k) => k.frame - k.t0)), longTasks: long.length };
}

test('typing latency: medium.md (5 000 lines, middle) and huge.md (end)', async ({ page, guard }) => {
  void guard;
  test.setTimeout(300_000);
  const medium = readCorpus('medium.md');
  const m = await typing(page, medium, Math.floor(medium.length / 2));
  const huge = hugeText();
  const h = await typing(page, huge, huge.length - 20_000);
  console.log(`typing medium ${JSON.stringify(m)}\ntyping huge end ${JSON.stringify(h)}`);
  mergeReport('perf.json', {
    keystrokeProcessing5000LinesMs: m.processing.p95,
    keystrokeToFrame5000LinesMs: m.toFrame.p95,
    keystrokeProcessingHugeMs: h.processing.p95,
    keystrokeToFrameHugeMs: h.toFrame.p95,
    webTypingMedianMediumMs: m.toFrame.median,
    webTypingLongTasksHugeEnd: h.longTasks,
  });
});

// Windowed parse: the budget keys above type at the end of huge.md; start and middle are reported too.
test('typing latency: huge.md start and middle (web* measures)', async ({ page, guard }) => {
  void guard;
  test.setTimeout(300_000);
  const huge = hugeText();
  const start = await typing(page, huge, 1000);
  const middle = await typing(page, huge, Math.floor(huge.length / 2));
  console.log(`typing huge start ${JSON.stringify(start)}\ntyping huge middle ${JSON.stringify(middle)}`);
  mergeReport('perf.json', {
    webKeystrokeProcessingHugeStartMs: start.processing.p95,
    webKeystrokeToFrameHugeStartMs: start.toFrame.p95,
    webKeystrokeProcessingHugeMiddleMs: middle.processing.p95,
    webKeystrokeToFrameHugeMiddleMs: middle.toFrame.p95,
  });
});

/** Resolves when no element matches `selector` (pending math or Mermaid widgets). */
const noneLeft = (page: Page, selector: string) => () =>
  page.waitForFunction((s) => document.querySelectorAll(s).length === 0, selector, { timeout: 60_000, polling: 'raf' }).then(() => undefined);

// Typing between rendered formulas, diagrams and highlighted code blocks.
test('typing latency with heavy blocks on screen: math-heavy, mermaid-heavy, code-heavy (web* measures)', async ({ page, guard }) => {
  void guard;
  test.setTimeout(300_000);
  const math = readCorpus('m4/math-heavy.md');
  const m = await typing(page, math, Math.floor(math.length / 2), noneLeft(page, '.md-math-pending'));
  const mathShown = await page.locator('.md-math .katex').count();
  const mermaid = readCorpus('m4/mermaid-heavy.md');
  const g = await typing(page, mermaid, mermaid.indexOf('## Diagram 3') - 400, noneLeft(page, '.md-mermaid-pending'));
  const svgShown = await page.locator('.md-mermaid svg').count();
  const code = readCorpus('m4/code-heavy.md');
  const hl = () => page.waitForFunction(() => document.querySelectorAll('.md-codeblock [class*="hljs-"]').length > 20, null, { timeout: 30_000 }).then(() => undefined);
  const c = await typing(page, code, Math.floor(code.length / 2), hl);
  // Inside a ts block (the edited block is highlighted again in idle time, never in the keystroke).
  const tsBlock = code.indexOf('```ts\n', Math.floor(code.length / 2));
  const cb = await typing(page, code, code.indexOf('name: string;', tsBlock), hl);
  const heavy = await page.evaluate(() => window.__harness.heavyStats());
  console.log(
    `typing math-heavy ${JSON.stringify(m)} (${mathShown} formulas in the DOM)\ntyping mermaid-heavy ${JSON.stringify(g)} (${svgShown} diagrams in the DOM)\n` +
      `typing code-heavy prose ${JSON.stringify(c)}\ntyping code-heavy in a ts block ${JSON.stringify(cb)}; hljs ${JSON.stringify({ sync: heavy.hljsSync, idle: heavy.hljsIdle })}`,
  );
  expect(mathShown).toBeGreaterThan(5);
  expect(svgShown).toBeGreaterThan(0);
  mergeReport('perf.json', {
    webKeystrokeProcessingMathHeavyMs: m.processing.p95,
    webKeystrokeToFrameMathHeavyMs: m.toFrame.p95,
    webKeystrokeProcessingMermaidHeavyMs: g.processing.p95,
    webKeystrokeToFrameMermaidHeavyMs: g.toFrame.p95,
    webKeystrokeProcessingCodeHeavyMs: c.processing.p95,
    webKeystrokeToFrameCodeHeavyMs: c.toFrame.p95,
    webKeystrokeProcessingCodeBlockMs: cb.processing.p95,
    webKeystrokeToFrameCodeBlockMs: cb.toFrame.p95,
  });
});

test('tab switch: activate -> activated (first paint), p95 over 20 swaps medium/large', async ({ page, guard }) => {
  void guard;
  test.setTimeout(120_000);
  await gotoHarness(page);
  await openDoc(page, 'm', readCorpus('medium.md'));
  await openDoc(page, 'l', readCorpus('large.md'));
  const page_: number[] = [];
  const host: number[] = [];
  for (let k = 0; k < 20; k++) {
    const id = k % 2 ? 'm' : 'l';
    host.push(await page.evaluate((d) => window.__harness.activate(d), id));
    page_.push((await page.evaluate((d) => window.markdone?.perf(d)['activateMs'], id)) ?? NaN);
  }
  const s = stats(page_);
  console.log(`tab switch activateMs ${JSON.stringify(s)}; host-side activate -> activated ${JSON.stringify(stats(host))}`);
  mergeReport('perf.json', { webTabSwitchMs: s.p95 });
});

/*
 * jumpToEndHugeMs: jump at once after open (the boundary index is not scanned yet: worst case).
 * webJumpToEndHugeWarmMs: after the idle prefetch of the index. Then 300 frames of scrolling up
 * through the end region: frame p95 and frames with an unparsed viewport.
 */
test('jump to the end of huge.md: decorated frame (at once, after the index prefetch), scroll the end region', async ({ page, guard }) => {
  void guard;
  test.setTimeout(300_000);
  const huge = hugeText();
  await gotoHarness(page);
  await openDoc(page, 'h', huge);
  const cold = await page.evaluate(() => window.__harness.jumpToEnd());
  expect(Number.isFinite(cold.decoratedMs)).toBe(true);
  await page.evaluate((d) => window.__harness.close(d), 'h');
  await openDoc(page, 'w', huge);
  await page.waitForFunction(() => window.__harness.indexDone(), undefined, { timeout: 30_000, polling: 20 });
  await frames(page, 2);
  const warm = await page.evaluate(() => window.__harness.jumpToEnd());
  expect(Number.isFinite(warm.decoratedMs)).toBe(true);
  const scroll = await page.evaluate(async () => {
    const long: number[] = [];
    const obs = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) long.push(e.duration);
    });
    obs.observe({ type: 'longtask' });
    const times: number[] = [];
    let undecorated = 0;
    let last = performance.now();
    for (let i = 0; i < 300; i++) {
      window.__harness.setScrollTop(window.__harness.scrollTop() - 400);
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const now = performance.now();
      times.push(now - last);
      last = now;
      if (window.__harness.viewportNodes() === 0) undecorated++;
    }
    obs.disconnect();
    return { times, undecorated, longTasks: long.length };
  });
  const frameStats = stats(scroll.times);
  const ws = await page.evaluate(() => window.__harness.windowStats());
  console.log(`jump to end of huge.md: at once ${JSON.stringify(cold)}, after prefetch ${JSON.stringify(warm)}; scroll ${JSON.stringify({ ...frameStats, undecorated: scroll.undecorated, longTasks: scroll.longTasks })}; window parses ${ws.parses}, max ${round(ws.maxMs)} ms`);
  expect(scroll.undecorated, 'frames with an unparsed viewport while scrolling').toBe(0);
  mergeReport('perf.json', {
    jumpToEndHugeMs: round(cold.decoratedMs),
    webJumpToEndHugeFrameMs: round(cold.frameMs),
    webJumpToEndHugeWarmMs: round(warm.decoratedMs),
    webScrollEndHugeFrameP95Ms: frameStats.p95,
    webWindowParseMaxMs: round(ws.maxMs),
  });
});

/*
 * A document without safe boundaries (one 6 MB loose list) uses the normal parser. Not
 * budgeted (over budget by design); typing must stay correct (page text = host text).
 */
test('no-boundary document (6 MB loose list): normal parser, jump to end, typing at the end', async ({ page, guard }) => {
  void guard;
  test.setTimeout(300_000);
  const list = Array.from({ length: 200_000 }, (_, i) => `- item ${i} with some *text*\n`).join('\n');
  await gotoHarness(page);
  await openDoc(page, 'l', list);
  const jump = await page.evaluate(() => window.__harness.jumpToEnd());
  const typingEnd = await typing(page, list, list.length - 5000);
  const ws = await page.evaluate(() => window.__harness.windowStats());
  console.log(`loose list 6 MB: jump ${JSON.stringify(jump)}, typing end ${JSON.stringify(typingEnd)}, window stats ${JSON.stringify(ws)}`);
  expect(ws.parses, 'no window parse').toBe(0);
  expect(ws.fallbacks).toBeGreaterThan(0);
  mergeReport('perf.json', {
    webFallbackListJumpToEndMs: round(jump.decoratedMs),
    webFallbackListKeystrokeProcessingMs: typingEnd.processing.p95,
    webFallbackListKeystrokeToFrameMs: typingEnd.toFrame.p95,
  });
});

/*
 * externalChangeMs ("External change (1 edit) -> page updated"): `receive(change)`
 * -> view updated (DOM). To the next frame is reported as webExternalChangeToFrameMs: it adds the
 * wait for the next vsync (0-16.7 ms), which does not depend on the page.
 */
test('external change (1 edit) -> page updated, p95 of 30 on medium.md', async ({ page, guard }) => {
  void guard;
  await gotoHarness(page);
  const medium = readCorpus('medium.md');
  await openDoc(page, 'm', medium);
  const pos = Math.floor(medium.length / 2);
  await page.evaluate((p) => window.__harness.scrollTo(p), pos);
  await frames(page, 2);
  const times: { processingMs: number; frameMs: number }[] = [];
  for (let i = 0; i < 30; i++) {
    times.push(await page.evaluate((p) => window.__harness.externalChange('m', p), pos));
    await frames(page, 1);
  }
  expect(await page.evaluate(() => window.__harness.docText('m') === window.__harness.hostText('m'))).toBe(true);
  const processing = stats(times.map((t) => t.processingMs));
  const toFrame = stats(times.map((t) => t.frameMs));
  console.log(`external change: processing ${JSON.stringify(processing)}, to next frame ${JSON.stringify(toFrame)}`);
  mergeReport('perf.json', { externalChangeMs: processing.p95, webExternalChangeToFrameMs: toFrame.p95 });
});

test('JS heap per extra open document (medium.md)', async ({ page, guard }) => {
  void guard;
  test.setTimeout(120_000);
  await gotoHarness(page);
  const cdp = await page.context().newCDPSession(page);
  const heapMB = async () => {
    for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage');
    const { usedSize } = await cdp.send('Runtime.getHeapUsage');
    return usedSize / 1024 / 1024;
  };
  const medium = readCorpus('medium.md');
  await openDoc(page, 'base', '# Base\n');
  // Warm-up: one medium document opened and closed (code, caches).
  await openDoc(page, 'warm', medium);
  await page.evaluate(() => window.__harness.activate('base'));
  await page.evaluate(() => window.__harness.close('warm'));
  const before = await heapMB();
  const n = 3;
  for (let i = 0; i < n; i++) {
    await openDoc(page, `m${i}`, medium);
    await page.evaluate((p) => window.__harness.scrollTo(p), Math.floor(medium.length / 2));
    await frames(page, 2);
  }
  await page.evaluate(() => window.__harness.activate('base'));
  const after = await heapMB();
  await cdp.detach();
  const perDoc = (after - before) / n;
  console.log(`JS heap: before ${round(before)} MB, after ${n} medium docs ${round(after)} MB, per doc ${round(perDoc)} MB`);
  mergeReport('perf.json', { jsHeapPerDocMediumMB: round(perDoc) });
});

test('CSS swap: css received -> next animation frame, p95 of 30 on medium.md (cssSwapMs)', async ({ page, guard }) => {
  void guard;
  await gotoHarness(page);
  const medium = readCorpus('medium.md');
  await openDoc(page, 'c', medium);
  await page.evaluate((p) => window.__harness.scrollTo(p), Math.floor(medium.length / 2));
  await frames(page, 2);
  const doc = readFileSync(join(DIST, '../../docs/css.md'), 'utf8');
  const example = /## Example[\s\S]*?```css\n([\s\S]*?)```/.exec(doc)?.[1] ?? '';
  expect(example).toContain('--md-max-width');
  const values: number[] = [];
  for (let i = 0; i < 30; i++) {
    await page.evaluate((g) => window.__harness.send({ type: 'css', global: g, project: null }), i % 2 ? '' : example);
    await frames(page, 2);
    values.push(await page.evaluate(() => window.markdone?.perf()['cssSwapMs'] ?? NaN));
  }
  const s = stats(values);
  console.log(`css swap: ${JSON.stringify(s)}`);
  expect(await page.evaluate(() => window.markdone?.__debug.docChanges('c'))).toBe(0);
  mergeReport('perf.json', { cssSwapMs: s.p95 });
});

test('initial JS bundle size (gzip)', async ({ page, guard }) => {
  void page;
  void guard;
  // All scripts the real page loads at start: entry scripts and module preloads of index.html.
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  const files = [...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*rel="modulepreload"[^>]*\shref)="\.\/([^"]+\.js)"/g)].map((m) => m[1] as string);
  expect(files.length).toBeGreaterThan(0);
  const bytes = files.reduce((sum, f) => sum + gzipSync(readFileSync(join(DIST, f))).length, 0);
  console.log(`initial JS: ${files.join(', ')} = ${(bytes / 1024).toFixed(1)} KB gzip`);
  mergeReport('perf.json', { initialJsBundleGzipKB: round(bytes / 1024) });
});
