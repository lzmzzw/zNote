// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import OptionSelect from './OptionSelect.vue';

let app: App;
let root: HTMLDivElement;
const changed = vi.fn();
const options = [{ value: 'mixed', label: 'Mixed', disabled: true }, { value: 'lf', label: 'LF' }, { value: 'crlf', label: 'CRLF' }];
beforeEach(() => {
  changed.mockClear();
  Element.prototype.scrollIntoView = vi.fn();
  root = document.createElement('div'); document.body.append(root);
  app = createApp(OptionSelect, { modelValue: 'mixed', options, label: '换行格式', 'onUpdate:modelValue': changed });
  app.mount(root);
});
afterEach(() => { app.unmount(); root.remove(); vi.restoreAllMocks(); });
const trigger = () => root.querySelector<HTMLButtonElement>('button')!;
async function flush() { await nextTick(); await nextTick(); await nextTick(); }
async function key(key: string) { trigger().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); await flush(); }

it('selects with the keyboard, skips disabled options and returns focus', async () => {
  trigger().focus(); await key('ArrowDown');
  expect(trigger().getAttribute('aria-expanded')).toBe('true');
  const active = () => document.getElementById(trigger().getAttribute('aria-activedescendant')!)?.textContent;
  expect(active()).toBe('LF');
  await key('End'); expect(active()).toBe('CRLF');
  await key('ArrowDown'); expect(active()).toBe('LF');
  await key('Enter');
  expect(changed).toHaveBeenCalledWith('lf');
  expect(trigger().getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger());
});

it('keeps disabled items inert and closes on Escape, Tab and outside click', async () => {
  trigger().click(); await flush();
  root.querySelector<HTMLElement>('[aria-disabled="true"]')!.click(); await flush();
  expect(changed).not.toHaveBeenCalled();
  await key('Escape'); expect(root.querySelector('[role="listbox"]')).toBeNull();
  trigger().click(); await flush(); await key('Tab');
  expect(root.querySelector('[role="listbox"]')).toBeNull();
  trigger().click(); await flush(); document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); await flush();
  expect(root.querySelector('[role="listbox"]')).toBeNull();
});

it('opens above a footer trigger and stays inside the right edge', async () => {
  vi.spyOn(trigger(), 'getBoundingClientRect').mockReturnValue(new DOMRect(window.innerWidth - 102, window.innerHeight - 26, 102, 24));
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(106);
  trigger().click(); await flush();
  const popup = root.querySelector<HTMLElement>('[role="listbox"]')!;
  expect(parseFloat(popup.style.top) + 106).toBeLessThan(window.innerHeight - 26);
  expect(parseFloat(popup.style.left) + parseFloat(popup.style.width)).toBeLessThanOrEqual(window.innerWidth - 8);
});
