/*
 * Safe block boundaries for the windowed parse.
 *
 * A boundary is the start of a line L where a Lezer parse that starts at L gives the same
 * top-level blocks after L as a parse from the document start. Rules (all must hold):
 *  - the line before L is blank (`/^[ \t]*$/`; `\r` is not blank: Lezer's HTML type 6/7 end test
 *    does not accept it), or L is line 1;
 *  - L starts in column 0 (first char not space, tab or `\r`);
 *  - L does not start with `>` and is not a list item (`-+*` + space/EOL, or 1-9 digits + `.`/`)`
 *    + space/EOL): such a line can continue a block quote or a list that is open before;
 *  - L is not inside a fenced code block, a `$$` math block (language.ts MathSyntax), an HTML
 *    block of type 1-5 (they can span blank lines) or the front matter. Fences, math blocks and
 *    HTML blocks that are opened inside a container (after `>` or a list marker, or indented
 *    while a list may be open) end at the first non-blank line that starts in column 0 without
 *    `>` (they never continue lazily).
 *
 * Why this is enough: after a blank line, a paragraph, table, setext candidate, HTML block of
 * type 6/7, footnote definition and indented code are closed or cannot reach a column-0 line;
 * a list item or block quote cannot continue on a column-0 line that is not `>` or a list
 * marker. So the only state that crosses L is a fence, a math block, an HTML block 1-5 or the
 * front matter.
 *
 * The index is lazy: it scans only as far as a query needs, and after an edit it rescans from
 * the last boundary before the edit until it meets an old boundary again (resync).
 */
import type { ChangeSet, Text } from '@codemirror/state';

const EMPTY_LINE = /^[ \t]*$/;

/**
 * Lezer @lezer/markdown 1.8.1 HTML block types 1-7 (start test on the line content, end test on
 * the whole line). Types 6 and 7 end at a blank line; they matter because their lines hide fence
 * openers. Type 7 cannot interrupt a paragraph.
 */
const HTML_BLOCKS: [RegExp, RegExp][] = [
  [/^<(?:script|pre|style|textarea)(?:\s|>|$)/i, /<\/(?:script|pre|style|textarea)>/i],
  [/^<!--/, /-->/],
  [/^<\?/, /\?>/],
  [/^<![A-Z]/, />/],
  [/^<!\[CDATA\[/, /\]\]>/],
  [/^<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>|$)/i, EMPTY_LINE],
  [/^(?:<\/[a-z][\w-]*\s*>|<[a-z][\w-]*(\s+[a-z:_][\w-.]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*>)\s*$/i, EMPTY_LINE],
];

const FM_OPEN = /^---[ \t]*$/;
const FM_CLOSE = /^(?:---|\.\.\.)[ \t]*$/;

/** Where a fence or HTML block 1-5 was opened: top level, in a list item (content column), in a quote. */
interface Block {
  kind: 'top' | 'list' | 'quote';
  /** Content column of the list item (kind 'list'). */
  col: number;
}

/** A fenced code block (`ch` = backtick or tilde) or a `$$` math block (`ch` = DOLLAR, `len` 2). */
interface Fence extends Block {
  ch: number;
  len: number;
}

const DOLLAR = 36;

interface Html extends Block {
  end: RegExp;
}

/** Scanner state before a line. */
export interface ScanState {
  fence: Fence | null;
  html: Html | null;
  /** Content columns of the list items that may be open, outermost first. */
  lists: number[];
  /** Same length as `lists`: the item is in an ordered list. */
  ordered: boolean[];
  /** A block quote may be open. */
  quote: boolean;
  /** The previous line was paragraph text (the next line may be a lazy continuation). */
  para: boolean;
  /** The current paragraph (Lezer leaf) started with a `|`: Lezer's table interrupt test is off for it. */
  leafPipe: boolean;
  /** Lezer LinkReferenceParser of the current leaf (leaf starts with `[`). */
  ref: Ref | null;
  prevBlank: boolean;
}

export const cleanState = (): ScanState => ({ fence: null, html: null, lists: [], ordered: [], quote: false, para: false, leafPipe: false, ref: null, prevBlank: true });

