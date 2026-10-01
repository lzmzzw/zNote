<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, useId, type CSSProperties } from 'vue';

const id = `tooltip-${useId()}`;
const label = ref('');
const tooltip = ref<HTMLElement>();
const position = ref<CSSProperties>({ left: '0px', top: '0px', visibility: 'hidden' });
let target: HTMLElement | null = null;
let hovered: HTMLElement | null = null;
let focused: HTMLElement | null = null;
let previousDescription: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

function closestTarget(node: EventTarget | null) {
  return node instanceof Element ? node.closest<HTMLElement>('[data-tooltip]') : null;
}
function hide() {
  clearTimeout(timer);
  timer = undefined;
  if (target) {
    if (previousDescription === null) target.removeAttribute('aria-describedby');
    else target.setAttribute('aria-describedby', previousDescription);
  }
  target = null;
  label.value = '';
  position.value.visibility = 'hidden';
}
async function show(element: HTMLElement) {
  hide();
  if (!element.isConnected || !element.dataset.tooltip) return;
  target = element;
  previousDescription = element.getAttribute('aria-describedby');
  element.setAttribute('aria-describedby', [previousDescription, id].filter(Boolean).join(' '));
  label.value = element.dataset.tooltip;
  await nextTick();
  if (target !== element || !tooltip.value) return;
  const anchor = element.getBoundingClientRect();
  const bounds = tooltip.value.getBoundingClientRect();
  const margin = 8;
  const left = Math.max(
    margin,
    Math.min(anchor.left + (anchor.width - bounds.width) / 2, window.innerWidth - bounds.width - margin),
  );
  const below = anchor.bottom + margin;
  const preferredTop =
    below + bounds.height <= window.innerHeight - margin ? below : anchor.top - bounds.height - margin;
  const top = Math.max(margin, Math.min(preferredTop, window.innerHeight - bounds.height - margin));
  position.value = { left: `${left}px`, top: `${top}px`, visibility: 'visible' };
}
function pointerOver(event: PointerEvent) {
  const element = closestTarget(event.target);
  if (element === hovered) return;
  hovered = element;
  if (focused) return;
  hide();
  if (element)
    timer = setTimeout(() => {
      void show(element);
    }, 400);
}
function pointerOut(event: PointerEvent) {
  if (closestTarget(event.relatedTarget) === hovered) return;
  hovered = null;
  if (!focused) hide();
}
function focusIn(event: FocusEvent) {
  focused = closestTarget(event.target);
  if (focused) void show(focused);
  else hide();
}
function focusOut(event: FocusEvent) {
  if (closestTarget(event.relatedTarget) === focused) return;
  focused = null;
  hide();
}
function dismiss() {
  hovered = null;
  focused = null;
  hide();
}
function keyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') dismiss();
}
onMounted(() => {
  document.addEventListener('pointerover', pointerOver);
  document.addEventListener('pointerout', pointerOut);
  document.addEventListener('focusin', focusIn);
  document.addEventListener('focusout', focusOut);
  document.addEventListener('keydown', keyDown);
  document.addEventListener('scroll', dismiss, true);
  window.addEventListener('resize', dismiss);
});
onUnmounted(() => {
  dismiss();
  document.removeEventListener('pointerover', pointerOver);
  document.removeEventListener('pointerout', pointerOut);
  document.removeEventListener('focusin', focusIn);
  document.removeEventListener('focusout', focusOut);
  document.removeEventListener('keydown', keyDown);
  document.removeEventListener('scroll', dismiss, true);
  window.removeEventListener('resize', dismiss);
});
</script>

<template>
  <div
    v-if="label"
    :id="id"
    ref="tooltip"
    class="app-tooltip"
    role="tooltip"
    :style="{ position: 'fixed', ...position }"
  >
    {{ label }}
  </div>
</template>
