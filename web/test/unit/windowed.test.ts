/*
 * L1 windowed parse: the boundary scanner and the window parse give the same
 * nodes as a full Lezer parse (corpus, huge.md, CodeMirror edits/scrolls/jumps, fuzz), and a
 * document without a safe boundary near the viewport falls back to the normal parser.
 * RESULTS_FILE=<path> writes the counts as JSON; FUZZ_DOCS / FUZZ_SEED change the fuzz run.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Language, type ParseContext, ensureSyntaxTree, syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { EditorState, type StateField, Text } from '@codemirror/state';
import type { Tree } from '@lezer/common';
import { describe, expect, it } from 'vitest';

import { markdownLanguage, markdownParser } from '../../src/language';
import { BoundaryIndex } from '../../src/windowed/boundaries';
import { boundaryField, parseRange, windowConfig, windowStats } from '../../src/windowed/windowed-parser';

const CORPUS = fileURLToPath(new URL('../../../src/test/resources/corpus/', import.meta.url));
const RESULTS = process.env['RESULTS_FILE'];
const results: Record<string, unknown> = RESULTS && existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, 'utf8')) : {};
const save = () => RESULTS && writeFileSync(RESULTS, `${JSON.stringify(results, null, 2)}\n`);

function files(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(join(CORPUS, dir)).sort()) {
      const rel = dir ? `${dir}/${name}` : name;
      if (statSync(join(CORPUS, rel)).isDirectory()) walk(rel);
      else if (name.endsWith('.md') && rel !== 'huge.md') out.push(rel);
    }
  };
  walk('');
  return out;
}

function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const docOf = (text: string) => Text.of(text.split('\n'));

/** All nodes except Document fully inside [from, to), as `Name@from-to`, in tree order; tree offset `off`. */
function nodes(tree: Tree, off: number, from: number, to: number): string[] {
  const out: string[] = [];
  tree.iterate({
    from: Math.max(0, from - off),
    to: to - off,
    enter: (n) => {
      if (n.name === 'Document') return;
      const a = n.from + off;
      const b = n.to + off;
      if (a >= from && b <= to) out.push(`${n.name}@${a}-${b}`);
    },
  });
  return out;
}

/** Top-level nodes of `tree` that cross `pos` (from < pos < to). */
function crossing(tree: Tree, pos: number): string[] {
  const out: string[] = [];
  const c = tree.topNode.childBefore(pos + 1);
  if (c && c.from < pos && c.to > pos) out.push(`${c.name}@${c.from}-${c.to}`);
  return out;
}

/** Compares a window parse [from, to) with the full tree. Returns a mismatch description or null. */
function check(text: string, full: Tree, from: number, to: number): string | null {
  const cross = [...crossing(full, from), ...(to < text.length ? crossing(full, to) : [])];
  if (cross.length) return `window ${from}-${to}: full-parse block crosses the edge: ${cross.join(', ')}`;
  const win = markdownParser.parse(text, undefined, [parseRange(from, to, text.length)]);
  const a = nodes(full, 0, from, to);
  const b = nodes(win, from, from, to);
  if (a.length !== b.length || a.some((x, i) => x !== b[i])) {
    const i = a.findIndex((x, k) => x !== b[k]);
    return `window ${from}-${to}: first diff at ${i}: full ${a[i]} vs window ${b[i]}`;
  }
  return null;
}

