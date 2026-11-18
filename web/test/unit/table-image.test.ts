// L1: table model, image source rules (PROTOCOL.md "Images (M2)"), tableAction messages.
import { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { describe, expect, it } from 'vitest';

import { Controller, type ViewPort } from '../../src/controller';
import { resolveImage } from '../../src/images';
import { markdownParser } from '../../src/language';
import type { PageMessage } from '../../src/protocol';
import { type TableModel, cellAt, tableActionFor, tableModel } from '../../src/table-model';

function tables(text: string): { node: SyntaxNode; model: TableModel }[] {
  const out: { node: SyntaxNode; model: TableModel }[] = [];
  markdownParser.parse(text).iterate({
    enter: (ref) => {
      if (ref.name !== 'Table') return;
      out.push({ node: ref.node, model: tableModel(ref.node, (a, b) => text.slice(a, b)) });
      return false;
    },
  });
  return out;
}

const cellTexts = (m: TableModel) => m.rows.map((r) => r.cells.map((c) => c.segments.map((s) => s.text).join('')));

describe('table model', () => {
  it('cells, header row 0, alignment row not a row, alignments', () => {
    const t = '| Name | Value | Notes | Plain |\n|:-----|------:|:-----:|-------|\n| a | 1 | x | p |\n| b | 2 | y | q |\n';
    const [table] = tables(t);
    expect(table).toBeDefined();
    const m = table?.model as TableModel;
    expect(m.columns).toBe(4);
    expect(m.aligns).toEqual(['left', 'right', 'center', '']);
    expect(cellTexts(m)).toEqual([
      ['Name', 'Value', 'Notes', 'Plain'],
      ['a', '1', 'x', 'p'],
      ['b', '2', 'y', 'q'],
    ]);
    // Cell positions (caret targets) are relative to the table start.
    expect(t.slice(m.rows[1]?.cells[1]?.pos, (m.rows[1]?.cells[1]?.pos ?? 0) + 1)).toBe('1');
    expect(m.delimiter).toEqual({ from: t.indexOf('|:--'), to: t.indexOf('\n| a') });
  });

  it('escaped pipes stay in the cell; unescaped pipes split cells also inside inline code (GFM)', () => {
    const t = '| A | B |\n|---|---|\n| 1 \\| x | `a\\|b` |\n| `c|d` |\n';
    const m = tables(t)[0]?.model as TableModel;
    expect(m.columns).toBe(2);
    expect(cellTexts(m)).toEqual([
      ['A', 'B'],
      ['1 | x', 'a|b'],
      ['`c', 'd`'],
    ]);
    expect(m.rows[1]?.cells[1]?.segments).toEqual([{ text: 'a|b', cls: 'md-code' }]);
  });

  it('a pipe in inline code in the header row makes it a different table (or none), as Lezer parses it', () => {
    expect(tables('| A | `b|c` |\n|---|---|\n| 1 | 2 |\n')).toEqual([]);
  });

  it('inline formatting: marks removed, classes kept; missing and extra cells; no outer pipes', () => {
    const t = 'A | **B** | [c](http://x.y)\n-|-|-\n*e* | ~~f~~\n1 | 2 | 3 | 4\n';
    const m = tables(t)[0]?.model as TableModel;
    expect(cellTexts(m)).toEqual([
      ['A', 'B', 'c'],
      ['e', 'f', ''],
      ['1', '2', '3'],
    ]);
    expect(m.rows[0]?.cells[1]?.segments).toEqual([{ text: 'B', cls: 'md-strong' }]);
    expect(m.rows[0]?.cells[2]?.segments).toEqual([{ text: 'c', cls: 'md-link' }]);
    expect(m.rows[1]?.cells[0]?.segments).toEqual([{ text: 'e', cls: 'md-em' }]);
    expect(m.rows[1]?.cells[1]?.segments).toEqual([{ text: 'f', cls: 'md-strike' }]);
    expect(m.rows[1]?.cells[2]?.pos).toBe(m.rows[1]?.to);
  });

  it('table in a blockquote: alignment and cells without the quote marks', () => {
    const t = '> | A | B |\n> |:-|-:|\n> | 1 | 2 |\n';
    const [table] = tables(t);
    expect(table?.node.from).toBe(2);
    expect(table?.model.aligns).toEqual(['left', 'right']);
    expect(cellTexts(table?.model as TableModel)).toEqual([
      ['A', 'B'],
      ['1', '2'],
    ]);
  });

  it('empty cells: position after the opening pipe', () => {
    const t = '| A |  | C |\n|---|---|---|\n|||x|\n';
    const m = tables(t)[0]?.model as TableModel;
    expect(cellTexts(m)).toEqual([
      ['A', '', 'C'],
      ['', '', 'x'],
    ]);
    expect(m.rows[0]?.cells[1]?.pos).toBe(t.indexOf('|  |') + 2);
    const r1 = m.rows[1];
    expect(r1?.cells[0]?.pos).toBe((r1?.from ?? 0) + 1);
    expect(r1?.cells[1]?.pos).toBe((r1?.from ?? 0) + 2);
  });

  it('cellAt: row and column of a source position; the alignment row is row 0', () => {
    const t = '| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n';
    const m = tables(t)[0]?.model as TableModel;
    expect(cellAt(m, t.indexOf('A'))).toEqual({ row: 0, column: 0 });
    expect(cellAt(m, t.indexOf('B'))).toEqual({ row: 0, column: 1 });
    expect(cellAt(m, t.indexOf('---|') + 5)).toEqual({ row: 0, column: 1 });
    expect(cellAt(m, t.indexOf('2'))).toEqual({ row: 1, column: 1 });
    expect(cellAt(m, t.indexOf('3'))).toEqual({ row: 2, column: 0 });
    // On the leading or trailing pipe: clamped to the first / last column.
    expect(cellAt(m, t.indexOf('| 3'))).toEqual({ row: 2, column: 0 });
    expect(cellAt(m, t.length - 1)).toEqual({ row: 2, column: 1 });
  });
});

describe('tableAction messages', () => {
  const table = { from: 10, to: 60 };
  it.each([
    [{ kind: 'addRow', index: 1 }, 'insertRowAbove', 1, 0],
    [{ kind: 'addRow', index: 2 }, 'insertRowAbove', 2, 0],
    [{ kind: 'addRow', index: 3 }, 'insertRowBelow', 2, 0],
    [{ kind: 'addColumn', index: 0 }, 'insertColumnLeft', 0, 0],
    [{ kind: 'addColumn', index: 1 }, 'insertColumnLeft', 0, 1],
    [{ kind: 'addColumn', index: 2 }, 'insertColumnRight', 0, 1],
    [{ kind: 'removeRow', index: 2 }, 'removeRow', 2, 0],
    [{ kind: 'removeColumn', index: 1 }, 'removeColumn', 0, 1],
  ] as const)('%j -> %s row %i column %i (3 rows, 2 columns)', (button, action, row, column) => {
    expect(tableActionFor(button, table, 3, 2)).toEqual({ name: 'tableAction', action, from: 10, to: 60, row, column });
  });

  it('the controller sends it as a `command` of the active document', async () => {
    const sent: PageMessage[] = [];
    let state = EditorState.create();
    const view = {
      get state() {
        return state;
      },
      setState: (s: EditorState) => void (state = s),
      dispatch: () => undefined,
      scrollSnapshot: () => null as never,
      topLine: () => 1,
      topPos: () => 0,
      scrollToLine: () => undefined,
      prepare: () => undefined,
      contentHeight: () => 0,
      afterPaint: () => Promise.resolve(),
    } satisfies ViewPort;
    const controller = new Controller({
      view,
      send: (m) => sent.push(m),
      fetchDoc: () => Promise.resolve({ ok: true, text: 'x', stamp: 0 }),
      extensions: [],
      schedule: (cb) => queueMicrotask(cb),
      delay: (cb, ms) => setTimeout(cb, ms),
      now: () => 0,
      lastUserInput: () => 0,
    });
    controller.receive({ type: 'open', docId: 'd', writable: true });
    await new Promise((r) => setTimeout(r));
    controller.receive({ type: 'activate', docId: 'd' });
    await new Promise((r) => setTimeout(r));
    sent.length = 0;
    controller.command(tableActionFor({ kind: 'addColumn', index: 2 }, table, 3, 2));
    controller.command({ name: 'gotoSource', pos: 4 });
    expect(sent).toEqual([
      { type: 'command', docId: 'd', name: 'tableAction', action: 'insertColumnRight', from: 10, to: 60, row: 0, column: 1 },
      { type: 'command', docId: 'd', name: 'gotoSource', pos: 4 },
    ]);
    expect(JSON.stringify(sent[0])).toBe('{"type":"command","docId":"d","name":"tableAction","action":"insertColumnRight","from":10,"to":60,"row":0,"column":1}');
  });
});

describe('image sources', () => {
  const id = '0123456789abcdef0123456789abcdef';
  const file = (p: string) => `https://markdone.local/file/${id}/${p}`;
  it.each([
    ['img/a.png', file('img%2Fa.png')],
    ['./a.png', file('.%2Fa.png')],
    ['../images/a b.png', file('..%2Fimages%2Fa%20b.png')],
    ['a%20b.png', file('a%20b.png')],
    ['<my image.png>', file('my%20image.png')],
    ['a.png?v=2#x', file('a.png')],
    ['ünï.png', file('%C3%BCn%C3%AF.png')],
    ['bad%zz.png', file('bad%25zz.png')],
  ])('relative %s -> /file/', (src, url) => {
    expect(resolveImage(src, id, false)).toEqual({ kind: 'url', url });
  });

  it('a relative URL keeps `..` through the browser URL parser', () => {
    const r = resolveImage('../../x.png', id, false);
    expect(r.kind === 'url' && new URL(r.url).pathname).toBe(`/file/${id}/..%2F..%2Fx.png`);
  });

  it('data:image as is; other data: is a placeholder', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    expect(resolveImage(png, id, false)).toEqual({ kind: 'url', url: png });
    expect(resolveImage('data:image/svg+xml,<svg/>', id, false).kind).toBe('url');
    expect(resolveImage('data:text/html,<b>x</b>', id, true)).toEqual({ kind: 'placeholder', text: 'data:text/html,<b>x</b>' });
  });

  it('http(s): placeholder with the URL unless remote images are on', () => {
    expect(resolveImage('https://img.example/a.png', id, false)).toEqual({ kind: 'placeholder', text: 'https://img.example/a.png' });
    expect(resolveImage('HTTP://img.example/a.png', id, false).kind).toBe('placeholder');
    expect(resolveImage('https://img.example/a.png', id, true)).toEqual({ kind: 'url', url: 'https://img.example/a.png' });
    expect(resolveImage('//img.example/a.png', id, true)).toEqual({ kind: 'url', url: 'https://img.example/a.png' });
    expect(resolveImage('//img.example/a.png', id, false).kind).toBe('placeholder');
  });

  it('http: (not https) is a placeholder even with remote images on (CSP allows only https:)', () => {
    expect(resolveImage('http://img.example/a.png', id, true)).toEqual({ kind: 'placeholder', text: 'http://img.example/a.png' });
    expect(resolveImage('HTTP://img.example/a.png', id, true).kind).toBe('placeholder');
    expect(resolveImage('HTTPS://img.example/a.png', id, true).kind).toBe('url');
  });

  it.each(['', '   ', 'file:///etc/passwd', 'javascript:alert(1)', '/abs/a.png', '\\\\server\\a.png', 'C:\\a.png', 'ftp://x/a.png'])('%j -> placeholder', (src) => {
    expect(resolveImage(src, id, true).kind).toBe('placeholder');
  });
});
