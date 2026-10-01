import type { CsvOptions } from './csv';
import type { CsvCopyRequest, CsvState, CsvWindow, CsvWindowRequest } from './csv-engine';
import type { CsvWorkerRequest } from './csv.worker';

export interface CsvWorkerLike {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: CsvWorkerRequest): void;
  terminate(): void;
}
export class CsvWorkerClient {
  private worker: CsvWorkerLike | null = null;
  private id = '';
  private sequence = 0;
  private pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>();
  constructor(
    private factory: () => CsvWorkerLike = () =>
      new Worker(new URL('./csv.worker.ts', import.meta.url), { type: 'module' }),
  ) {}
  start(id: string, text: string, options: CsvOptions, onState: (state: CsvState) => void) {
    this.dispose();
    this.id = id;
    const worker = this.factory();
    this.worker = worker;
    worker.onmessage = (event) => {
      if (worker !== this.worker || event.data.id !== this.id) return;
      const message = event.data;
      if (message.type === 'state') onState(message.state);
      else {
        const pending = this.pending.get(message.requestId);
        this.pending.delete(message.requestId);
        if (message.type === 'error') {
          pending?.reject(new Error(message.error));
          if (!pending) onState({ status: 'error', progress: 0, rowCount: 0, columnCount: 0, error: message.error });
        } else pending?.resolve(message.result);
      }
    };
    worker.onerror = (event) => {
      if (worker !== this.worker) return;
      onState({ status: 'error', progress: 0, rowCount: 0, columnCount: 0, error: event.message });
      this.dispose();
    };
    worker.postMessage({ type: 'parse', id, text, options });
  }
  private request<T>(
    id: string,
    type: 'window' | 'copy' | 'locate',
    request: CsvWindowRequest | CsvCopyRequest | { line: number },
  ): Promise<T> {
    if (!this.worker || id !== this.id)
      return Promise.reject(new DOMException('CSV task is no longer active', 'AbortError'));
    const requestId = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, { resolve: (result) => resolve(result as T), reject });
      this.worker!.postMessage({ type, id, requestId, request } as CsvWorkerRequest);
    });
  }
  getWindow(id: string, request: CsvWindowRequest) {
    return this.request<CsvWindow>(id, 'window', request);
  }
  rowAtLine(id: string, line: number) {
    return this.request<number>(id, 'locate', { line });
  }
  copy(id: string, request: CsvCopyRequest) {
    return this.request<string>(id, 'copy', request);
  }
  dispose() {
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pending.values()) pending.reject(new DOMException('CSV task cancelled', 'AbortError'));
    this.pending.clear();
  }
}
