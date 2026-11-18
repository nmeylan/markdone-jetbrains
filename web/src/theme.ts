/*
 * Theme parts that need the DOM (PROTOCOL.md "CSS (M2)").
 *
 * - `editorTheme`: CodeMirror's own base styles are injected unlayered, so they win over every
 *   cascade layer. The few CodeMirror properties that the built-in theme changes are set here (also
 *   unlayered) from the `--md-*` variables, so user CSS changes them through the variables.
 * - `applyUserCss`: the `css` message replaces the text of `<style id="user-css">`. Each source is
 *   wrapped in `@layer user { ... }`; a source that is too large, or that does not stay inside its
 *   layer block (unbalanced braces), is dropped and logged. Then the parsed sheet is walked and
 *   every declaration that loads a resource outside `https://markdone.local/` is removed
 *   (`sanitizeUserSheet`), so user CSS cannot cause a remote request.
 */
import { EditorView } from '@codemirror/view';

export const editorTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--md-bg)', color: 'var(--md-fg)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--md-font-body)', lineHeight: 'var(--md-line-height)' },
  '.cm-content': {
    maxWidth: 'var(--md-max-width)',
    margin: '0 auto',
    padding: 'var(--md-content-padding, 16px 32px 64px)',
    caretColor: 'var(--md-caret)',
  },
  // CodeMirror sets the line padding: the space above headings goes through a variable.
  '.cm-line.md-h': { paddingTop: 'var(--md-heading-space, 0px)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--md-caret)' },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'var(--md-selection-bg)',
  },
  /*
   * Search panel (Mod-F), like the IDE find bar: the sizes, paddings and fonts that CodeMirror's
   * base theme sets come from the `--md-panel-*` variables of the `editor-ui` layer (style.css).
   */
  '.cm-panels': { backgroundColor: 'var(--md-panel-bg)', color: 'var(--md-panel-fg)' },
  '.cm-panels-top': { borderBottom: '1px solid var(--md-panel-border)' },
  '.cm-panel.cm-search': {
    padding: '4px 32px 4px 8px',
    '& input, & button, & label': { margin: '2px 8px 2px 0' },
    '& label': { fontSize: 'var(--md-panel-font-size)' },
    '& [name=close]': { top: '4px', right: '8px', padding: '0 4px', font: 'inherit', fontSize: '16px', lineHeight: '22px', borderRadius: '4px' },
  },
  '.cm-textfield': {
    backgroundColor: 'var(--md-bg)',
    color: 'var(--md-panel-fg)',
    border: '1px solid var(--md-panel-border)',
    borderRadius: '4px',
    fontSize: 'var(--md-panel-font-size)',
    padding: '3px 6px',
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--md-panel-bg)',
    color: 'var(--md-panel-fg)',
    border: '1px solid var(--md-panel-border)',
    borderRadius: '4px',
    fontSize: 'var(--md-panel-font-size)',
    padding: '3px 10px',
  },
  '.cm-button:hover, .cm-panel.cm-search [name=close]:hover': { backgroundColor: 'var(--md-panel-hover-bg)' },
  '.cm-button:active': { backgroundImage: 'none', backgroundColor: 'var(--md-panel-hover-bg)' },
  '.cm-searchMatch': { backgroundColor: 'var(--md-search-match)' },
  '.cm-searchMatch-selected': { backgroundColor: 'var(--md-search-match-selected)' },
});

/** PROTOCOL.md: each CSS source is at most 512 KB. */
export const MAX_CSS_BYTES = 512 * 1024;

const encoder = new TextEncoder();

/** True when `@layer user { source }` parses to one layer block that ends where it should. */
function staysInLayer(source: string): boolean {
  const sheet = new CSSStyleSheet();
  try {
    sheet.replaceSync(`@layer user {\n${source}\n}\n@layer markdone-end {}`);
  } catch {
    return false;
  }
  const rules = sheet.cssRules;
  return (
    rules.length === 2 &&
    rules[0] instanceof CSSLayerBlockRule &&
    rules[0].name === 'user' &&
    rules[1] instanceof CSSLayerBlockRule &&
    rules[1].name === 'markdone-end'
  );
}

/** Text of `<style id="user-css">` for a `css` message. */
export function userCssText(global: string, project: string | null): string {
  const parts: string[] = [];
  for (const [name, source] of [
    ['global', global],
    ['project', project],
  ] as const) {
    if (source === null) continue;
    if (encoder.encode(source).length > MAX_CSS_BYTES) {
      console.error(`markdone: ${name} CSS larger than 512 KB, dropped`);
      continue;
    }
    if (!staysInLayer(source)) {
      console.error(`markdone: ${name} CSS does not stay inside its layer (unbalanced braces), dropped`);
      continue;
    }
    parts.push(`@layer user {\n${source}\n}`);
  }
  return parts.join('\n');
}

let userCss: HTMLStyleElement | null = null;

