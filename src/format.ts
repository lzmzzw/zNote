import { applyEdits, format, parse, type ParseError } from 'jsonc-parser';
export function formatJsonc(text: string, strict = false): string {
  const errors: ParseError[] = [];
  parse(text, errors, { allowTrailingComma: !strict, disallowComments: strict });
  if (errors.length) throw new Error(`JSON 语法错误（位置 ${errors[0].offset + 1}），未修改原文`);
  return applyEdits(text, format(text, undefined, { tabSize: 2, insertSpaces: true, eol: '\n' }));
}
