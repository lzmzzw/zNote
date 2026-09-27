import { expect, test } from 'vitest';
import { jsonPreviewRows } from './json-preview';

test('renders a JSON tree with source lines for nested values', () => {
  const rows = jsonPreviewRows('{\n  "name": "zNote",\n  "items": [\n    1\n  ]\n}');
  expect(rows.find(row => row.label === 'name')).toMatchObject({ line: 2, value: '"zNote"' });
  expect(rows.find(row => row.value === '1')).toMatchObject({ line: 4, depth: 2 });
  expect(rows.find(row => row.label === 'name')!.from).toBeLessThan(rows.find(row => row.label === 'name')!.to);
});

test('keeps invalid JSON lines available in the preview', () => {
  expect(jsonPreviewRows('{\n  broken\n}')).toEqual([
    { line: 1, from: 0, to: 1, depth: 0, label: '', value: '{', kind: 'raw' },
    { line: 2, from: 2, to: 10, depth: 0, label: '', value: '  broken', kind: 'raw' },
    { line: 3, from: 11, to: 12, depth: 0, label: '', value: '}', kind: 'raw' },
  ]);
});

test('maps distinct values on one source line by character range', () => {
  const rows = jsonPreviewRows('{"alpha":1,"beta":2}');
  const alpha = rows.find(row => row.label === 'alpha')!;
  const beta = rows.find(row => row.label === 'beta')!;
  expect(alpha.line).toBe(1);
  expect(beta.line).toBe(1);
  expect(alpha.to).toBeLessThan(beta.from);
});

test('preserves large integer and duplicate key literals in the structure view', () => {
  const rows = jsonPreviewRows('{"id":9007199254740993,"id":2}');
  expect(rows.filter(row => row.label === 'id').map(row => row.value)).toEqual(['9007199254740993', '2']);
});
