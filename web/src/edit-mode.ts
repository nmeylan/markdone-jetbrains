/*
 * How the page is edited (protocol 2.5 `settings.doubleClickEdit` and `settings.vim`).
 *
 * Double-click edit: no typing until a double-click (text can be selected and copied); Escape or leaving the page
 * ends the edit. Single clicks on check boxes, table buttons and links still work: they do not
 * need the page to be editable.
 * Vim: the `@replit/codemirror-vim` extension, loaded only when the setting is on. With double-click edit
 * on, Vim keeps working while waiting (move, visual mode, copy); Insert mode or a change command starts the edit.
 */
import { syntaxTree } from '@codemirror/language';
import { Compartment, EditorState, type Extension, Facet, Prec, type StateEffect } from '@codemirror/state';
import { Decoration, EditorView, type ViewUpdate } from '@codemirror/view';

import { remote } from './controller';
import type { Command, VimMapping } from './protocol';

type VimModule = typeof import('@replit/codemirror-vim');

export interface EditSettings {
  doubleClickEdit: boolean;
  vim: boolean;
  vimrc: VimMapping[];
}

/** True while the page waits for a double-click to be edited: a single click then leaves a rendered table as it is. */
export const awaitingDoubleClick = Facet.define<boolean, boolean>({ combine: (values) => values.some(Boolean) });

/** The block an edit started in (a paragraph, list item, table, code block...): the whole line when no block is there. */
function blockAt(state: EditorState, pos: number): { from: number; to: number } {
  let n = syntaxTree(state).resolveInner(pos, 1);
  while (n.parent && n.parent.name !== 'Document' && n.name !== 'ListItem') n = n.parent;
  if (n.name !== 'Document') return { from: n.from, to: n.to };
  const line = state.doc.lineAt(pos);
  return { from: line.from, to: line.to };
}

/*
 * With Vim on, a selection is also painted on the text itself (a mark above the line background), not
 * only by the editor's selection layer behind the text, which a line background can cover.
 */
const vimSelection: Extension = [
  EditorView.decorations.compute(['selection'], (state) =>
    Decoration.set(state.selection.ranges.filter((r) => !r.empty).map((r) => Decoration.mark({ class: 'md-vim-selection' }).range(r.from, r.to))),
  ),
  EditorView.theme({ '.md-vim-selection': { backgroundColor: 'var(--md-selection-bg)' } }),
];

/** Rendered widgets: a double-click on a formula or a diagram keeps the caret that their first click set. */
const WIDGETS = '.md-table-wrap, .md-math, .md-mermaid';
/** Elements that act on a single click: a double-click on them does not start an edit. */
const BUTTONS = '.md-task, .md-table-btn';

export class EditMode {
  private doubleClick = false;
  private armed = false;
  /** The block of the edit; a click outside it ends the edit. */
  private block: { from: number; to: number } | null = null;
  private vimOn = false;
  private vimModule: VimModule | null = null;
  private vimrc: VimMapping[] = [];
  /** The mappings now in the Vim module (they are global, not per editor). */
  private mapped = '[]';
  private readonly gate = new Compartment();
  private readonly vimSlot = new Compartment();
  /* Not editing: see the constructor. With Vim the caret stays visible (Vim draws its own). */
  private readonly waitingPlain: Extension;
  private readonly waitingVim: Extension;
  private readonly hooked = new WeakSet<object>();
  /** Add to the extensions of every document state. */
  readonly extension: Extension;

