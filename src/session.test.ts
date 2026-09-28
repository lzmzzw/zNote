import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { history, undo, redo, undoDepth } from '@codemirror/commands';
import { defaultCsvOptions } from './csv';
import { parseSession, serializeEditor, restoreEditor, type SessionNote } from './session';

function note(state: EditorState, path: string | null = null): SessionNote {
  return { path, name: path ?? '未命名.txt', encoding: 'UTF-8', bom: false, lineEnding: 'LF', revision: path ? 'revision' : null,
    format: 'txt', mode: 'source', markdownWidth: 'full', saved: '', dirty: true, metaDirty: false, requiresSaveAs: false,
    editor: serializeEditor(state), csvOptions: defaultCsvOptions(), scrollTop: 120, scrollLeft: 0, previewScrollTop: 42, collapsedHeadings: ['heading'] };
}
describe('persistent session', () => {
  it('restores text, selection and usable undo/redo history', () => {
    let state = EditorState.create({ doc: 'original', extensions: [history()] });
    state = state.update({ changes: { from: 8, insert: ' edited' }, selection: { anchor: 15 }, userEvent: 'input' }).state;
    let restored = restoreEditor(JSON.parse(JSON.stringify(serializeEditor(state))), { extensions: [history()] });
    expect(restored.doc.toString()).toBe('original edited');
    expect(restored.selection.main.head).toBe(15);
    expect(undoDepth(restored)).toBe(1);
    undo({ state: restored, dispatch: tr => { restored = tr.state; } });
    expect(restored.doc.toString()).toBe('original');
    redo({ state: restored, dispatch: tr => { restored = tr.state; } });
    expect(restored.doc.toString()).toBe('original edited');
  });
  it('keeps clean files, empty temporary tabs, dirty files, order and display settings', () => {
    const empty = note(EditorState.create({ extensions: [history()] })); empty.dirty = false; empty.saved = null;
    const dirty = note(EditorState.create({ doc: 'new text', extensions: [history()] }), 'C:/test.txt');
    dirty.saved = 'disk text'; dirty.metaDirty = true; dirty.mode = 'split'; dirty.format = 'csv';
    dirty.csvOptions = { delimiter: ';', customDelimiter: ':', firstRowHeader: false, skipEmptyLines: false, escapeChar: '\\' };
    const clean = { ...dirty, saved: null, dirty: false, metaDirty: false };
    const data = { version: 1, activeIndex: 1, outlineCollapsed: true, notes: [empty, dirty, clean] };
    expect(parseSession(JSON.parse(JSON.stringify(data)))).toEqual(data);
  });
  it('migrates old recovery drafts without restoring path authorization', () => {
    const session = parseSession([{ name: 'old.md', text: '# draft', format: 'markdown', path: 'C:/old.md', revision: 'old', encoding: 'UTF-8', bom: false, lineEnding: 'LF' }])!;
    expect(session.notes[0].path).toBeNull();
    expect(session.notes[0].dirty).toBe(true);
    const state = restoreEditor(session.notes[0].editor, { extensions: [history()] });
    expect(state.doc.toString()).toBe('# draft');
  });
  it('uses standard width for sessions saved before Markdown width settings', () => {
    const oldNote = note(EditorState.create({ doc: '# note' }), 'C:/note.md');
    delete (oldNote as Partial<SessionNote>).markdownWidth;
    const session = parseSession({ version: 1, activeIndex: 0, outlineCollapsed: false, notes: [oldNote] });
    expect(session?.notes[0].markdownWidth).toBe('standard');
  });
  it('rejects corrupt session instead of silently dropping a tab', () => {
    expect(() => parseSession({ version: 1, activeIndex: 0, outlineCollapsed: false, notes: [{}] })).toThrow();
    expect(parseSession(null)).toBeNull();
  });
});
