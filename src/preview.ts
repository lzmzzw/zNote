import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
const markdown = new MarkdownIt({ html: false, linkify: false, breaks: true });
markdown.renderer.rules.image = (tokens, index) => `<span class="image-placeholder">[图片：${markdown.utils.escapeHtml(tokens[index].content)}]</span>`;
export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(markdown.render(text), { FORBID_TAGS: ['img', 'iframe', 'video', 'audio', 'source', 'object', 'embed', 'style'], FORBID_ATTR: ['style', 'src', 'srcset'] });
}
