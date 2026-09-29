<script setup lang="ts">
import 'katex/dist/katex.min.css';
import { computed, onMounted, onBeforeUnmount, ref, shallowRef, watch, nextTick } from 'vue';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, isolateHistory } from '@codemirror/commands';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { search, searchKeymap, openSearchPanel, searchPanelOpen } from '@codemirror/search';
import { bracketMatching } from '@codemirror/language';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getVersion } from '@tauri-apps/api/app';
import packageJson from '../package.json';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { listen } from '@tauri-apps/api/event';
import {
  FilePlus2,
  FolderOpen,
  Save,
  Download,
  Search,
  X,
  ChevronRight,
  ChevronLeft,
  Minus,
  Square,
  Copy,
  Scissors,
  ClipboardPaste,
  Settings,
  RefreshCw,
} from 'lucide-vue-next';
import { renderMarkdown, markdownHeadings } from './preview';
import { buildOutline, visibleOutline, type OutlineNode } from './outline';
import { defaultCsvOptions, parseCsv, type CsvOptions } from './csv';
import { buildJsonPreview, type JsonPreviewRow } from './json-preview';
import { compactJsonc, formatJsonc } from './format';
import { liveMarkdownBlocks } from './live-markdown';
import { hydrateDiagrams } from './diagram';
import { conversionMenuState, displayMenuState, needsSave, nextUntitledName } from './note-file';
import { parseSession, serializeEditor, restoreEditor, type Session, type SessionNote } from './session';
import { createPreviewSync } from './editor/preview-sync';
import { editorAppearance, languageFor, editorPhrases } from './editor/config';
import { decorateSearchPanel, resetSearchPanelPosition } from './editor/search-panel';
import AppDialog from './components/AppDialog.vue';
import SettingsDialog from './components/SettingsDialog.vue';
import DocumentTabs from './components/DocumentTabs.vue';
import DocumentOutline from './components/DocumentOutline.vue';
import ContextMenu from './components/ContextMenu.vue';
import OptionSelect from './components/OptionSelect.vue';
import { tabCloseTargets, spreadsheetText, type ContextMenuItem } from './context-menu';

import {
  defaultMode,
  formatForName,
  LARGE_DOCUMENT_LIMIT,
  encodingOptions,
  type NativeDocument,
  type Note,
  type NoteFormat,
  type DisplayMode,
  type MarkdownWidth,
} from './document';
const notes = shallowRef<Note[]>([]);
const activeId = ref(0);
let nextId = 1;
const active = computed(() => notes.value.find((n) => n.id === activeId.value));
const displayMenu = computed(() => displayMenuState(active.value?.path ?? null));
const conversionMenu = computed(() => conversionMenuState(active.value?.path ?? null));
const host = ref<HTMLElement>();
let view: EditorView | undefined;
const mode = ref<DisplayMode>('live');
const dark = ref(false);
const status = ref('准备就绪');
const appVersion = ref(packageJson.version);
const checkingUpdate = ref(false);
const busy = ref(false);
const position = ref('行 1，列 1');
const count = ref(0);
const toast = ref('');
let toastTimer: ReturnType<typeof setTimeout>;
watch(status, (value) => {
  if (value === '准备就绪') return;
  toast.value = value;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = '';
  }, 4000);
});
const preview = ref('');
const headings = ref<OutlineNode[]>([]);
const outlineCollapsed = ref(false);
const gutterWidth = ref(37);
let gutterObserver: ResizeObserver | undefined;
function observeGutter() {
  gutterObserver?.disconnect();
  const gutters = view?.dom.querySelector<HTMLElement>('.cm-gutters');
  if (!gutters) return;
  const measure = () => {
    gutterWidth.value = Math.max(37, gutters.getBoundingClientRect().width);
  };
  gutterObserver = new ResizeObserver(measure);
  gutterObserver.observe(gutters);
  measure();
}
const collapsedHeadings = ref<Record<number, string[]>>({});
function toggleHeading(key: string) {
  const collapsed = new Set(collapsedHeadings.value[activeId.value] ?? []);
  if (collapsed.has(key)) collapsed.delete(key);
  else collapsed.add(key);
  collapsedHeadings.value = { ...collapsedHeadings.value, [activeId.value]: [...collapsed] };
  scheduleRecovery();
}
function goToHeading(heading: OutlineNode) {
  view?.dispatch({ selection: { anchor: heading.from }, scrollIntoView: true });
  view?.focus();
}
const csvRows = ref<string[][]>([]);
const csvRowLines = ref<{ start: number; end: number }[]>([]);
const csvError = ref<string | null>(null);
const csvColumnCount = computed(() => csvRows.value.reduce((count, row) => Math.max(count, row.length), 0));
const csvWidths = computed(() => {
  const widths = notes.value.find((note) => note.id === activeId.value)?.csvColumnWidths ?? [];
  return widths.length === csvColumnCount.value ? widths : [];
});
let csvResize: { note: Note; column: number; startX: number; widths: number[] } | undefined;
function currentCsvWidths(cells: HTMLCollectionOf<HTMLTableCellElement>) {
  return csvWidths.value.length
    ? [...csvWidths.value]
    : [...cells].map((cell) => Math.min(1200, Math.max(80, Math.round(cell.getBoundingClientRect().width || 160))));
}
function stopCsvResize() {
  csvResize = undefined;
  window.removeEventListener('pointermove', moveCsvResize);
  window.removeEventListener('pointerup', stopCsvResize);
  window.removeEventListener('pointercancel', stopCsvResize);
}
function moveCsvResize(event: PointerEvent) {
  if (!csvResize) return;
  const { note, column, startX, widths } = csvResize;
  if (active.value !== note) return stopCsvResize();
  note.csvColumnWidths = [...widths];
  note.csvColumnWidths[column] = Math.max(
    80,
    Math.min(1200, Math.round(widths[column] + event.clientX - startX)),
  );
  touch();
  scheduleRecovery();
}
function startCsvResize(event: PointerEvent, column: number) {
  const note = active.value;
  const cells = previewHost.value?.querySelector<HTMLTableElement>('.csv-table-wrap table')?.rows[0]?.cells;
  if (!note || !cells || column >= cells.length) return;
  stopCsvResize();
  const widths = currentCsvWidths(cells);
  csvResize = { note, column, startX: event.clientX, widths };
  window.addEventListener('pointermove', moveCsvResize);
  window.addEventListener('pointerup', stopCsvResize);
  window.addEventListener('pointercancel', stopCsvResize);
}
function nudgeCsvColumn(column: number, amount: number) {
  const note = active.value;
  const cells = previewHost.value?.querySelector<HTMLTableElement>('.csv-table-wrap table')?.rows[0]?.cells;
  if (!note || !cells || column >= cells.length) return;
  const widths = currentCsvWidths(cells);
  widths[column] = Math.max(80, Math.min(1200, widths[column] + amount));
  note.csvColumnWidths = widths;
  touch();
  scheduleRecovery();
}
const jsonRows = ref<JsonPreviewRow[]>([]);
const jsonValid = ref(false);
const jsonPreviewText = ref('');
const jsonPreviewModes = ref<Record<number, 'compact' | 'expanded' | undefined>>({});
const jsonPreviewMode = computed(() => jsonPreviewModes.value[activeId.value]);
const previewHost = ref<HTMLElement>();
const previewSync = createPreviewSync(
  () => view,
  () => previewHost.value,
);
// Note 元数据是非深层响应式的，需直接订阅标签数组的刷新。
const currentFormat = computed(() => notes.value.find((note) => note.id === activeId.value)?.format);
const isStructuredText = computed(
  () => currentFormat.value === 'txt' && /\.(?:ya?ml|toml|xml|html|css|js|ts|rs|sql)$/i.test(active.value?.name ?? ''),
);
const isCsv = computed(() => currentFormat.value === 'csv');
const isMarkdown = computed(() => currentFormat.value === 'markdown');
const isJson = computed(() => currentFormat.value === 'json');
const menu = ref<'file' | 'edit' | 'format' | 'help' | null>(null);
const settings = ref<'general' | 'markdown' | 'csv' | null>(null);
const theme = new Compartment();
const language = new Compartment();
const live = new Compartment();
const editability = new Compartment();
const large = computed(
  () => (notes.value.find((note) => note.id === activeId.value)?.state.doc.length ?? 0) > LARGE_DOCUMENT_LIMIT,
);
const canExport = computed(() => !busy.value && !large.value && isMarkdown.value);
let refreshTimer: ReturnType<typeof setTimeout>;
let recoveryTimer: ReturnType<typeof setTimeout>;
let worker: Worker;
let formatId = 0;
let pendingFormat:
  { id: number; note: Note; version: number; format: NoteFormat; from: number; to: number; operation: 'format' | 'escape' | 'unescape' } | undefined;
