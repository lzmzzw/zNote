import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import footnote from 'markdown-it-footnote';
import math from 'markdown-it-math/no-default-renderer';
import katex from 'katex';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import sql from 'highlight.js/lib/languages/sql';
for (const [name, language] of Object.entries({ javascript, typescript, json, css, xml, python, bash, sql })) hljs.registerLanguage(name, language);
const markdown = new MarkdownIt({
  html: false, linkify: true, breaks: true,
  highlight(code, language) {
    const aliases: Record<string, string> = { js: 'javascript', ts: 'typescript', html: 'xml', sh: 'bash', shell: 'bash', jsonc: 'json' };
    const name = aliases[language?.toLowerCase()] ?? language?.toLowerCase();
    return name && hljs.getLanguage(name) ? hljs.highlight(code, { language: name, ignoreIllegals: true }).value : '';
  },
}).use(taskLists);
// Plugin declarations target different markdown-it type entry points than this v14 project.
footnote(markdown as unknown as Parameters<typeof footnote>[0]);
math(markdown as unknown as Parameters<typeof math>[0], {
  inlineRenderer: source => katex.renderToString(source, { throwOnError: false, trust: false, maxExpand: 1000, maxSize: 100 }),
  blockRenderer: source => katex.renderToString(source, { displayMode: true, throwOnError: false, trust: false, maxExpand: 1000, maxSize: 100 }),
});
markdown.renderer.rules.image = (tokens, index) => `<span class="image-placeholder">[图片：${markdown.utils.escapeHtml(tokens[index].content)}]</span>`;
export type DiagramKind = 'mermaid' | 'flowchart' | 'flow';
export function diagramKind(info: string, code = ''): DiagramKind | null {
  const language = info.trim().split(/\s+/)[0]?.toLowerCase();
  if (language === 'flow') return 'flow';
  if (language === 'flowchart') return /^\s*\w+=>/m.test(code) ? 'flow' : 'flowchart';
  return language === 'mermaid' ? language : null;
}
export function diagramDefinition(kind: DiagramKind, code: string): string {
  if (kind !== 'flowchart' || /^\s*(flowchart|graph)\b/.test(code)) return code;
  return `flowchart ${/^(TB|TD|BT|RL|LR)\b/.test(code.trimStart()) ? '' : 'TD\n'}${code.trimStart()}`;
}
export interface MarkdownBlock { startLine: number; endLine: number; html: string; diagram?: { kind: DiagramKind; code: string } }
export function editableCodeFence(text: string, line: number): { language: string; firstContentLine: number; closingLine: number } | null {
  const lines = text.split('\n');
  for (const token of markdown.parse(text, {})) {
    if (token.type !== 'fence' || !token.map) continue;
    const opening = token.map[0] + 1; const closing = token.map[1];
    if (line < opening || line > closing || closing <= opening + 1) continue;
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(lines[opening - 1]);
    if (!marker || !new RegExp(`^ {0,3}${marker[1][0]}{${marker[1].length},}\\s*$`).test(lines[closing - 1] ?? '')) continue;
    return { language: token.info.trim().split(/\s+/)[0].toLowerCase(), firstContentLine: opening + 1, closingLine: closing };
  }
  return null;
}
export function markdownHeadings(text: string): { title: string; line: number; level: number }[] {
  const tokens = markdown.parse(text, {});
  const headings: { title: string; line: number; level: number }[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type !== 'heading_open' || !token.map) continue;
    const inline = tokens[index + 1];
    const title = (inline.children ?? []).map(child =>
      ['text', 'code_inline', 'image'].includes(child.type) ? child.content :
        ['softbreak', 'hardbreak'].includes(child.type) ? ' ' : '').join('').trim();
    headings.push({ title, line: token.map[0] + 1, level: Number(token.tag.slice(1)) });
  }
  return headings;
}
for (const kind of ['fence', 'code_block'] as const) {
  const original = markdown.renderer.rules[kind]!;
  markdown.renderer.rules[kind] = (tokens, index, options, env, renderer) => {
    const map = tokens[index].map;
    const diagram = kind === 'fence' ? diagramKind(tokens[index].info, tokens[index].content) : null;
    const content = diagram
      ? `<div class="diagram-preview" data-diagram-kind="${diagram}"><pre class="diagram-source">${markdown.utils.escapeHtml(tokens[index].content)}</pre></div>`
      : original(tokens, index, options, env, renderer);
    return map ? `<div data-source-start="${map[0] + 1}" data-source-end="${map[1]}">${content}</div>` : content;
  };
}
function prepareTokens(tokens: ReturnType<typeof markdown.parse>) {
  for (const token of tokens) if (token.map && (token.nesting === 1 || token.type === 'hr')) {
    token.attrSet('data-source-start', String(token.map[0] + 1));
    token.attrSet('data-source-end', String(token.map[1]));
  }
}
function safeHtml(html: string) {
  return DOMPurify.sanitize(html, { FORBID_TAGS: ['img', 'iframe', 'video', 'audio', 'source', 'object', 'embed', 'style'], FORBID_ATTR: ['src', 'srcset'] });
}
export function renderMarkdown(text: string): string {
  const tokens = markdown.parse(text, {});
  prepareTokens(tokens);
  return safeHtml(markdown.renderer.render(tokens, markdown.options, {}));
}
export function markdownBlocks(text: string): MarkdownBlock[] {
  const tokens = markdown.parse(text, {});
  const lines = text.split('\n');
  prepareTokens(tokens);
  const blocks: MarkdownBlock[] = [];
  for (let index = 0; index < tokens.length;) {
    const first = tokens[index];
    if (first.type === 'footnote_block_open') {
      let end = index + 1;
      while (end < tokens.length && tokens[end].type !== 'footnote_block_close') end++;
      for (let item = index + 1; item < end;) {
        if (tokens[item].type !== 'footnote_open') { item++; continue; }
        let close = item + 1;
        while (close < end && tokens[close].type !== 'footnote_close') close++;
        const group = [first, ...tokens.slice(item, close + 1), tokens[end]];
        const mapped = group.flatMap(token => token.map ? [token.map] : []);
        const html = safeHtml(markdown.renderer.render(group, markdown.options, {}));
        const startLine = Math.min(...mapped.map(map => map[0] + 1));
        const endLine = Math.max(...mapped.map(map => map[1]));
        if (mapped.length && !blocks.some(block => block.startLine <= endLine && block.endLine >= startLine)) {
          blocks.push({ startLine, endLine, html });
        } else if (blocks.length) {
          blocks[blocks.length - 1].html += html;
        }
        item = close + 1;
      }
      index = end + 1;
      continue;
    }
    if (first.level !== 0 || first.nesting < 0 || !first.map) { index++; continue; }
    let end = index + 1;
    if (first.nesting === 1) {
      while (end < tokens.length && !(tokens[end].level === 0 && tokens[end].nesting === -1)) end++;
      end++;
    }
    const kind = first.type === 'fence' ? diagramKind(first.info, first.content) : null;
    let endLine = first.map[1];
    while (endLine > first.map[0] + 1 && !lines[endLine - 1]?.trim()) endLine--;
    blocks.push({
      startLine: first.map[0] + 1,
      endLine,
      html: safeHtml(markdown.renderer.render(tokens.slice(index, end), markdown.options, {})),
      ...(kind ? { diagram: { kind, code: first.content } } : {}),
    });
    index = end;
  }
  return blocks;
}
