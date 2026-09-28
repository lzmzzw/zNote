import type { EditorState } from '@codemirror/state';
import type { CsvOptions } from './csv';

export interface NativeDocument {
  path: string | null;
  text: string;
  encoding: string;
  bom: boolean;
  lineEnding: string;
  revision: string | null;
}
export type NoteFormat = 'txt' | 'markdown' | 'json' | 'csv';
export type DisplayMode = 'source' | 'live' | 'split';
export type MarkdownWidth = 'full' | 'standard' | 'compact';
export function defaultMode(format: NoteFormat): DisplayMode {
  return format === 'json' ? 'split' : format === 'markdown' || format === 'csv' ? 'live' : 'source';
}
export function formatForName(name: string): NoteFormat {
  return /\.md$|\.markdown$/i.test(name)
    ? 'markdown'
    : /\.(jsonc?|geojson)$/i.test(name)
      ? 'json'
      : /\.csv$/i.test(name)
        ? 'csv'
        : 'txt';
}
export interface Note extends Omit<NativeDocument, 'text'> {
  id: number;
  name: string;
  format: NoteFormat;
  mode: DisplayMode;
  markdownWidth: MarkdownWidth;
  state: EditorState;
  saved: string;
  version: number;
  dirty: boolean;
  metaDirty: boolean;
  requiresSaveAs: boolean;
  csvOptions: CsvOptions;
  csvColumnWidths: number[];
  scrollTop: number;
  scrollLeft: number;
  previewScrollTop: number;
}

export const LARGE_DOCUMENT_LIMIT = 1_000_000;
export const encodingOptions = ['UTF-8', 'GBK'].map((value) => ({ value, label: value }));
