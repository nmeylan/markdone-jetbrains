/*
 * draw.io diagrams (nmey/DRAWIO.md §4.3). Lazy chunk: imported when the first draw.io widget is drawn.
 * The page never runs draw.io code and never puts diagram content into its own DOM: it fetches the file,
 * selects the page, and posts the XML to a sandboxed frame (src/drawio-frame/); the frame answers with its
 * height or an error. Errors are shown with `textContent` only.
 *
 * - Data: `fetch(/drawio/<docId>/<path>)`, page selection (`selectPage`), LRU cache of the selected XML per
 *   (docId, path, page, file version).
 * - Frames: at most one frame loads the viewer at a time, in an idle callback (the 9 MB viewer parses on the
 *   renderer's main thread); jobs whose widget left the DOM are dropped. At most MAX_FRAMES live frames: a
 *   widget beyond that shows a placeholder until a frame is released (`releaseDrawio`).
 * - Messages from a frame count only with `event.source === iframe.contentWindow`, `event.origin === 'null'`
 *   (opaque origin) and the schema of `validateFrameMessage`.
 */
import { MAX_XML, selectPage, validateFrameMessage } from '../drawio-ref';
import { Lru } from './cache';

export const MAX_FRAMES = 6;
/** A frame that sent neither `size` nor `error` this long after it was created stops blocking the queue. */
const BOOT_TIMEOUT_MS = 20_000;
const FILE_ORIGIN = `${location.origin}/drawio/`;
const FRAME_URL = `${location.origin}/app/drawio/viewer.html`;

export interface DrawioSpec {
  docId: string;
  path: string;
  page: string | null;
  dark: boolean;
  /** Increases when the IDE reports a change of the file. */
  version: number;
}

/** Selected XML per (docId, path, page, version): at most 64 entries and 12 Mi characters. */
const cache = new Lru<string>(64, 12 << 20);

interface Job {
  body: HTMLElement;
  spec: DrawioSpec;
  xml: string;
  onSize: () => void;
}

interface Live {
  iframe: HTMLIFrameElement;
  job: Job;
  /** The first `size` or `error` arrived (the viewer is loaded). */
  booted: boolean;
}

/** Jobs with data that wait for a frame. */
const queue: Job[] = [];
/** Live frames by their widget body. */
const live = new Map<HTMLElement, Live>();
let booting = false;
let pumping = false;

const keyOf = (s: DrawioSpec): string => `${s.docId}\n${s.path}\n${s.page ?? ''}\n${s.version}`;

function fileUrl(spec: DrawioSpec): string {
  return `${FILE_ORIGIN}${encodeURIComponent(spec.docId)}/${encodeURIComponent(spec.path)}`;
}

/** The selected XML, or a message for the error box. */
async function load(spec: DrawioSpec): Promise<{ xml: string } | { error: string }> {
  const key = keyOf(spec);
  const hit = cache.get(key);
  if (hit !== undefined) return { xml: hit };
  let text: string;
  try {
    const response = await fetch(fileUrl(spec), { cache: 'no-store' });
    if (response.status === 413) return { error: `File too large: ${spec.path}` };
    if (!response.ok) return { error: `File not found: ${spec.path}` };
    text = await response.text();
  } catch {
    return { error: `File not found: ${spec.path}` };
  }
  if (text.length > MAX_XML) return { error: `File too large: ${spec.path}` };
  const selected = selectPage(text, spec.page);
  if (!selected.ok) return { error: selected.error };
  cache.set(key, selected.xml, selected.xml.length);
  return { xml: selected.xml };
}

/** Replaces the content of `body` by a message (`textContent` only). */
function showMessage(body: HTMLElement, text: string, kind: 'error' | 'pending'): void {
  const box = document.createElement('div');
  box.className = kind === 'error' ? 'md-drawio-message md-drawio-error' : 'md-drawio-message md-drawio-pending';
  box.textContent = text;
  body.replaceChildren(box);
  if (kind === 'error') body.style.minHeight = '';
}

/**
 * Fills `body` with the diagram of `spec`: a placeholder at once, then a frame (or an error box) when the data
 * and a free frame are there. `onSize` runs when the height of the body changed.
 */
export function mountDrawio(body: HTMLElement, spec: DrawioSpec, onSize: () => void): void {
  showMessage(body, spec.path, 'pending');
  void load(spec).then((r) => {
    if (!body.isConnected) return;
    if ('error' in r) {
      showMessage(body, r.error, 'error');
      onSize();
      return;
    }
    queue.push({ body, spec, xml: r.xml, onSize });
    pump();
  });
}

/** The widget was destroyed: its frame is removed and a waiting widget can take the place. */
export function releaseDrawio(body: HTMLElement): void {
  const frame = live.get(body);
  if (frame) {
    frame.iframe.remove();
    live.delete(body);
    endBoot(frame);
  }
  const waiting = queue.findIndex((j) => j.body === body);
  if (waiting >= 0) queue.splice(waiting, 1);
  pump();
}

function pump(): void {
  if (pumping || booting || queue.length === 0 || live.size >= MAX_FRAMES) return;
  pumping = true;
  requestIdleCallback(boot, { timeout: 300 });
}

function boot(): void {
  pumping = false;
  // Jobs whose widget left the DOM (scrolled away, caret moved in) are dropped.
  let job: Job | undefined;
  while ((job = queue.shift()) && !job.body.isConnected);
  if (!job) return;
  if (live.size >= MAX_FRAMES) {
    queue.unshift(job);
    return;
  }
  booting = true;
  const { body, spec, xml } = job;
  const iframe = document.createElement('iframe');
  iframe.className = 'md-drawio-frame';
  iframe.title = spec.path;
  // No allow-same-origin, no allow-popups, no allow-top-navigation, no allow-forms.
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.style.height = body.style.minHeight || '200px';
  const frame: Live = { iframe, job, booted: false };
  live.set(body, frame);
  // The frame script is loaded when `load` fires; the parent origin is not the frame origin (opaque): target '*'.
  iframe.addEventListener(
    'load',
    () => iframe.contentWindow?.postMessage({ type: 'render', xml, page: null, dark: spec.dark }, '*'),
    { once: true },
  );
  iframe.src = FRAME_URL;
  body.replaceChildren(iframe);
  setTimeout(() => endBoot(frame), BOOT_TIMEOUT_MS);
}

function endBoot(frame: Live): void {
  if (frame.booted) return;
  frame.booted = true;
  booting = false;
  pump();
}

window.addEventListener('message', (event) => {
  if (event.origin !== 'null') return;
  for (const [body, frame] of live) {
    if (event.source !== frame.iframe.contentWindow) continue;
    const msg = validateFrameMessage(event.data);
    if (!msg) return;
    if (msg.type === 'size') {
      frame.iframe.style.height = `${msg.height}px`;
      body.style.minHeight = '';
      frame.job.onSize();
      endBoot(frame);
    } else {
      frame.iframe.remove();
      live.delete(body);
      showMessage(body, `Viewer error: ${msg.message}`, 'error');
      frame.job.onSize();
      endBoot(frame);
    }
    return;
  }
});
