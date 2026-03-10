# Feature 30: Database Health Score

## What It Does

A single-pane dashboard showing an overall letter grade (A–F) for the database, computed from weighted sub-scores: index coverage, FK integrity, null density, query performance, table size balance, and schema completeness. Each metric card links to the relevant existing tool. Like Lighthouse for your database.

## User Experience

1. Command palette → "Drift Viewer: Database Health Score" or activity bar icon
2. A webview panel opens with the dashboard:

```
╔═══════════════════════════════════════════════════════════╗
║  DATABASE HEALTH SCORE                    [Refresh]       ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║              ┌───────────────────┐                        ║
║              │                   │                        ║
║              │        A-         │                        ║
║              │                   │                        ║
║              │    Score: 87/100  │                        ║
║              └───────────────────┘                        ║
║                                                           ║
║  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐        ║
║  │ INDEX       │ │ FK          │ │ NULLS       │        ║
║  │ COVERAGE    │ │ INTEGRITY   │ │ DENSITY     │        ║
║  │             │ │             │ │             │        ║
║  │   92/100    │ │  100/100    │ │   85/100    │        ║
║  │   A         │ │   A+        │ │   B+        │        ║
║  │             │ │             │ │             │        ║
║  │ 11/12 cols  │ │ 0 orphans   │ │ 2.1% null   │        ║
║  │ indexed     │ │             │ │ avg         │        ║
║  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘        ║
║         │               │               │                ║
║  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐        ║
║  │ QUERY       │ │ TABLE       │ │ SCHEMA      │        ║
║  │ PERFORMANCE │ │ BALANCE     │ │ QUALITY     │        ║
║  │             │ │             │ │             │        ║
║  │   78/100    │ │   72/100    │ │   95/100    │        ║
║  │   B         │ │   B-        │ │   A         │        ║
║  │             │ │             │ │             │        ║
║  │ 3 slow      │ │ 1 table has │ │ 1 missing   │        ║
║  │ queries     │ │ 85% of data │ │ FK          │        ║
║  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘        ║
║         │               │               │                ║
║  Click any card to see details and recommendations       ║
║                                                           ║
║  ┌─ Recommendations ────────────────────────────────┐    ║
║  │  1. ⚠ Add index on orders.user_id (used in 12   │    ║
║  │     queries, no covering index)                   │    ║
║  │  2. ℹ Table "audit_log" has 45,000 rows (85% of │    ║
║  │     total DB size) — consider archiving           │    ║
║  │  3. ℹ Column "users.middle_name" is 94% NULL —   │    ║
║  │     consider making it optional or removing       │    ║
║  └───────────────────────────────────────────────────┘   ║
╚═══════════════════════════════════════════════════════════╝
```

3. Click any metric card → opens the relevant existing panel (index suggestions, anomaly viewer, performance panel, etc.)
4. Recommendations section lists actionable items sorted by impact

## New Files

```
extension/src/
  health/
    health-panel.ts            # Webview panel lifecycle
    health-html.ts             # HTML/CSS/JS template with score cards
    health-scorer.ts           # Computes individual and overall scores
    health-types.ts            # Score interfaces
extension/src/test/
  health-scorer.test.ts
```

## Dependencies

- `api-client.ts` — `indexSuggestions()`, `anomalies()`, `performance()`, `sizeAnalytics()`, `schemaMetadata()`, `tableFkMeta()`

## Architecture

### Health Scorer

Computes six sub-scores and a weighted overall score:

