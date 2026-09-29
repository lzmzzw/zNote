import { expect, test } from 'vitest';
import { EditorState } from '@codemirror/state';
import { history, undo } from '@codemirror/commands';
import { compactJsonc, escapeJsonText, formatJsonc, unescapeJsonText } from './format';
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

test('compacts JSONC without changing comments, duplicate keys or numeric literals', () => {
  const source = '// keep\n{ "n": 900719925474099312345, "n": 2, /* block */ "s": "a b", }';
  expect(compactJsonc(source)).toBe('// keep\n{"n":900719925474099312345,"n":2,/* block */"s":"a b",}');
  expect(() => compactJsonc(source, true)).toThrow('JSON 语法错误');
});

test('escapes and unescapes one complete valid JSON text layer', () => {
  const source = '{"text":"中文\\n"}\n';
  expect(unescapeJsonText(escapeJsonText(source))).toBe(source);
  expect(() => unescapeJsonText('{"text":"value"}')).toThrow('完整的 JSON 字符串');
  expect(() => unescapeJsonText('"unfinished')).toThrow('完整的 JSON 字符串');
  expect(() => unescapeJsonText(JSON.stringify('not valid'), true)).toThrow('JSON 语法错误');
  expect(() => unescapeJsonText(JSON.stringify('  '), true)).toThrow('JSON 语法错误');
});
