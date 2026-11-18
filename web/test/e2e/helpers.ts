import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Page, expect } from '@playwright/test';

import { CORPUS } from './fixtures';

export const round = (n: number): number => Math.round(n * 10) / 10;

export function stats(values: number[]): { median: number; p95: number; max: number } {
  const v = [...values].sort((a, b) => a - b);
  return {
    median: round(v[Math.floor(v.length / 2)] ?? NaN),
    p95: round(v[Math.ceil(v.length * 0.95) - 1] ?? NaN),
    max: round(v[v.length - 1] ?? NaN),
  };
}

/** huge.md (~20 MB, git-ignored): generated on first use. */
export function hugeText(): string {
  const huge = join(CORPUS, 'huge.md');
  if (!existsSync(huge)) execFileSync('node', [fileURLToPath(new URL('../../scripts/gen-corpus.mjs', import.meta.url)), 'huge']);
  return readFileSync(huge, 'utf8');
}

export async function frames(page: Page, n = 2): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );
}

/* Seeded PRNG (mulberry32). */
export function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Host messages of one kind from the harness log. */
export async function sent(page: Page, type: string): Promise<Record<string, unknown>[]> {
  const log = await page.evaluate(() => window.__harness.log());
  return log.filter((e) => e.msg.type === type).map((e) => e.msg as unknown as Record<string, unknown>);
}

/*
 * Waits until the lazy chunks stopped arriving (the same chunk list in two reads 300 ms apart) and
 * the first visible line is the same after 3 frames in a row (read after the paint); returns that line.
 */
export async function stableTopLine(page: Page): Promise<number> {
  let chunks: string | null = null;
  await expect
    .poll(
      async () => {
        const now = (await page.evaluate(() => window.__harness.heavyStats().chunks)).join();
        const same = now === chunks;
        chunks = now;
        return same;
      },
      { intervals: [300] },
    )
    .toBe(true);
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let last = -1;
        let same = 0;
        const tick = () =>
          requestAnimationFrame(() =>
            setTimeout(() => {
              const top = window.__harness.topLine();
              same = top === last ? same + 1 : 0;
              last = top;
              if (same >= 3) resolve(top);
              else tick();
            }),
          );
        tick();
      }),
  );
}
