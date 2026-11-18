/*
 * Live-preview decorations.
 *
 * Rule: the work per update is proportional to the visible range, not to the document.
 * - Inline and line decorations: a ViewPlugin that walks the syntax tree only inside
 *   `view.visibleRanges`.
 * - Block widgets (tables, `$$` math, Mermaid fences; block widgets that replace line breaks must
 *   come from a StateField): the field decorates only a window = viewport (sent by a small
 *   ViewPlugin through an effect) plus a margin, plus a margin around the main selection head (so
 *   a jump is covered at once).
 * - Heavy blocks (src/heavy/): inline math widgets and code highlighting marks (highlight.js)
 *   come from the visible-range plugin. KaTeX, Mermaid and highlight.js are lazy chunks, loaded
 *   when the first widget or code block of their kind is drawn.
 *
 * Reveal rule: a line is active when the caret or a selection range touches it. On active
 * lines every Markdown marker is visible (class `md-marker`); on other lines markers are hidden or
 * replaced by widgets. A block widget shows its source when the caret or the selection is inside it.
 *
 * Stable classes (docs/css.md): md-h1..6, md-strong, md-em, md-strike, md-code,
 * md-link, md-marker, md-quote, md-codeblock[data-lang], md-hr, md-bullet, md-list-number,
 * md-task, md-table, md-img, md-frontmatter, md-footnote, md-html-source, md-math,
 * md-math-block, md-mermaid, md-mermaid-error, hljs-*.
 */
