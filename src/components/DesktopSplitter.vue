<script setup lang="ts">
import { ref } from 'vue';

const props = withDefaults(
  defineProps<{
    modelValue: number;
    min: number;
    max: number;
    resetValue: number;
    label: string;
    unit?: 'px' | 'percent';
    step?: number;
    pixelsPerUnit?: number;
  }>(),
  { unit: 'px', step: 8, pixelsPerUnit: 1 },
);
const emit = defineEmits<{ 'update:modelValue': [value: number] }>();
const dragging = ref(false);
let activePointer: number | null = null;
let startX = 0;
let startValue = 0;

function update(value: number) {
  emit('update:modelValue', Math.min(props.max, Math.max(props.min, value)));
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0 || activePointer !== null) return;
  event.preventDefault();
  const element = event.currentTarget as HTMLElement;
  element.focus({ preventScroll: true });
  element.setPointerCapture(event.pointerId);
  activePointer = event.pointerId;
  startX = event.clientX;
  startValue = props.modelValue;
  dragging.value = true;
}

function onPointerMove(event: PointerEvent) {
  if (event.pointerId !== activePointer) return;
  if (props.pixelsPerUnit <= 0) return;
  update(startValue + (event.clientX - startX) / props.pixelsPerUnit);
}

function onPointerEnd(event: PointerEvent) {
  if (event.pointerId !== activePointer) return;
  activePointer = null;
  dragging.value = false;
  const element = event.currentTarget as HTMLElement;
  if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
}

function onKeydown(event: KeyboardEvent) {
  let value: number;
  const step = props.step * (event.shiftKey ? 5 : 1);
  switch (event.key) {
    case 'ArrowLeft':
      value = props.modelValue - step;
      break;
    case 'ArrowRight':
      value = props.modelValue + step;
      break;
    case 'Home':
      value = props.min;
      break;
    case 'End':
      value = props.max;
      break;
    default:
      return;
  }
  event.preventDefault();
  event.stopPropagation();
  update(value);
}
</script>

<template>
  <div
    class="desktop-splitter"
    :class="{ 'is-dragging': dragging }"
    role="separator"
    tabindex="0"
    aria-orientation="vertical"
    :aria-label="label"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="modelValue"
    :aria-valuetext="`${Math.round(modelValue)}${unit === 'percent' ? '%' : 'px'}`"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerEnd"
    @pointercancel="onPointerEnd"
    @lostpointercapture="onPointerEnd"
    @keydown="onKeydown"
    @dblclick="update(resetValue)"
  />
</template>
