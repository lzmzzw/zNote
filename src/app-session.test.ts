// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App as VueApp } from 'vue';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import App from './App.vue';

const bridge = vi.hoisted(() => ({ data: null as unknown, close: undefined as undefined | ((event: { preventDefault(): void }) => Promise<void>), destroy: vi.fn(), fail: false, open: null as unknown, requests: [] as unknown[], saveArgs: null as unknown, maximized: false, resized: undefined as undefined | (() => void) }));
const updater = vi.hoisted(() => ({ check: vi.fn(), downloadAndInstall: vi.fn(), relaunch: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: vi.fn(async (command: string, args?: { data?: unknown }) => {
  if (command === 'recovery_load') return bridge.data;
  if (command === 'recovery_save') { if (bridge.fail) throw new Error('disk full'); bridge.data = JSON.parse(JSON.stringify(args?.data)); }
  if (command === 'native_take_open_requests') return { documents: bridge.requests.splice(0), errors: [] };
  if (command === 'native_open') return bridge.open;
  if (command === 'native_save') { bridge.saveArgs = args; return null; }
}) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: async (handler: typeof bridge.close) => { bridge.close = handler; return () => {}; }, onResized: async (handler: () => void) => { bridge.resized = handler; return () => {}; }, isMaximized: async () => bridge.maximized, toggleMaximize: async () => { bridge.maximized = !bridge.maximized; bridge.resized?.(); }, destroy: bridge.destroy }) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.1.2' }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: updater.check }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: updater.relaunch }));
let app: VueApp | undefined; let root: HTMLDivElement;
const writeText = vi.fn(async (_text: string) => {});
const readText = vi.fn(async () => 'pasted');
let formatWorker: { onmessage: ((event: MessageEvent<{ id: number; text?: string; error?: string }>) => void) | null; posted: { id: number; kind: string; text: string }[] };
async function mount() { root = document.createElement('div'); document.body.append(root); app = createApp(App); app.mount(root); await new Promise(resolve => setTimeout(resolve, 30)); await nextTick(); }
function unmount() { app?.unmount(); app = undefined; root?.remove(); }
function key(value: string) { window.dispatchEvent(new KeyboardEvent('keydown', { key: value, ctrlKey: true, bubbles: true })); }
function editor() { return EditorView.findFromDOM(root.querySelector('.cm-editor')!)!; }
async function close() { await bridge.close!({ preventDefault: vi.fn() }); }
beforeEach(() => {
  localStorage.removeItem('znote-font-size');
  bridge.data = null; bridge.fail = false; bridge.open = null; bridge.requests = []; bridge.saveArgs = null; bridge.maximized = false; bridge.resized = undefined; bridge.destroy.mockClear();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('Worker', class {
    onmessage = null;
    posted: { id: number; kind: string; text: string }[] = [];
    constructor() { formatWorker = this; }
    postMessage(message: { id: number; kind: string; text: string }) { this.posted.push(message); }
    terminate() {}
  });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Element.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText, readText } });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) });
  writeText.mockClear(); readText.mockClear();
});
describe('window controls', () => {
  it('shows the restore icon while maximized and tracks external resize', async () => {
    await mount();
    const control = root.querySelector<HTMLButtonElement>('.window-controls button:nth-child(2)')!;
    expect(control.getAttribute('aria-label')).toBe('最大化');
    control.click(); await new Promise(resolve => setTimeout(resolve, 0)); await nextTick();
    expect(control.getAttribute('aria-label')).toBe('还原');
    bridge.maximized = false; bridge.resized?.(); await new Promise(resolve => setTimeout(resolve, 0)); await nextTick();
    expect(control.getAttribute('aria-label')).toBe('最大化');
  });
});
describe('software updates', () => {
  it('checks, installs and relaunches from the Help menu', async () => {
    updater.check.mockResolvedValue({ version: '0.1.3', downloadAndInstall: updater.downloadAndInstall });
    updater.downloadAndInstall.mockResolvedValue(undefined);
    updater.relaunch.mockResolvedValue(undefined);
    await mount();
    root.querySelectorAll<HTMLButtonElement>('.app-menu > .menu-group > button')[3].click();
    await nextTick();
    const updateButton = [...root.querySelectorAll<HTMLButtonElement>('.menu-popup button')].find(button => button.textContent?.includes('检查更新'))!;
    expect(updateButton.textContent).toContain('v0.1.2');
    expect(root.textContent).not.toContain('当前版本');
    updateButton.click();
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(updater.check).toHaveBeenCalled();
    expect(updater.downloadAndInstall).toHaveBeenCalled();
    expect(updater.relaunch).toHaveBeenCalled();
  });
});
describe('Markdown width settings', () => {
  it('keeps the outline toggle usable after switching tabs and rebinds gutter measurements', async () => {
    const observers: { callback: () => void; target?: Element; disconnect: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal('ResizeObserver', class {
      entry = { callback: () => {}, target: undefined as Element | undefined, disconnect: vi.fn() };
      constructor(callback: () => void) { this.entry.callback = callback; observers.push(this.entry); }
      observe(target: Element) { this.entry.target = target; }
      disconnect() { this.entry.disconnect(); }
    });
    await mount(); await openDoc('note.md', '# heading');
    const first = observers.at(-1)!;
    expect(first.target).toBe(root.querySelector('.cm-gutters'));
    root.querySelector<HTMLButtonElement>('.outline-toggle')!.click(); await nextTick();
    expect(root.querySelector('.sidebar')).toBeNull();
    await openDoc('other.txt', 'text');
    expect(first.disconnect).toHaveBeenCalled();
    expect(first.target?.isConnected).toBe(false);
    expect(root.querySelector('.outline-toggle')).toBeNull();
    root.querySelectorAll<HTMLButtonElement>('.tab [role="tab"]')[1].click(); await nextTick();
    const current = observers.at(-1)!;
    expect(current.target).toBe(root.querySelector('.cm-gutters'));
    expect(current.target?.isConnected).toBe(true);
    const toggle = root.querySelector<HTMLButtonElement>('.outline-toggle')!;
    current.callback(); await nextTick();
    expect(toggle.style.width).toBe('37px');
    expect(toggle.getAttribute('aria-label')).toBe('展开文档大纲');
    toggle.click(); await nextTick();
    expect(root.querySelector('.sidebar')).not.toBeNull();
    expect(toggle.getAttribute('aria-label')).toBe('收起文档大纲');
    vi.spyOn(current.target!, 'getBoundingClientRect').mockReturnValue({ width: 64 } as DOMRect);
    current.callback(); await nextTick();
    expect(toggle.style.width).toBe('64px');
  });

  it('defaults to standard width and restores a per-tab width choice', async () => {
    await mount(); await openDoc('note.md', '# heading');
    expect(root.querySelector('.writing-area')?.classList.contains('markdown-width-standard')).toBe(true);
    [...root.querySelectorAll<HTMLButtonElement>('.menu-group > button')].find(button => button.textContent === '格式')!.click();
    await nextTick();
    [...root.querySelectorAll<HTMLButtonElement>('.menu-popup button')].find(button => button.textContent?.includes('Markdown 设置'))!.click();
    await nextTick(); await nextTick();
    const width = root.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="显示宽度"]')!;
    width.click(); await nextTick(); await nextTick();
    [...root.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent?.includes('720px'))!.click(); await nextTick();
    expect(root.querySelector('.writing-area')?.classList.contains('markdown-width-compact')).toBe(true);
    root.querySelector<HTMLButtonElement>('[aria-label="关闭 Markdown 设置"]')!.click(); await nextTick();
    await openDoc('other.md', '# second');
    expect(root.querySelector('.writing-area')?.classList.contains('markdown-width-standard')).toBe(true);
    root.querySelectorAll<HTMLButtonElement>('.tab [role="tab"]')[1].click(); await nextTick();
    expect(root.querySelector('.writing-area')?.classList.contains('markdown-width-compact')).toBe(true);
    await close();
    expect((bridge.data as { notes: { markdownWidth: string }[] }).notes[1].markdownWidth).toBe('compact');
    unmount(); await mount();
    expect(root.querySelector('.writing-area')?.classList.contains('markdown-width-compact')).toBe(true);
  });
});

