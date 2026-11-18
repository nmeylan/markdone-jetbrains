// IDE <-> page messages, protocol version 2.7 (protocol/PROTOCOL.md).
import { MAX_PATTERN_LENGTH } from './drawio-ref';
import { MAX_PATHS, MAX_PATH_LENGTH } from './paths';

export const PROTOCOL_VERSION = 2;

export interface Patch {
  start: number;
  end: number;
  text: string;
}

export interface IncomingChange {
  from: number;
  to: number;
  insert: string;
}

export type IdeMessage =
  | { type: 'open'; docId: string; writable: boolean }
  | { type: 'activate'; docId: string; top?: number; selection?: { anchor: number; head: number } }
  | { type: 'close'; docId: string }
  | { type: 'reload'; docId: string }
  | { type: 'change'; docId: string; stamp: number; length: number; changes: IncomingChange[]; selection?: { anchor: number; head: number } }
  | { type: 'ack'; docId: string; seq: number; stamp: number; length: number }
  | { type: 'reject'; docId: string; seq: number }
  | { type: 'flush'; docId: string; seq: number }
  | { type: 'writable'; docId: string; writable: boolean }
  | { type: 'paths'; docId: string; exist: string[]; missing: string[] }
  | { type: 'theme'; dark: boolean; fontFamily: string; fontSizePx: number; zoom: number }
  | { type: 'css'; global: string; project: string | null }
  | { type: 'settings'; remoteImages: boolean; math: boolean; mermaid: boolean; highlight: boolean; softBreaks: boolean; drawio: boolean; drawioPattern: string; style: MdStyle; doubleClickEdit: boolean; vim: boolean; vimrc: VimMapping[]; colorTheme: MdColorTheme }
  | { type: 'fileChanged'; docId: string; path: string };

/** A key mapping for the page's Vim (from the user's .ideavimrc). */
export interface VimMapping {
  mode: 'all' | 'normal' | 'insert' | 'visual' | 'operator';
  remap: boolean;
  lhs: string;
  rhs: string;
}
const MAX_MAPPINGS = 500;
const VIM_MODES: readonly string[] = ['all', 'normal', 'insert', 'visual', 'operator'] satisfies VimMapping['mode'][];

/** Built-in styles: `<html data-md-style="...">`. */
export type MdStyle = 'default' | 'compact' | 'serif';
const STYLES: readonly string[] = ['default', 'compact', 'serif'] satisfies MdStyle[];

/** Color themes: `<html data-md-color-theme="...">`. `ide` follows the IDE light/dark theme. */
export type MdColorTheme = 'ide' | 'tokyo-night' | 'tokyo-storm' | 'tokyo-moon' | 'tokyo-light';
const COLOR_THEMES: readonly string[] = ['ide', 'tokyo-night', 'tokyo-storm', 'tokyo-moon', 'tokyo-light'] satisfies MdColorTheme[];

export type DocMessage = Extract<IdeMessage, { docId: string }>;

export type PageMessage =
  | { type: 'ready'; protocol: number }
  | { type: 'opened'; docId: string; docStamp: number }
  | { type: 'activated'; docId: string }
  | { type: 'loadError'; docId: string; reason: 'fetch' | 'stamp' }
  | { type: 'diverged'; docId: string; pageLength: number; expectedLength: number }
  | { type: 'viewport'; docId: string; top: number; anchor: number; head: number }
  | { type: 'patch'; docId: string; seq: number; baseStamp: number; patches: Patch[] }
  | { type: 'link'; docId: string; href: string; kind: 'external' | 'relative' | 'anchor' }
  | { type: 'command'; docId: string; name: 'toggleMode' | 'find' | 'undo' | 'redo' | 'zoomIn' | 'zoomOut' | 'zoomReset' }
  | {
      type: 'command';
      docId: string;
      name: 'contextMenu';
      x: number;
      y: number;
      from: number;
      to: number;
      table?: { from: number; to: number; row: number; column: number };
    }
  | { type: 'command'; docId: string; name: 'tableAction'; action: TableAction; from: number; to: number; row: number; column: number }
  | { type: 'command'; docId: string; name: 'gotoSource'; pos: number }
  | { type: 'command'; docId: string; name: 'pathsExist'; paths: string[] };

export type TableAction =
  | 'insertRowAbove'
  | 'insertRowBelow'
  | 'insertColumnLeft'
  | 'insertColumnRight'
  | 'removeRow'
  | 'removeColumn'
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'
  | 'alignNone'
  | 'reformat';

type CommandMessage = Extract<PageMessage, { type: 'command' }>;
/** A `command` without `type` and `docId` (the controller adds the active document). */
export type Command = CommandMessage extends infer M ? (M extends CommandMessage ? Omit<M, 'type' | 'docId'> : never) : never;

