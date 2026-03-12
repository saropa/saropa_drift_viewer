import type { DriftApiClient } from '../api-client';
import type {
  Anomaly, ForeignKey, IndexSuggestion,
  ISizeAnalytics, PerformanceData, TableMetadata,
} from '../api-types';
import type {
  IHealthMetric, IHealthScore, IMetricAction, IRecommendation, MetricKey,
} from './health-types';

/** Prefetched API data shared across all scoring methods. */
interface PrefetchedData {
  tables: TableMetadata[];
  userTables: TableMetadata[];
  fkMap: Map<string, ForeignKey[]>;
  suggestions: IndexSuggestion[];
  anomalies: Anomaly[];
  performance: PerformanceData;
  size: ISizeAnalytics;
}

export class HealthScorer {
  static readonly WEIGHTS: Record<MetricKey, number> = {
    indexCoverage: 0.25,
    fkIntegrity: 0.20,
    nullDensity: 0.15,
    queryPerformance: 0.15,
    tableBalance: 0.10,
    schemaQuality: 0.15,
  };

  async compute(client: DriftApiClient): Promise<IHealthScore> {
    const data = await this._prefetch(client);

    const metrics = await Promise.all([
      this._scoreIndexCoverage(data),
      this._scoreFkIntegrity(data),
      this._scoreNullDensity(data, client),
      this._scoreQueryPerformance(data),
      this._scoreTableBalance(data),
      this._scoreSchemaQuality(data),
    ]);

    const overall = metrics.reduce((sum, m) => sum + m.score * m.weight, 0);
    const recommendations = this._generateRecommendations(metrics);

    return {
      overall: Math.round(overall),
      grade: toGrade(overall),
      metrics,
      recommendations,
    };
  }

  /** Fetch all shared API data once, including FK metadata per table. */
  private async _prefetch(client: DriftApiClient): Promise<PrefetchedData> {
    const [tables, suggestions, anomalies, performance, size] = await Promise.all([
      client.schemaMetadata(),
      client.indexSuggestions(),
      client.anomalies(),
      client.performance(),
      client.sizeAnalytics(),
    ]);

    const userTables = tables.filter((t) => !t.name.startsWith('sqlite_'));

    // Fetch FK metadata for all user tables in parallel
    const fkMap = new Map<string, ForeignKey[]>();
    await Promise.all(userTables.map(async (t) => {
      fkMap.set(t.name, await client.tableFkMeta(t.name));
    }));

    return { tables, userTables, fkMap, suggestions, anomalies, performance, size };
  }

