<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { ContextMenuItem } from '../context-menu';

const props = defineProps<{ items: ContextMenuItem[]; x: number; y: number }>();
const emit = defineEmits<{ close: [] }>();
const menu = ref<HTMLElement | null>(null);
const position = ref({ left: props.x, top: props.y });
const style = computed(() => ({ left: `${position.value.left}px`, top: `${position.value.top}px` }));
let previousFocus: HTMLElement | null = null;

function enabledButtons(): HTMLButtonElement[] {
  return Array.from(menu.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
}

async function placeAndFocus() {
  await nextTick();
  const bounds = menu.value?.getBoundingClientRect();
  if (!bounds) return;
  position.value = {
    left: Math.max(4, Math.min(props.x, window.innerWidth - bounds.width - 4)),
    top: Math.max(4, Math.min(props.y, window.innerHeight - bounds.height - 4)),
  };
  (enabledButtons()[0] ?? menu.value)?.focus({ preventScroll: true });
}

function close() { emit('close'); }
function outside(event: PointerEvent) {
  if (!menu.value?.contains(event.target as Node)) close();
}
function scroll(event: Event) {
  if (!(event.target instanceof Node) || !menu.value?.contains(event.target)) close();
}
function choose(item: ContextMenuItem) {
  if (item.disabled) return;
  close();
  void item.action();
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape' || event.key === 'Tab') {
    event.preventDefault();
    close();
    return;
  }
  const buttons = enabledButtons();
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  let next = index;
  if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
  else if (event.key === 'ArrowUp') next = index < 0 ? buttons.length - 1 : (index + buttons.length - 1) % buttons.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = buttons.length - 1;
  else return;
  event.preventDefault();
  buttons[next]?.focus();
}

onMounted(() => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.addEventListener('pointerdown', outside, true);
  window.addEventListener('resize', close);
  window.addEventListener('scroll', scroll, true);
  void placeAndFocus();
});
watch(() => [props.x, props.y, props.items], () => { void placeAndFocus(); });
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', outside, true);
  window.removeEventListener('resize', close);
  window.removeEventListener('scroll', scroll, true);
  if (menu.value?.contains(document.activeElement) || document.activeElement === document.body) {
    previousFocus?.focus({ preventScroll: true });
  }
});
</script>

<template>
  <div ref="menu" class="context-menu" role="menu" aria-label="右键菜单" tabindex="-1"
    :style="style" @keydown.stop="keydown" @contextmenu.stop.prevent>
    <template v-for="(item, index) in items" :key="index">
      <div v-if="item.separator" class="context-menu-separator" role="separator" />
      <button type="button" role="menuitem" :disabled="item.disabled" :aria-disabled="!!item.disabled"
        @click="choose(item)">{{ item.label }}</button>
    </template>
  </div>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 160px;
  max-width: calc(100vw - 8px);
  max-height: calc(100vh - 8px);
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg);
  color: var(--text);
  box-shadow: 0 4px 16px #0003;
  font-size: 12px;
  outline: none;
}
.context-menu button {
  display: block;
  width: 100%;
  padding: 6px 12px;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: inherit;
  font: inherit;
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
}
.context-menu button:not(:disabled):hover,
.context-menu button:not(:disabled):focus-visible {
  background: var(--hover);
  outline: none;
}
.context-menu button:disabled { color: var(--muted); cursor: default; }
.context-menu-separator { height: 1px; margin: 4px 3px; background: var(--border); }
</style>
