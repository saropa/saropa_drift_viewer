export type * from './api-types';
import type {
  Anomaly, ForeignKey, HealthResponse, ICompareReport, IDiagramData,
  IImportResult, IMigrationPreview, IndexSuggestion, ISessionData,
  ISessionShareResult, ISizeAnalytics, PerformanceData, TableMetadata,
} from './api-types';
import type { VmServiceClient } from './transport/vm-service-client';
import {
  importDataRequest, sessionAnnotateRequest,
  sessionGetRequest, sessionShareRequest,
} from './api-client-sessions';

export class DriftApiClient {
  private _baseUrl: string;
  private _authToken: string | undefined;
  /** When set and connected, VM used for health, schema, sql, generation, performance, anomalies, explain, clear (Plan 68). */
  private _vmClient: VmServiceClient | null = null;

  constructor(host: string, port: number) {
    this._baseUrl = `http://${host}:${port}`;
  }

  /** Update the server endpoint (called by ServerManager on active server change). */
  reconfigure(host: string, port: number): void {
    this._baseUrl = `http://${host}:${port}`;
  }

  /** Use VM Service for core API when debugging (Plan 68). Clears on debug session end. */
  setVmClient(client: VmServiceClient | null): void {
    if (this._vmClient) {
      this._vmClient.close();
    }
    this._vmClient = client;
  }

  /** True when using VM Service transport for core methods. */
  get usingVmService(): boolean {
    return this._vmClient !== null && this._vmClient.connected;
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

  /** UI label when connected: "VM Service" or HTTP URL. */
  get connectionDisplayName(): string {
    return this.usingVmService ? 'VM Service' : this._baseUrl;
  }
  async health(): Promise<HealthResponse> {
    if (this._vmClient?.connected) {
      return this._vmClient.getHealth();
    }
    const resp = await fetch(`${this._baseUrl}/api/health`, {
      headers: this._headers(),
    });
    if (!resp.ok) {
      throw new Error(`Health check failed: ${resp.status}`);
    }
    return resp.json() as Promise<HealthResponse>;
  }

  async schemaMetadata(): Promise<TableMetadata[]> {
    if (this._vmClient?.connected) {
      return this._vmClient.getSchemaMetadata();
    }
    const resp = await fetch(`${this._baseUrl}/api/schema/metadata`, {
      headers: this._headers(),
    });
    if (!resp.ok) {
      throw new Error(`Schema metadata failed: ${resp.status}`);
    }
    const data = (await resp.json()) as { tables?: TableMetadata[] };
    return Array.isArray(data?.tables) ? data.tables : (data as unknown as TableMetadata[]);
  }

  async tableFkMeta(tableName: string): Promise<ForeignKey[]> {
    if (this._vmClient?.connected) {
      return this._vmClient.getTableFkMeta(tableName);
    }
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
    if (this._vmClient?.connected) {
      return this._vmClient.getGeneration();
    }
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
    if (this._vmClient?.connected) {
      return this._vmClient.runSql(query);
    }
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
    if (this._vmClient?.connected) {
      return this._vmClient.getIndexSuggestions();
    }
    const resp = await fetch(`${this._baseUrl}/api/index-suggestions`, {
      headers: this._headers(),
    });
    if (!resp.ok) {
      throw new Error(`Index suggestions failed: ${resp.status}`);
    }
    const data = (await resp.json()) as { suggestions?: IndexSuggestion[] } | IndexSuggestion[];
    if (Array.isArray(data)) return data;
    return Array.isArray(data?.suggestions) ? data.suggestions : [];
  }

  async anomalies(): Promise<Anomaly[]> {
    if (this._vmClient?.connected) {
      const { anomalies } = await this._vmClient.getAnomalies();
      return anomalies;
    }
    const resp = await fetch(`${this._baseUrl}/api/analytics/anomalies`, {
      headers: this._headers(),
    });
    if (!resp.ok) {
      throw new Error(`Anomaly scan failed: ${resp.status}`);
    }
    const data = (await resp.json()) as { anomalies?: Anomaly[] } | Anomaly[];
    if (Array.isArray(data)) return data;
    return Array.isArray(data.anomalies) ? data.anomalies : [];
  }

  async performance(): Promise<PerformanceData> {
    if (this._vmClient?.connected) {
      return this._vmClient.getPerformance();
    }
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
    if (this._vmClient?.connected) {
      return this._vmClient.explainSql(query);
    }
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
    if (this._vmClient?.connected) {
      await this._vmClient.clearPerformance();
      return;
    }
    const resp = await fetch(`${this._baseUrl}/api/analytics/performance`, {
      method: 'DELETE',
      headers: this._headers(),
    });
    if (!resp.ok) {
      throw new Error(`Clear performance failed: ${resp.status}`);
    }
  }

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
    return importDataRequest(this._baseUrl, this._headers({ 'Content-Type': 'application/json' }), format, table, data);
  }

  async sessionShare(state: Record<string, unknown>): Promise<ISessionShareResult> {
    return sessionShareRequest(this._baseUrl, this._headers({ 'Content-Type': 'application/json' }), state);
  }

  async sessionGet(id: string): Promise<ISessionData> {
    return sessionGetRequest(this._baseUrl, this._headers(), id);
  }

  async sessionAnnotate(id: string, text: string, author: string): Promise<void> {
    return sessionAnnotateRequest(this._baseUrl, this._headers({ 'Content-Type': 'application/json' }), id, text, author);
  }

  private _headers(
    extra?: Record<string, string>,
  ): Record<string, string> {
    const h: Record<string, string> = { 'X-Drift-Client': 'vscode', ...extra };
    if (this._authToken) {
      h['Authorization'] = `Bearer ${this._authToken}`;
    }
    return h;
  }
}
