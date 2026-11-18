/*
 * GFM table model from the Lezer tree. The same tree that the editor uses, so the
 * widget shows what the parser sees: `\|` is part of a cell, an unescaped `|` splits cells also
 * inside inline code (GFM rule), rows with too many cells drop the extra cells, rows with too few
 * get empty cells. No DOM: runs in Node for L1.
 */
import type { SyntaxNode } from '@lezer/common';

import type { Command, TableAction } from './protocol';

export type Align = 'left' | 'center' | 'right' | '';

/** A piece of rendered cell text with the classes of its inline formatting. */
export interface Segment {
  text: string;
  cls: string;
}

export interface CellModel {
  segments: Segment[];
  /** Caret position for a click on the cell, relative to the table start. */
  pos: number;
  /** Source of the cell: [pos, end) relative to the table start (empty for an empty or missing cell). */
  end: number;
}

export interface RowModel {
  /** Source range of the row, relative to the table start. */
  from: number;
  to: number;
  /** Starts of the column delimiters (`|`) of the row, relative to the table start. */
  pipes: number[];
  /** True when the row starts with a `|`. */
  leading: boolean;
  cells: CellModel[];
}

export interface TableModel {
  columns: number;
  aligns: Align[];
  /** Row 0 = header row; the alignment row is not a row. */
  rows: RowModel[];
  /** Range of the alignment row, relative to the table start. */
  delimiter: { from: number; to: number };
}

const HIDDEN = new Set(['EmphasisMark', 'StrikethroughMark', 'LinkMark', 'LinkTitle', 'LinkLabel', 'CodeMark', 'QuoteMark']);
const CLASSES: Record<string, string> = {
  Emphasis: 'md-em',
  StrongEmphasis: 'md-strong',
  Strikethrough: 'md-strike',
  Link: 'md-link',
  Autolink: 'md-link',
  HTMLTag: 'md-html-source',
};

/** Rendered text of an inline node range: marks removed, escapes resolved, classes kept. */
function segments(node: SyntaxNode, text: (from: number, to: number) => string, cls: string, out: Segment[]): void {
  const push = (t: string, c: string) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.cls === c) last.text += t;
    else out.push({ text: t, cls: c });
  };
  const join = (a: string, b: string | undefined) => (b ? (a ? `${a} ${b}` : b) : a);
  if (node.name === 'InlineCode') {
    const marks = node.getChildren('CodeMark');
    const from = marks[0]?.to ?? node.from;
    const to = marks.length > 1 ? (marks[marks.length - 1]?.from ?? node.to) : node.to;
    // GFM: `\|` inside code in a table cell is a `|`.
    push(text(from, to).replace(/\\\|/g, '|'), join(cls, 'md-code'));
    return;
  }
  let pos = node.from;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.from > pos) push(text(pos, child.from), cls);
    const parent = node.name;
    if (HIDDEN.has(child.name) || (child.name === 'URL' && (parent === 'Link' || parent === 'Image'))) {
      // marks and link destinations are not shown
    } else if (child.name === 'Escape') {
      push(text(child.from + 1, child.to), cls);
    } else if (child.name === 'URL') {
      push(text(child.from, child.to), join(cls, 'md-link'));
    } else {
      segments(child, text, join(cls, CLASSES[child.name]), out);
    }
    pos = Math.max(pos, child.to);
  }
  if (pos < node.to) push(text(pos, node.to), cls);
}

function alignOf(cell: string): Align {
  const c = cell.trim();
  const left = c.startsWith(':');
  const right = c.endsWith(':');
  return left && right ? 'center' : right ? 'right' : left ? 'left' : '';
}

/** Columns of an alignment row such as `|:--|--:|` (escapes cannot occur in it). */
function parseAligns(line: string): Align[] {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map(alignOf);
}

/**
 * Model of the Lezer `Table` node `table`. `text(from, to)` reads the document. Positions in the
 * model are relative to `table.from`.
 */
