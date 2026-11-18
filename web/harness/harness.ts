/*
 * L2 harness: mock IDE host for protocol v2 and window.__harness for Playwright.
 * Per document it holds the text + stamp (host-model.ts: PatchApplier, event log, undo stack),
 * applies patches after a configurable delay, injects external changes, runs undo/redo like
 * Kotlin (flush -> patch -> ack -> undo -> `change` with selection) and serves /doc/<id> through
 * the Playwright routing (`serve`). Defined before main.ts runs, so `ready` reaches it.
 */
import type { IncomingChange, PageMessage } from '../src/protocol';
import { HostDoc } from './host-model';

interface LogEntry {
  fn: string;
  msg: PageMessage;
  t: number;
}

interface Doc {
  host: HostDoc;
  /** Patches, in order. */
  chain: Promise<void>;
  /** Undo/redo commands, one at a time (the EDT runs them in order). */
  commands: Promise<void>;
  busy: number;
}

const log: LogEntry[] = [];
const docs = new Map<string, Doc>();
const flushWaiters = new Map<string, () => void>();
const options = {
  /** Patch transit + apply delay, ms: uniform in [min, max]. */
  ackDelay: [0, 0] as [number, number],
  /** Run undo/redo on `command undo|redo` like Kotlin. */
  autoUndo: true,
  /** After a reject, send `reload` like Kotlin. */
  reloadOnReject: true,
};

function toPage(msg: unknown): void {
  if (!window.markdone) throw new Error('window.markdone is not defined');
  window.markdone.receive(msg);
}

function docOf(docId: string): Doc {
  const d = docs.get(docId);
  if (!d) throw new Error(`harness: unknown document ${docId}`);
  return d;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * `pos`, moved back by one when it is between the two halves of a surrogate pair. Random test
 * edits must not split a pair: a lone surrogate does not survive the UTF-8 /doc response.
 */
function safePos(slice: (from: number, to: number) => string, pos: number): number {
  const two = pos > 0 ? slice(pos - 1, pos + 1) : '';
  return two.length === 2 && /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(two) ? pos - 1 : pos;
}

function onPatch(msg: Extract<PageMessage, { type: 'patch' }>): void {
  const d = docOf(msg.docId);
  const [min, max] = options.ackDelay;
  const delay = min + Math.random() * (max - min);
  d.busy++;
  d.chain = d.chain
    .then(() => sleep(delay))
    .then(() => {
      const stamp = d.host.applyPatch(msg);
      if (stamp === null) {
        toPage({ type: 'reject', docId: msg.docId, seq: msg.seq });
        if (options.reloadOnReject) toPage({ type: 'reload', docId: msg.docId });
      } else {
        toPage({ type: 'ack', docId: msg.docId, seq: msg.seq, stamp, length: d.host.length });
      }
      flushWaiters.get(`${msg.docId}:${msg.seq}`)?.();
    })
    .finally(() => d.busy--);
}

/** Kotlin's undo/redo: flush the page, wait for the patch, run the IDE undo, send the result. */
function undoRedo(docId: string, name: 'undo' | 'redo'): Promise<void> {
  const d = docOf(docId);
  d.busy++;
  d.commands = d.commands.then(() => runUndoRedo(d, docId, name)).finally(() => d.busy--);
  return d.commands;
}

async function runUndoRedo(d: Doc, docId: string, name: 'undo' | 'redo'): Promise<void> {
  const seq = d.host.lastSeq + 1;
  const key = `${docId}:${seq}`;
  const flushed = new Promise<void>((resolve) => flushWaiters.set(key, resolve));
  toPage({ type: 'flush', docId, seq });
  await flushed;
  flushWaiters.delete(key);
  const out = name === 'undo' ? d.host.undo() : d.host.redo();
  if (out) toPage({ type: 'change', docId, ...out });
}

function record(fn: string): (json: string) => void {
  return (json) => {
    const msg = JSON.parse(json) as PageMessage;
    log.push({ fn, msg, t: performance.now() });
    if (msg.type === 'patch') onPatch(msg);
    // Kotlin replies `reload` to `diverged`.
    if (msg.type === 'diverged') toPage({ type: 'reload', docId: msg.docId });
    if (msg.type === 'command' && options.autoUndo && (msg.name === 'undo' || msg.name === 'redo')) void undoRedo(msg.docId, msg.name);
  };
}

window.__markdoneHost = { ready: record('ready'), patch: record('patch'), link: record('link'), command: record('command') };

const { afterNextPaint, controller, view } = await import('../src/main');
const { forceParsing, syntaxTree, syntaxTreeAvailable } = await import('@codemirror/language');
const { EditorSelection } = await import('@codemirror/state');
const { EditorView } = await import('@codemirror/view');
const { resetStats, stats, tableField } = await import('../src/live-preview');
const { boundaryField, windowConfig, windowStats } = await import('../src/windowed/windowed-parser');
const { heavyStats } = await import('../src/heavy/cache');
const { scopedCss } = await import('../src/theme');

/** Syntax nodes (not Document) in the viewport: 0 = not parsed there, so not decorated. */
function viewportNodes(): number {
  let n = 0;
  syntaxTree(view.state).iterate({ from: view.viewport.from, to: view.viewport.to, enter: (x) => void (x.name !== 'Document' && n++) });
  return n;
}

/** Resolves with the first log entry after `from` that matches. */
function waitFor(from: number, match: (e: LogEntry) => boolean, timeoutMs = 60_000): Promise<LogEntry> {
  const t0 = performance.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const hit = log.slice(from).find(match);
      if (hit) resolve(hit);
      else if (performance.now() - t0 > timeoutMs) reject(new Error('harness: timeout'));
      else setTimeout(poll, 1);
    };
    poll();
  });
}

