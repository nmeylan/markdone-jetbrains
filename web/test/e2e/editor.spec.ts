import { corpusFiles, expect, gotoHarness, idle, openHarness, readCorpus, test } from './fixtures';
import { frames, hugeText, sent, stableTopLine } from './helpers';

/*
 * L2 editor: zero change on the corpus, reveal, widgets, decoration work bounded by the
 * viewport, one view with one state per document, reload.
 */

test('zero change: every corpus file after open, activate, scroll, hide/show and re-activate', async ({ page, guard }) => {
  void guard;
  test.setTimeout(120_000);
  await gotoHarness(page);
  const files = corpusFiles();
  expect(files).toContain('styles/footnotes.md');
  for (const [i, file] of files.entries()) {
    const id = `z${i}`;
    // The IDE Document has `\n` line ends only.
    const text = readCorpus(file).replace(/\r\n?/g, '\n');
    await page.evaluate(([d, t]) => window.__harness.load(d, t), [id, text] as const);
    await page.evaluate(async () => {
      const s = document.querySelector('.cm-scroller') as HTMLElement;
      s.scrollTop = s.scrollHeight;
      await window.__harness.afterNextPaint();
      // Mode switch as the IDE does it: hide the browser component, show it again, focus moves.
      const app = document.getElementById('app') as HTMLElement;
      (document.querySelector('.cm-content') as HTMLElement).focus();
      app.style.display = 'none';
      await window.__harness.afterNextPaint();
      app.style.display = '';
      (document.activeElement as HTMLElement | null)?.blur();
      s.scrollTop = 0;
      await window.__harness.afterNextPaint();
    });
    await page.evaluate((d) => window.__harness.activate(d), id);
    await frames(page, 2);
    await idle(page);
    const r = await page.evaluate((d) => ({ doc: window.__harness.docText(d), changes: window.markdone?.__debug.docChanges(d) }), id);
    expect(r.doc, file).toBe(text);
    expect(r.changes, file).toBe(0);
    await page.evaluate((d) => window.__harness.close(d), id);
  }
  expect(await sent(page, 'patch'), 'no patch').toEqual([]);
  // Given CRLF directly (the IDE never sends it), `\r` is kept: lineSeparator "\n".
  const crlf = readCorpus('styles/crlf.md');
  expect(crlf).toContain('\r\n');
  guard.docs.set('crlf', { text: crlf, stamp: 1 });
  await page.evaluate(() => window.__harness.send({ type: 'open', docId: 'crlf', writable: true }));
  await page.waitForFunction(() => window.__harness.docText('crlf') !== null);
  await page.evaluate(() => window.__harness.activate('crlf'));
  expect(await page.evaluate(() => window.__harness.docText('crlf'))).toBe(crlf);
  expect(await page.evaluate(() => window.markdone?.__debug.docChanges('crlf'))).toBe(0);
});

const D11 = '# Head\n\n**bold** and *em* and `code` and ~~gone~~ [link](https://x.y)\n\n> quote\n\n- item\n';

test('D11: markers are visible on the caret/selection lines only', async ({ page, guard }) => {
  void guard;
  await openHarness(page, D11);
  const line = (n: number) => page.locator('.cm-line').nth(n);
  const markers = (n: number) => line(n).locator('.md-marker');
  const caret = (pos: number) => page.evaluate((p) => window.__harness.edit({ kind: 'cursor', from: p }), pos);
  // Caret on the empty line 2: nothing revealed.
  await caret(7);
  await expect(line(0)).toHaveText('Head');
  await expect(line(2)).toHaveText('bold and em and code and gone link');
  await expect(line(4)).toHaveText('quote');
  await expect(page.locator('.md-marker')).toHaveCount(0);
  await expect(line(0)).toHaveClass(/md-h1/);
  await expect(line(2).locator('.md-strong')).toHaveCount(1);
  await expect(line(6).locator('.md-bullet')).toHaveCount(1);
  // Caret on line 3: all its markers visible, other lines unchanged.
  await caret(D11.indexOf('and *em*'));
  await expect(line(2)).toHaveText('**bold** and *em* and `code` and ~~gone~~ [link](https://x.y)');
  expect(await markers(2).count()).toBeGreaterThanOrEqual(10);
  await expect(line(0)).toHaveText('Head');
  await expect(markers(0)).toHaveCount(0);
  // A selection from line 1 to line 3 reveals both ends and the line between.
  await page.evaluate(() => window.__harness.edit({ kind: 'select', ranges: [[2, 12]] }));
  await expect(line(0)).toHaveText('# Head');
  await expect(line(2)).toContainText('**bold**');
  await expect(line(4)).toHaveText('quote');
  // Two cursors (lines 5 and 7): both revealed, line 3 hidden again.
  await page.evaluate((d) => window.__harness.edit({ kind: 'select', ranges: [[d.indexOf('quote'), d.indexOf('quote')], [d.indexOf('item'), d.indexOf('item')]] }), D11);
  await expect(line(4)).toHaveText('> quote');
  await expect(line(6)).toHaveText('- item');
  await expect(line(2)).toHaveText('bold and em and code and gone link');
  await expect(line(0)).toHaveText('Head');
});

