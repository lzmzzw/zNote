// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView, type DecorationSet } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { liveMarkdownBlocks } from './live-markdown';

const source = '# Heading\n\n- **one**\n- [two](https://example.com)\n\n| Name | Value |\n| --- | --- |\n| a | 1 |\n\n```mermaid\nflowchart LR\nA --> B\n```\n';

function blocks(state: EditorState) {
  const ranges: { from: number; to: number; widget: unknown }[] = [];
  for (const set of state.facet(EditorView.decorations)) {
    if (typeof set === 'function') continue;
    (set as DecorationSet).between(0, state.doc.length, (from, to, value) => {
      if (value.spec.widget) ranges.push({ from, to, widget: value.spec.widget });
    });
  }
  return ranges;
}

test('keeps the active Markdown block editable while rendering other block types', () => {
  const state = EditorState.create({ doc: source, extensions: [markdown(), liveMarkdownBlocks(false)] });
  const rendered = blocks(state);
  expect(rendered).toHaveLength(3);
  expect(rendered.map(range => state.doc.sliceString(range.from, range.to))).toEqual([
    '- **one**\n- [two](https://example.com)',
    '| Name | Value |\n| --- | --- |\n| a | 1 |',
    '```mermaid\nflowchart LR\nA --> B\n```',
  ]);
  const moved = state.update({ selection: { anchor: source.indexOf('| Name') } }).state;
  expect(blocks(moved).some(range => range.from === source.indexOf('| Name'))).toBe(false);
  expect(moved.doc.toString()).toBe(source);
});
