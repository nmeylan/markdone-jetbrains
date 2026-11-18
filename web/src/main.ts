/*
 * Page boot and bridge (protocol/PROTOCOL.md v2): one EditorView for many documents. Waits for
 * window.__markdoneHost, sends `ready`, then handles the IDE messages (controller.ts).
 */
import './style.css';

import { defaultKeymap } from '@codemirror/commands';
import { forceParsing, syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { search, searchKeymap } from '@codemirror/search';
import { EditorState, type Extension, type StateEffect, type Text } from '@codemirror/state';
import { EditorView, drawSelection, keymap } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

import { setPathRequester } from './paths';
import { Controller, type FetchResult, RESTORE_FRAMES, type ViewPort, lookRestoring, movesView } from './controller';
import { EditMode } from './edit-mode';
import { markdownLanguage } from './language';
import { drawioFileChanged, livePreview, posAtEvent, refresh, setDarkTheme, setRenderSettings, tableAtEvent, withCurrentSettings } from './live-preview';
import { type IdeMessage, PROTOCOL_VERSION, type PageMessage, hostFunction, validateIdeMessage } from './protocol';
import { applyUserCss, editorTheme } from './theme';

const bootMs = performance.now();

interface Host {
  ready(json: string): void;
  patch(json: string): void;
  link(json: string): void;
  command(json: string): void;
}

export interface MarkdoneApi {
  receive(msg: unknown): void;
  perf(docId?: string): Record<string, number>;
  __debug: {
    /** Local doc-changing transactions since `open` (IDE changes are not counted). */
    docChanges(docId: string): number;
    /** Same, without the ones within 1 s after a user input event. */
    nonUserDocChanges(docId: string): number;
    activeDocId(): string | null;
    docIds(): string[];
  };
}

declare global {
  interface Window {
    __markdoneHost?: Host;
    markdone?: MarkdoneApi;
  }
}

const MAX_JSON = { patch: 8 * 1024 * 1024, other: 4096 };
const pagePerf: Record<string, number> = { bootMs };

let host: Host | null = null;
const outbox: PageMessage[] = [];

function send(msg: PageMessage): void {
  const fn = hostFunction(msg);
  const json = JSON.stringify(msg);
  if (json.length > (fn === 'patch' ? MAX_JSON.patch : MAX_JSON.other)) {
    console.error(`markdone: ${msg.type} message too large (${json.length} chars), not sent`);
    return;
  }
  if (host) host[fn](json);
  else outbox.push(msg);
}

function onHost(): void {
  if (host || !window.__markdoneHost) return;
  host = window.__markdoneHost;
  pagePerf['readyMs'] = performance.now();
  host.ready(JSON.stringify({ type: 'ready', protocol: PROTOCOL_VERSION } satisfies PageMessage));
  for (const msg of outbox.splice(0)) send(msg);
}

let lastUserInput = Number.NEGATIVE_INFINITY;
const root = document.getElementById('app') as HTMLElement;
for (const type of ['beforeinput', 'keydown', 'paste', 'cut', 'drop', 'compositionend', 'mousedown']) {
  root.addEventListener(type, () => (lastUserInput = performance.now()), true);
}
/** Last wheel or touch scroll by the user (ends a look-change scroll restore). Ctrl/Cmd+wheel is zoom, not a scroll. */
let lastUserScroll = Number.NEGATIVE_INFINITY;
for (const type of ['wheel', 'touchstart']) {
  root.addEventListener(
    type,
    (event) => {
      if (!(event instanceof WheelEvent && (event.ctrlKey || event.metaKey))) lastUserScroll = performance.now();
    },
    { capture: true, passive: true },
  );
}

/* The rAF callback runs before the paint; a task posted from it runs after the paint. */
export function afterNextPaint(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve();
      channel.port2.postMessage(null);
    }),
  );
}

function linkKind(href: string): 'external' | 'relative' | 'anchor' {
  if (href.startsWith('#')) return 'anchor';
  return /^[a-z][a-z0-9+.-]*:/i.test(href) ? 'external' : 'relative';
}