let recoveryWrite: Promise<unknown> = Promise.resolve();
let sessionReady = false;
const closingWindow = ref(false);
let recoveryLoadFailed = false;
let restoringScroll = false;
let unlisten: (() => void) | undefined;
let unlistenAssociated: (() => void) | undefined;
let openingAssociated = false;
let pendingAssociated = false;
const closePrompt = shallowRef<{ note: Note } | null>(null);
let closeQueue: number[] = [];
const context = shallowRef<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
let contextFocus: HTMLElement | null = null;
function dismissContext() {
  context.value = null;
  if (contextFocus?.isConnected) contextFocus.focus({ preventScroll: true });
}
function showContext(event: MouseEvent, items: ContextMenuItem[]) {
  contextFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const target = event.target instanceof Element ? event.target : null;
  const rect = target?.getBoundingClientRect();
  context.value = { x: event.clientX || rect?.left || 0, y: event.clientY || rect?.bottom || 0, items };
}
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    status.value = '已复制';
  } catch (error) {
    status.value = `复制失败：${error}`;
  }
}
function selectedText(container: Element) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !container.contains(selection.anchorNode) || !container.contains(selection.focusNode))
    return '';
  return selection.toString();
}
function locateSource(note: Note, from: number) {
  if (!notes.value.includes(note)) return;
  if (active.value !== note) selectNote(note);
  if (note.format === 'csv' && mode.value === 'live') changeMode('source');
  view?.dispatch({ selection: { anchor: Math.min(from, note.state.doc.length) }, scrollIntoView: true });
  view?.focus();
}
function lineRange(note: Note, start: number, end: number) {
  const doc = note.state.doc;
  const from = doc.line(Math.max(1, Math.min(start, doc.lines))).from;
  const to = doc.line(Math.max(1, Math.min(end, doc.lines))).to;
  return { from, text: doc.sliceString(from, to) };
}
function onContextPointer(event: MouseEvent) {
  if (event.button === 2) event.preventDefault();
}
async function editorClipboard(action: 'copy' | 'cut' | 'paste', note: Note, selection = note.state.selection.main) {
  const version = note.version;
  const valid = () =>
    active.value === note &&
    notes.value.includes(note) &&
    note.version === version &&
    !busy.value &&
    !closingWindow.value;
  try {
    if (action === 'paste') {
      const text = await navigator.clipboard.readText();
      if (!valid()) return;
      view?.dispatch({
        changes: { from: selection.from, to: selection.to, insert: text },
        selection: { anchor: selection.from + text.length },
        userEvent: 'input.paste',
      });
    } else {
      if (selection.empty) return;
      await navigator.clipboard.writeText(note.state.doc.sliceString(selection.from, selection.to));
      if (action === 'cut' && valid())
        view?.dispatch({
          changes: { from: selection.from, to: selection.to },
          selection: { anchor: selection.from },
          userEvent: 'delete.cut',
        });
    }
    if (valid() || active.value === note) view?.focus();
  } catch (error) {
    status.value = `剪贴板操作失败：${error}`;
  }
}
function inputContext(input: HTMLInputElement | HTMLTextAreaElement): ContextMenuItem[] {
  const start = input.selectionStart ?? 0;
  const end = input.selectionEnd ?? start;
  const original = input.value;
  const editable = !input.disabled && !input.readOnly;
  const run = async (action: 'undo' | 'cut' | 'copy' | 'paste' | 'all') => {
    if (!input.isConnected || input.value !== original) return;
    try {
      if (action === 'copy' || action === 'cut') await navigator.clipboard.writeText(original.slice(start, end));
      const pasted = action === 'paste' ? await navigator.clipboard.readText() : '';
      if (!input.isConnected || input.value !== original) return;
      input.focus();
      input.setSelectionRange(start, end);
      if (action === 'all') input.select();
      else if (action === 'undo') document.execCommand('undo');
      else if (action === 'paste' || action === 'cut') {
        const inserted = action === 'paste' ? pasted : '';
        if (!document.execCommand?.('insertText', false, inserted)) {
          input.setRangeText(inserted, start, end, 'end');
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    } catch (error) {
      status.value = `输入框操作失败：${error}`;
    }
  };
  return [
    { label: '撤销', disabled: !editable, action: () => run('undo') },
    { label: '剪切', disabled: !editable || start === end, action: () => run('cut') },
    { label: '复制', disabled: start === end, action: () => run('copy') },
    { label: '粘贴', disabled: !editable, action: () => run('paste') },
    { label: '全选', disabled: !original.length, action: () => run('all') },
  ];
}
function onContextMenu(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  context.value = null;
  menu.value = null;
  const target = event.target instanceof Element ? event.target : null;
  if (!target || target.closest('.context-menu') || closingWindow.value || busy.value) return;
  const scrollable = target.closest<HTMLElement>(
    '.cm-scroller, .tab-list, .csv-table-wrap, .preview, .outline, .diagram-preview, pre, table, .katex-display',
  );
  if (scrollable === target && (event.clientX || event.clientY)) {
    const bounds = scrollable.getBoundingClientRect();
    if (
      (scrollable.scrollHeight > scrollable.clientHeight &&
        event.clientX >= bounds.left + scrollable.clientLeft + scrollable.clientWidth) ||
      (scrollable.scrollWidth > scrollable.clientWidth &&
        event.clientY >= bounds.top + scrollable.clientTop + scrollable.clientHeight)
    )
      return;
  }
  const input = target.closest<HTMLInputElement | HTMLTextAreaElement>(
    'input:not([type=checkbox]):not([type=radio]), textarea',
  );
  if (input && input.selectionStart !== null) {
    showContext(event, inputContext(input));
    return;
  }
  if (
    target.closest(
      '.titlebar, .mode-switch, .json-pane-toolbar, footer, .cm-gutters, .cm-search, .modal-backdrop, button.close-tab, button.add-tab',
    )
  )
    return;
  const tab = target.closest<HTMLElement>('.tab');
  if (tab) {
    const index = [...tab.parentElement!.querySelectorAll('.tab')].indexOf(tab);
    const note = notes.value[index];
    if (!note) return;
    const closeItems = (
      [
        ['关闭', 'current'],
        ['关闭左侧标签', 'left'],
        ['关闭右侧标签', 'right'],
        ['关闭其他标签', 'others'],
        ['关闭全部标签', 'all'],
      ] as const
    ).map(([label, scope]) => {
      const ids = tabCloseTargets(
        notes.value.map((n) => n.id),
        note.id,
        scope,
      );
      return { label, disabled: !ids.length, action: () => startCloseQueue(ids) };
    });
    const name = note.name;
    const path = note.path;
    showContext(event, [
      {
        label: '保存',
        action: async () => {
          await saveNote(note);
        },
      },
      {
        label: '另存为',
        action: async () => {
          await saveNote(note, true);
        },
      },
      { label: '复制文件名', separator: true, action: () => copyText(name) },
      { label: '复制完整路径', disabled: !path, action: () => copyText(path ?? '') },
      ...closeItems.map((item, index) => ({ ...item, separator: index === 0 })),
    ]);
    return;
  }
  if (target.closest('.tabs')) {
    showContext(event, [{ label: '打开文件', action: openFile }]);
    return;
  }
  const outlineRow = target.closest('.outline-row');
  if (outlineRow) {
    const title = outlineRow.querySelector('.outline-link')?.textContent ?? '';
    showContext(event, [{ label: '复制标题', action: () => copyText(title) }]);
    return;
  }
  if (target.closest('.sidebar')) {
    const note = active.value;
    if (!note) return;
    const all = visibleOutline(headings.value, new Set())
      .filter((heading) => heading.children.length)
      .map((heading) => heading.key);
    const set = (keys: string[]) => {
      collapsedHeadings.value = { ...collapsedHeadings.value, [note.id]: keys };
      scheduleRecovery();
    };
    showContext(event, [
      { label: '全部展开', disabled: !all.length, action: () => set([]) },
      { label: '全部折叠', disabled: !all.length, action: () => set(all) },
    ]);
    return;
  }
  const note = active.value;
  if (!note) return;
  const liveBlock = target.closest<HTMLElement>('.live-rendered');
  if (liveBlock) {
    const block = lineRange(note, Number(liveBlock.dataset.blockStart), Number(liveBlock.dataset.blockEnd));
    const plain = (liveBlock.innerText ?? liveBlock.textContent ?? '').replace(/\n+$/, '');
    showContext(event, [
      { label: '编辑块', action: () => locateSource(note, block.from) },
      { label: '复制块原文', action: () => copyText(block.text) },
      { label: '复制块纯文本', action: () => copyText(plain) },
    ]);
    return;
  }
  const csv = target.closest('.csv-preview');
  if (csv) {
    const cell = target.closest<HTMLTableCellElement>('td, th');
    if (!cell) {
      showContext(event, [
        {
          label: 'CSV 设置',
          action: () => {
            settings.value = 'csv';
          },
        },
      ]);
      return;
    }
    const rowIndex = [...csv.querySelectorAll('tr')].indexOf(cell.parentElement as HTMLTableRowElement);
    const column = cell.cellIndex;
    const rows = csvRows.value.map((row) => [...row]);
    const source = lineRange(note, csvRowLines.value[rowIndex].start, csvRowLines.value[rowIndex].end);
    showContext(event, [
      { label: '复制单元格', action: () => copyText(rows[rowIndex]?.[column] ?? '') },
      { label: '复制整行', action: () => copyText(spreadsheetText([rows[rowIndex]])) },
      { label: '复制整列', action: () => copyText(spreadsheetText(rows.map((row) => [row[column] ?? '']))) },
      { label: '定位到源码', action: () => locateSource(note, source.from) },
    ]);
    return;
  }
  const jsonPreview = target.closest('.json-preview');
  if (jsonPreview) {
    if (jsonPreviewMode.value && jsonValid.value) {
      const selected = selectedText(jsonPreview);
      const text = jsonPreviewText.value;
      showContext(event, [
        { label: '复制选中文字', disabled: !selected, action: () => copyText(selected) },
        { label: '复制预览全文', action: () => copyText(text) },
      ]);
      return;
    }
    const rowElement = target.closest<HTMLElement>('.json-preview-row');
    const row = rowElement
      ? jsonRows.value[[...jsonPreview.querySelectorAll('.json-preview-row')].indexOf(rowElement)]
      : undefined;
    const selected = selectedText(jsonPreview);
    const text = note.state.doc.toString();
    showContext(event, [
      { label: '复制选中文字', disabled: !selected, action: () => copyText(selected) },
      {
        label: '复制属性名',
        disabled: row?.propertyName === undefined,
        action: () => copyText(row?.propertyName ?? ''),
      },
      {
        label: '复制值',
        disabled: row?.valueFrom === undefined,
        action: () => copyText(text.slice(row!.valueFrom, row!.valueTo)),
      },
      {
        label: '复制节点原文',
        disabled: !row,
        action: () => copyText(text.slice(row!.nodeFrom ?? row!.from, row!.nodeTo ?? row!.to)),
      },
      { label: '定位到源码', disabled: !row, action: () => locateSource(note, row!.from) },
    ]);
    return;
  }
  const markdownPreview = target.closest<HTMLElement>('article.preview');
  if (markdownPreview) {
    const mapped = target.closest<HTMLElement>('[data-source-start]');
    const block = mapped
      ? lineRange(
          note,
          Number(mapped.dataset.sourceStart),
          Number(mapped.dataset.sourceEnd ?? mapped.dataset.sourceStart),
        )
      : undefined;
    const selected = selectedText(markdownPreview);
    showContext(event, [
      { label: '复制选中文字', disabled: !selected, action: () => copyText(selected) },
      { label: '复制所在块原文', disabled: !block, action: () => copyText(block!.text) },
      { label: '定位到源码', disabled: !block, action: () => locateSource(note, block!.from) },
    ]);
    return;
  }
  if (target.closest('.cm-content, .cm-line, .cm-scroller, .editor-host')) {
    if (event.clientX || event.clientY) {
      const pos = view?.posAtCoords({ x: event.clientX, y: event.clientY });
      const selection = note.state.selection.main;
      if (pos != null && (selection.empty || pos < selection.from || pos > selection.to))
        view?.dispatch({ selection: { anchor: pos } });
    }
    const selection = note.state.selection.main;
    const version = note.version;
    const clipboard = (action: 'copy' | 'cut' | 'paste') => {
      if (active.value === note && note.version === version) return editorClipboard(action, note, selection);
    };
    showContext(event, [
      { label: '剪切', disabled: selection.empty, action: () => clipboard('cut') },
      { label: '复制', disabled: selection.empty, action: () => clipboard('copy') },
      { label: '粘贴', action: () => clipboard('paste') },
      { label: '纯文本粘贴', action: () => clipboard('paste') },
      {
        label: '查找与替换',
        separator: true,
        action: () => {
          if (active.value === note) searchPanel();
        },
      },
    ]);
  }
}
const native = isTauri();
const maximized = ref(false);
let unlistenResize: (() => void) | undefined;
async function syncMaximized() {
  if (native) maximized.value = await getCurrentWindow().isMaximized();
}
async function toggleMaximized() {
  await getCurrentWindow().toggleMaximize();
  await syncMaximized();
}
function touch() {
  notes.value = [...notes.value];
}
function captureScroll() {
  const note = active.value;
  if (!note || !view) return;
  note.scrollTop = view.scrollDOM.scrollTop;
  note.scrollLeft = view.scrollDOM.scrollLeft;
  note.previewScrollTop = previewHost.value?.scrollTop ?? note.previewScrollTop;
}
function onSourceScroll() {
  if (restoringScroll) return;
  captureScroll();
  scheduleRecovery();
  if (mode.value === 'split') previewSync.sourceToPreview();
}
function onPreviewScroll() {
  if (restoringScroll) return;
  captureScroll();
  scheduleRecovery();
  previewSync.previewToSource();
}
function onPreviewClick(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-source-start]') : null;
  if (!target || !view) return;
  const line = Math.min(view.state.doc.lines, Number(target.dataset.sourceStart));
  const anchor =
    target.dataset.sourceFrom === undefined ? view.state.doc.line(line).from : Number(target.dataset.sourceFrom);
  if (isCsv.value && mode.value === 'live') changeMode('source');
  view.dispatch({ selection: { anchor }, scrollIntoView: true });
  void nextTick(() => {
    view?.requestMeasure();
    view?.focus();
  });
}
function stateFor(text: string, format: NoteFormat, editor?: SessionNote['editor']) {
  const config = {
    doc: text,
    extensions: [
      EditorState.phrases.of(editorPhrases),
      history(),
      drawSelection(),
      EditorView.lineWrapping,
      lineNumbers(),
      highlightActiveLine(),
      bracketMatching(),
      closeBrackets(),
      search({ top: true }),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      theme.of(editorAppearance(dark.value)),
      language.of(languageFor(format, text.length)),
      live.of(
        mode.value === 'live' && format === 'markdown' && text.length <= LARGE_DOCUMENT_LIMIT
          ? liveMarkdownBlocks(dark.value)
          : [],
      ),
      EditorView.updateListener.of((u) => {
        const note = active.value;
        if (!note) return;
        note.state = u.state;
        if (u.docChanged) {
          note.version++;
          note.dirty = true;
          touch();
          clearTimeout(refreshTimer);
          refreshTimer = setTimeout(refreshDerived, 280);
          scheduleRecovery();
        }
        if (u.selectionSet || u.docChanged) {
          const p = u.state.selection.main.head;
          const line = u.state.doc.lineAt(p);
          position.value = `行 ${line.number}，列 ${p - line.from + 1}`;
          count.value = u.state.doc.length;
          previewSync.highlight();
        }
        if (u.selectionSet) scheduleRecovery();
        if (!searchPanelOpen(u.state)) resetSearchPanelPosition(u.view);
      }),
      editability.of([]),
    ],
  };
  return editor ? restoreEditor(editor, config) : EditorState.create(config);
}
function createNote(doc?: NativeDocument, name = nextUntitledName(notes.value.map((note) => note.name))) {
  const text = doc?.text ?? '';
  const noteName = doc?.path?.split(/[\\/]/).pop() ?? name;
  const format = formatForName(noteName);
  const { text: _text, ...metadata } = doc ?? { text: '' };
  const note: Note = {
    path: null,
    encoding: 'UTF-8',
    bom: false,
    lineEnding: 'LF',
    revision: null,
    ...metadata,
    id: nextId++,
    name: noteName,
    format,
    mode: defaultMode(format),
    markdownWidth: 'standard',
    state: stateFor(text, format),
    saved: text,
    version: 0,
    dirty: false,
    metaDirty: false,
    requiresSaveAs: false,
    csvOptions: defaultCsvOptions(),
    csvColumnWidths: [],
    scrollTop: 0,
    scrollLeft: 0,
    previewScrollTop: 0,
  };
  notes.value = [...notes.value, note];
  selectNote(note);
  return note;
}
function selectNote(note: Note) {
  stopCsvResize();
  if (view && active.value && active.value !== note) {
    active.value.state = view.state;
    captureScroll();
  }
  activeId.value = note.id;
  mode.value = note.mode;
  if (view) restoringScroll = true;
  const { scrollTop, scrollLeft, previewScrollTop } = note;
  view?.setState(note.state);
  previewSync.reset();
  reconfigure();
  refreshDerived();
  observeGutter();
  const head = note.state.selection.main.head;
  const line = note.state.doc.lineAt(head);
  position.value = `行 ${line.number}，列 ${head - line.from + 1}`;
  void nextTick(() => {
    if (active.value !== note || !view) return;
    view.requestMeasure({
      read: () => null,
      write: () => {
        if (active.value !== note || !view) return;
        view.scrollDOM.scrollTop = scrollTop;
        view.scrollDOM.scrollLeft = scrollLeft;
        if (previewHost.value) previewHost.value.scrollTop = previewScrollTop;
        restoringScroll = false;
      },
    });
    if (!(isCsv.value && mode.value === 'live' && !large.value)) view.focus();
  });
  scheduleRecovery();
}
function reconfigure() {
  if (!view || !active.value) return;
  view.dispatch({
    effects: [
      theme.reconfigure(editorAppearance(dark.value)),
      language.reconfigure(languageFor(active.value.format, view.state.doc.length)),
      live.reconfigure(mode.value === 'live' && !large.value && isMarkdown.value ? liveMarkdownBlocks(dark.value) : []),
    ],
  });
}
function changeMode(value: DisplayMode) {
  stopCsvResize();
  mode.value = value;
  if (active.value) active.value.mode = value;
  previewSync.reset();
  reconfigure();
  refreshDerived();
  scheduleRecovery();
  void nextTick(() => view?.requestMeasure());
}
function setTheme(night: boolean) {
  dark.value = night;
  localStorage.setItem('znote-theme', night ? 'dark' : 'light');
  reconfigure();
  refreshDerived();
}
function refreshDerived() {
  if (!active.value) return;
  const doc = active.value.state.doc;
  count.value = doc.length;
  previewSync.invalidate();
  if (doc.length > LARGE_DOCUMENT_LIMIT) {
    headings.value = [];
    preview.value = '';
    csvRows.value = [];
    csvRowLines.value = [];
    jsonRows.value = [];
    jsonValid.value = false;
    jsonPreviewText.value = '';
    csvError.value = null;
    reconfigure();
    return;
  }
  const text = doc.toString();
  active.value.dirty = active.value.metaDirty || text !== active.value.saved;
  touch();
  headings.value = isMarkdown.value
    ? buildOutline(
        markdownHeadings(text).map((item) => ({
          title: item.title,
          level: item.level,
          from: doc.line(item.line).from,
        })),
      )
    : [];
  if (mode.value === 'split' || (mode.value === 'live' && isCsv.value)) {
    if (isCsv.value) {
      const parsed = parseCsv(text, active.value.csvOptions);
      csvRows.value = parsed.rows;
      csvRowLines.value = parsed.rowLines;
      csvError.value = parsed.error;
    } else if (isMarkdown.value) preview.value = renderMarkdown(text);
    else if (isJson.value) {
      const strict = !/\.jsonc$/i.test(active.value.name);
      const result = buildJsonPreview(text, strict);
      jsonRows.value = result.rows;
      jsonValid.value = result.valid;
      jsonPreviewText.value = result.valid && jsonPreviewMode.value
        ? jsonPreviewMode.value === 'compact' ? compactJsonc(text, strict) : formatJsonc(text, strict)
        : '';
    }
    void nextTick(() => {
      if (isMarkdown.value && previewHost.value) hydrateDiagrams(previewHost.value, dark.value);
      previewSync.highlight();
      onSourceScroll();
    });
  }
}
function newNote() {
  createNote();
  changeMode('source');
  status.value = '新建笔记';
}
async function openFile() {
  if (!native) {
    status.value = '浏览器预览模式：本地打开与保存请使用桌面版';
    return;
  }
  busy.value = true;
  try {
    const doc = await invoke<NativeDocument | null>('native_open');
    if (doc) {
      const existing = notes.value.find((n) => n.path?.toLowerCase() === doc.path?.toLowerCase());
      if (existing) {
        existing.requiresSaveAs = false;
        selectNote(existing);
      } else createNote(doc);
      status.value = '文件已打开';
    }
  } catch (e) {
    status.value = String(e);
  } finally {
    busy.value = false;
  }
}
async function openAssociatedFiles() {
  if (closingWindow.value) return;
  if (openingAssociated) {
    pendingAssociated = true;
    return;
  }
  openingAssociated = true;
  try {
    do {
      pendingAssociated = false;
      const result = await invoke<{ documents: NativeDocument[]; errors: string[] }>('native_take_open_requests');
      for (const doc of result.documents) {
        const path = doc.path;
        if (!path) continue;
        const existing = notes.value.find((note) => note.path?.toLowerCase() === path.toLowerCase());
        if (existing) selectNote(existing);
        else {
          const note = createNote(doc);
          note.requiresSaveAs = true;
        }
      }
      if (result.errors.length) status.value = `打开文件失败：${result.errors.join('；')}`;
      else if (result.documents.length) status.value = '文件已打开；首次保存需确认位置';
    } while (pendingAssociated);
  } catch (error) {
    status.value = `关联文件打开失败：${error}`;
  } finally {
    openingAssociated = false;
  }
}
async function saveNote(note = active.value, saveAs = false): Promise<boolean> {
  if (!note) return true;
  if (!native) {
    status.value = '浏览器预览模式无法保存本地文件，请使用桌面版';
    return false;
  }
  if (note.lineEnding === 'Mixed') {
    status.value = '混合换行：请先在设置中选择 LF、CRLF 或 CR，再保存';
    return false;
  }
  busy.value = true;
  const text = note.state.doc.toString();
  const savingVersion = note.version;
  try {
    const doc = await invoke<NativeDocument | null>('native_save', {
      path: note.path,
      name: note.name,
      text,
      encoding: note.encoding,
      bom: note.bom,
      lineEnding: note.lineEnding,
      revision: note.revision,
      saveAs: saveAs || note.requiresSaveAs,
    });
    if (!doc) return false;
    const changedDuringSave = note.version !== savingVersion;
    Object.assign(note, {
      path: doc.path,
      encoding: changedDuringSave ? note.encoding : doc.encoding,
      bom: changedDuringSave ? note.bom : doc.bom,
      lineEnding: changedDuringSave ? note.lineEnding : doc.lineEnding,
      revision: doc.revision,
      saved: text,
      name: doc.path?.split(/[\\/]/).pop() ?? note.name,
      metaDirty: changedDuringSave && note.metaDirty,
      dirty: (changedDuringSave && note.metaDirty) || note.state.doc.toString() !== text,
      requiresSaveAs: false,
    });
    touch();
    reconfigure();
    status.value = '已保存到本机';
    scheduleRecovery();
    if (note.dirty) {
      status.value = '保存期间有新修改，请再次保存';
      return false;
    }
    return true;
  } catch (e) {
    status.value = String(e);
    return false;
  } finally {
    busy.value = false;
  }
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
  } catch (error) {
    status.value = `导出失败：${error}`;
  } finally {
    busy.value = false;
  }
}
function startCloseQueue(ids: number[]) {
  closeQueue = [...ids];
  advanceCloseQueue();
}
function advanceCloseQueue() {
  while (closeQueue.length) {
    const id = closeQueue.shift();
    const note = notes.value.find((n) => n.id === id);
    if (!note) continue;
    if (needsSave(note.path, note.dirty)) {
      closePrompt.value = { note };
      return;
    }
    removeNote(note);
  }
}
function requestClose(note: Note) {
  if (busy.value || closingWindow.value || closePrompt.value) return;
  startCloseQueue([note.id]);
}
function removeNote(note: Note) {
  notes.value = notes.value.filter((n) => n.id !== note.id);
  const { [note.id]: _removed, ...remaining } = collapsedHeadings.value;
  collapsedHeadings.value = remaining;
  const { [note.id]: _previewMode, ...previewModes } = jsonPreviewModes.value;
  jsonPreviewModes.value = previewModes;
  if (!notes.value.length) createNote();
  else if (activeId.value === note.id) selectNote(notes.value[0]);
  scheduleRecovery();
}
async function resolveClose(action: 'save' | 'discard' | 'cancel') {
  const prompt = closePrompt.value;
  if (!prompt || busy.value) return;
  if (action === 'cancel') {
    closeQueue = [];
    closePrompt.value = null;
    return;
  }
  if (action === 'save' && !(await saveNote(prompt.note))) return;
  if (action === 'discard' && native) {
    busy.value = true;
    const persisted = await persistRecovery(prompt.note.id);
    busy.value = false;
    if (!persisted) return;
  }
  closePrompt.value = null;
  removeNote(prompt.note);
  advanceCloseQueue();
}
function formatJson() {
  const note = active.value;
  if (!note || busy.value || note.format !== 'json') return;
  if (note.state.doc.length > LARGE_DOCUMENT_LIMIT) {
    status.value = '大文件模式下暂不格式化';
    return;
  }
  const id = ++formatId;
  pendingFormat = { id, note, version: note.version, format: note.format, from: 0, to: note.state.doc.length, operation: 'format' };
  status.value = '正在格式化…';
  worker.postMessage({ id, kind: 'json', text: note.state.doc.toString(), strict: !/\.jsonc$/i.test(note.name) });
}
function transformJson(operation: 'escape' | 'unescape') {
  const note = active.value;
  if (!note || busy.value || note.format !== 'json' || mode.value !== 'split' || large.value) return;
  const id = ++formatId;
  pendingFormat = { id, note, version: note.version, format: note.format, from: 0, to: note.state.doc.length, operation };
  status.value = operation === 'escape' ? '正在转义…' : '正在去除转义…';
  worker.postMessage({ id, kind: operation, text: note.state.doc.toString(), strict: !/\.jsonc$/i.test(note.name) });
}
function setJsonPreviewMode(value: 'compact' | 'expanded') {
  const note = active.value;
  if (!note || !jsonValid.value || note.format !== 'json') return;
  jsonPreviewModes.value = { ...jsonPreviewModes.value, [note.id]: jsonPreviewMode.value === value ? undefined : value };
  refreshDerived();
}
function updateCsvOptions(changes: Partial<CsvOptions>) {
  const note = active.value;
  if (!note || note.format !== 'csv') return;
  note.csvOptions = { ...note.csvOptions, ...changes };
  touch();
  refreshDerived();
  scheduleRecovery();
}
function setMarkdownWidth(width: MarkdownWidth) {
  const note = active.value;
  if (!note || note.format !== 'markdown') return;
  note.markdownWidth = width;
  touch();
  scheduleRecovery();
  void nextTick(() => view?.requestMeasure());
}
function displayAs(format: Exclude<NoteFormat, 'txt'>) {
  const note = active.value;
  menu.value = null;
  if (!note || displayMenuState(note.path) !== 'enabled') return;
  note.format = format;
  note.version++;
  changeMode(defaultMode(format));
  touch();
  reconfigure();
  refreshDerived();
  status.value = `显示为 ${format === 'markdown' ? 'Markdown' : format.toUpperCase()}`;
}
function changeFormat(format: Exclude<NoteFormat, 'txt'>) {
  const note = active.value;
  menu.value = null;
  if (!note) return;
  if (conversionMenuState(note.path) !== 'enabled') return;
  if (formatForName(note.name) === format && note.path === null) return;
  const wasLocalTxt = note.path !== null;
  note.format = format;
  note.name = note.name.replace(/\.[^.]+$/, '') + { markdown: '.md', json: '.json', csv: '.csv' }[format];
  if (wasLocalTxt) {
    note.path = null;
    note.revision = null;
    note.requiresSaveAs = false;
  }
  note.version++;
  note.metaDirty = true;
  note.dirty = true;
  changeMode(defaultMode(format));
  touch();
  reconfigure();
  refreshDerived();
  scheduleRecovery();
  status.value = `已切换为 ${format === 'markdown' ? 'Markdown' : format.toUpperCase()}`;
  if (format === 'json' && note.state.doc.length && !/\.jsonc$/i.test(note.name)) formatJson();
}
function toggleMenu(value: typeof menu.value) {
  menu.value = menu.value === value ? null : value;
}
function searchPanel(replace = false) {
  menu.value = null;
  if (!view) return;
  if (isCsv.value && mode.value === 'live') changeMode('source');
  openSearchPanel(view);
  decorateSearchPanel(view);
  void nextTick(() => {
    view?.requestMeasure();
    (
      view?.dom.querySelector(
        replace ? '.cm-search input[name="replace"]' : '.cm-search input[name="search"]',
      ) as HTMLInputElement | null
    )?.focus();
  });
}
async function clipboardAction(action: 'copy' | 'cut' | 'paste') {
  menu.value = null;
  if (!view || !active.value || busy.value || closingWindow.value) return;
  await editorClipboard(action, active.value);
}
async function checkUpdates() {
  menu.value = null;
  if (checkingUpdate.value) return;
  if (!native) {
    status.value = '请在安装版中检查更新';
    return;
  }
  checkingUpdate.value = true;
  status.value = '正在检查更新…';
  try {
    const update = await check({ timeout: 30000 });
    if (!update) {
      status.value = `当前已是最新版本 (${appVersion.value})`;
      return;
    }
    busy.value = true;
    if (!(await persistRecovery())) return;
    status.value = `正在下载版本 ${update.version}…`;
    await update.downloadAndInstall((event) => {
      if (event.event === 'Started') status.value = `正在下载版本 ${update.version}…`;
      if (event.event === 'Finished') status.value = '更新已安装，正在重启…';
    });
    await relaunch();
  } catch (error) {
    status.value = `检查更新失败：${error}`;
  } finally {
    busy.value = false;
    checkingUpdate.value = false;
  }
}
function closeWindow() {
  if (native) void getCurrentWindow().close();
}
async function persistRecovery(excludeId?: number): Promise<boolean> {
  if (!native) return true;
  if (!sessionReady || recoveryLoadFailed) {
    status.value = '原会话读取失败，未覆盖恢复文件；请先保存文档';
    return false;
  }
  clearTimeout(recoveryTimer);
  captureScroll();
  const remaining = notes.value.filter((n) => n.id !== excludeId);
  const data: Session = {
    version: 1,
    activeIndex: Math.max(
      0,
      remaining.findIndex((n) => n.id === activeId.value),
    ),
    outlineCollapsed: outlineCollapsed.value,
    notes: remaining.map((n) => ({
      path: n.path,
      encoding: n.encoding,
      bom: n.bom,
      lineEnding: n.lineEnding,
      revision: n.revision,
      name: n.name,
      format: n.format,
      mode: n.mode,
      markdownWidth: n.markdownWidth,
      editor: serializeEditor(n.state),
      saved: n.saved === n.state.doc.toString() ? null : n.saved,
      dirty: n.dirty,
      metaDirty: n.metaDirty,
      requiresSaveAs: n.requiresSaveAs,
      csvOptions: { ...n.csvOptions },
      csvColumnWidths: [...n.csvColumnWidths],
      scrollTop: n.scrollTop,
      scrollLeft: n.scrollLeft,
      previewScrollTop: n.previewScrollTop,
      collapsedHeadings: collapsedHeadings.value[n.id] ?? [],
    })),
  };
  if (new TextEncoder().encode(JSON.stringify(data)).length > 256 * 1024 * 1024) {
    status.value = '会话超过 256 MiB，无法安全退出；请保存并关闭部分标签';
    return false;
  }
  let succeeded = true;
  recoveryWrite = recoveryWrite
    .then(() => invoke('recovery_save', { data }))
    .catch((e) => {
      succeeded = false;
      status.value = `会话保存失败：${e}`;
    });
  await recoveryWrite;
  return succeeded;
}
function scheduleRecovery() {
  if (!native || !sessionReady || closingWindow.value) return;
  clearTimeout(recoveryTimer);
  recoveryTimer = setTimeout(() => {
    void persistRecovery();
  }, 1500);
}
watch(outlineCollapsed, scheduleRecovery);

