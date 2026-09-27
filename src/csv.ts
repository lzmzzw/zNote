import Papa from 'papaparse';

export function parseCsv(text: string): { rows: string[][]; rowLines: { start: number; end: number }[]; error: string | null } {
  const rows: string[][] = [];
  const rowLines: { start: number; end: number }[] = [];
  const errors: Papa.ParseError[] = [];
  let previousCursor = 0;
  let nextLine = 1;
  Papa.parse<string[]>(text, { skipEmptyLines: 'greedy', step(result) {
    const cursor = result.meta.cursor;
    const chunk = text.slice(previousCursor, cursor);
    const skipped = /^(?:[ \t]*(?:\r\n|\r|\n))*/.exec(chunk)?.[0] ?? '';
    const start = nextLine + (skipped.match(/\r\n|\r|\n/g)?.length ?? 0);
    const end = nextLine + (chunk.match(/\r\n|\r|\n/g)?.length ?? 0);
    rows.push(result.data);
    rowLines.push({ start, end: Math.max(start, end - (/(?:\r\n|\r|\n)$/.test(chunk) ? 1 : 0)) });
    errors.push(...result.errors);
    nextLine = end;
    previousCursor = cursor;
  } });
  const error = errors.find(item => item.code !== 'UndetectableDelimiter');
  return { rows, rowLines, error: error ? `${error.row === undefined ? '' : `第 ${error.row + 1} 行：`}${error.message}` : null };
}
