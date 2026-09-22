import { formatJsonc } from './format';
self.onmessage = ({ data }: MessageEvent<{ id: number; text: string; strict: boolean }>) => {
  try { self.postMessage({ id: data.id, text: formatJsonc(data.text, data.strict) }); }
  catch (error) { self.postMessage({ id: data.id, error: String(error) }); }
};
