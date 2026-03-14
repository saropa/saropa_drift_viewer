/** Health metric scoring functions (0–100 per metric). Used by HealthScorer. */

import type { DriftApiClient } from '../api-client';
import type {
  Anomaly, ForeignKey, IndexSuggestion,
  ISizeAnalytics, PerformanceData, TableMetadata,
} from '../api-types';
import type {
  IHealthMetric, IMetricAction, MetricKey,
} from './health-types';
import { sqlId, toGrade } from './health-utils';

/** Prefetched API data shared across all scoring methods. */
export interface PrefetchedData {
  tables: TableMetadata[];
  userTables: TableMetadata[];
  fkMap: Map<string, ForeignKey[]>;
  suggestions: IndexSuggestion[];
  anomalies: Anomaly[];
  performance: PerformanceData;
  size: ISizeAnalytics;
}

/** Weights per metric (sum to 1.0). Exported for HealthScorer and tests. */
export const HEALTH_WEIGHTS: Record<MetricKey, number> = {
  indexCoverage: 0.25,
  fkIntegrity: 0.20,
  nullDensity: 0.15,
  queryPerformance: 0.15,
  tableBalance: 0.10,
  schemaQuality: 0.15,
};

/** Score index coverage: ratio of FK columns that have indexes. */
export function scoreIndexCoverage(data: PrefetchedData, weight: number): IHealthMetric {
  let totalFkColumns = 0;
  for (const table of data.userTables) {
    totalFkColumns += (data.fkMap.get(table.name) ?? []).length;
  }

  const missingIndexes = data.suggestions.length;
  const indexedFkColumns = Math.max(0, totalFkColumns - missingIndexes);
  const ratio = totalFkColumns > 0 ? indexedFkColumns / totalFkColumns : 1;
  const score = Math.round(ratio * 100);

  const actions: IMetricAction[] = [];
  if (data.suggestions.length > 0) {
    actions.push({
      label: 'View Missing',
      icon: '🔍',
      command: 'driftViewer.showIndexSuggestions',
    });
    actions.push({
      label: 'Create All Indexes',
      icon: '🔧',
      command: 'driftViewer.createAllIndexes',
      args: { indexes: data.suggestions },
    });
  }

  return {
    name: 'Index Coverage',
    key: 'indexCoverage',
    score,
    grade: toGrade(score),
    weight,
    summary: `${indexedFkColumns}/${totalFkColumns} FK columns indexed`,
    details: data.suggestions.map(
      (s) => `Missing: ${s.table}.${s.column}`,
    ),
    linkedCommand: 'driftViewer.runLinter',
    actions,
  };
}

/** Score FK integrity from anomaly errors (10 points per error). */
export function scoreFkIntegrity(data: PrefetchedData, weight: number): IHealthMetric {
  const errors = data.anomalies.filter((a) => a.severity === 'error');
  const score = Math.max(0, 100 - errors.length * 10);

  const actions: IMetricAction[] = [];
  if (errors.length > 0) {
    actions.push({
      label: 'View Issues',
      icon: '🔍',
      command: 'driftViewer.showAnomalies',
      args: { filter: 'error' },
    });
    actions.push({
      label: 'Generate Fix SQL',
      icon: '🔧',
      command: 'driftViewer.generateAnomalyFixes',
      args: { anomalies: errors },
    });
  }

  return {
    name: 'FK Integrity',
    key: 'fkIntegrity',
    score,
    grade: toGrade(score),
    weight,
    summary: `${errors.length} data integrity error(s)`,
    details: errors.map((e) => e.message),
    linkedCommand: 'driftViewer.runLinter',
    actions,
  };
}

/** Score null density: lower score when many cells are null (20%+ null → 0). */
export async function scoreNullDensity(
  data: PrefetchedData, client: DriftApiClient, weight: number,
): Promise<IHealthMetric> {
  let totalCells = 0;
  let nullCells = 0;
  const highNullColumns: { table: string; column: string; pct: number }[] = [];

  for (const table of data.userTables) {
    if (table.rowCount === 0) continue;

    const nullExprs = table.columns.map(
      (c) => `SUM(CASE WHEN "${sqlId(c.name)}" IS NULL THEN 1 ELSE 0 END)`,
    );
    const result = await client.sql(
      `SELECT COUNT(*) AS total, ${nullExprs.join(', ')} FROM "${sqlId(table.name)}"`,
    );
    const row = result.rows[0];
    if (!row) continue;

    const rowCount = Number(row[0]) || 0;
    for (let i = 0; i < table.columns.length; i++) {
      const colNulls = Number(row[i + 1]) || 0;
      totalCells += rowCount;
      nullCells += colNulls;

      const pct = rowCount > 0 ? colNulls / rowCount : 0;
      if (pct > 0.5 && rowCount > 10) {
        highNullColumns.push({
          table: table.name,
          column: table.columns[i].name,
          pct,
        });
      }
    }
  }

  const nullPct = totalCells > 0 ? nullCells / totalCells : 0;
  const score = Math.round(Math.max(0, 100 - nullPct * 500)); // 20%+ null = 0

  const actions: IMetricAction[] = [];
  if (highNullColumns.length > 0) {
    actions.push({
      label: 'Analyze Columns',
      icon: '📊',
      command: 'driftViewer.profileColumn',
      args: { table: highNullColumns[0].table, column: highNullColumns[0].column },
    });
  }

  return {
    name: 'Null Density',
    key: 'nullDensity',
    score,
    grade: toGrade(score),
    weight,
    summary: `${(nullPct * 100).toFixed(1)}% null average`,
    details: highNullColumns.map(
      (c) => `High null: ${c.table}.${c.column} (${(c.pct * 100).toFixed(0)}%)`,
    ),
    actions,
  };
}

/** Score query performance from slow-query ratio. */
export function scoreQueryPerformance(data: PrefetchedData, weight: number): IHealthMetric {
  const perf = data.performance;
  const slowCount = perf.slowQueries.length;
  const total = Math.max(perf.totalQueries, 1);
  const ratio = 1 - slowCount / total;
  const score = Math.round(Math.max(0, Math.min(100, ratio * 100)));

  const actions: IMetricAction[] = [];
  if (slowCount > 0) {
    const slowestQuery = perf.slowQueries[0];
    actions.push({
      label: 'View Performance',
      icon: '📊',
      command: 'driftViewer.refreshPerformance',
    });
    if (slowestQuery) {
      actions.push({
        label: 'Analyze Slowest',
        icon: '🔍',
        command: 'driftViewer.analyzeQueryCost',
        args: { sql: slowestQuery.sql },
      });
    }
  }

  return {
    name: 'Query Performance',
    key: 'queryPerformance',
    score,
    grade: toGrade(score),
    weight,
    summary: `${slowCount} slow query(s)`,
    details: perf.slowQueries.slice(0, 5).map(
      (q) => `${q.durationMs.toFixed(0)}ms: ${q.sql.substring(0, 60)}`,
    ),
    linkedCommand: 'driftViewer.refreshPerformance',
    actions,
  };
}

export { scoreTableBalance, scoreSchemaQuality, generateRecommendations } from './health-metrics-secondary';
