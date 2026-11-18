/*
 * File paths written as inline code (`src/Foo.kt`): the page asks the IDE which of them exist
 * (`pathsExist`, protocol 2.6) and styles only those. Pure state, no DOM access.
 */
import { StateEffect } from '@codemirror/state';

/** Effect that makes the decorations of path code show the new answers. */
export const pathsChanged = StateEffect.define<null>();

/** Paths per `pathsExist` (the page message is limited to 4 KB). */
export const MAX_PATHS = 16;
/** Longest path asked about. */
export const MAX_PATH_LENGTH = 200;
const MAX_KNOWN = 2000;
const DELAY_MS = 30;

/** docId → path → exists. */
const known = new Map<string, Map<string, boolean>>();
/** Requests in flight and queued: `docId` → paths. */
const pending = new Map<string, Set<string>>();
const queued = new Map<string, Set<string>>();
let timer: ReturnType<typeof setTimeout> | null = null;
let requester: ((docId: string, paths: string[]) => void) | null = null;

/** Sets the function that sends `pathsExist` for a document. */
export function setPathRequester(fn: (docId: string, paths: string[]) => void): void {
  requester = fn;
}

/** True when the IDE said the file exists. A path not asked about yet is queued for the next request. */
export function pathExists(docId: string, path: string): boolean {
  const answer = known.get(docId)?.get(path);
  if (answer !== undefined) return answer;
  if (path.length > MAX_PATH_LENGTH || pending.get(docId)?.has(path)) return false;
  let set = queued.get(docId);
  if (!set) queued.set(docId, (set = new Set()));
  set.add(path);
  timer ??= setTimeout(flush, DELAY_MS);
  return false;
}

function flush(): void {
  timer = null;
  for (const [docId, set] of queued) {
    const paths = [...set];
    for (let i = 0; i < paths.length; i += MAX_PATHS) {
      const batch = paths.slice(i, i + MAX_PATHS);
      let inFlight = pending.get(docId);
      if (!inFlight) pending.set(docId, (inFlight = new Set()));
      for (const p of batch) inFlight.add(p);
      requester?.(docId, batch);
    }
  }
  queued.clear();
}

/** `paths` message: stores the answers. */
export function receivePaths(docId: string, exist: readonly string[], missing: readonly string[]): void {
  let map = known.get(docId);
  if (!map) known.set(docId, (map = new Map()));
  if (map.size >= MAX_KNOWN) map.clear();
  const inFlight = pending.get(docId);
  for (const p of exist) {
    map.set(p, true);
    inFlight?.delete(p);
  }
  for (const p of missing) {
    map.set(p, false);
    inFlight?.delete(p);
  }
}

/** The document came back to the page: forget the "missing" answers (a file may exist now). */
export function recheckMissing(docId: string): void {
  const map = known.get(docId);
  if (!map) return;
  for (const [p, ok] of map) if (!ok) map.delete(p);
}

/** The document was reloaded or closed: forget everything about it. */
export function forgetPaths(docId: string): void {
  known.delete(docId);
  pending.delete(docId);
  queued.delete(docId);
}
