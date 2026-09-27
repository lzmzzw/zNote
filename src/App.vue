<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, shallowRef, watch, nextTick } from 'vue';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, Decoration, ViewPlugin, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { json } from '@codemirror/lang-json';
import { search, searchKeymap, openSearchPanel } from '@codemirror/search';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, syntaxTree } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { FilePlus2, FolderOpen, Save, Download, Search, FileText, X, Plus, Code2, Columns2, Eye, Braces, ChevronRight, ChevronDown, PanelLeftClose, PanelLeftOpen, Minus, Square, Copy, Scissors, ClipboardPaste, Settings, RefreshCw } from 'lucide-vue-next';
import { renderMarkdown, markdownHeadings } from './preview';
import { buildOutline, visibleOutline, type OutlineNode } from './outline';
import { parseCsv } from './csv';
import { jsonPreviewRows, type JsonPreviewRow } from './json-preview';

interface NativeDocument { path: string | null; text: string; encoding: string; bom: boolean; lineEnding: string; revision: string | null }
type NoteFormat = 'txt' | 'markdown' | 'json' | 'csv';
function formatForName(name: string): NoteFormat { return /\.md$|\.markdown$/i.test(name) ? 'markdown' : /\.jsonc?$/i.test(name) ? 'json' : /\.csv$/i.test(name) ? 'csv' : 'txt'; }
interface Note extends NativeDocument { id: number; name: string; format: NoteFormat; state: EditorState; saved: string; version: number; dirty: boolean; metaDirty: boolean }
const welcome = '# 好想法，值得留下。\n\n欢迎来到 **zNote**，你的轻量文本与 Markdown 工作空间。\n\n## 从这里开始\n\n安静地写作，清晰地思考。打开一份文档，或从一张白纸出发。\n\n- 用 **Ctrl + N** 新建笔记\n- 用 **Ctrl + O** 打开本地文件\n- 用 **Ctrl + S** 保存你的想法\n- 用 **Ctrl + F** 查找与替换\n\n## 专注于内容\n\n在「源码」「原位」「分屏」之间切换，用你喜欢的方式组织文字。原位模式会收起非当前行的标题、粗体与斜体标记。\n\n> 写作是把思考变得可见。\n\n### 一点小工具\n\n支持 JSON / JSONC 格式化，保留注释；每次格式化都能撤销。\n\n```json\n{ "idea": "从一个小想法开始", "version": 1 }\n```\n\n---\n\n所有文件都留在本机。没有账号，没有云同步。\n';
const notes = shallowRef<Note[]>([]); const activeId = ref(0); let nextId = 1;
const active = computed(() => notes.value.find(n => n.id === activeId.value));
const host = ref<HTMLElement>(); let view: EditorView | undefined;
const mode = ref<'source' | 'live' | 'split'>('live'); const dark = ref(false);
const status = ref('准备就绪'); const busy = ref(false); const position = ref('行 1，列 1'); const count = ref(0);
const toast = ref(''); let toastTimer: ReturnType<typeof setTimeout>;
watch(status, value => { if (value === '准备就绪') return; toast.value = value; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.value = ''; }, 4000); });
const preview = ref(''); const headings = ref<OutlineNode[]>([]);
const outlineCollapsed = ref(false);
const collapsedHeadings = ref<Record<number, string[]>>({});
const shownHeadings = computed(() => visibleOutline(headings.value, new Set(collapsedHeadings.value[activeId.value] ?? [])));
function toggleHeading(key: string) {
  const collapsed = new Set(collapsedHeadings.value[activeId.value] ?? []);
  if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
  collapsedHeadings.value = { ...collapsedHeadings.value, [activeId.value]: [...collapsed] };
}
function goToHeading(heading: OutlineNode) { view?.dispatch({ selection: { anchor: heading.from }, scrollIntoView: true }); view?.focus(); }
const csvRows = ref<string[][]>([]); const csvRowLines = ref<{ start: number; end: number }[]>([]); const csvError = ref<string | null>(null);
const jsonRows = ref<JsonPreviewRow[]>([]); const previewHost = ref<HTMLElement>();
let pendingSourceScroll: number | null = null; let pendingPreviewScroll: number | null = null;
let cachedScrollAnchors: { source: number; preview: number }[] | null = null;
const currentFormat = computed(() => notes.value.find(note => note.id === activeId.value)?.format);
const isCsv = computed(() => currentFormat.value === 'csv');
const isMarkdown = computed(() => currentFormat.value === 'markdown');
const isJson = computed(() => currentFormat.value === 'json');
const menu = ref<'file' | 'edit' | 'format' | 'help' | null>(null);
const settingsOpen = ref(false);
const theme = new Compartment(); const language = new Compartment(); const live = new Compartment();
const large = computed(() => (notes.value.find(note => note.id === activeId.value)?.state.doc.length ?? 0) > 1_000_000);
const canExport = computed(() => !busy.value && !large.value && isMarkdown.value);
let refreshTimer: ReturnType<typeof setTimeout>; let recoveryTimer: ReturnType<typeof setTimeout>;
let worker: Worker; let formatId = 0; let pendingFormat: { id: number; note: Note; version: number } | undefined;
let recoveryWrite: Promise<unknown> = Promise.resolve();
let unlisten: (() => void) | undefined;
const closePrompt = shallowRef<{ kind: 'tab' | 'window'; note?: Note } | null>(null);
const native = isTauri();
const modalElement = ref<HTMLElement>(); let previousFocus: HTMLElement | null = null;
const settingsElement = ref<HTMLElement>(); let settingsPreviousFocus: HTMLElement | null = null;
watch(closePrompt, async value => { if (value) { previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null; await nextTick(); modalElement.value?.querySelector<HTMLButtonElement>('button')?.focus(); } else { if (previousFocus?.isConnected) previousFocus.focus(); else view?.focus(); } });
watch(settingsOpen, async value => { if (value) { settingsPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null; await nextTick(); settingsElement.value?.querySelector<HTMLButtonElement>('button')?.focus(); } else if (settingsPreviousFocus?.isConnected) settingsPreviousFocus.focus(); });
function touch() { notes.value = [...notes.value]; }
function liveDecorations(v: EditorView) {
  const ranges = [];
  for (const { from, to } of v.visibleRanges) for (let pos = from; pos <= to;) {
    const line = v.state.doc.lineAt(pos); const match = /^(#{1,6})\s/.exec(line.text);
    if (match) ranges.push(Decoration.line({ class: `live-heading live-h${match[1].length}` }).range(line.from));
    if (/^>\s/.test(line.text)) ranges.push(Decoration.line({ class: 'live-quote' }).range(line.from));
    pos = line.to + 1;
  }
  const selection = v.state.selection.main;
  const selectedFrom = v.state.doc.lineAt(selection.from).from;
  const selectedTo = v.state.doc.lineAt(selection.to).to;
  for (const visible of v.visibleRanges) syntaxTree(v.state).iterate({ from: visible.from, to: visible.to, enter(node) {
    if (!['HeaderMark', 'EmphasisMark'].includes(node.name)) return;
    if (node.from <= selectedTo && node.to >= selectedFrom) return;
    let to = node.to;
    if (node.name === 'HeaderMark' && v.state.doc.sliceString(to, to + 1) === ' ') to++;
    ranges.push(Decoration.replace({}).range(node.from, to));
  } });
  return Decoration.set(ranges, true);
}
const livePlugin = ViewPlugin.fromClass(class { decorations: DecorationSet; constructor(v: EditorView) { this.decorations = liveDecorations(v); } update(u: { docChanged: boolean; viewportChanged: boolean; selectionSet: boolean; view: EditorView }) { if (u.docChanged || u.viewportChanged || u.selectionSet) this.decorations = liveDecorations(u.view); } }, { decorations: v => v.decorations });
function scrollAnchors() {
  if (!view || !previewHost.value) return [{ source: 0, preview: 0 }];
  const sourceMax = Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight);
  const previewMax = Math.max(0, previewHost.value.scrollHeight - previewHost.value.clientHeight);
  if (cachedScrollAnchors?.at(-1)?.source === sourceMax && cachedScrollAnchors.at(-1)?.preview === previewMax) return cachedScrollAnchors;
  const previewRect = previewHost.value.getBoundingClientRect();
  const anchors = [{ source: 0, preview: 0 }];
  for (const item of previewHost.value.querySelectorAll<HTMLElement>('[data-source-start]')) {
    const line = Math.min(view.state.doc.lines, Number(item.dataset.sourceStart));
    const source = view.lineBlockAt(view.state.doc.line(line).from).top;
    const preview = item.getBoundingClientRect().top - previewRect.top + previewHost.value.scrollTop;
    const last = anchors[anchors.length - 1];
    if (source > last.source && preview > last.preview && source < sourceMax && preview < previewMax) anchors.push({ source, preview });
  }
  anchors.push({ source: sourceMax, preview: previewMax });
  cachedScrollAnchors = anchors;
  return cachedScrollAnchors;
}
function mapScroll(value: number, from: 'source' | 'preview') {
  const to = from === 'source' ? 'preview' : 'source';
  const anchors = scrollAnchors();
  for (let index = 1; index < anchors.length; index++) {
    const before = anchors[index - 1]; const after = anchors[index];
    if (value <= after[from] || index === anchors.length - 1) {
      const span = after[from] - before[from];
      return before[to] + (span ? (value - before[from]) / span : 0) * (after[to] - before[to]);
    }
  }
  return 0;
}
function onSourceScroll() {
  if (mode.value !== 'split' || !view || !previewHost.value) return;
  if (pendingSourceScroll !== null && Math.abs(view.scrollDOM.scrollTop - pendingSourceScroll) < 1) { pendingSourceScroll = null; return; }
  pendingSourceScroll = null;
  previewHost.value.scrollTop = mapScroll(view.scrollDOM.scrollTop, 'source');
  pendingPreviewScroll = previewHost.value.scrollTop;
}
function onPreviewScroll() {
  if (!view || !previewHost.value) return;
  if (pendingPreviewScroll !== null && Math.abs(previewHost.value.scrollTop - pendingPreviewScroll) < 1) { pendingPreviewScroll = null; return; }
  pendingPreviewScroll = null;
  view.scrollDOM.scrollTop = mapScroll(previewHost.value.scrollTop, 'preview');
  pendingSourceScroll = view.scrollDOM.scrollTop;
}
function highlightPreviewLine() {
  if (!view || !previewHost.value) return;
  const position = view.state.selection.main.head;
  const line = view.state.doc.lineAt(view.state.selection.main.head).number;
  previewHost.value.querySelector('.preview-selected')?.classList.remove('preview-selected');
  const distance = (item: HTMLElement) => {
    if (item.dataset.sourceFrom !== undefined) {
      const from = Number(item.dataset.sourceFrom); const to = Number(item.dataset.sourceTo);
      return position < from ? from - position : position >= to ? position - to + 1 : 0;
    }
    const start = Number(item.dataset.sourceStart); const end = Number(item.dataset.sourceEnd ?? start);
    return line < start ? start - line : line > end ? line - end : 0;
  };
  let selected: HTMLElement | null = null; let bestDistance = Infinity; let bestSpan = Infinity;
  for (const item of previewHost.value.querySelectorAll<HTMLElement>('[data-source-start]')) {
    const itemDistance = distance(item);
    const span = Number(item.dataset.sourceTo ?? item.dataset.sourceEnd ?? item.dataset.sourceStart) - Number(item.dataset.sourceFrom ?? item.dataset.sourceStart);
    if (itemDistance < bestDistance || itemDistance === bestDistance && span < bestSpan) { selected = item; bestDistance = itemDistance; bestSpan = span; }
  }
  selected?.classList.add('preview-selected');
}
function onPreviewClick(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-source-start]') : null;
  if (!target || !view) return;
  const line = Math.min(view.state.doc.lines, Number(target.dataset.sourceStart));
  const anchor = target.dataset.sourceFrom === undefined ? view.state.doc.line(line).from : Number(target.dataset.sourceFrom);
  view.dispatch({ selection: { anchor }, scrollIntoView: true });
  view.focus();
}
function languageFor(format: NoteFormat, size: number): Extension { return size > 1_000_000 ? [] : format === 'json' ? json() : format === 'markdown' ? markdown() : []; }
function stateFor(text: string, format: NoteFormat) {
  return EditorState.create({ doc: text, extensions: [EditorState.phrases.of({ Find: '查找', Replace: '替换', next: '下一个', previous: '上一个', all: '全选匹配', replace: '替换', 'replace all': '全部替换', 'match case': '区分大小写', regexp: '正则表达式', 'by word': '全词匹配', close: '关闭', 'Go to line': '跳转到行', go: '跳转', 'current match': '当前匹配', 'on line': '所在行', 'replaced $ matches': '已替换 $ 处匹配', 'replaced match on line $': '已替换第 $ 行匹配' }), history(), drawSelection(), EditorView.lineWrapping, lineNumbers(), highlightActiveLine(), bracketMatching(), syntaxHighlighting(defaultHighlightStyle), search({ top: true }), keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]), theme.of(dark.value ? oneDark : []), language.of(languageFor(format, text.length)), live.of(mode.value === 'live' && format === 'markdown' && text.length <= 1_000_000 ? livePlugin : []), EditorView.updateListener.of(u => {
    const note = active.value; if (!note) return; note.state = u.state;
    if (u.docChanged) { note.version++; note.dirty = true; touch(); clearTimeout(refreshTimer); refreshTimer = setTimeout(refreshDerived, 280); scheduleRecovery(); }
    if (u.selectionSet || u.docChanged) { const p = u.state.selection.main.head; const line = u.state.doc.lineAt(p); position.value = `行 ${line.number}，列 ${p - line.from + 1}`; count.value = u.state.doc.length; highlightPreviewLine(); }
  })] });
}
function createNote(doc?: NativeDocument, name = '未命名.txt') {
  const text = doc?.text ?? ''; const noteName = doc?.path?.split(/[\\/]/).pop() ?? name; const format = formatForName(noteName);
  const note: Note = { path: null, text: '', encoding: 'UTF-8', bom: false, lineEnding: 'LF', revision: null, ...doc, id: nextId++, name: noteName, format, state: stateFor(text, format), saved: text, version: 0, dirty: false, metaDirty: false };
  notes.value = [...notes.value, note]; selectNote(note); return note;
}
function selectNote(note: Note) { if (view && active.value) active.value.state = view.state; activeId.value = note.id; view?.setState(note.state); cachedScrollAnchors = null; pendingSourceScroll = null; pendingPreviewScroll = null; reconfigure(); refreshDerived(); const head = note.state.selection.main.head; const line = note.state.doc.lineAt(head); position.value = `行 ${line.number}，列 ${head - line.from + 1}`; view?.focus(); }
function reconfigure() { if (!view || !active.value) return; view.dispatch({ effects: [theme.reconfigure(dark.value ? oneDark : []), language.reconfigure(languageFor(active.value.format, view.state.doc.length)), live.reconfigure(mode.value === 'live' && !large.value && isMarkdown.value ? livePlugin : [])] }); }
function changeMode(value: typeof mode.value) { mode.value = value; cachedScrollAnchors = null; pendingSourceScroll = null; pendingPreviewScroll = null; reconfigure(); refreshDerived(); }
function toggleTheme() { dark.value = !dark.value; localStorage.setItem('znote-theme', dark.value ? 'dark' : 'light'); reconfigure(); }
function refreshDerived() {
  if (!active.value) return; const doc = active.value.state.doc; count.value = doc.length;
  cachedScrollAnchors = null;
  if (doc.length > 1_000_000) { headings.value = []; preview.value = ''; csvRows.value = []; csvRowLines.value = []; jsonRows.value = []; csvError.value = null; reconfigure(); return; }
  const text = doc.toString(); active.value.dirty = active.value.metaDirty || text !== active.value.saved; touch();
  headings.value = isMarkdown.value ? buildOutline(markdownHeadings(text).map(item => ({ title: item.title, level: item.level, from: doc.line(item.line).from }))) : [];
  if (mode.value === 'split') {
    if (isCsv.value) { const parsed = parseCsv(text); csvRows.value = parsed.rows; csvRowLines.value = parsed.rowLines; csvError.value = parsed.error; }
    else if (isMarkdown.value) preview.value = renderMarkdown(text);
    else if (isJson.value) jsonRows.value = jsonPreviewRows(text);
    void nextTick(() => { highlightPreviewLine(); onSourceScroll(); });
  }
}
function newNote() { createNote(); changeMode('source'); status.value = '新建笔记'; }
async function openFile() { if (!native) { status.value = '浏览器预览模式：本地打开与保存请使用桌面版'; return; } busy.value = true; try { const doc = await invoke<NativeDocument | null>('native_open'); if (doc) { const existing = notes.value.find(n => n.path === doc.path); if (existing) selectNote(existing); else createNote(doc); if (active.value?.format === 'csv') changeMode('split'); else if (active.value?.format === 'txt' && mode.value === 'split') changeMode('source'); status.value = '文件已打开'; } } catch (e) { status.value = String(e); } finally { busy.value = false; } }
async function saveNote(note = active.value, saveAs = false): Promise<boolean> {
  if (!note) return true; if (!native) { status.value = '浏览器预览模式无法保存本地文件，请使用桌面版'; return false; }
  if (note.lineEnding === 'Mixed') { status.value = '混合换行：请先在底栏选择 LF 或 CRLF，再保存'; return false; }
  busy.value = true; const text = note.state.doc.toString(); const savingVersion = note.version;
  try { const doc = await invoke<NativeDocument | null>('native_save', { path: note.path, name: note.name, text, encoding: note.encoding, bom: note.bom, lineEnding: note.lineEnding, revision: note.revision, saveAs }); if (!doc) return false;
    const changedDuringSave = note.version !== savingVersion;
    Object.assign(note, { path: doc.path, encoding: changedDuringSave ? note.encoding : doc.encoding, bom: changedDuringSave ? note.bom : doc.bom, lineEnding: changedDuringSave ? note.lineEnding : doc.lineEnding, revision: doc.revision, saved: text, name: doc.path?.split(/[\\/]/).pop() ?? note.name, metaDirty: changedDuringSave && note.metaDirty, dirty: changedDuringSave && note.metaDirty || note.state.doc.toString() !== text }); touch(); reconfigure(); status.value = '已保存到本机'; scheduleRecovery(); if (note.dirty) { status.value = '保存期间有新修改，请再次保存'; return false; } return true;
  } catch (e) { status.value = String(e); return false; } finally { busy.value = false; }
}
async function exportFormat(format: 'docx' | 'pdf') {
  menu.value = null;
  const note = active.value;
  if (!note || !canExport.value || !native || !['docx', 'pdf'].includes(format)) {
    status.value = native ? '仅支持导出 100 万字符以内的 Markdown 文档' : '请使用桌面版导出本地文件';
    return;
  }
  const text = note.state.doc.toString();
  busy.value = true;
  status.value = `正在生成 ${format.toUpperCase()}…`;
  try {
    const { exportMarkdown } = await import('./export');
    const bytes = await exportMarkdown(text, format);
    const saved = await invoke<boolean>('native_export', { name: note.name, format, bytes: Array.from(bytes) });
    status.value = saved ? `已导出 ${format.toUpperCase()} 到本机` : '已取消导出';
  } catch (error) { status.value = `导出失败：${error}`; }
  finally { busy.value = false; }
}
function requestClose(note: Note) { if (note.dirty) closePrompt.value = { kind: 'tab', note }; else removeNote(note); }
function removeNote(note: Note) { notes.value = notes.value.filter(n => n.id !== note.id); const { [note.id]: _removed, ...remaining } = collapsedHeadings.value; collapsedHeadings.value = remaining; if (!notes.value.length) createNote(); else if (activeId.value === note.id) selectNote(notes.value[0]); scheduleRecovery(); }
async function resolveClose(action: 'save' | 'discard' | 'cancel') {
  const prompt = closePrompt.value; if (!prompt || busy.value) return; if (action === 'cancel') { closePrompt.value = null; return; }
  if (action === 'save') { for (const note of prompt.kind === 'window' ? notes.value.filter(n => n.dirty) : [prompt.note!]) if (!(await saveNote(note))) return; }
  if (prompt.kind === 'tab' && action === 'discard' && native) { busy.value = true; const persisted = await persistRecovery(prompt.note?.id); busy.value = false; if (!persisted) return; }
  closePrompt.value = null;
  if (prompt.kind === 'tab') removeNote(prompt.note!); else { try { clearTimeout(recoveryTimer); await recoveryWrite; await invoke('recovery_save', { data: null }); await getCurrentWindow().destroy(); } catch (e) { status.value = String(e); } }
}
function formatJson() { const note = active.value; if (!note || busy.value || note.format !== 'json') return; if (note.state.doc.length > 1_000_000) { status.value = '大文件模式下暂不格式化'; return; } const id = ++formatId; pendingFormat = { id, note, version: note.version }; status.value = '正在格式化…'; worker.postMessage({ id, text: note.state.doc.toString(), strict: !/\.jsonc$/i.test(note.name) }); }
function changeFormat(format: Exclude<NoteFormat, 'txt'>) {
  const note = active.value; menu.value = null; if (!note) return;
  note.format = format;
  if (!note.path) note.name = note.name.replace(/\.[^.]+$/, '') + ({ markdown: '.md', json: '.json', csv: '.csv' }[format]);
  if (format === 'csv') mode.value = 'split';
  touch(); reconfigure(); refreshDerived(); scheduleRecovery(); status.value = `已切换为 ${format === 'markdown' ? 'Markdown' : format.toUpperCase()}`;
  if (format === 'json' && note.state.doc.length && !/\.jsonc$/i.test(note.name)) formatJson();
}
function toggleMenu(value: typeof menu.value) { menu.value = menu.value === value ? null : value; }
function searchPanel(replace = false) { menu.value = null; if (!view) return; openSearchPanel(view); if (replace) requestAnimationFrame(() => (view?.dom.querySelector('.cm-search input[name="replace"]') as HTMLInputElement | null)?.focus()); }
async function clipboardAction(action: 'copy' | 'cut' | 'paste') {
  menu.value = null; if (!view || busy.value) return;
  const current = view; const selection = current.state.selection.main; const note = active.value; const version = note?.version;
  try {
    if (action === 'paste') { const text = await navigator.clipboard.readText(); if (view !== current || active.value !== note || note?.version !== version) return; current.dispatch({ changes: { from: selection.from, to: selection.to, insert: text }, selection: { anchor: selection.from + text.length }, userEvent: 'input.paste' }); current.focus(); }
    else { if (selection.empty) return; await navigator.clipboard.writeText(current.state.doc.sliceString(selection.from, selection.to)); if (action === 'cut' && view === current && active.value === note && note?.version === version) { current.dispatch({ changes: { from: selection.from, to: selection.to }, userEvent: 'delete.cut' }); current.focus(); } }
  } catch (error) { status.value = `剪贴板操作失败：${error}`; }
}
async function checkUpdates() {
  menu.value = null; status.value = '正在检查更新…';
  try { const response = await fetch('https://api.github.com/repos/lzmzzw/zNote/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
    if (response.status === 404) { status.value = '暂无已发布的更新版本'; return; }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const release = await response.json() as { tag_name?: string; html_url?: string };
    const latest = release.tag_name?.replace(/^v/i, '') ?? '';
    if (!/^\d+\.\d+\.\d+$/.test(latest)) throw new Error('发布版本无效');
    const newer = latest.split('.').map(Number).some((part, index, parts) => part > [0, 1, 0][index] && parts.slice(0, index).every((previous, i) => previous === [0, 1, 0][i]));
    status.value = newer ? `发现版本 ${latest}，请访问项目发布页下载` : '当前已是最新版本 (0.1.0)';
  } catch (error) { status.value = `检查更新失败：${error}`; }
}
function closeWindow() { if (native) void getCurrentWindow().close(); }
function trapSettings(e: KeyboardEvent) {
  if (e.key !== 'Tab') return;
  const controls = [...(settingsElement.value?.querySelectorAll<HTMLElement>('button, select') ?? [])];
  if (e.shiftKey && document.activeElement === controls[0]) { e.preventDefault(); controls.at(-1)?.focus(); }
  else if (!e.shiftKey && document.activeElement === controls.at(-1)) { e.preventDefault(); controls[0]?.focus(); }
}
async function persistRecovery(excludeId?: number): Promise<boolean> {
  if (!native) return true;
  clearTimeout(recoveryTimer);
  const data = notes.value.filter(n => n.id !== excludeId && n.dirty && n.state.doc.length <= 2_000_000).map(n => ({ path: n.path, text: n.state.doc.toString(), encoding: n.encoding, bom: n.bom, lineEnding: n.lineEnding, revision: n.revision, name: n.name, format: n.format }));
  if (new TextEncoder().encode(JSON.stringify(data)).length > 19_000_000) { status.value = '恢复草稿超过总量限制，已保留上次快照；请保存文件'; return false; }
  let succeeded = true;
  recoveryWrite = recoveryWrite.then(() => invoke('recovery_save', { data })).catch(e => { succeeded = false; status.value = `恢复草稿保存失败：${e}`; });
  await recoveryWrite; return succeeded;
}
function scheduleRecovery() { if (!native) return; clearTimeout(recoveryTimer); recoveryTimer = setTimeout(() => { void persistRecovery(); }, 1500); }

function shortcuts(e: KeyboardEvent) { if (e.key === 'Escape') { menu.value = null; if (settingsOpen.value) settingsOpen.value = false; } if (closePrompt.value) { if (e.key === 'Escape') { e.preventDefault(); void resolveClose('cancel'); } if (e.key === 'Tab') { const buttons = [...(modalElement.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]; const first = buttons[0]; const last = buttons[buttons.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } } if (e.ctrlKey || e.metaKey) e.preventDefault(); return; } if (!(e.ctrlKey || e.metaKey)) return; const k = e.key.toLowerCase(); if (['n', 'o', 's', 'w'].includes(k)) { e.preventDefault(); if (busy.value) return; if (k === 'n') newNote(); if (k === 'o') void openFile(); if (k === 's') void saveNote(active.value, e.shiftKey); if (k === 'w' && active.value) requestClose(active.value); } }
function setEncoding(value: string) { if (active.value) { active.value.encoding = value; active.value.bom = value.startsWith('UTF-16'); active.value.dirty = true; active.value.metaDirty = true; active.value.version++; touch(); scheduleRecovery(); status.value = `保存时使用 ${value}`; } }
function setLineEnding(value: string) { if (active.value) { active.value.lineEnding = value; active.value.dirty = true; active.value.metaDirty = true; active.value.version++; touch(); scheduleRecovery(); status.value = `保存时统一换行为 ${value}`; } }
function beforeUnload(e: BeforeUnloadEvent) { if (notes.value.some(n => n.dirty)) { e.preventDefault(); e.returnValue = ''; } }
onMounted(async () => {
  dark.value = localStorage.getItem('znote-theme') === 'dark'; createNote({ path: null, text: welcome, encoding: 'UTF-8', bom: false, lineEnding: 'LF', revision: null }, '欢迎使用.md');
  view = new EditorView({ state: active.value!.state, parent: host.value }); view.scrollDOM.addEventListener('scroll', onSourceScroll); refreshDerived();
  worker = new Worker(new URL('./format.worker.ts', import.meta.url), { type: 'module' }); worker.onmessage = ({ data }: MessageEvent<{ id: number; text?: string; error?: string }>) => { const pending = pendingFormat; if (!pending || data.id !== pending.id) return; pendingFormat = undefined; if (pending.note.version !== pending.version || !notes.value.includes(pending.note)) { status.value = '内容已变化，已忽略过期格式化结果'; return; } if (data.error) { status.value = data.error; return; } const changes = { from: 0, to: pending.note.state.doc.length, insert: data.text! }; if (pending.note === active.value) view?.dispatch({ changes, userEvent: 'input.format' }); else { pending.note.state = pending.note.state.update({ changes, userEvent: 'input.format' }).state; pending.note.version++; pending.note.dirty = true; touch(); scheduleRecovery(); } status.value = '已格式化 · Ctrl + Z 可撤销'; };
  window.addEventListener('keydown', shortcuts); window.addEventListener('beforeunload', beforeUnload);
  if (native) { unlisten = await getCurrentWindow().onCloseRequested(async event => { event.preventDefault(); if (notes.value.some(n => n.dirty)) closePrompt.value = { kind: 'window' }; else { clearTimeout(recoveryTimer); await recoveryWrite; await invoke('recovery_save', { data: null }); await getCurrentWindow().destroy(); } });
    try { const recovered = await invoke<(NativeDocument & { name: string; format?: NoteFormat })[] | null>('recovery_load'); if (Array.isArray(recovered) && recovered.length) { for (const doc of recovered) if (doc && typeof doc.text === 'string' && typeof doc.name === 'string' && (doc.path === null || typeof doc.path === 'string') && (doc.revision === null || typeof doc.revision === 'string') && typeof doc.bom === 'boolean' && ['UTF-8', 'GBK', 'UTF-16LE', 'UTF-16BE'].includes(doc.encoding) && ['LF', 'CRLF', 'CR', 'Mixed'].includes(doc.lineEnding)) { const note = createNote({ ...doc, path: null, revision: null }, doc.name); if (['txt', 'markdown', 'json', 'csv'].includes(doc.format ?? '')) note.format = doc.format!; note.saved = ''; note.dirty = true; note.metaDirty = true; reconfigure(); } touch(); status.value = `已恢复 ${recovered.length} 份未保存草稿`; } } catch (e) { status.value = `恢复草稿读取失败：${e}`; }
  }
});
onBeforeUnmount(() => { view?.scrollDOM.removeEventListener('scroll', onSourceScroll); view?.destroy(); worker?.terminate(); unlisten?.(); clearTimeout(refreshTimer); clearTimeout(recoveryTimer); clearTimeout(toastTimer); window.removeEventListener('keydown', shortcuts); window.removeEventListener('beforeunload', beforeUnload); });
</script>

<template>
  <div class="app" :class="{ dark }" @pointerdown="menu && !($event.target as HTMLElement).closest('.app-menu') && (menu = null)">
    <div class="titlebar" data-tauri-drag-region>
      <img class="titlebar-icon" src="/znote.svg" alt="" width="20" height="20" data-tauri-drag-region />
      <nav class="app-menu" aria-label="主菜单">
        <div class="menu-group"><button :aria-expanded="menu === 'file'" @click="toggleMenu('file')">文件</button><div v-if="menu === 'file'" class="menu-popup">
          <button @click="menu = null; newNote()"><FilePlus2 :size="15" />新建 <kbd>Ctrl+N</kbd></button><button :disabled="busy" @click="menu = null; openFile()"><FolderOpen :size="15" />打开 <kbd>Ctrl+O</kbd></button><button :disabled="busy" @click="menu = null; saveNote()"><Save :size="15" />保存 <kbd>Ctrl+S</kbd></button><button :disabled="busy" @click="menu = null; saveNote(active, true)"><Save :size="15" />另存为 <kbd>Ctrl+Shift+S</kbd></button><hr /><details class="export-submenu"><summary><Download :size="15" />导出 <ChevronRight :size="14" class="export-chevron" /></summary><button :disabled="!canExport" class="menu-subitem" @click="exportFormat('docx')">Word (.docx)</button><button :disabled="!canExport" class="menu-subitem" @click="exportFormat('pdf')">PDF (.pdf)</button></details>
        </div></div>
        <div class="menu-group"><button :aria-expanded="menu === 'edit'" @click="toggleMenu('edit')">编辑</button><div v-if="menu === 'edit'" class="menu-popup">
          <button @click="clipboardAction('copy')"><Copy :size="15" />复制 <kbd>Ctrl+C</kbd></button><button @click="clipboardAction('cut')"><Scissors :size="15" />剪切 <kbd>Ctrl+X</kbd></button><button @click="clipboardAction('paste')"><ClipboardPaste :size="15" />粘贴 <kbd>Ctrl+V</kbd></button><button @click="clipboardAction('paste')"><ClipboardPaste :size="15" />粘贴为纯文本</button><hr /><button @click="searchPanel()"><Search :size="15" />查找 <kbd>Ctrl+F</kbd></button><button @click="searchPanel(true)"><Search :size="15" />替换</button>
        </div></div>
        <div class="menu-group"><button :aria-expanded="menu === 'format'" @click="toggleMenu('format')">格式</button><div v-if="menu === 'format'" class="menu-popup">
          <button :class="{ checked: active?.format === 'markdown' }" @click="changeFormat('markdown')">Markdown</button><button :class="{ checked: active?.format === 'json' }" @click="changeFormat('json')">JSON</button><button :class="{ checked: active?.format === 'csv' }" @click="changeFormat('csv')">CSV</button><hr /><button :disabled="active?.format !== 'json' || busy" @click="menu = null; formatJson()"><Braces :size="15" />格式化 JSON</button>
        </div></div>
        <div class="menu-group"><button :aria-expanded="menu === 'help'" @click="toggleMenu('help')">帮助</button><div v-if="menu === 'help'" class="menu-popup">
          <button @click="menu = null; settingsOpen = true"><Settings :size="15" />设置</button><button @click="checkUpdates"><RefreshCw :size="15" />检查更新</button>
        </div></div>
      </nav>
      <div class="titlebar-drag" data-tauri-drag-region></div>
      <div v-if="native" class="window-controls"><button title="最小化" aria-label="最小化" @click="getCurrentWindow().minimize()"><Minus :size="16" /></button><button title="最大化或还原" aria-label="最大化或还原" @click="getCurrentWindow().toggleMaximize()"><Square :size="13" /></button><button class="window-close" title="关闭" aria-label="关闭" @click="closeWindow"><X :size="17" /></button></div>
    </div>
    <div class="app-body">
    <aside v-if="isMarkdown && !large && !outlineCollapsed" class="sidebar">
      <div class="section-title outline-title">文档大纲</div>
      <nav class="outline" aria-label="文档大纲">
        <div v-for="heading in shownHeadings" :key="heading.key" class="outline-row" :style="{ paddingLeft: `${heading.depth * 14}px` }">
          <button v-if="heading.children.length" class="outline-disclosure" :aria-label="`${collapsedHeadings[activeId]?.includes(heading.key) ? '展开' : '折叠'} ${heading.title}`" :aria-expanded="!collapsedHeadings[activeId]?.includes(heading.key)" :title="collapsedHeadings[activeId]?.includes(heading.key) ? '展开子标题' : '折叠子标题'" @click="toggleHeading(heading.key)"><ChevronRight v-if="collapsedHeadings[activeId]?.includes(heading.key)" :size="13" /><ChevronDown v-else :size="13" /></button>
          <span v-else class="outline-disclosure-placeholder" aria-hidden="true"></span>
          <button class="outline-link" :title="heading.title" @click="goToHeading(heading)">{{ heading.title }}</button>
        </div>
        <p v-if="!headings.length" class="outline-empty">暂无标题</p>
      </nav>
    </aside>
    <main>
      <div class="tabs">
        <div class="tab-list" role="tablist"><div v-for="note in notes" :key="note.id" class="tab" :class="{ active: note.id === activeId }"><button role="tab" :aria-selected="note.id === activeId" @click="selectNote(note)"><FileText :size="14" />{{ note.name }}<span v-if="note.dirty" class="dirty-dot">●</span></button><button class="close-tab" :aria-label="`关闭 ${note.name}`" @click="requestClose(note)"><X :size="13" /></button></div><button class="add-tab" title="新建笔记" @click="newNote"><Plus :size="16" /></button></div>
        <div class="mode-switch" aria-label="编辑模式"><button :class="{ chosen: mode === 'source' }" @click="changeMode('source')"><Code2 :size="14" />源码</button><button :class="{ chosen: mode === 'live' }" @click="changeMode('live')"><Eye :size="14" />原位</button><button :class="{ chosen: mode === 'split' }" @click="changeMode('split')"><Columns2 :size="14" />分屏</button></div>
      </div>
      <div v-if="large" class="notice">大文件模式 · 已暂停语法分析、大纲和预览；超过 200 万字符不写恢复草稿，请及时保存。</div>
      <div class="writing-area" :class="{ split: mode === 'split' && !large && (isMarkdown || isCsv || isJson), live: mode === 'live' && isMarkdown }">
        <div ref="host" class="editor-host"></div>
        <article v-if="mode === 'split' && !large && isMarkdown" ref="previewHost" class="preview" aria-label="Markdown 预览" @scroll="onPreviewScroll" @click.prevent="onPreviewClick" v-html="preview"></article>
        <section v-if="mode === 'split' && !large && isJson" ref="previewHost" class="preview json-preview" aria-label="JSON 结构预览" @scroll="onPreviewScroll" @click="onPreviewClick">
          <div v-for="(row, index) in jsonRows" :key="index" class="json-preview-row" :class="`json-${row.kind}`" :data-source-start="row.line" :data-source-end="row.line" :data-source-from="row.from" :data-source-to="row.to" :style="{ paddingLeft: `${row.depth * 18}px` }"><span v-if="row.label" class="json-key">{{ row.label }}: </span><span>{{ row.value }}</span></div>
        </section>
        <section v-if="mode === 'split' && !large && isCsv" ref="previewHost" class="preview csv-preview" aria-label="CSV 表格预览" @scroll="onPreviewScroll" @click="onPreviewClick"><p v-if="csvError" class="csv-error" role="alert">{{ csvError }}</p><div v-if="csvRows.length" class="csv-table-wrap"><table><thead><tr :data-source-start="csvRowLines[0]?.start" :data-source-end="csvRowLines[0]?.end"><th v-for="(cell, index) in csvRows[0]" :key="index" scope="col">{{ cell }}</th></tr></thead><tbody><tr v-for="(row, rowIndex) in csvRows.slice(1)" :key="rowIndex" :data-source-start="csvRowLines[rowIndex + 1]?.start" :data-source-end="csvRowLines[rowIndex + 1]?.end"><td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}</td></tr></tbody></table></div><p v-else class="csv-empty">表格为空</p></section>
      </div>
      <footer><button v-if="isMarkdown && !large" class="outline-toggle" :aria-label="outlineCollapsed ? '展开文档大纲' : '收起文档大纲'" :title="outlineCollapsed ? '展开文档大纲' : '收起文档大纲'" :aria-expanded="!outlineCollapsed" @click="outlineCollapsed = !outlineCollapsed"><PanelLeftOpen v-if="outlineCollapsed" :size="15" /><PanelLeftClose v-else :size="15" /></button><span>{{ position }}</span><span>{{ count.toLocaleString() }} 字符</span><select aria-label="保存编码" :value="active?.encoding" @change="setEncoding(($event.target as HTMLSelectElement).value)"><option>UTF-8</option><option>GBK</option><option>UTF-16LE</option><option>UTF-16BE</option></select></footer>
    </main>
    </div>
    <div v-if="toast" class="status-toast" role="status">{{ toast }}</div>
    <div v-if="settingsOpen" class="modal-backdrop" @click.self="settingsOpen = false"><section ref="settingsElement" class="modal settings-modal" role="dialog" aria-modal="true" aria-label="设置" @keydown="trapSettings"><header><h2>设置</h2><button aria-label="关闭设置" @click="settingsOpen = false"><X :size="18" /></button></header><label>外观 <button @click="toggleTheme">{{ dark ? '深色' : '浅色' }}</button></label><label>保存编码 <select :value="active?.encoding" @change="setEncoding(($event.target as HTMLSelectElement).value)"><option>UTF-8</option><option>GBK</option><option>UTF-16LE</option><option>UTF-16BE</option></select></label><label>换行格式 <select :value="active?.lineEnding" @change="setLineEnding(($event.target as HTMLSelectElement).value)"><option v-if="active?.lineEnding === 'Mixed'" disabled>Mixed</option><option>LF</option><option>CRLF</option><option>CR</option></select></label></section></div>
    <div v-if="closePrompt" class="modal-backdrop"><section ref="modalElement" class="modal" role="dialog" aria-modal="true" aria-labelledby="close-title"><h2 id="close-title">保存尚未完成的想法？</h2><p>{{ closePrompt.kind === 'window' ? '有文档尚未保存。关闭之前，可以将它们保存到本机。' : `“${closePrompt.note?.name}”的修改尚未保存。` }}</p><div><button :disabled="busy" @click="resolveClose('cancel')">取消</button><button :disabled="busy" @click="resolveClose('discard')">不保存</button><button class="primary" :disabled="busy" @click="resolveClose('save')">{{ busy ? '保存中…' : '保存并关闭' }}</button></div></section></div>
  </div>
</template>