export function copyState(s: ScanState): ScanState {
  return { ...s, lists: s.lists.slice(), ordered: s.ordered.slice(), ref: s.ref ? { ...s.ref } : null };
}

function isBlank(text: string, from = 0): boolean {
  for (let i = from; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** End of a list marker at `i` (before the following space), or -1. */
function listMarkerEnd(text: string, i: number): number {
  const c = text.charCodeAt(i);
  if (c === 45 || c === 43 || c === 42) {
    const n = text.charCodeAt(i + 1);
    return i + 1 === text.length || n === 32 || n === 9 ? i + 1 : -1;
  }
  let j = i;
  while (j < text.length && j - i < 10 && text.charCodeAt(j) >= 48 && text.charCodeAt(j) <= 57) j++;
  if (j === i || j - i > 9) return -1;
  const d = text.charCodeAt(j);
  if (d !== 46 && d !== 41) return -1;
  const n = text.charCodeAt(j + 1);
  return j + 1 === text.length || n === 32 || n === 9 ? j + 1 : -1;
}

/** Leading whitespace of `text` from index `i` at column `col`: [end index, end column]. */
function skipSpace(text: string, i: number, col: number): [number, number] {
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c === 32) col++;
    else if (c === 9) col += 4 - (col % 4);
    else break;
    i++;
  }
  return [i, col];
}

const QUOTE_LINE = /^ {0,3}>/;

/** The container of `b` does not continue on this non-blank line (fences and HTML never continue lazily). */
function containerEnds(b: Block, text: string, indent: number): boolean {
  if (b.kind === 'quote') return !QUOTE_LINE.test(text);
  if (b.kind === 'list') return indent < b.col;
  return false;
}

function isFenceClose(text: string, f: Fence, indent: number, i: number): boolean {
  if (f.kind === 'quote') {
    /*
     * After all quote markers: this can close a fence of a nested quote one line early. No effect on
     * boundaries: a fence opened in a quote ends at the next blank line anyway, and a boundary needs one.
     */
    for (;;) {
      [i] = skipSpace(text, i, 0);
      if (text.charCodeAt(i) === 62) i++;
      else break;
    }
  } else if (f.ch !== DOLLAR && indent - (f.kind === 'list' ? f.col : 0) >= 4) {
    return false;
  }
  if (f.ch === DOLLAR) {
    // heavy/math-syntax.ts: the first line whose text (trimEnd) ends with `$$` after the container markers.
    const t = text.trimEnd();
    return t.endsWith('$$') && t.length - 2 >= i;
  }
  const s = i;
  while (i < text.length && text.charCodeAt(i) === f.ch) i++;
  if (i - s < f.len) return false;
  for (; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

const FOOTNOTE_DEF = /^\[\^[^\]\s]+\]:/;
const SETEXT = /^(?:=+|-+)[ \t]*$/;
const ATX = /^#{1,6}(?:[ \t]|$)/;
const HR = /^([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

function isFenceOpen(text: string, i: number): boolean {
  const c = text.charCodeAt(i);
  if (c !== 96 && c !== 126) return false;
  let j = i;
  while (j < text.length && text.charCodeAt(j) === c) j++;
  return j - i >= 3 && (c === 126 || text.indexOf('`', j) < 0);
}

function isHr(text: string, i: number): boolean {
  const c = text.charCodeAt(i);
  return (c === 45 || c === 42 || c === 95) && HR.test(text.slice(i));
}

function hasPipe(str: string, start: number): boolean {
  if (str.indexOf('|', start) < 0) return false;
  for (let i = start; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c === 124) return true;
    if (c === 92) i++;
  }
  return false;
}

/** Cell count of a table row (Lezer parseRow). */
function rowCount(line: string, start: number): number {
  let count = 0;
  let first = true;
  let cellStart = -1;
  let esc = false;
  for (let i = start; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c === 124 && !esc) {
      if (!first || cellStart > -1) count++;
      first = false;
      cellStart = -1;
    } else if (esc || (c !== 32 && c !== 9)) {
      if (cellStart < 0) cellStart = i;
    }
    esc = !esc && c === 92;
  }
  return cellStart > -1 ? count + 1 : count;
}

const DELIMITER_LINE = /^[>\s]*\|?(\s*:?-+:?\s*\|)+(\s*:?-+:?\s*)?$/;

/** Lezer GFM Table endLeaf: a row line followed by a delimiter line with the same cell count. */
function tableStarts(text: string, i: number, next: string | undefined, st: ScanState): boolean {
  return !st.leafPipe && next !== undefined && hasPipe(text, i) && DELIMITER_LINE.test(next) && rowCount(text, i) === rowCount(next, i);
}

/** The line (content at `i`) starts a block that interrupts a paragraph (so it is not a lazy continuation). */
function interrupts(text: string, i: number, st: ScanState, next: string | undefined): boolean {
  const c = text.charCodeAt(i);
  if (tableStarts(text, i, next, st)) return true;
  if (c === 62) return true;
  if (c === 35) return ATX.test(text.slice(i));
  if (c === 96 || c === 126) return isFenceOpen(text, i);
  // MathSyntax endLeaf: a `$$` line (also the one-line form).
  if (c === DOLLAR) return text.charCodeAt(i + 1) === DOLLAR;
  if (c === 60) {
    const rest = text.slice(i);
    for (let t = 0; t < 6; t++) if ((HTML_BLOCKS[t] as [RegExp, RegExp])[0].test(rest)) return true;
    return false;
  }
  if (isHr(text, i)) return true;
  const m = listMarkerEnd(text, i);
  if (m < 0) return false;
  // Lezer isBulletList/isOrderedList with `breaking`: in a list of the same kind, or (bullet) with
  // content, or (ordered) starting at 1.
  const bullet = c === 45 || c === 43 || c === 42;
  if (st.ordered.some((o) => o !== bullet)) return true;
  const hasContent = text.slice(m).trim().length > 0;
  return bullet ? hasContent : /^0*1[.)]/.test(text.slice(i)) && hasContent;
}

