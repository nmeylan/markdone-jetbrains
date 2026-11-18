/*
 * Cache keys and a bounded LRU for the widget caches (tables, math, Mermaid, code tokens).
 * Keys are `<length>:<53-bit hash>` of the source: no source string is kept as a key.
 */

/** cyrb53: a fast 53-bit string hash (not cryptographic). */
export function hash53(s: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export const keyOf = (s: string): string => `${s.length}:${hash53(s)}`;

/** LRU bounded by entries and by a total weight; a value heavier than the weight bound is not kept. */
export class Lru<V> {
  private readonly map = new Map<string, { v: V; w: number }>();
  private total = 0;
  constructor(
    private readonly maxEntries: number,
    private readonly maxWeight: number,
  ) {}
  get(k: string): V | undefined {
    const hit = this.map.get(k);
    if (!hit) return undefined;
    // Most recently used last.
    this.map.delete(k);
    this.map.set(k, hit);
    return hit.v;
  }
  set(k: string, v: V, w = 1): void {
    if (w > this.maxWeight) return;
    const old = this.map.get(k);
    if (old) {
      this.map.delete(k);
      this.total -= old.w;
    }
    while (this.map.size >= this.maxEntries || this.total + w > this.maxWeight) {
      const [oldKey, oldValue] = this.map.entries().next().value as [string, { w: number }];
      this.map.delete(oldKey);
      this.total -= oldValue.w;
    }
    this.map.set(k, { v, w });
    this.total += w;
  }
  get size(): number {
    return this.map.size;
  }
  /** Total weight of the entries. */
  get weight(): number {
    return this.total;
  }
}

/**
 * A lazy import, loaded once: the promise is kept while it loads and after it loads. A failed load
 * is not kept, so the next call tries again.
 */
export function lazy<T>(load: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () =>
    (p ??= load().catch((e: unknown) => {
      p = null;
      throw e;
    }));
}

/** Counters for tests and perf reports (window.__harness.heavyStats()). */
export const heavyStats = {
  mathRenders: 0,
  mathCacheHits: 0,
  mermaidRenders: 0,
  mermaidCacheHits: 0,
  mermaidErrors: 0,
  /** Weight of the Mermaid cache (serialized SVG chars). */
  mermaidCacheWeight: 0,
  /** Code blocks highlighted (cache misses), and where: in a view update or in an idle callback. */
  hljsHighlights: 0,
  hljsSync: 0,
  hljsIdle: 0,
  /** Lazy chunks loaded, in order: `math`, `mermaid`, `hljs`, `hljs:<language>`. */
  chunks: [] as string[],
};
