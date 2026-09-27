// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { renderMarkdown, markdownHeadings, editableCodeFence } from './preview';
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
