import { expect, test } from 'vitest';
import { parseCsv } from './csv';

test('parses quoted commas, newlines and escaped quotes', () => {
  expect(parseCsv('name,note\r\nAlice,"one,two"\r\nBob,"line 1\nline 2 with ""quotes"""').rows)
    .toEqual([['name', 'note'], ['Alice', 'one,two'], ['Bob', 'line 1\nline 2 with "quotes"']]);
});

test('reports malformed CSV and handles an empty table', () => {
  expect(parseCsv('').rows).toEqual([]);
  expect(parseCsv('name,note\nAlice,"unfinished').error).not.toBeNull();
});
