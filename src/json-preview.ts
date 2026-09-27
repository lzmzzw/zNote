import { parseTree, type Node as JsonNode, type ParseError } from 'jsonc-parser';

export interface JsonPreviewRow { line: number; from: number; to: number; depth: number; label: string; value: string; kind: string }

export function jsonPreviewRows(text: string): JsonPreviewRow[] {
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, { allowTrailingComma: true });
  const starts = [0];
  for (const match of text.matchAll(/\r\n|\r|\n/g)) starts.push(match.index + match[0].length);
  const lineAt = (offset: number) => {
    let low = 0; let high = starts.length;
    while (low + 1 < high) { const middle = (low + high) >> 1; if (starts[middle] <= offset) low = middle; else high = middle; }
    return low + 1;
  };
  if (!root || errors.length) return text.split(/\r\n|\r|\n/).map((value, index) => ({ line: index + 1, from: starts[index], to: starts[index] + value.length, depth: 0, label: '', value, kind: 'raw' }));

  const rows: JsonPreviewRow[] = [];
  function visit(node: JsonNode, depth: number, label = '', propertyFrom = node.offset) {
    const line = lineAt(node.offset);
    if (node.type === 'object' || node.type === 'array') {
      rows.push({ line: lineAt(propertyFrom), from: propertyFrom, to: node.offset + node.length, depth, label, value: node.type === 'object' ? '{' : '[', kind: 'container' });
      for (const child of node.children ?? []) {
        if (child.type === 'property' && child.children?.[1]) visit(child.children[1], depth + 1, String(child.children[0].value), child.offset);
        else visit(child, depth + 1);
      }
      const close = node.offset + node.length - 1;
      rows.push({ line: lineAt(close), from: close, to: close + 1, depth, label: '', value: node.type === 'object' ? '}' : ']', kind: 'container' });
    } else rows.push({ line: lineAt(propertyFrom), from: propertyFrom, to: node.offset + node.length, depth, label, value: text.slice(node.offset, node.offset + node.length), kind: node.type });
  }
  visit(root, 0);
  return rows;
}
