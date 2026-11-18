/*
 * Code-block highlighting: highlight.js core + one lazy chunk per language.
 * This module (alias table, per-view block state) is in the initial bundle; the hljs core and
 * the languages are loaded on the first visible block of a known language.
 *
 * Tokens come from the result's token tree (`_emitter.rootNode`, internal to highlight.js
 * 11.12.0), never from its HTML string; they become CodeMirror mark decorations (class
 * `hljs-<scope>`) for the visible part of each visible block. Tokens are cached per
 * (language, block key).
 *
 * Typing cost (huge.md): a view update with a document change never slices, hashes or highlights
 * a block. `CodeHighlighter` keeps the tokens of the visible blocks, maps them through each change
 * and re-highlights an edited (or new) block in an idle callback. Only an update without a
 * document change (open, scroll) highlights a never-seen visible block at once.
 */
import type { ChangeSet, Text } from '@codemirror/state';
import type { HLJSApi, LanguageFn } from 'highlight.js';

import { Lru, heavyStats, keyOf, lazy } from './cache';

const LOADERS: Record<string, () => Promise<{ default: LanguageFn }>> = {
  javascript: () => import('highlight.js/lib/languages/javascript'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  python: () => import('highlight.js/lib/languages/python'),
  java: () => import('highlight.js/lib/languages/java'),
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  rust: () => import('highlight.js/lib/languages/rust'),
  go: () => import('highlight.js/lib/languages/go'),
  bash: () => import('highlight.js/lib/languages/bash'),
  json: () => import('highlight.js/lib/languages/json'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
  xml: () => import('highlight.js/lib/languages/xml'),
  css: () => import('highlight.js/lib/languages/css'),
  sql: () => import('highlight.js/lib/languages/sql'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
};
const ALIAS: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  kt: 'kotlin',
  rs: 'rust',
  sh: 'bash',
  shell: 'bash',
  yml: 'yaml',
  html: 'xml',
  'c++': 'cpp',
};

/** Blocks larger than this are not highlighted. */
const MAX_BLOCK_CHARS = 100_000;

/** [from, to, class], relative to the block text. */
export type Token = [number, number, string];

/** A document range of one line of block content (container markers left out). */
export interface LineRange {
  from: number;
  to: number;
}

let hljs: HLJSApi | null = null;
const core = lazy(() =>
  import('highlight.js/lib/core').then((m) => {
    heavyStats.chunks.push('hljs');
    return (hljs = m.default);
  }),
);
/** Languages that are loading (a failed load is removed, so the next use tries again). */
const loading = new Map<string, Promise<void>>();
/** Callbacks per language that is loading (a Set: one call per highlighter). */
const waiting = new Map<string, Set<() => void>>();
/** Token cache: <= 500 blocks, <= 256 Ki tokens in total (weight: token count). */
export const tokenCache = new Lru<Token[]>(500, 1 << 18);
/** An idle callback starts a block only with at least this much idle time left (or after its timeout). */
const IDLE_MIN_MS = 4;

/** highlight.js language of a fence info string, or null (no highlighting). */
export function hljsName(info: string): string | null {
  const n = info.toLowerCase();
  const name = ALIAS[n] ?? n;
  return Object.hasOwn(LOADERS, name) ? name : null;
}

interface TreeNode {
  scope?: string;
  children: (string | TreeNode)[];
}

function walk(node: TreeNode, pos: number, out: Token[]): number {
  const start = pos;
  for (const c of node.children) pos = typeof c === 'string' ? pos + c.length : walk(c, pos, out);
  // `language:<name>` nodes wrap a sub-language: no class of their own.
  if (node.scope && !node.scope.startsWith('language:') && pos > start) out.push([start, pos, `hljs-${node.scope.split('.')[0] ?? ''}`]);
  return pos;
}

/** Tokens of `code`, or null while the core or the language loads (`onLoad` runs when it is loaded). */
function hljsTokens(name: string, code: string, onLoad: () => void): Token[] | null {
  if (!hljs?.getLanguage(name)) {
    if (!loading.has(name)) {
      loading.set(
        name,
        core()
          .then(async (h) => {
            const lang = await LOADERS[name]?.();
            if (lang) h.registerLanguage(name, lang.default);
            heavyStats.chunks.push(`hljs:${name}`);
            for (const f of waiting.get(name) ?? []) f();
            waiting.delete(name);
          })
          .catch((e: unknown) => {
            loading.delete(name);
            console.warn(`markdone: highlight.js ${name} not loaded`, e);
          }),
      );
    }
    let set = waiting.get(name);
    if (!set) waiting.set(name, (set = new Set()));
    set.add(onLoad);
    return null;
  }
  const key = name + keyOf(code);
  let tokens = tokenCache.get(key);
  if (tokens) return tokens;
  const result = hljs.highlight(code, { language: name, ignoreIllegals: true }) as unknown as { _emitter: { rootNode: TreeNode } };
  tokens = [];
  walk(result._emitter.rootNode, 0, tokens);
  heavyStats.hljsHighlights++;
  tokenCache.set(key, tokens, tokens.length);
  return tokens;
}

interface Block {
  /** Body range in the current document. */
  from: number;
  to: number;
  name: string;
  /** Relative to `from`; null: not highlighted yet. */
  tokens: Token[] | null;
  /** The text changed since `tokens` were made (they are mapped through the change). */
  stale: boolean;
  /** Build in which the block was last visible. */
  build: number;
  /** Content lines of the block in a quote or a list item (null: the body as is); called only when it is highlighted. */
  lines: () => LineRange[] | null;
}

/**
 * Tokens of the text of `lines` (joined with `\n`) as document tokens relative to `base`. A token
 * that spans lines is split, so the markers between the lines get no mark.
 */
export function lineTokens(tokens: Token[], lines: LineRange[], base: number): Token[] {
  const starts: number[] = [];
  let at = 0;
  for (const l of lines) {
    starts.push(at);
    at += l.to - l.from + 1;
  }
  const out: Token[] = [];
  for (const [s, e, cls] of tokens) {
    // Last line that starts at or before s.
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((starts[mid] as number) <= s) lo = mid;
      else hi = mid - 1;
    }
    for (let i = lo; i < lines.length && (starts[i] as number) < e; i++) {
      const line = lines[i] as LineRange;
      const ls = starts[i] as number;
      const a = Math.max(s, ls);
      const z = Math.min(e, ls + line.to - line.from);
      if (z > a) out.push([line.from + a - ls - base, line.from + z - ls - base, cls]);
    }
  }
  return out;
}

/** Highlight state of the visible code blocks of one view (one instance per inline plugin). */
export class CodeHighlighter {
  private blocks = new Map<number, Block>();
  private build = 0;
  private idle = -1;

  constructor(
    private readonly doc: () => Text,
    /** Rebuild the decorations (tokens arrived). */
    private readonly changed: () => void,
  ) {}

  /** Maps the blocks through a document change; edited blocks keep mapped tokens and become stale. */
  map(changes: ChangeSet): void {
    const out = new Map<number, Block>();
    for (const b of this.blocks.values()) {
      const touched = changes.touchesRange(b.from, b.to);
      if (touched === 'cover') continue;
      const from = changes.mapPos(b.from, -1);
      if (!touched) {
        b.to += from - b.from;
        b.from = from;
      } else {
        const to = changes.mapPos(b.to, 1);
        if (b.tokens) {
          const old = b.from;
          b.tokens = b.tokens.flatMap(([s, e, cls]): Token[] => {
            const ns = changes.mapPos(old + s, 1) - from;
            const ne = changes.mapPos(old + e, -1) - from;
            return ne > ns ? [[ns, ne, cls]] : [];
          });
        }
        b.from = from;
        b.to = to;
        b.stale = true;
      }
      out.set(b.from, b);
    }
    this.blocks = out;
  }

  /** Starts a decoration build; blocks not visible in it are dropped at `end`. */
  begin(): void {
    this.build++;
  }

  end(): void {
    for (const [k, b] of this.blocks) if (b.build !== this.build) this.blocks.delete(k);
    if ([...this.blocks.values()].some((b) => b.stale || !b.tokens)) this.schedule();
  }

  /**
   * Tokens (relative to `from`) of the visible block [from, to) in language `name`, or null.
   * `now`: a never-highlighted block is highlighted in this call (no document change in this update).
   * `lines`: the block's content lines without container markers (quote, list item), or null.
   */
  tokens(from: number, to: number, name: string, now: boolean, lines: () => LineRange[] | null): Token[] | null {
    let b = this.blocks.get(from);
    if (!b || b.name !== name) {
      b = { from, to, name, tokens: null, stale: true, build: 0, lines };
      this.blocks.set(from, b);
    } else if (b.to !== to) {
      b.to = to;
      b.stale = true;
    }
    b.lines = lines;
    b.build = this.build;
    if (now && !b.tokens) {
      this.highlight(b);
      if (!b.stale) heavyStats.hljsSync++;
    }
    return b.tokens;
  }

  private highlight(b: Block): void {
    if (b.to - b.from > MAX_BLOCK_CHARS) {
      b.tokens = [];
      b.stale = false;
      return;
    }
    const doc = this.doc();
    const lines = b.lines();
    const text = lines ? lines.map((l) => doc.sliceString(l.from, l.to)).join('\n') : doc.sliceString(b.from, b.to);
    const tokens = hljsTokens(b.name, text, this.changed);
    if (!tokens) return;
    b.tokens = lines ? lineTokens(tokens, lines, b.from) : tokens;
    b.stale = false;
  }

  private schedule(): void {
    if (this.idle >= 0) return;
    /*
     * One block per idle callback, and only with idle time left (or after the timeout): a block
     * highlighted here rebuilds the decorations, and that build schedules the next stale block.
     * A block whose language is still loading is skipped (its load rebuilds).
     */
    this.idle = requestIdleCallback(
      (deadline) => {
        this.idle = -1;
        if (!deadline.didTimeout && deadline.timeRemaining() < IDLE_MIN_MS) {
          this.schedule();
          return;
        }
        for (const b of this.blocks.values()) {
          if (!b.stale && b.tokens) continue;
          this.highlight(b);
          if (b.stale) continue;
          heavyStats.hljsIdle++;
          this.changed();
          return;
        }
      },
      { timeout: 500 },
    );
  }

  destroy(): void {
    if (this.idle >= 0) cancelIdleCallback(this.idle);
    this.idle = -1;
  }
}
