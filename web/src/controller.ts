/*
 * Documents of the page (PROTOCOL.md v2.1): one EditorView, one EditorState per open
 * document. Handles the per-document IDE messages; no DOM access (the view is behind `ViewPort`),
 * so the L4 fixture replay runs it in Node.
 */
import {
  Annotation,
  type ChangeSpec,
  Compartment,
  EditorSelection,
  EditorState,
  type Extension,
  Facet,
  type StateEffect,
  type Transaction,
  type TransactionSpec,
} from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import type { Command, DocMessage, IdeMessage, PageMessage } from './protocol';
import { Outbox } from './sync';
import { windowConfig } from './windowed/windowed-parser';

/** docId of the document a state belongs to (image URLs: `/file/<docId>/…`). */
export const docIdFacet = Facet.define<string, string>({ combine: (values) => values[0] ?? '' });

/** Transactions that apply IDE changes: never sent back as a patch. */
export const remote = Annotation.define<boolean>();

export interface ViewPort {
  readonly state: EditorState;
  setState(state: EditorState): void;
  /** Dispatches a transaction; the view calls `Controller.afterUpdate` after the update. */
  dispatch(spec: TransactionSpec): void;
  /** Effect that restores the current scroll position (position based), and its target position. */
  scrollSnapshot(): ScrollRestore;
  /** Number of the first visible line. */
  topLine(): number;
  /** Offset of the start of the first visible line (protocol 2.4 `viewport`). */
  topPos(): number;
  /** Scrolls so that line `line` (clamped) is at the top. */
  scrollToLine(line: number): void;
  /** Called after a state swap: parse the visible part (and up to `upTo` plus a margin) now, in a time budget. */
  prepare(upTo?: number): void;
  /** Height of the document content in pixels. */
  contentHeight(): number;
  /** Resolves in a task posted from the next animation frame (after the paint). */
  afterPaint(): Promise<void>;
}

/** A scroll position to restore: the effect, and the document position it scrolls to. */
export interface ScrollRestore {
  effect: StateEffect<unknown>;
  pos: number;
}

/** Re-applications of a restored scroll position while measured heights still change (one per frame). */
export const RESTORE_FRAMES = 5;

/** At most one `viewport` per this many ms after a scroll (protocol 2.4). */
export const VIEWPORT_MS = 100;

/** Transactions of the activation scroll restore itself. */
const restoring = Annotation.define<boolean>();
/** Transactions of the look-change scroll restore (`css`, `theme`, `settings`; main.ts). */
export const lookRestoring = Annotation.define<boolean>();

/** Prototype of CodeMirror's scroll target (the value of a `scrollIntoView` effect). */
const SCROLL_TARGET = Object.getPrototypeOf(EditorView.scrollIntoView(0).value) as object;

/** True when `tr` edits, moves the selection or scrolls into view (this ends a scroll restore). */
export function movesView(tr: Transaction): boolean {
  return tr.docChanged || !!tr.selection || tr.scrollIntoView || tr.effects.some((e) => e.value != null && Object.getPrototypeOf(e.value) === SCROLL_TARGET);
}

export type FetchResult = { ok: true; text: string; stamp: number } | { ok: false; reason: 'fetch' | 'stamp' };

export interface Env {
  view: ViewPort;
  send(msg: PageMessage): void;
  fetchDoc(docId: string): Promise<FetchResult>;
  /** Extensions of every document state. */
  extensions: Extension;
  /** Runs `cb` after the current transaction (a microtask in the page). */
  schedule(cb: () => void): void;
  /** Runs `cb` after `ms` milliseconds (a timer in the page). */
  delay(cb: () => void, ms: number): void;
  now(): number;
  /** Time of the last user input event (for `nonUserDocChanges`). */
  lastUserInput(): number;
}

interface Entry {
  id: string;
  /** The document state; stale while the document is active (the view holds it). */
  state: EditorState;
  outbox: Outbox;
  writable: boolean;
  /** Scroll position to restore on activate. */
  scroll: ScrollRestore | null;
  scheduled: boolean;
  /** Time of the last patch sent (coalescing). */
  lastSend: number;
  /** Read-only for the page: `reload` fetch in progress, or `diverged` sent (until `opened`). */
  locked: boolean;
  docChanges: number;
  nonUserDocChanges: number;
  perf: Record<string, number>;
}