describe('boundary scanner + window parse = full parse', () => {
  it('every corpus file except huge: all consecutive boundary windows and boundary-to-end', () => {
    const out: Record<string, { boundaries: number; windows: number; mismatches: string[] }> = {};
    for (const rel of files()) {
      const text = readFileSync(join(CORPUS, rel), 'utf8');
      const full = markdownParser.parse(text);
      const b = BoundaryIndex.create(docOf(text)).all();
      const mismatches: string[] = [];
      let windows = 0;
      const exhaustive = text.length < 50_000;
      for (let i = 0; i < b.length; i++) {
        const s = b[i] as number;
        const e = b[i + 1] ?? text.length;
        windows++;
        const m = check(text, full, s, e);
        if (m) mismatches.push(m);
        if (exhaustive) {
          windows++;
          const m2 = check(text, full, s, text.length);
          if (m2) mismatches.push(m2);
        }
      }
      out[rel] = { boundaries: b.length, windows, mismatches };
    }
    results['corpusExhaustive'] = out;
    save();
    const bad = Object.entries(out).filter(([, v]) => v.mismatches.length);
    expect(bad, JSON.stringify(bad, null, 1)).toEqual([]);
  });

  it('edge-case files: expected boundaries are refused', () => {
    const cases: [string, string[]][] = [
      ['windowed/fence-in-list.md', ['# not a heading', '- not a list', 'still in the tilde fence', 'text inside']],
      ['windowed/html-across-boundary.md', ['# not a heading', 'pre text', 'echo', 'x\n', '>\n']],
      ['windowed/front-matter.md', ['# not a heading', 'list:', '- b']],
      // `$$` math blocks span blank lines like fences.
      ['windowed/math-blocks.md', ['# not a heading', '- not a list', 'text inside']],
      ['m4/math-edge.md', ['# not a heading inside', '- not a list item', 'runs to the end', '## not a heading either']],
    ];
    for (const [rel, refused] of cases) {
      const text = readFileSync(join(CORPUS, rel), 'utf8');
      const b = new Set(BoundaryIndex.create(docOf(text)).all());
      for (const r of refused) {
        const at = text.indexOf(r);
        const p = at < 0 ? -1 : text.lastIndexOf('\n', at - 1) + 1;
        expect(p, `${rel}: ${r}`).toBeGreaterThanOrEqual(0);
        expect(b.has(p), `${rel}: boundary at "${r}"`).toBe(false);
      }
    }
  });

  it('huge.md: no boundary inside a top-level block; 300 random viewport windows', () => {
    const path = join(CORPUS, 'huge.md');
    if (!existsSync(path)) return;
    const text = readFileSync(path, 'utf8');
    let t0 = performance.now();
    const full = markdownParser.parse(text);
    const fullMs = performance.now() - t0;
    const doc = docOf(text);
    t0 = performance.now();
    const b = BoundaryIndex.create(doc).all();
    const scanMs = performance.now() - t0;
    // Sweep: top-level children vs boundaries.
    const crossings: string[] = [];
    const cur = full.topNode.firstChild;
    let k = 0;
    for (let n = cur; n; n = n.nextSibling) {
      while (k < b.length && (b[k] as number) <= n.from) k++;
      if (k < b.length && (b[k] as number) < n.to) crossings.push(`${n.name}@${n.from}-${n.to} contains ${b[k]}`);
    }
    const r = rng(42);
    const idx = BoundaryIndex.create(doc);
    const mismatches: string[] = [];
    const sizes: number[] = [];
    for (let i = 0; i < 300; i++) {
      const v = Math.floor(r() * text.length);
      const s = idx.before(Math.max(0, v - 20_000));
      const e = idx.after(Math.min(text.length, v + 10_000 + 20_000));
      sizes.push(e - s);
      const m = check(text, full, s, e);
      if (m) mismatches.push(m);
    }
    sizes.sort((a, z) => a - z);
    results['huge'] = {
      length: text.length,
      boundaries: b.length,
      topLevelBlocks: full.topNode.getChildren('Paragraph').length >= 0 ? countTop(full) : 0,
      fullParseMs: Math.round(fullMs),
      fullScanMs: Math.round(scanMs),
      crossings: crossings.slice(0, 20),
      randomWindows: 300,
      windowSizeMedian: sizes[150],
      windowSizeMax: sizes[299],
      mismatches,
    };
    save();
    expect(crossings).toEqual([]);
    expect(mismatches).toEqual([]);
  }, 120_000);
});

function countTop(tree: Tree): number {
  let n = 0;
  for (let c = tree.topNode.firstChild; c; c = c.nextSibling) n++;
  return n;
}

/** CodeMirror's parse context of `state` (internal `Language.state` field). */
function parseContext(state: EditorState): ParseContext & { treeLen: number; updateViewport(v: { from: number; to: number }): boolean } {
  const field = (Language as unknown as { state: StateField<{ context: ParseContext }> }).state;
  return state.field(field).context as ParseContext & { treeLen: number; updateViewport(v: { from: number; to: number }): boolean };
}

/** Nodes of `tree` inside [0, to) that are not in the full parse at the same place (`Name@from-to`). */
function foreign(tree: Tree, full: Tree, to: number): string[] {
  const want = new Set(nodes(full, 0, 0, to));
  return nodes(tree, 0, 0, to).filter((n) => !want.has(n));
}

