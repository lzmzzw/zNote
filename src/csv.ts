import Papa from 'papaparse';

export interface CsvOptions {
  delimiter: '' | ',' | ';' | '\t' | '|' | 'custom';
  customDelimiter: string;
  firstRowHeader: boolean;
  skipEmptyLines: boolean;
  escapeChar: '"' | '\\';
}

export function defaultCsvOptions(): CsvOptions {
  return { delimiter: '', customDelimiter: ':', firstRowHeader: true, skipEmptyLines: true, escapeChar: '"' };
}

export function parseCsv(text: string, options: CsvOptions = defaultCsvOptions()): { rows: string[][]; rowLines: { start: number; end: number }[]; error: string | null } {
  const rows: string[][] = [];
  const rowLines: { start: number; end: number }[] = [];
  const errors: Papa.ParseError[] = [];
  let previousCursor = 0;
  let nextLine = 1;
  Papa.parse<string[]>(text, { delimiter: options.delimiter === 'custom' ? options.customDelimiter : options.delimiter, escapeChar: options.escapeChar, skipEmptyLines: options.skipEmptyLines ? 'greedy' : false, step(result) {
    const cursor = result.meta.cursor;
    const chunk = text.slice(previousCursor, cursor);
    const skipped = options.skipEmptyLines ? /^(?:[ \t]*(?:\r\n|\r|\n))*/.exec(chunk)?.[0] ?? '' : '';
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
