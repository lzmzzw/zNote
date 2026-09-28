import DOMPurify from 'dompurify';
import { diagramDefinition, type DiagramKind } from './preview';

let sequence = 0;
let renderQueue: Promise<void> = Promise.resolve();
interface DiagramRequest {
  kind: DiagramKind;
  code: string;
  dark: boolean;
  task: Promise<void>;
}
const requests = new WeakMap<HTMLElement, DiagramRequest>();

function diagramColors(host: HTMLElement, dark: boolean) {
  const app = host.closest('.app');
  const styles = app && typeof getComputedStyle === 'function' ? getComputedStyle(app) : undefined;
  // 无应用样式的测试宿主使用中性配色；实际主题由 CSS 统一拥有。
  const foreground = dark ? '#ffffff' : '#000000';
  const background = dark ? '#000000' : '#ffffff';
  const token = (name: string, fallback: string) => styles?.getPropertyValue(name).trim() || fallback;
  return {
    text: token('--text', foreground),
    fill: token('--code-bg', background),
    accent: token('--accent', foreground),
    background: token('--bg', background),
  };
}

export function renderDiagramInto(host: HTMLElement, kind: DiagramKind, code: string, dark: boolean): Promise<void> {
  const request: DiagramRequest = { kind, code, dark, task: Promise.resolve() };
  requests.set(host, request);
  const isCurrent = () => host.isConnected && requests.get(host) === request;
  host.classList.remove('diagram-error');
  if (code.length > 20_000) {
    host.classList.add('diagram-error');
    return Promise.resolve();
  }
  const task = renderQueue
    .catch(() => {})
    .then(async () => {
      if (!isCurrent()) return;
      const colors = diagramColors(host, dark);
      let svg: string;
      if (kind === 'flow') {
        const flowchart = (await import('flowchart.js')).default;
        if (!isCurrent()) return;
        const container = document.createElement('div');
        host.append(container);
        try {
          flowchart.parse(code).drawSVG(container, {
            'line-color': colors.accent,
            'element-color': colors.accent,
            'font-color': colors.text,
            fill: colors.fill,
          });
          svg = container.querySelector('svg')?.outerHTML ?? '';
        } finally {
          container.remove();
        }
      } else {
        const mermaid = (await import('mermaid')).default;
        if (!isCurrent()) return;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          htmlLabels: false,
          theme: 'base',
          themeVariables: {
            primaryColor: colors.fill,
            primaryTextColor: colors.text,
            primaryBorderColor: colors.accent,
            lineColor: colors.accent,
            background: colors.background,
          },
          layout: 'dagre',
          maxTextSize: 20_000,
          flowchart: { htmlLabels: false, useMaxWidth: true },
        });
        svg = (await mermaid.render(`znote-diagram-${++sequence}`, diagramDefinition(kind, code))).svg;
      }
      if (!isCurrent()) return;
      const clean = DOMPurify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ['foreignObject', 'image', 'script', 'a'],
        FORBID_ATTR: ['href', 'xlink:href'],
      });
      if (!clean.includes('<svg')) throw new Error('Diagram SVG was rejected');
      host.innerHTML = clean;
      host.classList.add('diagram-ready');
    })
    .catch(() => {
      if (isCurrent()) host.classList.add('diagram-error');
    });
  renderQueue = task;
  request.task = task;
  return task;
}

export function hydrateDiagrams(root: HTMLElement, dark: boolean) {
  const tasks: Promise<void>[] = [];
  for (const host of root.querySelectorAll<HTMLElement>('.diagram-preview')) {
    const kind = host.dataset.diagramKind;
    if (kind !== 'mermaid' && kind !== 'flowchart' && kind !== 'flow') continue;
    const previous = requests.get(host);
    const code = host.querySelector('.diagram-source')?.textContent ?? previous?.code ?? '';
    tasks.push(
      previous?.kind === kind && previous.code === code && previous.dark === dark
        ? previous.task
        : renderDiagramInto(host, kind, code, dark),
    );
  }
  return Promise.all(tasks);
}
