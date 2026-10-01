import { describe, expect, it } from 'vitest';
import { EditorState, Text } from '@codemirror/state';
import { language } from '@codemirror/language';
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight';
import { languageFor } from './config';
import { editorDocumentPolicy, LARGE_LINE_LIMIT } from './large-document';

function parsed(doc: string, format: 'json' | 'markdown', lightweight = false) {
  const state = EditorState.create({ doc, extensions: languageFor(format, doc.length, lightweight) });
  const parser = state.facet(language)!.parser;
  return parser.parse(doc);
}

describe('large document source parsing', () => {
  it('retains the original incremental JSON parser above one million characters', () => {
    const doc = `[\n${' {"value":123},\n'.repeat(80_000)} {"tail":true}\n]`;
    const tree = parsed(doc, 'json');
    expect(tree.resolveInner(doc.indexOf('123') + 1).name).toBe('Number');
    expect(tree.resolveInner(doc.lastIndexOf('true') + 1).name).toBe('True');
  });

  it('retains Markdown heading syntax at both ends of a large document', () => {
    const doc = `# First\n${'ordinary paragraph\n\n'.repeat(60_000)}# Last\n`;
    const tree = parsed(doc, 'markdown');
    expect(tree.resolveInner(3).name).toBe('ATXHeading1');
    expect(tree.resolveInner(doc.lastIndexOf('Last') + 1).name).toBe('ATXHeading1');
  });

  it('defaults large documents to unwrapped text and detects long lines without a full string copy', () => {
    const text = Text.of(['x'.repeat(LARGE_LINE_LIMIT + 1), ...Array(60_000).fill('ordinary paragraph')]);
    expect(editorDocumentPolicy(text)).toEqual({ large: true, wrap: false, lightweight: true, longLines: true });
    expect(editorDocumentPolicy('ordinary text')).toEqual({ large: false, wrap: true, lightweight: false, longLines: false });
  });

  it('bounds lexical work on a multi-megabyte JSON string and still styles following lines', () => {
    const doc = `{"value":"${'x'.repeat(2_000_000)}"}\n{"tail":42}`;
    const tree = parsed(doc, 'json', true);
    expect(tree.length).toBe(doc.length);
    expect(tree.resolveInner(doc.lastIndexOf('42') + 1).type.name).not.toBe('Document');
    let longest = 0;
    tree.iterate({ enter: node => { if (!node.type.isTop) longest = Math.max(longest, node.to - node.from); } });
    expect(longest).toBeLessThanOrEqual(LARGE_LINE_LIMIT);
  });

  it('keeps fenced-code state across lines in the bounded Markdown fallback', () => {
    const doc = `\`\`\`js\n${'x'.repeat(2_000_000)}\ncode\n\`\`\`\n# Last`;
    const tree = parsed(doc, 'markdown', true);
    const code = tree.resolveInner(doc.indexOf('\ncode') + 2).type.id;
    const heading = tree.resolveInner(doc.lastIndexOf('Last')).type.id;
    expect(code).not.toBe(heading);
    expect(code).not.toBe(0);
    expect(heading).not.toBe(0);
  });

  it('emits actual theme highlight tags for the first and last JSON numbers', () => {
    const doc = `[\n${' {"value":123},\n'.repeat(80_000)} {"tail":456}\n]`;
    const tree = parsed(doc, 'json');
    const ranges: number[] = [];
    highlightTree(tree, tagHighlighter([{ tag: tags.number, class: 'number' }]), (from, _to, style) => {
      if (style === 'number') ranges.push(from);
    });
    expect(ranges[0]).toBe(doc.indexOf('123'));
    expect(ranges.at(-1)).toBe(doc.lastIndexOf('456'));
  });

  it('bounds a distant viewport parse instead of building a complete fallback tree', () => {
    const doc = `${'plain\n'.repeat(200_000)}# Last\n`;
    const state = EditorState.create({ doc, extensions: languageFor('markdown', doc.length, true) });
    const from = doc.lastIndexOf('# Last');
    const tree = state.facet(language)!.parser.parse(doc, [], [{ from, to: doc.length }]);
    const headings: number[] = [];
    highlightTree(tree, tagHighlighter([{ tag: tags.heading, class: 'heading' }]), (start, _end, style) => {
      if (style === 'heading') headings.push(start);
    });
    expect(headings).toContain(0);
    expect(tree.length).toBe(doc.length - from);
    expect(tree.children.length).toBeLessThan(10);
  });
});