/** href of the link at `pos`: `[text](url)`, `<url>`, or a bare GFM URL. */
function linkAt(state: EditorState, pos: number): string | null {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === 'Link' || n.name === 'Autolink') {
      const url = n.getChild('URL');
      return url ? state.doc.sliceString(url.from, url.to) : null;
    }
    if (n.name === 'URL' && n.parent?.name !== 'Image') return state.doc.sliceString(n.from, n.to);
  }
  return null;
}

const pageEvents = EditorView.domEventHandlers({
  /*
   * Ctrl/Cmd-click on a link sends `link` (the page has no <a> elements, so nothing navigates);
   * elsewhere `gotoSource` (the IDE switches to Source mode with the caret at `pos`).
   */
  mousedown(event, view) {
    if (event.button !== 0 || !(event.ctrlKey || event.metaKey)) return false;
    // File path in inline code (marked only when the file exists), also in a rendered table cell.
    const path = event.target instanceof Element ? event.target.closest<HTMLElement>('.md-path')?.dataset['path'] : undefined;
    if (path) {
      event.preventDefault();
      controller.link(path, 'relative');
      return true;
    }
    const pos = posAtEvent(view, event);
    if (pos === null) return false;
    event.preventDefault();
    const href = linkAt(view.state, pos);
    if (href === null) controller.command({ name: 'gotoSource', pos });
    else controller.link(href, linkKind(href));
    return true;
  },
  /* IDE-native context menu: no browser menu. `table` when the click is in a table. */
  contextmenu(event, view) {
    event.preventDefault();
    const { from, to } = view.state.selection.main;
    const table = tableAtEvent(view, event);
    controller.command({ name: 'contextMenu', x: Math.round(event.clientX), y: Math.round(event.clientY), from, to, ...(table ? { table } : {}) });
    return true;
  },
});

/** One IDE undo stack: no CodeMirror history; undo/redo go to the IDE. */
const undoKeymap = keymap.of([
  { key: 'Mod-z', run: () => (controller.command({ name: 'undo' }), true), preventDefault: true },
  { key: 'Mod-Shift-z', run: () => (controller.command({ name: 'redo' }), true), preventDefault: true },
  { key: 'Mod-y', run: () => (controller.command({ name: 'redo' }), true), preventDefault: true },
]);

/**
 * Zoom: requests only; the IDE changes its zoom setting and sends `theme` back. The page
 * never changes the CEF zoom level. Keys by `KeyboardEvent.key` (CodeMirror keymap): Mod-= and
 * Mod-+ zoom in, Mod-- zooms out, Mod-0 resets.
 */
const zoomKeymap = keymap.of([
  { key: 'Mod-=', run: () => (controller.command({ name: 'zoomIn' }), true), preventDefault: true },
  { key: 'Mod-+', run: () => (controller.command({ name: 'zoomIn' }), true), preventDefault: true },
  { key: 'Mod--', run: () => (controller.command({ name: 'zoomOut' }), true), preventDefault: true },
  { key: 'Mod-0', run: () => (controller.command({ name: 'zoomReset' }), true), preventDefault: true },
]);

/** At most one zoom command per this many ms from Ctrl/Cmd+wheel. */
const WHEEL_ZOOM_MS = 50;
/** Wheel distance (px) of one zoom step: a touchpad sends many small wheel events. */
const WHEEL_ZOOM_PX = 100;
/** Pixels of one wheel line (`deltaMode` 1, Chromium's value). */
const WHEEL_LINE_PX = 40;
let lastWheelZoom = Number.NEGATIVE_INFINITY;
/** Wheel distance in one direction (sign = direction) since the last zoom command. */
let wheelZoomPx = 0;
/* Ctrl/Cmd+wheel: a zoom request; the browser neither zooms nor scrolls. */
root.addEventListener(
  'wheel',
  (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    const px = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_LINE_PX : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? window.innerHeight : 1);
    if (px === 0) return;
    // A change of direction starts again from 0.
    wheelZoomPx = Math.sign(px) === Math.sign(wheelZoomPx) ? wheelZoomPx + px : px;
    const now = performance.now();
    if (Math.abs(wheelZoomPx) < WHEEL_ZOOM_PX || now - lastWheelZoom < WHEEL_ZOOM_MS) return;
    lastWheelZoom = now;
    wheelZoomPx = 0;
    controller.command({ name: px < 0 ? 'zoomIn' : 'zoomOut' });
  },
  { capture: true, passive: false },
);