const USER_INPUT_WINDOW_MS = 1000;
/*
 * A document of `windowConfig.minLength` (2 MB) or more sends at most one patch per
 * COALESCE_MS; local changes in between are composed into it. Each IDE write of such a document
 * waits for the platform's full Markdown reparse, so fewer writes keep the EDT free. A `flush`
 * (undo/redo, mode switch, context menu; close and save flush (Kotlin)) is answered at once.
 */
const COALESCE_MS = 300;
const writableCompartment = new Compartment();
const readOnly = [EditorState.readOnly.of(true), EditorView.editable.of(false)];
const lockCompartment = new Compartment();
/** Locked: read-only, and no local change gets through (only IDE changes). */
const locked = [readOnly, EditorState.changeFilter.of((tr) => tr.annotation(remote) === true)];

/**
 * PROTOCOL.md "Text normalization": `\r\n` and `\r` in pasted, dropped or typed text become `\n`
 * before they are a change, so a patch never contains `\r`. IDE changes are not touched.
 */
export const normalizeInput: Extension = [
  EditorView.clipboardInputFilter.of((text) => text.replace(/\r\n?/g, '\n')),
  EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || tr.annotation(remote)) return tr;
    const fix: ChangeSpec[] = [];
    tr.changes.iterChanges((_fromA, _toA, fromB, _toB, inserted) => {
      const text = inserted.toString();
      for (let i = text.indexOf('\r'); i >= 0; i = text.indexOf('\r', i + 1)) {
        const pos = fromB + i;
        fix.push(text[i + 1] === '\n' ? { from: pos, to: pos + 1 } : { from: pos, to: pos + 1, insert: '\n' });
      }
    });
    return fix.length ? [tr, { changes: fix, sequential: true }] : tr;
  }),
];

export class Controller {
  private readonly docs = new Map<string, Entry>();
  /** Documents being fetched (`open`, `reload`), with the messages that arrived meanwhile. */
  private readonly loads = new Map<string, DocMessage[]>();
  private active: string | null = null;
  /** Activation counter: a newer activation stops the restore loop of an older one. */
  private activations = 0;
  /** Scroll restore that still runs (its activation and target position); any other scroll, selection or edit ends it. */
  private restoreRun: { activation: number; pos: number } | null = null;
  /** A throttled `viewport` waits for its timer. */
  private viewportScheduled = false;
  private lastViewport = Number.NEGATIVE_INFINITY;

  constructor(private readonly env: Env) {}

  activeDocId(): string | null {
    return this.active;
  }

  docIds(): string[] {
    return [...this.docs.keys()];
  }

  /** Current state of a document (the view state when active). */
  stateOf(docId: string): EditorState | null {
    const entry = this.docs.get(docId);
    return entry ? this.current(entry) : null;
  }

  perf(docId: string): Record<string, number> {
    return { ...(this.docs.get(docId)?.perf ?? {}) };
  }

  docChanges(docId: string): number {
    return this.docs.get(docId)?.docChanges ?? 0;
  }

  nonUserDocChanges(docId: string): number {
    return this.docs.get(docId)?.nonUserDocChanges ?? 0;
  }

  /** Sync state of a document (tests). */
  syncState(docId: string): { idle: boolean; locked: boolean; loading: boolean; scheduled: boolean; rejected: boolean; baseStamp: number } | null {
    const entry = this.docs.get(docId);
    if (!entry) return null;
    return {
      idle: entry.outbox.idle() && !entry.scheduled && !this.loads.has(docId),
      locked: entry.locked,
      loading: this.loads.has(docId),
      scheduled: entry.scheduled,
      rejected: entry.outbox.rejected !== null,
      baseStamp: entry.outbox.baseStamp,
    };
  }

  /** `command` for the active document (keymap, context menu). */
  command(msg: Command, docId = this.active): void {
    if (docId === null) return;
    this.env.send({ type: 'command', docId, ...msg } as PageMessage);
  }

  link(href: string, kind: 'external' | 'relative' | 'anchor'): void {
    if (this.active === null) return;
    this.env.send({ type: 'link', docId: this.active, href, kind });
  }

