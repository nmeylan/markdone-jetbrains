import { expect, gotoHarness, test } from './fixtures';
import { frames } from './helpers';

/* L2 edit start (protocol 2.5): `doubleClickEdit` and `vim`. */

const SETTINGS = { type: 'settings', remoteImages: false, math: true, mermaid: true, highlight: true, softBreaks: true, drawio: true, drawioPattern: 'drawio:{path}#{page}', style: 'default', doubleClickEdit: false, vim: false, colorTheme: 'ide', vimrc: [] } as const;

async function settings(page: import('@playwright/test').Page, s: { doubleClickEdit?: boolean; vim?: boolean; vimrc?: { mode: string; remap: boolean; lhs: string; rhs: string }[] }) {
  await page.evaluate((m) => window.__harness.send(m), { ...SETTINGS, ...s });
  await frames(page, 3);
}

/** 'false' while the page waits for a double-click (or the document is read-only for the IDE). */
const editable = async (page: import('@playwright/test').Page) =>
  (await page.locator('.cm-editor.md-awaiting-edit').count()) === 0 && (await page.locator('.cm-content').getAttribute('contenteditable')) === 'true' ? 'true' : 'false';

test('double-click edit off: the page is editable at once', async ({ page, guard }) => {
  void guard;
  await gotoHarness(page);
  await page.evaluate(() => window.__harness.load('d1', 'hello world\n'));
  await settings(page, {});
  expect(await editable(page)).toBe('true');
});

test('double-click edit on: read-only until a double-click; Escape ends the edit', async ({ page, guard }) => {
  void guard;
  await gotoHarness(page);
  await page.evaluate(() => window.__harness.load('d1', 'hello world\n- [ ] task\n'));
  await settings(page, { doubleClickEdit: true });
  expect(await editable(page)).toBe('false');
  // A single click toggles the check box without an edit.
  await page.locator('input.md-task').click();
  await page.evaluate(() => window.__harness.settled());
  expect(await page.evaluate(() => window.__harness.hostText('d1'))).toContain('- [x] task');
  expect(await editable(page)).toBe('false');
  // Typing does nothing.
  await page.keyboard.type('zzz');
  expect(await page.evaluate(() => window.__harness.docText('d1'))).not.toContain('zzz');
  await page.locator('.cm-line').first().dblclick();
  expect(await editable(page)).toBe('true');
  await page.keyboard.type('X');
  await page.evaluate(() => window.__harness.settled());
  expect(await page.evaluate(() => window.__harness.hostText('d1'))).toContain('X');
  await page.keyboard.press('Escape');
  expect(await editable(page)).toBe('false');
});

test('double-click edit on: another document starts read-only; the setting off makes the page editable again', async ({ page, guard }) => {
  void guard;
  await gotoHarness(page);
  await page.evaluate(() => window.__harness.load('a', 'a text\n'));
  await page.evaluate(() => window.__harness.load('b', 'b text\n'));
  await settings(page, { doubleClickEdit: true });
  await page.locator('.cm-line').first().dblclick();
  expect(await editable(page)).toBe('true');
  await page.evaluate(() => window.__harness.activate('a'));
  await frames(page, 2);
  expect(await editable(page)).toBe('false');
  await settings(page, { doubleClickEdit: false });
  expect(await editable(page)).toBe('true');
});

test('double-click edit on: a read-only document stays read-only after a double-click', async ({ page, guard }) => {
  void guard;
  await gotoHarness(page);
  await page.evaluate(() => window.__harness.load('ro', 'locked\n', { writable: false }));
  await settings(page, { doubleClickEdit: true });
  await page.locator('.cm-line').first().dblclick();
  expect(await editable(page)).toBe('false');
});

test('vim on: Normal mode keys do not type; i enters Insert mode; Escape leaves it', async ({ page, guard }) => {
  void guard;
  await gotoHarness(page);
  await page.evaluate(() => window.__harness.load('d1', 'hello\n'));
  await settings(page, { vim: true });
  await expect(page.locator('.cm-fat-cursor, .cm-vimMode').first()).toBeAttached({ timeout: 10_000 });
  await page.locator('.cm-line').first().click();
  await page.keyboard.type('x');
  await page.evaluate(() => window.__harness.settled());
  expect(await page.evaluate(() => window.__harness.hostText('d1'))).not.toContain('xhello');
  await page.keyboard.press('Home');
  await page.keyboard.type('iAB');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__harness.settled());
  expect(await page.evaluate(() => window.__harness.hostText('d1'))).toContain('AB');
});

