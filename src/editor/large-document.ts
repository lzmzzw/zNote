import { StreamLanguage, type StringStream } from '@codemirror/language';
import type { Text } from '@codemirror/state';
import { LARGE_DOCUMENT_LIMIT, type NoteFormat } from '../document';

export const LARGE_LINE_LIMIT = 16_384;

export interface LargeDocumentPolicy {
  large: boolean;
  wrap: boolean;
  lightweight: boolean;
  longLines: boolean;
}

export function largeDocumentPolicy(text: string | Text): LargeDocumentPolicy {
  const large = text.length > LARGE_DOCUMENT_LIMIT;
  let lightweight = false;
  if (large && typeof text === 'string') {
    let from = 0;
    while (from < text.length) {
      const end = text.indexOf('\n', from);
      if ((end < 0 ? text.length : end) - from > LARGE_LINE_LIMIT) {
        lightweight = true;
        break;
      }
      if (end < 0) break;
      from = end + 1;
    }
  } else if (large && typeof text !== 'string') {
    for (const line of text.iterLines()) {
      if (line.length > LARGE_LINE_LIMIT) {
        lightweight = true;
        break;
      }
    }
  }
  return { large, wrap: !large, lightweight, longLines: lightweight };
}

export const editorDocumentPolicy = largeDocumentPolicy;

// The fallback intentionally stops styling long lines after a bounded prefix.
// It provides lexical cues, not a structural tree or whole-document validation.
function boundedEnd(stream: StringStream): number {
  return Math.min(stream.string.length, LARGE_LINE_LIMIT);
}

const largeJson = StreamLanguage.define({
  name: 'large-json-lexical',
  startState: () => ({ comment: false }),
  token(stream, state) {
    const end = boundedEnd(stream);
    if (stream.pos >= end) { stream.skipToEnd(); return null; }
    if (state.comment) {
      while (stream.pos < end) {
        if (stream.match('*/')) { state.comment = false; break; }
        stream.next();
      }
      if (stream.pos === end && stream.string.length > end) state.comment = false;
      return 'comment';
    }
    if (stream.match(/^\s{1,1024}/)) return null;
    if (stream.match('//')) { stream.pos = end; return 'comment'; }
    if (stream.match('/*')) { state.comment = true; return 'comment'; }
    if (stream.eat('"')) {
      let escaped = false;
      while (stream.pos < end) {
        const char = stream.next();
        if (char === '"' && !escaped) break;
        escaped = char === '\\' && !escaped;
      }
      let next = stream.pos;
      while (next < end && /\s/.test(stream.string[next]!)) next++;
      return stream.string[next] === ':' ? 'propertyName' : 'string';
    }
    if (stream.match(/^-?(?:0|[1-9]\d{0,1023})(?:\.\d{1,1024})?(?:[eE][+-]?\d{1,1024})?/)) return 'number';
    if (stream.match(/^(?:true|false|null)\b/)) return 'atom';
    stream.next();
    return null;
  },
});

const largeMarkdown = StreamLanguage.define({
  name: 'large-markdown-lexical',
  startState: () => ({ fence: '' }),
  token(stream, state) {
    const end = boundedEnd(stream);
    if (stream.pos >= end) { stream.skipToEnd(); return null; }
    if (stream.sol()) {
      const fence = /^(?: {0,3})(`{3,}|~{3,})/.exec(stream.string.slice(0, 256));
      if (fence) {
        if (!state.fence) state.fence = fence[1]!;
        else if (fence[1]![0] === state.fence[0] && fence[1]!.length >= state.fence.length) state.fence = '';
        stream.pos = end;
        return 'meta';
      }
      if (state.fence) { stream.pos = end; return 'string'; }
      if (stream.match(/^ {0,3}#{1,6}(?:\s|$)/)) { stream.pos = end; return 'heading'; }
    }
    if (stream.match(/^\*\*[^*\n]{1,1024}\*\*|^__[^_\n]{1,1024}__/)) return 'strong';
    if (stream.match(/^\*[^*\n]{1,1024}\*|^_[^_\n]{1,1024}_/)) return 'emphasis';
    if (stream.match(/^`[^`\n]{1,1024}`/)) return 'string';
    if (stream.match(/^\[[^\]\n]{0,1024}\]\([^\)\n]{0,1024}\)/)) return 'link';
    stream.next();
    return null;
  },
});

export function lightweightLanguage(format: NoteFormat) {
  return format === 'json' ? largeJson : format === 'markdown' ? largeMarkdown : [];
}
