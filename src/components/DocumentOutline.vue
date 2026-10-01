<script setup lang="ts">
import { computed } from 'vue';
import { ChevronRight, ChevronDown } from 'lucide-vue-next';
import { visibleOutline, type OutlineNode } from '../outline';
const props = defineProps<{ headings: OutlineNode[]; collapsed: string[]; currentKey?: string; paused?: boolean }>();
const emit = defineEmits<{ toggle: [key: string]; select: [heading: OutlineNode] }>();
const collapsedKeys = computed(() => new Set(props.collapsed));
const visibleHeadings = computed(() => visibleOutline(props.headings, collapsedKeys.value));
</script>

<template>
  <aside class="sidebar">
    <div class="section-title outline-title">文档大纲</div>
    <nav class="outline" aria-label="文档大纲">
      <div
        v-for="heading in visibleHeadings"
        :key="heading.key"
        class="outline-row"
        :class="{ current: heading.key === currentKey }"
        :style="{ paddingLeft: `${heading.depth * 14}px` }"
      >
        <button
          v-if="heading.children.length"
          class="outline-disclosure"
          :aria-label="`${collapsedKeys.has(heading.key) ? '展开' : '折叠'} ${heading.title}`"
          :aria-expanded="!collapsedKeys.has(heading.key)"
          @click="emit('toggle', heading.key)"
        >
          <ChevronRight v-if="collapsedKeys.has(heading.key)" :size="13" /><ChevronDown v-else :size="13" />
        </button>
        <span v-else class="outline-disclosure-placeholder" aria-hidden="true"></span>
        <button
          class="outline-link"
          :title="heading.title"
          :aria-current="heading.key === currentKey ? 'location' : undefined"
          @click="emit('select', heading)"
        >
          {{ heading.title }}
        </button>
      </div>
      <p v-if="paused" class="outline-empty">大文件大纲解析已暂停</p>
      <p v-else-if="!headings.length" class="outline-empty">暂无标题</p>
    </nav>
  </aside>
</template>
