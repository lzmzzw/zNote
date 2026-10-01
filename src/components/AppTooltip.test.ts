// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import AppTooltip from './AppTooltip.vue';

let app: App;
let root: HTMLDivElement;
let button: HTMLButtonElement;
beforeEach(() => {
  vi.useFakeTimers();
  root = document.createElement('div');
  button = document.createElement('button');
  button.dataset.tooltip = '保存文档';
  document.body.append(root, button);
  app = createApp(AppTooltip);
  app.mount(root);
});
afterEach(() => {
  app.unmount();
  root.remove();
  button.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const tip = () => document.querySelector<HTMLElement>('[role="tooltip"]');
async function flush() { await nextTick(); await nextTick(); }

it('delays hover, cancels pending hover on leave and restores descriptions', async () => {
  button.setAttribute('aria-describedby', 'existing');
  button.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(399);
  expect(tip()).toBeNull();
  button.dispatchEvent(new MouseEvent('pointerout', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(1);
  expect(tip()).toBeNull();
  button.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(400);
  await flush();
  expect(tip()?.textContent).toBe('保存文档');
  expect(button.getAttribute('aria-describedby')).toBe(`existing ${tip()!.id}`);
  button.dispatchEvent(new MouseEvent('pointerout', { bubbles: true }));
  await flush();
  expect(button.getAttribute('aria-describedby')).toBe('existing');
  expect(tip()).toBeNull();
});

it('shows immediately on keyboard focus without taking focus and dismisses on Escape', async () => {
  button.focus();
  await flush();
  expect(tip()).not.toBeNull();
  expect(document.activeElement).toBe(button);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flush();
  expect(tip()).toBeNull();
  expect(button.hasAttribute('aria-describedby')).toBe(false);
});

it('clamps position and closes on resize and captured scroll', async () => {
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(window.innerWidth - 20, window.innerHeight - 20, 20, 20));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this === button ? new DOMRect(window.innerWidth - 20, window.innerHeight - 20, 20, 20) : new DOMRect(0, 0, 140, 24);
  });
  button.focus();
  await flush();
  expect(parseFloat(tip()!.style.left) + 140).toBeLessThanOrEqual(window.innerWidth - 8);
  expect(parseFloat(tip()!.style.top) + 24).toBeLessThanOrEqual(window.innerHeight - 8);
  window.dispatchEvent(new Event('resize'));
  await flush();
  expect(tip()).toBeNull();
  button.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  await flush();
  button.dispatchEvent(new Event('scroll'));
  await flush();
  expect(tip()).toBeNull();
});

it('cleans pending timers and active descriptions when unmounted', async () => {
  button.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
  app.unmount();
  await vi.advanceTimersByTimeAsync(400);
  expect(tip()).toBeNull();
  button.focus();
  await flush();
  expect(button.hasAttribute('aria-describedby')).toBe(false);
});

it('restores the existing description when an active tooltip unmounts', async () => {
  button.setAttribute('aria-describedby', 'existing');
  button.focus();
  await flush();
  expect(tip()).not.toBeNull();
  app.unmount();
  expect(button.getAttribute('aria-describedby')).toBe('existing');
  expect(tip()).toBeNull();
});
