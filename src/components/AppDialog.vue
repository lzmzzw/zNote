<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { X } from 'lucide-vue-next';

const props = withDefaults(
  defineProps<{
    title: string;
    panelClass?: string;
    labelledBy?: string;
    dismissible?: boolean;
    header?: boolean;
    busy?: boolean;
  }>(),
  { dismissible: true, header: true, busy: false },
);
const emit = defineEmits<{ close: []; 'restore-focus': [] }>();
const panel = ref<HTMLElement>();
let previousFocus: HTMLElement | null = null;

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    if (!props.busy) emit('close');
  }
  if (event.key !== 'Tab') return;
  const controls = [
    ...(panel.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
    ) ?? []),
  ];
  const first = controls[0];
  const last = controls.at(-1);
  if (!first) {
    event.preventDefault();
    panel.value?.focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

onMounted(() => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  (
    panel.value?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ??
    panel.value
  )?.focus();
});
onUnmounted(() => {
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  else emit('restore-focus');
});
</script>

<template>
  <div class="modal-backdrop" @click.self="dismissible && !busy && emit('close')">
    <section
      ref="panel"
      class="modal"
      :class="panelClass"
      role="dialog"
      aria-modal="true"
      :aria-label="labelledBy ? undefined : title"
      :aria-labelledby="labelledBy"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <header v-if="header">
        <h2>{{ title }}</h2>
        <button
          :aria-label="title === '设置' || title === 'CSV设置' ? `关闭${title}` : `关闭 ${title}`"
          @click="emit('close')"
        >
          <X :size="18" />
        </button>
      </header>
      <slot />
    </section>
  </div>
</template>