```typescript
interface IHealthScore {
  overall: number;           // 0–100
  grade: string;             // A+ through F
  metrics: IHealthMetric[];
  recommendations: IRecommendation[];
}

interface IHealthMetric {
  name: string;
  key: 'indexCoverage' | 'fkIntegrity' | 'nullDensity' | 'queryPerformance' | 'tableBalance' | 'schemaQuality';
  score: number;             // 0–100
  grade: string;
  weight: number;            // 0.0–1.0 (all weights sum to 1.0)
  summary: string;           // "11/12 columns indexed"
  details: string[];         // Detailed findings
  linkedCommand?: string;    // VS Code command to open relevant panel
}

interface IRecommendation {
  severity: 'error' | 'warning' | 'info';
  message: string;
  metric: string;
}

class HealthScorer {
  private static readonly WEIGHTS: Record<string, number> = {
    indexCoverage: 0.25,
    fkIntegrity: 0.20,
    nullDensity: 0.15,
    queryPerformance: 0.15,
    tableBalance: 0.10,
    schemaQuality: 0.15,
  };

  async compute(client: DriftApiClient): Promise<IHealthScore> {
    const metrics = await Promise.all([
      this._scoreIndexCoverage(client),
      this._scoreFkIntegrity(client),
      this._scoreNullDensity(client),
      this._scoreQueryPerformance(client),
      this._scoreTableBalance(client),
      this._scoreSchemaQuality(client),
    ]);

    const overall = metrics.reduce((sum, m) => sum + m.score * m.weight, 0);
    const recommendations = this._generateRecommendations(metrics);

    return {
      overall: Math.round(overall),
      grade: this._toGrade(overall),
      metrics,
      recommendations,
    };
  }

  private async _scoreIndexCoverage(client: DriftApiClient): Promise<IHealthMetric> {
    const suggestions = await client.indexSuggestions();
    const meta = await client.schemaMetadata();

    // Count FK columns and columns used in WHERE clauses that lack indexes
    const totalFkColumns = /* count from FK metadata */0;
    const indexedFkColumns = totalFkColumns - suggestions.suggestions.length;
    const ratio = totalFkColumns > 0 ? indexedFkColumns / totalFkColumns : 1;

    return {
      name: 'Index Coverage',
      key: 'indexCoverage',
      score: Math.round(ratio * 100),
      grade: this._toGrade(ratio * 100),
      weight: HealthScorer.WEIGHTS.indexCoverage,
      summary: `${indexedFkColumns}/${totalFkColumns} FK columns indexed`,
      details: suggestions.suggestions.map(
        (s: { table: string; column: string }) => `Missing: ${s.table}.${s.column}`
      ),
      linkedCommand: 'driftViewer.showIndexSuggestions',
    };
  }

  private async _scoreFkIntegrity(client: DriftApiClient): Promise<IHealthMetric> {
    const anomalies = await client.anomalies();
    const orphans = anomalies.anomalies?.filter(
      (a: { type: string }) => a.type === 'orphaned_fk'
    ) ?? [];

    const score = orphans.length === 0 ? 100 : Math.max(0, 100 - orphans.length * 10);

    return {
      name: 'FK Integrity',
      key: 'fkIntegrity',
      score,
      grade: this._toGrade(score),
      weight: HealthScorer.WEIGHTS.fkIntegrity,
      summary: `${orphans.length} orphaned FK reference(s)`,
      details: orphans.map(
        (o: { table: string; column: string; count: number }) =>
          `${o.table}.${o.column}: ${o.count} orphan(s)`
      ),
      linkedCommand: 'driftViewer.showAnomalies',
    };
  }

  private async _scoreNullDensity(client: DriftApiClient): Promise<IHealthMetric> {
    const meta = await client.schemaMetadata();
    let totalCells = 0;
    let nullCells = 0;
    const highNullColumns: string[] = [];

    for (const table of meta.tables) {
      if (table.name.startsWith('sqlite_')) continue;
      for (const col of table.columns) {
        const result = await client.sql(
          `SELECT COUNT(*) - COUNT("${col.name}") AS nulls, COUNT(*) AS total FROM "${table.name}"`
        );
        const row = result.rows[0] as { nulls: number; total: number };
        totalCells += row.total;
        nullCells += row.nulls;

        const pct = row.total > 0 ? row.nulls / row.total : 0;
        if (pct > 0.5 && row.total > 10) {
          highNullColumns.push(`${table.name}.${col.name} (${(pct * 100).toFixed(0)}%)`);
        }
      }
    }

    const nullPct = totalCells > 0 ? nullCells / totalCells : 0;
    const score = Math.round(Math.max(0, 100 - nullPct * 500)); // 20%+ null = 0

    return {
      name: 'Null Density',
      key: 'nullDensity',
      score,
      grade: this._toGrade(score),
      weight: HealthScorer.WEIGHTS.nullDensity,
      summary: `${(nullPct * 100).toFixed(1)}% null average`,
      details: highNullColumns.map(c => `High null: ${c}`),
    };
  }

  private async _scoreQueryPerformance(client: DriftApiClient): Promise<IHealthMetric> {
    const perf = await client.performance();
    const slowThreshold = 100; // ms
    const slowQueries = perf.queries?.filter(
      (q: { avgMs: number }) => q.avgMs > slowThreshold
    ) ?? [];

    const ratio = perf.queries?.length > 0
      ? 1 - slowQueries.length / perf.queries.length
      : 1;
    const score = Math.round(ratio * 100);

    return {
      name: 'Query Performance',
      key: 'queryPerformance',
      score,
      grade: this._toGrade(score),
      weight: HealthScorer.WEIGHTS.queryPerformance,
      summary: `${slowQueries.length} slow queries (>${slowThreshold}ms)`,
      details: slowQueries.slice(0, 5).map(
        (q: { sql: string; avgMs: number }) =>
          `${q.avgMs.toFixed(0)}ms: ${q.sql.substring(0, 60)}…`
      ),
      linkedCommand: 'driftViewer.showPerformance',
    };
  }

  private async _scoreTableBalance(client: DriftApiClient): Promise<IHealthMetric> {
    const size = await client.sizeAnalytics();
    const tables = size.tables ?? [];
    const totalRows = tables.reduce((s: number, t: { rowCount: number }) => s + t.rowCount, 0);
    const details: string[] = [];

    let maxPct = 0;
    for (const t of tables) {
      const pct = totalRows > 0 ? t.rowCount / totalRows : 0;
      if (pct > maxPct) maxPct = pct;
      if (pct > 0.5) {
        details.push(`${t.name} has ${(pct * 100).toFixed(0)}% of all rows`);
      }
    }

    // Score: 100 if balanced, 0 if one table has 100% of data
    const score = Math.round((1 - Math.max(0, maxPct - 0.3) / 0.7) * 100);

    return {
      name: 'Table Balance',
      key: 'tableBalance',
      score: Math.max(0, Math.min(100, score)),
      grade: this._toGrade(score),
      weight: HealthScorer.WEIGHTS.tableBalance,
      summary: details.length > 0 ? details[0] : 'Data evenly distributed',
      details,
      linkedCommand: 'driftViewer.showSizeAnalytics',
    };
  }

  private async _scoreSchemaQuality(client: DriftApiClient): Promise<IHealthMetric> {
    const meta = await client.schemaMetadata();
    const details: string[] = [];
    let issues = 0;

    for (const table of meta.tables) {
      if (table.name.startsWith('sqlite_')) continue;

      // Check for PK
      const hasPk = table.columns.some(c => c.pk);
      if (!hasPk) {
        details.push(`${table.name}: no primary key`);
        issues++;
      }

      // Check for tables with no FK relationships (isolated)
      const fks = await client.tableFkMeta(table.name);
      // (FK check is lightweight — just metadata)
    }

    const totalTables = meta.tables.filter(t => !t.name.startsWith('sqlite_')).length;
    const score = totalTables > 0
      ? Math.round((1 - issues / totalTables) * 100)
      : 100;

    return {
      name: 'Schema Quality',
      key: 'schemaQuality',
      score,
      grade: this._toGrade(score),
      weight: HealthScorer.WEIGHTS.schemaQuality,
      summary: `${issues} schema issue(s)`,
      details,
      linkedCommand: 'driftViewer.runSchemaLinter',
    };
  }

  private _toGrade(score: number): string {
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

  private _generateRecommendations(metrics: IHealthMetric[]): IRecommendation[] {
    const recs: IRecommendation[] = [];
    for (const m of metrics) {
      for (const detail of m.details) {
        recs.push({
          severity: m.score < 50 ? 'error' : m.score < 80 ? 'warning' : 'info',
          message: detail,
          metric: m.name,
        });
      }
    }
    return recs.sort((a, b) => {
      const order = { error: 0, warning: 1, info: 2 };
      return order[a.severity] - order[b.severity];
    });
  }
}
```

