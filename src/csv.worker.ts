import { CsvEngine } from './csv-engine';
import type { CsvOptions } from './csv';
import type { CsvCopyRequest, CsvWindowRequest } from './csv-engine';

export type CsvWorkerRequest =
  | { type: 'parse'; id: string; text: string; options: CsvOptions }
  | { type: 'window'; id: string; requestId: number; request: CsvWindowRequest }
  | { type: 'locate'; id: string; requestId: number; request: { line: number } }
  | { type: 'copy'; id: string; requestId: number; request: CsvCopyRequest };
let current: { id: string; engine: CsvEngine } | null = null;
self.onmessage = async (event: MessageEvent<CsvWorkerRequest>) => {
  const message = event.data;
  try {
    if (message.type === 'parse') {
      const engine = new CsvEngine(message.text, message.options);
      current = { id: message.id, engine };
      await engine.build((state) => {
        if (current?.engine === engine) self.postMessage({ type: 'state', id: message.id, state });
      });
    } else if (current?.id === message.id) {
      const result =
        message.type === 'window'
          ? current.engine.window(message.request)
          : message.type === 'locate'
            ? current.engine.rowAtLine(message.request.line)
            : await current.engine.copy(message.request);
      if (current?.id === message.id)
        self.postMessage({ type: message.type, id: message.id, requestId: message.requestId, result });
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      id: message.id,
      requestId: 'requestId' in message ? message.requestId : undefined,
      error: String(error),
    });
  }
};
