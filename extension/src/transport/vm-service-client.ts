/**
 * Minimal VM Service protocol client (Plan 68).
 * Connects via WebSocket, sends JSON-RPC requests, resolves main isolate ID,
 * and calls ext.saropa.drift.* extension methods.
 */

import type {
  Anomaly,
  ForeignKey,
  HealthResponse,
  IndexSuggestion,
  PerformanceData,
  TableMetadata,
} from '../api-types';

const EXT_PREFIX = 'ext.saropa.drift.';

export interface VmServiceClientConfig {
  wsUri: string;
  timeoutMs?: number;
  /** Called when the WebSocket closes (e.g. hot restart). Use to clear UI state. */
  onClose?: () => void;
}

export class VmServiceClient {
  private _ws: WebSocket | null = null;
  private _wsUri: string;
  private _timeoutMs: number;
  private _isolateId: string | null = null;
  private _nextId = 1;
  private _pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  private readonly _onClose: (() => void) | undefined;

  constructor(config: VmServiceClientConfig) {
    this._wsUri = config.wsUri;
    this._timeoutMs = config.timeoutMs ?? 10_000;
    this._onClose = config.onClose;
  }

  /** Connect, resolve main isolate ID, and prepare for RPC. */
  async connect(): Promise<void> {
    const ws = new WebSocket(this._wsUri);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        ws.close();
        reject(new Error('VM Service WebSocket connect timeout'));
      }, this._timeoutMs);
      ws.onopen = () => {
        clearTimeout(t);
        resolve();
      };
      ws.onerror = () => reject(new Error('VM Service WebSocket error'));
    });
    this._ws = ws;
    ws.onmessage = (ev) => this._onMessage(ev);
    ws.onclose = () => {
      this._ws = null;
      this._isolateId = null;
      for (const [, { reject }] of this._pending) {
        reject(new Error('VM Service WebSocket closed'));
      }
      this._pending.clear();
      this._onClose?.();
    };
    const isolates = (await this._request('getIsolates', {})) as {
      isolates?: { id: string }[];
    };
    const list = isolates?.isolates;
    if (!list?.length) {
      this.close();
      throw new Error('VM Service: no isolates');
    }
    this._isolateId = list[0].id;
  }

  get connected(): boolean {
    return this._ws !== null && this._ws.readyState === WebSocket.OPEN;
  }

  get isolateId(): string | null {
    return this._isolateId;
  }

  close(): void {
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    this._isolateId = null;
  }

  async getHealth(): Promise<HealthResponse> {
    const raw = await this._callExtension('getHealth', {});
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return obj as HealthResponse;
  }

  async getSchemaMetadata(): Promise<TableMetadata[]> {
    const raw = await this._callExtension('getSchemaMetadata', {});
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const tables = (obj as { tables?: TableMetadata[] }).tables;
    if (!Array.isArray(tables)) {
      throw new Error('Invalid getSchemaMetadata response');
    }
    return tables;
  }

  async getTableFkMeta(tableName: string): Promise<ForeignKey[]> {
    const raw = await this._callExtension('getTableFkMeta', { tableName });
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr)) {
      throw new Error('Invalid getTableFkMeta response');
    }
    return arr as ForeignKey[];
  }

  async runSql(sql: string): Promise<{ columns: string[]; rows: unknown[][] }> {
    const raw = await this._callExtension('runSql', { sql });
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (obj?.error) {
      throw new Error(String(obj.error));
    }
    const rows = obj?.rows as unknown[][];
    if (!Array.isArray(rows)) {
      throw new Error('Invalid runSql response');
    }
    const columns =
      rows.length > 0 && typeof rows[0] === 'object' && rows[0] !== null
        ? (Object.keys(rows[0] as object) as string[])
        : [];
    return { columns, rows };
  }

  /** Returns current generation (no long-poll over VM). */
  async getGeneration(): Promise<number> {
    const raw = await this._callExtension('getGeneration', {});
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const gen = (obj as { generation?: number })?.generation;
    if (typeof gen !== 'number') {
      throw new Error('Invalid getGeneration response');
    }
    return gen;
  }

  async getPerformance(): Promise<PerformanceData> {
    const raw = await this._callExtension('getPerformance', {});
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return obj as PerformanceData;
  }

  async clearPerformance(): Promise<void> {
    await this._callExtension('clearPerformance', {});
  }

  async getAnomalies(): Promise<{ anomalies: Anomaly[] }> {
    const raw = await this._callExtension('getAnomalies', {});
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const anomalies = (obj as { anomalies?: Anomaly[] })?.anomalies;
    if (!Array.isArray(anomalies)) {
      throw new Error('Invalid getAnomalies response');
    }
    return { anomalies };
  }

  async explainSql(sql: string): Promise<{ rows: Record<string, unknown>[]; sql: string }> {
    const raw = await this._callExtension('explainSql', { sql });
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (obj?.error) {
      throw new Error(String(obj.error));
    }
    const rows = obj?.rows as Record<string, unknown>[];
    const sqlOut = obj?.sql as string;
    if (!Array.isArray(rows) || typeof sqlOut !== 'string') {
      throw new Error('Invalid explainSql response');
    }
    return { rows, sql: sqlOut };
  }

  /** Returns index suggestions (missing FK/column indexes). Plan 68 VM path. */
  async getIndexSuggestions(): Promise<IndexSuggestion[]> {
    const raw = await this._callExtension('getIndexSuggestions', {});
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr)) {
      throw new Error('Invalid getIndexSuggestions response');
    }
    return arr as IndexSuggestion[];
  }

  private _callExtension(
    method: string,
    params: Record<string, string>,
  ): Promise<unknown> {
    if (!this._isolateId) {
      return Promise.reject(new Error('VM Service: not connected'));
    }
    return this._request(`${EXT_PREFIX}${method}`, {
      isolateId: this._isolateId,
      ...params,
    });
  }

  private _request(
    method: string,
    params: Record<string, string>,
  ): Promise<unknown> {
    const ws = this._ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('VM Service: WebSocket not open'));
    }
    const id = this._nextId++;
    const msg = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params: this._stringifyParams(params),
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`VM Service request timeout: ${method}`));
      }, this._timeoutMs);
      this._pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      ws.send(msg);
    });
  }

  private _stringifyParams(params: Record<string, string>): Record<string, string> {
    return params;
  }

  private _onMessage(ev: MessageEvent): void {
    let data: { id?: number; result?: unknown; error?: { message?: string } };
    try {
      data = JSON.parse(ev.data as string);
    } catch {
      return;
    }
    const id = data.id;
    if (id === undefined || !this._pending.has(id)) return;
    const entry = this._pending.get(id)!;
    this._pending.delete(id);
    if (data.error) {
      entry.reject(new Error(data.error.message ?? JSON.stringify(data.error)));
    } else {
      // VM may return extension result as raw string or wrapped (e.g. { value: string })
      const result = data.result;
      const unwrapped =
        typeof result === 'object' && result !== null && 'value' in result
          ? (result as { value: string }).value
          : result;
      entry.resolve(unwrapped);
    }
  }
}