/* ---- Port of @lezer/markdown 1.8.1 LinkReferenceParser (offsets relative to the leaf start) ---- */

interface Ref {
  /** 0 start, 1 label, 2 link, 3 title, -1 failed. */
  stage: number;
  pos: number;
  content: string;
}

const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 13;

function skipWs(text: string, i: number): number {
  while (i < text.length && isSpace(text.charCodeAt(i))) i++;
  return i;
}

function lineEndAt(text: string, pos: number): number {
  for (; pos < text.length; pos++) {
    const c = text.charCodeAt(pos);
    if (c === 10) break;
    if (!isSpace(c)) return -1;
  }
  return pos;
}

/** End offset, false (fail) or null (incomplete). */
function linkLabel(text: string, start: number): number | false | null {
  let requireNonWS = true;
  for (let escaped = false, pos = start + 1, end = Math.min(text.length, pos + 999); pos < end; pos++) {
    const ch = text.charCodeAt(pos);
    if (escaped) escaped = false;
    else if (ch === 93) return requireNonWS ? false : pos + 1;
    else {
      if (requireNonWS && !isSpace(ch)) requireNonWS = false;
      if (ch === 91) return false;
      else if (ch === 92) escaped = true;
    }
  }
  return null;
}

function linkUrl(text: string, start: number): number | false | null {
  const next = text.charCodeAt(start);
  if (next === 60) {
    for (let pos = start + 1, esc = false; pos < text.length; pos++) {
      const ch = text.charCodeAt(pos);
      if (ch === 62 && !esc) return pos + 1;
      if ((ch === 60 && !esc) || ch === 10) return false;
      esc = ch === 92;
    }
    return null;
  }
  let depth = 0;
  let pos = start;
  for (let escaped = false; pos < text.length; pos++) {
    const ch = text.charCodeAt(pos);
    if (isSpace(ch)) break;
    else if (escaped) escaped = false;
    else if (ch === 40) depth++;
    else if (ch === 41) {
      if (!depth) break;
      depth--;
    } else if (ch === 92) escaped = true;
  }
  return pos > start ? pos : pos === text.length ? null : false;
}