export function tableModel(table: SyntaxNode, text: (from: number, to: number) => string): TableModel {
  const base = table.from;
  const rows: RowModel[] = [];
  let aligns: Align[] = [];
  let delimiter = { from: 0, to: 0 };
  for (let child = table.firstChild; child; child = child.nextSibling) {
    if (child.name === 'TableDelimiter') {
      // Direct child: the alignment row.
      delimiter = { from: child.from - base, to: child.to - base };
      aligns = parseAligns(text(child.from, child.to).replace(/^[>\s]*/, ''));
      continue;
    }
    if (child.name !== 'TableHeader' && child.name !== 'TableRow') continue;
    const row: RowModel = { from: child.from - base, to: child.to - base, pipes: [], leading: false, cells: [] };
    const cells = new Map<number, CellModel>();
    let col = 0;
    let first = true;
    let lastPipe = false;
    for (let c = child.firstChild; c; c = c.nextSibling) {
      if (c.name === 'TableDelimiter') {
        row.pipes.push(c.from - base);
        if (first) row.leading = true;
        else col++;
        lastPipe = true;
      } else if (c.name === 'TableCell') {
        const segs: Segment[] = [];
        segments(c, text, '', segs);
        cells.set(col, { segments: segs, pos: c.from - base, end: c.to - base });
        lastPipe = false;
      } else {
        continue;
      }
      first = false;
    }
    // Header: its cell count (Lezer rule); other rows: the header's count.
    const n = rows[0]?.cells.length ?? Math.max(1, lastPipe ? col : col + 1);
    for (let i = 0; i < n; i++) {
      const cell = cells.get(i);
      if (cell) {
        row.cells.push(cell);
        continue;
      }
      // Empty or missing cell: after its opening pipe (and one space).
      const k = row.leading ? i : i - 1;
      const open = k < 0 ? undefined : row.pipes[k];
      let pos = row.to;
      if (k < 0) pos = row.from;
      else if (open !== undefined) {
        const next = row.pipes[k + 1] ?? row.to;
        pos = next - open > 2 ? open + 2 : open + 1;
      }
      row.cells.push({ segments: [], pos, end: pos });
    }
    rows.push(row);
  }
  const columns = rows[0]?.cells.length ?? 0;
  aligns = Array.from({ length: columns }, (_, i) => aligns[i] ?? '');
  return { columns, aligns, rows, delimiter };
}

/** Row and column of the cell at `rel` (relative to the table start). Row 0 = header row; the alignment row is not counted (a position on it gives row 0). */
export function cellAt(model: TableModel, rel: number): { row: number; column: number } {
  let row = 0;
  for (const [i, r] of model.rows.entries()) {
    if (rel >= r.from) row = i;
  }
  // On the alignment row: the header row.
  if (rel >= model.delimiter.from && rel <= model.delimiter.to) row = 0;
  const r = model.rows[row];
  if (!r) return { row: 0, column: 0 };
  let column = r.pipes.filter((p) => p < rel).length - (r.leading ? 1 : 0);
  column = Math.max(0, Math.min(model.columns - 1, column));
  return { row, column };
}

/** Hover buttons of the table widget. `index` = boundary (add) or row/column (remove). */
export type TableButton = { kind: 'addRow' | 'addColumn' | 'removeRow' | 'removeColumn'; index: number };

/**
 * The `tableAction` command of a hover button. Boundaries: row boundary `i` is above row `i`
 * (1..rows; `rows` = below the last row; none above the header row); column boundary `i` is left
 * of column `i` (0..columns; `columns` = right of the last column).
 */
export function tableActionFor(button: TableButton, table: { from: number; to: number }, rows: number, columns: number): Command {
  let action: TableAction;
  let row = 0;
  let column = 0;
  switch (button.kind) {
    case 'addRow':
      if (button.index < rows) {
        action = 'insertRowAbove';
        row = button.index;
      } else {
        action = 'insertRowBelow';
        row = rows - 1;
      }
      break;
    case 'addColumn':
      if (button.index < columns) {
        action = 'insertColumnLeft';
        column = button.index;
      } else {
        action = 'insertColumnRight';
        column = columns - 1;
      }
      break;
    case 'removeRow':
      action = 'removeRow';
      row = button.index;
      break;
    case 'removeColumn':
      action = 'removeColumn';
      column = button.index;
      break;
  }
  return { name: 'tableAction', action, from: table.from, to: table.to, row, column };
}
