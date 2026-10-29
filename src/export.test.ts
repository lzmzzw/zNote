import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (xml: string, options: object) => { window: { document: XMLDocument } };
};
import { describe, expect, it, vi } from 'vitest';
import { exportMarkdown, parseExport } from './export';

describe('Markdown export model', () => {
  it('keeps structure and inline emphasis without executing raw HTML', () => {
    const blocks = parseExport(
      '# 标题\n\n正文 **重点** 与 [链接](https://example.com)\n\n- 第一项\n- 第二项\n\n| 名称 | 值 |\n| --- | --- |\n| 甲 | 1 |\n\n<script>alert(1)</script>',
    );
    expect(blocks[0]).toMatchObject({ kind: 'text', heading: 1, runs: [{ text: '标题' }] });
    expect(blocks[1]).toMatchObject({
      kind: 'text',
      runs: expect.arrayContaining([{ text: '重点', bold: true, italics: false, code: false }]),
    });
    expect(blocks.flatMap((block) => (block.kind === 'text' && block.list ? [block.list] : []))).toEqual(['• ', '• ']);
    expect(blocks.find((block) => block.kind === 'table')).toMatchObject({
      kind: 'table',
      rows: [
        [[{ text: '名称' }], [{ text: '值' }]],
        [[{ text: '甲' }], [{ text: '1' }]],
      ],
    });
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
    } finally {
      vi.unstubAllGlobals();
    }
  }, 30000);
});

// Read real packaged output rather than mocking docx constructors.
function wordPart(bytes: Uint8Array, name: string): string {
  const zip = Buffer.from(bytes);
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let offset = zip.readUInt32LE(end + 16);
  for (let count = zip.readUInt16LE(end + 10); count > 0; count--) {
    const length = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    if (zip.subarray(offset + 46, offset + 46 + nameLength).toString() === name) {
      const local = zip.readUInt32LE(offset + 42);
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + length);
      return (zip.readUInt16LE(offset + 10) === 8 ? inflateRawSync(data) : data).toString();
    }
    offset += 46 + nameLength + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32);
  }
  throw new Error(`Missing DOCX part: ${name}`);
}
function xmlDocument(xml: string): XMLDocument {
  return new JSDOM(xml, { contentType: 'application/xml', url: 'https://znote.test/' }).window.document;
}
function tags(node: Document | Element, name: string): Element[] {
  return Array.from(node.getElementsByTagName(`w:${name}`));
}