  /** The view scrolled: a `viewport` of the active document, at most one per VIEWPORT_MS. */
  viewChanged(): void {
    if (this.active === null || this.viewportScheduled) return;
    this.viewportScheduled = true;
    this.env.delay(
      () => {
        this.viewportScheduled = false;
        this.sendViewport();
      },
      Math.max(0, this.lastViewport + VIEWPORT_MS - this.env.now()),
    );
  }

  private sendViewport(): void {
    const docId = this.active;
    if (docId === null) return;
    this.lastViewport = this.env.now();
    const { anchor, head } = this.env.view.state.selection.main;
    // During a scroll restore the view can still show the old place: send the target.
    const top = this.restoreRun ? this.restoreRun.pos : this.env.view.topPos();
    this.env.send({ type: 'viewport', docId, top, anchor, head });
  }

  /** Called by the view after each update: local document changes go to the outbox. */
  afterUpdate(trs: readonly Transaction[]): void {
    const entry = this.active === null ? undefined : this.docs.get(this.active);
    if (!entry) return;
    // The look-change restore keeps the same first line, so it does not end the activation restore.
    if (this.restoreRun !== null && trs.some((tr) => !tr.annotation(restoring) && !tr.annotation(lookRestoring) && movesView(tr))) {
      this.restoreRun = null;
    }
    let changed = false;
    for (const tr of trs) {
      if (!tr.docChanged || tr.annotation(remote)) continue;
      entry.outbox.local(tr.changes);
      entry.docChanges++;
      if (this.env.now() - this.env.lastUserInput() > USER_INPUT_WINDOW_MS) entry.nonUserDocChanges++;
      changed = true;
    }
    if (changed) this.schedule(entry);
  }

  receive(msg: DocMessage): void {
    const queued = this.loads.get(msg.docId);
    if (queued) {
      queued.push(msg);
      return;
    }
    if (msg.type === 'open') {
      if (this.docs.has(msg.docId)) console.warn(`markdone: open of an open document ${msg.docId} ignored`);
      else void this.load(msg.docId, msg.writable);
      return;
    }
    const entry = this.docs.get(msg.docId);
    if (!entry) {
      console.warn(`markdone: "${msg.type}" for an unknown document ${msg.docId} ignored`);
      return;
    }
    switch (msg.type) {
      case 'reload':
        void this.load(msg.docId, entry.writable);
        break;
      case 'activate':
        void this.activate(entry, msg.top, msg.selection);
        break;
      case 'close':
        this.close(entry);
        break;
      case 'change':
        this.change(entry, msg);
        break;
      case 'ack':
        if (entry.outbox.ack(msg.seq, msg.stamp)) {
          if (!entry.outbox.pending) this.checkLength(entry, msg.length, entry.outbox.hostLength(this.current(entry).doc.length));
          // A waiting flush reply goes at once; other pending changes keep the pace.
          if (entry.outbox.flushSeq === null && entry.outbox.pending) this.schedule(entry);
          else this.sendNow(entry);
        } else {
          console.warn(`markdone: ack of an unknown seq ${msg.seq} ignored`);
        }
        break;
      case 'reject':
        if (entry.outbox.reject(msg.seq)) {
          console.warn(`markdone: patch ${msg.seq} rejected; waiting for reload`);
          this.sendNow(entry);
        }
        break;
      case 'flush':
        entry.outbox.flush(msg.seq);
        this.sendNow(entry);
        break;
      case 'writable':
        entry.writable = msg.writable;
        this.apply(entry, { effects: writableCompartment.reconfigure(msg.writable ? [] : readOnly) });
        break;
    }
  }

  private current(entry: Entry): EditorState {
    return this.active === entry.id ? this.env.view.state : entry.state;
  }

  private createState(docId: string, text: string, writable: boolean, selection?: EditorSelection): EditorState {
    return EditorState.create({
      doc: text,
      selection,
      extensions: [docIdFacet.of(docId), this.env.extensions, normalizeInput, writableCompartment.of(writable ? [] : readOnly), lockCompartment.of([])],
    });
  }

  private lock(entry: Entry, on: boolean): void {
    if (entry.locked === on) return;
    entry.locked = on;
    this.apply(entry, { effects: lockCompartment.reconfigure(on ? locked : []) });
  }

