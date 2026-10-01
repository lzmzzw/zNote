<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import {
  Circle,
  FileCode2,
  FileJson2,
  FileSpreadsheet,
  FileText,
  X,
  Plus,
  Code2,
  Eye,
  Columns2,
} from 'lucide-vue-next';
import type { DisplayMode, Note } from '../document';
import { needsSave } from '../note-file';
const props = defineProps<{ notes: Note[]; activeId: number; mode: DisplayMode }>();
const tabList = ref<HTMLElement | null>(null);
const emit = defineEmits<{ select: [note: Note]; close: [note: Note]; create: []; mode: [mode: DisplayMode] }>();
const icons = { markdown: FileCode2, json: FileJson2, csv: FileSpreadsheet, txt: FileText };
const modes = [
  { value: 'source', label: '源码编辑', icon: Code2 },
  { value: 'live', label: '原位编辑', icon: Eye },
  { value: 'split', label: '分屏编辑与预览', icon: Columns2 },
] as const;
function tabButtons() {
  return Array.from(tabList.value?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
}
watch(
  () => [props.activeId, props.notes.map((note) => note.id).join(',')],
  async () => {
    await nextTick();
    tabButtons()
      .find((button) => button.getAttribute('aria-selected') === 'true')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  },
  { immediate: true },
);
function navigateTabs(event: KeyboardEvent, note: Note) {
  const index = props.notes.findIndex((item) => item.id === note.id);
  const count = props.notes.length;
  let target: number;
  switch (event.key) {
    case 'ArrowLeft':
      target = (index - 1 + count) % count;
      break;
    case 'ArrowRight':
      target = (index + 1) % count;
      break;
    case 'Home':
      target = 0;
      break;
    case 'End':
      target = count - 1;
      break;
    default:
      return;
  }
  if (!count) return;
  event.preventDefault();
  emit('select', props.notes[target]!);
  tabButtons()[target]?.focus({ preventScroll: true });
  tabButtons()[target]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}
function auxClick(event: MouseEvent, note: Note) {
  if (event.button === 1) {
    event.preventDefault();
    emit('close', note);
  }
}
</script>

<template>
  <div class="tabs">
    <div ref="tabList" class="tab-list" role="tablist" aria-label="打开的文档">
      <div
        v-for="note in notes"
        :key="note.id"
        class="tab"
        :class="{ active: note.id === activeId }"
        @mousedown.middle.prevent
        @auxclick="auxClick($event, note)"
      >
        <button
          role="tab"
          :aria-selected="note.id === activeId"
          :tabindex="note.id === activeId ? 0 : -1"
          :aria-label="`${note.name}，${needsSave(note.path, note.dirty) ? '未保存' : '已保存'}`"
          :title="note.path || note.name"
          @click="emit('select', note)"
          @keydown="navigateTabs($event, note)"
        >
          <component
            :is="icons[note.format]"
            class="file-icon"
            :class="{ unsaved: needsSave(note.path, note.dirty) }"
            :size="15"
            aria-hidden="true"
          />
          <span class="tab-name">{{ note.name }}</span>
          <Circle
            v-if="needsSave(note.path, note.dirty)"
            class="unsaved-dot"
            :size="6"
            fill="currentColor"
            aria-hidden="true"
          />
        </button>
        <button
          class="close-tab"
          :aria-label="`关闭 ${note.name}`"
          @click="emit('close', note)"
        >
          <X :size="13" />
        </button>
      </div>
      <button class="add-tab" aria-label="新建笔记" @click="emit('create')">
        <Plus :size="16" />
      </button>
    </div>
    <div class="mode-switch" role="group" aria-label="编辑模式">
      <button
        v-for="item in modes"
        :key="item.value"
        :aria-label="item.value === 'source' ? '源码' : item.value === 'live' ? '原位' : '分屏'"
        :data-tooltip="item.label"
        :aria-pressed="mode === item.value"
        :class="{ chosen: mode === item.value }"
        @click="emit('mode', item.value)"
      >
        <component :is="item.icon" :size="16" />
      </button>
    </div>
  </div>
</template>
