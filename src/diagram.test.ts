// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hydrateDiagrams, renderDiagramInto } from './diagram';

const { initialize, render } = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock('mermaid', () => ({ default: { initialize, render } }));

let app: HTMLDivElement;
beforeEach(() => {
  initialize.mockReset();
  render.mockReset().mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>diagram</text></svg>' });
  app = document.createElement('div');
  app.className = 'app';
  document.body.append(app);
});
afterEach(() => {
  app.remove();
});

function host() {
  const element = document.createElement('div');
  app.append(element);
  return element;
}

it('renders with the owning application theme tokens', async () => {
  app.style.cssText = '--text:#112233;--border:#223344;--code-bg:#334455;--accent:#445566;--bg:#556677';
  const element = host();
  await renderDiagramInto(element, 'mermaid', 'graph TD; A-->B', false);
  expect(initialize).toHaveBeenCalledWith(
    expect.objectContaining({
      themeVariables: {
        primaryColor: '#334455',
        primaryTextColor: '#112233',
        primaryBorderColor: '#445566',
        lineColor: '#445566',
        background: '#556677',
      },
    }),
  );
  expect(element.querySelector('svg')).not.toBeNull();
});

it('skips a removed queued diagram and continues rendering the current document', async () => {
  let finish!: (value: { svg: string }) => void;
  let started!: () => void;
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  render.mockImplementationOnce(() => {
    started();
    return new Promise<{ svg: string }>((resolve) => {
      finish = resolve;
    });
  });
  const first = host();
  const firstTask = renderDiagramInto(first, 'mermaid', 'first', false);
  await running;
  const stale = host();
  const staleTask = renderDiagramInto(stale, 'mermaid', 'stale', false);
  stale.remove();
  first.remove();
  const current = host();
  const currentTask = renderDiagramInto(current, 'mermaid', 'current', false);
  finish({ svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' });
  await Promise.all([firstTask, staleTask, currentTask]);
  expect(render.mock.calls.map((call) => call[1])).toEqual(['first', 'current']);
  expect(first.querySelector('svg')).toBeNull();
  expect(current.querySelector('svg')).not.toBeNull();
});

function previewHost() {
  const element = host();
  element.className = 'diagram-preview';
  element.dataset.diagramKind = 'mermaid';
  element.innerHTML = '<pre class="diagram-source">graph TD; A--&gt;B</pre>';
  return element;
}

it('recolors an existing preview on theme changes using its cached source', async () => {
  const element = previewHost();
  app.style.setProperty('--text', '#112233');
  render.mockImplementation(async () => ({
    svg: `<svg xmlns="http://www.w3.org/2000/svg"><text fill="${initialize.mock.lastCall?.[0].themeVariables.primaryTextColor}">diagram</text></svg>`,
  }));
  await hydrateDiagrams(app, false);
  expect(element.querySelector('text')?.getAttribute('fill')).toBe('#112233');
  expect(element.querySelector('.diagram-source')).toBeNull();
  app.classList.add('dark');
  app.style.setProperty('--text', '#ddeeff');
  await hydrateDiagrams(app, true);
  expect(element.querySelector('text')?.getAttribute('fill')).toBe('#ddeeff');
  expect(render.mock.calls.map((call) => call[1])).toEqual(['graph TD; A-->B', 'graph TD; A-->B']);
  await hydrateDiagrams(app, true);
  expect(render).toHaveBeenCalledTimes(2);
});

it('discards in-flight and queued old themes before applying the latest request', async () => {
  const element = previewHost();
  let finishOld!: (value: { svg: string }) => void;
  let finishCurrent!: (value: { svg: string }) => void;
  render
    .mockImplementationOnce(
      () =>
        new Promise<{ svg: string }>((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise<{ svg: string }>((resolve) => {
          finishCurrent = resolve;
        }),
    );
  const original = hydrateDiagrams(app, false);
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
  const firstChange = hydrateDiagrams(app, true);
  const secondChange = hydrateDiagrams(app, false);
  app.style.setProperty('--text', '#abcdef');
  const latest = hydrateDiagrams(app, true);
  finishOld({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>old</text></svg>' });
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
  expect(element.querySelector('svg')).toBeNull();
  expect(initialize.mock.lastCall?.[0].themeVariables.primaryTextColor).toBe('#abcdef');
  finishCurrent({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>current</text></svg>' });
  await Promise.all([original, firstChange, secondChange, latest]);
  expect(element.querySelector('text')?.textContent).toBe('current');
  expect(render).toHaveBeenCalledTimes(2);
});
