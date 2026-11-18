import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, openHarness, readCorpus, test } from './fixtures';
import { frames, sent } from './helpers';

/*
 * L2 live preview: decoration classes on inactive lines and markers on the
 * active line, images (PROTOCOL.md "Images (M2)"), table widget and table actions
 * Ctrl/Cmd-click.
 */

const caret = (page: Page, pos: number) => page.evaluate((p) => window.__harness.edit({ kind: 'cursor', from: p }), pos);

test('every §6.8 class on inactive lines; markers only on the active line', async ({ page, guard }) => {
  void guard;
  const text = readCorpus('styles/live-preview.md');
  // The whole file in the viewport.
  await page.setViewportSize({ width: 1280, height: 1600 });
  await openHarness(page, text);
  // Caret in the empty line after the front matter: every other line is inactive.
  await caret(page, text.indexOf('\n\n# Heading 1') + 1);
  await frames(page, 2);
  const classes = [
    '.md-h1',
    '.md-h2',
    '.md-h3',
    '.md-h4',
    '.md-h5',
    '.md-h6',
    '.md-strong',
    '.md-em',
    '.md-strike',
    '.md-code',
    '.md-link',
    '.md-quote',
    '.md-codeblock[data-lang="python"]',
    '.md-codeblock[data-lang=""]',
    '.md-hr',
    '.md-bullet',
    '.md-list-number',
    'input.md-task',
    '.md-table',
    'img.md-img',
    '.md-frontmatter',
    '.md-footnote',
    '.md-html-source',
  ];
  for (const cls of classes) expect(await page.locator(cls).count(), cls).toBeGreaterThan(0);
  // Only the front matter fences are markers (they stay visible: the block is source).
  expect(await page.locator('.md-marker').evaluateAll((els) => els.map((e) => e.textContent))).toEqual(['---', '---']);
  await expect(page.locator('.md-h1')).toHaveText('Heading 1');
  await expect(page.locator('.md-h6')).toHaveText('Heading 6');
  await expect(page.locator('.cm-line', { hasText: 'Text with' })).toHaveText(
    'Text with strong, em, strike, code, link, https://auto.example and https://bare.example.',
  );
  await expect(page.locator('.md-list-number')).toHaveText(['1.', '2.', '10)']);
  expect(await page.locator('input.md-task').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).checked))).toEqual([false, true]);
  // Each line with markers: its markers are visible when the caret is on it.
  for (const [needle, markers] of [
    ['# Heading 1', ['#']],
    ['###### Heading 6', ['######']],
    ['Text with', ['**', '**', '*', '*', '~~', '~~', '`', '`', '[', '](https://example.com)', '<', '>']],
    ['- bullet', ['-']],
    ['- [x] done', ['-', '[x]']],
    ['10) tenth', ['10)']],
    ['> > nested', ['>', '>']],
    ['```python', ['```', 'python']],
    ['Footnote reference', ['[^', ']']],
    ['![dot]', ['![', '](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==)']],
  ] as const) {
    await caret(page, text.indexOf(needle) + 1);
    // The front matter fences are always markers; any other marker is on the caret line.
    const line = page.locator('.cm-line:not(.md-frontmatter)').filter({ has: page.locator('.md-marker') });
    const got = await line.locator('.md-marker').evaluateAll((els) => els.map((e) => e.textContent));
    expect(got, needle).toEqual(markers);
  }
});

