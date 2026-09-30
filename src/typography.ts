export const DEFAULT_DOCUMENT_FONT_SIZE = 14;
export const MIN_DOCUMENT_FONT_SIZE = 10;
export const MAX_DOCUMENT_FONT_SIZE = 32;

export function isDocumentFontSize(value: number) {
  return Number.isInteger(value) && value >= MIN_DOCUMENT_FONT_SIZE && value <= MAX_DOCUMENT_FONT_SIZE;
}

export function restoreDocumentFontSize(value: string | null) {
  const size = Number(value);
  return isDocumentFontSize(size) ? size : DEFAULT_DOCUMENT_FONT_SIZE;
}
