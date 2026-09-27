// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { renderMarkdown } from './preview';
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
