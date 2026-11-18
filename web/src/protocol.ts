// IDE <-> page messages, protocol version 2.4 (protocol/PROTOCOL.md).

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
  | { type: 'theme'; dark: boolean; fontFamily: string; fontSizePx: number; zoom: number }
  | { type: 'css'; global: string; project: string | null }
  | { type: 'settings'; remoteImages: boolean; math: boolean; mermaid: boolean; highlight: boolean; softBreaks: boolean; style: MdStyle };

/** Built-in styles: `<html data-md-style="...">`. */
export type MdStyle = 'default' | 'compact' | 'serif';
const STYLES: readonly string[] = ['default', 'compact', 'serif'] satisfies MdStyle[];

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
  | { type: 'command'; docId: string; name: 'gotoSource'; pos: number };

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

type FieldKind = 'number' | 'offset' | 'offset?' | 'string' | 'boolean' | 'string|null' | 'changes' | 'selection?' | 'style';

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
  theme: { dark: 'boolean', fontFamily: 'string', fontSizePx: 'number', zoom: 'number' },
  css: { global: 'string', project: 'string|null' },
  settings: { remoteImages: 'boolean', math: 'boolean', mermaid: 'boolean', highlight: 'boolean', softBreaks: 'boolean', style: 'style' },
};

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
