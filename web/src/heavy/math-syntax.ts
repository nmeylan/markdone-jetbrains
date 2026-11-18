/*
 * TeX math as a @lezer/markdown extension.
 *
 * Inline `$…$` (Pandoc rules: the opener is followed by a non-space, the closer is preceded by a
 * non-space and not followed by a digit, so "$5 and $10" is text) and inline `$$…$$` (display
 * style in a paragraph). `\$` is a Markdown escape (the Escape parser consumes it first), and a
 * backslash inside the formula skips the next character, so `$a\$b$` is one formula. `$` inside
 * a code span is never seen (the code span is parsed first, left to right).
 *
 * Block `$$` … `$$`: a line that starts with `$$` (indent < 4); it ends at a line that ends with
 * `$$`, or (like a fenced code block) at the end of its container. One-line form `$$ x $$`.
 * It interrupts a paragraph (like a fence). A `$$` block can span blank lines: the windowed parse
 * boundary scanner (src/windowed/boundaries.ts) treats it like a fence.
 *
 * Nodes: InlineMath, BlockMath (children: MathMark, 2 when closed).
 */
import type { BlockContext, Element, InlineContext, Line, MarkdownConfig } from '@lezer/markdown';

const DOLLAR = 36;
const BACKSLASH = 92;
const isSpace = (c: number): boolean => c === 32 || c === 9 || c === 10 || c === 13;
const isDigit = (c: number): boolean => c >= 48 && c <= 57;

/** Closer of width `open` at `i`: `$$`, or `$` after a non-space and not before a digit. */
function closesAt(cx: InlineContext, i: number, open: number): boolean {
  if (cx.char(i) !== DOLLAR) return false;
  if (open === 2) return cx.char(i + 1) === DOLLAR;
  return !isSpace(cx.char(i - 1)) && !isDigit(cx.char(i + 1));
}

/** First closer of width `open` at or after `from` (a backslash skips the next character), or -1. */
function scanCloser(cx: InlineContext, from: number, open: number): number {
  for (let i = from; i < cx.end; i++) {
    if (cx.char(i) === BACKSLASH) i++;
    else if (closesAt(cx, i, open)) return i;
  }
  return -1;
}

/*
 * Last scan per paragraph and opener width: the first closer at or after `from` is `at` (-1: none).
 * The closer test does not depend on the opener, and every scan starts right after a `$` (never on
 * a character skipped by a backslash), so all scans see the same positions: a later opener before
 * `at` gets the same closer. Openers come left to right, so each character is scanned once per
 * width (linear; "$5 $5 $5 …" was quadratic).
 */
const lastScan = new WeakMap<InlineContext, ({ from: number; at: number } | undefined)[]>();

function closer(cx: InlineContext, from: number, open: number): number {
  let memo = lastScan.get(cx);
  if (!memo) lastScan.set(cx, (memo = []));
  const hit = memo[open];
  if (hit && hit.from <= from && (hit.at < 0 || from <= hit.at)) return hit.at;
  const at = scanCloser(cx, from, open);
  memo[open] = { from, at };
  return at;
}

function parseInlineMath(cx: InlineContext, next: number, pos: number): number {
  if (next !== DOLLAR || cx.char(pos - 1) === DOLLAR) return -1;
  const open = cx.char(pos + 1) === DOLLAR ? 2 : 1;
  const start = pos + open;
  const first = cx.char(start);
  if (first < 0 || isSpace(first) || first === DOLLAR) return -1;
  const i = closer(cx, start, open);
  if (i < 0) return -1;
  const end = i + open;
  return cx.addElement(cx.elt('InlineMath', pos, end, [cx.elt('MathMark', pos, start), cx.elt('MathMark', i, end)]));
}

function isOpen(line: Line): boolean {
  return line.indent - line.baseIndent < 4 && line.next === DOLLAR && line.text.charCodeAt(line.pos + 1) === DOLLAR;
}

function parseBlockMath(cx: BlockContext, line: Line): boolean {
  if (!isOpen(line)) return false;
  const from = cx.lineStart + line.pos;
  const marks: Element[] = [cx.elt('MathMark', from, from + 2)];
  // One-line form: `$$ … $$` (at least one character between the marks).
  const firstRest = line.text.slice(line.pos + 2).trimEnd();
  if (firstRest.length >= 3 && firstRest.endsWith('$$') && firstRest.trim() !== '$$') {
    const closeAt = cx.lineStart + line.pos + 2 + firstRest.length - 2;
    marks.push(cx.elt('MathMark', closeAt, closeAt + 2));
    cx.nextLine();
    cx.addElement(cx.elt('BlockMath', from, closeAt + 2, marks));
    return true;
  }
  // Line.depth is internal in @lezer/markdown 1.8.1 (FencedCode uses it the same way).
  while (cx.nextLine() && (line as unknown as { depth: number }).depth >= cx.depth) {
    for (const m of line.markers) marks.push(m);
    const text = line.text.trimEnd();
    if (text.endsWith('$$') && text.length - 2 >= line.pos) {
      const closeAt = cx.lineStart + text.length - 2;
      marks.push(cx.elt('MathMark', closeAt, closeAt + 2));
      const end = cx.lineStart + text.length;
      cx.nextLine();
      cx.addElement(cx.elt('BlockMath', from, end, marks));
      return true;
    }
  }
  cx.addElement(cx.elt('BlockMath', from, cx.prevLineEnd(), marks));
  return true;
}

export const MathSyntax: MarkdownConfig = {
  defineNodes: [{ name: 'BlockMath', block: true }, 'InlineMath', 'MathMark'],
  parseBlock: [
    {
      name: 'BlockMath',
      before: 'FencedCode',
      parse: parseBlockMath,
      endLeaf: (_cx, line) => isOpen(line),
    },
  ],
  parseInline: [{ name: 'InlineMath', parse: parseInlineMath, before: 'Emphasis' }],
};
