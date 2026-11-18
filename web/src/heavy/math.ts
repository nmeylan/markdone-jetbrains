/*
 * Math rendering. Lazy chunk: imported when the first math widget is drawn.
 *
 * `katex.render` on the main thread, synchronously: KaTeX builds its DOM with createElement /
 * createTextNode / setAttribute only (no innerHTML), so the widget rule of AGENTS.md holds.
 * Security: `trust: false` turns off \href, \url, \includegraphics and \htmlClass/\htmlId/
 * \htmlStyle/\htmlData (they render as error text); `maxExpand` bounds macro expansion
 * (`\def\a{\a\a}\a` is an error, not a hang); `maxSize` bounds user sizes (em); `macros` is a fresh
 * object per call, so a `\gdef` never leaks into another formula. Sources longer than
 * MAX_MATH_CHARS are shown as source. KaTeX's fonts are files under /app/assets/ (vite.config.ts),
 * loaded by the browser on use (CSP font-src).
 *
 * Cache: the rendered DocumentFragment per (display, source key); a widget gets a deep clone.
 */
import 'katex/dist/katex.min.css';

import katex, { type KatexOptions } from 'katex';

import { Lru, heavyStats, keyOf } from './cache';

export const MAX_MATH_CHARS = 8000;

/** <= 2 000 formulas, weight 30 x source chars (DOM size estimate), <= 4 Mi. */
const cache = new Lru<DocumentFragment>(2000, 4 << 20);

function options(display: boolean): KatexOptions {
  return {
    displayMode: display,
    output: 'html',
    throwOnError: false,
    trust: false,
    strict: 'ignore',
    maxExpand: 1000,
    maxSize: 20,
    globalGroup: false,
    macros: {},
  };
}

/** Fills the empty element `el` with the formula (or its source when it is too long or KaTeX fails). */
export function renderMath(el: HTMLElement, src: string, display: boolean): void {
  if (src.length > MAX_MATH_CHARS) {
    el.textContent = src;
    el.classList.add('md-math-source');
    return;
  }
  const key = (display ? 'D' : 'I') + keyOf(src);
  let frag = cache.get(key);
  if (frag) {
    heavyStats.mathCacheHits++;
  } else {
    const holder = document.createElement('span');
    try {
      // throwOnError false: parse errors are rendered as error text; anything else is shown as source.
      katex.render(src, holder, options(display));
    } catch {
      el.textContent = src;
      el.classList.add('md-math-source');
      return;
    }
    frag = document.createDocumentFragment();
    frag.append(...Array.from(holder.childNodes));
    heavyStats.mathRenders++;
    cache.set(key, frag, src.length * 30);
  }
  el.appendChild(frag.cloneNode(true));
}
