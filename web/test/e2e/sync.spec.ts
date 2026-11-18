import { expect, openHarness, readCorpus, test } from './fixtures';
import { rng, sent } from './helpers';

/*
 * L2 sync: page <-> mock host in both directions. The mock host applies patches
 * like Kotlin's PatchApplier after a random delay (stamp check; map through the event log or
 * reject + reload), injects external changes and runs undo/redo through flush.
 */

test('undo round trip: Ctrl+Z -> flush -> IDE undo -> change with selection; then Ctrl+Y redoes', async ({ page, guard }) => {
  void guard;
  await openHarness(page, 'Hello\n');
  await page.evaluate(() => window.__harness.edit({ kind: 'cursor', from: 5 }));
  await page.keyboard.type('XY');
  await page.evaluate(() => window.__harness.settled());
  expect(await page.evaluate(() => window.__harness.hostText('d1'))).toBe('HelloXY\n');
  await page.keyboard.press('Control+z');
  await page.evaluate(() => window.__harness.settled());
  const undone = await page.evaluate(() => window.__harness.hostText('d1'));
  expect(undone.length).toBeLessThan('HelloXY\n'.length);
  expect(await page.evaluate(() => window.__harness.docText('d1'))).toBe(undone);
  expect(await sent(page, 'command')).toEqual([{ type: 'command', docId: 'd1', name: 'undo' }]);
  // The IDE sent the caret with the change: one cursor at the end of the undone range.
  const sel = await page.evaluate(() => window.__harness.selection());
  expect(sel).toHaveLength(1);
  expect(sel[0]?.[0]).toBe(sel[0]?.[1]);
  await page.keyboard.press('Control+y');
  await page.evaluate(() => window.__harness.settled());
  expect(await page.evaluate(() => window.__harness.hostText('d1'))).toBe('HelloXY\n');
  expect(await page.evaluate(() => window.__harness.docText('d1'))).toBe('HelloXY\n');
});

test('paste with CRLF and CR: no CR in the patch, the host text has LF only', async ({ page, guard }) => {
  void guard;
  await openHarness(page, 'ab\n');
  await page.evaluate(() => window.__harness.edit({ kind: 'cursor', from: 1 }));
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', 'x\r\ny\rz\r\n');
    document.querySelector('.cm-content')?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.evaluate(() => window.__harness.settled());
  const patches = await sent(page, 'patch');
  expect(patches.length).toBeGreaterThan(0);
  expect(JSON.stringify(patches)).not.toContain('\\r');
  expect(await page.evaluate(() => window.__harness.hostText('d1'))).toBe('ax\ny\nz\nb\n');
  expect(await page.evaluate(() => window.__harness.docText('d1'))).toBe('ax\ny\nz\nb\n');
  expect(await page.evaluate(() => window.__harness.hostCounters('d1').rejects)).toBe(0);
});

/** A document of 2 MB or more (patches coalesced, at most one per 300 ms). */
const bigText = () => readCorpus('medium.md').repeat(8);

test('A25: a document of 2 MB or more sends at most one patch per 300 ms while typing; the host gets every key', async ({ page, guard }) => {
  void guard;
  test.setTimeout(120_000);
  const text = bigText();
  expect(text.length).toBeGreaterThan(2_000_000);
  await openHarness(page, text);
  await page.evaluate((p) => window.__harness.edit({ kind: 'cursor', from: p }), text.length - 1);
  await page.evaluate(() => window.__harness.clearLog());
  // 30 keys, ~40 ms apart (~1.2 s of typing).
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('KeyK');
    await page.waitForTimeout(40);
  }
  await page.evaluate(() => window.__harness.settled());
  const times = await page.evaluate(() => window.__harness.log().filter((e) => e.msg.type === 'patch').map((e) => e.t));
  const gaps = times.slice(1).map((t, i) => t - (times[i] as number));
  console.log(`A25: ${times.length} patches for 30 keys; gaps ${JSON.stringify(gaps.map(Math.round))}`);
  expect(times.length).toBeLessThan(10);
  expect(Math.min(...gaps)).toBeGreaterThanOrEqual(295);
  expect(await page.evaluate(() => window.__harness.hostText('d1') === window.__harness.docText('d1'))).toBe(true);
  expect(await page.evaluate(() => window.__harness.hostText('d1').endsWith(`${'k'.repeat(30)}\n`))).toBe(true);
});