async function rightClick(element: Element) {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  element.dispatchEvent(event); await nextTick(); await nextTick();
  expect(event.defaultPrevented).toBe(true);
}
function labels() { return [...root.querySelectorAll('[role="menuitem"]')].map(button => button.textContent); }
async function choose(label: string) {
  const button = [...root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(button => button.textContent === label)!;
  expect(button).toBeDefined(); button.click(); await new Promise(resolve => setTimeout(resolve, 10)); await nextTick();
}
async function openDoc(name: string, text: string) {
  bridge.open = { path: `C:/${name}`, text, encoding: 'UTF-8', bom: false, lineEnding: 'LF', revision: 'revision' };
  key('o'); await new Promise(resolve => setTimeout(resolve, 30)); await nextTick();
}
describe('regional context menus', () => {
  it('targets an inactive tab and exposes the exact tab and blank-area commands', async () => {
    await mount(); key('n'); await nextTick();
    await rightClick(root.querySelector('.tab')!);
    expect(labels()).toEqual(['保存', '另存为', '复制文件名', '复制完整路径', '关闭', '关闭左侧标签', '关闭右侧标签', '关闭其他标签', '关闭全部标签']);
    await choose('复制文件名'); expect(writeText).toHaveBeenLastCalledWith('未命名1.txt');
    expect(root.querySelector('.tab.active')?.textContent).toContain('未命名2.txt');
    await rightClick(root.querySelector('.tab-list')!); expect(labels()).toEqual(['打开文件']);
  });
  it('preserves source selection and only offers approved editing commands', async () => {
    await mount(); editor().dispatch({ changes: { from: 0, insert: 'selected text' }, selection: { anchor: 0, head: 8 } });
    await rightClick(root.querySelector('.cm-content')!);
    expect(labels()).toEqual(['剪切', '复制', '粘贴', '纯文本粘贴', '查找与替换']);
    await choose('复制'); expect(writeText).toHaveBeenLastCalledWith('selected');
    expect(editor().state.selection.main.to).toBe(8);
    await rightClick(root.querySelector('.cm-content')!); await choose('纯文本粘贴');
    expect(editor().state.doc.toString()).toBe('pasted text');
  });
  it('rejects delayed paste after the document changes', async () => {
    await mount();
    let resolve!: (text: string) => void;
    readText.mockImplementationOnce(() => new Promise<string>(done => { resolve = done; }));
    await rightClick(root.querySelector('.cm-content')!);
    const paste = [...root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(button => button.textContent === '粘贴')!;
    paste.click(); editor().dispatch({ changes: { from: 0, insert: 'newer' } }); resolve('stale');
    await new Promise(done => setTimeout(done, 10));
    expect(editor().state.doc.toString()).toBe('newer');
  });
  it('stops a close-left batch on cancel without closing later tabs', async () => {
    await mount(); key('n'); key('n'); await nextTick();
    await rightClick(root.querySelectorAll('.tab')[2]); await choose('关闭左侧标签');
    expect(root.querySelector('[role="dialog"]')?.textContent).toContain('未命名1.txt');
    [...root.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === '取消')!.click(); await nextTick();
    expect(root.querySelectorAll('.tab')).toHaveLength(3);
  });
  it('closes a batch in order and retains one empty tab after closing all', async () => {
    await mount(); key('n'); key('n'); await nextTick();
    await rightClick(root.querySelectorAll('.tab')[1]); await choose('关闭全部标签');
    for (const name of ['未命名1.txt', '未命名2.txt', '未命名3.txt']) {
      expect(root.querySelector('[role="dialog"]')?.textContent).toContain(name);
      expect(document.activeElement?.textContent).toBe('取消');
      const discard = [...root.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === '不保存')!;
      discard.focus(); discard.click();
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(root.querySelectorAll('.tab')).toHaveLength(1); expect(editor().state.doc.length).toBe(0);
    expect(root.querySelector('[role="dialog"]')).toBeNull();
  });
  it('copies CSV cells, rows and columns with TSV quoting and maps to source', async () => {
    await mount(); await openDoc('table.csv', 'name,value\n"a,b","x\ny"\nc,3');
    const cell = root.querySelector('tbody td')!;
    await rightClick(cell); expect(labels()).toEqual(['复制单元格', '复制整行', '复制整列', '定位到源码']);
    await choose('复制整行'); expect(writeText).toHaveBeenLastCalledWith('a,b\t"x\ny"');
    await rightClick(cell); await choose('复制整列'); expect(writeText).toHaveBeenLastCalledWith('name\r\na,b\r\nc');
    await rightClick(root.querySelector('.csv-preview')!); expect(labels()).toEqual(['CSV 设置']);
    await rightClick(cell); await choose('定位到源码'); expect(editor().state.selection.main.head).toBe(11);
  });
  it('copies JSON properties, values and node source without losing integer precision', async () => {
    await mount(); await openDoc('data.json', '{"id":9007199254740993,"nested":{"x":1}}');
    const row = [...root.querySelectorAll('.json-preview-row')].find(row => row.textContent?.includes('id:'))!;
    await rightClick(row); expect(labels()).toEqual(['复制选中文字', '复制属性名', '复制值', '复制节点原文', '定位到源码']);
    await choose('复制值'); expect(writeText).toHaveBeenLastCalledWith('9007199254740993');
    await rightClick(row); await choose('复制节点原文'); expect(writeText).toHaveBeenLastCalledWith('"id":9007199254740993');
    await rightClick(row); await choose('复制属性名'); expect(writeText).toHaveBeenLastCalledWith('id');
  });
  it('shows compact and expanded JSON text without changing the source, and copies the visible preview', async () => {
    const source = '{ "id": 9007199254740993, "id": 2 }';
    await mount(); await openDoc('data.json', source);
    const compact = root.querySelector<HTMLButtonElement>('.json-preview-pane button[title^="压缩预览"]')!;
    compact.click(); await nextTick();
    expect(root.querySelector('.json-preview-text')?.textContent).toBe('{"id":9007199254740993,"id":2}');
    await rightClick(root.querySelector('.json-preview-text')!);
    expect(labels()).toEqual(['复制选中文字', '复制预览全文']);
    await choose('复制预览全文');
    expect(writeText).toHaveBeenLastCalledWith('{"id":9007199254740993,"id":2}');
    root.querySelector<HTMLButtonElement>('.json-preview-pane button[title^="展开预览"]')!.click(); await nextTick();
    const expanded = root.querySelector('.json-preview-text')!.textContent!;
    expect(expanded).toContain('\n  "id": 9007199254740993,');
    await rightClick(root.querySelector('.json-preview-text')!); await choose('复制预览全文');
    expect(writeText).toHaveBeenLastCalledWith(expanded);
    expect(editor().state.doc.toString()).toBe(source);
    expect(root.querySelector('[role="tab"][aria-label="data.json，已保存"]')).not.toBeNull();
  });
  it('formats JSON when entering live mode and keeps the result editable and undoable', async () => {
    const source = '{"id":9007199254740993,"nested":{"x":1}}';
    await mount(); await openDoc('data.json', source);
    root.querySelector<HTMLButtonElement>('.mode-switch button[aria-label="原位"]')!.click();
    await nextTick();
    const request = formatWorker.posted.at(-1)!;
    expect(request).toMatchObject({ kind: 'json', text: source });
    formatWorker.onmessage!({ data: { id: request.id, text: '{\n  "id": 9007199254740993,\n  "nested": {\n    "x": 1\n  }\n}' } } as MessageEvent);
    await nextTick();
    expect(editor().state.doc.toString()).toContain('\n  "id": 9007199254740993,');
    editor().dispatch({ changes: { from: editor().state.doc.length - 1, insert: ' ' } });
    expect(editor().state.doc.toString()).toContain('\n }');
    expect(undo(editor())).toBe(true);
    expect(undo(editor())).toBe(true);
    expect(editor().state.doc.toString()).toBe(source);
  });
  it('keeps right preview buttons limited to valid JSON and accepts JSONC comments', async () => {
    await mount(); await openDoc('broken.json', '{"x":}');
    expect(root.querySelector('.json-preview-pane button')).toBeNull();
    expect(root.querySelector('.json-raw')).not.toBeNull();
    await openDoc('commented.jsonc', '// keep\n{"x":1,}');
    root.querySelector<HTMLButtonElement>('.json-preview-pane button[title^="压缩预览"]')!.click(); await nextTick();
    expect(root.querySelector('.json-preview-text')?.textContent).toBe('// keep\n{"x":1,}');
  });
  it('exposes JSON actions after display-as and convert-to, and applies source transforms as one undoable edit', async () => {
    await mount();
    editor().dispatch({ changes: { from: 0, insert: '{"x":1}' } });
    const formatMenu = () => [...root.querySelectorAll<HTMLButtonElement>('.app-menu button')].find(button => button.textContent === '格式')!;
    formatMenu().click(); await nextTick();
    [...root.querySelectorAll<HTMLButtonElement>('.menu-popup button')].find(button => button.textContent === '显示为 JSON')!.click(); await nextTick();
    expect(root.querySelector('.json-float-actions button')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('.json-float-actions button')!.click();
    const escape = formatWorker.posted.at(-1)!;
    expect(escape.kind).toBe('escape');
    formatWorker.onmessage!({ data: { id: escape.id, text: JSON.stringify(escape.text) } } as MessageEvent);
    await nextTick();
    expect(editor().state.doc.toString()).toBe('"{\\"x\\":1}"');
    root.querySelectorAll<HTMLButtonElement>('.json-float-actions button')[1].click();
    const unescape = formatWorker.posted.at(-1)!;
    expect(unescape.kind).toBe('unescape');
    formatWorker.onmessage!({ data: { id: unescape.id, text: JSON.parse(unescape.text) } } as MessageEvent);
    await nextTick();
    expect(editor().state.doc.toString()).toBe('{"x":1}');
    undo(editor()); await nextTick();
    expect(editor().state.doc.toString()).toBe('"{\\"x\\":1}"');
    key('n'); await nextTick();
    editor().dispatch({ changes: { from: 0, insert: '{"y":2}' } });
    formatMenu().click(); await nextTick();
    [...root.querySelectorAll<HTMLButtonElement>('.menu-popup button')].find(button => button.textContent === '转为 JSON')!.click(); await nextTick();
    expect(root.querySelector('.json-preview-pane button')).not.toBeNull();
    expect(root.querySelectorAll('.json-float-actions button')).toHaveLength(4);
  });
  it('does not enter a live Markdown block on right-click and copies source or plain text', async () => {
    await mount(); await openDoc('note.md', '# Title\n\n**bold** text');
    const block = root.querySelector('.live-rendered')!; const anchor = editor().state.selection.main.head;
    block.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true, cancelable: true }));
    await rightClick(block); expect(editor().state.selection.main.head).toBe(anchor);
    expect(labels()).toEqual(['编辑块', '复制块原文', '复制块纯文本']);
    await choose('复制块原文'); expect(writeText).toHaveBeenLastCalledWith('**bold** text');
    await rightClick(block); await choose('复制块纯文本'); expect(writeText).toHaveBeenLastCalledWith('bold text');
  });
  it('provides preview and outline commands and suppresses chrome-region menus', async () => {
    await mount(); await openDoc('note.md', '# Title\n\n## Child\n\nParagraph');
    await rightClick(root.querySelector('.outline-link')!); expect(labels()).toEqual(['复制标题']);
    await choose('复制标题'); expect(writeText).toHaveBeenLastCalledWith('Title');
    await rightClick(root.querySelector('.sidebar')!); expect(labels()).toEqual(['全部展开', '全部折叠']);
    await choose('全部折叠'); expect(root.querySelectorAll('.outline-link')).toHaveLength(1);
    root.querySelector<HTMLButtonElement>('[aria-label="分屏"]')!.click(); await nextTick();
    await rightClick(root.querySelector('article.preview p')!); expect(labels()).toEqual(['复制选中文字', '复制所在块原文', '定位到源码']);
    await choose('复制所在块原文'); expect(writeText).toHaveBeenLastCalledWith('Paragraph');
    for (const selector of ['.titlebar', '.mode-switch', 'footer', '.cm-gutters']) {
      await rightClick(root.querySelector(selector)!); expect(root.querySelector('[role="menu"]')).toBeNull();
    }
  });
  it('limits search-input clipboard operations to that input', async () => {
    await mount(); editor().dispatch({ changes: { from: 0, insert: 'document' } });
    key('f'); await nextTick();
    const input = root.querySelector<HTMLInputElement>('input[name="search"]')!; input.value = 'query'; input.setSelectionRange(0, 5);
    await rightClick(input); expect(labels()).toEqual(['撤销', '剪切', '复制', '粘贴', '全选']);
    await choose('复制'); expect(writeText).toHaveBeenLastCalledWith('query'); expect(editor().state.doc.toString()).toBe('document');
    await rightClick(input); await choose('粘贴'); expect(input.value).toBe('pasted'); expect(editor().state.doc.toString()).toBe('document');
  });
});
afterEach(() => { unmount(); vi.unstubAllGlobals(); });

describe('editor typography', () => {
  it('changes global font size in settings and restores it after remounting', async () => {
    await mount();
    expect((root.querySelector('.app') as HTMLElement).style.getPropertyValue('--font-size-reading')).toBe('14px');
    [...root.querySelectorAll<HTMLButtonElement>('.menu-group > button')].find(button => button.textContent === '帮助')!.click();
    await nextTick();
    [...root.querySelectorAll<HTMLButtonElement>('.menu-popup button')].find(button => button.textContent?.trim() === '设置')!.click();
    await nextTick(); await nextTick();
    const input = root.querySelector<HTMLInputElement>('input[aria-label="字体大小"]')!;
    expect(input.value).toBe('14');
    input.value = '20'; input.dispatchEvent(new Event('change', { bubbles: true }));
    await nextTick();
    const appRoot = root.querySelector('.app') as HTMLElement;
    expect(appRoot.style.getPropertyValue('--font-size-reading')).toBe('20px');
    expect(appRoot.style.getPropertyValue('--font-size-code')).toBe('20px');
    expect(localStorage.getItem('znote-font-size')).toBe('20');
    for (const value of ['', '9', '33', '14.5']) {
      input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); await nextTick();
      expect(input.value).toBe('20');
      expect(localStorage.getItem('znote-font-size')).toBe('20');
    }
    unmount(); await mount();
    expect((root.querySelector('.app') as HTMLElement).style.getPropertyValue('--font-size-code')).toBe('20px');
  });

  it('uses reading type for prose and monospaced type for structured text', async () => {
    await mount();
    expect(root.querySelector('.writing-area')?.classList.contains('reading')).toBe(true);
    await openDoc('query.sql', 'select 1');
    expect(root.querySelector('.writing-area')?.classList.contains('structured')).toBe(true);
    await openDoc('notes.txt', '中文正文');
    expect(root.querySelector('.writing-area')?.classList.contains('reading')).toBe(true);
    [...root.querySelectorAll<HTMLButtonElement>('.app-menu button')].find(button => button.textContent === '格式')!.click();
    await nextTick();
    [...root.querySelectorAll<HTMLButtonElement>('.menu-popup button')].find(button => button.textContent === '显示为 JSON')!.click();
    await nextTick();
    expect(root.querySelector('.writing-area')?.classList.contains('structured')).toBe(true);
  });
});
describe('session lifecycle', () => {
  it('selects the nearest left tab after closing the active tab, or the right tab when first', async () => {
    await mount(); await openDoc('a.txt', 'a'); await openDoc('b.txt', 'b');
    root.querySelectorAll<HTMLButtonElement>('.tab .close-tab')[2].click(); await nextTick();
    expect(root.querySelector('.tab.active')?.textContent).toContain('a.txt');
    root.querySelectorAll<HTMLButtonElement>('.tab [role="tab"]')[0].click(); await nextTick();
    root.querySelectorAll<HTMLButtonElement>('.tab .close-tab')[0].click(); await nextTick();
    [...root.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === '不保存')!.click();
    await new Promise(resolve => setTimeout(resolve, 10)); await nextTick();
    expect(root.querySelector('.tab.active')?.textContent).toContain('a.txt');
    await openDoc('c.txt', 'c');
    root.querySelectorAll<HTMLButtonElement>('.tab [role="tab"]')[0].click(); await nextTick();
    root.querySelectorAll<HTMLButtonElement>('.tab .close-tab')[1].click(); await nextTick();
    expect(root.querySelector('.tab.active')?.textContent).toContain('a.txt');
  });
  it('shows associated files of every format as saved until their content changes', async () => {
    bridge.requests = ['txt', 'md', 'json', 'csv'].map((extension) => ({
      path: `C:/sample.${extension}`, text: extension === 'csv' ? 'name,value\na,1' : 'content',
      encoding: 'UTF-8', bom: false, lineEnding: 'LF', revision: 'revision',
    }));
    await mount();
    for (const extension of ['txt', 'md', 'json', 'csv']) {
      expect(root.querySelector(`[role="tab"][aria-label="sample.${extension}，已保存"]`)).not.toBeNull();
    }
    expect(root.querySelector('.csv-preview table')).not.toBeNull();
    key('s'); await new Promise(resolve => setTimeout(resolve, 10));
    expect(bridge.saveArgs).toMatchObject({ saveAs: true });
    key('w'); await nextTick();
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(root.querySelector('[role="tab"][aria-label="sample.csv，已保存"]')).toBeNull();
    root.querySelector<HTMLButtonElement>('[role="tab"][aria-label="sample.txt，已保存"]')!.click(); await nextTick();
    editor().dispatch({ changes: { from: 0, insert: 'edited ' } }); await nextTick();
    expect(root.querySelector('[role="tab"][aria-label="sample.txt，未保存"]')).not.toBeNull();
  });
  it('resizes CSV columns without changing save status and restores the widths', async () => {
    await mount(); await openDoc('table.csv', 'name,value\na,1');
    const handle = root.querySelector<HTMLElement>('.csv-preview th .csv-resize-handle')!;
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await nextTick();
    expect(root.querySelector('.csv-preview table')?.outerHTML).toContain('176px');
    handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 100 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 150 }));
    window.dispatchEvent(new MouseEvent('pointerup'));
    await nextTick();
    expect(root.querySelector('.csv-preview table')?.outerHTML).toContain('226px');
    expect(root.querySelector('[role="tab"][aria-label="table.csv，已保存"]')).not.toBeNull();
    await close();
    expect((bridge.data as { notes: { csvColumnWidths: number[] }[] }).notes[1].csvColumnWidths).toEqual([226, 160]);
    (bridge.data as { notes: { csvOptions: { firstRowHeader: boolean } }[] }).notes[1].csvOptions.firstRowHeader = false;
    unmount(); await mount();
    expect(root.querySelector('.csv-preview col')?.getAttribute('style')).toContain('226px');
    expect(root.querySelector('.csv-preview td .csv-resize-handle')).not.toBeNull();
    expect(root.querySelector('[role="tab"][aria-label="table.csv，已保存"]')).not.toBeNull();
  });
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
