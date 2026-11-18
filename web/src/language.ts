/*
 * Markdown language built from @lezer/markdown directly: CommonMark + GFM (Table,
 * Strikethrough, TaskList, Autolink) + front matter + footnotes + TeX math (heavy/math-syntax.ts).
 * No nested languages, so @codemirror/lang-html (and css, javascript) are not in the bundle.
 */
import { Language, defineLanguageFacet, languageDataProp } from '@codemirror/language';
import type { Input } from '@lezer/common';
import { type BlockContext, type Element, GFM, type InlineContext, type Line, type MarkdownConfig, parser as baseParser } from '@lezer/markdown';

import { MathSyntax } from './heavy/math-syntax';
import { WindowedParser, boundaryField, windowDriver } from './windowed/windowed-parser';

const FENCE = /^---[ \t]*$/;
const CLOSE = /^(?:---|\.\.\.)[ \t]*$/;

/** Start of the first line at or after `from` that closes a front matter block, or -1. */
function frontMatterClose(input: Input, from: number): number {
  const CHUNK = 1 << 16;
  let start = from; // document offset of text[0]
  let text = '';
  let read = from;
  for (;;) {
    const done = read >= input.length;
    if (!done) {
      const to = Math.min(input.length, read + CHUNK);
      text += input.read(read, to);
      read = to;
    }
    let i = 0;
    for (let nl = text.indexOf('\n'); ; nl = text.indexOf('\n', i)) {
      if (nl < 0) {
        if (!done) break;
        return i < text.length && CLOSE.test(text.slice(i)) ? start + i : -1;
      }
      if (CLOSE.test(text.slice(i, nl))) return start + i;
      i = nl + 1;
    }
    start += i;
    text = text.slice(i);
  }
}

/**
 * YAML/TOML-style front matter: a `---` line at offset 0, up to the next `---` or `...` line.
 * Not closed -> no front matter (the first line is a horizontal rule, as in CommonMark).
 */
export const FrontMatter: MarkdownConfig = {
  defineNodes: [{ name: 'FrontMatter', block: true }, 'FrontMatterMark'],
  parseBlock: [
    {
      name: 'FrontMatter',
      before: 'HorizontalRule',
      parse(cx: BlockContext, line: Line): boolean {
        if (cx.lineStart !== 0 || !FENCE.test(line.text)) return false;
        // BlockContext.input is internal in @lezer/markdown 1.8.1, but it is the only way to look ahead.
        const input = (cx as unknown as { input: Input }).input;
        const close = frontMatterClose(input, line.text.length + 1);
        if (close < 0) return false;
        const children: Element[] = [cx.elt('FrontMatterMark', 0, 3)];
        while (cx.lineStart < close && cx.nextLine()) {
          /* consume the content lines */
        }
        children.push(cx.elt('FrontMatterMark', cx.lineStart, cx.lineStart + 3));
        const end = cx.lineStart + line.text.length;
        cx.nextLine();
        cx.addElement(cx.elt('FrontMatter', 0, end, children));
        return true;
      },
    },
  ],
};

const FOOTNOTE_DEF = /^\[\^([^\]\s]+)\]:/;

/**
 * Footnotes: references `[^id]` (inline) and definitions `[^id]: text` (a block that starts a
 * line; following lines indented by 4 or more columns belong to it). Shown as styled source.
 */
export const Footnote: MarkdownConfig = {
  defineNodes: [{ name: 'FootnoteDefinition', block: true }, 'FootnoteReference', 'FootnoteLabel', 'FootnoteMark'],
  parseBlock: [
    {
      name: 'FootnoteDefinition',
      before: 'LinkReference',
      parse(cx: BlockContext, line: Line): boolean {
        if (line.indent - line.baseIndent >= 4) return false;
        const m = FOOTNOTE_DEF.exec(line.text.slice(line.pos));
        if (!m) return false;
        const start = cx.lineStart + line.pos;
        const labelEnd = start + m[0].length;
        const children: Element[] = [
          cx.elt('FootnoteLabel', start, labelEnd, [cx.elt('FootnoteMark', start, start + 2), cx.elt('FootnoteMark', labelEnd - 2, labelEnd)]),
          ...cx.parser.parseInline(line.text.slice(line.pos + m[0].length), labelEnd),
        ];
        let end = cx.lineStart + line.text.length;
        const indent = line.baseIndent + 4;
        while (cx.nextLine()) {
          if (line.pos === line.text.length || line.indent < indent) break;
          children.push(...cx.parser.parseInline(line.text.slice(line.pos), cx.lineStart + line.pos));
          end = cx.lineStart + line.text.length;
        }
        cx.addElement(cx.elt('FootnoteDefinition', start, end, children));
        return true;
      },
    },
  ],
  parseInline: [
    {
      name: 'FootnoteReference',
      before: 'Link',
      parse(cx: InlineContext, next: number, pos: number): number {
        // `[^`
        if (next !== 91 || cx.char(pos + 1) !== 94) return -1;
        let end = pos + 2;
        while (end < cx.end) {
          const ch = cx.char(end);
          if (ch === 93) break;
          if (ch === 32 || ch === 9 || ch === 10 || ch === 91) return -1;
          end++;
        }
        if (end >= cx.end || end === pos + 2) return -1;
        return cx.addElement(cx.elt('FootnoteReference', pos, end + 1, [cx.elt('FootnoteMark', pos, pos + 2), cx.elt('FootnoteMark', end, end + 1)]));
      },
    },
  ],
};

const data = defineLanguageFacet({ commentTokens: { block: { open: '<!--', close: '-->' } } });

export const markdownParser = baseParser.configure([GFM, FrontMatter, Footnote, MathSyntax, { props: [languageDataProp.add((type) => (type.isTop ? data : undefined))] }]);

/** Documents of 2 MB or more are parsed in a window around the viewport (src/windowed/). */
export const markdownLanguage = new Language(data, new WindowedParser(markdownParser), [boundaryField, windowDriver], 'markdown');
