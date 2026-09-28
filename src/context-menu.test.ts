// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import ContextMenu from './components/ContextMenu.vue';
import { spreadsheetText, tabCloseTargets } from './context-menu';
import type { ContextMenuItem } from './context-menu';

describe('tabCloseTargets', () => {
  it('uses visual order to choose each close scope', () => {
    const ids = [7, 2, 9, 4];
    expect(tabCloseTargets(ids, 9, 'left')).toEqual([7, 2]);
    expect(tabCloseTargets(ids, 9, 'right')).toEqual([4]);
    expect(tabCloseTargets(ids, 9, 'others')).toEqual([7, 2, 4]);
    expect(tabCloseTargets(ids, 9, 'all')).toEqual(ids);
    expect(tabCloseTargets(ids, 9, 'current')).toEqual([9]);
  });
  it('has no left or right targets at their respective boundaries', () => {
    expect(tabCloseTargets([3, 8], 3, 'left')).toEqual([]);
    expect(tabCloseTargets([3, 8], 8, 'right')).toEqual([]);
    expect(tabCloseTargets([3], 3, 'others')).toEqual([]);
  });
  it('ignores missing or stale targets for every scope', () => {
    for (const scope of ['left', 'right', 'others', 'all', 'current'] as const) {
      expect(tabCloseTargets([1, 2], 5, scope)).toEqual([]);
      expect(tabCloseTargets([], 5, scope)).toEqual([]);
    }
  });
  it('returns an independent array without modifying tabs', () => {
    const ids = [3, 1, 8];
    tabCloseTargets(ids, 1, 'all').pop();
    expect(ids).toEqual([3, 1, 8]);
  });
});

describe('spreadsheetText', () => {
  it('copies rectangular and empty cells as TSV with Windows row endings', () => {
    expect(spreadsheetText([['name', 'amount'], ['item', ''], ['', '42']]))
      .toBe('name\tamount\r\nitem\t\r\n\t42');
    expect(spreadsheetText([])).toBe('');
    expect(spreadsheetText([['']])).toBe('');
  });
  it('quotes tabs, line breaks and quotes to preserve cell boundaries', () => {
    expect(spreadsheetText([['a\tb', 'line\nnext', 'say "hi"', 'a\rb'], ['plain', 'x\r\ny']]))
      .toBe('"a\tb"\t"line\nnext"\t"say ""hi"""\t"a\rb"\r\nplain\t"x\r\ny"');
  });
});

describe('ContextMenu', () => {
  let app: App | null = null;
  afterEach(() => {
    app?.unmount();
    app = null;
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });
  async function mount(items: ContextMenuItem[], x = 20, y = 20) {
    const close = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    app = createApp(ContextMenu, { items, x, y, onClose: close });
    app.mount(host);
    await nextTick();
    await nextTick();
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    return { menu, close, buttons: Array.from(menu.querySelectorAll('button')) };
  }
  function key(element: HTMLElement, value: string) {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  }
  it('focuses enabled commands and navigates without selecting separators or disabled commands', async () => {
    const action = vi.fn();
    const { menu, buttons, close } = await mount([
      { label: 'disabled', disabled: true, action },
      { label: 'first', action },
      { label: 'last', separator: true, action },
    ]);
    expect(document.activeElement).toBe(buttons[1]);
    expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(1);
    key(menu, 'ArrowUp');
    expect(document.activeElement).toBe(buttons[2]);
    key(menu, 'ArrowDown');
    expect(document.activeElement).toBe(buttons[1]);
    key(menu, 'End');
    expect(document.activeElement).toBe(buttons[2]);
    key(menu, 'Home');
    expect(document.activeElement).toBe(buttons[1]);
    buttons[0].click();
    expect(action).not.toHaveBeenCalled();
    buttons[1].click();
    expect(action).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    buttons[2].click();
    expect(action).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(2);
  });
  it('closes for Escape, Tab, outside clicks, outside scroll and resize but retains internal scroll', async () => {
    const { menu, close } = await mount([{ label: 'copy', action: vi.fn() }]);
    menu.dispatchEvent(new Event('scroll'));
    menu.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(close).not.toHaveBeenCalled();
    key(menu, 'Escape');
    key(menu, 'Tab');
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    expect(close).toHaveBeenCalledTimes(5);
  });
  it('fits measured dimensions within window boundaries and restores keyboard focus', async () => {
    const previous = document.createElement('input');
    document.body.append(previous);
    previous.focus();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 180, height: 120, top: 0, left: 0, bottom: 120, right: 180, x: 0, y: 0, toJSON: () => ({}),
    });
    const { menu } = await mount([{ label: 'copy', action: vi.fn() }], window.innerWidth, window.innerHeight);
    expect(menu.style.left).toBe(`${window.innerWidth - 184}px`);
    expect(menu.style.top).toBe(`${window.innerHeight - 124}px`);
    app?.unmount();
    app = null;
    expect(document.activeElement).toBe(previous);
    window.dispatchEvent(new Event('resize'));
  });
});
