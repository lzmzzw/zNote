// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, reactive, type App } from 'vue';
import type { Note } from '../document';
import DocumentTabs from './DocumentTabs.vue';

let app: App;
let root: HTMLDivElement;
const notes = [
  { id: 1, name: 'notes.md', path: 'C:/first/notes.md', format: 'markdown', dirty: false },
  { id: 2, name: 'notes.md', path: 'C:/second/notes.md', format: 'markdown', dirty: true },
  { id: 3, name: 'draft.txt', path: null, format: 'txt', dirty: false },
] as Note[];
let state: { activeId: number };
const selected = vi.fn();
beforeEach(async () => {
  selected.mockClear();
  Element.prototype.scrollIntoView = vi.fn();
  state = reactive({ activeId: 1 });
  root = document.createElement('div');
  document.body.append(root);
  app = createApp({
    components: { DocumentTabs },
    setup: () => ({ state, notes, select: (note: Note) => { selected(note); state.activeId = note.id; } }),
    template: '<DocumentTabs :notes="notes" :active-id="state.activeId" mode="live" @select="select" />',
  });
  app.mount(root);
  await nextTick();
});
afterEach(() => {
  app.unmount();
  root.remove();
  vi.restoreAllMocks();
});
const tabs = () => Array.from(root.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
it('scrolls overflowing tabs with vertical wheel and preserves native gestures', () => {
  const list = root.querySelector<HTMLElement>('.tab-list')!;
  Object.defineProperties(list, { scrollWidth: { value: 1200 }, clientWidth: { value: 400, configurable: true } });
  const wheel = (options: WheelEventInit) => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...options });
    tabs()[0]!.dispatchEvent(event);
    return event;
  };
  expect(wheel({ deltaY: 80 }).defaultPrevented).toBe(true);
  expect(list.scrollLeft).toBe(80);
  wheel({ deltaY: -2, deltaMode: 1 });
  expect(list.scrollLeft).toBe(48);
  wheel({ deltaY: 1, deltaMode: 2 });
  expect(list.scrollLeft).toBe(448);
  expect(wheel({ deltaX: 50, deltaY: 10 }).defaultPrevented).toBe(false);
  expect(wheel({ deltaY: 100, ctrlKey: true }).defaultPrevented).toBe(false);
  expect(list.scrollLeft).toBe(448);
  Object.defineProperty(list, 'clientWidth', { value: 1200 });
  expect(wheel({ deltaY: 80 }).defaultPrevented).toBe(false);
  expect(list.scrollLeft).toBe(448);
  expect(selected).not.toHaveBeenCalled();
});
async function key(index: number, value: string) {
  tabs()[index]!.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  await nextTick();
  await nextTick();
}

it('moves selection and focus with arrows, wraps and supports Home and End', async () => {
  expect(tabs().map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
  await key(0, 'ArrowLeft');
  expect(selected).toHaveBeenLastCalledWith(notes[2]);
  expect(document.activeElement).toBe(tabs()[2]);
  expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, -1, 0]);
  await key(2, 'ArrowRight');
  expect(state.activeId).toBe(1);
  await key(0, 'End');
  expect(state.activeId).toBe(3);
  await key(2, 'Home');
  expect(state.activeId).toBe(1);
});

it('reveals externally selected tabs without stealing focus', async () => {
  const add = root.querySelector<HTMLButtonElement>('.add-tab')!;
  add.focus();
  const reveal = vi.spyOn(tabs()[1]!, 'scrollIntoView');
  state.activeId = 2;
  await nextTick();
  await nextTick();
  expect(reveal).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
  expect(document.activeElement).toBe(add);
});

it('distinguishes paths, displays unsaved shapes and names editing modes', () => {
  expect(tabs()[0]!.title).toBe('C:/first/notes.md');
  expect(tabs()[1]!.title).toBe('C:/second/notes.md');
  expect(tabs()[0]!.querySelector('.unsaved-dot')).toBeNull();
  expect(tabs()[1]!.querySelector('.unsaved-dot')).not.toBeNull();
  expect(tabs()[2]!.querySelector('.unsaved-dot')).not.toBeNull();
  expect(root.querySelector('[data-tooltip="原位编辑"]')?.getAttribute('aria-pressed')).toBe('true');
});
