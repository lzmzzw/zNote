import { formatJsonc } from './format';

const parsers: Record<string, 'babel' | 'typescript' | 'json' | 'jsonc' | 'css' | 'html'> = {
  js: 'babel', javascript: 'babel', jsx: 'babel', ts: 'typescript', typescript: 'typescript', tsx: 'typescript',
  json: 'json', jsonc: 'jsonc', css: 'css', html: 'html', htm: 'html',
};

export function canFormatCode(language: string): boolean { return Object.hasOwn(parsers, language.toLowerCase()); }

export async function formatCode(code: string, language: string): Promise<string> {
  const parser = parsers[language.toLowerCase()];
  if (!parser) throw new Error(`暂不支持格式化 ${language || '无语言标记'} 代码块`);
  if (parser === 'jsonc') return `${formatJsonc(code).trimEnd()}\n`;
  const prettier = await import('prettier/standalone');
  const estree = parser === 'babel' || parser === 'typescript' || parser === 'json' ? [await import('prettier/plugins/estree')] : [];
  const plugin = parser === 'babel' || parser === 'json' ? await import('prettier/plugins/babel') :
    parser === 'typescript' ? await import('prettier/plugins/typescript') :
      parser === 'css' ? await import('prettier/plugins/postcss') : await import('prettier/plugins/html');
  return prettier.format(code, { parser, plugins: [plugin, ...estree], tabWidth: 2 });
}
