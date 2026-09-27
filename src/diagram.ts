import DOMPurify from 'dompurify';
import { diagramDefinition, type DiagramKind } from './preview';

let sequence = 0;
let renderQueue: Promise<void> = Promise.resolve();

export function renderDiagramInto(host: HTMLElement, kind: DiagramKind, code: string, dark: boolean): Promise<void> {
  if (code.length > 20_000) {
    host.classList.add('diagram-error');
    return Promise.resolve();
  }
  const task = renderQueue.catch(() => {}).then(async () => {
    let svg: string;
    if (kind === 'flow') {
      const flowchart = (await import('flowchart.js')).default;
      if (!host.isConnected) return;
      const container = document.createElement('div');
      host.append(container);
      try {
        flowchart.parse(code).drawSVG(container, {
          'line-color': dark ? '#a4abb1' : '#696662',
          'element-color': dark ? '#6dc1e7' : '#365d70',
          'font-color': dark ? '#b8bfc6' : '#1f0909',
          fill: dark ? '#303438' : '#eae8e2',
        });
        svg = container.querySelector('svg')?.outerHTML ?? '';
      } finally { container.remove(); }
    } else {
      const mermaid = (await import('mermaid')).default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        htmlLabels: false,
        theme: 'base',
        themeVariables: {
          primaryColor: dark ? '#435767' : '#d9e1e1',
          primaryTextColor: dark ? '#b8bfc6' : '#1f0909',
          primaryBorderColor: dark ? '#6dc1e7' : '#365d70',
          lineColor: dark ? '#a4abb1' : '#696662',
          background: dark ? '#303438' : '#f3f2ee',
        },
        layout: 'dagre',
        maxTextSize: 20_000,
        flowchart: { htmlLabels: false, useMaxWidth: true },
      });
      svg = (await mermaid.render(`znote-diagram-${++sequence}`, diagramDefinition(kind, code))).svg;
    }
    if (!host.isConnected) return;
    const clean = DOMPurify.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ['foreignObject', 'image', 'script', 'a'],
      FORBID_ATTR: ['href', 'xlink:href'],
    });
    if (!clean.includes('<svg')) throw new Error('Diagram SVG was rejected');
    host.innerHTML = clean;
    host.classList.add('diagram-ready');
  }).catch(() => {
    if (host.isConnected) host.classList.add('diagram-error');
  });
  renderQueue = task;
  return task;
}

export function hydrateDiagrams(root: HTMLElement, dark: boolean) {
  for (const host of root.querySelectorAll<HTMLElement>('.diagram-preview:not([data-rendering])')) {
    const kind = host.dataset.diagramKind;
    if (kind !== 'mermaid' && kind !== 'flowchart' && kind !== 'flow') continue;
    host.dataset.rendering = 'true';
    void renderDiagramInto(host, kind, host.querySelector('.diagram-source')?.textContent ?? '', dark);
  }
}
