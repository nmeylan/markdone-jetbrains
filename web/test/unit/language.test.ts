// L1: the Markdown language (GFM, front matter, footnotes) built from @lezer/markdown.
import { describe, expect, it } from 'vitest';

import { markdownParser } from '../../src/language';

/** `Name[from,to]` of every node except Document and Paragraph, in tree order. */
function nodes(text: string, only?: RegExp): string[] {
  const out: string[] = [];
  markdownParser.parse(text).iterate({
    enter: (n) => {
      if (n.name === 'Document' || n.name === 'Paragraph') return;
      if (!only || only.test(n.name)) out.push(`${n.name}[${n.from},${n.to}]`);
    },
  });
  return out;
}

describe('GFM', () => {
  it('tables, task lists, strikethrough, autolinks', () => {
    const text = '| a | b |\n|---|--:|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n~~gone~~ www.example.com\n';
    const names = nodes(text).map((n) => n.split('[')[0]);
    expect(names).toContain('Table');
    expect(names.filter((n) => n === 'Task')).toHaveLength(2);
    expect(names).toContain('Strikethrough');
    expect(names).toContain('URL');
  });

  it('raw HTML stays an HTML node (no nested HTML language)', () => {
    expect(nodes('<div>\n<script>x</script>\n</div>\n', /HTML/)).toEqual(['HTMLBlock[0,31]']);
  });
});

describe('front matter', () => {
  it('a --- block at offset 0', () => {
    const text = '---\ntitle: x\nlist:\n  - a\n---\n# Heading\n';
    expect(nodes(text, /FrontMatter|Heading|HorizontalRule/)).toEqual([
      'FrontMatter[0,28]',
      'FrontMatterMark[0,3]',
      'FrontMatterMark[25,28]',
      'ATXHeading1[29,38]',
    ]);
  });

  it('closed by ... and at the end of the document without a newline', () => {
    expect(nodes('---\na: 1\n...', /FrontMatter$/)).toEqual(['FrontMatter[0,12]']);
    expect(nodes('---\n---', /FrontMatter$/)).toEqual(['FrontMatter[0,7]']);
  });

  it('only at offset 0, and only when closed', () => {
    expect(nodes('\n---\na: 1\n---\n', /FrontMatter/)).toEqual([]);
    expect(nodes('---\na: 1\n', /FrontMatter|HorizontalRule/)).toEqual(['HorizontalRule[0,3]']);
    expect(nodes('# T\n\n---\na\n---\n', /FrontMatter/)).toEqual([]);
  });

  it('closing fence found across the 64 KB read chunks', () => {
    const body = 'k: v\n'.repeat(30_000);
    const text = `---\n${body}---\nafter\n`;
    expect(nodes(text, /FrontMatter$/)).toEqual([`FrontMatter[0,${4 + body.length + 3}]`]);
  });
});

describe('footnotes', () => {
  it('references and definitions', () => {
    const text = 'Text[^1] and [^note].\n\n[^1]: First *note*.\n[^note]: Second\n    continued.\n\nAfter.\n';
    expect(nodes(text, /Footnote|^Emphasis$/)).toEqual([
      'FootnoteReference[4,8]',
      'FootnoteMark[4,6]',
      'FootnoteMark[7,8]',
      'FootnoteReference[13,20]',
      'FootnoteMark[13,15]',
      'FootnoteMark[19,20]',
      'FootnoteDefinition[23,42]',
      'FootnoteLabel[23,28]',
      'FootnoteMark[23,25]',
      'FootnoteMark[26,28]',
      'Emphasis[35,41]',
      'FootnoteDefinition[43,73]',
      'FootnoteLabel[43,51]',
      'FootnoteMark[43,45]',
      'FootnoteMark[49,51]',
    ]);
  });

  it('not a footnote: [^ x], empty label, plain link', () => {
    expect(nodes('[^ x] [^] [a](b)\n', /Footnote/)).toEqual([]);
  });

  it('a definition is not parsed as a link reference', () => {
    expect(nodes('[^a]: word\n', /LinkReference|Footnote(Definition)?$/)).toEqual(['FootnoteDefinition[0,10]']);
  });
});
