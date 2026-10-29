import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import {
  AlignmentType,
  BorderStyle,
  CarriageReturn,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Tab,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  UnderlineType,
  WidthType,
} from 'docx';
import type { INumberingOptions } from 'docx';
import fontUrl from './assets/NotoSansSC.ttf?url';

export type ExportFormat = 'docx' | 'pdf';
type Run = {
  text: string;
  bold?: boolean;
  italics?: boolean;
  code?: boolean;
  strike?: boolean;
  link?: string;
  linkTarget?: boolean;
};
type ListInfo = { id: number; ordered: boolean; start: number; depth: number };
type Context = { quote?: boolean; quoteDepth?: number; list?: string; listInfo?: ListInfo; listDepth?: number };
type Block =
  | ({ kind: 'text'; runs: Run[]; heading?: number; code?: boolean; rule?: boolean } & Context)
  | ({ kind: 'table'; rows: Run[][][]; alignments: ('left' | 'center' | 'right')[] } & Context);
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });

function inline(tokens: Token[] = []): Run[] {
  const runs: Run[] = [];
  let bold = 0;
  let italics = 0;
  let strike = 0;
  let link = '';
  for (const token of tokens) {
    if (token.type === 'strong_open') bold++;
    else if (token.type === 'strong_close') bold--;
    else if (token.type === 'em_open') italics++;
    else if (token.type === 'em_close') italics--;
    else if (token.type === 's_open') strike++;
    else if (token.type === 's_close') strike--;
    else if (token.type === 'link_open') link = token.attrGet('href') ?? '';
    // PDF retains the destination as text; Word uses a hyperlink relationship.
    else if (token.type === 'link_close') {
      if (link) runs.push({ text: ` (${link})`, linkTarget: true });
      link = '';
    } else if (
      token.type === 'text' ||
      token.type === 'code_inline' ||
      token.type === 'image' ||
      token.type === 'html_inline'
    ) {
      runs.push({
        text: token.type === 'image' ? `[图片：${token.content}]` : token.content,
        bold: bold > 0,
        italics: italics > 0,
        code: token.type === 'code_inline',
        ...(strike ? { strike: true } : {}),
        ...(link ? { link } : {}),
      });
    } else if (token.type === 'softbreak' || token.type === 'hardbreak')
      runs.push({ text: '\n', ...(link ? { link } : {}) });
  }
  return runs;
}

export function parseExport(text: string): Block[] {
  const tokens = markdown.parse(text, {});
  const blocks: Block[] = [];
  const lists: (ListInfo & { number: number })[] = [];
  const items: { marked: boolean }[] = [];
  let nextList = 0;
  let quote = 0;
  let heading = 0;
  let table: Run[][][] | undefined;
  let row: Run[][] | undefined;
  let tableContext: Context = {};
  let alignments: ('left' | 'center' | 'right')[] = [];
  const context = (): Context => {
    const current = lists.at(-1);
    const item = items.at(-1);
    const marker = current && item && !item.marked;
    if (marker) item.marked = true;
    return {
      quote: quote > 0,
      quoteDepth: quote,
      ...(current ? { listDepth: lists.length } : {}),
      ...(marker
        ? {
            list: `${'  '.repeat(lists.length - 1)}${current.ordered ? `${current.number}.` : '•'} `,
            listInfo: { ...current },
          }
        : {}),
    };
  };
  for (const token of tokens) {
    switch (token.type) {
      case 'heading_open':
        heading = Number(token.tag.slice(1));
        break;
      case 'heading_close':
        heading = 0;
        break;
      case 'blockquote_open':
        quote++;
        break;
      case 'blockquote_close':
        quote--;
        break;
      case 'bullet_list_open':
      case 'ordered_list_open': {
        const start = Number(token.attrGet('start') ?? 1);
        lists.push({
          id: nextList++,
          ordered: token.type === 'ordered_list_open',
          start,
          number: start - 1,
          depth: lists.length,
        });
        break;
      }
      case 'bullet_list_close':
      case 'ordered_list_close':
        lists.pop();
        break;
      case 'list_item_open':
        lists.at(-1)!.number++;
        items.push({ marked: false });
        break;
      case 'list_item_close':
        items.pop();
        break;
      case 'table_open':
        table = [];
        alignments = [];
        tableContext = context();
        break;
      case 'th_open':
      case 'td_open': {
        const alignment = token.attrGet('style')?.match(/text-align:(left|center|right)/)?.[1];
        if (table?.length === 0) alignments.push((alignment as 'left' | 'center' | 'right') ?? 'left');
        break;
      }
      case 'tr_open':
        row = [];
        break;
      case 'tr_close':
        table?.push(row ?? []);
        row = undefined;
        break;
      case 'table_close':
        if (table?.length) blocks.push({ kind: 'table', rows: table, alignments, ...tableContext });
        table = undefined;
        break;
      case 'inline':
        if (row) row.push(inline(token.children ?? []));
        else
          blocks.push({
            kind: 'text',
            runs: inline(token.children ?? []),
            heading: heading || undefined,
            ...context(),
          });
        break;
      case 'fence':
      case 'code_block':
        blocks.push({ kind: 'text', runs: [{ text: token.content.replace(/\n$/, '') }], code: true, ...context() });
        break;
      case 'html_block':
        blocks.push({ kind: 'text', runs: [{ text: token.content.trimEnd() }], code: true, ...context() });
        break;
      case 'hr':
        blocks.push({ kind: 'text', runs: [{ text: '────────────────────────' }], rule: true, ...context() });
        break;
    }
  }
  return blocks;
}

