/*
 * Page side of the document sync (PROTOCOL.md v2), one Outbox per document. Pure
 * logic on CodeMirror ChangeSets, no DOM.
 *
 * Text model: host text at `baseStamp` --inflight--> --pending--> page text (after `reject`:
 * host text --inflight (empty flush reply only)--> --rejected--> page text).
 * - `inflight`: the patch sent and not acked yet (at most one).
 * - `pending`: local changes after it, composed; sent as the next patch.
 * An incoming `change` E is relative to the host text at `baseStamp`. The page rebases its local
 * changes over E (`ChangeSet.map`): external insertions go before local insertions at the same
 * position.
 */
import { ChangeSet } from '@codemirror/state';

import type { IncomingChange, Patch } from './protocol';

export interface PatchOut {
  seq: number;
  baseStamp: number;
  patches: Patch[];
}

/** Patches of a change set, sorted, in the coordinates of the document before it. */
export function patchesOf(changes: ChangeSet): Patch[] {
  const patches: Patch[] = [];
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    patches.push({ start: fromA, end: toA, text: inserted.toString() });
  });
  return patches;
}

/** One change set from changes in sequential order (each relative to the text after the previous). */
export function sequentialChanges(length: number, changes: readonly IncomingChange[]): ChangeSet {
  let set = ChangeSet.empty(length);
  for (const c of changes) {
    // "\n" separator: a "\r" in the inserted text stays a character, as in the IDE Document.
    set = set.compose(ChangeSet.of({ from: c.from, to: c.to, insert: c.insert }, set.newLength, '\n'));
  }
  return set;
}

export class Outbox {
  /** Last host stamp the page knows (from `opened`, `ack` or `change`). */
  baseStamp: number;
  /** Last seq used (by the page or by a `flush`). */
  seq = 0;
  inflight: { seq: number; changes: ChangeSet } | null = null;
  pending: ChangeSet | null = null;
  /** After `reject`: local changes that are not sent any more; kept only to map incoming changes. */
  rejected: ChangeSet | null = null;
  /** A `flush` that waits for the in-flight ack. */
  flushSeq: number | null = null;
  /** After `diverged`: local changes are not sent any more (flush replies are []) until `reset`. */
  halted = false;

  constructor(stamp: number) {
    this.baseStamp = stamp;
  }

  /** A local (user) change of the page document. */
  local(changes: ChangeSet): void {
    if (this.rejected) this.rejected = this.rejected.compose(changes);
    else this.pending = this.pending ? this.pending.compose(changes) : changes;
  }

  /** True when there is something to send now. */
  ready(): boolean {
    return !this.inflight && (this.flushSeq !== null || (!this.rejected && !this.halted && this.pending !== null));
  }

  /** The next patch to send (it becomes the in-flight patch), or null. */
  take(docLength: number): PatchOut | null {
    if (!this.ready()) return null;
    let seq: number;
    if (this.flushSeq !== null) {
      seq = this.flushSeq;
      this.flushSeq = null;
    } else {
      seq = ++this.seq;
    }
    const sendable = !this.rejected && !this.halted;
    const patches = sendable && this.pending ? patchesOf(this.pending) : [];
    const length = this.rejected ? this.rejected.length : this.pending ? this.pending.length : docLength;
    if (sendable) this.pending = null;
    /*
     * The in-flight change set is rebuilt from the patches sent: a composed ChangeSet keeps its
     * internal sections, and its `map` over IDE changes can differ from the IDE PatchApplier on
     * the merged ranges.
     */
    const changes = ChangeSet.of(
      patches.map((p) => ({ from: p.start, to: p.end, insert: p.text })),
      length,
      '\n',
    );
    this.inflight = { seq, changes };
    return { seq, baseStamp: this.baseStamp, patches };
  }

  /**
   * `flush {seq}`: the reply is the next patch with that seq. When the in-flight patch already
   * has that seq, the IDE has not seen it yet, so it is the reply (nothing more to send).
   */
  flush(seq: number): void {
    this.seq = Math.max(this.seq, seq);
    if (this.inflight?.seq === seq) return;
    this.flushSeq = seq;
  }

  /** `ack`: returns false for an unknown seq (ignored). */
  ack(seq: number, stamp: number): boolean {
    if (this.inflight?.seq !== seq) return false;
    this.inflight = null;
    this.baseStamp = stamp;
    return true;
  }

  /** `reject`: drop the in-flight and pending changes; send nothing until `reset` (reload). */
  reject(seq: number): boolean {
    if (this.inflight?.seq !== seq) return false;
    const lost = this.pending ? this.inflight.changes.compose(this.pending) : this.inflight.changes;
    this.rejected = this.rejected ? this.rejected.compose(lost) : lost;
    this.inflight = null;
    this.pending = null;
    return true;
  }

  /** Length of the host text at `baseStamp`. */
  hostLength(docLength: number): number {
    if (this.inflight) return this.inflight.changes.length;
    if (this.pending) return this.pending.length;
    if (this.rejected) return this.rejected.length;
    return docLength;
  }

  /**
   * `change`: returns the change set to apply to the page document (incoming changes rebased
   * over the local ones) and rebases the local changes over the incoming ones.
   * Throws RangeError when the changes do not fit the host text.
   */
  incoming(docLength: number, changes: readonly IncomingChange[], stamp: number): ChangeSet {
    let e = sequentialChanges(this.hostLength(docLength), changes);
    if (this.inflight) {
      const mapped = e.map(this.inflight.changes, true);
      this.inflight = { seq: this.inflight.seq, changes: this.inflight.changes.map(e) };
      e = mapped;
    }
    if (this.pending) {
      const mapped = e.map(this.pending, true);
      this.pending = this.pending.map(e);
      e = mapped;
    }
    if (this.rejected) {
      const mapped = e.map(this.rejected, true);
      this.rejected = this.rejected.map(e);
      e = mapped;
    }
    this.baseStamp = stamp;
    return e;
  }

  /** Position in the host text at `baseStamp` -> position in the page text. */
  mapHostPos(pos: number): number {
    let p = pos;
    if (this.inflight) p = this.inflight.changes.mapPos(p, 1);
    if (this.pending) p = this.pending.mapPos(p, 1);
    if (this.rejected) p = this.rejected.mapPos(p, 1);
    return p;
  }

  /** `reload`: the page text is the host text at `stamp` again. */
  reset(stamp: number): void {
    this.baseStamp = stamp;
    this.inflight = null;
    this.pending = null;
    this.rejected = null;
    this.flushSeq = null;
    this.halted = false;
  }

  idle(): boolean {
    return !this.inflight && !this.pending && this.flushSeq === null;
  }
}
