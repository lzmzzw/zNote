// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { liveMarkdownDecorations } from './live-markdown';

const source = '# Heading\n\n> quoted\n\n```json\n{"ok": true}\n```\n\n---\n';

function decorationsAt(cursor: number) {
  const state = EditorState.create({ doc: source, selection: { anchor: cursor }, extensions: [markdown()] });
  const view = { state, visibleRanges: [{ from: 0, to: state.doc.length }] };
  const result: { from: number; to: number; spec: Record<string, unknown> }[] = [];
  liveMarkdownDecorations(view).between(0, state.doc.length, (from, to, value) => {
    result.push({ from, to, spec: value.spec });
  });
  return result;
}

test('renders inactive quote, code fences and horizontal rule without changing the document', () => {
  const decorations = decorationsAt(0);
  const quote = source.indexOf('> quoted');
  const open = source.indexOf('```json');
  const close = source.indexOf('```', open + 3);
  const rule = source.indexOf('---');
  expect(decorations).toEqual(expect.arrayContaining([
    expect.objectContaining({ from: quote, to: quote + 2 }),
    expect.objectContaining({ from: open, to: open + 7 }),
    expect.objectContaining({ from: close, to: close + 3 }),
    expect.objectContaining({ from: rule, to: rule + 3 }),
  ]));
  expect(decorations.some(item => item.spec.class === 'live-code')).toBe(true);
  expect(decorations.some(item => String(item.spec.class).includes('live-code-hidden'))).toBe(true);
  expect(decorations.some(item => item.spec.attributes && (item.spec.attributes as Record<string, string>)['data-language'] === 'json')).toBe(true);
  expect(decorations.find(item => item.from === rule && item.to === rule + 3)?.spec.widget).toBeTruthy();
});

test.each(['> quoted', '```json', '```\n\n---', '---'])('reveals Markdown source on the active line: %s', fragment => {
  const from = source.indexOf(fragment);
  const decorations = decorationsAt(from);
  expect(decorations.some(item => item.from === from && item.to > from)).toBe(false);
  if (fragment === '```\n\n---') expect(decorations.some(item => String(item.spec.class).includes('live-code-hidden'))).toBe(false);
});