const editMode = new EditMode(
  () => view,
  (command) => controller.command(command),
  posAtEvent,
);

/** Extensions of every document state. */
const extensions: Extension = [
  // Keep `\r` and every other character: doc.toString() must equal the IDE text.
  EditorState.lineSeparator.of('\n'),
  EditorState.allowMultipleSelections.of(true),
  // Ctrl/Cmd-click goes to the source; Alt-click adds a cursor.
  EditorView.clickAddsSelectionRange.of((event) => event.altKey),
  drawSelection(),
  undoKeymap,
  zoomKeymap,
  keymap.of([...searchKeymap, ...defaultKeymap]),
  search({ top: true }),
  markdownLanguage.extension,
  livePreview((command) => controller.command(command)),
  editorTheme,
  EditorView.lineWrapping,
  pageEvents,
  editMode.extension,
];

/** Characters parsed after a restored scroll position (some screens of text). */
const PREPARE_MARGIN = 20_000;

const port: ViewPort = {
  get state() {
    return view.state;
  },
  setState(state) {
    // A look-change restore belongs to the old state; a state built with older render settings is rebuilt first.
    lookRestore = null;
    view.setState(editMode.prepare(withCurrentSettings(state)));
  },
  dispatch: (spec) => view.dispatch(spec),
  scrollSnapshot: () => ({ effect: view.scrollSnapshot(), pos: view.lineBlockAtHeight(view.scrollDOM.getBoundingClientRect().top - view.documentTop).from }),
  topLine: () => view.state.doc.lineAt(view.lineBlockAtHeight(view.scrollDOM.getBoundingClientRect().top - view.documentTop).from).number,
  topPos: () => view.lineBlockAtHeight(view.scrollDOM.getBoundingClientRect().top - view.documentTop).from,
  scrollToLine(line) {
    const { doc } = view.state;
    view.dispatch({ effects: EditorView.scrollIntoView(doc.line(Math.max(1, Math.min(line, doc.lines))).from, { y: 'start', yMargin: 0 }) });
  },
  prepare(upTo) {
    // Parse up to the end of the viewport, or the restore target plus a margin (never the whole document), in a bounded slice.
    const to = Math.min(view.state.doc.length, Math.max(view.viewport.to, upTo === undefined ? 0 : upTo + PREPARE_MARGIN));
    if (!syntaxTreeAvailable(view.state, to)) forceParsing(view, to, upTo === undefined ? 20 : 40);
  },
  contentHeight: () => view.contentHeight,
  afterPaint: afterNextPaint,
};

async function fetchDoc(docId: string): Promise<FetchResult> {
  const response = await fetch(`/doc/${encodeURIComponent(docId)}`);
  if (!response.ok) return { ok: false, reason: 'fetch' };
  const header = response.headers.get('X-Markdone-Stamp');
  const stamp = header !== null && /^-?\d+$/.test(header.trim()) ? Number(header) : NaN;
  if (!Number.isSafeInteger(stamp)) return { ok: false, reason: 'stamp' };
  // Not response.text(): it strips a leading U+FEFF, and offsets must match the Document.
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await response.arrayBuffer());
  return { ok: true, text, stamp };
}

const controller = new Controller({
  view: port,
  send,
  fetchDoc,
  extensions,
  schedule: (cb) => queueMicrotask(cb),
  delay: (cb, ms) => void setTimeout(cb, ms),
  now: () => performance.now(),
  lastUserInput: () => lastUserInput,
});

setPathRequester((docId, paths) => controller.command({ name: 'pathsExist', paths }, docId));

export { controller };

