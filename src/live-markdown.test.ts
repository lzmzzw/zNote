// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView, type DecorationSet, type WidgetType } from '@codemirror/view';
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

test('lets CodeMirror start a drag on rendered text without cancelling the mouse event', () => {
  let state = EditorState.create({ doc: '# Title\n\nParagraph for selection.', extensions: [markdown(), liveMarkdownBlocks(false)] });
  const paragraphFrom = state.doc.line(3).from;
  const view = {
    get state() { return state; },
    dispatch: vi.fn(spec => { state = state.update(spec).state; }),
    coordsAtPos: () => ({ left: 100, top: 30 }),
    posAtCoords: ({ x }: { x: number }) => paragraphFrom + Math.round((x - 100) / 8),
  } as unknown as EditorView;
  const widget = blocks(state)[0].widget as WidgetType;
  const element = widget.toDOM(view);
  const paragraph = element.querySelector('p')!;
  vi.spyOn(paragraph, 'getBoundingClientRect').mockReturnValue({ left: 200, top: 60 } as DOMRect);
  const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 216, clientY: 68 });
  paragraph.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(widget.ignoreEvent(event)).toBe(false);
  expect(view.dispatch).not.toHaveBeenCalled();

  const style = state.facet(EditorView.mouseSelectionStyle)[0](view, event)!;
  expect(style).not.toBeNull();
  expect(state.selection.main.head).toBe(0);
  expect(blocks(state)).toHaveLength(0);
  const moved = new MouseEvent('mousemove', { clientX: 248, clientY: 68 });
  expect(style.get(moved, false, false).main).toMatchObject({ anchor: paragraphFrom + 2, head: paragraphFrom + 6 });
  expect(style.get(new MouseEvent('mousemove', { clientX: 208, clientY: 68 }), false, false).main).toMatchObject({ anchor: paragraphFrom + 2, head: paragraphFrom + 1 });
  expect(style.get(moved, true, false).main).toMatchObject({ anchor: 0, head: paragraphFrom + 6 });
  expect(style.get(moved, false, true).ranges).toHaveLength(2);
  expect(widget.ignoreEvent(new MouseEvent('mousedown', { button: 2 }))).toBe(true);
});
