// L1: URL targets in user CSS (PROTOCOL.md "CSS (M2)"). The CSSOM walk is in css.spec.ts.
import { describe, expect, it } from 'vitest';

import { allowedCssTarget, cssUrlTargets, withoutRemoteStyleUrls } from '../../src/theme';

describe('cssUrlTargets', () => {
  it.each([
    ['url(https://e.x/a.png)', ['https://e.x/a.png']],
    ['url( "https://e.x/a.png" )', ['https://e.x/a.png']],
    ["URL('a.png') no-repeat", ['a.png']],
    ['u\\72l(https://e.x/a.png)', ['https://e.x/a.png']],
    ['\\75 \\72 \\6c (https://e.x/a.png)', ['https://e.x/a.png']],
    ['url(https\\3a //e.x/a.png)', ['https://e.x/a.png']],
    ['/* c */url(/* not a comment */x)', ['/* not a comment */x']],
    ['image-set("https://e.x/1.png" 1x, url(b.png) 2x)', ['https://e.x/1.png', 'b.png']],
    ['-webkit-image-set("a.png" 1x)', ['a.png']],
    ['cross-fade(url(a.png), "b.png" 50%)', ['a.png', 'b.png']],
    ['linear-gradient(red, blue)', []],
    ['"url(x)"', []],
    ['"a" / "b"', []],
    ['local(Foo), url(f.woff2) format("woff2")', ['f.woff2']],
    ['src("https://e.x/a.png")', ['https://e.x/a.png']],
  ])('%s', (value, targets) => {
    expect(cssUrlTargets(value)).toEqual(targets);
  });
});

describe('allowedCssTarget', () => {
  const base = 'https://markdone.local/app/index.html';
  it.each([
    ['https://markdone.local/proj/t/fonts/a.woff2', true],
    ['x.png', true],
    ['/file/d/x.png', true],
    ['#mask', true],
    ['https://example.com/a.png', false],
    ['http://markdone.local/a.png', false],
    ['//example.com/a.png', false],
    ['https://markdone.local@example.com/a.png', false],
    ['https://markdone.local.example.com/a.png', false],
    ['https:\\\\example.com\\a.png', false],
    ['file:///etc/passwd', false],
    ['blob:https://markdone.local/x', false],
  ])('%s -> %s', (target, ok) => {
    expect(allowedCssTarget(target, base, true)).toBe(ok);
  });

  it('data: only when allowed (not in @font-face)', () => {
    expect(allowedCssTarget('data:image/png;base64,AA==', base, true)).toBe(true);
    expect(allowedCssTarget('data:font/woff2;base64,AA==', base, false)).toBe(false);
  });
});

// Mermaid source pre-filter: no remote url() reaches Mermaid's render element.
describe('withoutRemoteStyleUrls', () => {
  const base = 'https://markdone.local/app/index.html';
  it.each([
    ['classDef bad fill:#f00,background:url(https://evil.example/x)', 'classDef bad fill:#f00'],
    ['CLASSDEF bad fill:#f00,background:url(https://evil.example/x)', 'CLASSDEF bad fill:#f00'],
    ['  ClassDef bad fill:#f00,background:url(https://evil.example/x)', '  ClassDef bad fill:#f00'],
    ['STYLE A fill:#f00,background:url(https://evil.example/x)', 'STYLE A fill:#f00'],
    ['LinkStyle 0 stroke:#f00,background:url(https://evil.example/x)', 'LinkStyle 0 stroke:#f00'],
    ['classDef bad fill:#f00;;background:url(https://evil.example/y)', 'classDef bad fill:#f00;;'],
    ['classDef bad fill:#f00; background:url(https://evil.example/y);stroke:#0f0', 'classDef bad fill:#f00;;stroke:#0f0'],
    ['linkStyle default stroke:#f00,background:url(https://evil.example/x)', 'linkStyle default stroke:#f00'],
    ['linkStyle 1,2 stroke:#f00,background:url(https://evil.example/x)', 'linkStyle 1,2 stroke:#f00'],
    ['style id1 fill:#f00,background:url(https://evil.example/x),stroke:#00f', 'style id1 fill:#f00,stroke:#00f'],
    ['classDef bad background:url(https://a.example/1),fill:#f00,border-image:url(https://b.example/2)', 'classDef bad fill:#f00'],
    ['classDef bad background:u\\72l(https://evil.example/x),fill:#f00', 'classDef bad fill:#f00'],
    ['classDef bad background:\\75 \\72 \\6c (https://evil.example/x),fill:#f00', 'classDef bad fill:#f00'],
    ['classDef bad background-image:image-set("https://evil.example/x" 1x),fill:#f00', 'classDef bad fill:#f00'],
    ['classDef bad;background:url(https://evil.example/x)', 'classDef bad;'],
    ['A --> B; classDef bad fill:#f00,background:url(//evil.example/x)', 'A --> B; classDef bad fill:#f00'],
    // Local URLs and other text stay.
    ['classDef ok fill:url(#grad),background:url(/file/d/x.png),stroke:#f00', 'classDef ok fill:url(#grad),background:url(/file/d/x.png),stroke:#f00'],
    ['A["url(https://e.x/a)"] --> B', 'A["url(https://e.x/a)"] --> B'],
    ['flowchart LR\n  A --> B', 'flowchart LR\n  A --> B'],
  ])('%s', (src, out) => {
    expect(withoutRemoteStyleUrls(src, base)).toBe(out);
  });

  it('filters each line', () => {
    const src = 'stateDiagram-v2\n  [*] --> S\n  CLASSDEF bad fill:#f00,background:url(https://evil.example/x)\n  class S bad';
    expect(withoutRemoteStyleUrls(src, base)).toBe('stateDiagram-v2\n  [*] --> S\n  CLASSDEF bad fill:#f00\n  class S bad');
  });
});