function linkTitle(text: string, start: number): number | false | null {
  const next = text.charCodeAt(start);
  if (next !== 39 && next !== 34 && next !== 40) return false;
  const end = next === 40 ? 41 : next;
  for (let pos = start + 1, escaped = false; pos < text.length; pos++) {
    const ch = text.charCodeAt(pos);
    if (escaped) escaped = false;
    else if (ch === end) return pos + 1;
    else if (ch === 92) escaped = true;
  }
  return null;
}

function refNextStage(r: Ref, end: number | false | null): boolean {
  if (typeof end === 'number') {
    r.pos = end;
    r.stage++;
    return true;
  }
  if (end === false) r.stage = -1;
  return false;
}

/** LinkReferenceParser.advance: end of the reference (> -1) or -1. */
function refAdvance(r: Ref, content: string): number {
  for (;;) {
    if (r.stage === -1) return -1;
    if (r.stage === 0) {
      if (!refNextStage(r, linkLabel(content, r.pos))) return -1;
      if (content.charCodeAt(r.pos) !== 58) return (r.stage = -1);
      r.pos++;
    } else if (r.stage === 1) {
      if (!refNextStage(r, linkUrl(content, skipWs(content, r.pos)))) return -1;
    } else if (r.stage === 2) {
      const skip = skipWs(content, r.pos);
      let end = 0;
      if (skip > r.pos) {
        const title = linkTitle(content, skip);
        if (title) {
          const titleEnd = lineEndAt(content, title);
          if (titleEnd > 0) {
            refNextStage(r, title);
            end = titleEnd;
          }
        }
      }
      if (!end) end = lineEndAt(content, r.pos);
      return end > 0 && end < content.length ? end : -1;
    } else {
      return lineEndAt(content, r.pos);
    }
  }
}

/**
 * A line that continues the current leaf (paragraph). Returns 'restart' when Lezer's link
 * reference completes before this line (the line then starts a new block).
 */
function continueLeaf(st: ScanState, content: string, setextOk: boolean): 'continue' | 'restart' {
  if (st.ref) {
    const all = `${st.ref.content}\n${content}`;
    const finish = refAdvance(st.ref, all);
    if (finish > -1 && finish < all.length) {
      st.ref = null;
      st.para = false;
      return 'restart';
    }
    st.ref.content = all;
    if (st.ref.stage === -1) st.ref = null;
  }
  // Lezer SetextHeadingParser: an underline in the same containers ends the leaf.
  const f = skipWs(content, 0);
  const fc = content.charCodeAt(f);
  if (setextOk && (fc === 61 || fc === 45) && SETEXT.test(content.slice(f))) {
    st.para = false;
    st.ref = null;
  }
  return 'continue';
}

function popLists(st: ScanState, col: number): void {
  while (st.lists.length && (st.lists[st.lists.length - 1] as number) > col) {
    st.lists.pop();
    st.ordered.pop();
  }
}

/**
 * Processes one line; returns true when the line start is a boundary. `st` is updated in place.
 */