function wordRuns(runs: Run[], code = false, header = false): (TextRun | ExternalHyperlink)[] {
  return runs
    .filter((run) => !run.linkTarget)
    .map((run) => {
      const mono = code || run.code;
      // Literal newlines in w:t are not Word line breaks; tabs need w:tab too.
      const children = run.text
        .split(/(\n|\t)/)
        .map((part) => (part === '\n' ? new CarriageReturn() : part === '\t' ? new Tab() : part));
      const text = new TextRun({
        children,
        bold: run.bold || header || undefined,
        italics: run.italics,
        strike: run.strike,
        font: {
          ascii: mono ? 'Consolas' : 'Microsoft YaHei',
          hAnsi: mono ? 'Consolas' : 'Microsoft YaHei',
          eastAsia: 'Microsoft YaHei',
        },
        ...(mono ? { size: 19, shading: { type: ShadingType.CLEAR, fill: 'F3F4F6' }, noProof: true } : {}),
        ...(run.link ? { color: '0563C1', underline: { type: UnderlineType.SINGLE } } : {}),
      });
      return run.link ? new ExternalHyperlink({ link: run.link, children: [text] }) : text;
    });
}

async function makeDocx(blocks: Block[]): Promise<Uint8Array> {
  const numbering = new Map<number, ListInfo>();
  for (const block of blocks) if (block.listInfo) numbering.set(block.listInfo.id, block.listInfo);
  const config: INumberingOptions['config'] = [...numbering.values()].map((list) => ({
    reference: `list-${list.id}`,
    levels: [
      {
        level: 0,
        format: list.ordered ? LevelFormat.DECIMAL : LevelFormat.BULLET,
        text: list.ordered ? '%1.' : ['•', '◦', '▪'][list.depth % 3],
        start: list.start,
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: (list.depth + 1) * 420, hanging: 300 } } },
      },
    ],
  }));
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' };
  // A4, 20 mm side margins. Explicit grids keep wide cells within the page.
  const contentWidth = 9638;
  const children: (Paragraph | Table)[] = [];
  for (const block of blocks) {
    const left = Math.min((block.listDepth ?? 0) * 420 + (block.quoteDepth ?? 0) * 360, 3600);
    if (block.kind === 'table') {
      if (block.listInfo)
        children.push(new Paragraph({ numbering: { reference: `list-${block.listInfo.id}`, level: 0 } }));
      const width = contentWidth - left;
      const columns = block.rows[0].length;
      children.push(
        new Table({
          width: { size: width, type: WidthType.DXA },
          columnWidths: Array(columns).fill(Math.floor(width / columns)),
          layout: TableLayoutType.FIXED,
          indent: { size: left, type: WidthType.DXA },
          borders: {
            top: border,
            bottom: border,
            left: border,
            right: border,
            insideHorizontal: border,
            insideVertical: border,
          },
          margins: { top: 100, bottom: 100, left: 120, right: 120 },
          rows: block.rows.map(
            (row, index) =>
              new TableRow({
                tableHeader: index === 0,
                children: row.map(
                  (cell, column) =>
                    new TableCell({
                      width: { size: Math.floor(width / columns), type: WidthType.DXA },
                      ...(index === 0 ? { shading: { type: ShadingType.CLEAR, fill: 'E8EDF3' } } : {}),
                      children: [
                        new Paragraph({
                          alignment: block.alignments[column] ?? 'left',
                          children: wordRuns(cell, false, index === 0),
                          spacing: { after: 0, line: 276 },
                        }),
                      ],
                    }),
                ),
              }),
          ),
        }),
      );
      // Separate adjacent Markdown tables in Word and leave breathing room.
      children.push(new Paragraph({ spacing: { after: 100 }, children: [] }));
      continue;
    }
    children.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        heading: block.heading
          ? [
              HeadingLevel.HEADING_1,
              HeadingLevel.HEADING_2,
              HeadingLevel.HEADING_3,
              HeadingLevel.HEADING_4,
              HeadingLevel.HEADING_5,
              HeadingLevel.HEADING_6,
            ][block.heading - 1]
          : undefined,
        numbering: block.listInfo ? { reference: `list-${block.listInfo.id}`, level: 0 } : undefined,
        indent: {
          left: left + (block.code ? 160 : 0),
          right: block.code ? 160 : 0,
          ...(block.listInfo ? { hanging: 300 } : {}),
        },
        children: block.rule ? [] : wordRuns(block.runs, block.code),
        spacing: {
          before: block.heading ? 240 : block.code ? 100 : 0,
          after: block.code ? 120 : 160,
          line: block.code ? 260 : 320,
        },
        keepNext: !!block.heading,
        widowControl: true,
        ...(block.code
          ? {
              wordWrap: true,
              shading: { type: ShadingType.CLEAR, fill: 'F3F4F6' },
              tabStops: Array.from({ length: 20 }, (_, index) => ({
                type: 'left' as const,
                position: (index + 1) * 480,
              })),
            }
          : {}),
        ...(block.quote || block.rule
          ? {
              border: {
                ...(block.quote ? { left: { style: BorderStyle.SINGLE, size: 18, color: '94A3B8', space: 8 } } : {}),
                ...(block.rule ? { bottom: border } : {}),
              },
            }
          : {}),
      }),
    );
  }
  const document = new Document({
    styles: {
      default: {
        document: { run: { font: 'Microsoft YaHei', size: 22, color: '202124' } },
        ...Object.fromEntries(
          [36, 32, 28, 26, 24, 22].map((size, index) => [
            `heading${index + 1}`,
            {
              run: { size, bold: true, color: '000000' },
              paragraph: { keepNext: true },
            },
          ]),
        ),
      },
    },
    numbering: { config },
    sections: [
      {
        properties: {
          page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } },
        },
        children,
      },
    ],
  });
  const blob = await Packer.toBlob(document);
  return new Uint8Array(await blob.arrayBuffer());
}

