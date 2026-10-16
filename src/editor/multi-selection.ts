import { EditorSelection, EditorState, Prec, countColumn, findColumn, type Extension } from '@codemirror/state';
import { EditorView, keymap, type Command } from '@codemirror/view';
import { copyLineDown, deleteLine, moveLineUp, moveLineDown } from '@codemirror/commands';

export function rectangleSelection(state: EditorState, anchor: number, head: number): EditorSelection {
  const first = state.doc.lineAt(anchor), last = state.doc.lineAt(head);
  const a = countColumn(first.text, state.tabSize, anchor - first.from);
  const h = countColumn(last.text, state.tabSize, head - last.from);
  const ranges = [];
  for (let n = Math.min(first.number, last.number); n <= Math.max(first.number, last.number); n++) {
    const line = state.doc.line(n);
    ranges.push(EditorSelection.range(line.from + findColumn(line.text, a, state.tabSize), line.from + findColumn(line.text, h, state.tabSize)));
  }
  return EditorSelection.create(ranges, last.number < first.number ? 0 : ranges.length - 1);
}

export function moveMultipleHorizontally(forward: boolean, extend = false): Command {
  return view => {
    if (view.state.selection.ranges.length < 2) return false;
    const ranges = view.state.selection.ranges.map(range => {
      if (!extend && !range.empty) return EditorSelection.cursor(forward ? range.to : range.from);
      const line = view.state.doc.lineAt(range.head);
      const moved = view.moveByChar(EditorSelection.cursor(range.head), forward).head;
      const head = Math.max(line.from, Math.min(line.to, moved));
      return extend ? EditorSelection.range(range.anchor, head) : EditorSelection.cursor(head);
    });
    view.dispatch({ selection: EditorSelection.create(ranges, view.state.selection.mainIndex), scrollIntoView: true, userEvent: 'select' });
    return true;
  };
}

export function multipleSelection(): Extension {
  return [
    EditorState.allowMultipleSelections.of(true),
    EditorView.clickAddsSelectionRange.of(event => event.ctrlKey),
    EditorView.mouseSelectionStyle.of((view, event) => {
      if (event.button !== 0 || !event.altKey || !event.shiftKey) return null;
      // Rendered Markdown must reveal its source before mapping pointer coordinates.
      if (event.target instanceof Element && event.target.closest('.live-rendered')) return null;
      let anchor = view.state.selection.main.anchor;
      return {
        get(pointer) {
          const head = view.posAtCoords({ x: pointer.clientX, y: pointer.clientY }, false) ?? anchor;
          return rectangleSelection(view.state, anchor, head);
        },
        update(update) { anchor = update.changes.mapPos(anchor); },
      };
    }),
    Prec.high(keymap.of([
      { key: 'Ctrl-d', run: copyLineDown },
      { key: 'Ctrl-l', run: deleteLine },
      { key: 'Ctrl-Shift-ArrowUp', run: moveLineUp },
      { key: 'Ctrl-Shift-ArrowDown', run: moveLineDown },
      { key: 'ArrowLeft', run: moveMultipleHorizontally(false), shift: moveMultipleHorizontally(false, true) },
      { key: 'ArrowRight', run: moveMultipleHorizontally(true), shift: moveMultipleHorizontally(true, true) },
      { key: 'Escape', run: view => {
        if (view.state.selection.ranges.length < 2) return false;
        view.dispatch({ selection: EditorSelection.single(view.state.selection.main.head), userEvent: 'select' });
        return true;
      } },
    ])),
  ];
}
