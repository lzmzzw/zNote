<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, shallowRef, watch, nextTick } from 'vue';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, Decoration, ViewPlugin, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { json } from '@codemirror/lang-json';
import { search, searchKeymap, openSearchPanel } from '@codemirror/search';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, syntaxTree } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { FilePlus2, FolderOpen, Save, Search, Moon, Sun, PanelLeftClose, PanelLeft, FileText, X, Plus, Code2, Columns2, Eye, Braces, ChevronRight, Undo2, Redo2, NotebookPen } from 'lucide-vue-next';
import { renderMarkdown } from './preview';

interface NativeDocument { path: string | null; text: string; encoding: string; bom: boolean; lineEnding: string; revision: string | null }
interface Note extends NativeDocument { id: number; name: string; state: EditorState; saved: string; version: number; dirty: boolean; metaDirty: boolean }
const welcome = '# 好想法，值得留下。\n\n欢迎来到 **zNote**，你的轻量文本与 Markdown 工作空间。\n\n## 从这里开始\n\n安静地写作，清晰地思考。打开一份文档，或从一张白纸出发。\n\n- 用 **Ctrl + N** 新建笔记\n- 用 **Ctrl + O** 打开本地文件\n- 用 **Ctrl + S** 保存你的想法\n- 用 **Ctrl + F** 查找与替换\n\n## 专注于内容\n\n在「源码」「原位」「分屏」之间切换，用你喜欢的方式组织文字。原位模式会收起非当前行的标题、粗体与斜体标记。\n\n> 写作是把思考变得可见。\n\n### 一点小工具\n\n支持 JSON / JSONC 格式化，保留注释；每次格式化都能撤销。\n\n```json\n{ "idea": "从一个小想法开始", "version": 1 }\n```\n\n---\n\n所有文件都留在本机。没有账号，没有云同步。\n';
const notes = shallowRef<Note[]>([]); const activeId = ref(0); let nextId = 1;
const active = computed(() => notes.value.find(n => n.id === activeId.value));
const host = ref<HTMLElement>(); let view: EditorView | undefined;
const mode = ref<'source' | 'live' | 'split'>('live'); const dark = ref(false); const sidebar = ref(true);
const status = ref('准备就绪'); const busy = ref(false); const position = ref('行 1，列 1'); const count = ref(0);
const preview = ref(''); const headings = ref<{ title: string; from: number; level: number }[]>([]);
const theme = new Compartment(); const language = new Compartment(); const live = new Compartment();
const large = computed(() => (active.value?.state.doc.length ?? 0) > 1_000_000);
let refreshTimer: ReturnType<typeof setTimeout>; let recoveryTimer: ReturnType<typeof setTimeout>;
let worker: Worker; let formatId = 0; let pendingFormat: { id: number; note: Note; version: number } | undefined;
let recoveryWrite: Promise<unknown> = Promise.resolve();
let unlisten: (() => void) | undefined;
const closePrompt = shallowRef<{ kind: 'tab' | 'window'; note?: Note } | null>(null);
const native = isTauri();
const modalElement = ref<HTMLElement>(); let previousFocus: HTMLElement | null = null;
watch(closePrompt, async value => { if (value) { previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null; await nextTick(); modalElement.value?.querySelector<HTMLButtonElement>('button')?.focus(); } else { if (previousFocus?.isConnected) previousFocus.focus(); else view?.focus(); } });
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
function languageFor(name: string, size: number): Extension { return size > 1_000_000 ? [] : /\.jsonc?$/i.test(name) ? json() : markdown(); }
function stateFor(text: string, name: string) {
  return EditorState.create({ doc: text, extensions: [EditorState.phrases.of({ Find: '查找', Replace: '替换', next: '下一个', previous: '上一个', all: '全选匹配', replace: '替换', 'replace all': '全部替换', 'match case': '区分大小写', regexp: '正则表达式', 'by word': '全词匹配', close: '关闭', 'Go to line': '跳转到行', go: '跳转', 'current match': '当前匹配', 'on line': '所在行', 'replaced $ matches': '已替换 $ 处匹配', 'replaced match on line $': '已替换第 $ 行匹配' }), history(), drawSelection(), EditorView.lineWrapping, lineNumbers(), highlightActiveLine(), bracketMatching(), syntaxHighlighting(defaultHighlightStyle), search({ top: true }), keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]), theme.of(dark.value ? oneDark : []), language.of(languageFor(name, text.length)), live.of(mode.value === 'live' && text.length <= 1_000_000 ? livePlugin : []), EditorView.updateListener.of(u => {
    const note = active.value; if (!note) return; note.state = u.state;
    if (u.docChanged) { note.version++; note.dirty = true; touch(); clearTimeout(refreshTimer); refreshTimer = setTimeout(refreshDerived, 280); scheduleRecovery(); }
    if (u.selectionSet || u.docChanged) { const p = u.state.selection.main.head; const line = u.state.doc.lineAt(p); position.value = `行 ${line.number}，列 ${p - line.from + 1}`; count.value = u.state.doc.length; }
  })] });
}
function createNote(doc?: NativeDocument, name = '未命名.md') {
  const text = doc?.text ?? ''; const note: Note = { path: null, text: '', encoding: 'UTF-8', bom: false, lineEnding: 'LF', revision: null, ...doc, id: nextId++, name: doc?.path?.split(/[\\/]/).pop() ?? name, state: stateFor(text, doc?.path ?? name), saved: text, version: 0, dirty: false, metaDirty: false };
  notes.value = [...notes.value, note]; selectNote(note); return note;
}
function selectNote(note: Note) { if (view && active.value) active.value.state = view.state; activeId.value = note.id; view?.setState(note.state); reconfigure(); refreshDerived(); view?.focus(); }
function reconfigure() { if (!view || !active.value) return; view.dispatch({ effects: [theme.reconfigure(dark.value ? oneDark : []), language.reconfigure(languageFor(active.value.name, view.state.doc.length)), live.reconfigure(mode.value === 'live' && !large.value ? livePlugin : [])] }); }
function changeMode(value: typeof mode.value) { mode.value = value; reconfigure(); refreshDerived(); }
function toggleTheme() { dark.value = !dark.value; localStorage.setItem('znote-theme', dark.value ? 'dark' : 'light'); reconfigure(); }
function refreshDerived() {
  if (!active.value) return; const doc = active.value.state.doc; count.value = doc.length;
  if (doc.length > 1_000_000) { headings.value = []; preview.value = ''; reconfigure(); return; }
  const text = doc.toString(); active.value.dirty = active.value.metaDirty || text !== active.value.saved; touch();
  headings.value = []; for (let i = 1; i <= doc.lines; i++) { const l = doc.line(i); const m = /^(#{1,6})\s+(.+)/.exec(l.text); if (m) headings.value.push({ title: m[2], from: l.from, level: m[1].length }); }
  if (mode.value === 'split') preview.value = renderMarkdown(text);
}
function newNote() { createNote(); status.value = '新建笔记'; }
async function openFile() { if (!native) { status.value = '浏览器预览模式：本地打开与保存请使用桌面版'; return; } busy.value = true; try { const doc = await invoke<NativeDocument | null>('native_open'); if (doc) { const existing = notes.value.find(n => n.path === doc.path); if (existing) selectNote(existing); else createNote(doc); status.value = '文件已打开'; } } catch (e) { status.value = String(e); } finally { busy.value = false; } }
async function saveNote(note = active.value, saveAs = false): Promise<boolean> {
  if (!note) return true; if (!native) { status.value = '浏览器预览模式无法保存本地文件，请使用桌面版'; return false; }
  if (note.lineEnding === 'Mixed') { status.value = '混合换行：请先在底栏选择 LF 或 CRLF，再保存'; return false; }
  busy.value = true; const text = note.state.doc.toString(); const savingVersion = note.version;
  try { const doc = await invoke<NativeDocument | null>('native_save', { path: note.path, text, encoding: note.encoding, bom: note.bom, lineEnding: note.lineEnding, revision: note.revision, saveAs }); if (!doc) return false;
    const changedDuringSave = note.version !== savingVersion;
    Object.assign(note, { path: doc.path, encoding: changedDuringSave ? note.encoding : doc.encoding, bom: changedDuringSave ? note.bom : doc.bom, lineEnding: changedDuringSave ? note.lineEnding : doc.lineEnding, revision: doc.revision, saved: text, name: doc.path?.split(/[\\/]/).pop() ?? note.name, metaDirty: changedDuringSave && note.metaDirty, dirty: changedDuringSave && note.metaDirty || note.state.doc.toString() !== text }); touch(); reconfigure(); status.value = '已保存到本机'; scheduleRecovery(); if (note.dirty) { status.value = '保存期间有新修改，请再次保存'; return false; } return true;
  } catch (e) { status.value = String(e); return false; } finally { busy.value = false; }
}
function requestClose(note: Note) { if (note.dirty) closePrompt.value = { kind: 'tab', note }; else removeNote(note); }
function removeNote(note: Note) { notes.value = notes.value.filter(n => n.id !== note.id); if (!notes.value.length) createNote(); else if (activeId.value === note.id) selectNote(notes.value[0]); scheduleRecovery(); }
async function resolveClose(action: 'save' | 'discard' | 'cancel') {
  const prompt = closePrompt.value; if (!prompt || busy.value) return; if (action === 'cancel') { closePrompt.value = null; return; }
  if (action === 'save') { for (const note of prompt.kind === 'window' ? notes.value.filter(n => n.dirty) : [prompt.note!]) if (!(await saveNote(note))) return; }
  if (prompt.kind === 'tab' && action === 'discard' && native) { busy.value = true; const persisted = await persistRecovery(prompt.note?.id); busy.value = false; if (!persisted) return; }
  closePrompt.value = null;
  if (prompt.kind === 'tab') removeNote(prompt.note!); else { try { clearTimeout(recoveryTimer); await recoveryWrite; await invoke('recovery_save', { data: null }); await getCurrentWindow().destroy(); } catch (e) { status.value = String(e); } }
}
function formatJson() { const note = active.value; if (!note || busy.value) return; if (note.state.doc.length > 1_000_000) { status.value = '大文件模式下暂不格式化'; return; } const id = ++formatId; pendingFormat = { id, note, version: note.version }; status.value = '正在格式化…'; worker.postMessage({ id, text: note.state.doc.toString(), strict: /\.json$/i.test(note.name) }); }
async function persistRecovery(excludeId?: number): Promise<boolean> {
  if (!native) return true;
  clearTimeout(recoveryTimer);
  const data = notes.value.filter(n => n.id !== excludeId && n.dirty && n.state.doc.length <= 2_000_000).map(n => ({ path: n.path, text: n.state.doc.toString(), encoding: n.encoding, bom: n.bom, lineEnding: n.lineEnding, revision: n.revision, name: n.name }));
  if (new TextEncoder().encode(JSON.stringify(data)).length > 19_000_000) { status.value = '恢复草稿超过总量限制，已保留上次快照；请保存文件'; return false; }
  let succeeded = true;
  recoveryWrite = recoveryWrite.then(() => invoke('recovery_save', { data })).catch(e => { succeeded = false; status.value = `恢复草稿保存失败：${e}`; });
  await recoveryWrite; return succeeded;
}
function scheduleRecovery() { if (!native) return; clearTimeout(recoveryTimer); recoveryTimer = setTimeout(() => { void persistRecovery(); }, 1500); }

function shortcuts(e: KeyboardEvent) { if (closePrompt.value) { if (e.key === 'Escape') { e.preventDefault(); void resolveClose('cancel'); } if (e.key === 'Tab') { const buttons = [...(modalElement.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]; const first = buttons[0]; const last = buttons[buttons.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } } if (e.ctrlKey || e.metaKey) e.preventDefault(); return; } if (!(e.ctrlKey || e.metaKey)) return; const k = e.key.toLowerCase(); if (['n', 'o', 's', 'w'].includes(k)) { e.preventDefault(); if (busy.value) return; if (k === 'n') newNote(); if (k === 'o') void openFile(); if (k === 's') void saveNote(active.value, e.shiftKey); if (k === 'w' && active.value) requestClose(active.value); } }
function setEncoding(value: string) { if (active.value) { active.value.encoding = value; active.value.bom = value.startsWith('UTF-16'); active.value.dirty = true; active.value.metaDirty = true; active.value.version++; touch(); scheduleRecovery(); status.value = `保存时使用 ${value}`; } }
function setLineEnding(value: string) { if (active.value) { active.value.lineEnding = value; active.value.dirty = true; active.value.metaDirty = true; active.value.version++; touch(); scheduleRecovery(); status.value = `保存时统一换行为 ${value}`; } }
function beforeUnload(e: BeforeUnloadEvent) { if (notes.value.some(n => n.dirty)) { e.preventDefault(); e.returnValue = ''; } }
onMounted(async () => {
  dark.value = localStorage.getItem('znote-theme') === 'dark'; createNote({ path: null, text: welcome, encoding: 'UTF-8', bom: false, lineEnding: 'LF', revision: null }, '欢迎使用.md');
  view = new EditorView({ state: active.value!.state, parent: host.value }); refreshDerived();
  worker = new Worker(new URL('./format.worker.ts', import.meta.url), { type: 'module' }); worker.onmessage = ({ data }: MessageEvent<{ id: number; text?: string; error?: string }>) => { const pending = pendingFormat; if (!pending || data.id !== pending.id) return; pendingFormat = undefined; if (pending.note.version !== pending.version || !notes.value.includes(pending.note)) { status.value = '内容已变化，已忽略过期格式化结果'; return; } if (data.error) { status.value = data.error; return; } const changes = { from: 0, to: pending.note.state.doc.length, insert: data.text! }; if (pending.note === active.value) view?.dispatch({ changes, userEvent: 'input.format' }); else { pending.note.state = pending.note.state.update({ changes, userEvent: 'input.format' }).state; pending.note.version++; pending.note.dirty = true; touch(); scheduleRecovery(); } status.value = '已格式化 · Ctrl + Z 可撤销'; };
  window.addEventListener('keydown', shortcuts); window.addEventListener('beforeunload', beforeUnload);
  if (native) { unlisten = await getCurrentWindow().onCloseRequested(async event => { event.preventDefault(); if (notes.value.some(n => n.dirty)) closePrompt.value = { kind: 'window' }; else { clearTimeout(recoveryTimer); await recoveryWrite; await invoke('recovery_save', { data: null }); await getCurrentWindow().destroy(); } });
    try { const recovered = await invoke<(NativeDocument & { name: string; saved: string })[] | null>('recovery_load'); if (Array.isArray(recovered) && recovered.length) { for (const doc of recovered) if (doc && typeof doc.text === 'string' && typeof doc.name === 'string' && (doc.path === null || typeof doc.path === 'string') && (doc.revision === null || typeof doc.revision === 'string') && typeof doc.bom === 'boolean' && ['UTF-8', 'GBK', 'UTF-16LE', 'UTF-16BE'].includes(doc.encoding) && ['LF', 'CRLF', 'CR', 'Mixed'].includes(doc.lineEnding)) { const note = createNote({ ...doc, path: null, revision: null }, doc.name); note.saved = ''; note.dirty = true; note.metaDirty = true; } touch(); status.value = `已恢复 ${recovered.length} 份未保存草稿`; } } catch (e) { status.value = `恢复草稿读取失败：${e}`; }
  }
});
onBeforeUnmount(() => { view?.destroy(); worker?.terminate(); unlisten?.(); clearTimeout(refreshTimer); clearTimeout(recoveryTimer); window.removeEventListener('keydown', shortcuts); window.removeEventListener('beforeunload', beforeUnload); });
</script>

<template>
  <div class="app" :class="{ dark }">
    <aside v-if="sidebar" class="sidebar">
      <div class="brand"><span class="brand-icon"><NotebookPen :size="22" /></span><b>zNote<span class="version"> / 01</span></b></div>
      <div class="workspace-label">你的文字工作空间</div>
      <button class="new-button" @click="newNote"><Plus :size="17" /> 新建笔记 <kbd>Ctrl N</kbd></button>
      <div class="section-title">打开的文档 <span>{{ notes.length }}</span></div>
      <button v-for="note in notes" :key="note.id" class="document" :class="{ selected: note.id === activeId }" @click="selectNote(note)"><FileText :size="16" /><span>{{ note.name }}</span><span v-if="note.dirty" class="dirty-dot">●</span></button>
      <div class="section-title outline-title">文档大纲</div>
      <nav class="outline" aria-label="文档大纲"><button v-for="heading in headings" :key="heading.from" :style="{ paddingLeft: `${12 + (heading.level - 1) * 12}px` }" @click="view?.dispatch({ selection: { anchor: heading.from }, scrollIntoView: true })"><ChevronRight :size="12" />{{ heading.title }}</button><p v-if="!headings.length">{{ large ? '大文件模式已停用大纲' : '使用 # 标题组织你的想法' }}</p></nav>
      <div class="sidebar-bottom"><span class="local-dot"></span> 本地优先，安心书写 <span>v0.1.0</span></div>
    </aside>
    <main>
      <header class="toolbar"><div class="toolbar-group"><button :title="sidebar ? '收起侧栏' : '展开侧栏'" @click="sidebar = !sidebar"><PanelLeftClose v-if="sidebar" :size="19" /><PanelLeft v-else :size="19" /></button><span class="divider"></span><button title="新建 Ctrl+N" @click="newNote"><FilePlus2 :size="18" /></button><button title="打开 Ctrl+O" :disabled="busy" @click="openFile"><FolderOpen :size="18" /></button><button title="保存 Ctrl+S" :disabled="busy" @click="saveNote()"><Save :size="18" /></button><button class="save-as" :disabled="busy" @click="saveNote(active, true)">另存为</button><span class="divider"></span><button title="撤销 Ctrl+Z" @click="view && undo(view)"><Undo2 :size="17" /></button><button title="重做 Ctrl+Y" @click="view && redo(view)"><Redo2 :size="17" /></button></div><div class="toolbar-group"><button title="查找与替换 Ctrl+F" @click="view && openSearchPanel(view)"><Search :size="18" /></button><button title="JSON / JSONC 格式化" @click="formatJson"><Braces :size="18" /></button><span class="divider"></span><button :title="dark ? '切换浅色' : '切换深色'" @click="toggleTheme"><Sun v-if="dark" :size="18" /><Moon v-else :size="18" /></button></div></header>
      <div class="tabs" role="tablist"><div v-for="note in notes" :key="note.id" class="tab" :class="{ active: note.id === activeId }"><button role="tab" :aria-selected="note.id === activeId" @click="selectNote(note)"><FileText :size="14" />{{ note.name }}<span v-if="note.dirty" class="dirty-dot">●</span></button><button class="close-tab" :aria-label="`关闭 ${note.name}`" @click="requestClose(note)"><X :size="13" /></button></div><button class="add-tab" title="新建笔记" @click="newNote"><Plus :size="16" /></button></div>
      <div class="document-bar"><div class="breadcrumb"><span>工作空间</span><ChevronRight :size="13" /><strong :title="active?.path ?? ''">{{ active?.name }}</strong><span v-if="active?.dirty" class="unsaved">未保存</span></div><div class="mode-switch" aria-label="编辑模式"><button :class="{ chosen: mode === 'source' }" @click="changeMode('source')"><Code2 :size="14" />源码</button><button :class="{ chosen: mode === 'live' }" @click="changeMode('live')"><Eye :size="14" />原位</button><button :class="{ chosen: mode === 'split' }" @click="changeMode('split')"><Columns2 :size="14" />分屏</button></div></div>
      <div v-if="large" class="notice">大文件模式 · 已暂停语法分析、大纲和预览；超过 200 万字符不写恢复草稿，请及时保存。</div>
      <div class="writing-area" :class="{ split: mode === 'split' && !large, live: mode === 'live' }"><div ref="host" class="editor-host"></div><article v-if="mode === 'split' && !large" class="preview" @click.prevent v-html="preview"></article></div>
      <footer><span class="status-message" role="status">{{ status }}</span><span>{{ position }}</span><span>{{ count.toLocaleString() }} 字符</span><select aria-label="保存编码" :value="active?.encoding" @change="setEncoding(($event.target as HTMLSelectElement).value)"><option>UTF-8</option><option>GBK</option><option>UTF-16LE</option><option>UTF-16BE</option></select><select aria-label="换行格式" :value="active?.lineEnding" @change="setLineEnding(($event.target as HTMLSelectElement).value)"><option v-if="active?.lineEnding === 'Mixed'" disabled>Mixed</option><option>LF</option><option>CRLF</option><option>CR</option></select><span>{{ /\.jsonc?$/i.test(active?.name ?? '') ? 'JSON' : 'Markdown' }}</span></footer>
    </main>
    <div v-if="closePrompt" class="modal-backdrop"><section ref="modalElement" class="modal" role="dialog" aria-modal="true" aria-labelledby="close-title"><h2 id="close-title">保存尚未完成的想法？</h2><p>{{ closePrompt.kind === 'window' ? '有文档尚未保存。关闭之前，可以将它们保存到本机。' : `“${closePrompt.note?.name}”的修改尚未保存。` }}</p><div><button :disabled="busy" @click="resolveClose('cancel')">取消</button><button :disabled="busy" @click="resolveClose('discard')">不保存</button><button class="primary" :disabled="busy" @click="resolveClose('save')">{{ busy ? '保存中…' : '保存并关闭' }}</button></div></section></div>
  </div>
</template>