async function persistAndClose() {
  if (closingWindow.value) return;
  if (busy.value || openingAssociated) {
    status.value = '请等待当前文件操作完成后再退出';
    return;
  }
  closingWindow.value = true;
  view?.dispatch({ effects: editability.reconfigure([EditorView.editable.of(false), EditorState.readOnly.of(true)]) });
  try {
    if (await persistRecovery()) await getCurrentWindow().destroy();
  } catch (error) {
    status.value = `退出失败：${error}`;
  } finally {
    closingWindow.value = false;
    view?.dispatch({ effects: editability.reconfigure([]) });
  }
}

function shortcuts(event: KeyboardEvent) {
  if (closingWindow.value) {
    event.preventDefault();
    return;
  }
  if (closePrompt.value) {
    if (event.key === 'Escape') {
      event.preventDefault();
      void resolveClose('cancel');
    }
    if (event.ctrlKey || event.metaKey) event.preventDefault();
    return;
  }
  if (event.key === 'Escape') {
    menu.value = null;
    settings.value = null;
  }
  if (settings.value || !(event.ctrlKey || event.metaKey)) return;
  const key = event.key.toLowerCase();
  if (key === 'f' || key === 'h') {
    event.preventDefault();
    searchPanel(key === 'h');
    return;
  }
  if (!['n', 'o', 's', 'w'].includes(key)) return;
  event.preventDefault();
  if (busy.value) return;
  if (key === 'n') newNote();
  if (key === 'o') void openFile();
  if (key === 's') void saveNote(active.value, event.shiftKey);
  if (key === 'w' && active.value) requestClose(active.value);
}
function setEncoding(value: string) {
  if (active.value) {
    active.value.encoding = value;
    active.value.bom = value.startsWith('UTF-16');
    active.value.dirty = true;
    active.value.metaDirty = true;
    active.value.version++;
    touch();
    scheduleRecovery();
    status.value = `保存时使用 ${value}`;
  }
}
function setLineEnding(value: string) {
  if (active.value) {
    active.value.lineEnding = value;
    active.value.dirty = true;
    active.value.metaDirty = true;
    active.value.version++;
    touch();
    scheduleRecovery();
    status.value = `保存时统一换行为 ${value}`;
  }
}
onMounted(async () => {
  dark.value = localStorage.getItem('znote-theme') === 'dark';
  if (native) {
    appVersion.value = await getVersion();
    await syncMaximized();
    unlistenResize = await getCurrentWindow().onResized(() => {
      void syncMaximized();
    });
    try {
      const session = parseSession(await invoke('recovery_load'));
      if (session) {
        const restored = session.notes.map((doc) => ({
          ...doc,
          id: nextId++,
          state: stateFor(doc.editor.doc, doc.format, doc.editor),
          saved: doc.saved ?? doc.editor.doc,
          version: 0,
        }));
        const names = restored.map((note) => note.name);
        const seen = new Set<string>();
        for (const note of restored) {
          if (
            note.path === null &&
            /^未命名\d*\./.test(note.name) &&
            (/^未命名\./.test(note.name) || seen.has(note.name))
          ) {
            const extension = note.name.slice(note.name.lastIndexOf('.'));
            note.name = nextUntitledName(names).replace(/\.txt$/, extension);
            names.push(note.name);
          }
          seen.add(note.name);
        }
        notes.value = restored;
        for (const note of restored) collapsedHeadings.value[note.id] = note.collapsedHeadings;
        outlineCollapsed.value = session.outlineCollapsed;
        const selected = restored[session.activeIndex] ?? restored[0];
        if (selected) {
          activeId.value = selected.id;
          mode.value = selected.mode;
          status.value = `已恢复 ${restored.length} 个标签`;
        }
      }
    } catch (error) {
      recoveryLoadFailed = true;
      status.value = `会话读取失败，已保留原恢复文件：${error}`;
    }
  }
  if (!notes.value.length) createNote();
  view = new EditorView({ state: active.value!.state, parent: host.value });
  view.scrollDOM.addEventListener('scroll', onSourceScroll);
  refreshDerived();
  if (document.fonts?.load)
    void Promise.allSettled([
      document.fonts.load('16px "zNote Sans SC"'),
      document.fonts.load('14px "zNote Mono SC"'),
    ]).then(() => view?.requestMeasure());
  selectNote(active.value!);
  worker = new Worker(new URL('./format.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }: MessageEvent<{ id: number; text?: string; error?: string }>) => {
    const pending = pendingFormat;
    if (closingWindow.value || !pending || data.id !== pending.id) return;
    pendingFormat = undefined;
    if (
      pending.note.version !== pending.version ||
      pending.note.format !== pending.format ||
      !notes.value.includes(pending.note)
    ) {
      status.value = '内容已变化，已忽略过期文本转换结果';
      return;
    }
    if (data.error) {
      status.value = data.error;
      return;
    }
    if (data.text === pending.note.state.doc.toString()) {
      status.value = '内容无需修改';
      return;
    }
    const changes = { from: pending.from, to: pending.to, insert: data.text! };
    if (pending.note === active.value) view?.dispatch({ changes, userEvent: 'input.format', annotations: isolateHistory.of('full') });
    else {
      pending.note.state = pending.note.state.update({ changes, userEvent: 'input.format', annotations: isolateHistory.of('full') }).state;
      pending.note.version++;
      pending.note.dirty = true;
      touch();
      scheduleRecovery();
    }
    status.value = `${{ format: '已格式化', escape: '已转义', unescape: '已去除转义' }[pending.operation]} · Ctrl + Z 可撤销`;
  };
  window.addEventListener('keydown', shortcuts);
  sessionReady = true;
  if (native) {
    unlisten = await getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      await persistAndClose();
    });
    unlistenAssociated = await listen('associated-file-open', () => {
      void openAssociatedFiles();
    });
    await openAssociatedFiles();
    scheduleRecovery();
  }
});
onBeforeUnmount(() => {
  stopCsvResize();
  gutterObserver?.disconnect();
  view?.scrollDOM.removeEventListener('scroll', onSourceScroll);
  view?.destroy();
  worker?.terminate();
  unlisten?.();
  unlistenAssociated?.();
  unlistenResize?.();
  clearTimeout(refreshTimer);
  clearTimeout(recoveryTimer);
  clearTimeout(toastTimer);
  window.removeEventListener('keydown', shortcuts);
});
</script>

