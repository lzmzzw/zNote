// @vitest-environment jsdom
import { afterEach, beforeAll, expect, test } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { deleteCharBackward, deleteCharForward, history, redo, undo } from '@codemirror/commands';
import { multipleSelection, rectangleSelection } from './multi-selection';

const views: EditorView[] = [];
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(() => views.splice(0).forEach(view => view.destroy()));
function editor(doc = 'abcd\nx\n1234') {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: [multipleSelection(), history()] }) });
  views.push(view);
  return view;
}
function key(view: EditorView, key: string, ctrlKey = false, shiftKey = false) {
  return runScopeHandlers(view, new KeyboardEvent('keydown', { key, ctrlKey, shiftKey }), 'editor');
}

test('rectangle clamps short lines, preserves reverse direction and handles tabs', () => {
  const view = editor();
  expect(rectangleSelection(view.state, 2, 9).ranges.map(r => [r.anchor, r.head])).toEqual([[2, 2], [6, 6], [9, 9]]);
  expect(rectangleSelection(view.state, 11, 1).ranges.map(r => [r.anchor, r.head])).toEqual([[4, 1], [6, 6], [11, 8]]);
  const state = EditorState.create({ doc: '\tab\n123456' });
  expect(rectangleSelection(state, 1, 9).ranges.map(r => [r.anchor, r.head])).toEqual([[1, 2], [8, 9]]);
});

test('Alt+Shift click and Ctrl click use separate selection gestures', () => {
  const view = editor();
  view.dispatch({ selection: { anchor: 2 } });
  const style = view.state.facet(EditorView.mouseSelectionStyle)[0](view, new MouseEvent('mousedown', { button: 0, altKey: true, shiftKey: true }))!;
  view.posAtCoords = () => 9;
  expect(style.get(new MouseEvent('mousedown'), true, false).ranges).toHaveLength(3);
  expect(view.state.facet(EditorView.clickAddsSelectionRange)[0](new MouseEvent('mousedown', { ctrlKey: true }))).toBe(true);
});

test('typing, deleting, undo and redo retain all cursors', () => {
  const view = editor();
  view.dispatch({ selection: rectangleSelection(view.state, 2, 9) });
  view.dispatch(view.state.replaceSelection('中'));
  expect(view.state.doc.toString()).toBe('ab中cd\nx中\n12中34');
  undo(view);
  expect(view.state.doc.toString()).toBe('abcd\nx\n1234');
  redo(view);
  deleteCharBackward(view);
  expect(view.state.doc.toString()).toBe('abcd\nx\n1234');
  deleteCharForward(view);
  expect(view.state.doc.toString()).toBe('abd\nx124');
});

test('horizontal navigation clamps every cursor at its line boundary', () => {
  const view = editor('a\nb');
  view.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(3)]) });
  // Isolate the logical-line clamp from browser bidi/layout measurement.
  view.moveByChar = (range, forward) => EditorSelection.cursor(Math.max(0, Math.min(view.state.doc.length, range.head + (forward ? 1 : -1))));
  key(view, 'ArrowRight');
  expect(view.state.selection.ranges.map(r => r.head)).toEqual([1, 3]);
  key(view, 'ArrowLeft');
  key(view, 'ArrowLeft');
  expect(view.state.selection.ranges.map(r => r.head)).toEqual([0, 2]);
  key(view, 'Escape');
  expect(view.state.selection.ranges).toHaveLength(1);
});

test('line shortcuts copy, delete and move entire lines with undo support', () => {
  const view = editor('one\ntwo\nthree');
  view.dispatch({ selection: { anchor: 5 } });
  expect(key(view, 'd', true)).toBe(true);
  expect(view.state.doc.toString()).toBe('one\ntwo\ntwo\nthree');
  key(view, 'l', true);
  expect(view.state.doc.toString()).toBe('one\ntwo\nthree');
  view.dispatch({ selection: { anchor: 5 } });
  key(view, 'ArrowUp', true, true);
  expect(view.state.doc.toString()).toBe('two\none\nthree');
  key(view, 'ArrowDown', true, true);
  expect(view.state.doc.toString()).toBe('one\ntwo\nthree');
  undo(view);
  expect(view.state.doc.toString()).toBe('two\none\nthree');
});
