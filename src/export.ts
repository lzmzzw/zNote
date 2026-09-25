import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx';
import fontUrl from './assets/NotoSansSC.ttf?url';

export type ExportFormat = 'docx' | 'pdf';
type Run = { text: string; bold?: boolean; italics?: boolean; code?: boolean };
type Block = { kind: 'text'; runs: Run[]; heading?: number; quote?: boolean; list?: string; code?: boolean }
  | { kind: 'table'; rows: Run[][][] };
const markdown = new MarkdownIt({ html: false, linkify: false, breaks: true });

function inline(tokens: Token[] = []): Run[] {
  const runs: Run[] = [];
  let bold = 0; let italics = 0; let link = '';
  for (const token of tokens) {
    if (token.type === 'strong_open') bold++;
    else if (token.type === 'strong_close') bold--;
    else if (token.type === 'em_open') italics++;
    else if (token.type === 'em_close') italics--;
    else if (token.type === 'link_open') link = token.attrGet('href') ?? '';
    else if (token.type === 'link_close') { if (link) runs.push({ text: ` (${link})` }); link = ''; }
    else if (token.type === 'text' || token.type === 'code_inline' || token.type === 'image' || token.type === 'html_inline') {
      runs.push({ text: token.type === 'image' ? `[图片：${token.content}]` : token.content, bold: bold > 0, italics: italics > 0, code: token.type === 'code_inline' });
    } else if (token.type === 'softbreak' || token.type === 'hardbreak') runs.push({ text: '\n' });
  }
  return runs;
}

export function parseExport(text: string): Block[] {
  const tokens = markdown.parse(text, {});
  const blocks: Block[] = [];
  const lists: { ordered: boolean; number: number }[] = [];
  let quote = 0; let heading = 0; let list = ''; let table: Run[][][] | undefined; let row: Run[][] | undefined;
  for (const token of tokens) {
    switch (token.type) {
      case 'heading_open': heading = Number(token.tag.slice(1)); break;
      case 'heading_close': heading = 0; break;
      case 'blockquote_open': quote++; break;
      case 'blockquote_close': quote--; break;
      case 'bullet_list_open': lists.push({ ordered: false, number: 0 }); break;
      case 'ordered_list_open': lists.push({ ordered: true, number: Number(token.attrGet('start') ?? 1) - 1 }); break;
      case 'bullet_list_close': case 'ordered_list_close': lists.pop(); break;
      case 'list_item_open': {
        const current = lists.at(-1)!; current.number++;
        list = `${'  '.repeat(lists.length - 1)}${current.ordered ? `${current.number}.` : '•'} `;
        break;
      }
      case 'list_item_close': list = ''; break;
      case 'table_open': table = []; break;
      case 'tr_open': row = []; break;
      case 'tr_close': table?.push(row ?? []); row = undefined; break;
      case 'table_close': if (table?.length) blocks.push({ kind: 'table', rows: table }); table = undefined; break;
      case 'inline':
        if (row) row.push(inline(token.children ?? []));
        else blocks.push({ kind: 'text', runs: inline(token.children ?? []), heading: heading || undefined, quote: quote > 0, list: list || undefined });
        break;
      case 'fence': case 'code_block':
        blocks.push({ kind: 'text', runs: [{ text: token.content.replace(/\n$/, '') }], code: true });
        break;
      case 'html_block': blocks.push({ kind: 'text', runs: [{ text: token.content.trimEnd() }], code: true }); break;
      case 'hr': blocks.push({ kind: 'text', runs: [{ text: '────────────────────────' }] }); break;
    }
  }
  return blocks;
}

function wordRuns(runs: Run[]) {
  return runs.map(run => new TextRun({ text: run.text, bold: run.bold, italics: run.italics, font: run.code ? 'Consolas' : 'Microsoft YaHei' }));
}

async function makeDocx(blocks: Block[]): Promise<Uint8Array> {
  const children = blocks.map(block => {
    if (block.kind === 'table') return new Table({ rows: block.rows.map(row => new TableRow({ children: row.map(cell => new TableCell({ children: [new Paragraph({ children: wordRuns(cell) })] })) })) });
    return new Paragraph({
      heading: block.heading ? [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][block.heading - 1] : undefined,
      children: [new TextRun({ text: `${block.list ?? ''}${block.quote ? '│ ' : ''}` }), ...wordRuns(block.runs)],
      spacing: { after: block.code ? 80 : 160 },
    });
  });
  const blob = await Packer.toBlob(new Document({ sections: [{ children }] }));
  return new Uint8Array(await blob.arrayBuffer());
}

type PdfMake = { createPdf: (definition: object, layouts?: unknown, fonts?: object, vfs?: object) => { getBuffer: (callback: (buffer: Uint8Array) => void) => void } };
let fontBase64: string | undefined;
async function pdfFont(): Promise<string> {
  if (fontBase64) return fontBase64;
  const response = await fetch(fontUrl);
  if (!response.ok) throw new Error('PDF 字体加载失败');
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  fontBase64 = btoa(binary);
  return fontBase64;
}

async function makePdf(blocks: Block[]): Promise<Uint8Array> {
  const [{ default: pdfMake }, font] = await Promise.all([import('pdfmake/build/pdfmake'), pdfFont()]);
  const content = blocks.map(block => {
    if (block.kind === 'table') return { table: { headerRows: 1, widths: Array(block.rows[0]?.length ?? 0).fill('*'), body: block.rows.map(row => row.map(cell => ({ text: cell.map(run => ({ text: run.text, bold: run.bold, italics: run.italics })) }))) }, margin: [0, 4, 0, 12] };
    return { text: [{ text: `${block.list ?? ''}${block.quote ? '│ ' : ''}` }, ...block.runs.map(run => ({ text: run.text, bold: run.bold, italics: run.italics }))], fontSize: block.heading ? [20, 17, 14, 12, 11, 10][block.heading - 1] : 10.5, bold: !!block.heading, margin: [0, block.heading ? 12 : 3, 0, block.code ? 8 : 5], preserveLeadingSpaces: !!block.code };
  });
  return new Promise((resolve, reject) => {
    try {
      (pdfMake as PdfMake).createPdf({ content, pageSize: 'A4', pageMargins: [48, 50, 48, 50], defaultStyle: { font: 'NotoSansSC', lineHeight: 1.35 } }, undefined, { NotoSansSC: { normal: 'NotoSansSC.ttf', bold: 'NotoSansSC.ttf', italics: 'NotoSansSC.ttf', bolditalics: 'NotoSansSC.ttf' } }, { 'NotoSansSC.ttf': font }).getBuffer(resolve);
    } catch (error) { reject(error); }
  });
}

export async function exportMarkdown(text: string, format: ExportFormat): Promise<Uint8Array> {
  const blocks = parseExport(text);
  return format === 'docx' ? makeDocx(blocks) : makePdf(blocks);
}