describe('CodeMirror integration (windowConfig.minLength = 0)', () => {
  const SNIPPETS = ['```\n', '~~~~\n', '<!--\n', '-->\n', '\n\n', '- ', '> ', '# ', '---\n', 'word ', '<script>\n', '</script>\n', '    ', '1. ', '\n', '| a | b |\n|---|---|\n', '===\n', '$$\n', '$$ x $$\n', 'x $$\n', '$y$ '];

  /*
   * Random edits, scrolls (viewport moves, as the parse worker reports it; a viewport that touches
   * a skipped range is parsed at once, as windowDriver does) and jumps. After each step:
   * - window parse: the nodes in the window equal the full parse;
   * - fallback (no safe boundary in maxWindow): the nodes before the last parsed top-level block
   *   equal the full parse;
   * - every 4th step: no node in the tree that the full parse does not have (fallback: before the
   *   last parsed block).
   */
  function run(name: string, text: string, steps: number, seed: number, config: Partial<typeof windowConfig> = {}) {
    const saved = { ...windowConfig };
    Object.assign(windowConfig, { minLength: 0, margin: 2000, maxSpan: 5000, ...config });
    try {
      const r = rng(seed);
      windowStats.lastFallback = false;
      let state = EditorState.create({ doc: text, extensions: [EditorState.lineSeparator.of('\n'), markdownLanguage] });
      const mismatches: string[] = [];
      let indexMismatches = 0;
      let checks = 0;
      let fallbackSteps = 0;
      for (let i = 0; i < steps; i++) {
        const len = state.doc.length;
        const op = r();
        if (op < 0.4) {
          const pos = Math.floor(r() * len);
          const snippet = SNIPPETS[Math.floor(r() * SNIPPETS.length)] as string;
          state = state.update({ changes: { from: pos, insert: snippet } }).state;
        } else if (op < 0.55) {
          const pos = Math.floor(r() * len);
          state = state.update({ changes: { from: pos, to: Math.min(len, pos + Math.floor(r() * 60)) } }).state;
        } else if (op < 0.8) {
          // Scroll: the viewport moves by up to 1.5 margins; parsed at once only when it touches a skipped range.
          const cx = parseContext(state);
          const from = Math.max(0, Math.min(len, cx.viewport.from + Math.floor((r() - 0.5) * 3 * windowConfig.margin)));
          const to = Math.min(len, from + 3000);
          if (cx.updateViewport({ from, to }) && !syntaxTreeAvailable(state, to)) ensureSyntaxTree(state, to, 1e9);
          state = state.update({}).state;
        } else {
          // Jump: ensureSyntaxTree passes {0, upto} (capped by maxSpan in the wrapper) and restores the viewport.
          ensureSyntaxTree(state, Math.floor(r() * len), 1e9);
          state = state.update({}).state;
        }
        const tree = syntaxTree(state);
        const doc = state.doc.toString();
        const full = markdownParser.parse(doc);
        const fellBack = windowStats.lastFallback;
        // A window parse gives a tree of the full length; a fallback parse may stop early.
        if (!fellBack) expect(tree.length).toBe(state.doc.length);
        let s: number;
        let e: number;
        if (fellBack) {
          fallbackSteps++;
          // Plain incremental parse from 0, maybe stopped (time slice): compare before its last top-level block.
          s = 0;
          const treeLen = Math.min(parseContext(state).treeLen, doc.length);
          e = treeLen < doc.length ? (tree.topNode.childBefore(treeLen)?.from ?? 0) : doc.length;
        } else {
          s = windowStats.lastFrom;
          e = Math.min(windowStats.lastTo, doc.length);
        }
        checks++;
        const a = nodes(full, 0, s, e);
        const b = nodes(tree, 0, s, e);
        const cross = fellBack ? [] : [...crossing(full, s), ...(e < doc.length ? crossing(full, e) : [])];
        // Whole-tree check every 4th step (cost).
        const extra = i % 4 === 0 ? foreign(tree, full, fellBack ? e : doc.length) : [];
        if (cross.length || extra.length || a.length !== b.length || a.some((x, k) => x !== b[k])) {
          const k = a.findIndex((x, j) => x !== b[j]);
          mismatches.push(`step ${i} ${fellBack ? 'fallback' : 'window'} ${s}-${e}: ${cross.join(',')} ${a[k]} vs ${b[k]}; foreign ${extra.slice(0, 3).join(',')}`);
        }
        if (i % 10 === 0) {
          const got = state.field(boundaryField).all();
          const want = BoundaryIndex.create(state.doc).all();
          if (got.length !== want.length || got.some((x, j) => x !== want[j])) indexMismatches++;
        }
      }
      results[`incremental:${name}`] = { steps, checks, fallbackSteps, mismatches: mismatches.slice(0, 10), mismatchCount: mismatches.length, indexMismatches };
      save();
      expect(mismatches).toEqual([]);
      expect(indexMismatches).toBe(0);
      return { fallbackSteps };
    } finally {
      Object.assign(windowConfig, saved);
    }
  }

  it('medium.md: 400 random edits, scrolls and jumps', () => run('medium.md', readFileSync(join(CORPUS, 'medium.md'), 'utf8'), 400, 7), 120_000);

  it('edge-case files concatenated: 400 random edits, scrolls and jumps', () => {
    const text = readdirSync(join(CORPUS, 'windowed'))
      .sort()
      .map((f) => readFileSync(join(CORPUS, 'windowed', f), 'utf8'))
      .join('\n')
      .repeat(20);
    run('edge-cases x20', text, 400, 11);
  }, 120_000);

  it('paragraphs, then a loose list larger than maxWindow: window parses and fallbacks mixed, 400 steps', () => {
    const paras = Array.from({ length: 1500 }, (_, i) => `Paragraph ${i} with *emphasis*.\n`).join('\n');
    const list = Array.from({ length: 1500 }, (_, i) => `- item ${i} with **strong**\n`).join('\n');
    const { fallbackSteps } = run('mixed', `${paras}\n${list}`, 400, 5, { maxWindow: 20_000 });
    expect(fallbackSteps).toBeGreaterThan(20);
  }, 120_000);
});