import { syntaxTree } from '@codemirror/language';
import { type EditorState, type Extension, type Range, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import type { SyntaxNode, SyntaxNodeRef } from '@lezer/common';

import { awaitingDoubleClick } from './edit-mode';
import { docIdFacet } from './controller';
import { Lru, hash53, heavyStats, keyOf, lazy } from './heavy/cache';
import { CodeHighlighter, type LineRange, hljsName } from './heavy/highlight';
import { type ImageSource, resolveImage } from './images';
import { pathExists, pathsChanged } from './paths';
import type { Command } from './protocol';
import { type TableModel, cellAt, tableActionFor, tableModel } from './table-model';

/** Counters for tests: work per build must not grow with the document. */
export const stats = {
  builds: 0,
  lastBuildNodes: 0,
  maxBuildNodes: 0,
  tableBuilds: 0,
  lastTableNodes: 0,
  maxTableNodes: 0,
};

export function resetStats(): void {
  for (const k of Object.keys(stats) as (keyof typeof stats)[]) stats[k] = 0;
}

/** True when a selection range touches [from, to] (tables: caret or selection inside the block). */
function touches(state: EditorState, from: number, to: number): boolean {
  for (const r of state.selection.ranges) if (r.from <= to && r.to >= from) return true;
  return false;
}

/** Active lines as sorted [from, to] position ranges of whole lines. */
function activeLines(state: EditorState): [number, number][] {
  const out: [number, number][] = [];
  for (const r of state.selection.ranges) {
    const from = state.doc.lineAt(r.from).from;
    const to = state.doc.lineAt(r.to).to;
    const last = out[out.length - 1];
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

class Reveal {
  readonly lines: [number, number][];
  constructor(readonly state: EditorState) {
    this.lines = activeLines(state);
  }
  /** True when the line of `pos` is active. */
  at(pos: number): boolean {
    for (const [from, to] of this.lines) if (pos >= from && pos <= to) return true;
    return false;
  }
}

class BulletWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'md-bullet';
    span.textContent = '•';
    return span;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  override eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked;
  }
  toDOM(): HTMLElement {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'md-task';
    box.checked = this.checked;
    return box;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

class HrWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'md-hr';
    return span;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly source: ImageSource,
    readonly alt: string,
  ) {
    super();
  }
  override eq(other: ImageWidget): boolean {
    const a = this.source;
    const b = other.source;
    return other.alt === this.alt && a.kind === b.kind && (a.kind === 'url' ? a.url === (b as typeof a).url : a.text === (b as typeof a).text);
  }
  toDOM(view: EditorView): HTMLElement {
    if (this.source.kind === 'placeholder') {
      // Remote image while remote images are off, or a source we do not load: the URL as text.
      const span = document.createElement('span');
      span.className = 'md-img md-img-placeholder';
      span.textContent = this.source.text;
      span.title = this.alt;
      return span;
    }
    const img = document.createElement('img');
    img.className = 'md-img';
    img.alt = this.alt;
    img.loading = 'lazy';
    img.decoding = 'async';
    // The line height changes when the image (or the broken-image box) arrives.
    img.addEventListener('load', () => view.requestMeasure());
    img.addEventListener('error', () => view.requestMeasure());
    img.src = this.source.url;
    return img;
  }
}

/** Resolved image sources by (docId, src, remote images), bounded. */
const imageCache = new Map<string, ImageSource>();
let remoteImages = false;

function imageSource(docId: string, src: string): ImageSource {
  const key = `${remoteImages ? 1 : 0}${docId}\n${src}`;
  let out = imageCache.get(key);
  if (!out) {
    out = resolveImage(src, docId, remoteImages);
    if (imageCache.size >= 512) imageCache.delete(imageCache.keys().next().value as string);
    imageCache.set(key, out);
  }
  return out;
}

/** Effect that makes the decorations rebuild (settings or theme change). */
export const refresh = StateEffect.define<null>();

/**
 * Feature toggles (`settings`). Off: the construct shows as source, like a construct the page
 * does not render (math: the `$` markers as `md-marker`; Mermaid: a code block; code: no
 * highlighting), and its lazy chunk is not loaded.
 */
const features = { math: true, mermaid: true, highlight: true, softBreaks: true };

/**
 * Increases on each change of the render settings. The block field keeps the value it was built
 * with; a state built with an older value (a document activated later) is rebuilt.
 */
let generation = 0;

export interface RenderSettings {
  remoteImages: boolean;
  math: boolean;
  mermaid: boolean;
  highlight: boolean;
  /** Off: a single line feed inside a paragraph shows as a space (the lines flow together). */
  softBreaks: boolean;
}

/**
 * `settings`: sets remote images and the feature toggles. True when something changed; the caller
 * then dispatches `refresh` (with the scroll restore of the look change). Other states are rebuilt
 * before they are shown (`withCurrentSettings`).
 */
export function setRenderSettings(s: RenderSettings): boolean {
  if (s.remoteImages === remoteImages && s.math === features.math && s.mermaid === features.mermaid && s.highlight === features.highlight && s.softBreaks === features.softBreaks) return false;
  remoteImages = s.remoteImages;
  features.math = s.math;
  features.mermaid = s.mermaid;
  features.highlight = s.highlight;
  features.softBreaks = s.softBreaks;
  generation++;
  return true;
}

/** `theme {dark}`: Mermaid diagrams are drawn again with the matching Mermaid theme. True when it changed (dispatch `refresh`). */
export function setDarkTheme(dark: boolean): boolean {
  if (dark === darkTheme) return false;
  darkTheme = dark;
  generation++;
  return true;
}

/** Class of the hover buttons of the table widget (data-kind, data-index). */
const TABLE_BUTTON = 'md-table-btn';

class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly model: TableModel,
  ) {
    super();
  }
  override eq(other: TableWidget): boolean {
    return other.source === this.source;
  }
  override get estimatedHeight(): number {
    // Default theme: ~31.4 px per row + the wrapper padding.
    return Math.round(this.model.rows.length * 31.4 + 33);
  }
  toDOM(view: EditorView): HTMLElement {
    const { model } = this;
    const docId = view.state.facet(docIdFacet);
    const rows = model.rows.length;
    const columns = model.columns;
    const wrap = document.createElement('div');
    wrap.className = 'md-table-wrap';
    // A click focuses the wrap, so the editor leaves the selection inside the table alone (it can then be selected and copied).
    wrap.tabIndex = -1;
    wrap.dataset['length'] = String(this.source.length);
    wrap.dataset['rows'] = String(rows);
    wrap.dataset['columns'] = String(columns);
    const table = document.createElement('table');
    table.className = 'md-table';
    // The "+"/"×" glyphs come from CSS (::before), so a cell's text is only its content.
    const button = (kind: string, index: number, title: string, place: string): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.className = `${TABLE_BUTTON} md-table-${kind.startsWith('add') ? 'add' : 'remove'} md-table-${place}`;
      b.dataset['kind'] = kind;
      b.dataset['index'] = String(index);
      b.title = title;
      b.setAttribute('aria-label', title);
      return b;
    };
    model.rows.forEach((row, r) => {
      const parent = r === 0 ? table.createTHead() : (table.tBodies[0] ?? table.createTBody());
      const tr = parent.insertRow();
      row.cells.forEach((cell, c) => {
        const td = document.createElement(r === 0 ? 'th' : 'td');
        td.dataset['row'] = String(r);
        td.dataset['col'] = String(c);
        td.dataset['pos'] = String(cell.pos);
        const align = model.aligns[c];
        if (align) td.style.textAlign = align;
        for (const seg of cell.segments) {
          if (!seg.cls) {
            td.appendChild(document.createTextNode(seg.text));
            continue;
          }
          const span = document.createElement('span');
          span.className = seg.cls;
          span.textContent = seg.text;
          // Path code: `md-path` once the IDE said the file exists (`pathsPlugin` updates it later).
          const path = seg.cls.split(' ').includes('md-code') ? codePath(seg.text) : null;
          if (path) {
            span.dataset['path'] = path;
            if (pathExists(docId, path)) span.classList.add('md-path');
          }
          td.appendChild(span);
        }
        if (r === 0) {
          td.appendChild(button('addColumn', c, 'Insert column', 'col-before'));
          if (c === columns - 1) td.appendChild(button('addColumn', columns, 'Insert column', 'col-after'));
          if (columns > 1) td.appendChild(button('removeColumn', c, 'Remove column', 'col-remove'));
        }
        if (c === 0) {
          if (r > 0) td.appendChild(button('addRow', r, 'Insert row', 'row-before'));
          if (r === rows - 1) td.appendChild(button('addRow', rows, 'Insert row', 'row-after'));
        }
        if (c === columns - 1 && r > 0) td.appendChild(button('removeRow', r, 'Remove row', 'row-remove'));
        tr.appendChild(td);
      });
    });
    wrap.appendChild(table);
    return wrap;
  }
  /*
   * Waiting for a double-click: the editor leaves a left click in the table to the browser, so the
   * cell text can be selected and copied and the table stays rendered. The "+"/"×" buttons still get it.
   */
  override ignoreEvent(event: Event): boolean {
    if (event.type !== 'mousedown' || (event as MouseEvent).button !== 0 || !(event.target instanceof HTMLElement)) return false;
    if (event.target.closest(`.${TABLE_BUTTON}`)) return false;
    // Ctrl/Cmd-click on a file path opens the file (main.ts).
    if ((event as MouseEvent).ctrlKey || (event as MouseEvent).metaKey) {
      if (event.target.closest('.md-path')) return false;
    }
    const view = EditorView.findFromDOM(event.target.closest<HTMLElement>('.cm-editor') ?? event.target);
    return view?.state.facet(awaitingDoubleClick) ?? false;
  }
}

