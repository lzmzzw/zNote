import { applyEdits, createScanner, format, parseTree, type ParseError } from 'jsonc-parser';

function validateJson(text: string, strict: boolean) {
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, { allowTrailingComma: !strict, disallowComments: strict });
  if (!root || errors.length) throw new Error(`JSON 语法错误（位置 ${(errors[0]?.offset ?? 0) + 1}），未修改原文`);
}

export function formatJsonc(text: string, strict = false): string {
  validateJson(text, strict);
  return applyEdits(text, format(text, undefined, { tabSize: 2, insertSpaces: true, eol: '\n' }));
}

export function compactJsonc(text: string, strict = false): string {
  validateJson(text, strict);
  const scanner = createScanner(text, false);
  let output = '';
  while (scanner.getPosition() < text.length) {
    scanner.scan();
    const raw = text.slice(scanner.getTokenOffset(), scanner.getTokenOffset() + scanner.getTokenLength());
    if (!raw.trim()) continue;
    output += raw.startsWith('//') ? `${raw}\n` : raw;
  }
  return output;
}

export function escapeJsonText(text: string): string {
  return JSON.stringify(text);
}

export function unescapeJsonText(text: string, strict = false): string {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('去除转义需要完整的 JSON 字符串，未修改原文');
  }
  if (typeof value !== 'string') throw new Error('去除转义需要完整的 JSON 字符串，未修改原文');
  validateJson(value, strict);
  return value;
}
