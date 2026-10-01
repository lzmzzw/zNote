import { expect, test } from 'vitest';
import { columnViewport, rowScrollOffset, rowViewport } from './csv-viewport';

test('keeps a million rows bounded and reaches the final record without exceeding browser scroll limits', () => {
  const first = rowViewport(1_000_000, 36, 0, 600);
  expect(first.end).toBeLessThan(30);
  const last = rowViewport(1_000_000, 36, first.extent - 600, 600);
  expect(last.end).toBe(1_000_000);
  const target = rowViewport(1_000_000, 36, rowScrollOffset(500_000, 1_000_000, 36, 600), 600);
  expect(target.start).toBeLessThanOrEqual(500_000);
  expect(target.end).toBeGreaterThan(500_000);
});

test('selects visible columns using resized widths and bounds very wide files', () => {
  const columns = columnViewport(6, [80, 200, 400, 120, 120, 120], 600, 100);
  expect(columns.position(3)).toBe(680);
  expect(columns.start).toBe(0);
  expect(columns.end).toBe(6);
  const wide = columnViewport(1_000_000, [], 7_999_400, 600);
  expect(wide.extent).toBe(8_000_000);
  expect(wide.end).toBe(1_000_000);
  expect(wide.end - wide.start).toBeLessThan(12);
});
