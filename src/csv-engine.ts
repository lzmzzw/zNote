import Papa from 'papaparse';
import { type CsvOptions } from './csv';
import { spreadsheetText } from './context-menu';

export interface CsvState {
  status: 'parsing' | 'ready' | 'error';
  progress: number;
  rowCount: number;
  columnCount: number;
  error: string | null;
}
export interface CsvWindowRequest {
  rowStart: number;
  rowCount: number;
  colStart: number;
  colCount: number;
}
export interface CsvWindow extends CsvWindowRequest {
  rows: string[][];
  rowLines: { start: number; end: number }[];
  columnCount: number;
}
export interface CsvCopyRequest {
  kind: 'cell' | 'row' | 'column';
  row?: number;
  column?: number;
}

// Fixed-size integer blocks avoid retaining a JS object or parsed cells for every record.
class RecordIndex {
  private blocks: Uint32Array[] = [];
  length = 0;
  append(start: number, end: number, lineStart: number, lineEnd: number) {
    const block = Math.floor(this.length / 4096);
    if (!this.blocks[block]) this.blocks[block] = new Uint32Array(4096 * 4);
    this.blocks[block].set([start, end, lineStart, lineEnd], (this.length % 4096) * 4);
    this.length++;
  }
  get(row: number) {
    return this.blocks[Math.floor(row / 4096)].subarray((row % 4096) * 4, (row % 4096) * 4 + 4);
  }
}

export class CsvEngine {
  private index = new RecordIndex();
  private delimiter = ',';
  private columns = 0;
  private cache = new Map<number, string[]>();
  private cacheCharacters = 0;
  constructor(
    private text: string,
    private options: CsvOptions,
  ) {}

  build(onState: (state: CsvState) => void): Promise<void> {
    let previousCursor = 0;
    let cursorBase = 0;
    let line = 1;
    let records = 0;
    let error: string | null = null;
    const state = (status: CsvState['status']): CsvState => ({
      status,
      progress: this.text.length ? previousCursor / this.text.length : 1,
      rowCount: this.index.length,
      columnCount: this.columns,
      error,
    });
    onState(state('parsing'));
    return new Promise((resolve, reject) => {
      Papa.parse<string[]>(this.text, {
        delimiter: this.options.delimiter === 'custom' ? this.options.customDelimiter : this.options.delimiter,
        escapeChar: this.options.escapeChar,
        skipEmptyLines: false,
        step: (result, parser) => {
          const end = cursorBase + result.meta.cursor;
          this.delimiter = result.meta.delimiter;
          const record = this.text.slice(previousCursor, end);
          const breaks = record.match(/\r\n|\r|\n/g)?.length ?? 0;
          const keep = !(this.options.skipEmptyLines && result.data.join('').trim() === '');
          if (keep) {
            this.index.append(
              previousCursor,
              end,
              line,
              Math.max(line, line + breaks - (/(?:\r\n|\r|\n)$/.test(record) ? 1 : 0)),
            );
            this.columns = Math.max(this.columns, result.data.length);
          }
          const failure = result.errors.find((item) => item.code !== 'UndetectableDelimiter');
          if (failure && !error) error = `第 ${line} 行：${failure.message}`;
          line += breaks;
          previousCursor = end;
          if (++records % 2048 === 0 && end < this.text.length) {
            parser.pause();
            onState(state('parsing'));
            cursorBase = end;
            setTimeout(() => parser.resume(), 0);
          }
        },
        complete: () => {
          onState(state('ready'));
          resolve();
        },
        error: (failure: Error) => {
          error = failure.message;
          onState(state('error'));
          reject(failure);
        },
      });
    });
  }

  private row(row: number): string[] {
    if (row < 0 || row >= this.index.length) return [];
    const cached = this.cache.get(row);
    if (cached) return cached;
    const [start, end] = this.index.get(row);
    const values = Papa.parse<string[]>(this.text.slice(start, end), {
      delimiter: this.delimiter,
      escapeChar: this.options.escapeChar,
    }).data[0] ?? [''];
    const characters = values.reduce((sum, value) => sum + value.length + 16, 0);
    if (characters <= 262144) {
      while (this.cache.size >= 128 || this.cacheCharacters + characters > 262144) {
        const oldest = this.cache.keys().next().value;
        if (oldest === undefined) break;
        this.cacheCharacters -= this.cache.get(oldest)!.reduce((sum, value) => sum + value.length + 16, 0);
        this.cache.delete(oldest);
      }
      this.cache.set(row, values);
      this.cacheCharacters += characters;
    }
    return values;
  }

  window(request: CsvWindowRequest): CsvWindow {
    const rowStart = Math.max(0, Math.floor(request.rowStart));
    const colStart = Math.max(0, Math.floor(request.colStart));
    const rowCount = Math.min(
      200,
      Math.max(0, Math.floor(request.rowCount)),
      Math.max(0, this.index.length - rowStart),
    );
    const colCount = Math.min(100, Math.max(0, Math.floor(request.colCount)), Math.max(0, this.columns - colStart));
    const rows: string[][] = [];
    const rowLines: CsvWindow['rowLines'] = [];
    for (let row = rowStart; row < rowStart + rowCount; row++) {
      const values = this.row(row);
      rows.push(
        Array.from({ length: colCount }, (_, column) => {
          const value = values[colStart + column] ?? '';
          return value.length > 4096 ? value.slice(0, 4096) + '...' : value;
        }),
      );
      const position = this.index.get(row);
      rowLines.push({ start: position[2], end: position[3] });
    }
    return { rowStart, colStart, rowCount, colCount, rows, rowLines, columnCount: this.columns };
  }

  rowAtLine(line: number): number {
    if (!this.index.length) return -1;
    let low = 0;
    let high = this.index.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high + 1) / 2);
      if (this.index.get(middle)[2] <= line) low = middle;
      else high = middle - 1;
    }
    return low;
  }

  async copy(request: CsvCopyRequest): Promise<string> {
    if (request.kind === 'cell') return this.row(request.row ?? -1)[request.column ?? -1] ?? '';
    if (request.kind === 'row') return spreadsheetText([this.row(request.row ?? -1)]);
    const chunks: string[] = [];
    for (let row = 0; row < this.index.length; row++) {
      chunks.push(spreadsheetText([[this.row(row)[request.column ?? -1] ?? '']]));
      if (row % 2048 === 2047) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return chunks.join('\r\n');
  }
}