/** Replaces the user CSS. The element is appended after the page CSS, which declares the layer order. */
export function applyUserCss(global: string, project: string | null): void {
  if (!userCss) {
    userCss = document.createElement('style');
    userCss.id = 'user-css';
    document.head.appendChild(userCss);
  }
  userCss.textContent = userCssText(global, project);
  // Synchronous, before the next style recalculation: nothing was requested yet.
  if (userCss.sheet) {
    const dropped = sanitizeRules(userCss.sheet, userCss.sheet.cssRules, document.baseURI);
    if (dropped > 0) console.warn(`markdone: ${dropped} user CSS declaration(s) or rule(s) with a URL outside https://markdone.local/ dropped`);
  }
}

/* ---------- URL targets in user CSS (PROTOCOL.md "CSS (M2)") ---------- */

/** Functions whose string arguments are resource URLs (`url` with a quoted argument included). */
const URL_FUNCTIONS = /^(?:url|src|(?:-webkit-)?image-set|image|(?:-webkit-)?cross-fade)$/;
const HEX = /[0-9a-fA-F]/;

/**
 * Resource targets in a CSS value: `url()` arguments and the strings inside `src()`, `image()`,
 * `image-set()`, `-webkit-image-set()` and `cross-fade()`. A small CSS tokenizer: comments are
 * skipped and escapes decoded, so `u\72l(` reads as `url(` the way the CSS parser reads it. No DOM.
 */
export function cssUrlTargets(value: string): string[] {
  const out: string[] = [];
  const stack: string[] = [];
  let i = 0;
  const n = value.length;
  /** Decodes the escape at `i` (a backslash); returns the text. */
  const escape = (): string => {
    i++;
    if (i >= n) return '';
    if (HEX.test(value[i] as string)) {
      let hex = '';
      while (i < n && hex.length < 6 && HEX.test(value[i] as string)) hex += value[i++];
      if (i < n && /\s/.test(value[i] as string)) i++;
      const cp = parseInt(hex, 16);
      return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? '\ufffd' : String.fromCodePoint(cp);
    }
    return value[i++] as string;
  };
  const isName = (c: string) => /[A-Za-z0-9_-]/.test(c) || c.charCodeAt(0) >= 0x80;
  while (i < n) {
    const c = value[i] as string;
    if (c === '/' && value[i + 1] === '*') {
      const end = value.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
    } else if (c === '"' || c === "'") {
      i++;
      let str = '';
      while (i < n && value[i] !== c) {
        if (value[i] === '\\') {
          if (value[i + 1] === '\n') i += 2;
          else str += escape();
        } else str += value[i++];
      }
      i++;
      if (stack.some((f) => URL_FUNCTIONS.test(f))) out.push(str);
    } else if (isName(c) || (c === '\\' && i + 1 < n && value[i + 1] !== '\n')) {
      let name = '';
      while (i < n && (isName(value[i] as string) || (value[i] === '\\' && i + 1 < n && value[i + 1] !== '\n'))) {
        name += value[i] === '\\' ? escape() : value[i++];
      }
      if (value[i] !== '(') continue;
      i++;
      name = name.toLowerCase();
      if (name === 'url') {
        while (i < n && /\s/.test(value[i] as string)) i++;
        if (value[i] !== '"' && value[i] !== "'") {
          // Unquoted url token: up to `)`, escapes decoded.
          let url = '';
          while (i < n && value[i] !== ')') url += value[i] === '\\' ? escape() : value[i++];
          i++;
          out.push(url.trim());
          continue;
        }
      }
      stack.push(name);
    } else {
      if (c === '(') stack.push('');
      else if (c === ')') stack.pop();
      i++;
    }
  }
  return out;
}

/** True when `target` (resolved against `base`) is on https://markdone.local/, or a data: URL when `data`. */
export function allowedCssTarget(target: string, base: string, data: boolean): boolean {
  let url: URL;
  try {
    url = new URL(target.trim(), base);
  } catch {
    return false;
  }
  if (url.protocol === 'data:') return data;
  return url.protocol === 'https:' && url.origin === 'https://markdone.local';
}

/** Removes the declarations of `style` with a disallowed target; returns how many. */
function sanitizeStyle(style: CSSStyleDeclaration, base: string, data: boolean): number {
  const bad = (value: string) => cssUrlTargets(value).some((t) => !allowedCssTarget(t, base, data));
  if (!bad(style.cssText)) return 0;
  let dropped = 0;
  for (let i = style.length - 1; i >= 0; i--) {
    const name = style.item(i);
    if (bad(style.getPropertyValue(name))) {
      style.removeProperty(name);
      dropped++;
    }
  }
  // A shorthand with var() keeps its text on the shorthand only (longhands read ""): drop all.
  if (bad(style.cssText)) {
    dropped += style.length;
    style.cssText = '';
  }
  return dropped;
}

/**
 * Walks `rules` (of `parent`) and its nested rules (@media, @supports, @layer, @container,
 * nested style rules, @keyframes, …). Declarations: see `sanitizeStyle`; data: URLs are allowed
 * (no request) except in @font-face (the CSP font-src has no data:). A rule without declarations
 * whose text has a disallowed target (for example @property initial-value) is deleted.
 */
