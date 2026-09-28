<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { Check, ChevronDown } from 'lucide-vue-next';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}
const props = defineProps<{ modelValue?: string; options: SelectOption[]; label: string; compact?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const id = useId();
const trigger = ref<HTMLButtonElement>();
const popup = ref<HTMLElement>();
const open = ref(false);
const highlighted = ref(-1);
const placement = ref<Record<string, string>>({});
const selected = computed(() => props.options.find((option) => option.value === props.modelValue));

function close() {
  open.value = false;
}
async function show() {
  open.value = true;
  highlighted.value = props.options.findIndex((option) => option.value === props.modelValue && !option.disabled);
  if (highlighted.value < 0) highlighted.value = props.options.findIndex((option) => !option.disabled);
  await nextTick();
  if (!open.value || !trigger.value || !popup.value) return;
  const bounds = trigger.value.getBoundingClientRect();
  const height = Math.min(popup.value.scrollHeight, window.innerHeight - 16);
  const width = Math.min(Math.max(bounds.width, 164), window.innerWidth - 16);
  const below = window.innerHeight - bounds.bottom - 8;
  const above = bounds.top - 8;
  const upward = below < height && above > below;
  const available = Math.max(0, upward ? above - 4 : below - 4);
  placement.value = {
    width: `${width}px`,
    left: `${Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8))}px`,
    top: `${upward ? Math.max(8, bounds.top - Math.min(height, available) - 4) : bounds.bottom + 4}px`,
    maxHeight: `${available}px`,
  };
  await nextTick();
  reveal();
}
function reveal() {
  popup.value?.children[highlighted.value]?.scrollIntoView({ block: 'nearest' });
}
function choose(index: number) {
  const option = props.options[index];
  if (!option || option.disabled) return;
  emit('update:modelValue', option.value);
  close();
  trigger.value?.focus({ preventScroll: true });
}
async function keydown(event: KeyboardEvent) {
  if (event.key === 'Tab') {
    close();
    return;
  }
  if (event.key === 'Escape' && open.value) {
    event.preventDefault();
    event.stopPropagation();
    close();
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  if (!open.value) {
    await show();
    return;
  }
  if (event.key === 'Enter' || event.key === ' ') {
    choose(highlighted.value);
    return;
  }
  const enabled = props.options.map((option, index) => (option.disabled ? -1 : index)).filter((index) => index >= 0);
  if (!enabled.length) return;
  const current = enabled.indexOf(highlighted.value);
  highlighted.value =
    event.key === 'Home'
      ? enabled[0]
      : event.key === 'End'
        ? enabled.at(-1)!
        : enabled[(current + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length];
  reveal();
}
function outside(event: Event) {
  const target = event.target as Node;
  if (!trigger.value?.contains(target) && !popup.value?.contains(target)) close();
}
function scroll(event: Event) {
  if (!popup.value?.contains(event.target as Node)) close();
}
onMounted(() => {
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('focusin', outside);
  document.addEventListener('scroll', scroll, true);
  window.addEventListener('resize', close);
});
onBeforeUnmount(() => {
  close();
  document.removeEventListener('pointerdown', outside, true);
  document.removeEventListener('focusin', outside);
  document.removeEventListener('scroll', scroll, true);
  window.removeEventListener('resize', close);
});
</script>

<template>
  <div class="option-select" :class="{ compact }">
    <button
      ref="trigger"
      type="button"
      class="option-trigger"
      role="combobox"
      aria-haspopup="listbox"
      :aria-label="label"
      :aria-expanded="open"
      :aria-controls="open ? id : undefined"
      :aria-activedescendant="open && highlighted >= 0 ? `${id}-${highlighted}` : undefined"
      @click="open ? close() : show()"
      @keydown="keydown"
    >
      <span>{{ selected?.label ?? modelValue ?? '—' }}</span
      ><ChevronDown :size="14" aria-hidden="true" />
    </button>
    <div v-if="open" :id="id" ref="popup" class="option-popup" role="listbox" :aria-label="label" :style="placement">
      <div
        v-for="(option, index) in options"
        :id="`${id}-${index}`"
        :key="option.value"
        class="option-item"
        :class="{
          selected: option.value === modelValue,
          highlighted: index === highlighted,
          disabled: option.disabled,
        }"
        role="option"
        :aria-selected="option.value === modelValue"
        :aria-disabled="!!option.disabled"
        @pointerdown.prevent
        @pointermove="!option.disabled && (highlighted = index)"
        @click.stop="choose(index)"
      >
        <span>{{ option.label }}</span
        ><Check v-if="option.value === modelValue" :size="14" aria-hidden="true" />
      </div>
    </div>
  </div>
</template>
