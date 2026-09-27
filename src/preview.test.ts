// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { renderMarkdown, markdownBlocks, markdownHeadings, editableCodeFence, diagramDefinition } from './preview';
test('renders markdown without executing HTML or loading network images', () => {
  const result = renderMarkdown('# Hello\n<script>alert(1)</script>\n![x](https://example.com/tracking.gif)\n[x](javascript:alert(1))');
  expect(result).toContain('<h1 data-source-start="1" data-source-end="1">Hello</h1>');
  expect(result).not.toMatch(/<(script|img|iframe)/);
  expect(result).not.toContain('href="javascript:');
});

test('maps headings and code blocks back to source lines', () => {
  const result = renderMarkdown('# Title\n\n```json\n{"ok": true}\n```');
  expect(result).toContain('data-source-start="1" data-source-end="1"');
  expect(result).toContain('data-source-start="3" data-source-end="5"');
});

test('extracts visible ATX and Setext headings, excluding fenced code', () => {
  expect(markdownHeadings('# **Bold** `code`\n\nSecond *heading*\n--------------\n\n```md\n# Hidden\n```')).toEqual([
    { title: 'Bold code', line: 1, level: 1 },
    { title: 'Second heading', line: 3, level: 2 },
  ]);
});

test('highlights declared code language without allowing HTML execution', () => {
  const result = renderMarkdown('```js\nconst value = "<script>";\n```');
  expect(result).toContain('hljs-keyword');
  expect(result).not.toContain('<script>');
});

test('finds a closed top-level code fence for formatting', () => {
  const text = '# Title\n\n```js\nconst x={a:1}\n```\n\n> ```js\n> nested\n> ```';
  expect(editableCodeFence(text, 4)).toEqual({ language: 'js', firstContentLine: 4, closingLine: 5 });
  expect(editableCodeFence(text, 8)).toBeNull();
  expect(editableCodeFence('```js\nconst x=1', 2)).toBeNull();
});

test('renders CommonMark and GFM blocks in live mode with the same safe HTML as preview', () => {
  const source = '# Heading\n\n- [x] **done**\n- [ ] [next](https://example.com)\n\n| Name | Value |\n| --- | --- |\n| a | `1` |\n\n> quote\n\n---\n\n![alt](https://example.com/a.png)';
  const blocks = markdownBlocks(source);
  const html = blocks.map(block => block.html).join('');
  expect(html).toContain('<h1');
  expect(html).toContain('type="checkbox"');
  expect(html).toContain('checked=""');
  expect(html).toContain('href="https://example.com"');
  expect(html).toContain('<table');
  expect(html).toContain('<blockquote');
  expect(html).toContain('<hr');
  expect(html).toContain('[图片：alt]');
  expect(html).not.toContain('<img');
  expect(blocks.find(block => block.html.includes('<table'))).toMatchObject({ startLine: 6, endLine: 8 });
});

test('treats mermaid and flowchart fences as diagrams while keeping unsafe HTML escaped', () => {
  const source = '```mermaid\nsequenceDiagram\nA->>B: Hello\n```\n\n```flowchart\nLR\nA-->B\n```\n\n```flow\nst=>start: Start\ne=>end: End\nst->e\n```\n\n<script>alert(1)</script>';
  const blocks = markdownBlocks(source);
  expect(blocks[0].diagram).toEqual({ kind: 'mermaid', code: 'sequenceDiagram\nA->>B: Hello\n' });
  expect(blocks[1].diagram).toEqual({ kind: 'flowchart', code: 'LR\nA-->B\n' });
  expect(blocks[2].diagram).toEqual({ kind: 'flow', code: 'st=>start: Start\ne=>end: End\nst->e\n' });
  expect(diagramDefinition('flow', blocks[2].diagram!.code)).toBe(blocks[2].diagram!.code);
  expect(diagramDefinition('flowchart', blocks[1].diagram!.code)).toBe('flowchart LR\nA-->B\n');
  expect(blocks[0].html).toContain('diagram-preview');
  expect(blocks.at(-1)!.html).not.toContain('<script>');
});

test('renders footnotes and inline/display math in both Markdown views', () => {
  const source = 'A note[^a] with $x^2$.\n\n[^a]: Footnote **text**.\n\n$$\n\\frac{a}{b}\n$$';
  const blocks = markdownBlocks(source);
  const html = blocks.map(block => block.html).join('');
  expect(html).toContain('class="katex"');
  expect(html).toContain('katex-display');
  expect(html).toContain('class="footnotes"');
  expect(html).toContain('Footnote <strong>text</strong>');
  expect(blocks.find(block => block.html.includes('class="footnotes"'))).toMatchObject({ startLine: 3, endLine: 3 });
  expect(renderMarkdown(source)).toContain('katex-display');
});

test('maps separated footnote definitions without covering the paragraph between them', () => {
  const blocks = markdownBlocks('Refs[^a] and [^b].\n\n[^a]: First.\n\nMiddle paragraph.\n\n[^b]: Second.');
  expect(blocks.filter(block => block.html.includes('class="footnotes"')).map(block => block.startLine)).toEqual([3, 7]);
  expect(blocks.find(block => block.html.includes('Middle paragraph'))).toMatchObject({ startLine: 5, endLine: 5 });
});
