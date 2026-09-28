import { EditorState, type EditorStateConfig } from '@codemirror/state';
import { historyField } from '@codemirror/commands';
import { defaultCsvOptions, type CsvOptions } from './csv';

export interface SessionNote {
  path: string | null; name: string; encoding: string; bom: boolean; lineEnding: string; revision: string | null;
  format: 'txt' | 'markdown' | 'json' | 'csv'; mode: 'source' | 'live' | 'split';
  saved: string | null; dirty: boolean; metaDirty: boolean; requiresSaveAs: boolean;
  editor: ReturnType<EditorState['toJSON']>; csvOptions: CsvOptions;
  scrollTop: number; scrollLeft: number; previewScrollTop: number; collapsedHeadings: string[];
}
export interface Session { version: 1; activeIndex: number; outlineCollapsed: boolean; notes: SessionNote[] }

export function serializeEditor(state: EditorState) { return state.toJSON({ history: historyField }); }
export function restoreEditor(editor: SessionNote['editor'], config: EditorStateConfig) {
  return EditorState.fromJSON(editor, config, { history: historyField });
}

export function parseSession(data: unknown): Session | null {
  if (data == null) return null;
  // 兼容旧版仅保存正文的草稿，迁移后仍作为未保存文档。
  if (Array.isArray(data)) {
    data = { version: 1, activeIndex: data.length - 1, outlineCollapsed: false, notes: data.map(doc => ({
      ...doc, path: null, revision: null, format: doc.format ?? 'txt', mode: 'source', saved: '', dirty: true,
      metaDirty: true, requiresSaveAs: false, editor: { doc: doc.text, selection: { ranges: [{ anchor: 0, head: 0 }], main: 0 } },
      csvOptions: defaultCsvOptions(), scrollTop: 0, scrollLeft: 0, previewScrollTop: 0, collapsedHeadings: [],
    })) };
  }
  const session = data as Session;
  if (session.version !== 1 || !Array.isArray(session.notes) || !Number.isInteger(session.activeIndex) || typeof session.outlineCollapsed !== 'boolean') throw new Error('会话格式无效');
  for (const note of session.notes) {
    if (!note || typeof note.name !== 'string' || (note.path !== null && typeof note.path !== 'string') ||
      (note.revision !== null && typeof note.revision !== 'string') || typeof note.editor?.doc !== 'string' ||
      (note.saved !== null && typeof note.saved !== 'string') || typeof note.bom !== 'boolean' ||
      !['UTF-8', 'GBK', 'UTF-16LE', 'UTF-16BE'].includes(note.encoding) || !['LF', 'CRLF', 'CR', 'Mixed'].includes(note.lineEnding) ||
      !['txt', 'markdown', 'json', 'csv'].includes(note.format) || !['source', 'live', 'split'].includes(note.mode) ||
      ![note.dirty, note.metaDirty, note.requiresSaveAs].every(value => typeof value === 'boolean') ||
      ![note.scrollTop, note.scrollLeft, note.previewScrollTop].every(value => Number.isFinite(value) && value >= 0) ||
      !Array.isArray(note.collapsedHeadings) || !note.collapsedHeadings.every(value => typeof value === 'string') ||
      !note.csvOptions || !['', ',', '\t', ';', '|', 'custom'].includes(note.csvOptions.delimiter) ||
      !['"', '\\'].includes(note.csvOptions.escapeChar) ||
      typeof note.csvOptions.customDelimiter !== 'string' || typeof note.csvOptions.firstRowHeader !== 'boolean' ||
      typeof note.csvOptions.skipEmptyLines !== 'boolean') throw new Error('标签状态无效');
  }
  return session;
}