describe('A20: no safe boundary inside maxWindow -> normal parser', () => {
  it('loose list of 2.2 MB (default config): no window parse, full tree equals the plain parse', () => {
    const list = Array.from({ length: 80_000 }, (_, i) => `- item ${i} with *text*\n`).join('\n');
    expect(list.length).toBeGreaterThan(windowConfig.minLength);
    expect(BoundaryIndex.create(docOf(list)).all()).toEqual([]);
    const before = { ...windowStats };
    let state = EditorState.create({ doc: list, extensions: [EditorState.lineSeparator.of('\n'), markdownLanguage] });
    // Jump to the middle, edit there, then parse to the end.
    ensureSyntaxTree(state, list.length >> 1, 1e9);
    state = state.update({ changes: { from: list.length >> 1, insert: 'x' } }).state;
    const tree = ensureSyntaxTree(state, state.doc.length, 1e9);
    expect(tree).not.toBeNull();
    expect(windowStats.parses).toBe(before.parses);
    expect(windowStats.fallbacks).toBeGreaterThan(before.fallbacks);
    const doc = state.doc.toString();
    const a = nodes(markdownParser.parse(doc), 0, 0, doc.length);
    const b = nodes(tree as Tree, 0, 0, doc.length);
    expect(b.length).toBe(a.length);
    expect(b.every((x, i) => x === a[i])).toBe(true);
  }, 60_000);
});

