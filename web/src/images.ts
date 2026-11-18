/*
 * Image source rules (PROTOCOL.md "Images (M2)"). No DOM: runs in Node for L1.
 * - relative path -> https://markdone.local/file/<docId>/<path>; the path is ONE percent-encoded
 *   component (`/` -> %2F), so the browser keeps `..` segments and the IDE decodes it once
 *   (PathRules.percentDecode) and applies the path rules;
 * - data:image/... -> as is;
 * - https (and `//host` -> https) -> as is only when remote images are on, else a placeholder;
 *   `http:` -> always a placeholder (the CSP allows only `https:` images);
 * - anything else (other schemes, absolute paths, empty) -> placeholder.
 */

export const FILE_ORIGIN = 'https://markdone.local/file/';

export type ImageSource = { kind: 'url'; url: string } | { kind: 'placeholder'; text: string };

function decodeOnce(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function resolveImage(rawSrc: string, docId: string, remoteImages: boolean): ImageSource {
  let src = rawSrc.trim();
  // `![a](<path with spaces.png>)`
  if (src.startsWith('<') && src.endsWith('>')) src = src.slice(1, -1).trim();
  const placeholder: ImageSource = { kind: 'placeholder', text: src };
  if (!src) return placeholder;
  if (/^data:image\/[a-z0-9.+-]+[;,]/i.test(src)) return { kind: 'url', url: src };
  if (/^https:\/\//i.test(src) || src.startsWith('//')) {
    return remoteImages ? { kind: 'url', url: src.startsWith('//') ? `https:${src}` : src } : placeholder;
  }
  // Other schemes (file:, javascript:, data:text/...), Windows drive paths, absolute paths.
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('/') || src.startsWith('\\')) return placeholder;
  const path = decodeOnce(src.replace(/[?#].*$/, ''));
  if (!path || !docId) return placeholder;
  return { kind: 'url', url: `${FILE_ORIGIN}${encodeURIComponent(docId)}/${encodeURIComponent(path)}` };
}