test('widgets: table until the caret enters, check box toggles, hr, data: image, front matter, footnotes, code language', async ({ page, guard }) => {
  void guard;
  const img = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const text = `---\ntitle: T\n---\n\nIntro[^1].\n\n| A | B |\n|---|--:|\n| 1 | 2 |\n\n- [ ] task\n\n***\n\n![dot](${img})\n\n\`\`\`kotlin\nval x = 1\n\`\`\`\n\n[^1]: Note.\n`;
  await openHarness(page, text);
  await page.evaluate(() => window.__harness.edit({ kind: 'cursor', from: 'abc'.length }));
  await expect(page.locator('.md-frontmatter')).toHaveCount(3);
  await expect(page.locator('.md-footnote')).toHaveCount(2);
  await expect(page.locator('.md-codeblock[data-lang="kotlin"]')).toHaveCount(3);
  await expect(page.locator('.md-hr')).toHaveCount(1);
  await expect(page.locator('img.md-img')).toHaveAttribute('alt', 'dot');
  const table = page.locator('.md-table');
  await expect(table).toHaveCount(1);
  await expect(table.locator('th').first()).toHaveText('A');
  await expect(table.locator('td').nth(1)).toHaveCSS('text-align', 'right');
  await table.locator('td').first().click();
  await expect(page.locator('.md-table')).toHaveCount(0);
  await expect(page.locator('.md-table-src').first()).toContainText('| A | B |');
  await page.evaluate(() => window.__harness.edit({ kind: 'cursor', from: 0 }));
  await page.locator('input.md-task').click();
  await page.evaluate(() => window.__harness.settled());
  expect(await page.evaluate(() => window.__harness.hostText('d1'))).toContain('- [x] task');
  expect(await page.evaluate(() => window.__harness.docText('d1') === window.__harness.hostText('d1'))).toBe(true);
});

test('decoration work per update does not grow with the document (medium vs huge)', async ({ page, guard }) => {
  void guard;
  test.setTimeout(240_000);
  const measure = async (id: string, text: string) => {
    await page.evaluate(([d, t]) => window.__harness.load(d, t), [id, text] as const);
    await page.evaluate(() => window.__harness.resetStats());
    // Caret moves, typing and scrolling in the middle of the document.
    await page.evaluate(() => window.__harness.edit({ kind: 'cursor', from: 20_000 }));
    await page.evaluate(() => window.__harness.scrollTo(20_000));
    for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.type('abc def');
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, 400);
      await frames(page, 1);
    }
    await frames(page, 2);
    const s = await page.evaluate(() => window.__harness.stats());
    await page.evaluate((d) => window.__harness.close(d), id);
    return s;
  };
  await gotoHarness(page);
  const medium = await measure('medium', readCorpus('medium.md'));
  const huge = await measure('huge', hugeText());
  console.log(`medium ${JSON.stringify(medium)}\nhuge ${JSON.stringify(huge)}`);
  expect(medium.builds).toBeGreaterThan(10);
  expect(huge.builds).toBeGreaterThan(10);
  // Largest build: same order of nodes for 300 KB and 20 MB.
  expect(huge.maxBuildNodes).toBeLessThan(medium.maxBuildNodes * 3 + 500);
  expect(huge.maxTableNodes).toBeLessThan(medium.maxTableNodes * 3 + 500);
});

