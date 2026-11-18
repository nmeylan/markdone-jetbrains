/*
 * draw.io references (nmey/DRAWIO.md §2, §4.3) and the messages of the draw.io frame. No DOM: runs in Node for L1.
 * - `parseDrawioRef(text, pattern)`: the text of one paragraph -> { path, page } or null.
 *   Forms: an image or a link alone in its paragraph (`![a](x.drawio#Page)`), and the `drawio:` line
 *   (a template, default `drawio:{path}#{page}`).
 * - `selectPage(xml, page)`: the XML of one page as a one-page `<mxfile>`. The page does not decompress
 *   `<diagram>` content and does not parse the whole file; the viewer does.
 */

export const DEFAULT_PATTERN = 'drawio:{path}#{page}';
export const MAX_PATTERN_LENGTH = 100;
/** Largest diagram file, in characters (the IDE refuses a larger file in bytes). */
export const MAX_XML = 5 * 1024 * 1024;
export const MAX_FRAME_HEIGHT = 10_000;
const MAX_ERROR_LENGTH = 500;

export interface DrawioRef {
  path: string;
  /** Name of a `<diagram>`; null shows all pages. */
  page: string | null;
}

export interface Pattern {
  prefix: string;
  /** Between the path and the page; `#` when the template has no `{page}`. */
  separator: string;
  suffix: string;
  hasPage: boolean;
}

/**
 * Parses a template. Null when invalid: not exactly one `{path}`, more than one `{page}`, `{page}`
 * before `{path}`, no separator between them, a separator with white space, `)` or `]` (it must work
 * inside `![x](path<sep>page)` too), a line feed, or longer than 100 characters.
 */
export function parsePattern(template: string): Pattern | null {
  if (template.length > MAX_PATTERN_LENGTH || template.includes('\n') || template.includes('\r')) return null;
  const pathAt = template.indexOf('{path}');
  if (pathAt < 0 || template.indexOf('{path}', pathAt + 1) >= 0) return null;
  const prefix = template.slice(0, pathAt);
  const rest = template.slice(pathAt + '{path}'.length);
  const pageAt = rest.indexOf('{page}');
  if (prefix.includes('{page}')) return null;
  if (pageAt < 0) return { prefix, separator: '#', suffix: rest, hasPage: false };
  if (rest.indexOf('{page}', pageAt + 1) >= 0) return null;
  const separator = rest.slice(0, pageAt);
  if (separator === '' || /[\s)\]]/.test(separator)) return null;
  return { prefix, separator, suffix: rest.slice(pageAt + '{page}'.length), hasPage: true };
}

