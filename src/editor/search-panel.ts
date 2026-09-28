import { createVNode, render } from 'vue';
import type { EditorView } from '@codemirror/view';
import { ArrowUp, ArrowDown, X, Check } from 'lucide-vue-next';

export function resetSearchPanelPosition(editor: EditorView) {
  const panels = editor.dom.querySelector<HTMLElement>('.cm-panels-top');
  if (panels) {
    panels.classList.remove('znote-search-floating');
    panels.style.left = '';
    panels.style.top = '';
    panels.style.right = '';
  }
}
export function decorateSearchPanel(editor: EditorView) {
  const panel = editor.dom.querySelector<HTMLElement>('.cm-search');
  const panels = panel?.parentElement;
  if (!panel || !panels || panel.querySelector('.search-panel-header')) return;
  panels.classList.add('znote-search-floating');
  const item = (name: string) => panel.querySelector<HTMLElement>(`[name="${name}"]`)!;
  const button = (name: string) => panel.querySelector<HTMLButtonElement>(`button[name="${name}"]`)!;
  const icon = (button: HTMLElement, component: typeof ArrowUp, label: string) => {
    button.textContent = '';
    button.setAttribute('aria-label', label);
    button.title = label;
    render(createVNode(component, { size: 15, 'aria-hidden': true }), button);
  };
  const header = document.createElement('div');
  header.className = 'search-panel-header';
  header.title = '拖动查找与替换';
  const title = document.createElement('strong');
  title.textContent = '查找与替换';
  header.append(title);
  const close = item('close');
  icon(close, X, '关闭查找与替换');
  header.append(close);
  const findRow = document.createElement('div');
  findRow.className = 'search-panel-row';
  const searchField = item('search');
  findRow.append(searchField);
  const previous = item('prev');
  icon(previous, ArrowUp, '上一个');
  findRow.append(previous);
  const next = item('next');
  icon(next, ArrowDown, '下一个');
  findRow.append(next);
  const replaceRow = document.createElement('div');
  replaceRow.className = 'search-panel-row';
  replaceRow.append(button('replace'), button('replaceAll'));
  const replaceField = panel.querySelector<HTMLInputElement>('input[name="replace"]')!;
  replaceRow.prepend(replaceField);
  const options = document.createElement('div');
  options.className = 'search-panel-options';
  for (const checkbox of panel.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    const control = document.createElement('span');
    control.className = 'theme-checkbox';
    checkbox.replaceWith(control);
    control.append(checkbox);
    const mark = document.createElement('span');
    mark.className = 'checkbox-mark';
    render(createVNode(Check, { size: 13, 'aria-hidden': true }), mark);
    control.append(mark);
  }
  options.append(...panel.querySelectorAll('label'), item('select'));
  panel.replaceChildren(header, findRow, replaceRow, options);

  header.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    const container = editor.dom.getBoundingClientRect();
    const bounds = panels.getBoundingClientRect();
    const offsetX = event.clientX - bounds.left;
    const offsetY = event.clientY - bounds.top;
    header.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      panels.style.right = 'auto';
      panels.style.left = `${Math.max(0, Math.min(container.width - bounds.width, moveEvent.clientX - container.left - offsetX))}px`;
      panels.style.top = `${Math.max(0, Math.min(container.height - bounds.height, moveEvent.clientY - container.top - offsetY))}px`;
    };
    const stop = () => {
      header.removeEventListener('pointermove', move);
      header.removeEventListener('pointerup', stop);
      header.removeEventListener('pointercancel', stop);
    };
    header.addEventListener('pointermove', move);
    header.addEventListener('pointerup', stop);
    header.addEventListener('pointercancel', stop);
  });
}