test('images: relative -> /file/ request, data: as is, remote placeholder without request until remote images are on', async ({ page, guard }) => {
  const png = readFileSync(fileURLToPath(new URL('./assets/logo.png', import.meta.url)));
  const text = readCorpus('styles/images.md');
  await openHarness(page, text);
  await caret(page, 0);
  await frames(page, 2);
  const logo = page.locator('img.md-img[alt="logo"]');
  await expect(logo).toHaveAttribute('src', 'https://markdone.local/file/d1/.%2Flogo.png');
  await expect(logo).toHaveAttribute('loading', 'lazy');
  await expect(logo).toHaveAttribute('decoding', 'async');
  await expect.poll(() => logo.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(16);
  await expect(page.locator('img.md-img[alt="up"]')).toHaveAttribute('src', 'https://markdone.local/file/d1/..%2Fshared%2Fup.png');
  await expect(page.locator('img.md-img[alt="spaces"]')).toHaveAttribute('src', 'https://markdone.local/file/d1/my%20image.png');
  await expect(page.locator('img.md-img[alt="dot"]')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(page.locator('img.md-img[alt="badge"]')).toHaveAttribute('src', 'https://markdone.local/file/d1/badge.svg');
  // Remote and unsupported sources: the URL as text, no request.
  await expect(page.locator('.md-img-placeholder')).toHaveText(['https://img.example/remote.png', 'file:///etc/passwd', 'javascript:alert(1)']);
  await expect.poll(() => guard.fileRequests.slice().sort()).toEqual(['d1/.%2Flogo.png', 'd1/..%2Fshared%2Fup.png', 'd1/badge.svg', 'd1/img%2Fsub%20dir%2Fpic.png', 'd1/my%20image.png']);
  // Remote images on: an <img> with the remote URL. The page CSP (img-src https://markdone.local/
  // data:) blocks it: remote images need a CSP change on the IDE side.
  let remote = 0;
  await page.route('https://img.example/**', (route) => {
    remote++;
    return route.fulfill({ status: 200, headers: { 'Content-Type': 'image/png' }, body: png });
  });
  guard.expectedViolations.push('img-src https://img.example/remote.png');
  await page.evaluate(() => window.__harness.send({ type: 'settings', remoteImages: true, math: true, mermaid: true, highlight: true, softBreaks: true, style: 'default', doubleClickEdit: false, vim: false, colorTheme: 'ide', vimrc: [] }));
  await expect(page.locator('img.md-img[alt="remote"]')).toHaveAttribute('src', 'https://img.example/remote.png');
  await expect(page.locator('.md-img-placeholder')).toHaveText(['file:///etc/passwd', 'javascript:alert(1)']);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations))
    .toContain('img-src https://img.example/remote.png');
  expect(remote).toBe(0);
  // Off again: placeholder.
  await page.evaluate(() => window.__harness.send({ type: 'settings', remoteImages: false, math: true, mermaid: true, highlight: true, softBreaks: true, style: 'default', doubleClickEdit: false, vim: false, colorTheme: 'ide', vimrc: [] }));
  await expect(page.locator('.md-img-placeholder').first()).toHaveText('https://img.example/remote.png');
  expect(await page.evaluate(() => window.markdone?.__debug.docChanges('d1'))).toBe(0);
});

const TABLE_DOC = 'Intro\n\n| A | B |\n|:--|--:|\n| 1 | 2 |\n| 3 | `x\\|y` |\n\nEnd\n';
const T_FROM = TABLE_DOC.indexOf('| A');
const T_TO = TABLE_DOC.indexOf('\n\nEnd');

