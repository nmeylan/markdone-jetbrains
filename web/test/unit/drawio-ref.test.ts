import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_PATTERN, MAX_XML, parseDrawioRef, parsePattern, selectPage, validateFrameMessage, validateRenderMessage } from '../../src/drawio-ref';

const asset = (name: string): string => readFileSync(fileURLToPath(new URL(`../e2e/assets/drawio/${name}`, import.meta.url)), 'utf8');

describe('parsePattern', () => {
  it('parses the default', () => {
    expect(parsePattern(DEFAULT_PATTERN)).toEqual({ prefix: 'drawio:', separator: '#', suffix: '', hasPage: true });
  });
  it('parses prefix, separator and suffix', () => {
    expect(parsePattern('[[draw {path}@@{page}]]')).toEqual({ prefix: '[[draw ', separator: '@@', suffix: ']]', hasPage: true });
  });
  it('accepts a template without {page}', () => {
    expect(parsePattern('dio:{path}')).toEqual({ prefix: 'dio:', separator: '#', suffix: '', hasPage: false });
  });
  it.each([
    '',
    'drawio:',
    'drawio:{path}{path}',
    'drawio:{page}',
    'drawio:{page}#{path}',
    'drawio:{path}#{page}#{page}',
    'drawio:{path}{page}',
    'drawio:{path} {page}',
    'drawio:{path}){page}',
    'drawio:{path}]{page}',
    'drawio:{path}\n{page}',
    `drawio:{path}#{page}${'x'.repeat(100)}`,
  ])('rejects %j', (template) => {
    expect(parsePattern(template)).toBeNull();
  });
});

describe('parseDrawioRef: image or link alone', () => {
  it.each([
    ['![Arch](docs/arch.drawio#Backend)', { path: 'docs/arch.drawio', page: 'Backend' }],
    ['[Arch](docs/arch.drawio#Backend)', { path: 'docs/arch.drawio', page: 'Backend' }],
    ['![Arch](docs/arch.drawio)', { path: 'docs/arch.drawio', page: null }],
    ['![](a.drawio.xml#P)', { path: 'a.drawio.xml', page: 'P' }],
    ['![x](A.DrawIO)', { path: 'A.DrawIO', page: null }],
    ['![x](A.DRAWIO.XML#p)', { path: 'A.DRAWIO.XML', page: 'p' }],
    ['![x](my%20dir/a%20b.drawio#Back%20end%26x)', { path: 'my dir/a b.drawio', page: 'Back end&x' }],
    ['![x](<my dir/a b.drawio#Back end>)', { path: 'my dir/a b.drawio', page: 'Back end' }],
    ['![x](a.drawio#P "Title")', { path: 'a.drawio', page: 'P' }],
    ['  [x](a.drawio)  ', { path: 'a.drawio', page: null }],
    ['![x](a.drawio#)', { path: 'a.drawio', page: null }],
    ['![x](a.drawio#bad%zz)', { path: 'a.drawio', page: 'bad%zz' }],
  ])('%s', (text, expected) => {
    expect(parseDrawioRef(text)).toEqual(expected);
  });

  it.each([
    'See [Arch](docs/arch.drawio) for details',
    '[Arch](docs/arch.drawio) and [B](b.drawio)',
    '![a](x.png)',
    '[a](x.drawio.txt)',
    '![x](https://example.com/a.drawio)',
    '![x](//example.com/a.drawio)',
    '![x](/abs/a.drawio)',
    '![x](C:\\a.drawio)',
    '![x](file:a.drawio)',
    '![x](a.drawio\u0000)',
    '![x](%00a.drawio)',
    '![x](a.drawio)\n![y](b.drawio)',
    '',
    '   ',
  ])('is null for %j', (text) => {
    expect(parseDrawioRef(text)).toBeNull();
  });
});