type EditOp =
  | { kind: 'insert'; from: number; text: string }
  | { kind: 'delete' | 'replace'; from: number; to: number; text: string }
  | { kind: 'multi'; ranges: [number, number][]; text: string }
  | { kind: 'select'; ranges: [number, number][] }
  | { kind: 'cursor'; from: number };

const harness = {
  options,
  safePos: (text: string, pos: number) => safePos((a, b) => text.slice(a, b), pos),
  log: () => log.slice(),
  clearLog: () => void (log.length = 0),
  /** /doc/<id> for the Playwright routing. */
  serve: (docId: string): { text: string; stamp: number } | null => {
    const d = docs.get(docId);
    return d ? { text: d.host.text, stamp: d.host.stamp } : null;
  },
  /** Like Kotlin: `open`, resolves with the reply (`opened` or `loadError`). */
  async open(docId: string, text: string, opts: { writable?: boolean; stamp?: number } = {}): Promise<PageMessage> {
    docs.set(docId, { host: new HostDoc(text.replace(/\r\n?/g, '\n'), opts.stamp ?? 0), chain: Promise.resolve(), commands: Promise.resolve(), busy: 0 });
    const from = log.length;
    toPage({ type: 'open', docId, writable: opts.writable ?? true });
    return (await waitFor(from, (e) => (e.msg.type === 'opened' || e.msg.type === 'loadError') && e.msg.docId === docId)).msg;
  },
  /** `activate`, resolves with ms from send to `activated`. */
  async activate(docId: string): Promise<number> {
    const from = log.length;
    const t0 = performance.now();
    toPage({ type: 'activate', docId });
    const e = await waitFor(from, (x) => x.msg.type === 'activated' && x.msg.docId === docId);
    return e.t - t0;
  },
  /** open + activate. */
  async load(docId: string, text: string, opts: { writable?: boolean } = {}): Promise<void> {
    await harness.open(docId, text, opts);
    await harness.activate(docId);
  },
  close(docId: string): void {
    toPage({ type: 'close', docId });
    docs.delete(docId);
  },
  send: (msg: unknown) => toPage(msg),
  /** An edit in the IDE (sequential changes), sent as `change`. */
  external(docId: string, changes: IncomingChange[], selection?: { anchor: number; head: number }): void {
    const out = docOf(docId).host.external(changes);
    toPage({ type: 'change', docId, ...out, ...(selection ? { selection } : {}) });
  },
  undo: (docId: string) => undoRedo(docId, 'undo'),
  redo: (docId: string) => undoRedo(docId, 'redo'),
  hostText: (docId: string) => docOf(docId).host.text,
  hostStamp: (docId: string) => docOf(docId).host.stamp,
  hostCounters: (docId: string) => ({ rejects: docOf(docId).host.rejects, mapped: docOf(docId).host.mapped }),
  docText: (docId: string) => controller.stateOf(docId)?.doc.toString() ?? null,
  syncState: (docId: string) => controller.syncState(docId),
  /** Resolves when the host and the page have nothing in flight for any document. */
  async settled(timeoutMs = 30_000): Promise<void> {
    const t0 = performance.now();
    let quiet = 0;
    while (quiet < 3) {
      const busy = [...docs.entries()].some(([id, d]) => d.busy > 0 || !(controller.syncState(id)?.idle ?? true));
      quiet = busy ? 0 : quiet + 1;
      if (performance.now() - t0 > timeoutMs) {
        const state = [...docs.entries()].map(([id, d]) => ({ id, busy: d.busy, lastSeq: d.host.lastSeq, page: controller.syncState(id), tail: log.slice(-6).map((e) => e.msg) }));
        throw new Error(`harness: not settled ${JSON.stringify(state)}`);
      }
      await sleep(busy ? 2 : 0);
    }
  },
  afterNextPaint,
  /* ---------- view helpers (active document) ---------- */
  selection: () => view.state.selection.ranges.map((r) => [r.anchor, r.head]),
  scrollTop: () => view.scrollDOM.scrollTop,
  /** Number of the first visible line. */
  topLine: () => view.state.doc.lineAt(view.lineBlockAtHeight(view.scrollDOM.getBoundingClientRect().top - view.documentTop).from).number,
  setScrollTop: (top: number) => void (view.scrollDOM.scrollTop = top),
  scrollTo(pos: number): void {
    view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
  },
  edit(op: EditOp): void {
    const len = view.state.doc.length;
    const clamp = (n: number) => safePos((a, b) => view.state.doc.sliceString(a, b), Math.max(0, Math.min(len, n)));
    switch (op.kind) {
      case 'insert':
        view.dispatch({ changes: { from: clamp(op.from), insert: op.text }, userEvent: 'input' });
        break;
      case 'delete':
      case 'replace': {
        const from = clamp(op.from);
        const to = clamp(op.to);
        view.dispatch({ changes: { from: Math.min(from, to), to: Math.max(from, to), insert: op.text }, userEvent: 'input' });
        break;
      }
      case 'multi': {
        // Several cursors/selections, then one replaceSelection (one transaction, several changes).
        const ranges = op.ranges.map(([a, b]) => EditorSelection.range(clamp(a), clamp(b)));
        view.dispatch({ selection: EditorSelection.create(ranges) });
        view.dispatch(view.state.replaceSelection(op.text));
        break;
      }
      case 'select':
        view.dispatch({ selection: EditorSelection.create(op.ranges.map(([a, b]) => EditorSelection.range(clamp(a), clamp(b)))) });
        view.focus();
        break;
      case 'cursor':
        view.dispatch({ selection: { anchor: clamp(op.from) } });
        view.focus();
        break;
    }
  },
  stats: () => ({ ...stats, tableWindow: view.state.field(tableField, false)?.win ?? null, tableWidgets: view.state.field(tableField, false)?.decos.size ?? 0 }),
  resetStats,
  forceViewport: () => forceParsing(view, view.viewport.to, 5000),
  /** Perf only: performance.now() after each view update with a doc change. */
  recordViewUpdates(): void {
    const times: number[] = [];
    (window as unknown as { __viewUpdates: number[] }).__viewUpdates = times;
    const update = view.update.bind(view);
    view.update = (trs) => {
      update(trs);
      if (trs.some((t) => t.docChanged)) times.push(performance.now());
    };
  },
  viewportNodes,
  /** Heavy blocks: render / cache / highlight counters and the lazy chunks loaded. */
  heavyStats: () => ({ ...heavyStats, chunks: heavyStats.chunks.slice() }),
  /** The filter applied to each Mermaid SVG <style>. */
  scopedCss,
  /** Windowed parse (src/windowed/): counters, and whether the boundary index is scanned to the end (idle prefetch done). */
  windowStats: () => ({ ...windowStats }),
  indexDone(): boolean {
    const idx = view.state.field(boundaryField, false);
    return !idx || idx.done || view.state.doc.length < windowConfig.minLength;
  },
  /**
   * Jump to the end: ms to the next frame, and ms until the viewport is parsed (decorated) and
   * painted. A window tree is "available" also where it has no nodes, so nodes are counted too.
   */
  async jumpToEnd(): Promise<{ frameMs: number; decoratedMs: number }> {
    const end = view.state.doc.length;
    const t0 = performance.now();
    view.dispatch({ selection: { anchor: end }, scrollIntoView: true });
    const frameMs = await new Promise<number>((r) => requestAnimationFrame(() => r(performance.now() - t0)));
    let decoratedMs = NaN;
    while (performance.now() < t0 + 120_000) {
      if (syntaxTreeAvailable(view.state, view.viewport.to) && syntaxTree(view.state).length >= view.viewport.to && viewportNodes() > 0) {
        await afterNextPaint();
        decoratedMs = performance.now() - t0;
        break;
      }
      await sleep(10);
    }
    return { frameMs, decoratedMs };
  },
  /** External change of one character: ms until the view is updated (DOM), and until the next frame. */
  async externalChange(docId: string, pos: number): Promise<{ processingMs: number; frameMs: number }> {
    const t0 = performance.now();
    harness.external(docId, [{ from: pos, to: pos, insert: 'e' }]);
    // `receive` -> one transaction -> EditorView.update: the DOM is updated synchronously.
    const processingMs = performance.now() - t0;
    await new Promise((r) => requestAnimationFrame(r));
    return { processingMs, frameMs: performance.now() - t0 };
  },
};

declare global {
  interface Window {
    __harness: typeof harness;
  }
}

window.__harness = harness;
