import { expect, test } from 'vitest';
import { EditorState } from '@codemirror/state';
import { language } from '@codemirror/language';
import { displayFormatFor, LARGE_DOCUMENT_LIMIT } from '../document';
import { languageFor } from './config';

test('large Markdown and JSON use plain text while CSV retains its display format', () => {
  for (const format of ['markdown', 'json'] as const) {
    expect(displayFormatFor(format, LARGE_DOCUMENT_LIMIT)).toBe(format);
    expect(displayFormatFor(format, LARGE_DOCUMENT_LIMIT + 1)).toBe('txt');
    expect(
      EditorState.create({ extensions: languageFor(format, LARGE_DOCUMENT_LIMIT + 1) }).facet(language),
    ).toBeNull();
    expect(
      EditorState.create({ extensions: languageFor(format, LARGE_DOCUMENT_LIMIT) }).facet(language),
    ).not.toBeNull();
  }
  expect(displayFormatFor('csv', LARGE_DOCUMENT_LIMIT + 1)).toBe('csv');
});
