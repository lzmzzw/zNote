import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
const markdown = new MarkdownIt({ html: false, linkify: false, breaks: true });
markdown.renderer.rules.image = (tokens, index) => `<span class="image-placeholder">[图片：${markdown.utils.escapeHtml(tokens[index].content)}]</span>`;
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
