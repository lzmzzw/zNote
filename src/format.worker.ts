import { formatJsonc } from './format';
import { formatCode } from './code-format';
self.onmessage = async ({ data }: MessageEvent<{ id: number; kind: 'json' | 'code'; text: string; strict?: boolean; language?: string }>) => {
  try { self.postMessage({ id: data.id, text: data.kind === 'code' ? await formatCode(data.text, data.language ?? '') : formatJsonc(data.text, data.strict) }); }
  catch (error) { self.postMessage({ id: data.id, error: String(error) }); }
};
