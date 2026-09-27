import { syntaxTree } from '@codemirror/language';
import { Decoration, WidgetType, type DecorationSet, type EditorView } from '@codemirror/view';

class RuleWidget extends WidgetType {
  toDOM() {
    const rule = document.createElement('span');
    rule.className = 'live-rule';
    rule.setAttribute('aria-hidden', 'true');
    return rule;
  }
}

const ruleWidget = new RuleWidget();

export function liveMarkdownDecorations(view: Pick<EditorView, 'state' | 'visibleRanges'>): DecorationSet {
  const ranges = [];
  const doc = view.state.doc;
  const selection = view.state.selection.main;
  const selectedFrom = doc.lineAt(selection.from).from;
  const selectedTo = doc.lineAt(selection.to).to;
  const isEditing = (from: number, to: number) => from <= selectedTo && to >= selectedFrom;

  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = doc.lineAt(pos);
      const heading = /^(#{1,6})\s/.exec(line.text);
      if (heading) ranges.push(Decoration.line({ class: `live-heading live-h${heading[1].length}` }).range(line.from));
      if (/^\s{0,3}>/.test(line.text)) ranges.push(Decoration.line({ class: 'live-quote' }).range(line.from));
      pos = line.to + 1;
    }

    syntaxTree(view.state).iterate({ from, to, enter(node) {
      if (node.name === 'FencedCode') {
        const first = doc.lineAt(node.from);
        const last = doc.lineAt(node.to);
        const closed = last.from > first.from && /^\s{0,3}(`{3,}|~{3,})\s*$/.test(last.text);
        for (let number = first.number; number <= last.number; number++) {
          const line = doc.line(number);
          if (line.from < from || line.from > to) continue;
          const edge = number === first.number ? ' live-code-open' : closed && number === last.number ? ` live-code-close${isEditing(last.from, last.to) ? '' : ' live-code-hidden'}` : '';
          ranges.push(Decoration.line({ class: `live-code${edge}` }).range(line.from));
        }
        if (!isEditing(first.from, first.to)) {
          const language = first.text.replace(/^\s{0,3}(`{3,}|~{3,})/, '').trim();
          ranges.push(Decoration.line({ attributes: { 'data-language': language || '代码' } }).range(first.from));
          ranges.push(Decoration.replace({}).range(first.from, first.to));
        }
        if (closed && !isEditing(last.from, last.to)) ranges.push(Decoration.replace({}).range(last.from, last.to));
        return false;
      }
      if (node.name === 'HorizontalRule') {
        const line = doc.lineAt(node.from);
        if (!isEditing(line.from, line.to)) ranges.push(Decoration.replace({ widget: ruleWidget }).range(line.from, line.to));
        return false;
      }
      if (!['HeaderMark', 'EmphasisMark', 'QuoteMark'].includes(node.name) || isEditing(node.from, node.to)) return;
      let end = node.to;
      if ((node.name === 'HeaderMark' || node.name === 'QuoteMark') && doc.sliceString(end, end + 1) === ' ') end++;
      ranges.push(Decoration.replace({}).range(node.from, end));
    } });
  }
  return Decoration.set(ranges, true);
}
