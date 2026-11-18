/*
 * L4 contract (web side): replays protocol/fixtures/v2-*.json against the page logic
 * (Controller with a fake view). Given the IDE messages, the page emits exactly the page
 * messages, and the text matches `textAfterStep` / `finalText`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { EditorState, type Transaction, type TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';

import { Controller, type ScrollRestore, type ViewPort } from '../../src/controller';
import { type DocMessage, PROTOCOL_VERSION, type PageMessage, type Patch, hostFunction, validateIdeMessage } from '../../src/protocol';

const dir = fileURLToPath(new URL('../../../protocol/fixtures/', import.meta.url));
const fixtures = readdirSync(dir).filter((f) => /^v2-.*\.json$/.test(f));

interface Step {
  from: 'page' | 'ide';
  fn?: string;
  msg: Record<string, unknown>;
}

interface Fixture {
  steps: Step[];
  initialText: string;
  finalText?: string;
  textAfterStep?: Record<string, string>;
}

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
  topPos(): number {
    return 0;
  }
  scrollToLine(): void {}
  prepare(): void {}
  contentHeight(): number {
    return 0;
  }
  afterPaint(): Promise<void> {
    return Promise.resolve();
  }
}

describe('protocol fixtures (page side)', () => {
  it('there are v2 fixtures', () => expect(fixtures.length).toBeGreaterThan(0));

  it.each(fixtures)('%s', async (file) => {
    const fixture = JSON.parse(readFileSync(`${dir}${file}`, 'utf8')) as Fixture;
    const stamps = new Map<string, number>();
    for (const s of fixture.steps) if (s.msg['type'] === 'opened') stamps.set(s.msg['docId'] as string, s.msg['docStamp'] as number);

    const view = new FakeView();
    const sent: { fn: string; msg: PageMessage }[] = [];
    const frames: (() => void)[] = [];
    const controller = new Controller({
      view,
      send: (msg) => sent.push({ fn: hostFunction(msg), msg }),
      fetchDoc: (docId) => Promise.resolve({ ok: true, text: fixture.initialText, stamp: stamps.get(docId) ?? 0 }),
      extensions: EditorState.lineSeparator.of('\n'),
      schedule: (cb) => frames.push(cb),
      delay: (cb) => frames.push(cb),
      now: () => 0,
      lastUserInput: () => 0,
    });
    view.onUpdate = (trs) => controller.afterUpdate(trs);
    const settle = async () => {
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r));
        for (const f of frames.splice(0)) f();
      }
    };
    let docId = '';

    for (const [i, step] of fixture.steps.entries()) {
      if (step.from === 'ide') {
        const msg = validateIdeMessage(step.msg);
        expect(msg, JSON.stringify(step.msg)).not.toBeNull();
        if (msg && 'docId' in msg) docId = msg.docId;
        controller.receive(msg as DocMessage);
        await settle();
      } else if (step.msg['type'] === 'ready') {
        // Sent by main.ts when the host appears.
        expect(step).toEqual({ from: 'page', fn: 'ready', msg: { type: 'ready', protocol: PROTOCOL_VERSION } });
      } else {
        if (sent.length === 0) {
          // Nothing pending: the step is a user action in the page.
          if (step.msg['type'] === 'patch') {
            const patches = step.msg['patches'] as Patch[];
            view.dispatch({ changes: patches.map((p) => ({ from: p.start, to: p.end, insert: p.text })), userEvent: 'input' });
          } else if (step.msg['type'] === 'command') {
            // The fixture has no `activate`: give the docId (a key reaches the active document only).
            controller.command({ name: step.msg['name'] as 'undo' | 'redo' }, step.msg['docId'] as string);
          }
          await settle();
        }
        expect(sent.shift(), `step ${i}`).toEqual({ fn: step.fn, msg: step.msg });
      }
      const expected = fixture.textAfterStep?.[String(i)];
      if (expected !== undefined) expect(controller.stateOf(docId)?.doc.toString(), `text after step ${i}`).toBe(expected);
    }
    expect(sent).toEqual([]);
    if (fixture.finalText !== undefined) expect(controller.stateOf(docId)?.doc.toString()).toBe(fixture.finalText);
  });
});
