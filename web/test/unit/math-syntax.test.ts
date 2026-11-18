// L1: TeX math syntax (src/heavy/math-syntax.ts) in the page's Markdown parser.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Tree } from '@lezer/common';
import { GFM, type InlineContext, type MarkdownConfig, parser as baseParser } from '@lezer/markdown';
import { describe, expect, it } from 'vitest';

import { MathSyntax } from '../../src/heavy/math-syntax';
import { Footnote, FrontMatter, markdownParser } from '../../src/language';

function math(text: string): string[] {
  const out: string[] = [];
  markdownParser.parse(text).iterate({
    enter: (n) => {
      if (n.name === 'InlineMath' || n.name === 'BlockMath') out.push(`${n.name}:${text.slice(n.from, n.to)}`);
    },
  });
  return out;
}

describe('inline math', () => {
  it('$…$ and $$…$$ in a paragraph', () => {
    expect(math('a $x^2$ b $$\\sum$$ c\n')).toEqual(['InlineMath:$x^2$', 'InlineMath:$$\\sum$$']);
  });
  it('currency is text (opener before space / closer after space / closer before digit)', () => {
    expect(math('Costs $5 and $10 today.\n')).toEqual([]);
    expect(math('from $ 5 to 6 $\n')).toEqual([]);
    // `$` before a digit does not close (Pandoc): the formula runs to the next valid closer.
    expect(math('$a$1 and $b$\n')).toEqual(['InlineMath:$a$1 and $b$']);
  });
  it('escapes: \\$ is not an opener; \\$ inside does not close', () => {
    expect(math('\\$x$ y\n')).toEqual([]);
    expect(math('$a\\$b$\n')).toEqual(['InlineMath:$a\\$b$']);
  });
  it('$ inside a code span is code', () => {
    expect(math('`$x$` and $y$\n')).toEqual(['InlineMath:$y$']);
  });
  it('inside emphasis, headings, lists, quotes', () => {
    expect(math('# T $x$\n\n- *a $y$*\n\n> $z$\n')).toEqual(['InlineMath:$x$', 'InlineMath:$y$', 'InlineMath:$z$']);
  });
  it('$ inside the math does not start emphasis', () => {
    expect(math('$a*b*c$\n')).toEqual(['InlineMath:$a*b*c$']);
  });
});

describe('block math', () => {
  it('multi-line and one-line', () => {
    expect(math('$$\na\\\\\nb\n$$\n\n$$ c $$\n')).toEqual(['BlockMath:$$\na\\\\\nb\n$$', 'BlockMath:$$ c $$']);
  });
  it('interrupts a paragraph', () => {
    expect(math('text\n$$\nx\n$$\n')).toEqual(['BlockMath:$$\nx\n$$']);
  });
  it('unclosed: runs to the end of its container, like a fence', () => {
    expect(math('> $$\n> x\n\nafter\n')).toEqual(['BlockMath:$$\n> x']);
  });
  it('in a fenced code block it is code; indented 4 is code', () => {
    expect(math('```\n$$\nx\n$$\n```\n')).toEqual([]);
    expect(math('    $$\n    x\n    $$\n')).toEqual([]);
  });
  it('GFM table cell: `|` splits the cell first (as on GitHub)', () => {
    expect(math('| a | b |\n|---|---|\n| $x$ | $y|z$ |\n').length).toBeGreaterThanOrEqual(1);
  });
});

describe('block math across blank lines (windowed parse boundaries)', () => {
  it('a $$ block keeps blank lines, headings and list markers as its content', () => {
    expect(math('$$\na\n\n# h\n\n- l\n$$\n\nafter\n')).toEqual(['BlockMath:$$\na\n\n# h\n\n- l\n$$']);
  });
  it('unclosed in a list item: it ends with the item (blank line included, as a fence)', () => {
    expect(math('- $$\n  x\n\ny\n')).toEqual(['BlockMath:$$\n  x\n']);
  });
  it('`$$ $$` and `$$$` open a block (not the one-line form)', () => {
    expect(math('$$ $$\nx\n$$\n')).toEqual(['BlockMath:$$ $$\nx\n$$']);
    expect(math('$$$\nx\n$$\n')).toEqual(['BlockMath:$$$\nx\n$$']);
  });
});

