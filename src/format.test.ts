import { expect, test } from 'vitest';
import { EditorState } from '@codemirror/state';
import { history, undo } from '@codemirror/commands';
import { formatJsonc } from './format';
test('preserves large integer literals, duplicate keys, comments and trailing commas', () => {
  const result = formatJsonc('{"n":900719925474099312345,"x":1,/*keep*/"x":2,}');
  expect(result).toContain('900719925474099312345'); expect(result.match(/"x"/g)).toHaveLength(2); expect(result).toContain('/*keep*/');
});
test('invalid JSON is rejected before mutation', () => { expect(() => formatJsonc('{"x":}')).toThrow('JSON'); });
test('format can be undone through CodeMirror history', () => {
  const source = '{"a":1}'; let state = EditorState.create({ doc: source, extensions: [history()] });
  state = state.update({ changes: { from: 0, to: source.length, insert: formatJsonc(source) }, userEvent: 'input.format' }).state;
  expect(state.doc.toString()).not.toBe(source);
  undo({ state, dispatch: tr => { state = tr.state; } }); expect(state.doc.toString()).toBe(source);
});

test('strict JSON rejects comments and trailing commas', () => { expect(() => formatJsonc('{/*x*/"a":1}', true)).toThrow(); expect(() => formatJsonc('{"a":1,}', true)).toThrow(); });