for (const [file, steps, seed] of [
  ['small.md', 300, 11],
  ['medium.md', 150, 23],
  // Coalesced patches (timer), flush replies at once (undo/redo).
  ['medium.md x8 (2 MB or more)', 60, 31],
] as const) {
  test(`sync property: ${file}, random local edits (incl. multi-cursor, keyboard, undo/redo) and external changes, random ack delays`, async ({ page, guard }) => {
    void guard;
    test.setTimeout(240_000);
    await openHarness(page, file.startsWith('medium.md x8') ? bigText() : readCorpus(file));
    await page.evaluate(() => (window.__harness.options.ackDelay = [0, 25]));
    const r = rng(seed);
    const int = (n: number) => Math.floor(r() * n);
    const TEXTS = ['a', 'xyz', '\n', '**b**', '- [ ] t\n', '| a | b |\n', 'é', '😀', '', '\t', 'line\nline\n'];
    const counts: Record<string, number> = {};
    let settles = 0;
    for (let i = 0; i < steps; i++) {
      const len = await page.evaluate(() => window.__harness.docText('d1')?.length ?? 0);
      const near = int(len + 1);
      const pick = r();
      let kind: string;
      if (pick < 0.2) {
        kind = 'insert';
        await page.evaluate((o) => window.__harness.edit(o), { kind: 'insert', from: near, text: TEXTS[int(TEXTS.length)] ?? '' } as const);
      } else if (pick < 0.3) {
        kind = 'delete';
        await page.evaluate((o) => window.__harness.edit(o), { kind: 'delete', from: near, to: near + int(40), text: '' } as const);
      } else if (pick < 0.4) {
        kind = 'multi';
        const ranges = Array.from({ length: 2 + int(3) }, (): [number, number] => {
          const a = int(len + 1);
          return [a, a + (r() < 0.5 ? 0 : int(10))];
        });
        await page.evaluate((o) => window.__harness.edit(o), { kind: 'multi', ranges, text: TEXTS[int(TEXTS.length)] ?? '' } as const);
      } else if (pick < 0.55) {
        kind = 'keyboard';
        await page.evaluate((p) => window.__harness.edit({ kind: 'cursor', from: p }), near);
        await page.keyboard.type('k1');
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Enter');
      } else if (pick < 0.8) {
        kind = 'external';
        // Sequential changes on the host text as it is now (in the page, atomically).
        const picks = Array.from({ length: 1 + int(3) }, () => ({ at: r(), del: int(8), text: TEXTS[int(TEXTS.length)] ?? '' }));
        await page.evaluate((ps) => {
          // Applied to a local copy to keep each change relative to the text after the previous one.
          let text = window.__harness.hostText('d1');
          const changes = ps.map((p) => {
            const from = window.__harness.safePos(text, Math.floor(p.at * (text.length + 1)));
            const to = window.__harness.safePos(text, Math.min(text.length, from + p.del));
            text = text.slice(0, from) + p.text + text.slice(to);
            return { from, to, insert: p.text };
          });
          window.__harness.external('d1', changes);
        }, picks);
      } else if (pick < 0.9) {
        kind = 'undo';
        await page.evaluate(() => window.__harness.edit({ kind: 'cursor', from: 0 }));
        await page.keyboard.press('Control+z');
      } else {
        kind = 'redo';
        await page.evaluate(() => window.__harness.edit({ kind: 'cursor', from: 0 }));
        await page.keyboard.press('Control+y');
      }
      counts[kind] = (counts[kind] ?? 0) + 1;
      if (r() < 0.25) {
        settles++;
        await page.evaluate(() => window.__harness.settled());
        const same = await page.evaluate(() => window.__harness.hostText('d1') === window.__harness.docText('d1'));
        expect(same, `step ${i} (${kind})`).toBe(true);
      }
    }
    await page.evaluate(() => window.__harness.settled());
    expect(await page.evaluate(() => window.__harness.hostText('d1') === window.__harness.docText('d1'))).toBe(true);
    const host = await page.evaluate(() => window.__harness.hostCounters('d1'));
    const patches = (await sent(page, 'patch')).length;
    console.log(`${file}: ${JSON.stringify({ counts, settles, patches, ...host })}`);
    expect(host.mapped, 'some patches were mapped through external changes').toBeGreaterThan(0);
    expect(await sent(page, 'diverged'), 'length check').toEqual([]);
  });
}
