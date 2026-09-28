// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import AppDialog from './AppDialog.vue';

let app: App | undefined;
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.replaceChildren();
});

describe('dialog keyboard lifecycle', () => {
  it('cycles through enabled controls and restores the opening focus', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const root = document.createElement('div');
    document.body.append(root);
    app = createApp({
      render: () =>
        h(AppDialog, { title: '测试', header: false }, () => [
          h('button', { id: 'first' }, '第一项'),
          h('button', { disabled: true }, '不可用'),
          h('button', { id: 'last' }, '最后一项'),
        ]),
    });
    app.mount(root);
    await nextTick();
    const first = root.querySelector<HTMLButtonElement>('#first')!;
    const last = root.querySelector<HTMLButtonElement>('#last')!;
    expect(document.activeElement).toBe(first);
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(last);
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(first);
    app.unmount();
    app = undefined;
    expect(document.activeElement).toBe(opener);
  });

  it('does not cancel an operation while the dialog is busy', async () => {
    let closed = 0;
    const root = document.createElement('div');
    document.body.append(root);
    app = createApp({
      render: () => h(AppDialog, { title: '保存', busy: true, header: false, onClose: () => closed++ }),
    });
    app.mount(root);
    await nextTick();
    root
      .querySelector('[role="dialog"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    root.querySelector<HTMLElement>('.modal-backdrop')!.click();
    expect(closed).toBe(0);
  });
});
