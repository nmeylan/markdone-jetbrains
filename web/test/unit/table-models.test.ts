/*
 * L4 shared table fixture: every table of the corpus through the page's table model, written to
 * src/test/resources/table-models.json, which the Kotlin TableModelsCrossCheckTest reads (TableEdit
 * must read each table as Lezer does). `UPDATE_TABLE_MODELS=1 npm test` regenerates the file;
 * otherwise the test fails when the file differs. huge.md is not in git (generated) and is skipped.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { markdownParser } from '../../src/language';
import { tableModel } from '../../src/table-model';

const CORPUS = fileURLToPath(new URL('../../../src/test/resources/corpus/', import.meta.url));
const OUT = fileURLToPath(new URL('../../../src/test/resources/table-models.json', import.meta.url));

interface Entry {
  file: string;
  from: number;
  to: number;
  rows: string[][];
  aligns: ('left' | 'center' | 'right' | 'none')[];
}

function markdownFiles(dir = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(CORPUS, dir)).sort()) {
    const rel = dir ? `${dir}/${name}` : name;
    if (statSync(join(CORPUS, rel)).isDirectory()) out.push(...markdownFiles(rel));
    else if (name.endsWith('.md') && rel !== 'huge.md') out.push(rel);
  }
  return out;
}

function entries(): Entry[] {
  const out: Entry[] = [];
  for (const file of markdownFiles()) {
    // The IDE Document (and so the page) has `\n` line ends.
    const text = readFileSync(join(CORPUS, file), 'utf8').replace(/\r\n/g, '\n');
    markdownParser.parse(text).iterate({
      enter: (ref) => {
        if (ref.name !== 'Table') return;
        const model = tableModel(ref.node, (a, b) => text.slice(a, b));
        const base = ref.from;
        out.push({
          file,
          from: ref.from,
          to: ref.to,
          rows: model.rows.map((r) => r.cells.map((c) => text.slice(base + c.pos, base + c.end).trim())),
          aligns: model.aligns.map((a) => a || 'none'),
        });
        return false;
      },
    });
  }
  return out;
}

const serialize = (list: Entry[]) => `[\n${list.map((e) => JSON.stringify(e)).join(',\n')}\n]\n`;

describe('table-models.json', () => {
  it('matches the page table model of every corpus table', () => {
    const list = entries();
    expect(list.some((e) => e.file === 'styles/tables-edge.md')).toBe(true);
    const json = serialize(list);
    if (process.env['UPDATE_TABLE_MODELS'] === '1') writeFileSync(OUT, json);
    expect(existsSync(OUT), `${OUT} missing: run UPDATE_TABLE_MODELS=1 npm test`).toBe(true);
    expect(readFileSync(OUT, 'utf8') === json, 'table-models.json differs: run UPDATE_TABLE_MODELS=1 npm test').toBe(true);
  });
});