describe('parseDrawioRef: drawio line', () => {
  it.each([
    ['drawio:docs/arch.drawio#Backend', { path: 'docs/arch.drawio', page: 'Backend' }],
    ['drawio:docs/arch.drawio', { path: 'docs/arch.drawio', page: null }],
    ['drawio:docs/my arch.drawio#Back end', { path: 'docs/my arch.drawio', page: 'Back end' }],
    ['drawio:a.drawio.xml#x', { path: 'a.drawio.xml', page: 'x' }],
    ['drawio:A.DRAWIO#x', { path: 'A.DRAWIO', page: 'x' }],
    ['drawio:a%20b.drawio#c%20d', { path: 'a b.drawio', page: 'c d' }],
    ['drawio:a.drawio#x.drawio#y', { path: 'a.drawio', page: 'x.drawio#y' }],
    ['drawio:a.drawio  ', { path: 'a.drawio', page: null }],
  ])('%s', (text, expected) => {
    expect(parseDrawioRef(text)).toEqual(expected);
  });

  it.each([
    ' drawio:a.drawio',
    'Drawio:a.drawio',
    'drawio:a.txt',
    'drawio:a.drawio\nmore',
    'drawio:a.drawio\r\nmore',
    'drawio:',
    'drawio:/abs/a.drawio',
    'drawio:https://x/a.drawio',
    'text drawio:a.drawio',
    'drawio:a.drawioX#p',
  ])('is null for %j', (text) => {
    expect(parseDrawioRef(text)).toBeNull();
  });
});

describe('parseDrawioRef: custom patterns', () => {
  it('prefix, separator and suffix in the line form', () => {
    expect(parseDrawioRef('[[draw a/b.drawio@@Page one]]', '[[draw {path}@@{page}]]')).toEqual({ path: 'a/b.drawio', page: 'Page one' });
    expect(parseDrawioRef('[[draw a/b.drawio]]', '[[draw {path}@@{page}]]')).toEqual({ path: 'a/b.drawio', page: null });
    expect(parseDrawioRef('[[draw a/b.drawio@@P', '[[draw {path}@@{page}]]')).toBeNull();
  });
  it('the image and link forms use the same separator', () => {
    const t = 'dio:{path}@@{page}';
    expect(parseDrawioRef('![x](a.drawio@@Page)', t)).toEqual({ path: 'a.drawio', page: 'Page' });
    expect(parseDrawioRef('[x](a.drawio.xml@@Page)', t)).toEqual({ path: 'a.drawio.xml', page: 'Page' });
    // `#` is not the separator of this template: it stays in the target, and the path does not end with the extension.
    expect(parseDrawioRef('![x](a.drawio#Page)', t)).toBeNull();
  });
  it('a template without {page} ignores pages', () => {
    expect(parseDrawioRef('dio:a.drawio', 'dio:{path}')).toEqual({ path: 'a.drawio', page: null });
    expect(parseDrawioRef('dio:a.drawio#P', 'dio:{path}')).toBeNull();
  });
  it('an invalid template falls back to the default', () => {
    expect(parseDrawioRef('drawio:a.drawio#P', 'drawio:{path} {page}')).toEqual({ path: 'a.drawio', page: 'P' });
    expect(parseDrawioRef('drawio:a.drawio#P', 'nonsense')).toEqual({ path: 'a.drawio', page: 'P' });
  });
  it('an empty prefix matches only .drawio targets', () => {
    expect(parseDrawioRef('a.drawio#P', '{path}#{page}')).toEqual({ path: 'a.drawio', page: 'P' });
    expect(parseDrawioRef('a.txt#P', '{path}#{page}')).toBeNull();
  });
});

describe('selectPage', () => {
  const multi = asset('multi.drawio');
  it('returns the file as is without a page', () => {
    expect(selectPage(multi, null)).toEqual({ ok: true, xml: multi });
  });
  it('selects a plain page into a one-page mxfile', () => {
    const r = selectPage(multi, 'Alpha');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.xml.startsWith('<mxfile><diagram name="Alpha"')).toBe(true);
    expect(r.xml.endsWith('</diagram></mxfile>')).toBe(true);
    expect(r.xml.match(/<diagram /g)).toHaveLength(1);
  });
  it('selects another page', () => {
    const names = [...multi.matchAll(/<diagram name="([^"]*)"/g)].map((m) => m[1] as string);
    expect(names.length).toBeGreaterThan(1);
    const r = selectPage(multi, names[1] as string);
    expect(r.ok && r.xml.includes(`name="${names[1]}"`)).toBe(true);
  });
  it('keeps a compressed diagram untouched', () => {
    const c = asset('compressed.drawio');
    const r = selectPage(c, 'C');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.xml).toBe(`<mxfile>${/<diagram[\s\S]*<\/diagram>/.exec(c)?.[0]}</mxfile>`);
  });
  it('reports a missing page', () => {
    expect(selectPage(multi, 'Nope')).toEqual({ ok: false, error: "Page 'Nope' not found" });
  });
  it('decodes entities in names and ignores other attributes', () => {
    const xml = `<?xml version="1.0"?><!-- c --><mxfile><diagram id="a" name='A &amp; &quot;B&quot; &#x41;&#66;>' x="1"><mxGraphModel/></diagram><diagram name="two"/></mxfile>`;
    const r = selectPage(xml, 'A & "B" AB>');
    expect(r.ok && r.xml.includes('<mxGraphModel/>')).toBe(true);
    expect(selectPage(xml, 'two').ok).toBe(true);
    expect(selectPage(xml.replace('name="two"', 'xname="two"'), 'two').ok).toBe(false);
  });
  it('accepts a bare mxGraphModel without a page', () => {
    expect(selectPage('<mxGraphModel><root/></mxGraphModel>', null).ok).toBe(true);
    expect(selectPage('<mxGraphModel><root/></mxGraphModel>', 'P')).toEqual({ ok: false, error: "Page 'P' not found" });
  });
  it.each(['', 'hello', '<html><body/></html>', '<svg xmlns="http://www.w3.org/2000/svg"/>', '<mxfileX/>'])('rejects the wrong root %j', (xml) => {
    expect(selectPage(xml, null)).toEqual({ ok: false, error: 'Not a draw.io file' });
    expect(selectPage(xml, 'P').ok).toBe(false);
  });
  it('does not take a page from a diagram inside a comment', () => {
    // A name inside an XML comment is not a page of the file; the first element after the prolog is the root.
    expect(selectPage('<!-- <mxfile> --><html/>', null).ok).toBe(false);
  });
});

