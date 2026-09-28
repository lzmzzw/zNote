<script setup lang="ts">
import { FileCode2, FileJson2, FileSpreadsheet, FileText, X, Plus, Code2, Eye, Columns2 } from 'lucide-vue-next';
import type { DisplayMode, Note } from '../document';
import { needsSave } from '../note-file';
defineProps<{ notes: Note[]; activeId: number; mode: DisplayMode }>();
const emit = defineEmits<{ select: [note: Note]; close: [note: Note]; create: []; mode: [mode: DisplayMode] }>();
const icons = { markdown: FileCode2, json: FileJson2, csv: FileSpreadsheet, txt: FileText };
const modes = [
  { value: 'source', label: '源码', icon: Code2 },
  { value: 'live', label: '原位', icon: Eye },
  { value: 'split', label: '分屏', icon: Columns2 },
] as const;
function auxClick(event: MouseEvent, note: Note) {
  if (event.button === 1) {
    event.preventDefault();
    emit('close', note);
  }
}
</script>

<template>
  <div class="tabs">
    <div class="tab-list" role="tablist">
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
          :aria-label="`${note.name}，${needsSave(note.path, note.dirty) ? '未保存' : '已保存'}`"
          :title="note.name"
          @click="emit('select', note)"
        >
          <component
            :is="icons[note.format]"
            class="file-icon"
            :class="{ unsaved: needsSave(note.path, note.dirty) }"
            :size="15"
            aria-hidden="true"
          />
          <span class="tab-name">{{ note.name }}</span>
        </button>
        <button class="close-tab" :aria-label="`关闭 ${note.name}`" @click="emit('close', note)">
          <X :size="13" />
        </button>
      </div>
      <button class="add-tab" title="新建笔记" @click="emit('create')"><Plus :size="16" /></button>
    </div>
    <div class="mode-switch" role="group" aria-label="编辑模式">
      <button
        v-for="item in modes"
        :key="item.value"
        :aria-label="item.label"
        :title="item.label"
        :aria-pressed="mode === item.value"
        :class="{ chosen: mode === item.value }"
        @click="emit('mode', item.value)"
      >
        <component :is="item.icon" :size="16" />
      </button>
    </div>
  </div>
</template>
