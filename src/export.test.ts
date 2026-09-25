import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { exportMarkdown, parseExport } from './export';

describe('Markdown export model', () => {
  it('keeps structure and inline emphasis without executing raw HTML', () => {
    const blocks = parseExport('# 标题\n\n正文 **重点** 与 [链接](https://example.com)\n\n- 第一项\n- 第二项\n\n| 名称 | 值 |\n| --- | --- |\n| 甲 | 1 |\n\n<script>alert(1)</script>');
    expect(blocks[0]).toMatchObject({ kind: 'text', heading: 1, runs: [{ text: '标题' }] });
    expect(blocks[1]).toMatchObject({ kind: 'text', runs: expect.arrayContaining([{ text: '重点', bold: true, italics: false, code: false }]) });
    expect(blocks.flatMap(block => block.kind === 'text' && block.list ? [block.list] : [])).toEqual(['• ', '• ']);
    expect(blocks.find(block => block.kind === 'table')).toMatchObject({ kind: 'table', rows: [[[{ text: '名称' }], [{ text: '值' }]], [[{ text: '甲' }], [{ text: '1' }]]] });
    expect(JSON.stringify(blocks)).toContain('<script>');
  });
});

describe('generated files', () => {
  const sample = '# 中文标题\n\n**重点** 和正文\n\n| 名称 | 值 |\n| --- | --- |\n| 甲 | 1 |';
  it('creates a Word document', async () => {
    const bytes = await exportMarkdown(sample, 'docx');
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect((await exportMarkdown('', 'docx')).length).toBeGreaterThan(0);
  });
  it('creates a PDF with a bundled Chinese font', async () => {
    const font = readFileSync(new URL('./assets/NotoSansSC.ttf', import.meta.url));
    vi.stubGlobal('fetch', async () => new Response(font));
    try {
      const bytes = await exportMarkdown(sample, 'pdf');
      expect(new TextDecoder().decode(bytes.slice(0, 8))).toMatch(/^%PDF-/);
      expect((await exportMarkdown('', 'pdf')).length).toBeGreaterThan(0);
    } finally { vi.unstubAllGlobals(); }
  }, 30000);
});
