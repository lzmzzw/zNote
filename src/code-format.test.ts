import { expect, test } from 'vitest';
import { canFormatCode, formatCode } from './code-format';

test('formats supported fenced languages and preserves a trailing newline', async () => {
  expect(canFormatCode('js')).toBe(true);
  expect(await formatCode('const x={a:1}', 'js')).toBe('const x = { a: 1 };\n');
  expect(await formatCode('{"a":1}', 'json')).toBe('{ "a": 1 }\n');
  expect(await formatCode('{/*keep*/"a":1,}', 'jsonc')).toContain('/*keep*/');
});

test('rejects unrecognized languages without changing source', async () => {
  await expect(formatCode('print(1)', 'python')).rejects.toThrow('暂不支持');
});