/* ---------- Math and Mermaid widgets (lazy chunks src/heavy/math.ts, src/heavy/mermaid.ts) ---------- */

type MathModule = typeof import('./heavy/math');
let mathModule: MathModule | null = null;
// A failed chunk load is retried by the next widget drawn (lazy()).
const mathLoad = lazy(() =>
  import('./heavy/math').then((m) => {
    heavyStats.chunks.push('math');
    return (mathModule = m);
  }),
);
const mermaidLoad = lazy(() =>
  import('./heavy/mermaid').then((m) => {
    heavyStats.chunks.push('mermaid');
    return m;
  }),
);

/** Measured widget heights by source key (`estimatedHeight` of the next widget for the same source). */
const heights = new Lru<number>(2000, 2000);

const warnLoad = (e: unknown): void => console.warn('markdone: lazy chunk not loaded', e);

/** Measures the widget after its content arrived (its height changes). */
function measured(view: EditorView, el: HTMLElement, key: string): void {
  view.requestMeasure({ read: () => el.offsetHeight, write: (h) => h > 0 && heights.set(key, h) });
}

class MathWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly display: boolean,
  ) {
    super();
  }
  override eq(other: MathWidget): boolean {
    return other.src === this.src && other.display === this.display;
  }
  override get estimatedHeight(): number {
    return this.display ? (heights.get(`M${keyOf(this.src)}`) ?? 48) : -1;
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement(this.display ? 'div' : 'span');
    el.className = this.display ? 'md-math md-math-block' : 'md-math';
    if (mathModule) {
      mathModule.renderMath(el, this.src, this.display);
      return el;
    }
    // First formula of the session: the source until KaTeX is loaded.
    el.textContent = this.src;
    // A widget built before math was turned off (a refresh replaces it): no chunk load.
    if (!features.math) return el;
    el.classList.add('md-math-pending');
    void mathLoad().then((m) => {
      if (!el.isConnected) return;
      el.textContent = '';
      el.classList.remove('md-math-pending');
      m.renderMath(el, this.src, this.display);
      if (this.display) measured(view, el, `M${keyOf(this.src)}`);
      else view.requestMeasure();
    }, warnLoad);
    return el;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

class MermaidWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly dark: boolean,
  ) {
    super();
  }
  override eq(other: MermaidWidget): boolean {
    return other.src === this.src && other.dark === this.dark;
  }
  override get estimatedHeight(): number {
    return heights.get(`G${keyOf(this.src)}`) ?? 240;
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('div');
    // A widget built before Mermaid was turned off (a refresh replaces it): the source, no chunk load.
    if (!features.mermaid) {
      el.className = 'md-mermaid';
      el.textContent = this.src;
      return el;
    }
    el.className = 'md-mermaid md-mermaid-pending';
    el.style.minHeight = `${this.estimatedHeight}px`;
    void mermaidLoad().then((m) => {
      if (!el.isConnected) return;
      const done = () => {
        el.style.minHeight = '';
        measured(view, el, `G${keyOf(this.src)}`);
      };
      m.fillMermaid(el, this.src, this.dark, done);
      // Cache hit: filled at once.
      if (!el.classList.contains('md-mermaid-pending')) done();
    }, warnLoad);
    return el;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

/** Mermaid theme: follows `theme.dark` (setDarkTheme). */
let darkTheme = false;

/**
 * Content ranges, one per line, of [from, to) inside `node` without its container markers: on each
 * line after the node's first line, the blockquote `>` markers (the node's QuoteMark children, each
 * with one space) and up to the list indentation of the node's first line are left out. Null when
 * the node has no such markers ([from, to) is the content as is).
 */
function blockLines(state: EditorState, node: SyntaxNode, from: number, to: number): LineRange[] | null {
  const { doc } = state;
  const first = doc.lineAt(node.from);
  const indent = doc.sliceString(first.from, node.from).replace(/^(?:[ \t]*>[ ]?)*/, '').length;
  const quotes = node.getChildren('QuoteMark');
  if (quotes.length === 0 && indent === 0) return null;
  const out: LineRange[] = [];
  let q = 0;
  for (let pos = from; ; ) {
    const line = doc.lineAt(pos);
    const end = Math.min(line.to, to);
    if (pos === line.from && line.number > first.number) {
      while (q < quotes.length && (quotes[q] as SyntaxNode).from < line.from) q++;
      for (let m = quotes[q]; m && m.to <= line.to; m = quotes[++q]) pos = doc.sliceString(m.to, m.to + 1) === ' ' ? m.to + 1 : m.to;
      for (let n = 0; n < indent && pos < end && doc.sliceString(pos, pos + 1) === ' '; n++) pos++;
    }
    out.push({ from: Math.min(pos, end), to: end });
    if (line.to >= to) break;
    pos = line.to + 1;
  }
  return out;
}

/** Text of [from, to) inside `node` without its container markers (`blockLines`). */
function blockText(state: EditorState, node: SyntaxNode, from: number, to: number): string {
  const ranges = blockLines(state, node, from, to);
  return ranges ? ranges.map((r) => state.doc.sliceString(r.from, r.to)).join('\n') : state.doc.sliceString(from, to);
}

/** Text between the `MathMark`s of an InlineMath/BlockMath node (to the node end when unclosed). */
function mathSource(state: EditorState, node: SyntaxNode): string {
  const m = node.getChildren('MathMark');
  const open = m[0];
  const close = m.length > 1 ? m[m.length - 1] : undefined;
  return blockText(state, node, open ? open.to : node.from, close ? close.from : node.to).trim();
}

/** Language word of a fenced code block's info string ('' when none). */
function fenceInfo(state: EditorState, node: SyntaxNode): string {
  const info = node.getChild('CodeInfo');
  return info ? (state.doc.sliceString(info.from, info.to).trim().split(/\s/)[0] ?? '') : '';
}

/** Body of a fenced code block: from the line after the opening fence to the end of the line before the closing fence. */
function fenceBody(state: EditorState, node: SyntaxNode): { from: number; to: number } {
  const from = Math.min(node.to, state.doc.lineAt(node.from).to + 1);
  const marks = node.getChildren('CodeMark');
  const close = marks.length > 1 ? marks[marks.length - 1] : undefined;
  const to = close ? Math.max(from, state.doc.lineAt(close.from).from - 1) : node.to;
  return { from, to };
}

/**
 * The project file path written as inline code (`src/Foo.kt`), or `null`. Relative only: no scheme,
 * no leading `/` or `~`, no spaces. It needs a `/` or a file extension (`README.md`).
 */
export function codePath(text: string): string | null {
  const t = text.trim();
  if (!/^[\w.@+-]+(\/[\w.@+-]+)*$/.test(t) || !/\/|\.[A-Za-z0-9]{1,8}$/.test(t)) return null;
  return t;
}

/** The path inside an `InlineCode` node, or `null`. */
export function inlineCodePath(state: EditorState, node: SyntaxNode): string | null {
  const marks = node.getChildren('CodeMark');
  const from = marks[0]?.to ?? node.from;
  const to = marks.length > 1 ? (marks[marks.length - 1]?.from ?? node.to) : node.to;
  return codePath(state.doc.sliceString(from, to));
}

const hide = Decoration.replace({});
const bullet = Decoration.replace({ widget: new BulletWidget() });
const hr = Decoration.replace({ widget: new HrWidget() });
const mark = (cls: string) => Decoration.mark({ class: cls });
const marks = {
  Emphasis: mark('md-em'),
  StrongEmphasis: mark('md-strong'),
  Strikethrough: mark('md-strike'),
  InlineCode: mark('md-code'),
  link: mark('md-link'),
  marker: mark('md-marker'),
  html: mark('md-html-source'),
  footnote: mark('md-footnote'),
  number: mark('md-list-number'),
};
const lineDeco = (cls: string) => Decoration.line({ class: cls });
const lines = {
  quote: lineDeco('md-quote'),
  frontmatter: lineDeco('md-frontmatter'),
  tableSrc: lineDeco('md-table-src'),
  heading: [1, 2, 3, 4, 5, 6].map((n) => lineDeco(`md-h md-h${n}`)),
};
/** Mark decorations by class (code highlighting). */
const markCache = new Map<string, Decoration>();
function markOf(cls: string): Decoration {
  let deco = markCache.get(cls);
  if (!deco) markCache.set(cls, (deco = Decoration.mark({ class: cls })));
  return deco;
}
const codeLines = new Map<string, Decoration>();
function codeLine(lang: string): Decoration {
  let deco = codeLines.get(lang);
  if (!deco) {
    deco = Decoration.line({ class: 'md-codeblock', attributes: { 'data-lang': lang } });
    codeLines.set(lang, deco);
  }
  return deco;
}

/** Inline marker nodes whose parent decides that they are hidden on inactive lines. */
const INLINE_MARKS: Record<string, string[]> = {
  EmphasisMark: ['Emphasis', 'StrongEmphasis'],
  StrikethroughMark: ['Strikethrough'],
  CodeMark: ['InlineCode'],
  FootnoteMark: ['FootnoteReference'],
};

/** Adds a line decoration to every line of [from, to] that is inside [vFrom, vTo]. */
function eachLine(state: EditorState, from: number, to: number, vFrom: number, vTo: number, deco: Decoration, out: Range<Decoration>[]): void {
  let pos = Math.max(from, vFrom);
  const end = Math.min(to, vTo);
  while (pos <= end) {
    const line = state.doc.lineAt(pos);
    out.push(deco.range(line.from));
    pos = line.to + 1;
  }
}

function headingLevel(name: string): number {
  if (name.startsWith('ATXHeading')) return Number(name.slice(10));
  if (name === 'SetextHeading1') return 1;
  if (name === 'SetextHeading2') return 2;
  return 0;
}

/**
 * Marker [from, to): `md-marker` on an active line, else hidden. A plugin cannot replace a line
 * break, so a marker that spans lines is never hidden.
 */
function marker(reveal: Reveal, from: number, to: number, out: Range<Decoration>[]): void {
  if (to <= from) return;
  const hidden = !reveal.at(from) && reveal.state.doc.lineAt(from).to >= to;
  out.push((hidden ? hide : marks.marker).range(from, to));
}

/**
 * `docChanged`: this update changes the document (typing), so code blocks are never sliced,
 * hashed or highlighted in it (heavy/highlight.ts).
 */
function buildInline(view: EditorView, code: CodeHighlighter, docChanged: boolean): DecorationSet {
  const { state } = view;
  code.begin();
  const reveal = new Reveal(state);
  const out: Range<Decoration>[] = [];
  const seen = new Set<number>();
  let nodes = 0;
  const tree = syntaxTree(state);
  for (const { from: vFrom, to: vTo } of view.visibleRanges) {
    tree.iterate({
      from: vFrom,
      to: vTo,
      enter: (ref: SyntaxNodeRef): boolean | undefined => {
        nodes++;
        const { name, from, to } = ref;
        // Several visible ranges can share a node; decorate each node once.
        const key = from * 64 + (ref.type.id % 64);
        if (name !== 'Document' && seen.has(key)) return false;
        seen.add(key);
        const level = headingLevel(name);
        if (level > 0) {
          const deco = lines.heading[level - 1];
          if (deco) eachLine(state, from, to, vFrom, vTo, deco, out);
          return;
        }
        switch (name) {
          case 'Table':
            // Rendered by the table field; when the caret is inside, the source is shown.
            eachLine(state, from, to, vFrom, vTo, lines.tableSrc, out);
            return false;
          case 'HeaderMark': {
            const heading = ref.node.parent;
            if (!heading) return;
            const line = state.doc.lineAt(from);
            if (heading.name.startsWith('Setext') || reveal.at(from)) {
              marker(reveal, from, to, out);
              return;
            }
            // ATX: hide the marks and the space between them and the text.
            if (from === heading.from) {
              let end = to;
              while (end < line.to && state.doc.sliceString(end, end + 1) === ' ') end++;
              out.push(hide.range(from, end));
            } else {
              let start = from;
              while (start > line.from && state.doc.sliceString(start - 1, start) === ' ') start--;
              out.push(hide.range(start, to));
            }
            return;
          }
          case 'Emphasis':
          case 'StrongEmphasis':
          case 'Strikethrough':
            out.push(marks[name].range(from, to));
            return;
          case 'InlineCode': {
            // A file path is marked only when the IDE said the file exists (async, `paths`).
            const path = inlineCodePath(state, ref.node);
            if (path && pathExists(state.facet(docIdFacet), path)) {
              out.push(Decoration.mark({ class: 'md-code md-path', attributes: { 'data-path': path } }).range(from, to));
            } else {
              out.push(marks.InlineCode.range(from, to));
            }
            return;
          }
          case 'EmphasisMark':
          case 'StrikethroughMark':
          case 'CodeMark':
          case 'FootnoteMark': {
            const parent = ref.node.parent;
            if (!parent) return;
            if (INLINE_MARKS[name]?.includes(parent.name) || parent.name === 'FencedCode') marker(reveal, from, to, out);
            return;
          }
          case 'FootnoteReference':
            out.push(marks.footnote.range(from, to));
            return;
          case 'FootnoteLabel':
            out.push(marks.footnote.range(from, to));
            return false;
          case 'Link':
            linkDecorations(reveal, ref.node, out);
            return;
          case 'Image':
            return imageDecorations(state, reveal, ref.node, out);
          case 'Autolink':
            // `<url>`: the angle brackets are markers.
            for (const m of ref.node.getChildren('LinkMark')) marker(reveal, m.from, m.to, out);
            return;
          case 'URL': {
            const parent = ref.node.parent?.name;
            if (parent !== 'Link' && parent !== 'Image' && parent !== 'LinkReference') out.push(marks.link.range(from, to));
            return;
          }
          case 'ListMark': {
            const item = ref.node.parent;
            if (reveal.at(from)) {
              out.push(marks.marker.range(from, to));
              return;
            }
            if (item?.parent?.name === 'OrderedList') {
              out.push(marks.number.range(from, to));
              return;
            }
            if (item?.parent?.name !== 'BulletList') return;
            const next = ref.node.nextSibling;
            if (next?.name === 'Task') {
              // A task item shows only its check box.
              const end = Math.min(next.from, state.doc.lineAt(from).to);
              out.push(hide.range(from, end));
            } else {
              out.push(bullet.range(from, to));
            }
            return;
          }
          case 'TaskMarker':
            if (reveal.at(from)) {
              out.push(marks.marker.range(from, to));
            } else {
              const checked = /x/i.test(state.doc.sliceString(from + 1, from + 2));
              out.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(from, to));
            }
            return;
          case 'Blockquote':
            eachLine(state, from, to, vFrom, vTo, lines.quote, out);
            return;
          case 'QuoteMark': {
            if (reveal.at(from)) {
              out.push(marks.marker.range(from, to));
            } else {
              const end = state.doc.sliceString(to, to + 1) === ' ' ? to + 1 : to;
              out.push(hide.range(from, end));
            }
            return;
          }
          case 'FencedCode':
          case 'CodeBlock': {
            const lang = name === 'FencedCode' ? fenceInfo(state, ref.node) : '';
            eachLine(state, from, to, vFrom, vTo, codeLine(lang), out);
            const hl = lang && features.highlight ? hljsName(lang) : null;
            if (hl) {
              // Highlight marks for the visible part of the block; in a quote or a list item, of the text without the markers.
              const body = fenceBody(state, ref.node);
              const node = ref.node;
              const tokens = body.to > body.from ? code.tokens(body.from, body.to, hl, !docChanged, () => blockLines(state, node, body.from, body.to)) : null;
              if (tokens) {
                for (const [a, z, cls] of tokens) {
                  const s = body.from + a;
                  const e = Math.min(body.from + z, body.to);
                  if (e > vFrom && s < vTo && e > s) out.push(markOf(cls).range(s, e));
                }
              }
            }
            return;
          }
          case 'InlineMath': {
            // One-line formula on an inactive line: rendered; else the source with `$` markers.
            if (features.math && !reveal.at(from) && state.doc.lineAt(from).to >= to) {
              const src = mathSource(state, ref.node);
              const display = state.doc.sliceString(from, from + 2) === '$$';
              if (src) {
                out.push(Decoration.replace({ widget: new MathWidget(src, display) }).range(from, to));
                return false;
              }
            }
            for (const m of ref.node.getChildren('MathMark')) out.push(marks.marker.range(m.from, m.to));
            return false;
          }
          case 'BlockMath':
            // Rendered by the block field; when the caret is inside, the source with `$$` markers.
            for (const m of ref.node.getChildren('MathMark')) out.push(marks.marker.range(m.from, m.to));
            return false;
          case 'CodeInfo':
            marker(reveal, from, to, out);
            return;
          case 'HorizontalRule':
            if (reveal.at(from)) out.push(marks.marker.range(from, to));
            else out.push(hr.range(from, to));
            return false;
          case 'FrontMatter':
            eachLine(state, from, to, vFrom, vTo, lines.frontmatter, out);
            return;
          case 'FrontMatterMark':
            out.push(marks.marker.range(from, to));
            return;
          case 'HTMLBlock':
          case 'HTMLTag':
          case 'Comment':
          case 'CommentBlock':
          case 'ProcessingInstructionBlock':
            // Raw HTML: always source text, never rendered.
            if (to > from) out.push(marks.html.range(from, to));
            return false;
        }
      },
    });
  }
  code.end();
  stats.builds++;
  stats.lastBuildNodes = nodes;
  stats.maxBuildNodes = Math.max(stats.maxBuildNodes, nodes);
  return Decoration.set(out, true);
}