export const view = new EditorView({
  state: EditorState.create({ extensions: [EditorState.readOnly.of(true), EditorView.editable.of(false)] }),
  parent: root,
  dispatchTransactions(trs, v) {
    v.update(trs);
    controller.afterUpdate(trs);
    if (trs.some((tr) => !tr.annotation(lookRestoring) && movesView(tr))) {
      viewMoves++;
      lookRestore = null;
    }
  },
});

// Protocol 2.4: a scroll of the active document sends a (throttled) `viewport`.
view.scrollDOM.addEventListener('scroll', () => controller.viewChanged(), { passive: true });

/** A look-change scroll restore in progress: its snapshot, and the document it belongs to. */
let lookRestore: { snapshot: StateEffect<unknown>; doc: Text; frames: number } | null = null;
/**
 * A change of the page look (`css`, `theme`, `settings`): applied in a measure write phase, so it
 * must not dispatch. Returns true when the decorations must be rebuilt (`refresh`).
 */
type LookChange = () => boolean;
/** The latest change per message type that waits for the snapshot (measure read phase). */
const pendingLook = new Map<IdeMessage['type'], LookChange>();
const LOOK_SNAPSHOT = {};
/** Transactions that edited, moved the selection or scrolled into view (`movesView`); the value when the first pending change came. */
let viewMoves = 0;
let lookQueuedAt = 0;

/**
 * Applies a change of the page look and keeps the first visible line (also for `theme` and `settings`).
 *
 * Fonts, sizes, widths and rendered or not rendered constructs change line heights. The first
 * visible line is kept with a scroll snapshot: CodeMirror's own scroll anchoring is not enough
 * when it estimates heights without a short plain-text line in the viewport (code lines carry
 * highlight marks. The snapshot is taken in a measure read phase (heights measured:
 * right after a window, table or highlight update they can be estimates for one frame). The
 * change is applied in the write phase, then the snapshot is applied again after each frame while
 * the content height changes (at most RESTORE_FRAMES frames), as in `Controller.activate`. User
 * input, a selection change, a scroll into view or an edit ends it; one of these between the
 * message and the snapshot cancels it (the snapshot would be old). A change during a restore keeps
 * the first snapshot.
 */
function changeLook(type: IdeMessage['type'], change: LookChange): void {
  // A restore that belongs to another document is dropped (its snapshot has positions of that document).
  if (lookRestore && lookRestore.doc !== view.state.doc) lookRestore = null;
  if (lookRestore) {
    const rebuild = change();
    lookRestore.frames = 0;
    view.dispatch({ effects: rebuild ? [refresh.of(null), lookRestore.snapshot] : lookRestore.snapshot, annotations: lookRestoring.of(true) });
    return;
  }
  if (pendingLook.size === 0) lookQueuedAt = viewMoves;
  pendingLook.set(type, change);
  view.requestMeasure({
    key: LOOK_SNAPSHOT,
    read: (v) => v.scrollSnapshot(),
    write: (snapshot, v) => {
      if (pendingLook.size === 0) return;
      let rebuild = false;
      for (const c of pendingLook.values()) rebuild = c() || rebuild;
      pendingLook.clear();
      // A scroll into view, an edit or a selection change since the change came: the snapshot is old, CodeMirror's target wins.
      const restore = viewMoves === lookQueuedAt ? (lookRestore = { snapshot, doc: v.state.doc, frames: 0 }) : null;
      queueMicrotask(() => {
        if (rebuild) view.dispatch({ effects: refresh.of(null), annotations: lookRestoring.of(true) });
        if (restore) void restoreScroll(restore);
      });
    },
  });
}

async function restoreScroll(r: NonNullable<typeof lookRestore>): Promise<void> {
  const start = performance.now();
  let height = -1;
  while (lookRestore === r && r.frames < RESTORE_FRAMES && view.state.doc === r.doc && lastUserInput < start && lastUserScroll < start) {
    const now = view.contentHeight;
    if (r.frames > 0 && now === height) break;
    height = now;
    r.frames++;
    view.dispatch({ effects: r.snapshot, annotations: lookRestoring.of(true) });
    await afterNextPaint();
  }
  if (lookRestore === r) lookRestore = null;
}

