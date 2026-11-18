// L1: heavy-block caches (src/heavy/cache.ts, src/heavy/highlight.ts): weights, bounds, lazy chunk retry, token mapping for quoted blocks.
import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import { Lru, lazy } from '../../src/heavy/cache';
import { CodeHighlighter, lineTokens, tokenCache } from '../../src/heavy/highlight';

describe('Lru', () => {
  it('is bounded by the total weight: old entries go first; a value heavier than the bound is not kept', () => {
    const lru = new Lru<string>(100, 10);
    lru.set('a', 'a', 4);
    lru.set('b', 'b', 4);
    expect(lru.weight).toBe(8);
    lru.get('a');
    lru.set('c', 'c', 4);
    // `b` was the least recently used.
    expect([lru.get('a'), lru.get('b'), lru.get('c')]).toEqual(['a', undefined, 'c']);
    expect(lru.weight).toBe(8);
    lru.set('big', 'big', 11);
    expect(lru.get('big')).toBeUndefined();
    expect(lru.weight).toBe(8);
    lru.set('a', 'a2', 1);
    expect(lru.weight).toBe(5);
  });
  it('is bounded by the entry count', () => {
    const lru = new Lru<number>(3, 1000);
    for (let i = 0; i < 10; i++) lru.set(String(i), i);
    expect(lru.size).toBe(3);
    expect(lru.weight).toBe(3);
  });
});

describe('lazy', () => {
  it('loads once; a failed load is not kept, so the next call loads again', async () => {
    let calls = 0;
    const load = lazy(async () => {
      calls++;
      if (calls === 1) throw new TypeError('Failed to fetch dynamically imported module');
      return calls;
    });
    await expect(load()).rejects.toThrow('Failed to fetch');
    expect(await load()).toBe(2);
    expect(await load()).toBe(2);
    expect(calls).toBe(2);
  });
  it('callers during a load share one promise', async () => {
    let calls = 0;
    const load = lazy(() => Promise.resolve(++calls));
    expect(await Promise.all([load(), load()])).toEqual([1, 1]);
  });
});

describe('hljs token cache', () => {
  it('weight is the token count of each block, not its source length', async () => {
    const code = 'def f(x):\n    return x  # comment\n';
    const doc = Text.of(['```py', ...code.split('\n'), '```']);
    const from = doc.line(2).from;
    const to = from + code.length;
    let loaded!: () => void;
    const ready = new Promise<void>((r) => (loaded = r));
    const h = new CodeHighlighter(() => doc, () => loaded());
    expect(h.tokens(from, to, 'python', true, () => null)).toBeNull();
    await ready;
    const before = tokenCache.weight;
    const tokens = h.tokens(from, to, 'python', true, () => null);
    expect(tokens?.length).toBeGreaterThan(2);
    expect(tokenCache.weight - before).toBe(tokens?.length);
    expect(tokenCache.weight - before).toBeLessThan(code.length);
  });
});

describe('lineTokens (code block in a quote or a list item)', () => {
  it('maps text tokens to document offsets and splits tokens at the left-out markers', () => {
    // Document: "> a = 'x\n> y'\n" with the body lines at [2, 8) and [11, 13); text "a = 'x\ny'".
    const lines = [
      { from: 2, to: 8 },
      { from: 11, to: 13 },
    ];
    const tokens: [number, number, string][] = [
      [0, 1, 'hljs-variable'],
      [4, 9, 'hljs-string'],
    ];
    expect(lineTokens(tokens, lines, 2)).toEqual([
      [0, 1, 'hljs-variable'],
      [4, 6, 'hljs-string'],
      [9, 11, 'hljs-string'],
    ]);
  });
});