function linkDecorations(reveal: Reveal, link: SyntaxNode, out: Range<Decoration>[]): void {
  const linkMarks: SyntaxNode[] = [];
  for (let c = link.firstChild; c; c = c.nextSibling) if (c.name === 'LinkMark') linkMarks.push(c);
  const open = linkMarks[0];
  const close = linkMarks[1];
  if (!open || !close || open.to >= close.from) return;
  out.push(marks.link.range(open.to, close.from));
  marker(reveal, open.from, open.to, out);
  // `](url "title")` (or `]` alone): hidden as one piece when its start line is inactive.
  marker(reveal, close.from, link.to, out);
}

function imageDecorations(state: EditorState, reveal: Reveal, image: SyntaxNode, out: Range<Decoration>[]): boolean {
  const linkMarks = image.getChildren('LinkMark');
  const open = linkMarks[0];
  const close = linkMarks[1];
  const oneLine = state.doc.lineAt(image.from).number === state.doc.lineAt(image.to).number;
  if (reveal.at(image.from) || reveal.at(image.to) || !oneLine || !open || !close) {
    // Source: `![` and `](src)` as markers, the alt text as text.
    if (open && close && open.to <= close.from) {
      out.push(marks.marker.range(open.from, open.to));
      out.push(marks.marker.range(close.from, image.to));
    } else {
      out.push(marks.marker.range(image.from, image.to));
    }
    return false;
  }
  const url = image.getChild('URL');
  // Reference images (`![a][ref]`) have no URL here: left as text.
  if (!url) return false;
  const source = imageSource(state.facet(docIdFacet), state.doc.sliceString(url.from, url.to));
  const alt = state.doc.sliceString(open.to, close.from);
  out.push(Decoration.replace({ widget: new ImageWidget(source, alt) }).range(image.from, image.to));
  return false;
}

const inlinePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    readonly code: CodeHighlighter;
    constructor(view: EditorView) {
      this.code = new CodeHighlighter(
        () => view.state.doc,
        () => view.dispatch({ effects: refresh.of(null) }),
      );
      this.decorations = buildInline(view, this.code, false);
    }
    update(u: ViewUpdate): void {
      if (u.docChanged) this.code.map(u.changes);
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        syntaxTree(u.startState) !== syntaxTree(u.state) ||
        u.transactions.some((tr) => tr.effects.some((e) => e.is(refresh) || e.is(pathsChanged)))
      ) {
        this.decorations = buildInline(u.view, this.code, u.docChanged);
      }
    }
    destroy(): void {
      this.code.destroy();
    }
  },
  { decorations: (v) => v.decorations },
);

/* ---------- Block widgets (tables, math, Mermaid): StateField limited to a window ---------- */

interface Win {
  from: number;
  to: number;
}

const setWindow = StateEffect.define<Win>();
/** Margin around the viewport and the selection head, in lines. */
const MARGIN_LINES = 200;

interface TableState {
  win: Win;
  decos: DecorationSet;
  /** `generation` the widgets were built with. */
  gen: number;
}

function around(state: EditorState, from: number, to: number): Win {
  const { doc } = state;
  const a = doc.lineAt(from).number;
  const b = doc.lineAt(to).number;
  return { from: doc.line(Math.max(1, a - MARGIN_LINES)).from, to: doc.line(Math.min(doc.lines, b + MARGIN_LINES)).to };
}

