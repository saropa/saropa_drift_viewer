/** Secondary health metric scorers and recommendation builder. */

import type { IHealthMetric, IMetricAction, IRecommendation } from './health-types';
import { toGrade } from './health-utils';
import type { PrefetchedData } from './health-metrics';

/** Score table balance: penalty when one table dominates row count (>30% is bad). */
export function scoreTableBalance(data: PrefetchedData, weight: number): IHealthMetric {
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
    weight,
    summary: details.length > 0 ? details[0] : 'Data evenly distributed',
    details,
    linkedCommand: 'driftViewer.sizeAnalytics',
    actions,
  };
}

/** Score schema quality: penalty for tables without primary key. */
export function scoreSchemaQuality(data: PrefetchedData, weight: number): IHealthMetric {
  const details: string[] = [];
  let issues = 0;

  for (const table of data.userTables) {
    const hasPk = table.columns.some((c) => c.pk);
    if (!hasPk) {
      details.push(`${table.name}: no primary key`);
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
    weight,
    summary: `${issues} schema issue(s)`,
    details,
    linkedCommand: 'driftViewer.runLinter',
    actions,
  };
}

/** Build recommendations from metric details, sorted by severity (error > warning > info). */
export function generateRecommendations(metrics: IHealthMetric[]): IRecommendation[] {
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