test('table widget: rendered with alignment; hover buttons send tableAction; caret inside shows the source', async ({ page, guard }) => {
  void guard;
  await openHarness(page, TABLE_DOC);
  await caret(page, 0);
  const wrap = page.locator('.md-table-wrap');
  await expect(page.locator('.md-table th')).toHaveText(['A', 'B']);
  await expect(page.locator('.md-table td')).toHaveText(['1', '2', '3', 'x|y']);
  await expect(page.locator('.md-table td').nth(1)).toHaveCSS('text-align', 'right');
  await expect(page.locator('.md-table th').first()).toHaveCSS('text-align', 'left');
  await expect(page.locator('.md-table .md-code')).toHaveText('x|y');
  // Buttons appear on hover only.
  const btn = (kind: string, index: number) => page.locator(`.md-table-btn[data-kind="${kind}"][data-index="${index}"]`);
  await expect(btn('addRow', 1)).toBeHidden();
  const expected: [string, number, string, number, number][] = [
    ['addRow', 1, 'insertRowAbove', 1, 0],
    ['addRow', 2, 'insertRowAbove', 2, 0],
    ['addRow', 3, 'insertRowBelow', 2, 0],
    ['addColumn', 0, 'insertColumnLeft', 0, 0],
    ['addColumn', 1, 'insertColumnLeft', 0, 1],
    ['addColumn', 2, 'insertColumnRight', 0, 1],
    ['removeRow', 2, 'removeRow', 2, 0],
    ['removeColumn', 0, 'removeColumn', 0, 0],
  ];
  for (const [kind, index] of expected) {
    await wrap.hover();
    await btn(kind, index).click();
  }
  await frames(page, 2);
  expect(await sent(page, 'command')).toEqual(
    expected.map(([, , action, row, column]) => ({ type: 'command', docId: 'd1', name: 'tableAction', action, from: T_FROM, to: T_TO, row, column })),
  );
  // No button above the header row, no remove for the header row.
  await expect(btn('addRow', 0)).toHaveCount(0);
  await expect(btn('removeRow', 0)).toHaveCount(0);
  // The buttons do not move the caret and change nothing.
  expect(await page.evaluate(() => window.__harness.selection())).toEqual([[0, 0]]);
  expect(await page.evaluate(() => window.markdone?.__debug.docChanges('d1'))).toBe(0);
  // A click on a cell: caret at the cell source, the source is shown.
  await page.locator('.md-table td', { hasText: '2' }).click();
  expect(await page.evaluate(() => window.__harness.selection())).toEqual([[TABLE_DOC.indexOf('2 |'), TABLE_DOC.indexOf('2 |')]]);
  await expect(page.locator('.md-table')).toHaveCount(0);
  await expect(page.locator('.md-table-src')).toHaveCount(4);
  // Caret out again: rendered.
  await caret(page, TABLE_DOC.length - 1);
  await expect(page.locator('.md-table')).toHaveCount(1);
  // Read-only: no buttons.
  await page.evaluate(() => window.markdone?.receive({ type: 'writable', docId: 'd1', writable: false }));
  await wrap.hover();
  await expect(btn('addRow', 1)).toBeHidden();
});

test('right-click in a table: contextMenu carries table {from, to, row, column} (widget and source)', async ({ page, guard }) => {
  void guard;
  await openHarness(page, TABLE_DOC);
  await caret(page, 0);
  await page.locator('.md-table td', { hasText: '3' }).click({ button: 'right' });
  await page.locator('.md-table th', { hasText: 'B' }).click({ button: 'right' });
  await page.locator('.cm-line', { hasText: 'Intro' }).click({ button: 'right' });
  // Caret inside: the source; right-click on "2".
  await caret(page, TABLE_DOC.indexOf('| 1'));
  await expect(page.locator('.md-table')).toHaveCount(0);
  const two = page.locator('.md-table-src', { hasText: '| 1 | 2 |' });
  const box = await two.boundingBox();
  if (!box) throw new Error('no line');
  // x of the "2": measured from the text.
  const x = await two.evaluate((line) => {
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = (n.textContent ?? '').indexOf('2');
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + 1);
      const rect = r.getBoundingClientRect();
      return rect.x + rect.width / 2;
    }
    return 0;
  });
  await page.mouse.click(x, box.y + box.height / 2, { button: 'right' });
  await frames(page, 2);
  const menus = (await sent(page, 'command')).map((c) => c['table'] ?? null);
  expect(menus).toEqual([
    { from: T_FROM, to: T_TO, row: 2, column: 0 },
    { from: T_FROM, to: T_TO, row: 0, column: 1 },
    null,
    { from: T_FROM, to: T_TO, row: 1, column: 1 },
  ]);
});