export function scanLine(text: string, st: ScanState, next?: string): boolean {
  const blank = isBlank(text);
  const [i0, indent] = skipSpace(text, 0, 0);
  if (st.fence) {
    // A blank line ends a block quote (no `>`), so also a fence in it.
    if (blank ? st.fence.kind === 'quote' : containerEnds(st.fence, text, indent)) {
      st.fence = null;
    } else {
      if (!blank && isFenceClose(text, st.fence, indent, i0)) st.fence = null;
      st.prevBlank = blank;
      st.para = false;
      return false;
    }
  }
  if (st.html) {
    if (blank ? st.html.kind === 'quote' : containerEnds(st.html, text, indent)) {
      st.html = null;
    } else {
      if (st.html.end.test(text)) st.html = null;
      st.prevBlank = blank;
      st.para = false;
      return false;
    }
  }
  if (blank) {
    st.prevBlank = true;
    st.para = false;
    st.quote = false;
    return false;
  }
  const c0 = text.charCodeAt(0);
  let boundary = false;
  if (st.prevBlank && indent === 0 && c0 !== 13 && c0 !== 62 && listMarkerEnd(text, 0) < 0) {
    boundary = true;
    st.lists.length = 0;
    st.ordered.length = 0;
    st.quote = false;
  }
  // A line that is not a lazy paragraph continuation closes the list items it is not indented for.
  const wasPara = st.para;
  // Lezer tests paragraph interrupts only below 4 columns past the matched list items (baseIndent).
  let base = 0;
  for (const c of st.lists) if (c <= indent) base = c;
  const lazy = wasPara && (indent - base >= 4 || !interrupts(text, i0, st, next));
  if (lazy) {
    // Paragraph continuation (lazy or in the same containers): no container marker, no block start.
    const sameContainers = !st.quote && (!st.lists.length || indent >= (st.lists[st.lists.length - 1] as number));
    st.prevBlank = false;
    if (continueLeaf(st, text, sameContainers && indent - base < 4) === 'restart') return scanLine(text, st, next);
    return boundary;
  }
  popLists(st, indent);
  // Container prefixes: `>` and list markers (each after at most 3 columns of space).
  let i = i0;
  let col = indent;
  let quote = false;
  let marker = false;
  for (let k = 0; k < 20; k++) {
    if (k > 0) [i, col] = skipSpace(text, i, col);
    // Column 4+ without an open list item: indented code, no container marker.
    if (k === 0 && col > 3 && !st.lists.length) break;
    if (text.charCodeAt(i) === 62) {
      i++;
      col++;
      if (text.charCodeAt(i) === 32) {
        i++;
        col++;
      }
      quote = true;
      continue;
    }
    // A thematic break wins over a list item (`- - -`, `* * *`).
    const m = isHr(text, i) ? -1 : listMarkerEnd(text, i);
    if (m >= 0 && !quote) {
      // List item: content column = after the marker and 1-4 spaces (5+: marker + 1).
      const markerCol = col + (m - i);
      const [j, after] = skipSpace(text, m, markerCol);
      const content = j === text.length || after - markerCol > 4 ? markerCol + 1 : after;
      popLists(st, col);
      st.lists.push(content);
      st.ordered.push(!(text.charCodeAt(i) === 45 || text.charCodeAt(i) === 43 || text.charCodeAt(i) === 42));
      marker = true;
      i = j === text.length || after - markerCol > 4 ? m + 1 : j;
      col = content;
      continue;
    }
    break;
  }
  const prevQuote = st.quote;
  if (quote) st.quote = true;
  if (wasPara && quote && !marker && prevQuote && !isBlank(text, i) && !interrupts(text, i, st, next)) {
    // `> more` continues the quote's paragraph.
    st.prevBlank = false;
    if (continueLeaf(st, text.slice(i), true) === 'restart') {
      st.quote = prevQuote;
      return scanLine(text, st, next);
    }
    return boundary;
  }
  const c = text.charCodeAt(i);
  const fenceLike = c === 96 || c === 126;
  const htmlLike = c === 60;
  const heading = c === 35;
  if (!quote) st.quote = false;
  // Which container a block opened here belongs to.
  let block: Block;
  if (quote || (st.quote && QUOTE_LINE.test(text))) block = { kind: 'quote', col: 0 };
  else if (st.lists.length) block = { kind: 'list', col: st.lists[st.lists.length - 1] as number };
  else block = { kind: 'top', col: 0 };
  // Indented code: no fence or HTML start.
  const rel = col - (block.kind === 'list' ? block.col : 0);
  st.prevBlank = false;
  if (!quote && rel >= 4) return boundary; // indented code, or paragraph continuation (st.para unchanged)
  // Paragraph text only when there is content after the container markers; a new Lezer leaf.
  st.para = !isBlank(text, i);
  st.ref = null;
  if (st.para) st.leafPipe = hasPipe(text, i);
  if (fenceLike) {
    let j = i;
    while (j < text.length && text.charCodeAt(j) === c) j++;
    if (j - i >= 3 && (c === 126 || text.indexOf('`', j) < 0)) {
      st.fence = { ...block, ch: c, len: j - i };
      st.para = false;
    }
  } else if (c === DOLLAR && text.charCodeAt(i + 1) === DOLLAR) {
    // heavy/math-syntax.ts: a `$$` line opens a math block, except the one-line form `$$ x $$`.
    const rest = text.slice(i + 2).trimEnd();
    if (!(rest.length >= 3 && rest.endsWith('$$') && rest.trim() !== '$$')) st.fence = { ...block, ch: DOLLAR, len: 2 };
    st.para = false;
  } else if (htmlLike) {
    const rest = text.slice(i);
    for (let t = 0; t < HTML_BLOCKS.length; t++) {
      const [start, end] = HTML_BLOCKS[t] as [RegExp, RegExp];
      if (t === 6 && wasPara) break;
      if (start.test(rest)) {
        if (!end.test(text)) st.html = { ...block, end };
        st.para = false;
        break;
      }
    }
  } else if ((heading && ATX.test(text.slice(i))) || isHr(text, i)) {
    st.para = false;
  } else if (c === 91 && FOOTNOTE_DEF.test(text.slice(i))) {
    // language.ts FootnoteDefinition: a block parser (runs before leaves; not a paragraph).
    st.para = false;
  } else if (c === 91 && st.para) {
    // Lezer LinkReferenceParser: its constructor advances over the first line (result unused).
    st.ref = { stage: 0, pos: 0, content: text.slice(i) };
    refAdvance(st.ref, st.ref.content);
    if (st.ref.stage === -1) st.ref = null;
  }
  return boundary;
}

