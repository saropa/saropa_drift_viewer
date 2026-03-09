export interface TableMetadata {
  name: string;
  columns: ColumnMetadata[];
  rowCount: number;
}

export interface ColumnMetadata {
  name: string;
  type: string; // INTEGER, TEXT, REAL, BLOB
  pk: boolean;
}

export interface ForeignKey {
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

export interface HealthResponse {
  ok: boolean;
}

export interface IndexSuggestion {
  table: string;
  column: string;
  reason: string;
  sql: string;
  priority: 'high' | 'low';
}

export interface Anomaly {
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export interface QueryEntry {
  sql: string;
  durationMs: number;
  rowCount: number;
  at: string;
}

export interface PerformanceData {
  totalQueries: number;
  totalDurationMs: number;
  avgDurationMs: number;
  slowQueries: QueryEntry[];
  recentQueries: QueryEntry[];
}

export class DriftApiClient {
  private _baseUrl: string;

  constructor(host: string, port: number) {
    this._baseUrl = `http://${host}:${port}`;
  }

  /** Update the server endpoint (called by ServerManager on active server change). */
  reconfigure(host: string, port: number): void {
    this._baseUrl = `http://${host}:${port}`;
  }

  get host(): string {
    return new URL(this._baseUrl).hostname;
  }

  get port(): number {
    return parseInt(new URL(this._baseUrl).port, 10);
  }

  async health(): Promise<HealthResponse> {
    const resp = await fetch(`${this._baseUrl}/api/health`);
    if (!resp.ok) {
      throw new Error(`Health check failed: ${resp.status}`);
    }
    return resp.json() as Promise<HealthResponse>;
  }

  async schemaMetadata(): Promise<TableMetadata[]> {
    const resp = await fetch(`${this._baseUrl}/api/schema/metadata`);
    if (!resp.ok) {
      throw new Error(`Schema metadata failed: ${resp.status}`);
    }
    return resp.json() as Promise<TableMetadata[]>;
  }

  async tableFkMeta(tableName: string): Promise<ForeignKey[]> {
    const resp = await fetch(
      `${this._baseUrl}/api/table/${encodeURIComponent(tableName)}/fk-meta`,
    );
    if (!resp.ok) {
      throw new Error(`FK metadata failed: ${resp.status}`);
    }
    return resp.json() as Promise<ForeignKey[]>;
  }

  async generation(since: number): Promise<number> {
    const resp = await fetch(
      `${this._baseUrl}/api/generation?since=${since}`,
    );
    if (!resp.ok) {
      throw new Error(`Generation poll failed: ${resp.status}`);
    }
    const data = (await resp.json()) as { generation: number };
    return data.generation;
  }

  async sql(query: string): Promise<{ columns: string[]; rows: unknown[][] }> {
    const resp = await fetch(`${this._baseUrl}/api/sql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: query }),
    });
    if (!resp.ok) {
      throw new Error(`SQL query failed: ${resp.status}`);
    }
    return resp.json() as Promise<{ columns: string[]; rows: unknown[][] }>;
  }

  async indexSuggestions(): Promise<IndexSuggestion[]> {
    const resp = await fetch(`${this._baseUrl}/api/index-suggestions`);
    if (!resp.ok) {
      throw new Error(`Index suggestions failed: ${resp.status}`);
    }
    return resp.json() as Promise<IndexSuggestion[]>;
  }

  async anomalies(): Promise<Anomaly[]> {
    const resp = await fetch(`${this._baseUrl}/api/anomalies`);
    if (!resp.ok) {
      throw new Error(`Anomaly scan failed: ${resp.status}`);
    }
    return resp.json() as Promise<Anomaly[]>;
  }

  async performance(): Promise<PerformanceData> {
    const resp = await fetch(`${this._baseUrl}/api/analytics/performance`);
    if (!resp.ok) {
      throw new Error(`Performance query failed: ${resp.status}`);
    }
    return resp.json() as Promise<PerformanceData>;
  }

  async clearPerformance(): Promise<void> {
    const resp = await fetch(`${this._baseUrl}/api/analytics/performance`, {
      method: 'DELETE',
    });
    if (!resp.ok) {
      throw new Error(`Clear performance failed: ${resp.status}`);
    }
  }

  get baseUrl(): string {
    return this._baseUrl;
  }
}
