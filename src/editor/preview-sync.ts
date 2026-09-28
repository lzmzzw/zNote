import type { EditorView } from '@codemirror/view';

export function createPreviewSync(getEditor: () => EditorView | undefined, getPreview: () => HTMLElement | undefined) {
  let pendingSourceScroll: number | null = null;
  let pendingPreviewScroll: number | null = null;
  let cachedScrollAnchors: { source: number; preview: number }[] | null = null;
  function scrollAnchors() {
    const view = getEditor();
    const previewHost = getPreview();
    if (!view || !previewHost) return [{ source: 0, preview: 0 }];
    const sourceMax = Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight);
    const previewMax = Math.max(0, previewHost.scrollHeight - previewHost.clientHeight);
    if (cachedScrollAnchors?.at(-1)?.source === sourceMax && cachedScrollAnchors.at(-1)?.preview === previewMax)
      return cachedScrollAnchors;
    const previewRect = previewHost.getBoundingClientRect();
    const anchors = [{ source: 0, preview: 0 }];
    for (const item of previewHost.querySelectorAll<HTMLElement>('[data-source-start]')) {
      const line = Math.min(view.state.doc.lines, Number(item.dataset.sourceStart));
      const source = view.lineBlockAt(view.state.doc.line(line).from).top;
      const preview = item.getBoundingClientRect().top - previewRect.top + previewHost.scrollTop;
      const last = anchors[anchors.length - 1];
      if (source > last.source && preview > last.preview && source < sourceMax && preview < previewMax)
        anchors.push({ source, preview });
    }
    anchors.push({ source: sourceMax, preview: previewMax });
    cachedScrollAnchors = anchors;
    return cachedScrollAnchors;
  }
  function mapScroll(value: number, from: 'source' | 'preview') {
    const to = from === 'source' ? 'preview' : 'source';
    const anchors = scrollAnchors();
    for (let index = 1; index < anchors.length; index++) {
      const before = anchors[index - 1];
      const after = anchors[index];
      if (value <= after[from] || index === anchors.length - 1) {
        const span = after[from] - before[from];
        return before[to] + (span ? (value - before[from]) / span : 0) * (after[to] - before[to]);
      }
    }
    return 0;
  }
  function sourceToPreview() {
    const view = getEditor();
    const previewHost = getPreview();
    if (!view || !previewHost) return;
    if (pendingSourceScroll !== null && Math.abs(view.scrollDOM.scrollTop - pendingSourceScroll) < 1) {
      pendingSourceScroll = null;
      return;
    }
    pendingSourceScroll = null;
    previewHost.scrollTop = mapScroll(view.scrollDOM.scrollTop, 'source');
    pendingPreviewScroll = previewHost.scrollTop;
  }
  function previewToSource() {
    const view = getEditor();
    const previewHost = getPreview();
    if (!view || !previewHost) return;
    if (pendingPreviewScroll !== null && Math.abs(previewHost.scrollTop - pendingPreviewScroll) < 1) {
      pendingPreviewScroll = null;
      return;
    }
    pendingPreviewScroll = null;
    view.scrollDOM.scrollTop = mapScroll(previewHost.scrollTop, 'preview');
    pendingSourceScroll = view.scrollDOM.scrollTop;
  }
  function highlight() {
    const view = getEditor();
    const previewHost = getPreview();
    if (!view || !previewHost) return;
    const position = view.state.selection.main.head;
    const line = view.state.doc.lineAt(view.state.selection.main.head).number;
    previewHost.querySelector('.preview-selected')?.classList.remove('preview-selected');
    const distance = (item: HTMLElement) => {
      if (item.dataset.sourceFrom !== undefined) {
        const from = Number(item.dataset.sourceFrom);
        const to = Number(item.dataset.sourceTo);
        return position < from ? from - position : position >= to ? position - to + 1 : 0;
      }
      const start = Number(item.dataset.sourceStart);
      const end = Number(item.dataset.sourceEnd ?? start);
      return line < start ? start - line : line > end ? line - end : 0;
    };
    let selected: HTMLElement | null = null;
    let bestDistance = Infinity;
    let bestSpan = Infinity;
    for (const item of previewHost.querySelectorAll<HTMLElement>('[data-source-start]')) {
      const itemDistance = distance(item);
      const span =
        Number(item.dataset.sourceTo ?? item.dataset.sourceEnd ?? item.dataset.sourceStart) -
        Number(item.dataset.sourceFrom ?? item.dataset.sourceStart);
      if (itemDistance < bestDistance || (itemDistance === bestDistance && span < bestSpan)) {
        selected = item;
        bestDistance = itemDistance;
        bestSpan = span;
      }
    }
    selected?.classList.add('preview-selected');
  }

  function reset() {
    cachedScrollAnchors = null;
    pendingSourceScroll = null;
    pendingPreviewScroll = null;
  }
  return {
    reset,
    invalidate: () => {
      cachedScrollAnchors = null;
    },
    sourceToPreview,
    previewToSource,
    highlight,
  };
}