/** Start of the line after the front matter, or 0 (same rule as language.ts FrontMatter). */
export function frontMatterEnd(doc: Text): number {
  if (doc.lines < 2 || !FM_OPEN.test(doc.line(1).text)) return 0;
  let n = 2;
  for (const it = doc.iterLines(2); !it.next().done; n++) {
    if (FM_CLOSE.test(it.value)) return n < doc.lines ? doc.line(n + 1).from : doc.length;
  }
  return 0;
}

/** First index with a[i] >= x. */
function lowerBound(a: number[], x: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((a[mid] as number) < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** A scanner state snapshot every CHECKPOINT_EVERY characters: an edit rescans from there, not from the last boundary. */
const CHECKPOINT_EVERY = 32_768;

function sameState(a: ScanState, b: ScanState): boolean {
  const f = (x: Fence | null, y: Fence | null) => x === y || (!!x && !!y && x.kind === y.kind && x.col === y.col && x.ch === y.ch && x.len === y.len);
  const h = (x: Html | null, y: Html | null) => x === y || (!!x && !!y && x.kind === y.kind && x.col === y.col && x.end === y.end);
  const r = (x: Ref | null, y: Ref | null) => x === y || (!!x && !!y && x.stage === y.stage && x.pos === y.pos && x.content === y.content);
  return (
    f(a.fence, b.fence) &&
    h(a.html, b.html) &&
    a.quote === b.quote &&
    a.para === b.para &&
    a.prevBlank === b.prevBlank &&
    (!a.para || (a.leafPipe === b.leafPipe && r(a.ref, b.ref))) &&
    a.lists.length === b.lists.length &&
    a.lists.every((x, i) => x === b.lists[i] && a.ordered[i] === b.ordered[i])
  );
}

/** Result of an earlier scan after an edit (new coordinates): reused when the new scan meets it in the same state. */
interface Tail {
  bounds: number[];
  cps: number[];
  cpStates: ScanState[];
  scannedTo: number;
  state: ScanState | null;
}

/**
 * Lazy boundary index of one document version. Queries may extend the scan (mutation of a cache
 * that only depends on `doc`); edits produce a new index through `map`.
 */
export class BoundaryIndex {
  /** Boundaries found, sorted; all < scannedTo. */
  private bounds: number[] = [];
  /** Checkpoints: line starts and the scanner state before them. */
  private cps: number[] = [];
  private cpStates: ScanState[] = [];
  /** Start of the next line to scan; > doc.length when done. */
  private scannedTo = 0;
  private state: ScanState = cleanState();
  private tail: Tail | null = null;
  /** Resync only at a position > syncAfter (end of the edited text). */
  private syncAfter = -1;
  /** End of the front matter (0: none). */
  private fmEnd = 0;

  private constructor(readonly doc: Text) {}

  static create(doc: Text): BoundaryIndex {
    const out = new BoundaryIndex(doc);
    const fm = frontMatterEnd(doc);
    if (fm > 0) {
      out.state.prevBlank = false;
      out.bounds.push(0);
    }
    out.scannedTo = fm;
    out.fmEnd = fm;
    return out;
  }

  get done(): boolean {
    return this.scannedTo > this.doc.length;
  }

  private lastTailPos(): number {
    const t = this.tail;
    if (!t) return -1;
    return Math.max(t.bounds[t.bounds.length - 1] ?? -1, t.cps[t.cps.length - 1] ?? -1);
  }

  /** Takes over the old scan from `pos` (same state at the same text). */
  private resync(pos: number, state: ScanState | null): void {
    const t = this.tail as Tail;
    for (const b of t.bounds) if (b >= pos) this.bounds.push(b);
    t.cps.forEach((c, i) => {
      if (c > pos) {
        this.cps.push(c);
        this.cpStates.push(t.cpStates[i] as ScanState);
      }
    });
    this.scannedTo = t.scannedTo;
    this.state = t.state ? copyState(t.state) : (state ?? cleanState());
    this.tail = null;
  }

  /** Scans until `stop()` says so or the document ends. */
  private scan(stop: () => boolean): void {
    while (!this.done && !stop()) {
      if (this.scanRun(stop)) return;
    }
  }

  /** One run of the line iterator; returns true when stopped or done, false to restart (after a resync). */
  private scanRun(stop: () => boolean): boolean {
    const { doc } = this;
    let pos = this.scannedTo;
    const it = doc.iterLines(doc.lineAt(pos).number);
    const read = (): string | undefined => (it.next().done ? undefined : it.value);
    let ahead = read();
    let nextCp = (this.cps[this.cps.length - 1] ?? 0) + CHECKPOINT_EVERY;
    while (!stop()) {
      if (ahead === undefined) {
        this.scannedTo = doc.length + 1;
        return true;
      }
      if (this.tail && pos > this.syncAfter) {
        const k = lowerBound(this.tail.cps, pos);
        if (this.tail.cps[k] === pos && sameState(this.state, this.tail.cpStates[k] as ScanState)) {
          this.cps.push(pos);
          this.cpStates.push(copyState(this.state));
          this.resync(pos, null);
          return false;
        }
      }
      if (pos >= nextCp) {
        this.cps.push(pos);
        this.cpStates.push(copyState(this.state));
        nextCp = pos + CHECKPOINT_EVERY;
      }
      const text = ahead;
      ahead = read();
      if (scanLine(text, this.state, ahead)) {
        if (this.tail && pos > this.syncAfter && this.tail.bounds[lowerBound(this.tail.bounds, pos)] === pos) {
          // Boundary in both scans: same clean state at the same text.
          this.resync(pos, null);
          return false;
        }
        this.bounds.push(pos);
      }
      pos += text.length + 1;
      this.scannedTo = pos;
      if (this.tail && pos > this.lastTailPos()) this.tail = null;
    }
    return true;
  }

  /** Last boundary <= pos (0 when none). */
  before(pos: number): number {
    this.scan(() => this.scannedTo > pos);
    const k = lowerBound(this.bounds, pos + 1) - 1;
    return k >= 0 ? (this.bounds[k] as number) : 0;
  }

  /** First boundary >= pos, or doc.length. */
  after(pos: number): number {
    const last = () => (this.bounds.length ? (this.bounds[this.bounds.length - 1] as number) : -1);
    this.scan(() => last() >= pos);
    const k = lowerBound(this.bounds, pos);
    return k < this.bounds.length ? (this.bounds[k] as number) : this.doc.length;
  }

  /** Scans for at most `ms` (idle prefetch, so a jump does not pay the scan). */
  scanFor(ms: number): void {
    const end = performance.now() + ms;
    let n = 0;
    // Check the clock every 256 lines.
    this.scan(() => (++n & 255) === 0 && performance.now() > end);
  }

  /** All boundaries (scans the whole document; tests). */
  all(): number[] {
    this.scan(() => false);
    return this.bounds.slice();
  }

  map(changes: ChangeSet, doc: Text): BoundaryIndex {
    let firstA = -1;
    let lastB = -1;
    changes.iterChangedRanges((fromA, _toA, _fromB, toB) => {
      if (firstA < 0) firstA = fromA;
      lastB = toB;
    });
    const out = new BoundaryIndex(doc);
    out.fmEnd = this.fmEnd;
    const mapTail = (t: Tail | null): Tail | null =>
      t && {
        bounds: t.bounds.map((p) => changes.mapPos(p, 1)),
        cps: t.cps.map((p) => changes.mapPos(p, 1)),
        cpStates: t.cpStates,
        scannedTo: t.scannedTo > changes.length ? doc.length + 1 : changes.mapPos(t.scannedTo, 1),
        state: t.state,
      };
    if (firstA < 0) return this;
    if (!this.done && firstA > this.doc.lineAt(this.scannedTo).to) {
      // Edit after the scanned part and its lookahead line: the scanned prefix stays.
      out.bounds = this.bounds.slice();
      out.cps = this.cps.slice();
      out.cpStates = this.cpStates.slice();
      out.scannedTo = this.scannedTo;
      out.state = copyState(this.state);
      out.tail = mapTail(this.tail);
      out.syncAfter = Math.max(lastB, this.syncAfter < 0 ? -1 : changes.mapPos(this.syncAfter, 1));
      return out;
    }
    // Restart point: the last boundary before the edit (clean state), or a later checkpoint whose
    // line (the lookahead of the state) ends before the edit.
    const kb = lowerBound(this.bounds, firstA) - 1;
    const b = kb >= 0 ? (this.bounds[kb] as number) : -1;
    let kc = lowerBound(this.cps, firstA) - 1;
    while (kc >= 0 && this.doc.lineAt(this.cps[kc] as number).to >= firstA) kc--;
    const c = kc >= 0 ? (this.cps[kc] as number) : -1;
    const restart = Math.max(b, c);
    // Old results after the edit, for resync (a tail still pending from an earlier edit is dropped).
    const tail: Tail = { bounds: [], cps: [], cpStates: [], scannedTo: this.done ? doc.length + 1 : changes.mapPos(this.scannedTo, 1), state: this.done ? null : copyState(this.state) };
    for (const p of this.bounds) {
      if (p < firstA) continue;
      const m = changes.mapPos(p, 1);
      if (m > lastB) tail.bounds.push(m);
    }
    this.cps.forEach((p, i) => {
      if (p < firstA) return;
      const m = changes.mapPos(p, 1);
      if (m > lastB) {
        tail.cps.push(m);
        tail.cpStates.push(this.cpStates[i] as ScanState);
      }
    });
    // Restart at 0, or an edit that can open/close/move the front matter: start over (front matter rule).
    if (restart <= 0 || (FM_OPEN.test(doc.line(1).text) && (this.fmEnd === 0 || firstA < this.fmEnd))) {
      const fresh = BoundaryIndex.create(doc);
      fresh.tail = tail;
      fresh.syncAfter = lastB;
      return fresh;
    }
    out.bounds = this.bounds.filter((p) => p < restart);
    const keepCps = lowerBound(this.cps, restart);
    out.cps = this.cps.slice(0, keepCps);
    out.cpStates = this.cpStates.slice(0, keepCps);
    out.scannedTo = restart;
    out.state = restart === c ? copyState(this.cpStates[kc] as ScanState) : cleanState();
    out.tail = tail;
    out.syncAfter = lastB;
    return out;
  }
}
