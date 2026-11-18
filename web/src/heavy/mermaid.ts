/*
 * Mermaid rendering. Lazy chunk: imported when the first Mermaid widget is
 * drawn; Mermaid loads each diagram type as a further chunk.
 *
 * - securityLevel 'strict' (labels sanitized by Mermaid, click/callback directives off),
 *   htmlLabels false (SVG <text>, no <foreignObject>), and the options a `%%{init}%%` directive
 *   could use to weaken that are in `secure` (a directive cannot change them).
 * - Render queue: one diagram per idle callback, only for widgets still in the DOM (CodeMirror
 *   draws widgets only near the viewport, and not while the caret is in the block).
 * - Insertion (AGENTS.md rendering rule, Mermaid exception): the SVG string goes only through
 *   DOMPurify with the SVG profile, foreignObject / a / use / image / script and href /
 *   xlink:href forbidden, RETURN_DOM_FRAGMENT. DOMPurify parses in its inert document; this code
 *   never assigns innerHTML. Note: Mermaid itself decodes label entities with innerHTML on a
 *   detached element of the page; the CSP (no inline script, strict img-src) blocks handlers and
 *   remote loads there (tested in heavy.spec.ts).
 * - Styles: an SVG <style> applies to the whole page, unlayered. After DOMPurify, each one
 *   keeps only the rules scoped to the diagram's own id, without URLs outside https://markdone.local/
 *   (`scopedCss`, theme.ts). `classDef` / `style` / `linkStyle` values also go into `style`
 *   attributes, first in Mermaid's temporary render element in the page: their declarations with
 *   such URLs are removed from the source before the render (`withoutRemoteStyleUrls`) and from
 *   the `style` attributes after DOMPurify (`sanitizeStyleAttributes`), so the browser never tries them.
 * - Cache: sanitized fragment (or error text) per (theme, source key), weight = serialized SVG
 *   length; a widget gets a deep clone. A failed chunk load is not cached (the next draw tries again).
 */
import DOMPurify from 'dompurify';
import mermaid from 'mermaid';

import { sanitizeStyleAttributes, scopedCss, withoutRemoteStyleUrls } from '../theme';
import { Lru, heavyStats, keyOf } from './cache';

const MAX_SOURCE = 20_000;

type Result = { frag: DocumentFragment } | { error: string };

/** <= 200 diagrams, <= 4 Mi chars of serialized SVG (or error text). */
const cache = new Lru<Result>(200, 4 << 20);
let theme = '';
let seq = 0;

function init(dark: boolean): void {
  const t = dark ? 'dark' : 'default';
  if (t === theme) return;
  theme = t;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    deterministicIds: true,
    suppressErrorRendering: true,
    maxTextSize: MAX_SOURCE,
    maxEdges: 200,
    theme: t,
    secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges', 'htmlLabels', 'flowchart', 'dompurifyConfig', 'themeCSS', 'deterministicIds'],
  });
}

const PURIFY = {
  USE_PROFILES: { svg: true, svgFilters: true },
  ADD_TAGS: ['style'],
  FORBID_TAGS: ['foreignObject', 'a', 'use', 'image', 'script'],
  FORBID_ATTR: ['href', 'xlink:href'],
  RETURN_DOM_FRAGMENT: true as const,
};

/** A lazy chunk that did not load (Chromium: "Failed to fetch dynamically imported module"): not cached. */
function isLoadError(e: unknown): boolean {
  return e instanceof TypeError && /dynamically imported module|module script/i.test(e.message);
}

interface Job {
  el: HTMLElement;
  src: string;
  key: string;
  dark: boolean;
  done: () => void;
}
const queue: Job[] = [];
let running = false;

/** Fills `el` with the diagram: at once from the cache, else from the idle render queue (`done` then). */
export function fillMermaid(el: HTMLElement, src: string, dark: boolean, done: () => void): void {
  const key = (dark ? 'dark' : 'default') + keyOf(src);
  const hit = cache.get(key);
  if (hit) {
    heavyStats.mermaidCacheHits++;
    show(el, hit);
    return;
  }
  queue.push({ el, src, key, dark, done });
  pump();
}

function show(el: HTMLElement, r: Result): void {
  el.classList.remove('md-mermaid-pending');
  if ('error' in r) {
    el.classList.add('md-mermaid-error');
    const msg = document.createElement('div');
    msg.className = 'md-mermaid-message';
    msg.textContent = r.error;
    el.replaceChildren(msg);
    return;
  }
  el.replaceChildren(r.frag.cloneNode(true));
}

function pump(): void {
  if (running || queue.length === 0) return;
  running = true;
  requestIdleCallback(() => void next(), { timeout: 300 });
}

async function next(): Promise<void> {
  // Jobs whose widget left the DOM (scrolled away, caret moved in) are dropped.
  let job: Job | undefined;
  while ((job = queue.shift()) && !job.el.isConnected);
  if (!job) {
    running = false;
    return;
  }
  let r = cache.get(job.key);
  if (!r) {
    try {
      if (job.src.length > MAX_SOURCE) throw new Error(`Diagram too large (${job.src.length} characters)`);
      init(job.dark);
      const id = `markdone-mermaid-${++seq}`;
      const { svg } = await mermaid.render(id, withoutRemoteStyleUrls(job.src, document.baseURI));
      const frag = DOMPurify.sanitize(svg, PURIFY) as unknown as DocumentFragment;
      for (const style of Array.from(frag.querySelectorAll('style'))) style.textContent = scopedCss(style.textContent ?? '', id);
      sanitizeStyleAttributes(frag);
      r = { frag };
      heavyStats.mermaidRenders++;
      cache.set(job.key, r, svg.length);
    } catch (e) {
      heavyStats.mermaidErrors++;
      r = { error: e instanceof Error ? e.message : String(e) };
      if (!isLoadError(e)) cache.set(job.key, r, r.error.length);
    }
    heavyStats.mermaidCacheWeight = cache.weight;
  } else {
    heavyStats.mermaidCacheHits++;
  }
  if (job.el.isConnected) {
    show(job.el, r);
    job.done();
  }
  running = false;
  pump();
}