describe('fuzz: random Markdown line soup', () => {
  const LINES = [
    '', '', '', 'text', 'more text', '# h', '```', '````', '~~~', '```js', '  ```', '   ```', '    ```', '- item', '  - nested', '* x', '1. one', '2) two',
    '   para', '  indented', '    code', '\tcode', '> quote', '> ```', '>', '> - q item', '<!--', '-->', '<script>', '</script>', '<pre>', '</pre>', '<?x', '?>',
    '<!X', '>', '<![CDATA[', ']]>', '<div>', '</div>', '---', '===', '***', '| a | b |', '|---|---|', '[^1]: note', '    cont', 'lazy line', '- ```', '  ~~~', '1. ~~~',
    // `$$` math blocks: open, close, one-line forms, in containers, indented.
    '$$', '$$', '$$ x $$', '$$x$$', '$$ $$', '$$$', 'a $$', 'x$$  ', '- $$', '  $$', '> $$', '> x $$', '1. $$', '    $$', '   $$', '$x$ and $$y$$', '| $a$ | b |',
    '  <!--', '- <!--', '> <!--', '   -->', 'x -->', '  - ```', '    ```', '      ```', '[ref]: /url', '[ref]:', '"title"', '## h2 ##', '#nohead', '- - -', '__', '<a href="x">', '</a>', '+ plus', '3. three', '\t- tabbed', '>    code', '> > deep', '  > q', '<textarea>', '</textarea>', '<style>', '| x |', 'a | b', '|-|-|', '--- | ---', ':-:|', '> | q |', '> |---|',
  ];
  const DOCS = Number(process.env['FUZZ_DOCS'] ?? 2000);
  it(`${DOCS} documents x 2 line mixes: every boundary-to-end window and consecutive windows equal the full parse`, () => {
   const all: string[] = [];
   for (const [mix, seed] of [['plain', 1234 + Number(process.env['FUZZ_SEED'] ?? 0)], ['blank-heavy', 99 + Number(process.env['FUZZ_SEED'] ?? 0)]] as const) {
    const r = rng(seed);
    const mismatches: string[] = [];
    let windows = 0;
    let boundaries = 0;
    for (let d = 0; d < DOCS; d++) {
      const n = 10 + Math.floor(r() * 60);
      const lines: string[] = [];
      for (let k = 0; k < n; k++) lines.push(mix === 'blank-heavy' && r() < 0.3 ? '' : (LINES[Math.floor(r() * LINES.length)] as string));
      const text = lines.join('\n') + (r() < 0.5 ? '\n' : '');
      const full = markdownParser.parse(text);
      const b = BoundaryIndex.create(docOf(text)).all();
      boundaries += b.length;
      for (let i = 0; i < b.length; i++) {
        for (const e of [b[i + 1] ?? text.length, text.length]) {
          windows++;
          const m = check(text, full, b[i] as number, e);
          if (m) mismatches.push(`${m}\n${JSON.stringify(text)}`);
        }
      }
    }
    results[`fuzz:${mix}`] = { documents: DOCS, boundaries, windows, mismatchCount: mismatches.length, mismatches: mismatches.slice(0, 5) };
    save();
    all.push(...mismatches);
   }
   expect(all.slice(0, 3)).toEqual([]);
  }, 600_000);
});

describe('BoundaryIndex.map (checkpoints, resync, lazy scan) = fresh scan', () => {
  const SNIPS = ['```\n', '~~~\n', '<!--\n', '-->\n', '\n\n', '- ', '> ', '# ', '---\n', 'w ', '<div>\n', '[r]: /u\n', '| a |\n|---|\n', '\n', '    ', '1. ', '$$\n', 'x $$\n'];
  for (const [name, make] of [
    ['large.md', () => readFileSync(join(CORPUS, 'large.md'), 'utf8')],
    ['loose list 400 KB', () => Array.from({ length: 15_000 }, (_, i) => `- item ${i}\n`).join('\n')],
  ] as const) {
    it(`${name}: 300 random edits with random partial queries`, () => {
      const r = rng(77);
      let state = EditorState.create({ doc: make(), extensions: [boundaryField] });
      let bad = 0;
      for (let i = 0; i < 300; i++) {
        const len = state.doc.length;
        const pos = Math.floor(r() * len);
        const op = r();
        const changes = op < 0.6 ? { from: pos, insert: SNIPS[Math.floor(r() * SNIPS.length)] as string } : { from: pos, to: Math.min(len, pos + Math.floor(r() * 80)) };
        state = state.update({ changes }).state;
        const idx = state.field(boundaryField);
        // Partial lazy queries leave the index partly scanned before the next edit.
        if (r() < 0.7) idx.before(Math.floor(r() * state.doc.length));
        if (r() < 0.3) idx.after(Math.floor(r() * state.doc.length));
        if (i % 3 === 0) {
          const got = idx.all();
          const want = BoundaryIndex.create(state.doc).all();
          if (got.length !== want.length || got.some((x, j) => x !== want[j])) bad++;
        }
      }
      results[`indexMap:${name}`] = { edits: 300, checks: 100, mismatches: bad };
      save();
      expect(bad).toBe(0);
    }, 120_000);
  }
});
