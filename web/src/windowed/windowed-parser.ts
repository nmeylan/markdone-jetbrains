/*
 * Windowed Lezer parse inside CodeMirror's own Language.
 *
 * `WindowedParser` wraps the Markdown parser. For documents of `windowConfig.minLength` or more, when it
 * runs inside CodeMirror's parse (`ParseContext.get()`), it parses only a window around
 * `ParseContext.viewport`: from a safe boundary before the viewport to a safe boundary after it
 * (`BoundaryIndex`). The result is one tree of the full document length: a `Document` node with
 * the window's top-level blocks at their real offsets and nothing elsewhere. The regions outside
 * the window are registered with `ParseContext.skipUntilInView`, so CodeMirror reparses as soon as
 * the viewport touches them. Below the limit, or outside an editor, it is the plain parser.
 *
 * `windowDriver`: CodeMirror reparses a skipped region from its idle worker (>= 100 ms later); the
 * driver does it at once (`forceParsing`) after a viewport change, so a jump is decorated in the
 * same or the next frame. `viewHint` passes the real viewport to the wrapper, because
 * `ensureSyntaxTree` sets the context viewport to {0, upto} while it parses.
 */
import { ParseContext, forceParsing, syntaxTreeAvailable } from '@codemirror/language';
import { StateField, type Text } from '@codemirror/state';
import { type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { type Input, type PartialParse, Parser, Tree, TreeFragment } from '@lezer/common';

import { BoundaryIndex } from './boundaries';

export const windowConfig = {
  /** Documents shorter than this are parsed whole (large.md, 1 MB: typing p95 < 4 ms already). */
  minLength: 2_000_000,
  /** Text parsed before and after the viewport, so small scrolls do not reparse. */
  margin: 20_000,
  /** Cap of the viewport span used for the window (ensureSyntaxTree/forceParsing pass {0, upto}). */
  maxSpan: 60_000,
  /**
   * Larger windows (no safe boundary near the viewport, e.g. one long list) fall back to the
   * plain incremental parse, which CodeMirror runs in time slices (today's behaviour).
   */
  maxWindow: 1_000_000,
};

/** Counters for tests and perf reports. `lastFallback`: the last parse of a big document used the plain parser. */
export const windowStats = { parses: 0, lastFrom: 0, lastTo: 0, lastMs: 0, maxMs: 0, full: 0, fallbacks: 0, lastFallback: false };

export const boundaryField = StateField.define<BoundaryIndex>({
  create: (state) => BoundaryIndex.create(state.doc),
  update: (value, tr) => (tr.docChanged ? value.map(tr.changes, tr.state.doc) : value),
});

/** Parsed range of each window tree, in tree coordinates; the rest of the tree is empty, not parsed. */
const parsedRange = new WeakMap<Tree, { from: number; to: number }>();

/**
 * `fragments` without the unparsed parts of window trees. CodeMirror keeps a window tree as one
 * fragment of the full length; Lezer's block reuse would take the empty part as parsed (it takes
 * the next block after a gap), and the text there would get no nodes.
 */
export function parsedFragments(fragments: readonly TreeFragment[]): readonly TreeFragment[] {
  let out: TreeFragment[] | null = null;
  fragments.forEach((f, i) => {
    const r = parsedRange.get(f.tree);
    if (!r) {
      out?.push(f);
      return;
    }
    out ??= fragments.slice(0, i);
    const from = Math.max(f.from, r.from - f.offset);
    const to = Math.min(f.to, r.to - f.offset);
    if (to > from) out.push(new TreeFragment(from, to, f.tree, f.offset, f.openStart || from > f.from, f.openEnd || to < f.to));
  });
  return out ?? fragments;
}

/** Real viewport per document version, set by the driver before `forceParsing`. */
const viewHint = new WeakMap<Text, { from: number; to: number }>();

/** CodeMirror's skipped ranges (internal array) — read only to avoid adding the same range twice. */
function skip(cx: ParseContext, from: number, to: number): void {
  if (from >= to) return;
  const skipped = (cx as unknown as { skipped?: { from: number; to: number }[] }).skipped;
  if (skipped?.some((r) => r.from <= from && r.to >= to)) return;
  cx.skipUntilInView(from, to);
}

/**
 * Parse range of a window [from, to) where `to` is a boundary: it stops at the end of the blank
 * line before `to` (not after its line break), else a fence or HTML block left open by a closing
 * container would take one more (empty) line than in the full parse.
 */
export function parseRange(from: number, to: number, len: number): { from: number; to: number } {
  return { from, to: to < len && to - 1 > from ? to - 1 : to };
}

class WindowParse implements PartialParse {
  parsedPos = 0;
  stoppedAt: number | null = null;
  constructor(
    private readonly inner: Parser,
    private readonly input: Input,
    private readonly fragments: readonly TreeFragment[],
    private readonly cx: ParseContext,
    private readonly from: number,
    private readonly to: number,
  ) {}

  advance(): Tree {
    const t0 = performance.now();
    const { cx, input, from, to } = this;
    const len = input.length;
    const range = parseRange(from, to, len);
    const tree = this.inner.parse(input, this.fragments, [range]);
    let out: Tree;
    if (from === 0 && to >= len) {
      out = tree;
      windowStats.full++;
    } else {
      out = new Tree(
        tree.type,
        tree.children,
        tree.positions.map((p) => p + from),
        len,
      );
      parsedRange.set(out, range);
    }
    skip(cx, 0, from);
    skip(cx, range.to, len);
    this.parsedPos = len;
    const ms = performance.now() - t0;
    windowStats.parses++;
    windowStats.lastFallback = false;
    windowStats.lastFrom = from;
    windowStats.lastTo = range.to;
    windowStats.lastMs = ms;
    windowStats.maxMs = Math.max(windowStats.maxMs, ms);
    return out;
  }

  stopAt(): void {
    // Always one step to a full-length tree: stoppedAt stays null, so CodeMirror's treeLen = doc length.
  }
}

export class WindowedParser extends Parser {
  constructor(readonly inner: Parser) {
    super();
  }

  createParse(input: Input, fragments: readonly TreeFragment[], ranges: readonly { from: number; to: number }[]): PartialParse {
    fragments = parsedFragments(fragments);
    const cx = ParseContext.get();
    const whole = ranges.length === 1 && ranges[0]?.from === 0 && ranges[0].to === input.length;
    if (!cx || !whole || input.length < windowConfig.minLength || !cx.state.field(boundaryField, false)) {
      return this.inner.createParse(input, fragments, ranges);
    }
    const len = input.length;
    const idx = cx.state.field(boundaryField);
    const hint = viewHint.get(cx.state.doc);
    let { from: vFrom, to: vTo } = hint ?? cx.viewport;
    vTo = Math.min(vTo, len);
    vFrom = Math.max(vFrom, vTo - windowConfig.maxSpan, 0);
    const from = idx.before(Math.max(0, vFrom - windowConfig.margin));
    const to = idx.after(Math.max(from + 1, Math.min(len, vTo + windowConfig.margin)));
    if (to - from > windowConfig.maxWindow) {
      windowStats.fallbacks++;
      windowStats.lastFallback = true;
      return this.inner.createParse(input, fragments, ranges);
    }
    return new WindowParse(this.inner, input, fragments, cx, from, to);
  }
}

/**
 * After a viewport change: parse the new viewport now when CodeMirror marked it as skipped.
 * In idle time: extend the boundary index to the document end (a jump then only parses).
 */
export const windowDriver = ViewPlugin.fromClass(
  class {
    private idle = -1;
    constructor(readonly view: EditorView) {
      this.prefetch();
    }
    destroy(): void {
      if (this.idle >= 0) cancelIdleCallback(this.idle);
    }
    prefetch(): void {
      if (this.idle >= 0 || this.view.state.doc.length < windowConfig.minLength) return;
      if (this.view.state.field(boundaryField).done) return;
      this.idle = requestIdleCallback((deadline) => {
        this.idle = -1;
        this.view.state.field(boundaryField).scanFor(Math.max(2, Math.min(10, deadline.timeRemaining() - 1)));
        this.prefetch();
      });
    }
    update(u: ViewUpdate): void {
      if (u.docChanged) this.prefetch();
      if (!u.viewportChanged || u.state.doc.length < windowConfig.minLength) return;
      const view = u.view;
      // No dispatch during an update.
      queueMicrotask(() => {
        const { viewport, state } = view;
        if (syntaxTreeAvailable(state, viewport.to)) return;
        viewHint.set(state.doc, viewport);
        try {
          forceParsing(view, viewport.to, 50);
        } finally {
          viewHint.delete(state.doc);
        }
      });
    }
  },
);