describe('Word formatting fidelity', () => {
  it('preserves code whitespace as Word breaks and tabs with a monospace block style', async () => {
    const code = 'function demo() {\n\tconst 中文 = 1;\n\n    return 中文;\n}';
    const doc = xmlDocument(wordPart(await exportMarkdown('```js\n' + code + '\n```', 'docx'), 'word/document.xml'));
    const paragraph = tags(doc, 'p').find((p) => p.textContent?.includes('function demo'))!;
    expect(tags(paragraph, 'cr')).toHaveLength(4);
    expect(tags(paragraph, 'tab').filter((t) => !t.hasAttribute('w:val'))).toHaveLength(1);
    expect(
      tags(paragraph, 't').some(
        (t) => t.textContent === '    return 中文;' && t.getAttribute('xml:space') === 'preserve',
      ),
    ).toBe(true);
    expect(tags(paragraph, 'rFonts')[0].getAttribute('w:ascii')).toBe('Consolas');
    expect(tags(paragraph, 'rFonts')[0].getAttribute('w:eastAsia')).toBe('Microsoft YaHei');
    expect(tags(paragraph, 'shd')[0].getAttribute('w:fill')).toBe('F3F4F6');
    expect(tags(paragraph, 'wordWrap')).toHaveLength(1);
    expect(tags(paragraph, 'jc')[0].getAttribute('w:val')).toBe('left');
    expect(tags(paragraph, 'r').every((r) => tags(r, 'r').length === 0)).toBe(true);
  });

  it('exports editable tables with a page-bounded grid, repeating headers, alignment and inline formatting', async () => {
    const source =
      '| 名称 | 居中 | 数值 |\n| :--- | :---: | ---: |\n| **重点** | `code` | ~~旧值~~ |\n| [链接](https://example.com) | 中文 | 100 |';
    const doc = xmlDocument(wordPart(await exportMarkdown(source, 'docx'), 'word/document.xml'));
    const table = tags(doc, 'tbl')[0];
    expect(tags(table, 'tr')).toHaveLength(3);
    expect(tags(table, 'tc')).toHaveLength(9);
    expect(tags(table, 'tblLayout')[0].getAttribute('w:type')).toBe('fixed');
    expect(
      tags(table, 'gridCol').reduce((sum, column) => sum + Number(column.getAttribute('w:w')), 0),
    ).toBeLessThanOrEqual(9638);
    const header = tags(table, 'tr')[0];
    expect(tags(header, 'tblHeader')).toHaveLength(1);
    expect(tags(header, 'shd').every((shading) => shading.getAttribute('w:fill') === 'E8EDF3')).toBe(true);
    expect(tags(header, 'b')).toHaveLength(3);
    expect(tags(header, 'jc').map((alignment) => alignment.getAttribute('w:val'))).toEqual(['left', 'center', 'right']);
    expect(tags(table, 'tblBorders')).toHaveLength(1);
    expect(tags(table, 'hyperlink')).toHaveLength(1);
    expect(tags(table, 'strike')).toHaveLength(1);
    expect(tags(table, 'rFonts').some((font) => font.getAttribute('w:ascii') === 'Consolas')).toBe(true);
  });

  it('keeps nested and restarted list numbering and avoids numbering continuation paragraphs', async () => {
    const source = '3. 父项\n\n   续段\n\n   - 子项\n\n   返回父项\n\n4. 下一项\n\n---\n\n1. 重启';
    const blocks = parseExport(source).filter((block) => block.kind === 'text');
    expect(blocks.map((block) => block.list)).toEqual(['3. ', undefined, '  • ', undefined, '4. ', undefined, '1. ']);
    expect(blocks[3].listDepth).toBe(1);
    const bytes = await exportMarkdown(source, 'docx');
    const doc = xmlDocument(wordPart(bytes, 'word/document.xml'));
    const paragraphs = tags(doc, 'p');
    const numId = (label: string) =>
      tags(
        paragraphs.find((p) => p.textContent === label)!,
        'numId',
      )[0]?.getAttribute('w:val');
    expect(numId('父项')).toBe(numId('下一项'));
    expect(numId('子项')).not.toBe(numId('父项'));
    expect(numId('重启')).not.toBe(numId('父项'));
    expect(numId('续段')).toBeUndefined();
    expect(
      tags(
        paragraphs.find((p) => p.textContent === '返回父项')!,
        'ind',
      )[0].getAttribute('w:left'),
    ).toBe('420');
    const numbering = xmlDocument(wordPart(bytes, 'word/numbering.xml'));
    expect(tags(numbering, 'start').some((start) => start.getAttribute('w:val') === '3')).toBe(true);
  });

  it('preserves heading levels, emphasis, quote borders, rules and clickable links safely', async () => {
    const source =
      '# 标题\n\n正文 **粗体** *斜体* ~~删除~~ `inline` [链接](https://example.com/a?x=1&y=2)\n换行\n\n> 引用\n>\n> > 内层\n\n---\n\n<script>alert(1)</script>\n\n[危险](javascript:alert(1))\n\n![图片](https://example.com/private.png)';
    const bytes = await exportMarkdown(source, 'docx');
    const doc = xmlDocument(wordPart(bytes, 'word/document.xml'));
    expect(tags(doc, 'pStyle')[0].getAttribute('w:val')).toBe('Heading1');
    expect(tags(doc, 'b').length).toBeGreaterThan(0);
    expect(tags(doc, 'i').length).toBeGreaterThan(0);
    expect(tags(doc, 'strike')).toHaveLength(1);
    expect(tags(doc, 'cr')).toHaveLength(1);
    expect(tags(doc, 'pBdr')).toHaveLength(3);
    expect(tags(doc, 'hyperlink')).toHaveLength(1);
    expect(doc.documentElement.textContent).toContain('<script>alert(1)</script>');
    expect(doc.documentElement.textContent).toContain('[图片：图片]');
    expect(doc.documentElement.textContent).not.toContain(' (https://example.com/a');
    const relationships = wordPart(bytes, 'word/_rels/document.xml.rels');
    expect(relationships).toContain('https://example.com/a?x=1&amp;y=2');
    expect(relationships).not.toContain('javascript:');
    expect(relationships).not.toContain('private.png');
    const styles = xmlDocument(wordPart(bytes, 'word/styles.xml'));
    expect(
      tags(styles, 'style').filter((style) => /^Heading[1-6]$/.test(style.getAttribute('w:styleId') ?? '')),
    ).toHaveLength(6);
  });
});
