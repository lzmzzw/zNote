// @vitest-environment jsdom
import { afterEach, beforeAll, expect, test } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, keymap, runScopeHandlers } from '@codemirror/view';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, redo, undo } from '@codemirror/commands';
import { LARGE_DOCUMENT_LIMIT, type NoteFormat } from '../document';
import { languageFor, splitMarkdownFence } from './config';

const views: EditorView[] = [];
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(() => views.splice(0).forEach((view) => view.destroy()));

function editor(doc = '', format: NoteFormat = 'markdown', size = doc.length) {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        history(),
        closeBrackets(),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap]),
        languageFor(format, size),
      ],
    }),
  });
  views.push(view);
  return view;
}
function type(view: EditorView, text: string) {
  const { from, to } = view.state.selection.main;
  for (const handler of view.state.facet(EditorView.inputHandler)) {
    if (handler(view, from, to, text, () => view.state.update(view.state.replaceSelection(text)))) return;
  }
  view.dispatch(view.state.update(view.state.replaceSelection(text), { userEvent: 'input.type' }));
}
function key(view: EditorView, key: string) {
  return runScopeHandlers(view, new KeyboardEvent('keydown', { key }), 'editor');
}

test('single backtick pairs, keeps the cursor inside, and skips the inserted closer', () => {
  const view = editor();
  type(view, '`');
  expect(view.state.doc.toString()).toBe('``');
  expect(view.state.selection.main.head).toBe(1);
  type(view, '中文 code');
  type(view, '`');
  expect(view.state.doc.toString()).toBe('`中文 code`');
  expect(view.state.selection.main.head).toBe(view.state.doc.length);
});

test('backtick wraps selected text and Backspace removes an empty pair', () => {
  const view = editor('中文');
  view.dispatch({ selection: { anchor: 2, head: 0 } });
  type(view, '`');
  expect(view.state.doc.toString()).toBe('`中文`');
  expect(view.state.selection.main.anchor).toBe(3);
  expect(view.state.selection.main.head).toBe(1);
  const empty = editor();
  type(empty, '`');
  expect(key(empty, 'Backspace')).toBe(true);
  expect(empty.state.doc.toString()).toBe('');
});

test('three typed backticks complete a fence and Enter creates an empty code line', () => {
  const view = editor();
  for (let i = 0; i < 3; i++) type(view, '`');
  expect(view.state.doc.toString()).toBe('``````');
  expect(view.state.selection.main.head).toBe(3);
  type(view, 'typescript');
  expect(key(view, 'Enter')).toBe(true);
  expect(view.state.doc.toString()).toBe('```typescript\n\n```');
  expect(view.state.selection.main.head).toBe(14);
  type(view, 'const value = 1;');
  expect(view.state.doc.toString()).toBe('```typescript\nconst value = 1;\n```');
  undo(view);
  expect(view.state.doc.toString()).toBe('');
  redo(view);
  expect(view.state.doc.toString()).toBe('```typescript\nconst value = 1;\n```');
});

test('an additional backtick skips a completed triple closer without duplicating it', () => {
  const view = editor();
  for (let i = 0; i < 4; i++) type(view, '`');
  expect(view.state.doc.toString()).toBe('``````');
  expect(view.state.selection.main.head).toBe(6);
});

test.each(['正文 ', '# 标题\n\n正文 ', '> 引用 ', '- 列表项 '])(
  'three backticks complete and skip a triple pair after existing text: %j',
  (prefix) => {
    const view = editor(prefix);
    view.dispatch({ selection: { anchor: prefix.length } });
    for (let i = 0; i < 3; i++) type(view, '`');
    expect(view.state.doc.toString()).toBe(prefix + '``````');
    expect(view.state.selection.main.head).toBe(prefix.length + 3);
    type(view, '`');
    expect(view.state.doc.toString()).toBe(prefix + '``````');
    expect(view.state.selection.main.head).toBe(prefix.length + 6);
  },
);

test('triple completion after text preserves all cursor and closing-bracket positions', () => {
  const view = editor('正文 \n\n说明 ');
  view.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(3), EditorSelection.cursor(8)]) });
  for (let i = 0; i < 3; i++) type(view, '`');
  expect(view.state.doc.toString()).toBe('正文 ``````\n\n说明 ``````');
  expect(view.state.selection.ranges.map((range) => range.head)).toEqual([6, 17]);
  type(view, '`');
  expect(view.state.doc.toString()).toBe('正文 ``````\n\n说明 ``````');
  expect(view.state.selection.ranges.map((range) => range.head)).toEqual([9, 20]);
  undo(view);
  expect(view.state.doc.toString()).toBe('正文 \n\n说明 ');
  redo(view);
  expect(view.state.doc.toString()).toBe('正文 ``````\n\n说明 ``````');
});

test('mixed empty-line and text-prefix cursors map both native and promoted triples', () => {
  const view = editor('\n\n正文 ');
  view.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(5)]) });
  for (let i = 0; i < 3; i++) type(view, '`');
  expect(view.state.doc.toString()).toBe('``````\n\n正文 ``````');
  expect(view.state.selection.ranges.map((range) => range.head)).toEqual([3, 14]);
  type(view, '`');
  expect(view.state.doc.toString()).toBe('``````\n\n正文 ``````');
  expect(view.state.selection.ranges.map((range) => range.head)).toEqual([6, 17]);
});

test('fence expansion preserves up to three spaces of Markdown indentation', () => {
  const view = editor('  ');
  view.dispatch({ selection: { anchor: 2 } });
  for (let i = 0; i < 3; i++) type(view, '`');
  key(view, 'Enter');
  expect(view.state.doc.toString()).toBe('  ```\n  \n  ```');
  expect(view.state.selection.main.head).toBe(8);
});

test('pairing and fence expansion preserve multiple cursors', () => {
  const view = editor('\n');
  view.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(1)]) });
  for (let i = 0; i < 3; i++) type(view, '`');
  expect(view.state.doc.toString()).toBe('``````\n``````');
  key(view, 'Enter');
  expect(view.state.doc.toString()).toBe('```\n\n```\n```\n\n```');
  expect(view.state.selection.ranges.map((range) => range.head)).toEqual([4, 13]);
});

test('ordinary Enter, inline code, pastes, other formats and large plain-text fallback remain unchanged', () => {
  for (const [format, size] of [
    ['txt', 0],
    ['json', 0],
    ['markdown', LARGE_DOCUMENT_LIMIT + 1],
  ] as const) {
    const view = editor('', format, size);
    type(view, '`');
    expect(view.state.doc.toString()).toBe('`');
  }
  const pasted = editor();
  type(pasted, '```');
  expect(pasted.state.doc.toString()).toBe('```');
  const inline = editor('text `code`');
  inline.dispatch({ selection: { anchor: 10 } });
  expect(splitMarkdownFence(inline)).toBe(false);
  const plain = editor('正文');
  plain.dispatch({ selection: { anchor: 2 } });
  key(plain, 'Enter');
  expect(plain.state.doc.toString()).toBe('正文\n');
});