  constructor(
    private readonly getView: () => EditorView,
    private readonly command: (c: Command) => void,
    /** Document position of a mouse event (a rendered table cell maps to its source). */
    private readonly posAt: (view: EditorView, event: MouseEvent) => number | null,
  ) {
    /*
     * Not editing: the content stays focusable (select and copy text, move the caret), but no local
     * change gets through except the check box toggle. IDE changes (`remote`) always do. With Vim on,
     * a Vim change command is the start of an edit (see `armOnVimChange`): its change goes through.
     */
    const waiting: Extension = [
      awaitingDoubleClick.of(true),
      EditorView.editorAttributes.of({ class: 'md-awaiting-edit' }),
      EditorState.changeFilter.of(
        (tr) =>
          tr.annotation(remote) === true ||
          tr.isUserEvent('input.toggle') ||
          (this.vimOn && this.vimModule !== null && !tr.isUserEvent('input.paste') && !tr.isUserEvent('input.drop') && !tr.isUserEvent('delete.cut')),
      ),
    ];
    this.waitingVim = waiting;
    this.waitingPlain = [waiting, EditorView.theme({ '&.md-awaiting-edit .cm-cursor': { display: 'none !important' } })];
    // Before the Vim slot: Escape is checked before Vim sees it.
    this.extension = [
      this.gate.of([]),
      Prec.highest(
        EditorView.domEventHandlers({
          dblclick: (event, view) => this.onDoubleClick(event, view),
          mousedown: (event, view) => this.onMouseDown(event, view),
          keydown: (event, view) => this.onKeyDown(event, view),
          blur: (_event, view) => {
            this.onBlur(view);
            return false;
          },
        }),
      ),
      EditorView.updateListener.of((u) => {
        this.hookVim(u.view);
        this.armOnVimChange(u);
        if (this.armed && this.block && u.docChanged) this.block = { from: u.changes.mapPos(this.block.from, -1), to: u.changes.mapPos(this.block.to, 1) };
      }),
      this.vimSlot.of([]),
    ];
  }

  /** `settings`: applies the two toggles to the active state. */
  apply(s: EditSettings): void {
    this.doubleClick = s.doubleClickEdit;
    if (!this.doubleClick) {
      this.armed = false;
      this.block = null;
    }
    this.vimOn = s.vim;
    this.vimrc = s.vimrc;
    if (this.vimOn && !this.vimModule) {
      void import('@replit/codemirror-vim').then((m) => {
        this.vimModule = m;
        // The page has one undo stack, the IDE's: `u` and Ctrl-r go there.
        m.CodeMirror.commands.undo = () => this.command({ name: 'undo' });
        m.CodeMirror.commands.redo = () => this.command({ name: 'redo' });
        if (this.vimOn) this.sync();
        this.applyMappings();
      });
    }
    this.sync();
    this.applyMappings();
  }

  /** A document is shown (`setState`): it starts not edited, with the current settings. */
  prepare(state: EditorState): EditorState {
    this.armed = false;
    this.block = null;
    return state.update({ effects: this.effects() }).state;
  }

  private effects(): StateEffect<unknown>[] {
    return [
      this.gate.reconfigure(this.doubleClick && !this.armed ? (this.vimOn && this.vimModule ? this.waitingVim : this.waitingPlain) : []),
      // Above the default keymap, or the arrow keys move the caret without Vim (and end a visual selection).
      this.vimSlot.reconfigure(this.vimOn && this.vimModule ? Prec.high([this.vimModule.vim(), vimSelection]) : []),
    ];
  }

  /* Vim mappings are global in the module: clear the old ones, then add the current ones. */
  private applyMappings(): void {
    const vim = this.vimModule?.Vim;
    const key = JSON.stringify(this.vimOn ? this.vimrc : []);
    if (!vim || key === this.mapped) return;
    this.mapped = key;
    vim.mapclear();
    if (!this.vimOn) return;
    for (const m of this.vimrc) {
      const ctx = m.mode === 'all' ? '' : m.mode === 'operator' ? 'operatorPending' : m.mode;
      try {
        (m.remap ? vim.map : vim.noremap)(m.lhs, m.rhs, ctx);
      } catch (e) {
        console.warn(`markdone: vim mapping ${m.lhs} ignored`, e);
      }
    }
  }

