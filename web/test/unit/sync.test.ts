// L1: page outbox (compose, one patch in flight, flush, ack, reject) and rebase over IDE changes.
import { ChangeSet, Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import { HostDoc } from '../../harness/host-model';
import type { IncomingChange } from '../../src/protocol';
import { Outbox, patchesOf, sequentialChanges } from '../../src/sync';

const doc = (s: string) => Text.of(s.split('\n'));
const change = (len: number, from: number, to: number, insert: string) => ChangeSet.of({ from, to, insert }, len, '\n');

describe('sequentialChanges / patchesOf', () => {
  it('composes sequential changes; patches are sorted and relative to the text before', () => {
    const set = sequentialChanges(4, [
      { from: 0, to: 0, insert: 'A' },
      { from: 2, to: 3, insert: '' },
    ]);
    expect(set.apply(doc('abcd')).toString()).toBe('Aacd');
    expect(patchesOf(set)).toEqual([
      { start: 0, end: 0, text: 'A' },
      { start: 1, end: 2, text: '' },
    ]);
  });

  it('keeps \\r in inserted text (lineSeparator "\\n")', () => {
    const set = sequentialChanges(0, [{ from: 0, to: 0, insert: 'a\r\nb' }]);
    expect(set.newLength).toBe(4);
    expect(patchesOf(set)).toEqual([{ start: 0, end: 0, text: 'a\r\nb' }]);
  });

  it('throws on a change outside the text', () => {
    expect(() => sequentialChanges(3, [{ from: 2, to: 5, insert: '' }])).toThrow(RangeError);
  });
});

describe('Outbox', () => {
  it('one patch in flight; later changes are composed into the next patch', () => {
    const o = new Outbox(10);
    o.local(change(5, 5, 5, 'X'));
    const first = o.take(6);
    expect(first).toEqual({ seq: 1, baseStamp: 10, patches: [{ start: 5, end: 5, text: 'X' }] });
    o.local(change(6, 0, 0, 'a'));
    o.local(change(7, 7, 7, 'b'));
    expect(o.take(8)).toBeNull();
    expect(o.ack(1, 11)).toBe(true);
    expect(o.take(8)).toEqual({
      seq: 2,
      baseStamp: 11,
      patches: [
        { start: 0, end: 0, text: 'a' },
        { start: 6, end: 6, text: 'b' },
      ],
    });
  });

  it('flush: pending changes or [] with the IDE seq; next own seq is higher', () => {
    const o = new Outbox(3);
    o.flush(7);
    expect(o.take(0)).toEqual({ seq: 7, baseStamp: 3, patches: [] });
    expect(o.ack(7, 3)).toBe(true);
    o.local(change(0, 0, 0, 'x'));
    expect(o.take(1)?.seq).toBe(8);
  });

  it('flush while a patch is in flight: waits for the ack; same seq as in flight = that patch is the reply', () => {
    const o = new Outbox(1);
    o.local(change(0, 0, 0, 'x'));
    expect(o.take(1)?.seq).toBe(1);
    o.local(change(1, 1, 1, 'y'));
    o.flush(1);
    expect(o.take(2)).toBeNull();
    o.ack(1, 2);
    // The reply was patch 1; "y" goes as a normal patch.
    expect(o.take(2)).toEqual({ seq: 2, baseStamp: 2, patches: [{ start: 1, end: 1, text: 'y' }] });
    o.flush(5);
    expect(o.take(2)).toBeNull();
    o.ack(2, 3);
    expect(o.take(2)).toEqual({ seq: 5, baseStamp: 3, patches: [] });
  });

  it('incoming change while a patch is in flight and changes are pending: rebases both', () => {
    // host "abcdef" @5; page sent X at 4 (in flight), then typed Y at 0 (pending).
    const o = new Outbox(5);
    o.local(change(6, 4, 4, 'X'));
    o.take(7);
    o.local(change(7, 0, 0, 'Y'));
    // IDE inserted "--" at 2 (relative to "abcdef").
    const e = o.incoming(8, [{ from: 2, to: 2, insert: '--' }], 6);
    expect(e.apply(doc('YabcdXef')).toString()).toBe('Yab--cdXef');
    expect(o.baseStamp).toBe(6);
    // The IDE maps the in-flight patch the same way: X at 6 in "ab--cdef".
    expect(patchesOf(o.inflight?.changes as ChangeSet)).toEqual([{ start: 6, end: 6, text: 'X' }]);
    o.ack(1, 7);
    expect(o.take(10)).toEqual({ seq: 2, baseStamp: 7, patches: [{ start: 0, end: 0, text: 'Y' }] });
  });

  it('same position: the IDE insertion goes before the local one', () => {
    const o = new Outbox(1);
    o.local(change(3, 1, 1, 'L'));
    const e = o.incoming(4, [{ from: 1, to: 1, insert: 'R' }], 2);
    expect(e.apply(doc('aLbc')).toString()).toBe('aRLbc');
    expect(o.take(5)?.patches).toEqual([{ start: 2, end: 2, text: 'L' }]);
  });

  it('reject: drops local changes and sends nothing until reset; flush still answers []', () => {
    const o = new Outbox(1);
    o.local(change(3, 0, 0, 'a'));
    o.take(4);
    o.local(change(4, 0, 0, 'b'));
    expect(o.reject(1)).toBe(true);
    o.local(change(5, 0, 0, 'c'));
    expect(o.take(6)).toBeNull();
    // IDE change on the host text "xyz" still lands at the right place in the page text.
    const e = o.incoming(6, [{ from: 3, to: 3, insert: '!' }], 2);
    expect(e.apply(doc('cbaxyz')).toString()).toBe('cbaxyz!');
    o.flush(9);
    expect(o.take(7)).toEqual({ seq: 9, baseStamp: 2, patches: [] });
    o.ack(9, 2);
    o.reset(4);
    expect(o.idle()).toBe(true);
    expect(o.rejected).toBeNull();
  });
});

/* Seeded PRNG (mulberry32). */
function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type ToPage =
  | { type: 'ack'; seq: number; stamp: number; length: number }
  | { type: 'reject'; seq: number }
  | { type: 'change'; stamp: number; length: number; changes: IncomingChange[] }
  | { type: 'reload' };

interface SimOptions {
  initial: string;
  texts: string[];
  steps: number;
  /** Max extra length of a random edit range. */
  span: number;
}

/**
 * Page outbox <-> host model (1:1 port of Kotlin PatchApplier, version counter), random
 * interleaving. After each message to the page: the length check of PROTOCOL.md 2.1 passes, and
 * the host text at `baseStamp` + the page's local changes = the page text (no silent divergence).
 */
function simulate(seed: number, opt: SimOptions): { mapped: number; rejects: number } {
  const r = rng(seed);
  const int = (n: number) => Math.floor(r() * n);
  const host = new HostDoc(opt.initial, 0);
  /** Host text at each version a message can carry. */
  const textAt = new Map<number, string>([[0, host.text]]);
  const record = () => textAt.set(host.stamp, host.text);
  let page = doc(host.text);
  const outbox = new Outbox(0);
  const toHost: { seq: number; baseStamp: number; patches: { start: number; end: number; text: string }[] }[] = [];
  const toPage: ToPage[] = [];
  let flushSeq: number | null = null;
  const randomEdit = (len: number) => {
    const from = int(len + 1);
    const to = Math.min(len, from + (r() < 0.5 ? 0 : int(opt.span + 1)));
    return { from, to, insert: opt.texts[int(opt.texts.length)] ?? '' };
  };
  const consistent = (where: string) => {
    let text = doc(textAt.get(outbox.baseStamp) ?? '');
    for (const set of [outbox.inflight?.changes, outbox.pending, outbox.rejected]) if (set) text = set.apply(text);
    expect(text.toString(), `seed ${seed}: ${where}`).toBe(page.toString());
  };
  const sendPage = () => {
    const out = outbox.take(page.length);
    if (out) toHost.push(out);
  };
  const deliverToPage = () => {
    const msg = toPage.shift();
    if (!msg) return;
    if (msg.type === 'ack') {
      if (!outbox.ack(msg.seq, msg.stamp)) return;
      if (!outbox.pending) expect(outbox.hostLength(page.length), `seed ${seed}: ack length`).toBe(msg.length);
      sendPage();
    } else if (msg.type === 'reject') {
      outbox.reject(msg.seq);
    } else if (msg.type === 'change') {
      page = outbox.incoming(page.length, msg.changes, msg.stamp).apply(page);
      expect(outbox.hostLength(page.length), `seed ${seed}: change length`).toBe(msg.length);
    } else {
      // reload: fetch reads the host now; later queued changes up to that stamp are skipped.
      page = doc(host.text);
      outbox.reset(host.stamp);
      const stamp = host.stamp;
      for (let i = toPage.length - 1; i >= 0; i--) {
        const m = toPage[i];
        if (m?.type === 'change' && m.stamp <= stamp) toPage.splice(i, 1);
      }
    }
    consistent(msg.type);
  };
  const deliverToHost = () => {
    const msg = toHost.shift();
    if (!msg) return;
    const stamp = host.applyPatch(msg);
    record();
    if (flushSeq !== null && msg.seq >= flushSeq) flushSeq = null;
    if (stamp === null) toPage.push({ type: 'reject', seq: msg.seq }, { type: 'reload' });
    else toPage.push({ type: 'ack', seq: msg.seq, stamp, length: host.length });
  };
  const ideChange = (out: ReturnType<HostDoc['external']> | null) => {
    if (!out) return;
    record();
    toPage.push({ type: 'change', stamp: out.stamp, length: out.length, changes: out.changes });
  };
  for (let step = 0; step < opt.steps; step++) {
    const p = r();
    if (p < 0.3) {
      const c = randomEdit(page.length);
      const set = ChangeSet.of(c, page.length, '\n');
      page = set.apply(page);
      outbox.local(set);
    } else if (p < 0.4) {
      sendPage();
    } else if (p < 0.5) {
      const changes: IncomingChange[] = [];
      let len = host.length;
      for (let k = 0, n = 1 + int(3); k < n; k++) {
        const c = randomEdit(len);
        changes.push(c);
        len += c.insert.length - (c.to - c.from);
      }
      ideChange(host.external(changes));
    } else if (p < 0.55) {
      ideChange(r() < 0.6 ? host.undo() : host.redo());
    } else if (p < 0.6) {
      // Kotlin: one flush at a time, seq = last seq seen + 1; done when a patch with seq >= it arrives.
      if (flushSeq === null) {
        flushSeq = host.lastSeq + 1;
        outbox.flush(flushSeq);
        sendPage();
      }
    } else if (p < 0.8) {
      deliverToHost();
    } else {
      deliverToPage();
    }
  }
  // Settle.
  for (let i = 0; i < 1000 && (toHost.length || toPage.length || !outbox.idle()); i++) {
    sendPage();
    deliverToHost();
    deliverToPage();
  }
  expect(toHost.length + toPage.length).toBe(0);
  expect(page.toString()).toBe(host.text);
  return { mapped: host.mapped, rejects: host.rejects };
}

describe('sync simulation: page outbox <-> host model, random interleaving', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('seed %i converges', (seed) => {
    const { mapped, rejects } = simulate(seed, {
      initial: '# Title\n\nSome text here.\nMore text.\n',
      texts: ['a', 'xyz', '\n', '', '😀', 'line\nline'],
      steps: 2000,
      span: 5,
    });
    // Both paths ran: mapped patches and rejects.
    expect(mapped).toBeGreaterThan(0);
    expect(rejects).toBeGreaterThan(0);
  });

  it('short texts, small alphabet (many ties at range boundaries): no silent divergence over 300 seeds', () => {
    let mapped = 0;
    for (let seed = 100; seed < 400; seed++) {
      mapped += simulate(seed, { initial: 'abcd', texts: ['', 'x', 'yz', 'x'], steps: 300, span: 2 }).mapped;
    }
    expect(mapped).toBeGreaterThan(0);
  });
});