describe('frame messages', () => {
  it('accepts a render message', () => {
    const m = { type: 'render', xml: '<mxfile/>', page: null, dark: true };
    expect(validateRenderMessage(m)).toBe(m);
    const n = { type: 'render', xml: '<mxfile/>', page: 2, dark: false };
    expect(validateRenderMessage(n)).toBe(n);
  });
  it.each([
    null,
    'render',
    [],
    {},
    { type: 'render', xml: '<mxfile/>', page: null },
    { type: 'render', xml: '<mxfile/>', page: null, dark: true, extra: 1 },
    { type: 'render', xml: 1, page: null, dark: true },
    { type: 'render', xml: '<mxfile/>', page: -1, dark: true },
    { type: 'render', xml: '<mxfile/>', page: 1.5, dark: true },
    { type: 'render', xml: '<mxfile/>', page: '1', dark: true },
    { type: 'render', xml: '<mxfile/>', page: null, dark: 'yes' },
    { type: 'other', xml: '<mxfile/>', page: null, dark: true },
    { type: 'render', xml: 'x'.repeat(MAX_XML + 1), page: null, dark: true },
  ])('rejects the render message %j', (m) => {
    expect(validateRenderMessage(m)).toBeNull();
  });
  it('accepts size and error messages', () => {
    const size = { type: 'size', height: 240 };
    const error = { type: 'error', message: 'boom' };
    expect(validateFrameMessage(size)).toBe(size);
    expect(validateFrameMessage(error)).toBe(error);
  });
  it.each([
    null,
    {},
    { type: 'size' },
    { type: 'size', height: 0 },
    { type: 'size', height: 10001 },
    { type: 'size', height: Number.NaN },
    { type: 'size', height: '5' },
    { type: 'size', height: 5, width: 5 },
    { type: 'error', message: 'x'.repeat(501) },
    { type: 'error', message: 5 },
    { type: 'error', message: 'a', extra: 1 },
    { type: 'debug', height: 5 },
  ])('rejects the frame message %j', (m) => {
    expect(validateFrameMessage(m)).toBeNull();
  });
});

describe('vendored viewer', () => {
  const dir = new URL('../../vendor/drawio/', import.meta.url);
  const version = readFileSync(fileURLToPath(new URL('VERSION', dir)), 'utf8');
  const file = readFileSync(fileURLToPath(new URL('viewer-static.min.js', dir)));

  it('matches the SHA-256 in VERSION', () => {
    const expected = /^viewer-static\.min\.js sha256: ([0-9a-f]{64})$/m.exec(version)?.[1];
    expect(expected).toBeDefined();
    expect(createHash('sha256').update(file).digest('hex')).toBe(expected);
  });
  it('records the tag, the commit and the licenses', () => {
    expect(version).toMatch(/^tag: v32\.7\.4$/m);
    expect(version).toMatch(/^commit: [0-9a-f]{40}$/m);
    expect(version).toMatch(/^draw\.war sha256: [0-9a-f]{64}$/m);
    for (const name of ['LICENSE', 'STENCILS-LICENSE']) expect(readFileSync(fileURLToPath(new URL(name, dir)), 'utf8').length).toBeGreaterThan(100);
  });
});
