import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { markdown } from '@codemirror/lang-markdown';
import { json } from '@codemirror/lang-json';
import { languages } from '@codemirror/language-data';
import { LARGE_DOCUMENT_LIMIT, type NoteFormat } from '../document';

const codeColors = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword], color: 'var(--syntax-keyword)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--syntax-string)' },
  { tag: [tags.number, tags.bool, tags.atom], color: 'var(--syntax-number)' },
  { tag: [tags.comment, tags.meta], color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: [tags.typeName, tags.className, tags.propertyName], color: 'var(--syntax-type)' },
  { tag: [tags.heading, tags.strong], color: 'var(--heading)', fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.link, color: 'var(--accent)' },
]);
export function editorAppearance(night: boolean): Extension {
  return [EditorView.theme({}, { dark: night }), syntaxHighlighting(codeColors)];
}
export function languageFor(format: NoteFormat, size: number): Extension {
  return size > LARGE_DOCUMENT_LIMIT
    ? []
    : format === 'json'
      ? json()
      : format === 'markdown'
        ? markdown({ codeLanguages: languages })
        : [];
}

export const editorPhrases = {
  Find: '查找',
  Replace: '替换',
  next: '下一个',
  previous: '上一个',
  all: '全选匹配',
  replace: '替换',
  'replace all': '全部替换',
  'match case': '区分大小写',
  regexp: '正则表达式',
  'by word': '全词匹配',
  close: '关闭',
  'Go to line': '跳转到行',
  go: '跳转',
  'current match': '当前匹配',
  'on line': '所在行',
  'replaced $ matches': '已替换 $ 处匹配',
  'replaced match on line $': '已替换第 $ 行匹配',
};