test('vim and double-click edit on: Escape in Insert mode stays in the edit; in Normal mode it ends it', async ({ page, guard }) => {
  void guard;
  await gotoHarness(page);
  await page.evaluate(() => window.__harness.load('d1', 'hello\n'));
  await settings(page, { vim: true, doubleClickEdit: true });
  await page.locator('.cm-line').first().dblclick();
  await page.keyboard.type('i');
  await page.keyboard.press('Escape');
  expect(await editable(page)).toBe('true');
  await page.keyboard.press('Escape');
  expect(await editable(page)).toBe('false');
});

test('vim on: mappings from the vimrc apply; a later settings message without them removes them', async ({ page, guard }) => {
  void guard;
  await gotoHarness(page);
  await page.evaluate(() => window.__harness.load('d1', 'hello\n'));
  await settings(page, { vim: true, vimrc: [{ mode: 'normal', remap: false, lhs: 'Z', rhs: 'x' }] });
  await expect(page.locator('.cm-fat-cursor').first()).toBeAttached({ timeout: 10_000 });
  await page.locator('.cm-line').first().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Z');
  await page.evaluate(() => window.__harness.settled());
  expect(await page.evaluate(() => window.__harness.hostText('d1'))).toBe('ello\n');
  await settings(page, { vim: true, vimrc: [] });
  await page.keyboard.press('Z');
  await page.evaluate(() => window.__harness.settled());
  expect(await page.evaluate(() => window.__harness.hostText('d1'))).toBe('ello\n');
});

test('double-click edit on: a single click on a table keeps it rendered; a double-click shows its source with the caret in the cell', async ({ page, guard }) => {
  void guard;
  await gotoHarness(page);
  await page.evaluate(() => window.__harness.load('d1', 'text\n\n| A | B |\n| - | - |\n| 1 | 2 |\n'));
  await settings(page, { doubleClickEdit: true });
  await expect(page.locator('.md-table')).toHaveCount(1);
  await page.locator('.md-table td').first().click();
  await frames(page, 2);
  await expect(page.locator('.md-table')).toHaveCount(1);
  expect(await editable(page)).toBe('false');
  await page.locator('.md-table td').first().dblclick();
  await expect(page.locator('.md-table')).toHaveCount(0);
  await expect(page.locator('.md-table-src').first()).toContainText('| A | B |');
  expect(await editable(page)).toBe('true');
});

test('double-click edit on: text can be selected and copied without an edit; typing does nothing', async ({ page, guard }) => {
  void guard;
  await gotoHarness(page);
  await page.evaluate(() => window.__harness.load('d1', 'hello world\n'));
  await settings(page, { doubleClickEdit: true });
  const box = await page.locator('.cm-line').first().boundingBox();
  if (!box) throw new Error('no line');
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('hello world');
  await page.keyboard.type('zzz');
  await page.keyboard.press('Backspace');
  await page.evaluate(() => window.__harness.settled());
  expect(await page.evaluate(() => window.__harness.docText('d1'))).toBe('hello world\n');
  expect(await editable(page)).toBe('false');
});

test('double-click edit on: text in a rendered table and in a code block can be selected; the table stays rendered', async ({ page, guard }) => {
  void guard;
  await gotoHarness(page);
  await page.evaluate(() => window.__harness.load('d1', '```js\nconst a = 1;\n```\n\n| A | B |\n| - | - |\n| one two | three |\n'));
  await settings(page, { doubleClickEdit: true });
  const drag = async (selector: string) => {
    const box = await page.locator(selector).first().boundingBox();
    if (!box) throw new Error(`no box for ${selector}`);
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await frames(page, 2);
    return page.evaluate(() => window.getSelection()?.toString());
  };
  expect(await drag('.cm-line:has-text("const a")')).toBe('const a = 1;');
  expect(await drag('.md-table td:has-text("one two")')).toBe('one two');
  await expect(page.locator('.md-table')).toHaveCount(1);
  expect(await editable(page)).toBe('false');
});