  /** PROTOCOL.md "Length check": on a mismatch, `diverged` and read-only until `opened`. */
  private checkLength(entry: Entry, expectedLength: number, pageLength: number): void {
    if (pageLength === expectedLength || entry.outbox.halted) return;
    console.error(`markdone: document ${entry.id} diverged (page ${pageLength}, IDE ${expectedLength} chars)`);
    entry.outbox.halted = true;
    this.lock(entry, true);
    this.env.send({ type: 'diverged', docId: entry.id, pageLength, expectedLength });
  }

  /** `open` (new entry) or `reload` (existing entry): fetch /doc/<id>, create the state, reply `opened`. */
  private async load(docId: string, writable: boolean): Promise<void> {
    const { env } = this;
    const t0 = env.now();
    this.loads.set(docId, []);
    // reload: no local edit during the fetch (it would be lost with the old text).
    const reloading = this.docs.get(docId);
    if (reloading) this.lock(reloading, true);
    let result: FetchResult;
    try {
      result = await env.fetchDoc(docId);
    } catch {
      result = { ok: false, reason: 'fetch' };
    }
    const t1 = env.now();
    let stamp = Number.NaN;
    if (result.ok) {
      stamp = result.stamp;
      const old = this.docs.get(docId);
      if (old) {
        // reload: replace the text, keep the selection (clamped) and the scroll position.
        const len = result.text.length;
        const sel = this.current(old).selection;
        const clamped = EditorSelection.create(
          sel.ranges.map((r) => EditorSelection.range(Math.min(r.anchor, len), Math.min(r.head, len))),
          sel.mainIndex,
        );
        const state = this.createState(docId, result.text, old.writable, clamped);
        old.outbox.reset(stamp);
        old.scheduled = false;
        old.locked = false;
        old.perf['docFetchMs'] = t1 - t0;
        old.perf['stateMs'] = env.now() - t1;
        if (this.active === docId) {
          const top = env.view.topLine();
          env.view.setState(state);
          env.view.scrollToLine(top);
          env.view.prepare();
        } else {
          old.state = state;
          old.scroll = null;
        }
      } else {
        const state = this.createState(docId, result.text, writable);
        const entry: Entry = {
          id: docId,
          state,
          outbox: new Outbox(stamp),
          writable,
          scroll: null,
          scheduled: false,
          lastSend: Number.NEGATIVE_INFINITY,
          locked: false,
          docChanges: 0,
          nonUserDocChanges: 0,
          perf: { docFetchMs: t1 - t0, stateMs: env.now() - t1 },
        };
        this.docs.set(docId, entry);
      }
      const entry = this.docs.get(docId);
      if (entry) entry.perf['openTotalMs'] = env.now() - t0;
      env.send({ type: 'opened', docId, docStamp: stamp });
    } else {
      env.send({ type: 'loadError', docId, reason: result.reason });
    }
    const queued = this.loads.get(docId) ?? [];
    this.loads.delete(docId);
    for (const msg of queued) {
      // Changes up to the stamp of the fetched text are already in it.
      if (msg.type === 'change' && msg.stamp <= stamp) continue;
      this.receive(msg);
    }
  }

