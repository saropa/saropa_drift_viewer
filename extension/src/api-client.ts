export type * from './api-types';

import type {
  Anomaly, ForeignKey, HealthResponse, ICompareReport, IDiagramData,
  IImportResult, IMigrationPreview, IndexSuggestion, ISessionData,
  ISessionShareResult, ISizeAnalytics, PerformanceData, TableMetadata,
} from './api-types';

export class DriftApiClient {
  private _baseUrl: string;
  private _authToken: string | undefined;

  constructor(host: string, port: number) {
    this._baseUrl = `http://${host}:${port}`;
  }

  /** Update the server endpoint (called by ServerManager on active server change). */
  reconfigure(host: string, port: number): void {
    this._baseUrl = `http://${host}:${port}`;
  }

  /** Set or clear the Bearer auth token sent with every request. */
  setAuthToken(token: string | undefined): void {
    this._authToken = token || undefined;
  }

  get host(): string {
    return new URL(this._baseUrl).hostname;
  }

  get port(): number {
    return parseInt(new URL(this._baseUrl).port, 10);
  }

  get baseUrl(): string {
    return this._baseUrl;
  }

  // ---- Existing endpoints ----

  async health(): Promise<HealthResponse> {
    const resp = await fetch(`${this._baseUrl}/api/health`, {
      headers: this._headers(),
    });
    if (!resp.ok) {
      throw new Error(`Health check failed: ${resp.status}`);
    }
    return resp.json() as Promise<HealthResponse>;
  }

  async schemaMetadata(): Promise<TableMetadata[]> {
    const resp = await fetch(`${this._baseUrl}/api/schema/metadata`, {
      headers: this._headers(),
    });
    if (!resp.ok) {
      throw new Error(`Schema metadata failed: ${resp.status}`);
    }
    return resp.json() as Promise<TableMetadata[]>;
  }

  async tableFkMeta(tableName: string): Promise<ForeignKey[]> {
    const resp = await fetch(
      `${this._baseUrl}/api/table/${encodeURIComponent(tableName)}/fk-meta`,
      { headers: this._headers() },
    );
    if (!resp.ok) {
      throw new Error(`FK metadata failed: ${resp.status}`);
    }
    return resp.json() as Promise<ForeignKey[]>;
  }

