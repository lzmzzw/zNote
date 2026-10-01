import { CsvEngine } from '../csv-engine';
import type { CsvWorkerRequest } from '../csv.worker';

export class TestCsvWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  private engine: CsvEngine | undefined;
  private id = '';
  private send(data: unknown) {
    if (!this.terminated) this.onmessage?.({ data } as MessageEvent);
  }
  postMessage(message: CsvWorkerRequest) {
    queueMicrotask(async () => {
      if (this.terminated) return;
      if (message.type === 'parse') {
        this.id = message.id;
        this.engine = new CsvEngine(message.text, message.options);
        await this.engine.build((state) => this.send({ type: 'state', id: message.id, state }));
      } else if (message.id === this.id && this.engine) {
        const result =
          message.type === 'window'
            ? this.engine.window(message.request)
            : message.type === 'locate'
              ? this.engine.rowAtLine(message.request.line)
              : await this.engine.copy(message.request);
        this.send({ type: message.type, id: message.id, requestId: message.requestId, result });
      }
    });
  }
  terminate() {
    this.terminated = true;
  }
}