  /**
   * Shows `target` (tab switch: its saved scroll position). Mode switch Source -> Edit (protocol 2.4):
   * the line of `top` at the top instead, and `selection`; values outside the document are clamped.
   */
  private async activate(target: Entry, top?: number, selection?: { anchor: number; head: number }): Promise<void> {
    const { view } = this.env;
    const t0 = this.env.now();
    let restore: ScrollRestore | null = null;
    const switching = this.active !== target.id;
    if (switching) {
      const prev = this.active === null ? undefined : this.docs.get(this.active);
      if (prev) {
        prev.state = view.state;
        prev.scroll = view.scrollSnapshot();
      }
      view.setState(target.state);
      this.active = target.id;
      restore = target.scroll;
    }
    if (top !== undefined) {
      const { doc } = view.state;
      const from = doc.lineAt(Math.min(top, doc.length)).from;
      restore = { effect: EditorView.scrollIntoView(from, { y: 'start', yMargin: 0 }), pos: from };
    }
    let activation: number | undefined;
    if (switching || top !== undefined) {
      // Parse up to the restored position first: decorations there must not appear a frame later.
      view.prepare(restore?.pos);
      activation = ++this.activations;
      this.restoreRun = restore ? { activation, pos: restore.pos } : null;
    }
    const length = view.state.doc.length;
    const range = selection && EditorSelection.single(Math.min(selection.anchor, length), Math.min(selection.head, length));
    if (restore || range) {
      view.dispatch({ ...(range ? { selection: range } : {}), ...(restore ? { effects: restore.effect } : {}), annotations: restoring.of(true) });
    }
    let height = view.contentHeight();
    await view.afterPaint();
    target.perf['activateMs'] = this.env.now() - t0;
    this.env.send({ type: 'activated', docId: target.id });
    /*
     * Widget and image heights measured in a frame can move the restored position (lines above it
     * were estimated): apply the snapshot again, on measured heights, until a frame does not change
     * the content height (at most RESTORE_FRAMES frames).
     */
    for (let i = 0; restore && i < RESTORE_FRAMES && this.restoreRun?.activation === activation && this.active === target.id; i++) {
      const now = view.contentHeight();
      if (i > 0 && now === height) break;
      height = now;
      view.dispatch({ effects: restore.effect, annotations: restoring.of(true) });
      await view.afterPaint();
    }
    if (activation !== undefined && this.restoreRun?.activation === activation) this.restoreRun = null;
  }

  private close(entry: Entry): void {
    this.docs.delete(entry.id);
    if (this.active === entry.id) {
      this.active = null;
      this.env.view.setState(EditorState.create({ extensions: readOnly }));
    }
  }

  private change(entry: Entry, msg: Extract<IdeMessage, { type: 'change' }>): void {
    const doc = this.current(entry).doc;
    let changes;
    try {
      changes = entry.outbox.incoming(doc.length, msg.changes, msg.stamp);
    } catch (e) {
      console.error(`markdone: change does not fit the document ${entry.id}`, e);
      return;
    }
    const spec: TransactionSpec = { changes, annotations: remote.of(true) };
    let head = -1;
    if (msg.selection) {
      const len = changes.newLength;
      const anchor = Math.min(len, entry.outbox.mapHostPos(msg.selection.anchor));
      head = Math.min(len, entry.outbox.mapHostPos(msg.selection.head));
      spec.selection = EditorSelection.single(anchor, head);
      spec.scrollIntoView = true;
    }
    if (this.active === entry.id) {
      this.env.view.dispatch(spec);
    } else {
      entry.state = entry.state.update(spec).state;
      if (head >= 0) entry.scroll = { effect: EditorView.scrollIntoView(head, { y: 'center' }), pos: head };
      else if (entry.scroll) {
        const effect = entry.scroll.effect.map(changes);
        entry.scroll = effect ? { ...entry.scroll, effect, pos: changes.mapPos(entry.scroll.pos) } : null;
      }
    }
    this.checkLength(entry, msg.length, entry.outbox.hostLength(changes.newLength));
  }

  /** Applies a non-document transaction to a document (view when active). */
  private apply(entry: Entry, spec: TransactionSpec): void {
    if (this.active === entry.id) this.env.view.dispatch(spec);
    else entry.state = entry.state.update(spec).state;
  }

  private schedule(entry: Entry): void {
    if (entry.scheduled) return;
    entry.scheduled = true;
    const run = () => {
      entry.scheduled = false;
      if (this.docs.get(entry.id) === entry) this.sendNow(entry);
    };
    const wait = this.current(entry).doc.length >= windowConfig.minLength ? entry.lastSend + COALESCE_MS - this.env.now() : 0;
    if (wait > 0) this.env.delay(run, wait);
    else this.env.schedule(run);
  }

  private sendNow(entry: Entry): void {
    // Protocol 2.4: the IDE gets the latest viewport just before the flush reply (Edit -> Source).
    if (entry.outbox.flushSeq !== null && entry.outbox.ready() && this.active === entry.id) this.sendViewport();
    const out = entry.outbox.take(this.current(entry).doc.length);
    if (!out) return;
    entry.lastSend = this.env.now();
    this.env.send({ type: 'patch', docId: entry.id, ...out });
  }
}