  private _scoreIndexCoverage(data: PrefetchedData): IHealthMetric {
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
      weight: HealthScorer.WEIGHTS.indexCoverage,
      summary: `${indexedFkColumns}/${totalFkColumns} FK columns indexed`,
      details: data.suggestions.map(
        (s) => `Missing: ${s.table}.${s.column}`,
      ),
      linkedCommand: 'driftViewer.runLinter',
      actions,
    };
  }

  private _scoreFkIntegrity(data: PrefetchedData): IHealthMetric {
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
      weight: HealthScorer.WEIGHTS.fkIntegrity,
      summary: `${errors.length} data integrity error(s)`,
      details: errors.map((e) => e.message),
      linkedCommand: 'driftViewer.runLinter',
      actions,
    };
  }

  private async _scoreNullDensity(
    data: PrefetchedData, client: DriftApiClient,
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
      weight: HealthScorer.WEIGHTS.nullDensity,
      summary: `${(nullPct * 100).toFixed(1)}% null average`,
      details: highNullColumns.map(
        (c) => `High null: ${c.table}.${c.column} (${(c.pct * 100).toFixed(0)}%)`,
      ),
      actions,
    };
  }

  private _scoreQueryPerformance(data: PrefetchedData): IHealthMetric {
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
      weight: HealthScorer.WEIGHTS.queryPerformance,
      summary: `${slowCount} slow query(s)`,
      details: perf.slowQueries.slice(0, 5).map(
        (q) => `${q.durationMs.toFixed(0)}ms: ${q.sql.substring(0, 60)}`,
      ),
      linkedCommand: 'driftViewer.refreshPerformance',
      actions,
    };
  }

  private _scoreTableBalance(data: PrefetchedData): IHealthMetric {
    const tables = data.size.tables ?? [];
    const totalRows = tables.reduce((s, t) => s + t.rowCount, 0);
    const details: string[] = [];
    let largestTable: string | undefined;

    let maxPct = 0;
    for (const t of tables) {
      const pct = totalRows > 0 ? t.rowCount / totalRows : 0;
      if (pct > maxPct) {
        maxPct = pct;
        largestTable = t.table;
      }
      if (pct > 0.5) {
        details.push(`${t.table} has ${(pct * 100).toFixed(0)}% of all rows`);
      }
    }

    const raw = Math.round((1 - Math.max(0, maxPct - 0.3) / 0.7) * 100);
    const score = Math.max(0, Math.min(100, raw));

    const actions: IMetricAction[] = [
      {
        label: 'View Size Analytics',
        icon: '📊',
        command: 'driftViewer.sizeAnalytics',
      },
    ];
    if (largestTable && maxPct > 0.5) {
      actions.push({
        label: `Sample ${largestTable}`,
        icon: '🔍',
        command: 'driftViewer.sampleTable',
        args: { table: largestTable },
      });
    }

    return {
      name: 'Table Balance',
      key: 'tableBalance',
      score,
      grade: toGrade(score),
      weight: HealthScorer.WEIGHTS.tableBalance,
      summary: details.length > 0 ? details[0] : 'Data evenly distributed',
      details,
      linkedCommand: 'driftViewer.sizeAnalytics',
      actions,
    };
  }

  private _scoreSchemaQuality(data: PrefetchedData): IHealthMetric {
    const details: string[] = [];
    const tablesWithoutPk: string[] = [];
    let issues = 0;

    for (const table of data.userTables) {
      const hasPk = table.columns.some((c) => c.pk);
      if (!hasPk) {
        details.push(`${table.name}: no primary key`);
        tablesWithoutPk.push(table.name);
        issues++;
      }
    }

    const totalTables = data.userTables.length;
    const score = totalTables > 0
      ? Math.round((1 - issues / totalTables) * 100)
      : 100;

    const actions: IMetricAction[] = [];
    if (issues > 0) {
      actions.push({
        label: 'View Schema Diff',
        icon: '🔍',
        command: 'driftViewer.schemaDiff',
      });
      actions.push({
        label: 'Generate Migration',
        icon: '🔧',
        command: 'driftViewer.generateMigration',
      });
    }

    return {
      name: 'Schema Quality',
      key: 'schemaQuality',
      score,
      grade: toGrade(score),
      weight: HealthScorer.WEIGHTS.schemaQuality,
      summary: `${issues} schema issue(s)`,
      details,
      linkedCommand: 'driftViewer.runLinter',
      actions,
    };
  }

  private _generateRecommendations(metrics: IHealthMetric[]): IRecommendation[] {
    const recs: IRecommendation[] = [];
    for (const m of metrics) {
      for (const detail of m.details) {
        const rec: IRecommendation = {
          severity: m.score < 50 ? 'error' : m.score < 80 ? 'warning' : 'info',
          message: detail,
          metric: m.name,
        };
        if (m.actions && m.actions.length > 0) {
          rec.action = m.actions.find((a) => a.label.toLowerCase().includes('fix'))
            ?? m.actions[0];
        }
        recs.push(rec);
      }
    }
    return recs.sort((a, b) => {
      const order = { error: 0, warning: 1, info: 2 };
      return order[a.severity] - order[b.severity];
    });
  }
}

export function toGrade(score: number): string {
  if (score >= 97) return 'A+';
  if (score >= 93) return 'A';
  if (score >= 90) return 'A-';
  if (score >= 87) return 'B+';
  if (score >= 83) return 'B';
  if (score >= 80) return 'B-';
  if (score >= 77) return 'C+';
  if (score >= 73) return 'C';
  if (score >= 70) return 'C-';
  if (score >= 67) return 'D+';
  if (score >= 63) return 'D';
  if (score >= 60) return 'D-';
  return 'F';
}

/** Escape a SQL identifier for double-quote quoting. */
function sqlId(name: string): string {
  return name.replace(/"/g, '""');
}
