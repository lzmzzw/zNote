import { escapeJsonText, formatJsonc, unescapeJsonText } from './format';
import { formatCode } from './code-format';
self.onmessage = async ({ data }: MessageEvent<{ id: number; kind: 'json' | 'code' | 'escape' | 'unescape'; text: string; strict?: boolean; language?: string }>) => {
  try {
    const text = data.kind === 'code' ? await formatCode(data.text, data.language ?? '')
      : data.kind === 'escape' ? escapeJsonText(data.text)
      : data.kind === 'unescape' ? unescapeJsonText(data.text, data.strict)
      : formatJsonc(data.text, data.strict);
    self.postMessage({ id: data.id, text });
  }
  catch (error) { self.postMessage({ id: data.id, error: String(error) }); }
};