/** Host function that carries each page message (PROTOCOL.md "Page → IDE messages"). */
export function hostFunction(msg: PageMessage): 'ready' | 'patch' | 'link' | 'command' {
  switch (msg.type) {
    case 'ready':
    case 'opened':
    case 'activated':
    case 'loadError':
    case 'diverged':
    case 'viewport':
      return 'ready';
    default:
      return msg.type;
  }
}

type FieldKind = 'number' | 'offset' | 'offset?' | 'string' | 'boolean' | 'string|null' | 'changes' | 'selection?' | 'style' | 'mappings' | 'colorTheme' | 'strings' | 'pattern' | 'filePath';

const FIELDS: Record<IdeMessage['type'], Record<string, FieldKind>> = {
  open: { docId: 'string', writable: 'boolean' },
  activate: { docId: 'string', top: 'offset?', selection: 'selection?' },
  close: { docId: 'string' },
  reload: { docId: 'string' },
  change: { docId: 'string', stamp: 'number', length: 'offset', changes: 'changes', selection: 'selection?' },
  ack: { docId: 'string', seq: 'number', stamp: 'number', length: 'offset' },
  reject: { docId: 'string', seq: 'number' },
  flush: { docId: 'string', seq: 'number' },
  writable: { docId: 'string', writable: 'boolean' },
  paths: { docId: 'string', exist: 'strings', missing: 'strings' },
  fileChanged: { docId: 'string', path: 'filePath' },
  theme: { dark: 'boolean', fontFamily: 'string', fontSizePx: 'number', zoom: 'number' },
  css: { global: 'string', project: 'string|null' },
  settings: { remoteImages: 'boolean', math: 'boolean', mermaid: 'boolean', highlight: 'boolean', softBreaks: 'boolean', drawio: 'boolean', drawioPattern: 'pattern', style: 'style', doubleClickEdit: 'boolean', vim: 'boolean', vimrc: 'mappings', colorTheme: 'colorTheme' },
};

/** Longest path of a `fileChanged` (the longest draw.io reference of the page is 1000 characters). */
const MAX_FILE_PATH = 1000;

const isOffset = (v: unknown): boolean => Number.isSafeInteger(v) && (v as number) >= 0;

function exactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(value, k));
}

function fieldOk(value: unknown, kind: FieldKind): boolean {
  switch (kind) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'offset':
      return isOffset(value);
    case 'offset?':
      return value === undefined || isOffset(value);
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'string|null':
      return value === null || typeof value === 'string';
    case 'changes':
      return (
        Array.isArray(value) &&
        value.every(
          (c) =>
            exactKeys(c, ['from', 'to', 'insert']) &&
            isOffset(c['from']) &&
            isOffset(c['to']) &&
            (c['from'] as number) <= (c['to'] as number) &&
            typeof c['insert'] === 'string',
        )
      );
    case 'style':
      return typeof value === 'string' && STYLES.includes(value);
    case 'mappings':
      return (
        Array.isArray(value) &&
        value.length <= MAX_MAPPINGS &&
        value.every(
          (m) =>
            exactKeys(m, ['mode', 'remap', 'lhs', 'rhs']) &&
            typeof m['mode'] === 'string' &&
            VIM_MODES.includes(m['mode']) &&
            typeof m['remap'] === 'boolean' &&
            typeof m['lhs'] === 'string' &&
            typeof m['rhs'] === 'string' &&
            m['lhs'] !== '' &&
            m['rhs'] !== '',
        )
      );
    case 'strings':
      return Array.isArray(value) && value.length <= MAX_PATHS && value.every((v) => typeof v === 'string' && v.length <= MAX_PATH_LENGTH);
    case 'pattern':
      return typeof value === 'string' && value.length <= MAX_PATTERN_LENGTH;
    case 'filePath':
      return typeof value === 'string' && value.length >= 1 && value.length <= MAX_FILE_PATH;
    case 'colorTheme':
      return typeof value === 'string' && COLOR_THEMES.includes(value);
    case 'selection?':
      return value === undefined || (exactKeys(value, ['anchor', 'head']) && isOffset(value['anchor']) && isOffset(value['head']));
  }
}

/** Returns the message if it matches the protocol schema, else null. Unknown fields are refused. */
export function validateIdeMessage(msg: unknown): IdeMessage | null {
  if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return null;
  const record = msg as Record<string, unknown>;
  const type = record['type'];
  if (typeof type !== 'string' || !Object.hasOwn(FIELDS, type)) return null;
  const fields = FIELDS[type as IdeMessage['type']];
  for (const key of Object.keys(record)) {
    if (key !== 'type' && !Object.hasOwn(fields, key)) return null;
  }
  for (const [name, kind] of Object.entries(fields)) {
    if (!Object.hasOwn(record, name) && kind !== 'selection?' && kind !== 'offset?') return null;
    if (!fieldOk(record[name], kind)) return null;
  }
  return msg as IdeMessage;
}
