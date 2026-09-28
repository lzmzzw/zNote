import { StateField, type EditorState, type Extension } from '@codemirror/state';
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
    element.addEventListener('mousedown', event => { if (event.button !== 0) return; event.preventDefault(); edit(event.target); });
    element.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); edit(); }
    });
    hydrateDiagrams(element, this.dark);
    return element;
  }

  ignoreEvent() { return true; }
}

interface LiveBlocks { blocks: MarkdownBlock[]; decorations: DecorationSet }

function decorate(state: EditorState, blocks: MarkdownBlock[], dark: boolean): DecorationSet {
  const startLine = state.doc.lineAt(state.selection.main.from).number;
  const endLine = state.doc.lineAt(state.selection.main.to).number;
  const ranges = [];
  for (const block of blocks) {
    if (block.endLine >= startLine && block.startLine <= endLine) {
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
      if (!transaction.docChanged && !transaction.selection) return value;
      const blocks = transaction.docChanged ? markdownBlocks(transaction.state.doc.toString()) : value.blocks;
      return { blocks, decorations: decorate(transaction.state, blocks, dark) };
    },
    provide: field => EditorView.decorations.from(field, value => value.decorations),
  });
  return field;
}
