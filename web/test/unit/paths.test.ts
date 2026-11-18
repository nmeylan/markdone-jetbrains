// L1: the path existence cache and its batching.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_PATHS, forgetPaths, pathExists, receivePaths, recheckMissing, setPathRequester } from '../../src/paths';
import { validateIdeMessage } from '../../src/protocol';

const sent: [string, string[]][] = [];

beforeEach(() => {
  vi.useFakeTimers();
  sent.length = 0;
  setPathRequester((docId, paths) => sent.push([docId, paths]));
});
afterEach(() => {
  forgetPaths('d');
  vi.useRealTimers();
});

describe('paths', () => {
  it('asks once, in a batch, and answers false until the reply', () => {
    expect(pathExists('d', 'a/b.kt')).toBe(false);
    expect(pathExists('d', 'a/b.kt')).toBe(false);
    expect(pathExists('d', 'c.md')).toBe(false);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(50);
    expect(sent).toEqual([['d', ['a/b.kt', 'c.md']]]);
    // In flight: not asked again.
    expect(pathExists('d', 'a/b.kt')).toBe(false);
    vi.advanceTimersByTime(50);
    expect(sent).toHaveLength(1);
  });

  it('keeps the answers and rechecks only the missing ones', () => {
    pathExists('d', 'a.kt');
    vi.advanceTimersByTime(50);
    receivePaths('d', ['a.kt'], ['b.kt']);
    expect(pathExists('d', 'a.kt')).toBe(true);
    expect(pathExists('d', 'b.kt')).toBe(false);
    vi.advanceTimersByTime(50);
    expect(sent).toHaveLength(1);
    recheckMissing('d');
    pathExists('d', 'b.kt');
    vi.advanceTimersByTime(50);
    expect(sent[1]).toEqual(['d', ['b.kt']]);
    expect(pathExists('d', 'a.kt')).toBe(true);
  });

  it('splits a large queue', () => {
    for (let i = 0; i < MAX_PATHS + 1; i++) pathExists('d', `f${i}.kt`);
    vi.advanceTimersByTime(50);
    expect(sent.map(([, p]) => p.length)).toEqual([MAX_PATHS, 1]);
  });

  it('validates the `paths` message', () => {
    expect(validateIdeMessage({ type: 'paths', docId: 'd', exist: ['a'], missing: [] })).not.toBeNull();
    expect(validateIdeMessage({ type: 'paths', docId: 'd', exist: [1], missing: [] })).toBeNull();
    expect(validateIdeMessage({ type: 'paths', docId: 'd', exist: ['a'] })).toBeNull();
  });
});