  async generation(since: number): Promise<number> {
    const resp = await fetch(
      `${this._baseUrl}/api/generation?since=${since}`,
      { headers: this._headers() },
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
      headers: this._headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ sql: query }),
    });
    if (!resp.ok) {
      throw new Error(`SQL query failed: ${resp.status}`);
    }
    return resp.json() as Promise<{ columns: string[]; rows: unknown[][] }>;
  }

  async indexSuggestions(): Promise<IndexSuggestion[]> {
    const resp = await fetch(`${this._baseUrl}/api/index-suggestions`, {
      headers: this._headers(),
    });
    if (!resp.ok) {
      throw new Error(`Index suggestions failed: ${resp.status}`);
    }
    return resp.json() as Promise<IndexSuggestion[]>;
  }

  async anomalies(): Promise<Anomaly[]> {
    const resp = await fetch(`${this._baseUrl}/api/anomalies`, {
      headers: this._headers(),
    });
    if (!resp.ok) {
      throw new Error(`Anomaly scan failed: ${resp.status}`);
    }
    return resp.json() as Promise<Anomaly[]>;
  }

  async performance(): Promise<PerformanceData> {
    const resp = await fetch(`${this._baseUrl}/api/analytics/performance`, {
      headers: this._headers(),
    });
    if (!resp.ok) {
      throw new Error(`Performance query failed: ${resp.status}`);
    }
    return resp.json() as Promise<PerformanceData>;
  }

  async explainSql(
    query: string,
  ): Promise<{ rows: Record<string, unknown>[]; sql: string }> {
    const resp = await fetch(`${this._baseUrl}/api/sql/explain`, {
      method: 'POST',
      headers: this._headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ sql: query }),
    });
    if (!resp.ok) {
      throw new Error(`Explain failed: ${resp.status}`);
    }
    return resp.json() as Promise<{
      rows: Record<string, unknown>[];
      sql: string;
    }>;
  }

  async clearPerformance(): Promise<void> {
    const resp = await fetch(`${this._baseUrl}/api/analytics/performance`, {
      method: 'DELETE',
      headers: this._headers(),
    });
    if (!resp.ok) {
      throw new Error(`Clear performance failed: ${resp.status}`);
    }
  }

  // ---- New endpoints (gap closures) ----

  async schemaDiagram(): Promise<IDiagramData> {
    const resp = await fetch(`${this._baseUrl}/api/schema/diagram`, {
      headers: this._headers(),
    });
    if (!resp.ok) {
      throw new Error(`Schema diagram failed: ${resp.status}`);
    }
    return resp.json() as Promise<IDiagramData>;
  }

  async schemaDump(): Promise<string> {
    const resp = await fetch(`${this._baseUrl}/api/schema/dump`, {
      headers: this._headers(),
    });
    if (!resp.ok) {
      throw new Error(`Schema dump failed: ${resp.status}`);
    }
    return resp.text();
  }

  async databaseFile(): Promise<ArrayBuffer> {
    const resp = await fetch(`${this._baseUrl}/api/database`, {
      headers: this._headers(),
    });
    if (!resp.ok) {
      throw new Error(`Database download failed: ${resp.status}`);
    }
    return resp.arrayBuffer();
  }

  async compareReport(): Promise<ICompareReport> {
    const resp = await fetch(`${this._baseUrl}/api/compare/report`, {
      headers: this._headers(),
    });
    if (!resp.ok) {
      throw new Error(`Compare report failed: ${resp.status}`);
    }
    return resp.json() as Promise<ICompareReport>;
  }

  async migrationPreview(): Promise<IMigrationPreview> {
    const resp = await fetch(`${this._baseUrl}/api/migration/preview`, {
      headers: this._headers(),
    });
    if (!resp.ok) {
      throw new Error(`Migration preview failed: ${resp.status}`);
    }
    return resp.json() as Promise<IMigrationPreview>;
  }

  async sizeAnalytics(): Promise<ISizeAnalytics> {
    const resp = await fetch(`${this._baseUrl}/api/analytics/size`, {
      headers: this._headers(),
    });
    if (!resp.ok) {
      throw new Error(`Size analytics failed: ${resp.status}`);
    }
    return resp.json() as Promise<ISizeAnalytics>;
  }

  async importData(
    format: string, table: string, data: string,
  ): Promise<IImportResult> {
    const resp = await fetch(`${this._baseUrl}/api/import`, {
      method: 'POST',
      headers: this._headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ format, table, data }),
    });
    if (!resp.ok) {
      throw new Error(`Import failed: ${resp.status}`);
    }
    return resp.json() as Promise<IImportResult>;
  }

  async sessionShare(
    state: Record<string, unknown>,
  ): Promise<ISessionShareResult> {
    const resp = await fetch(`${this._baseUrl}/api/session/share`, {
      method: 'POST',
      headers: this._headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(state),
    });
    if (!resp.ok) {
      throw new Error(`Session share failed: ${resp.status}`);
    }
    return resp.json() as Promise<ISessionShareResult>;
  }

  async sessionGet(id: string): Promise<ISessionData> {
    const resp = await fetch(
      `${this._baseUrl}/api/session/${encodeURIComponent(id)}`,
      { headers: this._headers() },
    );
    if (!resp.ok) {
      throw new Error(`Session get failed: ${resp.status}`);
    }
    return resp.json() as Promise<ISessionData>;
  }

  async sessionAnnotate(
    id: string, text: string, author: string,
  ): Promise<void> {
    const resp = await fetch(
      `${this._baseUrl}/api/session/${encodeURIComponent(id)}/annotate`,
      {
        method: 'POST',
        headers: this._headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ text, author }),
      },
    );
    if (!resp.ok) {
      throw new Error(`Session annotate failed: ${resp.status}`);
    }
  }

  // ---- Helpers ----

  private _headers(
    extra?: Record<string, string>,
  ): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this._authToken) {
      h['Authorization'] = `Bearer ${this._authToken}`;
    }
    return h;
  }
}