### Grade Color Mapping

```css
.grade-a { color: #22c55e; }  /* green */
.grade-b { color: #84cc16; }  /* lime */
.grade-c { color: #eab308; }  /* yellow */
.grade-d { color: #f97316; }  /* orange */
.grade-f { color: #ef4444; }  /* red */
```

## Server-Side Changes

None. Uses existing endpoints: `indexSuggestions()`, `anomalies()`, `performance()`, `sizeAnalytics()`, `schemaMetadata()`, `tableFkMeta()`.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.healthScore",
        "title": "Drift Viewer: Database Health Score",
        "icon": "$(heart)"
      }
    ],
    "menus": {
      "view/title": [{
        "command": "driftViewer.healthScore",
        "when": "view == driftViewer.databaseExplorer && driftViewer.serverConnected",
        "group": "navigation"
      }]
    }
  }
}
```

## Wiring in extension.ts

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.healthScore', async () => {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Computing health score…' },
      async () => {
        const scorer = new HealthScorer();
        const score = await scorer.compute(client);
        HealthPanel.createOrShow(context.extensionUri, score);
      }
    );
  })
);
```

## Testing

- `health-scorer.test.ts`:
  - Perfect database → A+ grade, 100 score
  - Missing indexes → indexCoverage score drops proportionally
  - Orphaned FKs → fkIntegrity score drops (10 points per orphan)
  - High null density → nullDensity score drops
  - Slow queries → queryPerformance score drops
  - Imbalanced tables → tableBalance score drops
  - Missing PKs → schemaQuality score drops
  - All weights sum to 1.0
  - Grade boundaries are correct (97=A+, 93=A, 90=A-, etc.)
  - Recommendations sorted by severity (errors first)
  - Empty database → score 100 (no issues possible)

## Known Limitations

- Null density scoring queries every column individually — slow for wide schemas (100+ columns)
- Query performance requires the performance panel to have collected data — empty on fresh start
- Table balance metric doesn't account for expected asymmetry (audit logs are naturally large)
- Schema quality checks are basic (PK presence only) — no constraint or normalization analysis
- No historical tracking — can't show "health improved since yesterday"
- Score weights are fixed — not user-configurable
- Grade boundaries are subjective — may not match user expectations
- All metrics computed sequentially — could parallelize for speed