test('double-click edit on: a click in the edited block keeps the edit; a click in another block ends it', async ({ page, guard }) => {
  void guard;
  await gotoHarness(page);
  await page.evaluate(() => window.__harness.load('d1', 'first paragraph here\n\nsecond paragraph here\n'));
  await settings(page, { doubleClickEdit: true });
  await page.locator('.cm-line:has-text("first")').dblclick();
  expect(await editable(page)).toBe('true');
  await page.locator('.cm-line:has-text("first")').click({ position: { x: 5, y: 5 } });
  expect(await editable(page)).toBe('true');
  await page.keyboard.type('X');
  await page.locator('.cm-line:has-text("second")').click();
  expect(await editable(page)).toBe('false');
  await page.keyboard.type('Y');
  await page.evaluate(() => window.__harness.settled());
  const text = await page.evaluate(() => window.__harness.docText('d1'));
  expect(text).toContain('X');
  expect(text).not.toContain('Y');
  // A double-click in the other block starts a new edit there.
  await page.locator('.cm-line:has-text("second")').dblclick();
  expect(await editable(page)).toBe('true');
});

test('vim and double-click edit on: waiting shows the Vim caret and visual mode; i starts the edit', async ({ page, guard }) => {
  void guard;
  await gotoHarness(page);
  await page.evaluate(() => window.__harness.load('d1', 'first line\n\nsecond line\n'));
  await settings(page, { vim: true, doubleClickEdit: true });
  await page.locator('.cm-line:has-text("first")').click();
  await expect(page.locator('.cm-fat-cursor')).toBeVisible({ timeout: 10_000 });
  // Visual mode: the selection is drawn, nothing changes, the page still waits.
  await page.keyboard.press('0');
  await page.keyboard.press('v');
  await page.keyboard.press('l');
  await page.keyboard.press('l');
  await expect(page.locator('.cm-selectionBackground').first()).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await editable(page)).toBe('false');
  expect(await page.evaluate(() => window.__harness.docText('d1'))).toBe('first line\n\nsecond line\n');
  // `i` is Insert mode: the edit starts and typing works.
  await page.keyboard.press('i');
  expect(await editable(page)).toBe('true');
  await page.keyboard.type('AB');
  await page.evaluate(() => window.__harness.settled());
  expect(await page.evaluate(() => window.__harness.docText('d1'))).toContain('AB');
});

test('vim and double-click edit on: a change command starts the edit; a click in another block ends it in Normal mode', async ({ page, guard }) => {
  void guard;
  await gotoHarness(page);
  await page.evaluate(() => window.__harness.load('d1', 'first line\n\nsecond line\n'));
  await settings(page, { vim: true, doubleClickEdit: true });
  await page.locator('.cm-line:has-text("first")').click();
  await page.keyboard.press('0');
  await page.keyboard.press('x');
  await page.evaluate(() => window.__harness.settled());
  expect(await page.evaluate(() => window.__harness.docText('d1'))).toBe('irst line\n\nsecond line\n');
  expect(await editable(page)).toBe('true');
  // Insert mode, then a click in the other block ends the edit; the next edit starts in Normal mode.
  await page.keyboard.press('i');
  await page.locator('.cm-line:has-text("second")').click();
  expect(await editable(page)).toBe('false');
  await page.keyboard.press('0');
  await page.keyboard.press('x');
  await page.evaluate(() => window.__harness.settled());
  expect(await page.evaluate(() => window.__harness.docText('d1'))).toBe('irst line\n\necond line\n');
});

test('vim on: a visual selection is also painted as a mark on the text', async ({ page, guard }) => {
  void guard;
  await gotoHarness(page);
  await page.evaluate(() => window.__harness.load('d1', '```js\nconst alpha = 1;\n```\n\nhello world\n'));
  await settings(page, { vim: true });
  await page.locator('.cm-line:has-text("const alpha")').click();
  await page.keyboard.press('0');
  await page.keyboard.press('v');
  for (let i = 0; i < 4; i++) await page.keyboard.press('l');
  await expect(page.locator('.md-vim-selection')).toHaveText('const');
  await page.keyboard.press('Escape');
  await expect(page.locator('.md-vim-selection')).toHaveCount(0);
});

test('vim on: arrow keys go through Vim (visual mode selects with them)', async ({ page, guard }) => {
  void guard;
  await gotoHarness(page);
  await page.evaluate(() => window.__harness.load('d1', 'hello world here\nsecond line of text\n'));
  await settings(page, { vim: true });
  await page.locator('.cm-line').first().click({ position: { x: 20, y: 6 } });
  await page.keyboard.press('0');
  await page.keyboard.press('v');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await expect(page.locator('.md-vim-selection')).toHaveText('hello');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.md-vim-selection')).toHaveCount(2);
});