type PdfMake = {
  createPdf: (
    definition: object,
    layouts?: unknown,
    fonts?: object,
    vfs?: object,
  ) => { getBuffer: (callback: (buffer: Uint8Array) => void) => void };
};
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
  const content = blocks.map((block) => {
    if (block.kind === 'table')
      return {
        table: {
          headerRows: 1,
          widths: Array(block.rows[0]?.length ?? 0).fill('*'),
          body: block.rows.map((row) =>
            row.map((cell) => ({
              text: cell.map((run) => ({ text: run.text, bold: run.bold, italics: run.italics })),
            })),
          ),
        },
        margin: [0, 4, 0, 12],
      };
    return {
      text: [
        { text: `${block.list ?? ''}${block.quote ? '│ ' : ''}` },
        ...block.runs.map((run) => ({ text: run.text, bold: run.bold, italics: run.italics })),
      ],
      fontSize: block.heading ? [20, 17, 14, 12, 11, 10][block.heading - 1] : 10.5,
      bold: !!block.heading,
      margin: [0, block.heading ? 12 : 3, 0, block.code ? 8 : 5],
      preserveLeadingSpaces: !!block.code,
    };
  });
  return new Promise((resolve, reject) => {
    try {
      (pdfMake as PdfMake)
        .createPdf(
          {
            content,
            pageSize: 'A4',
            pageMargins: [48, 50, 48, 50],
            defaultStyle: { font: 'NotoSansSC', lineHeight: 1.35 },
          },
          undefined,
          {
            NotoSansSC: {
              normal: 'NotoSansSC.ttf',
              bold: 'NotoSansSC.ttf',
              italics: 'NotoSansSC.ttf',
              bolditalics: 'NotoSansSC.ttf',
            },
          },
          { 'NotoSansSC.ttf': font },
        )
        .getBuffer(resolve);
    } catch (error) {
      reject(error);
    }
  });
}

export async function exportMarkdown(text: string, format: ExportFormat): Promise<Uint8Array> {
  const blocks = parseExport(text);
  return format === 'docx' ? makeDocx(blocks) : makePdf(blocks);
}