<template>
  <div
    class="app"
    :class="{ dark }"
    :inert="closingWindow"
    @contextmenu.capture="onContextMenu"
    @mousedown.capture="onContextPointer"
    @pointerdown="menu && !($event.target as HTMLElement).closest('.app-menu') && (menu = null)"
  >
    <div class="titlebar" data-tauri-drag-region>
      <img class="titlebar-icon" src="/znote.svg" alt="" width="20" height="20" data-tauri-drag-region />
      <nav class="app-menu" aria-label="主菜单">
        <div class="menu-group">
          <button :aria-expanded="menu === 'file'" @click="toggleMenu('file')">文件</button>
          <div v-if="menu === 'file'" class="menu-popup">
            <button
              @click="
                menu = null;
                newNote();
              "
            >
              <FilePlus2 :size="15" />新建 <kbd>Ctrl+N</kbd></button
            ><button
              :disabled="busy"
              @click="
                menu = null;
                openFile();
              "
            >
              <FolderOpen :size="15" />打开 <kbd>Ctrl+O</kbd></button
            ><button
              :disabled="busy"
              @click="
                menu = null;
                saveNote();
              "
            >
              <Save :size="15" />保存 <kbd>Ctrl+S</kbd></button
            ><button
              :disabled="busy"
              @click="
                menu = null;
                saveNote(active, true);
              "
            >
              <Save :size="15" />另存为 <kbd>Ctrl+Shift+S</kbd>
            </button>
            <hr />
            <details class="export-submenu">
              <summary><Download :size="15" />导出 <ChevronRight :size="14" class="export-chevron" /></summary>
              <button :disabled="!canExport" class="menu-subitem" @click="exportFormat('docx')">Word (.docx)</button
              ><button :disabled="!canExport" class="menu-subitem" @click="exportFormat('pdf')">PDF (.pdf)</button>
            </details>
          </div>
        </div>
        <div class="menu-group">
          <button :aria-expanded="menu === 'edit'" @click="toggleMenu('edit')">编辑</button>
          <div v-if="menu === 'edit'" class="menu-popup">
            <button @click="clipboardAction('copy')"><Copy :size="15" />复制 <kbd>Ctrl+C</kbd></button
            ><button @click="clipboardAction('cut')"><Scissors :size="15" />剪切 <kbd>Ctrl+X</kbd></button
            ><button @click="clipboardAction('paste')"><ClipboardPaste :size="15" />粘贴 <kbd>Ctrl+V</kbd></button
            ><button @click="clipboardAction('paste')"><ClipboardPaste :size="15" />粘贴为纯文本</button>
            <hr />
            <button @click="searchPanel()"><Search :size="15" />查找与替换 <kbd>Ctrl+F</kbd></button>
          </div>
        </div>
        <div class="menu-group">
          <button :aria-expanded="menu === 'format'" @click="toggleMenu('format')">格式</button>
          <div v-if="menu === 'format'" class="menu-popup">
            <button :disabled="displayMenu !== 'enabled' || busy" @click="displayAs('markdown')">显示为 Markdown</button
            ><button :disabled="displayMenu !== 'enabled' || busy" @click="displayAs('csv')">显示为 CSV</button
            ><button :disabled="displayMenu !== 'enabled' || busy" @click="displayAs('json')">显示为 JSON</button>
            <hr />
            <template v-if="conversionMenu !== 'hidden'"
              ><button :disabled="conversionMenu !== 'enabled' || busy" @click="changeFormat('markdown')">
                转为 Markdown</button
              ><button :disabled="conversionMenu !== 'enabled' || busy" @click="changeFormat('csv')">转为 CSV</button
              ><button :disabled="conversionMenu !== 'enabled' || busy" @click="changeFormat('json')">转为 JSON</button>
              <hr /></template
            ><button
              :disabled="!isMarkdown || busy || large"
              @click="
                menu = null;
                settings = 'markdown';
              "
            >
              <Settings :size="15" />Markdown 设置</button
            ><button
              :disabled="!isCsv || busy || large"
              @click="
                menu = null;
                settings = 'csv';
              "
            >
              <Settings :size="15" />CSV设置
            </button>
          </div>
        </div>
        <div class="menu-group">
          <button :aria-expanded="menu === 'help'" @click="toggleMenu('help')">帮助</button>
          <div v-if="menu === 'help'" class="menu-popup">
            <button
              @click="
                menu = null;
                settings = 'general';
              "
            >
              <Settings :size="15" />设置</button
            ><button :disabled="checkingUpdate" @click="checkUpdates"
              ><RefreshCw :size="15" />检查更新<span class="menu-version">v{{ appVersion }}</span></button
            >
          </div>
        </div>
      </nav>
      <div class="titlebar-drag" data-tauri-drag-region></div>
      <div v-if="native" class="window-controls">
        <button title="最小化" aria-label="最小化" @click="getCurrentWindow().minimize()"><Minus :size="16" /></button
        ><button
          :title="maximized ? '还原' : '最大化'"
          :aria-label="maximized ? '还原' : '最大化'"
          @click="toggleMaximized"
        >
          <Copy v-if="maximized" :size="13" /><Square v-else :size="13" /></button
        ><button class="window-close" title="关闭" aria-label="关闭" @click="closeWindow"><X :size="17" /></button>
      </div>
    </div>
    <div class="app-body">
      <DocumentOutline
        v-if="isMarkdown && !large && !outlineCollapsed"
        :headings="headings"
        :collapsed="collapsedHeadings[activeId] ?? []"
        @toggle="toggleHeading"
        @select="goToHeading"
      />
      <main>
        <DocumentTabs
          :notes="notes"
          :active-id="activeId"
          :mode="mode"
          @select="selectNote"
          @close="requestClose"
          @create="newNote"
          @mode="changeMode"
        />
        <div v-if="large" class="notice">大文件模式 · 已暂停语法分析、大纲和预览；会话上限 256 MiB。</div>
        <div
          class="writing-area"
          :class="[
            {
              split: mode === 'split' && !large && (isMarkdown || isCsv || isJson),
              live: mode === 'live' && isMarkdown,
              reading: (currentFormat === 'txt' && !isStructuredText) || isMarkdown,
              structured: isJson || isCsv || isStructuredText,
            },
            isMarkdown && mode === 'live' ? `markdown-width-${active?.markdownWidth ?? 'standard'}` : '',
          ]"
        >
          <div class="source-pane" v-show="!(mode === 'live' && isCsv && !large)">
            <div v-if="mode === 'split' && !large && isJson" class="json-pane-toolbar" aria-label="JSON 源码操作">
              <button title="将整份源码转为 JSON 字符串" :disabled="busy || !count" @click="transformJson('escape')">转义</button>
              <button title="将完整 JSON 字符串去除一层转义" :disabled="busy || !count" @click="transformJson('unescape')">去除转义</button>
            </div>
            <div ref="host" class="editor-host"></div>
          </div>
          <article
            v-if="mode === 'split' && !large && isMarkdown"
            ref="previewHost"
            class="preview"
            aria-label="Markdown 预览"
            @scroll="onPreviewScroll"
            @click.prevent="onPreviewClick"
            v-html="preview"
          ></article>
          <div v-if="mode === 'split' && !large && isJson" class="json-preview-pane">
            <div class="json-pane-toolbar" aria-label="JSON 预览操作">
              <template v-if="jsonValid">
                <button title="压缩预览；再次点击返回结构视图" :aria-pressed="jsonPreviewMode === 'compact'" @click="setJsonPreviewMode('compact')">压缩</button>
                <button title="展开预览；再次点击返回结构视图" :aria-pressed="jsonPreviewMode === 'expanded'" @click="setJsonPreviewMode('expanded')">展开</button>
              </template>
            </div>
            <section
              ref="previewHost"
              class="preview json-preview"
              :aria-label="jsonPreviewMode && jsonValid ? 'JSON 文本预览' : 'JSON 结构预览'"
              @scroll="onPreviewScroll"
              @click="onPreviewClick"
            >
              <pre v-if="jsonPreviewMode && jsonValid" class="json-preview-text">{{ jsonPreviewText }}</pre>
              <div
                v-for="(row, index) in jsonPreviewMode && jsonValid ? [] : jsonRows"
                :key="index"
                class="json-preview-row"
                :class="`json-${row.kind}`"
                :data-source-start="row.line"
                :data-source-end="row.line"
                :data-source-from="row.from"
                :data-source-to="row.to"
                :style="{ paddingLeft: `${row.depth * 18}px` }"
              >
                <span v-if="row.propertyName !== undefined" class="json-key">{{ row.label || '""' }}: </span
                ><span>{{ row.value }}</span>
              </div>
            </section>
          </div>
          <section
            v-if="mode !== 'source' && !large && isCsv"
            ref="previewHost"
            class="preview csv-preview"
            :style="mode === 'live' ? { borderLeft: 'none' } : undefined"
            aria-label="CSV 表格预览"
            @scroll="onPreviewScroll"
            @click="onPreviewClick"
          >
            <p v-if="csvError" class="csv-error" role="alert">{{ csvError }}</p>
            <div v-if="csvRows.length" class="csv-table-wrap">
              <table :class="{ 'csv-resized': csvWidths.length }" :style="csvWidths.length ? { width: `${csvWidths.reduce((sum, width) => sum + width, 0)}px`, minWidth: '0' } : undefined">
                <colgroup><col v-for="index in csvColumnCount" :key="index" :style="csvWidths[index - 1] ? { width: `${csvWidths[index - 1]}px` } : undefined" /></colgroup>
                <thead v-if="active?.csvOptions.firstRowHeader">
                  <tr :data-source-start="csvRowLines[0]?.start" :data-source-end="csvRowLines[0]?.end">
                    <th v-for="(cell, index) in csvRows[0]" :key="index" scope="col">{{ cell }}<span class="csv-resize-handle" role="separator" aria-orientation="vertical" tabindex="0" :aria-label="`调整第 ${index + 1} 列宽度`" @pointerdown.stop.prevent="startCsvResize($event, index)" @keydown.left.stop.prevent="nudgeCsvColumn(index, -16)" @keydown.right.stop.prevent="nudgeCsvColumn(index, 16)" @click.stop></span></th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(row, rowIndex) in csvRows.slice(active?.csvOptions.firstRowHeader ? 1 : 0)"
                    :key="rowIndex"
                    :data-source-start="csvRowLines[rowIndex + (active?.csvOptions.firstRowHeader ? 1 : 0)]?.start"
                    :data-source-end="csvRowLines[rowIndex + (active?.csvOptions.firstRowHeader ? 1 : 0)]?.end"
                  >
                    <td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}<span v-if="!active?.csvOptions.firstRowHeader && rowIndex === 0" class="csv-resize-handle" role="separator" aria-orientation="vertical" tabindex="0" :aria-label="`调整第 ${cellIndex + 1} 列宽度`" @pointerdown.stop.prevent="startCsvResize($event, cellIndex)" @keydown.left.stop.prevent="nudgeCsvColumn(cellIndex, -16)" @keydown.right.stop.prevent="nudgeCsvColumn(cellIndex, 16)" @click.stop></span></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="csv-empty">表格为空</p>
          </section>
        </div>
        <footer>
          <button
            v-if="isMarkdown && !large"
            class="outline-toggle"
            :style="{ width: `${gutterWidth}px` }"
            :aria-label="outlineCollapsed ? '展开文档大纲' : '收起文档大纲'"
            :title="outlineCollapsed ? '展开文档大纲' : '收起文档大纲'"
            :aria-expanded="!outlineCollapsed"
            @click="outlineCollapsed = !outlineCollapsed"
          >
            <ChevronRight v-if="outlineCollapsed" :size="17" /><ChevronLeft v-else :size="17" /></button
          ><span>{{ position }}</span
          ><span>{{ count.toLocaleString() }} 字符</span
          ><OptionSelect
            label="保存编码"
            compact
            :model-value="active?.encoding"
            :options="encodingOptions"
            @update:model-value="setEncoding"
          />
        </footer>
      </main>
    </div>
    <div v-if="toast" class="status-toast" role="status">{{ toast }}</div>
    <SettingsDialog
      v-if="settings"
      :kind="settings"
      :dark="dark"
      :encoding="active?.encoding"
      :line-ending="active?.lineEnding"
      :markdown-width="active?.markdownWidth"
      :csv-options="active?.csvOptions"
      @close="settings = null"
      @restore-focus="view?.focus()"
      @theme="setTheme"
      @encoding="setEncoding"
      @line-ending="setLineEnding"
      @markdown-width="setMarkdownWidth"
      @csv-options="updateCsvOptions"
    />
    <AppDialog
      v-if="closePrompt"
      :key="closePrompt.note.id"
      title="保存更改？"
      labelled-by="close-title"
      :header="false"
      :dismissible="false"
      :busy="busy"
      @close="resolveClose('cancel')"
      @restore-focus="view?.focus()"
    >
      <h2 id="close-title">保存更改？</h2>
      <p>“{{ closePrompt.note.name }}”尚未保存。</p>
      <div>
        <button :disabled="busy" @click="resolveClose('cancel')">取消</button
        ><button :disabled="busy" @click="resolveClose('discard')">不保存</button
        ><button class="primary" :disabled="busy" @click="resolveClose('save')">
          {{ busy ? '保存中…' : '保存并关闭' }}
        </button>
      </div>
    </AppDialog>
    <ContextMenu v-if="context" :x="context.x" :y="context.y" :items="context.items" @close="dismissContext" />
  </div>
</template>