function sanitizeRules(parent: CSSStyleSheet | CSSRule, rules: CSSRuleList, base: string): number {
  let dropped = 0;
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i] as CSSRule;
    const style = (rule as { style?: unknown }).style;
    const children = (rule as { cssRules?: unknown }).cssRules;
    if (style instanceof CSSStyleDeclaration) dropped += sanitizeStyle(style, base, !(rule instanceof CSSFontFaceRule));
    if (children instanceof CSSRuleList) dropped += sanitizeRules(rule, children, base);
    if (!(style instanceof CSSStyleDeclaration) && !(children instanceof CSSRuleList)) {
      if (cssUrlTargets(rule.cssText).some((t) => !allowedCssTarget(t, base, true))) {
        if (parent instanceof CSSStyleSheet || parent instanceof CSSGroupingRule) {
          parent.deleteRule(i);
          dropped++;
        }
      }
    }
  }
  return dropped;
}

/* ---------- Mermaid SVG styles ---------- */

/**
 * Start of a Mermaid style statement: `classDef`, `style` or `linkStyle` (the Mermaid lexers of some
 * diagram types ignore case), and its target when it is a plain name or list (`a`, `1,2`, `default`).
 */
const STYLE_KEYWORD = /(?:^|[;{}])\s*(?:classDef|style|linkStyle)(?![\w-])(?:\s+[\w,.-]+\s+)?/i;

/**
 * The Mermaid source with the declarations that load a URL outside https://markdone.local/ (resolved
 * against `base`) removed from style statements: on each line, all the text after the first
 * `classDef` / `style` / `linkStyle` keyword (and its target) at a statement start is split into
 * declarations at `;` and `,`, and a declaration with such a URL is removed. Mermaid renders in a temporary element of
 * the page, where such a declaration in a `style` attribute would make the browser try the URL.
 * Other text is not changed.
 */
export function withoutRemoteStyleUrls(src: string, base: string): string {
  if (!/classDef|style|linkStyle/i.test(src)) return src;
  const allowed = (decl: string) => cssUrlTargets(decl).every((t) => allowedCssTarget(t, base, true));
  return src
    .split('\n')
    .map((line) => {
      const m = STYLE_KEYWORD.exec(line);
      if (!m) return line;
      const at = m.index + m[0].length;
      const rest = line
        .slice(at)
        .split(';')
        .map((stmt) => stmt.split(',').filter(allowed).join(','))
        .join(';');
      return line.slice(0, at) + rest;
    })
    .join('\n');
}

/**
 * Removes the declarations of the `style` attributes under `root` that load a URL outside
 * https://markdone.local/ (Mermaid writes `classDef` values into the `style` attributes of shapes).
 * Returns how many.
 */
export function sanitizeStyleAttributes(root: ParentNode): number {
  let dropped = 0;
  for (const el of Array.from(root.querySelectorAll('[style]'))) {
    const style = (el as Partial<ElementCSSInlineStyle>).style;
    if (style instanceof CSSStyleDeclaration) dropped += sanitizeStyle(style, document.baseURI, true);
    else el.removeAttribute('style');
  }
  return dropped;
}

/** A character after `#<id>` that would make a longer id (a name character or an escape). */
const ID_CHAR = /[\w\\-]|[^\p{ASCII}]/u;

/** Selector parts at top-level commas (commas inside `:is(…)` or `[…]` stay). */
function selectorParts(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(text.slice(start).trim());
  return out;
}

/**
 * The CSS of an SVG `<style>` reduced to the rules scoped to the SVG element `#<id>`: style rules
 * whose selectors all start with `#<id>` (the SVG is the only child of its widget, so a sibling
 * combinator finds nothing) and `@keyframes` (Mermaid's edge animations). Nested rules, other
 * at-rules and unparsable CSS are dropped, and so are declarations that load a URL outside
 * https://markdone.local/ (as for user CSS).
 */
export function scopedCss(css: string, id: string): string {
  const sheet = new CSSStyleSheet();
  try {
    sheet.replaceSync(css);
  } catch {
    return '';
  }
  const head = `#${id}`;
  const scoped = (selector: string) => selectorParts(selector).every((p) => p.startsWith(head) && !ID_CHAR.test(p.charAt(head.length)));
  for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
    const rule = sheet.cssRules[i];
    if (rule instanceof CSSKeyframesRule) continue;
    if (!(rule instanceof CSSStyleRule) || !scoped(rule.selectorText)) sheet.deleteRule(i);
    // Nested rules (`& ~ x`, `:root &`) can leave the scope.
    else while (rule.cssRules.length > 0) rule.deleteRule(0);
  }
  sanitizeRules(sheet, sheet.cssRules, document.baseURI);
  return Array.from(sheet.cssRules, (r) => r.cssText).join('\n');
}
