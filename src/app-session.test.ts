// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App as VueApp } from 'vue';
import { EditorView } from '@codemirror/view';
import App from './App.vue';

const bridge = vi.hoisted(() => ({ data: null as unknown, close: undefined as undefined | ((event: { preventDefault(): void }) => Promise<void>), destroy: vi.fn(), fail: false, open: null as unknown }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: vi.fn(async (command: string, args?: { data?: unknown }) => {
  if (command === 'recovery_load') return bridge.data;
  if (command === 'recovery_save') { if (bridge.fail) throw new Error('disk full'); bridge.data = JSON.parse(JSON.stringify(args?.data)); }
  if (command === 'native_take_open_requests') return { documents: [], errors: [] };
  if (command === 'native_open') return bridge.open;
  if (command === 'native_save') return null;
}) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: async (handler: typeof bridge.close) => { bridge.close = handler; return () => {}; }, destroy: bridge.destroy }) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
let app: VueApp | undefined; let root: HTMLDivElement;
async function mount() { root = document.createElement('div'); document.body.append(root); app = createApp(App); app.mount(root); await new Promise(resolve => setTimeout(resolve, 30)); await nextTick(); }
function unmount() { app?.unmount(); app = undefined; root?.remove(); }
function key(value: string) { window.dispatchEvent(new KeyboardEvent('keydown', { key: value, ctrlKey: true, bubbles: true })); }
function editor() { return EditorView.findFromDOM(root.querySelector('.cm-editor')!)!; }
async function close() { await bridge.close!({ preventDefault: vi.fn() }); }
beforeEach(() => {
  bridge.data = null; bridge.fail = false; bridge.open = null; bridge.destroy.mockClear();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('Worker', class { onmessage = null; postMessage() {} terminate() {} });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(() => { unmount(); vi.unstubAllGlobals(); });
describe('session lifecycle', () => {
  it('starts with empty txt and restores temporary tabs with no exit prompt', async () => {
    await mount();
    expect(root.textContent).not.toContain('欢迎使用');
    expect(editor().state.doc.length).toBe(0);
    editor().dispatch({ changes: { from: 0, insert: 'temporary text' }, selection: { anchor: 6 } });
    key('n'); await nextTick();
    await close();
    expect(bridge.destroy).toHaveBeenCalledOnce();
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    const data = bridge.data as { notes: { editor: { doc: string } }[]; activeIndex: number };
    expect(data.notes.map(n => n.editor.doc)).toEqual(['temporary text', '']);
    expect(data.activeIndex).toBe(1);
    expect((bridge.data as { notes: { name: string }[] }).notes.map(n => n.name)).toEqual(['未命名1.txt', '未命名2.txt']);
    unmount(); await mount();
    expect(root.querySelectorAll('.tab')).toHaveLength(2);
    expect(editor().state.doc.length).toBe(0);
    key('n'); await nextTick();
    expect(root.textContent).toContain('未命名3.txt');
    key('w'); await nextTick();
    expect(root.querySelector('[role="dialog"]')?.textContent).toContain('保存更改');
    const cancel = [...root.querySelectorAll('button')].find(button => button.textContent === '取消')!;
    cancel.click(); await nextTick();
    expect(root.querySelectorAll('.tab')).toHaveLength(3);
  });
  it('keeps original paths and dirty content without writing the source file', async () => {
    bridge.open = { path: 'C:/test.txt', text: 'on disk', encoding: 'UTF-8', bom: false, lineEnding: 'LF', revision: 'disk-version' };
    await mount(); key('o'); await new Promise(resolve => setTimeout(resolve, 10));
    editor().dispatch({ changes: { from: 0, to: 7, insert: 'unsaved change' } });
    await close(); unmount(); await mount();
    expect(editor().state.doc.toString()).toBe('unsaved change');
    await close();
    const data = bridge.data as { notes: { path: string | null; dirty: boolean; saved: string; revision: string }[] };
    expect(data.notes[1]).toMatchObject({ path: 'C:/test.txt', dirty: true, saved: 'on disk', revision: 'disk-version' });
  });
  it('blocks exit when persistence fails and retries successfully', async () => {
    await mount(); editor().dispatch({ changes: { from: 0, insert: 'keep me' } });
    bridge.fail = true; await close(); await nextTick();
    expect(bridge.destroy).not.toHaveBeenCalled();
    expect(root.textContent).toContain('会话保存失败');
    bridge.fail = false; await close();
    expect(bridge.destroy).toHaveBeenCalledOnce();
  });
  it('removes discarded tabs from the next restored session', async () => {
    await mount(); editor().dispatch({ changes: { from: 0, insert: 'discard me' } });
    key('w'); await nextTick();
    [...root.querySelectorAll('button')].find(button => button.textContent === '不保存')!.click();
    await new Promise(resolve => setTimeout(resolve, 10));
    await close(); unmount(); await mount();
    expect(editor().state.doc.length).toBe(0);
    expect(root.querySelectorAll('.tab')).toHaveLength(1);
  });
});
