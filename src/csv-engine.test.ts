import { expect, test } from 'vitest';
import { defaultCsvOptions, parseCsv } from './csv';
import { CsvEngine, type CsvState } from './csv-engine';
import { CsvWorkerClient, type CsvWorkerLike } from './csv-client';
import { spreadsheetText } from './context-menu';

test('indexes CSV records without losing quoted newlines or source locations', async () => {
  const text = 'name,note\r\n\r\nAlice,"one\r\ntwo"\r\nBob,"say ""hi"""\r\n';
  const engine = new CsvEngine(text, defaultCsvOptions());
  await engine.build(() => {});
  const window = engine.window({ rowStart: 0, rowCount: 100, colStart: 0, colCount: 10 });
  expect(window.rows).toEqual(parseCsv(text).rows);
  expect(window.rowLines).toEqual(parseCsv(text).rowLines);
  expect(await engine.copy({ kind: 'row', row: 1 })).toBe(spreadsheetText([window.rows[1]]));
  expect(await engine.copy({ kind: 'column', column: 1 })).toBe(
    spreadsheetText(window.rows.map((row) => [row[1] ?? ''])),
  );
});

test('yields incremental progress and can fetch indexed rows before completion', async () => {
  const text = 'a;b\n' + Array.from({ length: 5000 }, (_, i) => `中文${i};${i}`).join('\n');
  const options = { ...defaultCsvOptions(), delimiter: ';' as const };
  const engine = new CsvEngine(text, options);
  const states: CsvState[] = [];
  await engine.build((state) => {
    states.push(state);
    if (state.rowCount === 2048)
      expect(engine.window({ rowStart: 2047, rowCount: 1, colStart: 0, colCount: 2 }).rows[0]).toEqual([
        '中文2046',
        '2046',
      ]);
  });
  expect(states.filter((state) => state.status === 'parsing').length).toBeGreaterThan(2);
  expect(states.at(-1)).toMatchObject({ status: 'ready', progress: 1, rowCount: 5001, columnCount: 2 });
  expect(engine.window({ rowStart: 4900, rowCount: 500, colStart: 1, colCount: 1 }).rows[0]).toEqual(['4899']);
  expect(engine.window({ rowStart: 4096, rowCount: 2, colStart: 0, colCount: 2 }).rowLines).toEqual([
    { start: 4097, end: 4097 },
    { start: 4098, end: 4098 },
  ]);
  expect(await engine.copy({ kind: 'cell', row: 4999, column: 0 })).toBe('中文4998');
});

test('truncates display only and preserves full copy plus custom escape settings', async () => {
  const value = '中'.repeat(5000);
  const engine = new CsvEngine(`name:note\n甲:"${value}"\n乙:"say \\"hi\\""`, {
    ...defaultCsvOptions(),
    delimiter: 'custom',
    escapeChar: '\\',
  });
  await engine.build(() => {});
  expect(engine.window({ rowStart: 1, rowCount: 2, colStart: 1, colCount: 1 }).rows).toEqual([
    [value.slice(0, 4096) + '...'],
    ['say "hi"'],
  ]);
  expect(await engine.copy({ kind: 'cell', row: 1, column: 1 })).toBe(value);
});

test('preserves empty records when configured and reports malformed CSV', async () => {
  const engine = new CsvEngine('a,b\n\n"unfinished', { ...defaultCsvOptions(), skipEmptyLines: false });
  let final: CsvState | undefined;
  await engine.build((state) => {
    final = state;
  });
  expect(engine.window({ rowStart: 0, rowCount: 10, colStart: 0, colCount: 10 }).rows).toEqual([
    ['a', 'b'],
    ['', ''],
    ['unfinished', ''],
  ]);
  expect(final?.error).toContain('第 3 行');
});

test('matches synchronous parsing at exact yield boundaries with trailing newlines', async () => {
  for (const suffix of ['', '\r\n']) {
    const text = Array.from({ length: 2048 }, (_, row) => `${row},"中文\r\n${row}"`).join('\r\n') + suffix;
    const options = { ...defaultCsvOptions(), skipEmptyLines: false };
    const expected = parseCsv(text, options);
    const engine = new CsvEngine(text, options);
    let state: CsvState | undefined;
    await engine.build((value) => {
      state = value;
    });
    expect(state?.rowCount).toBe(expected.rows.length);
    const result = engine.window({ rowStart: 2046, rowCount: 10, colStart: 0, colCount: 2 });
    expect(result.rows).toEqual(expected.rows.slice(2046).map((row) => [row[0] ?? '', row[1] ?? '']));
    expect(result.rowLines).toEqual(expected.rowLines.slice(2046));
  }
});

test('pads short rows and locates multiline records by source line', async () => {
  const engine = new CsvEngine('header\n1,"two\nthree",4\n\nlast', defaultCsvOptions());
  await engine.build(() => {});
  const result = engine.window({ rowStart: 0, rowCount: 10, colStart: 1, colCount: 10 });
  expect(result.colCount).toBe(2);
  expect(result.rows).toEqual([
    ['', ''],
    ['two\nthree', '4'],
    ['', ''],
  ]);
  expect([0, 1, 2, 3, 4, 5, 100].map((line) => engine.rowAtLine(line))).toEqual([0, 0, 1, 1, 1, 2, 2]);
  expect(engine.window({ rowStart: 0, rowCount: 1, colStart: 100, colCount: 10 }).rows).toEqual([[]]);
  const empty = new CsvEngine('', defaultCsvOptions());
  await empty.build(() => {});
  expect(empty.rowAtLine(1)).toBe(-1);
});

test('terminates old workers, rejects pending work and ignores late messages', async () => {
  const workers: (CsvWorkerLike & { terminated: boolean })[] = [];
  const client = new CsvWorkerClient(() => {
    const worker = {
      onmessage: null,
      onerror: null,
      terminated: false,
      postMessage() {},
      terminate() {
        this.terminated = true;
      },
    } satisfies CsvWorkerLike & { terminated: boolean };
    workers.push(worker);
    return worker;
  });
  const states: CsvState[] = [];
  client.start('a', 'a,b', defaultCsvOptions(), (state) => states.push(state));
  const pending = client.getWindow('a', { rowStart: 0, rowCount: 1, colStart: 0, colCount: 1 });
  const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  client.start('b', 'c,d', defaultCsvOptions(), (state) => states.push(state));
  await rejection;
  workers[0].onmessage?.({ data: { type: 'state', id: 'a', state: { status: 'ready' } } } as MessageEvent);
  expect(states).toEqual([]);
  expect(workers[0].terminated).toBe(true);
  client.dispose();
  expect(workers[1].terminated).toBe(true);
});