/** The pattern of a template, or of the default when the template is invalid. */
export function patternOrDefault(template: string): Pattern {
  return parsePattern(template) ?? (parsePattern(DEFAULT_PATTERN) as Pattern);
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const EXTENSION = /\.drawio(?:\.xml)?/gi;

/** Splits `path<separator>page` at the first separator that follows a `.drawio` or `.drawio.xml` extension. */
function splitTarget(target: string, separator: string, hasPage: boolean): DrawioRef | null {
  for (const m of target.matchAll(EXTENSION)) {
    const end = m.index + m[0].length;
    let rawPath: string;
    let rawPage: string | null = null;
    if (end === target.length) rawPath = target;
    else if (hasPage && target.startsWith(separator, end)) {
      rawPath = target.slice(0, end);
      rawPage = target.slice(end + separator.length);
    } else continue;
    const path = decode(rawPath);
    // Not a project file: another scheme, an absolute path, a drive path, a NUL.
    if (!path || /^[a-z][a-z0-9+.-]*:/i.test(path) || /^[/\\]/.test(path) || path.includes('\u0000')) return null;
    return { path, page: rawPage ? decode(rawPage) : null };
  }
  return null;
}

/** `![alt](target "title")` or `[text](target "title")` as the whole text; the target without `<>`. */
const LINK_ALONE = /^!?\[(?:[^[\]\\]|\\.)*\]\(\s*(<[^<>\n]*>|[^\s()<>]*)(?:\s+(?:"[^"]*"|'[^']*'|\([^()]*\)))?\s*\)$/;

/**
 * The reference that the text of one paragraph holds, or null. A link with other text in the paragraph,
 * a multi-line `drawio:` paragraph and a target that is not a `.drawio` / `.drawio.xml` project file give null.
 */
export function parseDrawioRef(text: string, template: string = DEFAULT_PATTERN): DrawioRef | null {
  const pattern = patternOrDefault(template);
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const link = LINK_ALONE.exec(trimmed);
  if (link) {
    let target = link[1] ?? '';
    if (target.startsWith('<')) target = target.slice(1, -1);
    return splitTarget(target, pattern.separator, pattern.hasPage);
  }
  // The line form: one line, no leading space.
  if (text.includes('\n') || text.includes('\r') || !text.startsWith(pattern.prefix)) return null;
  let body = text.slice(pattern.prefix.length);
  if (pattern.suffix !== '') {
    if (!body.endsWith(pattern.suffix)) return null;
    body = body.slice(0, body.length - pattern.suffix.length);
  } else body = body.trimEnd();
  return splitTarget(body, pattern.separator, pattern.hasPage);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (_, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
    if (name) return ENTITIES[name.toLowerCase()] ?? '';
    const code = hex !== undefined ? parseInt(hex, 16) : parseInt(dec ?? '', 10);
    return Number.isSafeInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

export type PageResult = { ok: true; xml: string } | { ok: false; error: string };

const ROOT = /^(?:\uFEFF|\s|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)*<([A-Za-z_][\w.:-]*)/;
const DIAGRAM = /<diagram(?=[\s>/])((?:"[^"]*"|'[^']*'|[^>"'])*?)(?:\/>|>([\s\S]*?)<\/diagram\s*>)/g;
const NAME = /(?:^|\s)name\s*=\s*(?:"([^"]*)"|'([^']*)')/;

/**
 * The XML for the viewer: the file as is when [page] is null, else a new `<mxfile>` with only the
 * first `<diagram name="[page]">`. The root must be `mxfile` or `mxGraphModel` (`mxGraphModel` has no pages).
 */
export function selectPage(xml: string, page: string | null): PageResult {
  const root = ROOT.exec(xml)?.[1];
  if (root !== 'mxfile' && root !== 'mxGraphModel') return { ok: false, error: 'Not a draw.io file' };
  if (page === null) return { ok: true, xml };
  if (root === 'mxfile') {
    for (const m of xml.matchAll(DIAGRAM)) {
      const attrs = m[1] ?? '';
      const raw = NAME.exec(attrs);
      const name = raw ? decodeEntities(raw[1] ?? raw[2] ?? '') : null;
      if (name === page) return { ok: true, xml: `<mxfile>${m[0]}</mxfile>` };
    }
  }
  return { ok: false, error: `Page '${page}' not found` };
}

/* ---------- Messages between the page and the draw.io frame ---------- */

export interface RenderMessage {
  type: 'render';
  xml: string;
  page: number | null;
  dark: boolean;
}

export type FrameMessage = { type: 'size'; height: number } | { type: 'error'; message: string };

function exactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(value, k));
}

/** Page -> frame. Returns the message if it matches the schema exactly, else null. */
export function validateRenderMessage(msg: unknown): RenderMessage | null {
  if (!exactKeys(msg, ['type', 'xml', 'page', 'dark']) || msg['type'] !== 'render') return null;
  const { xml, page, dark } = msg;
  if (typeof xml !== 'string' || xml.length > MAX_XML || typeof dark !== 'boolean') return null;
  if (page !== null && !(Number.isSafeInteger(page) && (page as number) >= 0)) return null;
  return msg as unknown as RenderMessage;
}

/** Frame -> page. Returns the message if it matches the schema exactly, else null. */
export function validateFrameMessage(msg: unknown): FrameMessage | null {
  if (exactKeys(msg, ['type', 'height']) && msg['type'] === 'size') {
    const h = msg['height'];
    return typeof h === 'number' && Number.isFinite(h) && h >= 1 && h <= MAX_FRAME_HEIGHT ? (msg as unknown as FrameMessage) : null;
  }
  if (exactKeys(msg, ['type', 'message']) && msg['type'] === 'error') {
    const m = msg['message'];
    return typeof m === 'string' && m.length <= MAX_ERROR_LENGTH ? (msg as unknown as FrameMessage) : null;
  }
  return null;
}
