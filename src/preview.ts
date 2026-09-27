import MarkdownIt from 'markdown-it';
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
  html: false, linkify: false, breaks: true,
  highlight(code, language) {
    const aliases: Record<string, string> = { js: 'javascript', ts: 'typescript', html: 'xml', sh: 'bash', shell: 'bash', jsonc: 'json' };
    const name = aliases[language?.toLowerCase()] ?? language?.toLowerCase();
    return name && hljs.getLanguage(name) ? hljs.highlight(code, { language: name, ignoreIllegals: true }).value : '';
  },
});
markdown.renderer.rules.image = (tokens, index) => `<span class="image-placeholder">[图片：${markdown.utils.escapeHtml(tokens[index].content)}]</span>`;
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
    const content = original(tokens, index, options, env, renderer);
    return map ? `<div data-source-start="${map[0] + 1}" data-source-end="${map[1]}">${content}</div>` : content;
  };
}
export function renderMarkdown(text: string): string {
  const tokens = markdown.parse(text, {});
  for (const token of tokens) if (token.map && (token.nesting === 1 || token.type === 'hr')) {
    token.attrSet('data-source-start', String(token.map[0] + 1));
    token.attrSet('data-source-end', String(token.map[1]));
  }
  return DOMPurify.sanitize(markdown.renderer.render(tokens, markdown.options, {}), { FORBID_TAGS: ['img', 'iframe', 'video', 'audio', 'source', 'object', 'embed', 'style'], FORBID_ATTR: ['style', 'src', 'srcset'] });
}