  private sync(): void {
    const view = this.getView();
    // The empty state of a view without a document has no compartments.
    if (this.gate.get(view.state) === undefined) return;
    view.dispatch({ effects: this.effects() });
  }

  private onDoubleClick(event: MouseEvent, view: EditorView): boolean {
    const target = event.target as HTMLElement | null;
    if (!this.doubleClick || this.armed || event.button !== 0 || event.ctrlKey || event.metaKey || !target) return false;
    // Read-only for the IDE (or locked): nothing to edit.
    if (view.state.readOnly || target.closest(BUTTONS)) return false;
    // A table cell: its first click did not move the caret. Other widgets: their click did.
    const pos = target.closest('.md-table-wrap') ? this.posAt(view, event) : target.closest(WIDGETS) ? null : view.posAtCoords({ x: event.clientX, y: event.clientY });
    this.arm(view, pos);
    view.focus();
    return true;
  }

  private arm(view: EditorView, pos: number | null): void {
    this.armed = true;
    view.dispatch({ effects: this.effects(), selection: pos === null ? undefined : { anchor: pos } });
    this.block = blockAt(view.state, view.state.selection.main.head);
  }

  /* Vim: a mode change to Insert mode, or a change of the text, while waiting is the start of an edit. */
  private hookVim(view: EditorView): void {
    const cm = this.vimModule?.getCM(view);
    if (!cm || this.hooked.has(cm)) return;
    this.hooked.add(cm);
    cm.on('vim-mode-change', (e: { mode?: string }) => {
      if (e.mode === 'insert' && this.doubleClick && !this.armed) queueMicrotask(() => this.armOnVim(view));
    });
  }

  private armOnVimChange(u: ViewUpdate): void {
    if (!this.doubleClick || this.armed || !this.vimOn || !u.docChanged) return;
    if (u.transactions.some((tr) => tr.docChanged && tr.annotation(remote) !== true && !tr.isUserEvent('input.toggle'))) queueMicrotask(() => this.armOnVim(u.view));
  }

  private armOnVim(view: EditorView): void {
    if (this.doubleClick && !this.armed && !view.state.readOnly) this.arm(view, null);
  }

  /* A click outside the block of the edit ends it; the click itself then works as in the not-editing state. */
  private onMouseDown(event: MouseEvent, view: EditorView): boolean {
    if (!this.armed || !this.block || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
    if (pos < this.block.from || pos > this.block.to) this.disarm(view);
    return false;
  }

  /* Escape ends the edit. Vim keeps it while it is in Insert or Visual mode or has a pending command. */
  private onKeyDown(event: KeyboardEvent, view: EditorView): boolean {
    if (!this.doubleClick || !this.armed || event.key !== 'Escape' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
    if (this.vimOn && this.vimModule) {
      const vim = this.vimModule.getCM(view)?.state.vim;
      if (vim && (vim.insertMode || vim.visualMode || vim.inputState.keyBuffer.length > 0)) return false;
    }
    this.disarm(view);
    event.preventDefault();
    return true;
  }

  /* Focus left the page: end the edit. Not when the window lost focus, or focus went to a panel of the editor. */
  private onBlur(view: EditorView): void {
    if (!this.doubleClick || !this.armed) return;
    setTimeout(() => {
      if (this.armed && document.hasFocus() && !view.dom.contains(document.activeElement)) this.disarm(view);
    }, 0);
  }

  private disarm(view: EditorView): void {
    // The next edit starts in Normal mode.
    const cm = this.vimModule?.getCM(view);
    const vim = cm?.state.vim;
    // The API types want a core editor object; the wrapper is one.
    const core = cm as unknown as Parameters<VimModule['Vim']['exitInsertMode']>[0];
    if (cm && vim?.insertMode) this.vimModule?.Vim.exitInsertMode(core);
    else if (cm && vim?.visualMode) this.vimModule?.Vim.exitVisualMode(core);
    this.armed = false;
    this.block = null;
    view.dispatch({ effects: this.effects() });
  }
}