/*
 * Table models, LRU keyed by `<length>:<53-bit hash>` of the table source (the model is relative
 * to the table start, so it does not depend on the position). No source strings are kept as keys.
 * Bound: at most TABLE_CACHE_ENTRIES models and TABLE_CACHE_CHARS source characters in total (a
 * model is about the size of its source); a table larger than the char bound is not cached.
 */
const TABLE_CACHE_ENTRIES = 256;
const TABLE_CACHE_CHARS = 1 << 20;
const tableCache = new Map<string, { model: TableModel; chars: number }>();
let tableCacheChars = 0;

function modelOf(state: EditorState, table: SyntaxNode, source: string): TableModel {
  const key = `${source.length}:${hash53(source)}`;
  const hit = tableCache.get(key);
  if (hit) {
    // Most recently used last.
    tableCache.delete(key);
    tableCache.set(key, hit);
    return hit.model;
  }
  const model = tableModel(table, (a, b) => state.doc.sliceString(a, b));
  const chars = source.length;
  if (chars > TABLE_CACHE_CHARS) return model;
  while (tableCache.size >= TABLE_CACHE_ENTRIES || tableCacheChars + chars > TABLE_CACHE_CHARS) {
    const [oldKey, old] = tableCache.entries().next().value as [string, { chars: number }];
    tableCache.delete(oldKey);
    tableCacheChars -= old.chars;
  }
  tableCache.set(key, { model, chars });
  tableCacheChars += chars;
  return model;
}