/* ---------- Linear inline `$` scan: same trees as the first (quadratic) scan ---------- */

/** The inline `$` parser of the first version (one scan per opener), as the reference. */
function referenceInlineMath(cx: InlineContext, next: number, pos: number): number {
  const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 13;
  if (next !== 36 || cx.char(pos - 1) === 36) return -1;
  const open = cx.char(pos + 1) === 36 ? 2 : 1;
  const start = pos + open;
  const first = cx.char(start);
  if (first < 0 || isSpace(first) || first === 36) return -1;
  for (let i = start; i < cx.end; i++) {
    const c = cx.char(i);
    if (c === 92) {
      i++;
      continue;
    }
    if (c !== 36) continue;
    if (open === 2) {
      if (cx.char(i + 1) !== 36) continue;
    } else if (isSpace(cx.char(i - 1)) || (cx.char(i + 1) >= 48 && cx.char(i + 1) <= 57)) {
      continue;
    }
    return cx.addElement(cx.elt('InlineMath', pos, i + open, [cx.elt('MathMark', pos, start), cx.elt('MathMark', i, i + open)]));
  }
  return -1;
}

const ReferenceMath: MarkdownConfig = { ...MathSyntax, parseInline: [{ name: 'InlineMath', parse: referenceInlineMath, before: 'Emphasis' }] };
const reference = baseParser.configure([GFM, FrontMatter, Footnote, ReferenceMath]);
const current = baseParser.configure([GFM, FrontMatter, Footnote, MathSyntax]);

const nodes = (tree: Tree): string => {
  const out: string[] = [];
  tree.iterate({ enter: (n) => void out.push(`${n.name}@${n.from}-${n.to}`) });
  return out.join(' ');
};

const CORPUS = fileURLToPath(new URL('../../../src/test/resources/corpus/', import.meta.url));
function corpus(dir = ''): string[] {
  return readdirSync(join(CORPUS, dir))
    .sort()
    .flatMap((name) => {
      const rel = dir ? `${dir}/${name}` : name;
      if (statSync(join(CORPUS, rel)).isDirectory()) return corpus(rel);
      return name.endsWith('.md') && rel !== 'huge.md' ? [rel] : [];
    });
}

describe('inline $ scan is linear and gives the same trees', () => {
  it('corpus (without huge.md): same nodes as the reference scan', () => {
    const files = corpus();
    expect(files.length).toBeGreaterThan(40);
    const diff = files.filter((f) => {
      const text = readFileSync(join(CORPUS, f), 'utf8');
      return nodes(current.parse(text)) !== nodes(reference.parse(text));
    });
    expect(diff).toEqual([]);
  });

  it('fuzz: 20 000 paragraphs of `$`, `$$`, backslashes, digits, spaces, code spans: 0 mismatches', () => {
    let seed = 7;
    const r = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const PARTS = ['$', '$', '$', '$$', '\\', '\\$', '\\\\', ' ', ' ', 'a', 'x', '5', '1', '`', '*', '_', '\n', '\n\n', '[', '](u)', '> ', '- ', '|', '\t', '{', '}'];
    const mismatches: string[] = [];
    for (let d = 0; d < 20_000; d++) {
      const n = 1 + Math.floor(r() * 30);
      let text = '';
      for (let k = 0; k < n; k++) text += PARTS[Math.floor(r() * PARTS.length)];
      if (nodes(current.parse(text)) !== nodes(reference.parse(text))) mismatches.push(JSON.stringify(text));
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
  });

  it('a 96 KB paragraph of "$5 " (no closer) parses in < 50 ms (was 3.3 s)', () => {
    const text = `${'$5 '.repeat(32_000)}\n`;
    markdownParser.parse(text.slice(0, 3000));
    const t0 = performance.now();
    const tree = markdownParser.parse(text);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(50);
    let math = 0;
    tree.iterate({ enter: (n) => void (n.name === 'InlineMath' && math++) });
    expect(math).toBe(0);
    // With a closer at the end, the first opener takes the whole paragraph (as the reference).
    const closed = `${'$5 '.repeat(32_000)}x$\n`;
    expect(nodes(current.parse(closed))).toBe(nodes(reference.parse(closed)));
  });
});