test('one view, many states: 3 documents, 20 swaps keep text, selection and scroll per document', async ({ page, guard }) => {
  void guard;
  test.setTimeout(120_000);
  await gotoHarness(page);
  const files = { s: 'small.md', m: 'medium.md', l: 'large.md' } as const;
  const saved: Record<string, { sel: number[][]; top: number; text: string }> = {};
  // Scroll position = first visible line (pixel offsets change because line heights are re-estimated after setState).
  for (const [id, file] of Object.entries(files)) {
    const text = readCorpus(file);
    await page.evaluate(([d, t]) => window.__harness.load(d, t), [id, text] as const);
    const pos = Math.floor(text.length * (id === 's' ? 0.1 : id === 'm' ? 0.5 : 0.8));
    await page.evaluate((p) => window.__harness.edit({ kind: 'select', ranges: [[p, p + 5], [p + 40, p + 40]] }), pos);
    await page.evaluate((p) => window.__harness.scrollTo(p), pos);
    /*
     * Settle first: without this, the background parser reaches the viewport after `saved` is read,
     * its decorations move the first visible line by a few lines, and the page then (correctly)
     * restores that moved position.
     */
    await page.evaluate(() => window.__harness.forceViewport());
    await frames(page, 3);
    saved[id] = {
      sel: await page.evaluate(() => window.__harness.selection()),
      top: await page.evaluate(() => window.__harness.topLine()),
      text: await page.evaluate((d) => window.__harness.docText(d) ?? '', id),
    };
    expect(saved[id]?.top ?? 0, `${id} scrolled`).toBeGreaterThan(id === 's' ? 0 : 100);
  }
  const order = ['s', 'm', 'l'];
  const deltas: string[] = [];
  for (let k = 0; k < 20; k++) {
    const id = order[k % 3] as string;
    await page.evaluate((d) => window.__harness.activate(d), id);
    await frames(page, 2);
    const now = {
      sel: await page.evaluate(() => window.__harness.selection()),
      top: await page.evaluate(() => window.__harness.topLine()),
      text: await page.evaluate((d) => window.__harness.docText(d) ?? '', id),
    };
    const delta = now.top - (saved[id]?.top ?? 0);
    deltas.push(`${id}${k}:${delta}`);
    expect(now.text === saved[id]?.text, `text ${id} swap ${k}`).toBe(true);
    expect(now.sel, `selection ${id} swap ${k}`).toEqual(saved[id]?.sel);
    expect(Math.abs(delta), `scroll ${id} swap ${k}: ${now.top} vs ${saved[id]?.top} (line deltas ${deltas.join(' ')})`).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => window.markdone?.__debug.activeDocId())).toBe(id);
  }
  // Line delta per swap (<doc><swap>:<first visible line now - saved>).
  console.log(`one view, many states: line deltas ${deltas.join(' ')}`);
  for (const id of order) expect(await page.evaluate((d) => window.__harness.hostText(d) === window.__harness.docText(d), id)).toBe(true);
});

test('change for an inactive document; reload replaces the text and keeps the scroll position', async ({ page, guard }) => {
  void guard;
  await gotoHarness(page);
  const medium = readCorpus('medium.md');
  await page.evaluate(([t]) => window.__harness.load('a', t), [medium] as const);
  await page.evaluate(() => window.__harness.load('b', '# B\n'));
  // `change` while "a" is inactive, with a selection: applied to the stored state.
  await page.evaluate(() => window.__harness.external('a', [{ from: 0, to: 0, insert: 'X' }], { anchor: 1, head: 1 }));
  await page.evaluate(() => window.__harness.activate('a'));
  expect(await page.evaluate(() => window.__harness.docText('a')?.startsWith('X'))).toBe(true);
  expect(await page.evaluate(() => window.__harness.selection())).toEqual([[1, 1]]);
  await page.evaluate((p) => window.__harness.scrollTo(p), Math.floor(medium.length / 2));
  // Read before and after only in a stable state (lazy chunks loaded, first line the same over 3 frames).
  const top = await stableTopLine(page);
  expect(top).toBeGreaterThan(100);
  // The IDE changes the text and asks for a reload (as after a reject or a big change).
  await page.evaluate(() => window.__harness.external('a', [{ from: 1, to: 1, insert: 'Y' }]));
  const before = (await sent(page, 'opened')).length;
  await page.evaluate(() => window.__harness.send({ type: 'reload', docId: 'a' }));
  await page.waitForFunction((n) => window.__harness.log().filter((e) => e.msg.type === 'opened').length > n, before);
  expect(await page.evaluate(() => window.__harness.docText('a') === window.__harness.hostText('a'))).toBe(true);
  expect(Math.abs((await stableTopLine(page)) - top)).toBeLessThanOrEqual(1);
  expect((await sent(page, 'opened')).at(-1)).toEqual({ type: 'opened', docId: 'a', docStamp: await page.evaluate(() => window.__harness.hostStamp('a')) });
});