function tableWidget(state: EditorState, table: SyntaxNode): Decoration {
  const source = state.doc.sliceString(table.from, table.to);
  return Decoration.replace({ widget: new TableWidget(source, modelOf(state, table, source)), block: true });
}

/** Block widget of a table, a `$$` block or a Mermaid fence; null for other nodes. */
function blockWidget(state: EditorState, node: SyntaxNode): Decoration | null {
  if (node.name === 'Table') return tableWidget(state, node);
  if (node.name === 'BlockMath') {
    if (!features.math) return null;
    const src = mathSource(state, node);
    return src ? Decoration.replace({ widget: new MathWidget(src, true), block: true }) : null;
  }
  if (!features.mermaid || fenceInfo(state, node) !== 'mermaid') return null;
  const body = fenceBody(state, node);
  return Decoration.replace({ widget: new MermaidWidget(blockText(state, node, body.from, body.to), darkTheme), block: true });
}

class SoftBreakWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  override toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.textContent = ' ';
    return el;
  }
}

const softBreak = Decoration.replace({ widget: new SoftBreakWidget() });

/**
 * Replaces each single line feed of `para` (and the quote marks and indentation of the next line)
 * with a space. A hard break (`HardBreak` ends after its line feed) stays. A paragraph that the
 * caret or the selection touches shows its source.
 */
function softBreakDecorations(state: EditorState, para: SyntaxNode, out: Range<Decoration>[]): void {
  if (touches(state, para.from, para.to)) return;
  const hardEnds = new Set<number>();
  for (let c = para.firstChild; c; c = c.nextSibling) if (c.name === 'HardBreak') hardEnds.add(c.to);
  const { doc } = state;
  const last = doc.lineAt(para.to).number;
  for (let n = doc.lineAt(para.from).number; n < last; n++) {
    const line = doc.line(n);
    if (hardEnds.has(line.to + 1)) continue;
    const next = doc.line(n + 1);
    const lead = next.text.length - next.text.replace(/^[ \t>]+/, '').length;
    out.push(softBreak.range(line.to, next.from + lead));
  }
}

function buildTables(state: EditorState, windows: Win[]): DecorationSet {
  const out: Range<Decoration>[] = [];
  const done = new Set<number>();
  let nodes = 0;
  const tree = syntaxTree(state);
  for (const w of windows) {
    tree.iterate({
      from: w.from,
      to: w.to,
      enter: (ref) => {
        nodes++;
        if (ref.name === 'Table' || ref.name === 'BlockMath' || ref.name === 'FencedCode') {
          if (!done.has(ref.from) && !touches(state, ref.from, ref.to)) {
            const deco = blockWidget(state, ref.node);
            if (deco) out.push(deco.range(ref.from, ref.to));
          }
          done.add(ref.from);
          return false;
        }
        if (ref.name === 'Paragraph') {
          if (!features.softBreaks && !done.has(ref.from)) softBreakDecorations(state, ref.node, out);
          done.add(ref.from);
          return false;
        }
        // Block widgets are top level or inside lists and quotes only.
        return ref.name === 'Document' || ref.name === 'BulletList' || ref.name === 'OrderedList' || ref.name === 'ListItem' || ref.name === 'Blockquote';
      },
    });
  }
  stats.tableBuilds++;
  stats.lastTableNodes = nodes;
  stats.maxTableNodes = Math.max(stats.maxTableNodes, nodes);
  return Decoration.set(out, true);
}

function windowsFor(state: EditorState, win: Win): Win[] {
  const head = state.selection.main.head;
  const sel = around(state, head, head);
  return sel.to < win.from || sel.from > win.to ? [win, sel].sort((a, b) => a.from - b.from) : [{ from: Math.min(win.from, sel.from), to: Math.max(win.to, sel.to) }];
}

export const tableField = StateField.define<TableState>({
  create(state) {
    const win = around(state, 0, Math.min(state.doc.length, 3000));
    return { win, decos: buildTables(state, windowsFor(state, win)), gen: generation };
  },
  update(value, tr) {
    let win = value.win;
    let changed = false;
    for (const e of tr.effects) {
      if (e.is(setWindow)) {
        win = e.value;
        changed = true;
      }
      if (e.is(refresh)) changed = true;
    }
    if (!changed && tr.docChanged) {
      win = { from: tr.changes.mapPos(win.from, -1), to: tr.changes.mapPos(win.to, 1) };
    }
    if (changed || tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
      return { win, decos: buildTables(tr.state, windowsFor(tr.state, win)), gen: generation };
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
});

/**
 * `state` with its block widgets rebuilt when they were built with older render settings, else
 * `state`. For a state that the view is about to show (`setState`): the view then never draws the
 * old widgets (a widget of a feature that is off would load its chunk).
 */
export function withCurrentSettings(state: EditorState): EditorState {
  const field = state.field(tableField, false);
  return field && field.gen !== generation ? state.update({ effects: refresh.of(null) }).state : state;
}

/**
 * Sends the viewport (+ margin) to the block field when it leaves the current window, and a
 * refresh when the field was built with older render settings (a state activated after a change).
 */
const windowPlugin = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      this.check();
    }
    update(u: ViewUpdate): void {
      if (u.viewportChanged || u.docChanged) this.check();
    }
    check(): void {
      // No dispatch during an update: post it.
      queueMicrotask(() => {
        const { view } = this;
        const field = view.state.field(tableField, false);
        if (!field) return;
        if (field.gen !== generation) view.dispatch({ effects: refresh.of(null) });
        const { from, to } = view.viewport;
        if (from >= field.win.from && to <= field.win.to) return;
        view.dispatch({ effects: setWindow.of(around(view.state, from, to)) });
      });
    }
  },
);

