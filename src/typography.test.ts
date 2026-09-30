import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isDocumentFontSize, restoreDocumentFontSize } from './typography';

const css = (name: string) => readFileSync(new URL(`./styles/${name}.css`, import.meta.url), 'utf8');

describe('document typography', () => {
  it('restores valid saved sizes and defaults invalid preferences to 14px', () => {
    for (const value of [null, '', 'NaN', '9', '33', '14.5', 'Infinity']) {
      expect(restoreDocumentFontSize(value)).toBe(14);
    }
    for (const value of [10, 14, 20, 32]) {
      expect(isDocumentFontSize(value)).toBe(true);
      expect(restoreDocumentFontSize(String(value))).toBe(value);
    }
  });
  it('shares local Latin and Chinese font fallbacks across all document formats', () => {
    const tokens = css('tokens');
    expect(tokens).toContain("--font-document: 'Cascadia Code', Consolas, 'Source Han Sans SC', 'Source Han Sans CN', '思源黑体', 'Microsoft YaHei', monospace;");
    expect(tokens).toContain('--font-reading: var(--font-document);');
    expect(tokens).toContain('--font-mono: var(--font-document);');
    expect(tokens).not.toContain("font-family: 'zNote Mono SC'");
    expect(css('editor')).toContain('font-family: var(--font-document) !important;');
    expect(css('content')).toMatch(/\.json-preview\s*\{[^}]*font-family: var\(--font-document\)/);
  });

  it('defaults prose, structured text and inline code to 14px', () => {
    expect(css('tokens')).toContain('--font-size-reading: 14px;');
    expect(css('tokens')).toContain('--font-size-code: 14px;');
    expect(css('content')).toMatch(/\.preview :not\(pre\) > code\s*\{[^}]*font-size: var\(--font-size-code\)/);
  });

  it('anchors fixed-size JSON actions to the center of the first 1.6-height line', () => {
    const chrome = css('chrome');
    expect(chrome).toMatch(/\.json-float-actions\s*\{[^}]*top: calc\(6px \+ var\(--font-size-code\) \* 0\.8\)/);
    expect(chrome).toMatch(/\.json-float-actions\s*\{[^}]*transform: translateY\(-50%\)/);
    expect(chrome).toMatch(/\.json-float-actions button\s*\{[^}]*height: 23px/);
  });
});
