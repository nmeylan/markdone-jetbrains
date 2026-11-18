// L1: Controller (PROTOCOL.md 2.1): text normalization, length check + `diverged`, read-only while loading,
// Patch coalescing for documents of 2 MB or more; 2.4 mode switch sync (`viewport`, `activate` with top/selection).
import { EditorState, type Transaction, type TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';

import { Controller, type FetchResult, RESTORE_FRAMES, type ScrollRestore, VIEWPORT_MS, type ViewPort, lookRestoring } from '../../src/controller';
import type { DocMessage, PageMessage } from '../../src/protocol';

class FakeView implements ViewPort {
  state = EditorState.create();
  onUpdate: (trs: readonly Transaction[]) => void = () => undefined;
  setState(state: EditorState): void {
    this.state = state;
  }
  dispatch(spec: TransactionSpec): void {
    const tr = this.state.update(spec);
    this.state = tr.state;
    this.onUpdate([tr]);
  }
  scrollSnapshot(): ScrollRestore {
    return { effect: EditorView.scrollIntoView(0), pos: 0 };
  }
  topLine(): number {
    return 1;
  }
  /** First visible line start (`topPos`); tests set it. */
  top = 0;
  topPos(): number {
    return this.top;
  }
  scrollToLine(): void {}
  prepare: (upTo?: number) => void = () => undefined;
  contentHeight(): number {
    return 0;
  }
  afterPaint(): Promise<void> {
    return Promise.resolve();
  }
}

const id = 'd';

async function setup(text: string) {
  const view = new FakeView();
  const sent: PageMessage[] = [];
  let fetch: () => Promise<FetchResult> = () => Promise.resolve({ ok: true, text, stamp: 0 });
  // Test clock: `delay` timers run in `advance`.
  let clock = 0;
  const timers: { at: number; cb: () => void }[] = [];
  const controller = new Controller({
    view,
    send: (msg) => sent.push(msg),
    fetchDoc: () => fetch(),
    extensions: EditorState.lineSeparator.of('\n'),
    schedule: (cb) => queueMicrotask(cb),
    delay: (cb, ms) => timers.push({ at: clock + ms, cb }),
    now: () => clock,
    lastUserInput: () => 0,
  });
  view.onUpdate = (trs) => controller.afterUpdate(trs);
  const tick = () => new Promise((r) => setTimeout(r));
  const receive = async (msg: DocMessage) => {
    controller.receive(msg);
    await tick();
  };
  await receive({ type: 'open', docId: id, writable: true });
  await receive({ type: 'activate', docId: id });
  sent.length = 0;
  /** A user edit as the view would dispatch it. */
  const type = async (from: number, to: number, insert: string, userEvent = 'input.type') => {
    view.dispatch({ changes: { from, to, insert }, userEvent });
    await tick();
  };
  /** Moves the clock to `to` and runs the timers that are due. */
  const advance = (to: number) => {
    clock = to;
    for (const t of timers.splice(0).sort((a, b) => a.at - b.at)) {
      if (t.at <= clock) t.cb();
      else timers.push(t);
    }
  };
  return { view, sent, controller, receive, type, advance, timers, setFetch: (f: () => Promise<FetchResult>) => (fetch = f) };
}

describe('text normalization (PROTOCOL.md 2.1)', () => {
  it('a paste with CRLF and CR becomes LF before it is a change; the patch has no \\r', async () => {
    const { view, sent } = await setup('ab');
    // As CodeMirror dispatches a paste: caret after the inserted text (9 = before normalization).
    view.dispatch({ changes: { from: 1, insert: 'x\r\ny\rz\r\n' }, selection: { anchor: 9 }, userEvent: 'input.paste' });
    await new Promise((r) => setTimeout(r));
    expect(view.state.doc.toString()).toBe('ax\ny\nz\nb');
    expect(view.state.selection.main.head).toBe(7);
    expect(sent).toEqual([{ type: 'patch', docId: id, seq: 1, baseStamp: 0, patches: [{ start: 1, end: 1, text: 'x\ny\nz\n' }] }]);
  });

  it('IME/drop/any input with \\r is normalized too; IDE changes are not touched', async () => {
    const { view, receive, type } = await setup('ab');
    await type(0, 2, '\r', 'input.drop');
    expect(view.state.doc.toString()).toBe('\n');
    await receive({ type: 'ack', docId: id, seq: 1, stamp: 1, length: 1 });
    await receive({ type: 'change', docId: id, stamp: 2, length: 3, changes: [{ from: 1, to: 1, insert: '\r\n' }] });
    expect(view.state.doc.toString()).toBe('\n\r\n');
  });
});

describe('length check (PROTOCOL.md 2.1)', () => {
  it('change with a wrong length: `diverged`, read-only, no patch; `opened` after reload ends it', async () => {
    const { view, sent, controller, receive, type, setFetch } = await setup('abc');
    await type(0, 0, 'L');
    sent.length = 0;
    // In flight: "L" at 0. IDE inserts "R" at 3 -> host text "abcR" (4); the IDE says 5.
    await receive({ type: 'change', docId: id, stamp: 1, length: 5, changes: [{ from: 3, to: 3, insert: 'R' }] });
    expect(sent).toEqual([{ type: 'diverged', docId: id, pageLength: 4, expectedLength: 5 }]);
    expect(view.state.readOnly).toBe(true);
    await type(0, 0, 'Q');
    expect(view.state.doc.toString()).toBe('LabcR');
    // The ack does not resend; a flush gets [] (after the viewport, protocol 2.4).
    await receive({ type: 'ack', docId: id, seq: 1, stamp: 2, length: 5 });
    await receive({ type: 'flush', docId: id, seq: 2 });
    expect(sent.slice(1)).toEqual([
      { type: 'viewport', docId: id, top: 0, anchor: 0, head: 0 },
      { type: 'patch', docId: id, seq: 2, baseStamp: 2, patches: [] },
    ]);
    setFetch(() => Promise.resolve({ ok: true, text: 'xyz', stamp: 3 }));
    await receive({ type: 'reload', docId: id });
    expect(sent.at(-1)).toEqual({ type: 'opened', docId: id, docStamp: 3 });
    expect(view.state.readOnly).toBe(false);
    expect(controller.syncState(id)?.locked).toBe(false);
    await type(0, 0, 'Q');
    expect(sent.at(-1)).toEqual({ type: 'patch', docId: id, seq: 3, baseStamp: 3, patches: [{ start: 0, end: 0, text: 'Q' }] });
  });

  it('ack with a wrong length (nothing pending): `diverged` once', async () => {
    const { sent, receive, type } = await setup('abc');
    await type(3, 3, 'X');
    sent.length = 0;
    await receive({ type: 'ack', docId: id, seq: 1, stamp: 1, length: 3 });
    await receive({ type: 'change', docId: id, stamp: 2, length: 9, changes: [{ from: 0, to: 0, insert: 'Y' }] });
    expect(sent).toEqual([{ type: 'diverged', docId: id, pageLength: 4, expectedLength: 3 }]);
  });

  it('matching lengths: nothing sent', async () => {
    const { sent, receive, type } = await setup('abc');
    await type(3, 3, 'X');
    await type(0, 0, 'P');
    // "P" is pending while "X" is in flight: no ack check now.
    await receive({ type: 'change', docId: id, stamp: 1, length: 4, changes: [{ from: 1, to: 1, insert: 'E' }] });
    await receive({ type: 'ack', docId: id, seq: 1, stamp: 2, length: 5 });
    await receive({ type: 'ack', docId: id, seq: 2, stamp: 3, length: 6 });
    expect(sent.map((m) => m.type)).toEqual(['patch', 'patch']);
  });
});

describe('read-only while loading (PROTOCOL.md 2.1)', () => {
  it('no local change and no patch during a reload fetch', async () => {
    const { view, sent, controller, receive, type, setFetch } = await setup('abc');
    let resolve: (r: FetchResult) => void = () => undefined;
    setFetch(() => new Promise((r) => (resolve = r)));
    await receive({ type: 'reload', docId: id });
    expect(view.state.readOnly).toBe(true);
    expect(controller.syncState(id)?.locked).toBe(true);
    await type(0, 0, 'X');
    expect(view.state.doc.toString()).toBe('abc');
    expect(sent).toEqual([]);
    resolve({ ok: true, text: 'abcd', stamp: 4 });
    await new Promise((r) => setTimeout(r));
    expect(sent).toEqual([{ type: 'opened', docId: id, docStamp: 4 }]);
    expect(view.state.readOnly).toBe(false);
    await type(0, 0, 'X');
    expect(view.state.doc.toString()).toBe('Xabcd');
  });
});

describe('A25: patch coalescing for documents of 2 MB or more', () => {
  const big = `${'x'.repeat(2_000_000)}\n`;
  const patches = (sent: PageMessage[]) => sent.filter((m) => m.type === 'patch');

  it('at most one patch per 300 ms; the changes in between are composed into one patch', async () => {
    const { sent, receive, type, advance, timers } = await setup(big);
    // First change after a quiet period: sent at once.
    await type(0, 0, 'a');
    expect(patches(sent)).toEqual([{ type: 'patch', docId: id, seq: 1, baseStamp: 0, patches: [{ start: 0, end: 0, text: 'a' }] }]);
    await receive({ type: 'ack', docId: id, seq: 1, stamp: 1, length: big.length + 1 });
    advance(50);
    await type(1, 1, 'b');
    advance(120);
    await type(2, 2, 'c');
    expect(patches(sent)).toHaveLength(1);
    expect(timers.map((t) => t.at)).toEqual([300]);
    advance(299);
    expect(patches(sent)).toHaveLength(1);
    advance(300);
    expect(patches(sent)[1]).toEqual({ type: 'patch', docId: id, seq: 2, baseStamp: 1, patches: [{ start: 1, end: 1, text: 'bc' }] });
  });

  it('one patch in flight: changes during it wait for the ack and the 300 ms pace', async () => {
    const { sent, receive, type, advance } = await setup(big);
    await type(0, 0, 'a');
    advance(100);
    await type(1, 1, 'b');
    advance(400);
    // Not acked yet: nothing more.
    expect(patches(sent)).toHaveLength(1);
    await receive({ type: 'ack', docId: id, seq: 1, stamp: 1, length: big.length + 1 });
    // 400 ms after the last send: the pending change goes at once after the ack.
    expect(patches(sent)[1]).toMatchObject({ seq: 2, patches: [{ start: 1, end: 1, text: 'b' }] });
  });

  it('flush is answered at once (undo/redo, mode switch, save)', async () => {
    const { sent, receive, type, advance } = await setup(big);
    await type(0, 0, 'a');
    await receive({ type: 'ack', docId: id, seq: 1, stamp: 1, length: big.length + 1 });
    advance(10);
    await type(1, 1, 'b');
    expect(patches(sent)).toHaveLength(1);
    await receive({ type: 'flush', docId: id, seq: 2 });
    expect(patches(sent)[1]).toMatchObject({ seq: 2, patches: [{ start: 1, end: 1, text: 'b' }] });
    // The timer finds nothing more to send.
    advance(300);
    expect(patches(sent)).toHaveLength(2);
  });

  it('flush while a patch is in flight: the reply goes right after the ack', async () => {
    const { view, sent, receive, type, advance } = await setup(big);
    await type(0, 0, 'a');
    advance(10);
    await type(1, 1, 'b');
    await receive({ type: 'flush', docId: id, seq: 2 });
    expect(patches(sent)).toHaveLength(1);
    expect(sent.filter((m) => m.type === 'viewport')).toEqual([]);
    // Typing, a selection change and a scroll before the ack are in the reply and its viewport.
    await type(2, 2, 'c');
    view.dispatch({ selection: { anchor: 3, head: 1 } });
    view.top = 7;
    await receive({ type: 'ack', docId: id, seq: 1, stamp: 1, length: big.length + 1 });
    expect(sent.slice(1)).toEqual([
      { type: 'viewport', docId: id, top: 7, anchor: 3, head: 1 },
      { type: 'patch', docId: id, seq: 2, baseStamp: 1, patches: [{ start: 1, end: 1, text: 'bc' }] },
    ]);
  });

  it('a document below 2 MB sends each change at once', async () => {
    const { sent, receive, type, advance } = await setup('small\n');
    await type(0, 0, 'a');
    await receive({ type: 'ack', docId: id, seq: 1, stamp: 1, length: 7 });
    advance(10);
    await type(1, 1, 'b');
    expect(patches(sent).map((p) => p.type === 'patch' && p.seq)).toEqual([1, 2]);
  });
});

describe('activation scroll restore', () => {
  it('a look-change restore transaction does not end it; another scroll into view does', async () => {
    const run = async (annotate: boolean) => {
      const view = new FakeView();
      // The content height changes in each frame: the restore runs RESTORE_FRAMES frames.
      let height = 0;
      view.contentHeight = () => ++height;
      const snapshot = EditorView.scrollIntoView(5);
      view.scrollSnapshot = () => ({ effect: snapshot, pos: 5 });
      let restores = 0;
      const controller = new Controller({
        view,
        send: () => undefined,
        fetchDoc: () => Promise.resolve({ ok: true, text: 'a\nb\nc\n', stamp: 0 }),
        extensions: [],
        schedule: (cb) => queueMicrotask(cb),
        delay: () => undefined,
        now: () => 0,
        lastUserInput: () => 0,
      });
      view.onUpdate = (trs) => {
        restores += trs.filter((tr) => tr.effects.some((e) => e === snapshot)).length;
        controller.afterUpdate(trs);
      };
      const tick = () => new Promise((r) => setTimeout(r));
      for (const docId of ['a', 'b']) controller.receive({ type: 'open', docId, writable: true });
      await tick();
      controller.receive({ type: 'activate', docId: 'a' });
      await tick();
      // Leaving `a` keeps its scroll snapshot; activating it again restores it.
      controller.receive({ type: 'activate', docId: 'b' });
      await tick();
      restores = 0;
      controller.receive({ type: 'activate', docId: 'a' });
      expect(restores).toBe(1);
      // A scroll into view during the restore frames: from the look change (annotated) or not.
      view.dispatch({ effects: EditorView.scrollIntoView(0), annotations: annotate ? lookRestoring.of(true) : [] });
      await tick();
      return restores;
    };
    expect(await run(true)).toBe(1 + RESTORE_FRAMES);
    expect(await run(false)).toBe(1);
  });
});

describe('mode switch sync (protocol 2.4)', () => {
  const viewport = (top: number, anchor: number, head: number) => ({ type: 'viewport', docId: id, top, anchor, head });

  it('scrolls send at most one `viewport` per 100 ms, with the latest values; selection changes and edits send none', async () => {
    const { view, sent, controller, advance } = await setup('one\ntwo\nthree');
    view.dispatch({ selection: { anchor: 1 } });
    advance(1000);
    expect(sent).toEqual([]);
    view.top = 4;
    // Scroll events (main.ts scroll listener).
    controller.viewChanged();
    controller.viewChanged();
    expect(sent).toEqual([]);
    advance(1000);
    expect(sent).toEqual([viewport(4, 1, 1)]);
    view.dispatch({ selection: { anchor: 3, head: 5 } });
    view.top = 8;
    controller.viewChanged();
    advance(1000 + VIEWPORT_MS - 1);
    expect(sent).toHaveLength(1);
    advance(1000 + VIEWPORT_MS);
    expect(sent).toEqual([viewport(4, 1, 1), viewport(8, 3, 5)]);
    // An edit or a selection change without a scroll sends nothing.
    view.dispatch({ changes: { from: 0, insert: 'x' } });
    view.dispatch({ selection: { anchor: 2 } });
    advance(3000);
    expect(sent.filter((m) => m.type === 'viewport')).toHaveLength(2);
  });

  it('a flush reply follows a `viewport` of the active document; another document gets none', async () => {
    const { view, sent, receive } = await setup('one\ntwo');
    view.dispatch({ selection: { anchor: 4, head: 6 } });
    view.top = 4;
    await receive({ type: 'flush', docId: id, seq: 1 });
    expect(sent).toEqual([viewport(4, 4, 6), { type: 'patch', docId: id, seq: 1, baseStamp: 0, patches: [] }]);
    sent.length = 0;
    await receive({ type: 'open', docId: 'e', writable: true });
    await receive({ type: 'flush', docId: 'e', seq: 1 });
    expect(sent).toEqual([
      { type: 'opened', docId: 'e', docStamp: 0 },
      { type: 'patch', docId: 'e', seq: 1, baseStamp: 0, patches: [] },
    ]);
  });

  it('activate with `top` and `selection`: that line at the top, the selection set (clamped), the stable restore; without them nothing moves', async () => {
    const { view, sent, receive } = await setup('one\ntwo\nthree');
    const specs: TransactionSpec[] = [];
    const dispatch = view.dispatch.bind(view);
    view.dispatch = (spec) => {
      specs.push(spec);
      dispatch(spec);
    };
    const prepared: (number | undefined)[] = [];
    view.prepare = (upTo?: number) => void prepared.push(upTo);
    // The content height changes once: the restore is applied again in the next frame.
    let height = 0;
    view.contentHeight = () => (height < 2 ? ++height : height);
    const target = (spec: TransactionSpec) => {
      const effect = [spec.effects ?? []].flat()[0] as { value: { range: { from: number }; y: string } } | undefined;
      return effect && { from: effect.value.range.from, y: effect.value.y };
    };

    // Tab switch (no fields) of the active document: no dispatch.
    await receive({ type: 'activate', docId: id });
    expect(specs).toEqual([]);

    // Mode switch: `top` inside line 2 (offset 6), head beyond the end.
    await receive({ type: 'activate', docId: id, top: 6, selection: { anchor: 2, head: 99 } });
    expect(view.state.selection.main).toMatchObject({ anchor: 2, head: 13 });
    expect(prepared).toEqual([4]);
    expect(specs.map(target)).toEqual([
      { from: 4, y: 'start' },
      { from: 4, y: 'start' },
    ]);
    expect(sent.at(-1)).toEqual({ type: 'activated', docId: id });

    // Another document, `top` beyond its end: the last line.
    await receive({ type: 'open', docId: 'e', writable: true });
    specs.length = 0;
    await receive({ type: 'activate', docId: 'e', top: 500 });
    expect(view.state.doc.toString()).toBe('one\ntwo\nthree');
    expect(specs.map(target)[0]).toEqual({ from: 8, y: 'start' });
    expect(view.state.selection.main.head).toBe(0);
  });

  it('activate with `top` during a reload waits for the new text, then restores on it', async () => {
    const { view, sent, receive, setFetch } = await setup('one\ntwo');
    let resolve: (r: FetchResult) => void = () => undefined;
    setFetch(() => new Promise<FetchResult>((r) => (resolve = r)));
    const targets: number[] = [];
    const dispatch = view.dispatch.bind(view);
    view.dispatch = (spec) => {
      const effect = [spec.effects ?? []].flat()[0] as { value: { range?: { from: number } } } | undefined;
      if (effect?.value.range) targets.push(effect.value.range.from);
      dispatch(spec);
    };
    // Kotlin: `reload` (too many Source edits), then `activate` with offsets of the new text.
    await receive({ type: 'reload', docId: id });
    await receive({ type: 'activate', docId: id, top: 13, selection: { anchor: 15, head: 14 } });
    expect(targets).toEqual([]);
    expect(sent.filter((m) => m.type === 'activated')).toEqual([]);
    resolve({ ok: true, text: 'zero\none\ntwo\nthree\n', stamp: 5 });
    await new Promise((r) => setTimeout(r));
    expect(view.state.doc.toString()).toBe('zero\none\ntwo\nthree\n');
    expect(view.state.selection.main).toMatchObject({ anchor: 15, head: 14 });
    expect(targets.at(-1)).toBe(13);
    expect(sent.map((m) => m.type)).toEqual(['opened', 'activated']);
  });

  /** Holds each paint until the test releases it; the content height changes in each frame. */
  const holdPaints = (view: FakeView) => {
    const paints: (() => void)[] = [];
    view.afterPaint = () => new Promise<void>((r) => paints.push(r));
    let height = 0;
    view.contentHeight = () => ++height;
    const targets: number[] = [];
    const dispatch = view.dispatch.bind(view);
    view.dispatch = (spec) => {
      const effect = [spec.effects ?? []].flat()[0] as { value: { range: { from: number } } } | undefined;
      if (effect) targets.push(effect.value.range.from);
      dispatch(spec);
    };
    const release = async () => {
      paints.shift()?.();
      await new Promise((r) => setTimeout(r));
    };
    return { paints, targets, release };
  };

  it('a flush during the restore of `activate` with `top` sends the target line, not the old scroll position', async () => {
    const { view, sent, receive } = await setup('one\ntwo\nthree');
    const { paints, release } = holdPaints(view);
    view.top = 0;
    await receive({ type: 'activate', docId: id, top: 9, selection: { anchor: 5, head: 5 } });
    // The scroll has not changed yet (next measure): the view still shows line 1.
    expect(paints).toHaveLength(1);
    await receive({ type: 'flush', docId: id, seq: 1 });
    expect(sent).toEqual([viewport(8, 5, 5), { type: 'patch', docId: id, seq: 1, baseStamp: 0, patches: [] }]);
    while (paints.length) await release();
    // After the restore the view's own first line is sent again.
    await receive({ type: 'ack', docId: id, seq: 1, stamp: 1, length: 13 });
    sent.length = 0;
    await receive({ type: 'flush', docId: id, seq: 2 });
    expect(sent[0]).toEqual(viewport(0, 5, 5));
  });

  it('two `activate` with `top`: the restore of the first one stops, the last target wins', async () => {
    const { view, sent, receive } = await setup('one\ntwo\nthree');
    const { paints, targets, release } = holdPaints(view);
    await receive({ type: 'activate', docId: id, top: 4 });
    await receive({ type: 'activate', docId: id, top: 8 });
    expect(targets).toEqual([4, 8]);
    await receive({ type: 'flush', docId: id, seq: 1 });
    expect(sent.find((m) => m.type === 'viewport')).toEqual(viewport(8, 0, 0));
    for (let i = 0; i < 2 * RESTORE_FRAMES + 2 && paints.length; i++) await release();
    expect(paints).toHaveLength(0);
    // Only the second restore is applied again.
    expect(targets.slice(2).length).toBeGreaterThan(0);
    expect(targets.slice(2).every((t) => t === 8)).toBe(true);
  });
});