interface TableHit {
  from: number;
  to: number;
  row: number;
  column: number;
  /** Caret position of the cell. */
  pos: number;
}

/** The table cell of the widget under `target`, or null. */
function widgetCell(view: EditorView, target: EventTarget | null): TableHit | null {
  if (!(target instanceof Element)) return null;
  const wrap = target.closest<HTMLElement>('.md-table-wrap');
  const cell = target.closest<HTMLElement>('[data-row]');
  if (!wrap || !cell || !view.contentDOM.contains(wrap)) return null;
  const from = view.posAtDOM(wrap);
  return {
    from,
    to: from + Number(wrap.dataset['length']),
    row: Number(cell.dataset['row']),
    column: Number(cell.dataset['col']),
    pos: from + Number(cell.dataset['pos']),
  };
}

/**
 * The table cell at a mouse event: from the widget (rendered table) or from the source (caret
 * inside the table). For `contextMenu.table`.
 */
export function tableAtEvent(view: EditorView, event: MouseEvent): { from: number; to: number; row: number; column: number } | null {
  const hit = widgetCell(view, event.target);
  if (hit) return { from: hit.from, to: hit.to, row: hit.row, column: hit.column };
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos === null) return null;
  for (let n: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name !== 'Table') continue;
    const source = view.state.doc.sliceString(n.from, n.to);
    return { from: n.from, to: n.to, ...cellAt(modelOf(view.state, n, source), pos - n.from) };
  }
  return null;
}

/** Document position of a mouse event; a rendered table cell maps to its source position. */
export function posAtEvent(view: EditorView, event: MouseEvent): number | null {
  return widgetCell(view, event.target)?.pos ?? view.posAtCoords({ x: event.clientX, y: event.clientY });
}

/**
 * Clicks: check boxes toggle `[ ]`/`[x]`; table "+"/"×" buttons send `tableAction`; a click on a
 * table cell puts the caret at the cell's source (the table then shows its source); a click
 * on a formula or a diagram puts the caret at its start.
 * Ctrl/Cmd-clicks are left to the page handler (link / gotoSource).
 */
function clicks(command: (c: Command) => void): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      const target = event.target as HTMLElement | null;
      if (!target) return false;
      // Right button on a rendered table: keep the widget (no caret move); `contextmenu` follows.
      if (event.button === 2 && target.closest('.md-table-wrap')) {
        event.preventDefault();
        return true;
      }
      if (event.button !== 0 || event.ctrlKey || event.metaKey) return false;
      if (target.classList.contains('md-task')) {
        const pos = view.posAtDOM(target);
        const text = view.state.doc.sliceString(pos, pos + 3);
        if (!/^\[[ xX]\]$/.test(text) || view.state.readOnly) return false;
        view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: text[1] === ' ' ? 'x' : ' ' }, userEvent: 'input.toggle' });
        event.preventDefault();
        return true;
      }
      const btn = target.closest<HTMLElement>(`.${TABLE_BUTTON}`);
      const wrap = target.closest<HTMLElement>('.md-table-wrap');
      if (btn && wrap) {
        event.preventDefault();
        if (view.state.readOnly) return true;
        const from = view.posAtDOM(wrap);
        const kind = btn.dataset['kind'] as 'addRow' | 'addColumn' | 'removeRow' | 'removeColumn';
        command(
          tableActionFor(
            { kind, index: Number(btn.dataset['index']) },
            { from, to: from + Number(wrap.dataset['length']) },
            Number(wrap.dataset['rows']),
            Number(wrap.dataset['columns']),
          ),
        );
        return true;
      }
      if (wrap) {
        const hit = widgetCell(view, target);
        view.dispatch({ selection: { anchor: hit ? hit.pos : view.posAtDOM(wrap) } });
        view.focus();
        event.preventDefault();
        return true;
      }
      // A rendered formula or diagram: the caret goes to its start (the block then shows its source).
      const heavy = target.closest('.md-math, .md-mermaid');
      if (heavy) {
        view.dispatch({ selection: { anchor: view.posAtDOM(heavy) } });
        view.focus();
        event.preventDefault();
        return true;
      }
      return false;
    },
  });
}

/** Table cells are widgets: a `paths` answer toggles `md-path` on their path code in place. */
const pathsPlugin = ViewPlugin.fromClass(
  class {
    update(u: ViewUpdate): void {
      if (!u.transactions.some((tr) => tr.effects.some((e) => e.is(pathsChanged)))) return;
      const docId = u.state.facet(docIdFacet);
      for (const span of u.view.dom.querySelectorAll<HTMLElement>('.md-table-wrap [data-path]')) {
        span.classList.toggle('md-path', pathExists(docId, span.dataset['path'] ?? ''));
      }
    }
  },
);

export function livePreview(command: (c: Command) => void): Extension {
  return [inlinePlugin, tableField, windowPlugin, pathsPlugin, clicks(command)];
}
