<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { Square, RotateCw } from 'lucide-vue-next';
import type { Text } from '@codemirror/state';
import type { CsvOptions } from '../csv';
import { CsvWorkerClient } from '../csv-client';
import type { CsvState, CsvWindow } from '../csv-engine';
import type { ContextMenuItem } from '../context-menu';
import { columnViewport, rowScrollOffset, rowViewport } from './csv-viewport';

const props = defineProps<{
  documentId: number;
  doc: Text;
  options: CsvOptions;
  widths: number[];
  fontSize: number;
  selectedLine: number;
  scrollTop: number;
}>();
const emit = defineEmits<{
  widths: [widths: number[]];
  locate: [line: number];
  scroll: [top: number, line: number];
  context: [event: MouseEvent, items: ContextMenuItem[]];
  copy: [text: string];
  error: [message: string];
}>();
const viewport = ref<HTMLElement>();
const dimensions = ref({ width: 800, height: 500 });
const offset = ref({ x: 0, y: props.scrollTop });
const state = shallowRef<CsvState>({ status: 'parsing', progress: 0, rowCount: 0, columnCount: 0, error: null });
const data = shallowRef<CsvWindow>();
const header = shallowRef<CsvWindow>();
const stopped = ref(false);
const copying = ref(false);
const gotoRow = ref(1);
const client = new CsvWorkerClient();
let jobId = '';
let generation = 0;
let request = 0;
let scheduled = false;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let syncSource = false;
let ignoredScroll: number | undefined;
let locateRequest = 0;
let observer: ResizeObserver | undefined;
let scrollTarget: number | undefined;
let resize: { column: number; x: number; widths: number[] } | undefined;
const rowHeight = computed(() => Math.ceil(props.fontSize * 1.7) + 16);
const bodyCount = computed(() => Math.max(0, state.value.rowCount - (props.options.firstRowHeader ? 1 : 0)));
const bodyHeight = computed(() =>
  Math.max(1, dimensions.value.height - (props.options.firstRowHeader ? rowHeight.value : 0)),
);
const rows = computed(() => rowViewport(bodyCount.value, rowHeight.value, offset.value.y, bodyHeight.value));
const columns = computed(() =>
  columnViewport(state.value.columnCount, props.widths, offset.value.x, dimensions.value.width),
);
const visibleRows = computed(() =>
  (data.value?.rows ?? []).map((cells, index) => ({
    cells,
    index: data.value!.rowStart + index,
    line: data.value!.rowLines[index],
  })),
);
const headerCells = computed(() =>
  header.value?.colStart === columns.value.start ? (header.value.rows[0] ?? []) : [],
);
const windowMatches = computed(
  () =>
    data.value?.rowStart === rows.value.start + (props.options.firstRowHeader ? 1 : 0) &&
    data.value?.colStart === columns.value.start,
);
const tableStyle = computed(() => ({
  left: `${columns.value.origin}px`,
  width: `${Array.from({ length: columns.value.end - columns.value.start }, (_, index) => widthAt(columns.value.start + index)).reduce((sum, width) => sum + width, 0)}px`,
}));
function widthAt(column: number) {
  return props.widths.length === state.value.columnCount ? props.widths[column] : 160;
}
function reset() {
  clearTimeout(refreshTimer);
  stopResize();
  const current = ++generation;
  jobId = `${props.documentId}:${current}`;
  stopped.value = false;
  state.value = { status: 'parsing', progress: 0, rowCount: 0, columnCount: 0, error: null };
  data.value = undefined;
  header.value = undefined;
  scrollTarget = props.scrollTop;
  client.start(jobId, props.doc.toString(), props.options, (value) => {
    if (current !== generation) return;
    state.value = value;
    void nextTick(() => {
      if (current !== generation || scrollTarget === undefined || !value.rowCount || !viewport.value) return;
      viewport.value.scrollTop = scrollTarget;
      ignoredScroll = viewport.value.scrollTop;
      offset.value = { x: viewport.value.scrollLeft, y: viewport.value.scrollTop };
      if (value.status !== 'parsing' || viewport.value.scrollTop >= scrollTarget) scrollTarget = undefined;
      scheduleWindow();
    });
    scheduleWindow();
  });
}
function scheduleWindow() {
  if (scheduled || stopped.value || !state.value.rowCount) return;
  scheduled = true;
  void nextTick(() => {
    scheduled = false;
    void loadWindow();
  });
}
async function loadWindow() {
  const current = ++request;
  const id = jobId;
  const rowStart = rows.value.start + (props.options.firstRowHeader ? 1 : 0);
  const window = {
    rowStart,
    rowCount: rows.value.end - rows.value.start,
    colStart: columns.value.start,
    colCount: columns.value.end - columns.value.start,
  };
  try {
    const [body, first] = await Promise.all([
      client.getWindow(id, window),
      props.options.firstRowHeader
        ? client.getWindow(id, { ...window, rowStart: 0, rowCount: 1 })
        : Promise.resolve(undefined),
    ]);
    if (current !== request || id !== jobId || stopped.value) return;
    data.value = body;
    header.value = first;
    if (syncSource && viewport.value) {
      syncSource = false;
      const index = Math.max(0, rows.value.first + (props.options.firstRowHeader ? 1 : 0) - body.rowStart);
      emit('scroll', viewport.value.scrollTop, body.rowLines[index]?.start ?? 1);
    }
  } catch (error) {
    reportError(error);
  }
}
function reportError(error: unknown) {
  if (!(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError'))
    emit('error', `CSV 处理失败：${error}`);
}
function cancel() {
  clearTimeout(refreshTimer);
  generation++;
  request++;
  client.dispose();
  stopped.value = true;
  stopResize();
}
function onScroll() {
  const element = viewport.value;
  if (!element) return;
  offset.value = { x: element.scrollLeft, y: element.scrollTop };
  const ignored = ignoredScroll !== undefined && Math.abs(element.scrollTop - ignoredScroll) < 1;
  if (ignored) ignoredScroll = undefined;
  else {
    syncSource = true;
    scrollTarget = undefined;
  }
  scheduleWindow();
}
function goToRow(row: number, notify = true) {
  scrollTarget = undefined;
  const element = viewport.value;
  if (!element) return;
  const index = Math.max(0, Math.min(bodyCount.value - 1, row - 1 - (props.options.firstRowHeader ? 1 : 0)));
  element.scrollTop = rowScrollOffset(index, bodyCount.value, rowHeight.value, bodyHeight.value);
  if (!notify) ignoredScroll = element.scrollTop;
  onScroll();
  if (!notify) {
    ignoredScroll = element.scrollTop;
    syncSource = false;
  }
}
async function scrollToLine(line: number) {
  // CSV records can span several source lines; indexed windows carry their physical line ranges.
  if (!data.value || !viewport.value) return;
  const first = visibleRows.value.find(
    (row) => row.index === rows.value.first + (props.options.firstRowHeader ? 1 : 0),
  );
  if (first && line >= first.line.start && line <= first.line.end) return;
  const id = jobId,
    sequence = ++locateRequest;
  try {
    const row = await client.rowAtLine(id, line);
    if (id === jobId && sequence === locateRequest && row >= 0) goToRow(row + 1, false);
  } catch (error) {
    reportError(error);
  }
}
function resizedWidths() {
  return props.widths.length === state.value.columnCount
    ? [...props.widths]
    : (Array(state.value.columnCount).fill(160) as number[]);
}
function nudgeColumn(column: number, amount: number) {
  if (state.value.columnCount > 100_000) return;
  const widths = resizedWidths();
  widths[column] = Math.max(80, Math.min(1200, widths[column] + amount));
  emit('widths', widths);
}
function startResize(event: PointerEvent, column: number) {
  if (event.button !== 0 || state.value.columnCount > 100_000) return;
  stopResize();
  resize = { column, x: event.clientX, widths: resizedWidths() };
  window.addEventListener('pointermove', moveResize);
  window.addEventListener('pointerup', stopResize);
  window.addEventListener('pointercancel', stopResize);
}
function moveResize(event: PointerEvent) {
  if (!resize) return;
  const widths = [...resize.widths];
  widths[resize.column] = Math.max(80, Math.min(1200, widths[resize.column] + event.clientX - resize.x));
  emit('widths', widths);
}
function stopResize() {
  resize = undefined;
  window.removeEventListener('pointermove', moveResize);
  window.removeEventListener('pointerup', stopResize);
  window.removeEventListener('pointercancel', stopResize);
}
async function copy(kind: 'cell' | 'row' | 'column', row: number, column: number, id = jobId) {
  if (id !== jobId) return;
  copying.value = true;
  try {
    const text = await client.copy(id, { kind, row, column });
    if (id === jobId && !stopped.value) emit('copy', text);
  } catch (error) {
    reportError(error);
  } finally {
    copying.value = false;
  }
}
function contextMenu(event: MouseEvent) {
  const cell =
    event.target instanceof Element ? event.target.closest<HTMLElement>('[data-csv-row][data-csv-column]') : null;
  if (!cell) return false;
  const row = Number(cell.dataset.csvRow),
    column = Number(cell.dataset.csvColumn);
  const line = Number(cell.dataset.sourceStart);
  const id = jobId;
  emit('context', event, [
    {
      label: '复制单元格',
      disabled: copying.value || state.value.status !== 'ready',
      action: () => copy('cell', row, column, id),
    },
    {
      label: '复制整行',
      disabled: copying.value || state.value.status !== 'ready',
      action: () => copy('row', row, column, id),
    },
    {
      label: '复制整列',
      disabled: copying.value || state.value.status !== 'ready',
      action: () => copy('column', row, column, id),
    },
    {
      label: '定位到源码',
      action: () => {
        if (id === jobId) emit('locate', line);
      },
    },
  ]);
  return true;
}
watch(
  () => [props.documentId, props.doc, props.options],
  () => {
    cancel();
    data.value = undefined;
    header.value = undefined;
    stopped.value = false;
    state.value = { status: 'parsing', progress: 0, rowCount: 0, columnCount: 0, error: null };
    refreshTimer = setTimeout(reset, 280);
  },
);
watch(() => [rows.value.start, rows.value.end, columns.value.start, columns.value.end], scheduleWindow);
onMounted(() => {
  observer = new ResizeObserver(() => {
    if (viewport.value)
      dimensions.value = { width: viewport.value.clientWidth || 800, height: viewport.value.clientHeight || 500 };
  });
  observer.observe(viewport.value!);
  reset();
});
onBeforeUnmount(() => {
  generation++;
  clearTimeout(refreshTimer);
  client.dispose();
  observer?.disconnect();
  stopResize();
});
defineExpose({ contextMenu, scrollToLine });
</script>

<template>
  <section class="preview csv-preview" aria-label="CSV 预览" :aria-busy="state.status === 'parsing' && !stopped">
    <div class="csv-status">
      <span v-if="stopped">解析已暂停</span>
      <span v-else-if="state.status === 'parsing'" role="status">解析 {{ Math.round(state.progress * 100) }}%</span>
      <span v-else>{{ state.rowCount.toLocaleString() }} 行 · {{ state.columnCount.toLocaleString() }} 列</span>
      <span v-if="copying" role="status">正在复制</span>
      <form v-if="state.rowCount" @submit.prevent="goToRow(gotoRow)">
        <label
          >行 <input v-model.number="gotoRow" type="number" min="1" :max="state.rowCount" aria-label="跳转到 CSV 行"
        /></label>
      </form>
      <button v-if="state.status === 'parsing' && !stopped" aria-label="取消 CSV 解析" @click="cancel">
        <Square :size="14" />
      </button>
      <button v-if="stopped || state.status === 'error'" aria-label="重新解析 CSV" @click="reset">
        <RotateCw :size="15" />
      </button>
    </div>
    <p v-if="state.error" class="csv-error" role="alert">{{ state.error }}</p>
    <div ref="viewport" class="csv-table-wrap" tabindex="0" aria-label="CSV 表格" @scroll="onScroll">
      <div
        class="csv-canvas"
        :style="{
          height: `${Math.max(dimensions.height, rows.extent + (options.firstRowHeader ? rowHeight : 0))}px`,
          width: `${Math.max(dimensions.width, columns.extent)}px`,
        }"
      >
        <table
          v-if="data && windowMatches"
          class="csv-resized csv-body-table"
          :style="{
            ...tableStyle,
            top: `${rows.origin + (options.firstRowHeader ? rowHeight : 0)}px`,
            '--csv-row-height': `${rowHeight}px`,
          }"
          :aria-rowcount="state.rowCount"
          :aria-colcount="state.columnCount"
        >
          <colgroup>
            <col
              v-for="column in columns.end - columns.start"
              :key="columns.start + column"
              :style="{ width: `${widthAt(columns.start + column - 1)}px` }"
            />
          </colgroup>
          <tbody>
            <tr
              v-for="row in visibleRows"
              :key="row.index"
              :aria-rowindex="row.index + 1"
              :data-source-start="row.line.start"
              :data-source-end="row.line.end"
              :class="{
                'preview-selected': selectedLine >= row.line.start && selectedLine <= row.line.end,
                'csv-even': row.index % 2 === 0,
              }"
            >
              <td
                v-for="(cell, column) in row.cells"
                :key="columns.start + column"
                :aria-colindex="columns.start + column + 1"
                :data-csv-row="row.index"
                :data-csv-column="columns.start + column"
                :data-source-start="row.line.start"
                @click="emit('locate', row.line.start)"
              >
                <div class="csv-cell-value">{{ cell }}</div>
                <span
                  v-if="!options.firstRowHeader && state.columnCount <= 100_000"
                  class="csv-resize-handle"
                  role="separator"
                  aria-orientation="vertical"
                  tabindex="0"
                  :aria-label="`调整第 ${columns.start + column + 1} 列宽度`"
                  @pointerdown.stop.prevent="startResize($event, columns.start + column)"
                  @keydown.left.stop.prevent="nudgeColumn(columns.start + column, -16)"
                  @keydown.right.stop.prevent="nudgeColumn(columns.start + column, 16)"
                  @click.stop
                ></span>
              </td>
            </tr>
          </tbody>
        </table>
        <table
          v-if="options.firstRowHeader && headerCells.length"
          class="csv-resized csv-header-table"
          :style="{ ...tableStyle, top: `${offset.y}px`, '--csv-row-height': `${rowHeight}px` }"
          :aria-colcount="state.columnCount"
        >
          <colgroup>
            <col
              v-for="column in columns.end - columns.start"
              :key="columns.start + column"
              :style="{ width: `${widthAt(columns.start + column - 1)}px` }"
            />
          </colgroup>
          <thead>
            <tr :data-source-start="header?.rowLines[0]?.start" :data-source-end="header?.rowLines[0]?.end">
              <th
                v-for="(cell, column) in headerCells"
                :key="columns.start + column"
                scope="col"
                :aria-colindex="columns.start + column + 1"
                data-csv-row="0"
                :data-csv-column="columns.start + column"
                :data-source-start="header?.rowLines[0]?.start"
                @click="emit('locate', header?.rowLines[0]?.start ?? 1)"
              >
                <div class="csv-cell-value">{{ cell }}</div>
                <span
                  v-if="state.columnCount <= 100_000"
                  class="csv-resize-handle"
                  role="separator"
                  aria-orientation="vertical"
                  tabindex="0"
                  :aria-label="`调整第 ${columns.start + column + 1} 列宽度`"
                  @pointerdown.stop.prevent="startResize($event, columns.start + column)"
                  @keydown.left.stop.prevent="nudgeColumn(columns.start + column, -16)"
                  @keydown.right.stop.prevent="nudgeColumn(columns.start + column, 16)"
                  @click.stop
                ></span>
              </th>
            </tr>
          </thead>
        </table>
      </div>
      <p v-if="state.status === 'ready' && !state.rowCount" class="csv-empty">表格为空</p>
    </div>
  </section>
</template>
