// ---- Existing types (re-exported by api-client.ts) ----

export interface TableMetadata {
  name: string;
  columns: ColumnMetadata[];
  rowCount: number;
}

export interface ColumnMetadata {
  name: string;
  type: string; // INTEGER, TEXT, REAL, BLOB
  pk: boolean;
  notnull?: boolean;
}

export interface ForeignKey {
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

export interface HealthResponse {
  ok: boolean;
  extensionConnected?: boolean;
}

export interface IndexSuggestion {
  table: string;
  column: string;
  reason: string;
  sql: string;
  priority: 'high' | 'medium' | 'low';
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

// ---- Schema diagram (GET /api/schema/diagram) ----

export interface IDiagramTable {
  name: string;
  columns: { name: string; type: string; pk: number }[];
}

export interface IDiagramForeignKey {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

export interface IDiagramData {
  tables: IDiagramTable[];
  foreignKeys: IDiagramForeignKey[];
}

// ---- Database comparison (GET /api/compare/report) ----

export interface ITableCountDiff {
  table: string;
  countA: number;
  countB: number;
  diff: number;
  onlyInA: boolean;
  onlyInB: boolean;
}

export interface ICompareReport {
  schemaSame: boolean;
  schemaDiff: { a: string; b: string } | null;
  tablesOnlyInA: string[];
  tablesOnlyInB: string[];
  tableCounts: ITableCountDiff[];
  generatedAt: string;
}

// ---- Migration preview (GET /api/migration/preview) ----

export interface IMigrationPreview {
  migrationSql: string;
  changeCount: number;
  hasWarnings: boolean;
  generatedAt: string;
}

// ---- Size analytics (GET /api/analytics/size) ----

export interface ITableSizeInfo {
  table: string;
  rowCount: number;
  columnCount: number;
  indexCount: number;
  indexes: string[];
}

export interface ISizeAnalytics {
  pageSize: number;
  pageCount: number;
  totalSizeBytes: number;
  freeSpaceBytes: number;
  usedSizeBytes: number;
  journalMode: string;
  tableCount: number;
  tables: ITableSizeInfo[];
}

// ---- Data import (POST /api/import) ----

export interface IImportResult {
  imported: number;
  errors: string[];
  format: string;
  table: string;
}

// ---- Sessions (POST /api/session/*) ----

export interface IAnnotation {
  text: string;
  author: string;
  at: string;
}

export interface ISessionShareResult {
  id: string;
  url: string;
  expiresAt: string;
}

export interface ISessionData {
  state: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
  annotations: IAnnotation[];
}
