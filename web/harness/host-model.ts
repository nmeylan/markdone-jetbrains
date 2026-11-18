/*
 * Model of the IDE side of one document (PROTOCOL.md v2.1): Document text, the
 * per-document version counter (+1 per DocumentEvent, never goes back), the EventLog, a 1:1 port
 * of Kotlin PatchApplier (isValid, lengthBefore, map: one event at a time, boundary contact
 * accepted), external changes, and one undo stack that restores the text (new events, new
 * versions). Used by the harness mock host (L2) and by the L1 sync simulation. Strings only, no DOM.
 */
import { type ChangeSet, ChangeSet as CS, Text } from '@codemirror/state';

import type { IncomingChange, Patch } from '../src/protocol';

/** EventLog.Entry: `oldLength` chars at `offset` were replaced by `newText`. */
export interface LogEntry {
  oldStamp: number;
  newStamp: number;
  offset: number;
  oldLength: number;
  newText: string;
}

interface UndoRecord {
  changes: ChangeSet;
  inverse: ChangeSet;
}

export interface ChangeOut {
  stamp: number;
  length: number;
  changes: IncomingChange[];
  selection?: { anchor: number; head: number };
}

const toText = (s: string): Text => Text.of(s.split('\n'));

/** Sequential changes (descending order) of a change set: each is relative to the text after the previous one. */
export function sequential(changes: ChangeSet): IncomingChange[] {
  const out: IncomingChange[] = [];
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => out.push({ from: fromA, to: toA, insert: inserted.toString() }));
  return out.reverse();
}

/** PatchApplier.isValid. */
export function isValid(patches: readonly Patch[], length: number): boolean {
  for (const [i, p] of patches.entries()) {
    if (p.start < 0 || p.end < p.start || p.end > length || p.text.includes('\r')) return false;
    const prev = patches[i - 1];
    if (prev && (prev.end > p.start || prev.start >= p.start)) return false;
  }
  return true;
}

/** PatchApplier.lengthBefore. */
export function lengthBefore(currentLength: number, events: readonly LogEntry[]): number {
  return currentLength - events.reduce((sum, e) => sum + e.newText.length - e.oldLength, 0);
}

/** PatchApplier.map: `patches` (relative to the text before `events`) moved over them, or null. */
export function mapPatches(patches: readonly Patch[], events: readonly LogEntry[]): Patch[] | null {
  let current = [...patches];
  for (const e of events) {
    const delta = e.newText.length - e.oldLength;
    const eventEnd = e.offset + e.oldLength;
    const next: Patch[] = [];
    for (const p of current) {
      if (e.oldLength === 0 && e.offset === p.start && p.start === p.end) return null;
      else if (eventEnd <= p.start) next.push({ ...p, start: p.start + delta, end: p.end + delta });
      else if (e.offset >= p.end) next.push(p);
      else return null;
    }
    current = next;
  }
  return current;
}

export class HostDoc {
  /** EventLog (MAX_ENTRIES 5000; a lookup past the oldest entry fails). */
  private log: LogEntry[] = [];
  private undoStack: UndoRecord[] = [];
  private redoStack: UndoRecord[] = [];
  /** Highest patch seq seen (the next flush uses lastSeq + 1). */
  lastSeq = 0;
  rejects = 0;
  mapped = 0;

  /** Document text as a rope: an edit costs O(log n), like the IDE Document. */
  private doc: Text;

  constructor(
    text: string,
    /** Version counter (PROTOCOL.md "Versions"). */
    public stamp: number,
  ) {
    this.doc = toText(text);
  }

  get text(): string {
    return this.doc.toString();
  }

  get length(): number {
    return this.doc.length;
  }

  /** One DocumentEvent: replace, version + 1, log entry. A no-op is not an event. */
  private event(offset: number, oldLength: number, newText: string): LogEntry | null {
    if (oldLength === 0 && newText === '') return null;
    this.doc = this.doc.replace(offset, offset + oldLength, toText(newText));
    const entry = { oldStamp: this.stamp, newStamp: this.stamp + 1, offset, oldLength, newText };
    this.stamp++;
    this.log.push(entry);
    if (this.log.length > 5000) this.log.shift();
    return entry;
  }

  /** Sequential changes as events; returns the logged entries as sequential changes. */
  private events(changes: readonly IncomingChange[]): IncomingChange[] {
    const out: IncomingChange[] = [];
    for (const c of changes) {
      const e = this.event(c.from, c.to - c.from, c.insert);
      if (e) out.push({ from: e.offset, to: e.offset + e.oldLength, insert: e.newText });
    }
    return out;
  }

  private undoable(changes: ChangeSet): void {
    this.undoStack.push({ changes, inverse: changes.invert(this.doc) });
    this.redoStack.length = 0;
  }

  /** EventLog.since. */
  private since(stamp: number): LogEntry[] | null {
    if (stamp === this.stamp) return [];
    let start = -1;
    for (let i = this.log.length - 1; i >= 0; i--) {
      if (this.log[i]?.oldStamp === stamp) {
        start = i;
        break;
      }
    }
    if (start < 0) return null;
    const result = this.log.slice(start);
    for (let i = 1; i < result.length; i++) if (result[i]?.oldStamp !== result[i - 1]?.newStamp) return null;
    return result[result.length - 1]?.newStamp === this.stamp ? result : null;
  }

  /** DocumentSync.apply + PatchApplier. Returns the ack stamp, or null for reject. */
  applyPatch(msg: { seq: number; baseStamp: number; patches: Patch[] }): number | null {
    this.lastSeq = Math.max(this.lastSeq, msg.seq);
    const events = this.since(msg.baseStamp);
    if (events === null) return this.reject();
    if (msg.patches.length === 0) return this.stamp;
    if (!isValid(msg.patches, lengthBefore(this.doc.length, events))) return this.reject();
    const mapped = mapPatches(msg.patches, events);
    if (mapped === null) return this.reject();
    if (events.length > 0) this.mapped++;
    // One write command (one undo step); patches in descending order, one event each.
    this.undoable(CS.of(mapped.map((p) => ({ from: p.start, to: p.end, insert: p.text })), this.doc.length, '\n'));
    for (const p of [...mapped].reverse()) this.event(p.start, p.end - p.start, p.text);
    return this.stamp;
  }

  private reject(): null {
    this.rejects++;
    return null;
  }

  /** An edit made in the IDE (sequential changes). */
  external(changes: IncomingChange[]): ChangeOut {
    let set = CS.empty(this.doc.length);
    for (const c of changes) set = set.compose(CS.of(c, set.newLength, '\n'));
    this.undoable(set);
    const out = this.events(changes);
    return { stamp: this.stamp, length: this.doc.length, changes: out };
  }

  private replay(rec: UndoRecord | undefined, changes: (r: UndoRecord) => ChangeSet, push: UndoRecord[]): ChangeOut | null {
    if (!rec) return null;
    const out = this.events(sequential(changes(rec)));
    push.push(rec);
    const last = out[out.length - 1];
    const head = last ? last.from + last.insert.length : 0;
    return { stamp: this.stamp, length: this.doc.length, changes: out, selection: { anchor: head, head } };
  }

  undo(): ChangeOut | null {
    return this.replay(this.undoStack.pop(), (r) => r.inverse, this.redoStack);
  }

  redo(): ChangeOut | null {
    return this.replay(this.redoStack.pop(), (r) => r.changes, this.undoStack);
  }
}
