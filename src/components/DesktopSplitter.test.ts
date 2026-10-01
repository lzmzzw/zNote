// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, type App } from 'vue';
import DesktopSplitter from './DesktopSplitter.vue';

let app: App | undefined;
afterEach(() => {
  app?.unmount();
  document.body.replaceChildren();
});

async function mount(options: { unit?: 'px' | 'percent'; pixelsPerUnit?: number; step?: number } = {}) {
  const value = ref(50);
  const root = document.createElement('div');
  document.body.append(root);
  app = createApp({ render: () => h(DesktopSplitter, {
    modelValue: value.value, min: 20, max: 80, resetValue: 50, label: '调整预览宽度', ...options,
    'onUpdate:modelValue': (next: number) => { value.value = next; },
  }) });
  app.mount(root);
  await nextTick();
  return { value, element: root.querySelector<HTMLElement>('[role="separator"]')! };
}

function pointer(element: HTMLElement, type: string, pointerId: number, clientX: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId, clientX, button: 0 });
  element.dispatchEvent(event);
}

describe('desktop splitter', () => {
  it('supports keyboard bounds, accelerated adjustment and reset', async () => {
    const { value, element } = await mount({ step: 2 });
    const key = async (key: string, shiftKey = false) => {
      element.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
      await nextTick();
    };
    await key('ArrowLeft');
    expect(value.value).toBe(48);
    await key('ArrowRight', true);
    expect(value.value).toBe(58);
    await key('End');
    await key('ArrowRight');
    expect(value.value).toBe(80);
    expect(element.getAttribute('aria-valuenow')).toBe('80');
    await key('Home');
    expect(value.value).toBe(20);
    element.dispatchEvent(new MouseEvent('dblclick'));
    expect(value.value).toBe(50);
  });

  it('converts pointer pixels to percent and ignores another pointer and ended drags', async () => {
    const { value, element } = await mount({ unit: 'percent', pixelsPerUnit: 10, step: 1 });
    element.setPointerCapture = vi.fn();
    element.hasPointerCapture = vi.fn(() => true);
    element.releasePointerCapture = vi.fn();
    pointer(element, 'pointerdown', 1, 100);
    expect(element.setPointerCapture).toHaveBeenCalledWith(1);
    pointer(element, 'pointermove', 2, 300);
    expect(value.value).toBe(50);
    pointer(element, 'pointermove', 1, 200);
    expect(value.value).toBe(60);
    pointer(element, 'pointermove', 1, 1000);
    expect(value.value).toBe(80);
    pointer(element, 'pointercancel', 1, 1000);
    expect(element.releasePointerCapture).toHaveBeenCalledWith(1);
    pointer(element, 'pointermove', 1, 0);
    expect(value.value).toBe(80);
    await nextTick();
    expect(element.classList.contains('is-dragging')).toBe(false);
    expect(element.getAttribute('aria-valuetext')).toBe('80%');
  });
});
