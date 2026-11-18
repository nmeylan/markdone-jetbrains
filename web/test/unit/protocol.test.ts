import { describe, expect, it } from 'vitest';

import { validateIdeMessage } from '../../src/protocol';

const id = '0123456789abcdef0123456789abcdef';

describe('validateIdeMessage (protocol v2.4)', () => {
  it.each([
    { type: 'open', docId: id, writable: true },
    { type: 'activate', docId: id },
    { type: 'activate', docId: id, top: 120, selection: { anchor: 5, head: 3 } },
    { type: 'activate', docId: id, top: 0 },
    { type: 'close', docId: id },
    { type: 'reload', docId: id },
    { type: 'change', docId: id, stamp: 3, length: 4, changes: [{ from: 0, to: 1, insert: 'x' }] },
    { type: 'change', docId: id, stamp: 3, length: 4, changes: [], selection: { anchor: 1, head: 2 } },
    { type: 'ack', docId: id, seq: 1, stamp: 42, length: 0 },
    { type: 'reject', docId: id, seq: 1 },
    { type: 'flush', docId: id, seq: 7 },
    { type: 'writable', docId: id, writable: false },
    { type: 'theme', dark: true, fontFamily: 'Inter', fontSizePx: 13, zoom: 1 },
    { type: 'css', global: '', project: null },
    { type: 'settings', remoteImages: true, math: true, mermaid: false, highlight: true, softBreaks: true, style: 'default', doubleClickEdit: false, vim: false, colorTheme: 'ide', vimrc: [] },
    { type: 'settings', remoteImages: false, math: false, mermaid: true, highlight: false, softBreaks: true, style: 'compact', doubleClickEdit: false, vim: false, colorTheme: 'ide', vimrc: [] },
    { type: 'settings', remoteImages: false, math: true, mermaid: true, highlight: true, softBreaks: true, style: 'serif', doubleClickEdit: false, vim: false, colorTheme: 'ide', vimrc: [] },
    { type: 'settings', remoteImages: false, math: true, mermaid: true, highlight: true, softBreaks: true, style: 'default', doubleClickEdit: false, vim: true, colorTheme: 'ide', vimrc: [{ mode: 'operator', remap: true, lhs: '<Space>a', rhs: ':w<CR>' }] },
    { type: 'settings', remoteImages: false, math: true, mermaid: true, highlight: true, softBreaks: true, style: 'default', doubleClickEdit: false, vim: false, colorTheme: 'tokyo-storm', vimrc: [] },
  ])('accepts $type', (msg) => {
    expect(validateIdeMessage(msg)).toBe(msg);
  });

  it.each([
    null,
    'flush',
    [],
    {},
    { type: 'unknown' },
    { type: 'flush', docId: id },
    { type: 'flush', docId: id, seq: '1' },
    { type: 'flush', docId: id, seq: Number.NaN },
    { type: 'flush', docId: id, seq: 1, extra: true },
    { type: 'flush', seq: 1 },
    { type: 'open', docId: id },
    { type: 'theme', dark: 'yes', fontFamily: 'Inter', fontSizePx: 13, zoom: 1 },
    { type: 'css', global: '', project: 3 },
    { type: 'change', docId: id, stamp: 3, length: 4, changes: [{ from: 2, to: 1, insert: '' }] },
    { type: 'change', docId: id, stamp: 3, length: 4, changes: [{ from: -1, to: 1, insert: '' }] },
    { type: 'change', docId: id, stamp: 3, length: 4, changes: [{ from: 0, to: 1.5, insert: '' }] },
    { type: 'change', docId: id, stamp: 3, length: 4, changes: [{ from: 0, to: 1, insert: 'x', extra: 1 }] },
    { type: 'change', docId: id, stamp: 3, length: 4, changes: {} },
    { type: 'change', docId: id, stamp: 3, length: 4, changes: [], selection: { anchor: 1 } },
    { type: 'change', docId: id, stamp: 3, length: 4, changes: [], selection: null },
    { type: 'ack', docId: id, seq: 1, stamp: 42 },
    { type: 'ack', docId: id, seq: 1, stamp: 42, length: -1 },
    { type: 'change', docId: id, stamp: 3, changes: [] },
    { type: 'change', docId: id, stamp: 3, length: 1.5, changes: [] },
    { type: 'key', docId: id, name: 'undo' },
    { type: 'toString' },
    // Activate (2.4): `top` an offset, `selection` exactly anchor and head.
    { type: 'activate', docId: id, top: -1, selection: { anchor: 0, head: 0 } },
    { type: 'activate', docId: id, top: 1.5 },
    { type: 'activate', docId: id, top: '3' },
    { type: 'activate', docId: id, top: null },
    { type: 'activate', docId: id, top: 0, selection: { anchor: 0 } },
    { type: 'activate', docId: id, top: 0, selection: { anchor: 0, head: 0, from: 0 } },
    { type: 'activate', docId: id, top: 0, scroll: 0 },
    // Settings (2.3): all five fields, exact key set, known style names only.
    { type: 'settings', remoteImages: true },
    { type: 'settings', remoteImages: true, math: true, mermaid: true, highlight: true, softBreaks: true, style: 'default', doubleClickEdit: false, vim: true, colorTheme: 'ide', vimrc: [{ mode: 'normal', remap: false, lhs: 'a' }] },
    { type: 'settings', remoteImages: true, math: true, mermaid: true, highlight: true, softBreaks: true, style: 'default', doubleClickEdit: false, vim: true, colorTheme: 'ide', vimrc: [{ mode: 'x', remap: false, lhs: 'a', rhs: 'b' }] },
    { type: 'settings', remoteImages: true, math: true, mermaid: true, highlight: true, softBreaks: true },
    { type: 'settings', remoteImages: true, math: true, mermaid: true, highlight: true, softBreaks: true, style: 'default', zoom: 1 },
    { type: 'settings', remoteImages: true, math: 'yes', mermaid: true, highlight: true, softBreaks: true, style: 'default', doubleClickEdit: false, vim: false, colorTheme: 'ide', vimrc: [] },
    { type: 'settings', remoteImages: true, math: true, mermaid: true, highlight: 1, softBreaks: true, style: 'default', doubleClickEdit: false, vim: false, colorTheme: 'ide', vimrc: [] },
    { type: 'settings', remoteImages: true, math: true, mermaid: true, highlight: true, softBreaks: true, style: 'Compact' },
    { type: 'settings', remoteImages: true, math: true, mermaid: true, highlight: true, softBreaks: true, style: 'dark' },
    { type: 'settings', remoteImages: true, math: true, mermaid: true, highlight: true, softBreaks: true, style: null },
    { type: 'settings', remoteImages: true, math: true, mermaid: true, highlight: true, softBreaks: true, style: 'toString' },
    { type: 'settings', remoteImages: true, math: true, mermaid: true, highlight: true, softBreaks: true, style: 'default', doubleClickEdit: false, vim: false, colorTheme: 'solarized', vimrc: [] },
    { type: 'settings', remoteImages: true, math: true, mermaid: true, highlight: true, softBreaks: true, style: 'default', doubleClickEdit: false, vim: false, vimrc: [] },
  ])('rejects %j', (msg) => {
    expect(validateIdeMessage(msg)).toBeNull();
  });
});