/*
 * `theme`: IDE font and size go to `--md-ide-*`; the built-in theme (layer `theme`) derives
 * `--md-font-body` and `--md-font-size` from them, so user CSS (layer `user`) can still override
 * both. The size is `fontSizePx * zoom` (the plugin zoom, never the CEF zoom level).
 */
function applyTheme(msg: Extract<IdeMessage, { type: 'theme' }>): void {
  changeLook('theme', () => {
    const html = document.documentElement;
    html.dataset['ideTheme'] = msg.dark ? 'dark' : 'light';
    html.style.setProperty('--md-ide-font', `${JSON.stringify(msg.fontFamily)}, system-ui, sans-serif`);
    html.style.setProperty('--md-ide-font-size', `${msg.fontSizePx * msg.zoom}px`);
    return setDarkTheme(msg.dark);
  });
}

/**
 * `css`: replace the user CSS; no state change. `cssSwapMs` = receive -> the frame in which the
 * new CSS is applied and measured.
 */
function applyCss(msg: Extract<IdeMessage, { type: 'css' }>): void {
  const t0 = performance.now();
  changeLook('css', () => {
    applyUserCss(msg.global, msg.project);
    // A further measure in this frame: CodeMirror keeps its anchor line on the new heights.
    view.requestMeasure({ read: () => void (pagePerf['cssSwapMs'] = performance.now() - t0) });
    return false;
  });
}

/** Render settings changed by a `settings` message whose look change still waits (the decorations need a `refresh`). */
let renderSettingsChanged = false;

/**
 * `settings` (2.3): remote images, feature toggles, built-in style (`<html data-md-style>`). Remote
 * images and the toggles apply at once, so no state drawn after the message uses the old values
 * (a widget of a feature that is off would load its chunk); the style and the rebuild of the
 * visible decorations go through the look change (next frame, scroll kept).
 */
function applySettings(msg: Extract<IdeMessage, { type: 'settings' }>): void {
  renderSettingsChanged = setRenderSettings(msg) || renderSettingsChanged;
  editMode.apply(msg);
  changeLook('settings', () => {
    document.documentElement.dataset['mdStyle'] = msg.style;
    document.documentElement.dataset['mdColorTheme'] = msg.colorTheme;
    const rebuild = renderSettingsChanged;
    renderSettingsChanged = false;
    return rebuild;
  });
}

/**
 * `fileChanged` (2.7): a draw.io file changed. The version of the file goes up at once (a widget built later
 * fetches it again); the visible widgets are rebuilt through the look change (next frame, scroll kept).
 */
function applyFileChanged(msg: Extract<IdeMessage, { type: 'fileChanged' }>): void {
  if (drawioFileChanged(msg.docId, msg.path)) changeLook('fileChanged', () => true);
}

function receive(raw: unknown): void {
  const msg = validateIdeMessage(raw);
  if (!msg) {
    console.warn('markdone: invalid message ignored', raw);
    return;
  }
  switch (msg.type) {
    case 'theme':
      applyTheme(msg);
      break;
    case 'css':
      applyCss(msg);
      break;
    case 'settings':
      applySettings(msg);
      break;
    case 'fileChanged':
      applyFileChanged(msg);
      break;
    default:
      controller.receive(msg);
  }
}

window.markdone = {
  receive,
  perf: (docId) => (docId === undefined ? { ...pagePerf } : controller.perf(docId)),
  __debug: {
    docChanges: (docId) => controller.docChanges(docId),
    nonUserDocChanges: (docId) => controller.nonUserDocChanges(docId),
    activeDocId: () => controller.activeDocId(),
    docIds: () => controller.docIds(),
  },
};

applyUserCss('', null);
document.documentElement.dataset['mdStyle'] = 'default';
document.documentElement.dataset['mdColorTheme'] = 'ide';
window.addEventListener('markdone-host', onHost);
onHost();
