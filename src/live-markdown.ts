import { EditorSelection, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { hydrateDiagrams } from './diagram';
import { markdownBlocks, type MarkdownBlock } from './preview';

class MarkdownBlockWidget extends WidgetType {
  constructor(readonly block: MarkdownBlock, readonly from: number, readonly dark: boolean) { super(); }

  eq(other: MarkdownBlockWidget) {
    return this.from === other.from && this.dark === other.dark && this.block.html === other.block.html;
  }

  toDOM(view: EditorView) {
    const element = document.createElement('div');
    element.className = 'preview live-rendered';
    element.dataset.blockStart = String(this.block.startLine);
    element.dataset.blockEnd = String(this.block.endLine);
    element.tabIndex = 0;
    element.setAttribute('role', 'button');
    element.setAttribute('aria-label', '编辑 Markdown 块');
    element.innerHTML = this.block.html;
    for (const link of element.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      link.title = link.getAttribute('href') ?? '';
      link.removeAttribute('href');
      link.tabIndex = -1;
    }
    const edit = (target?: EventTarget | null) => {
      const source = target instanceof Element ? target.closest<HTMLElement>('[data-source-start]') : null;
      const lineNumber = Number(source?.dataset.sourceStart);
      const anchor = Number.isInteger(lineNumber) && lineNumber >= this.block.startLine && lineNumber <= this.block.endLine
        ? view.state.doc.line(lineNumber).from : this.from;
      view.dispatch({ selection: { anchor }, scrollIntoView: true });
      view.focus();
    };
    element.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); edit(); }
    });
    hydrateDiagrams(element, this.dark);
    return element;
  }

  ignoreEvent(event: Event) { return event.type !== 'mousedown' || (event as MouseEvent).button !== 0; }
}

interface LiveBlocks { blocks: MarkdownBlock[]; decorations: DecorationSet }
const revealBlock = StateEffect.define<number>();

function decorate(state: EditorState, blocks: MarkdownBlock[], dark: boolean, revealedLine?: number): DecorationSet {
  const startLine = state.doc.lineAt(state.selection.main.from).number;
  const endLine = state.doc.lineAt(state.selection.main.to).number;
  const ranges = [];
  for (const block of blocks) {
    if (block.endLine >= startLine && block.startLine <= endLine || block.startLine === revealedLine) {
      const heading = /^<h([1-6])\b/.exec(block.html);
      if (heading) ranges.push(Decoration.line({ class: `live-heading live-h${heading[1]}` }).range(state.doc.line(block.startLine).from));
      continue;
    }
    const from = state.doc.line(block.startLine).from;
    const to = state.doc.line(block.endLine).to;
    ranges.push(Decoration.replace({ widget: new MarkdownBlockWidget(block, from, dark), block: true }).range(from, to));
  }
  return Decoration.set(ranges, true);
}

export function liveMarkdownBlocks(dark: boolean): Extension {
  const field = StateField.define<LiveBlocks>({
    create(state) {
      const blocks = markdownBlocks(state.doc.toString());
      return { blocks, decorations: decorate(state, blocks, dark) };
    },
    update(value, transaction) {
      const revealedLine = transaction.effects.find(effect => effect.is(revealBlock))?.value;
      if (!transaction.docChanged && !transaction.selection && revealedLine === undefined) return value;
      const blocks = transaction.docChanged ? markdownBlocks(transaction.state.doc.toString()) : value.blocks;
      return { blocks, decorations: decorate(transaction.state, blocks, dark, revealedLine) };
    },
    provide: field => EditorView.decorations.from(field, value => value.decorations),
  });
  return [field, EditorView.mouseSelectionStyle.of((view, event) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return null;
    const block = event.target.closest<HTMLElement>('.live-rendered');
    if (!block) return null;
    const source = event.target.closest<HTMLElement>('[data-source-start]') ?? block;
    const bounds = source.getBoundingClientRect();
    let from = view.state.doc.line(Number(source.dataset.sourceStart ?? block.dataset.blockStart)).from;
    let original = view.state.selection;
    // Keep pointer coordinates relative to the clicked text while rendering changes the block layout.
    view.dispatch({ effects: revealBlock.of(Number(block.dataset.blockStart)) });
    if (event.detail > 1) return null;
    const position = (pointer: MouseEvent) => {
      const line = view.coordsAtPos(from);
      return line ? view.posAtCoords({ x: pointer.clientX + line.left - bounds.left, y: pointer.clientY + line.top - bounds.top }) ?? from : from;
    };
    let anchor = position(event);
    return {
      get(pointer, extend, multiple) {
        const head = position(pointer);
        const range = extend ? original.main.extend(head) : EditorSelection.range(anchor, head);
        return multiple ? original.addRange(range) : EditorSelection.create([range]);
      },
      update(update) {
        from = update.changes.mapPos(from);
        anchor = update.changes.mapPos(anchor);
        original = original.map(update.changes);
      },
    };
  })];
}