test('Ctrl/Cmd-click: link -> link; text -> gotoSource {pos}; table cell -> its source position', async ({ page, guard }) => {
  void guard;
  const text = 'caret\n\nSome plain words and a [link](https://example.com/x).\n\n| A | B |\n|---|---|\n| 1 | 2 |\n';
  await openHarness(page, text);
  await caret(page, 0);
  await page.locator('.md-link', { hasText: 'link' }).click({ modifiers: ['ControlOrMeta'] });
  const plain = page.locator('.cm-line', { hasText: 'Some plain' });
  const box = await plain.boundingBox();
  if (!box) throw new Error('no line');
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.keyboard.down('ControlOrMeta');
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up('ControlOrMeta');
  await page.locator('.md-table td', { hasText: '2' }).click({ modifiers: ['ControlOrMeta'] });
  await frames(page, 2);
  expect(await sent(page, 'link')).toEqual([{ type: 'link', docId: 'd1', href: 'https://example.com/x', kind: 'external' }]);
  const lineStart = text.indexOf('Some plain');
  const commands = await sent(page, 'command');
  expect(commands).toHaveLength(2);
  expect(commands[0]).toMatchObject({ type: 'command', docId: 'd1', name: 'gotoSource' });
  expect(Math.abs((commands[0]?.['pos'] as number) - lineStart)).toBeLessThanOrEqual(1);
  expect(commands[1]).toEqual({ type: 'command', docId: 'd1', name: 'gotoSource', pos: text.indexOf('2 |') });
  // Ctrl-click changes nothing in the page (no extra cursor, no edit).
  expect(await page.evaluate(() => window.__harness.selection())).toEqual([[0, 0]]);
});

test('Alt-click adds a cursor (A16); a plain click replaces the selection', async ({ page, guard }) => {
  void guard;
  const text = 'alpha beta gamma\n\ndelta epsilon zeta\n';
  await openHarness(page, text);
  const line = (t: string) => page.locator('.cm-line', { hasText: t });
  await line('alpha').click({ position: { x: 2, y: 5 } });
  await line('delta').click({ position: { x: 2, y: 5 }, modifiers: ['Alt'] });
  await frames(page, 2);
  const two = await page.evaluate(() => window.__harness.selection());
  expect(two).toHaveLength(2);
  expect(two.map((r) => r[0] ?? -1).sort((a, b) => a - b)).toEqual([0, text.indexOf('delta')]);
  expect(await sent(page, 'command')).toEqual([]);
  await line('alpha').click({ position: { x: 2, y: 5 } });
  await frames(page, 2);
  expect(await page.evaluate(() => window.__harness.selection())).toEqual([[0, 0]]);
});

test('path code: styled and clickable only after the IDE says the file exists, also in a table cell', async ({ page, guard }) => {
  void guard;
  await openHarness(page, 'Text `src/A.kt` and `src/B.kt`\n\n| File |\n|---|\n| `src/A.kt` |\n\nEnd\n');
  await caret(page, 'Text `src/A.kt` and `src/B.kt`\n\n| File |\n|---|\n| `src/A.kt` |\n\nEnd\n'.length - 1);
  await expect.poll(async () => (await sent(page, 'command')).map((m) => m['name'])).toContain('pathsExist');
  const asked = (await sent(page, 'command')).filter((m) => m['name'] === 'pathsExist');
  expect(asked).toEqual([{ type: 'command', docId: 'd1', name: 'pathsExist', paths: ['src/A.kt', 'src/B.kt'] }]);
  // No cue before the answer.
  await expect(page.locator('.md-path')).toHaveCount(0);
  await page.evaluate(() => window.markdone?.receive({ type: 'paths', docId: 'd1', exist: ['src/A.kt'], missing: ['src/B.kt'] }));
  await expect(page.locator('.md-path')).toHaveCount(2);
  await expect(page.locator('.md-path').first()).toHaveText('src/A.kt');
  await expect(page.locator('.md-table .md-path')).toHaveText('src/A.kt');
  // Ctrl/Cmd-click opens the file (text and table cell); a missing file keeps the plain code style.
  await page.locator('.md-path').first().click({ modifiers: ['ControlOrMeta'] });
  await page.locator('.md-table .md-path').click({ modifiers: ['ControlOrMeta'] });
  await frames(page, 2);
  expect(await sent(page, 'link')).toEqual([
    { type: 'link', docId: 'd1', href: 'src/A.kt', kind: 'relative' },
    { type: 'link', docId: 'd1', href: 'src/A.kt', kind: 'relative' },
  ]);
});
