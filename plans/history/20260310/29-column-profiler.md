# Feature 29: Smart Column Profiler

## What It Does

Click any column in the tree view or table viewer and see a full statistical profile: min/max/mean/median, value distribution histogram, top 10 most common values, null percentage, unique count, standard deviation. A mini data-science panel per column, built entirely from SQL aggregate queries.

## User Experience

1. Right-click a column in the tree view → "Profile Column"
2. Or: click a column header in the table data viewer
3. A panel opens with the full profile:

```
╔═══════════════════════════════════════════════════════════╗
║  COLUMN PROFILE: users.age  (INTEGER)                     ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  ┌─ Summary ─────────────────────────────────────────┐   ║
║  │  Total rows:     1,250                             │   ║
║  │  Non-null:       1,230 (98.4%)                     │   ║
║  │  Null:              20 (1.6%)                      │   ║
║  │  Distinct values:  63                              │   ║
║  │  Unique (appear once): 12                          │   ║
║  └────────────────────────────────────────────────────┘   ║
║                                                           ║
║  ┌─ Numeric Stats ───────────────────────────────────┐   ║
║  │  Min:      18        Mean:    34.7                 │   ║
║  │  Max:      79        Median:  32                   │   ║
║  │  Std Dev:  12.3                                    │   ║
║  └────────────────────────────────────────────────────┘   ║
║                                                           ║
║  ┌─ Distribution (10 buckets) ───────────────────────┐   ║
║  │  18-24  ████████████████  312 (25.4%)             │   ║
║  │  25-30  ██████████████    280 (22.8%)             │   ║
║  │  31-36  ██████████        198 (16.1%)             │   ║
║  │  37-42  ████████          154 (12.5%)             │   ║
║  │  43-48  █████              98 (8.0%)              │   ║
║  │  49-54  ████               76 (6.2%)              │   ║
║  │  55-60  ███                52 (4.2%)              │   ║
║  │  61-66  ██                 32 (2.6%)              │   ║
║  │  67-72  █                  18 (1.5%)              │   ║
║  │  73-79  █                  10 (0.8%)              │   ║
║  └────────────────────────────────────────────────────┘   ║
║                                                           ║
║  ┌─ Top 10 Values ───────────────────────────────────┐   ║
║  │   1. 25    — 48 occurrences (3.9%)                │   ║
║  │   2. 28    — 45 occurrences (3.7%)                │   ║
║  │   3. 22    — 42 occurrences (3.4%)                │   ║
║  │   4. 30    — 39 occurrences (3.2%)                │   ║
║  │   5. 27    — 38 occurrences (3.1%)                │   ║
║  │   ...                                              │   ║
║  └────────────────────────────────────────────────────┘   ║
║                                                           ║
║  ┌─ Anomalies ───────────────────────────────────────┐   ║
║  │  ⚠ 20 NULL values (1.6%)                          │   ║
║  │  ℹ No outliers detected (IQR method)              │   ║
║  └────────────────────────────────────────────────────┘   ║
╚═══════════════════════════════════════════════════════════╝
```

For TEXT columns, the profile shows different stats:

```
╔═══════════════════════════════════════════════════════════╗
║  COLUMN PROFILE: users.email  (TEXT)                      ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  ┌─ Summary ─────────────────────────────────────────┐   ║
║  │  Total rows:     1,250                             │   ║
║  │  Non-null:       1,248 (99.8%)                     │   ║
║  │  Null:               2 (0.2%)                      │   ║
║  │  Distinct values: 1,248                            │   ║
║  │  Empty strings:      0                             │   ║
║  └────────────────────────────────────────────────────┘   ║
║                                                           ║
║  ┌─ Text Stats ──────────────────────────────────────┐   ║
║  │  Min length:   8         Avg length:  22.4        │   ║
║  │  Max length:  45                                   │   ║
║  └────────────────────────────────────────────────────┘   ║
║                                                           ║
║  ┌─ Length Distribution ─────────────────────────────┐   ║
║  │   8-11  ██████            120 (9.6%)              │   ║
║  │  12-15  ██████████████    280 (22.4%)             │   ║
║  │  16-19  ██████████████████ 350 (28.0%)            │   ║
║  │  20-23  ████████████      240 (19.2%)             │   ║
║  │  24-27  ██████            120 (9.6%)              │   ║
║  │  28-31  ████               80 (6.4%)              │   ║
║  │  32-35  ██                 38 (3.0%)              │   ║
║  │  36-39  █                  15 (1.2%)              │   ║
║  │  40-45  ▏                   5 (0.4%)              │   ║
║  └────────────────────────────────────────────────────┘   ║
║                                                           ║
║  ┌─ Domain Breakdown ────────────────────────────────┐   ║
║  │  @gmail.com       — 520 (41.7%)                   │   ║
║  │  @yahoo.com       — 180 (14.4%)                   │   ║
║  │  @example.com     — 150 (12.0%)                   │   ║
║  │  @hotmail.com     — 120 (9.6%)                    │   ║
║  │  (other 28 domains) — 278 (22.3%)                 │   ║
║  └────────────────────────────────────────────────────┘   ║
╚═══════════════════════════════════════════════════════════╝
```

## New Files

```
extension/src/
  profiler/
    profiler-panel.ts          # Webview panel lifecycle
    profiler-html.ts           # HTML/CSS/JS template with SVG charts
    profiler-queries.ts        # Generates the SQL aggregate queries
    profiler-types.ts          # Result interfaces
extension/src/test/
  profiler-queries.test.ts
```

## Dependencies

- `api-client.ts` — `sql()` for running aggregate queries, `schemaMetadata()` for column type info

## Architecture

### Profile Queries

All statistics are computed via SQL — no data is transferred to the extension beyond aggregate results:

```typescript
class ProfilerQueries {
  buildQueries(table: string, column: string, type: string): IProfileQuery[] {
    const col = `"${column}"`;
    const tbl = `"${table}"`;
    const isNumeric = /INT|REAL|FLOAT|DOUBLE|DECIMAL|NUMERIC/i.test(type);
    const queries: IProfileQuery[] = [];

    // Universal stats
    queries.push({
      name: 'summary',
      sql: `SELECT
        COUNT(*) AS total,
        COUNT(${col}) AS non_null,
        COUNT(*) - COUNT(${col}) AS null_count,
        COUNT(DISTINCT ${col}) AS distinct_count
        FROM ${tbl}`,
    });

    // Top values
    queries.push({
      name: 'topValues',
      sql: `SELECT ${col} AS value, COUNT(*) AS cnt
        FROM ${tbl}
        WHERE ${col} IS NOT NULL
        GROUP BY ${col}
        ORDER BY cnt DESC
        LIMIT 10`,
    });

    if (isNumeric) {
      // Numeric stats
      queries.push({
        name: 'numericStats',
        sql: `SELECT
          MIN(${col}) AS min_val,
          MAX(${col}) AS max_val,
          AVG(${col}) AS mean_val,
          SUM(${col} * ${col}) / COUNT(${col}) - AVG(${col}) * AVG(${col}) AS variance
          FROM ${tbl}
          WHERE ${col} IS NOT NULL`,
      });

      // Median (SQLite doesn't have a MEDIAN function)
      queries.push({
        name: 'median',
        sql: `SELECT ${col} AS median_val
          FROM ${tbl}
          WHERE ${col} IS NOT NULL
          ORDER BY ${col}
          LIMIT 1
          OFFSET (SELECT COUNT(${col}) / 2 FROM ${tbl} WHERE ${col} IS NOT NULL)`,
      });

      // Histogram (10 buckets)
      queries.push({
        name: 'histogram',
        sql: `WITH bounds AS (
            SELECT MIN(${col}) AS lo, MAX(${col}) AS hi FROM ${tbl} WHERE ${col} IS NOT NULL
          ),
          buckets AS (
            SELECT ${col},
              CASE WHEN hi = lo THEN 0
              ELSE MIN(CAST((${col} - lo) * 10.0 / (hi - lo) AS INT), 9)
              END AS bucket
            FROM ${tbl}, bounds
            WHERE ${col} IS NOT NULL
          )
          SELECT bucket, COUNT(*) AS cnt, MIN(${col}) AS bucket_min, MAX(${col}) AS bucket_max
          FROM buckets
          GROUP BY bucket
          ORDER BY bucket`,
      });

      // Outliers (IQR method)
      queries.push({
        name: 'outliers',
        sql: `WITH ordered AS (
            SELECT ${col}, ROW_NUMBER() OVER (ORDER BY ${col}) AS rn,
              COUNT(*) OVER () AS total
            FROM ${tbl} WHERE ${col} IS NOT NULL
          ),
          quartiles AS (
            SELECT
              (SELECT ${col} FROM ordered WHERE rn = total / 4) AS q1,
              (SELECT ${col} FROM ordered WHERE rn = total * 3 / 4) AS q3
          )
          SELECT COUNT(*) AS outlier_count
          FROM ${tbl}, quartiles
          WHERE ${col} IS NOT NULL
            AND (${col} < q1 - 1.5 * (q3 - q1) OR ${col} > q3 + 1.5 * (q3 - q1))`,
      });
    } else {
      // Text stats
      queries.push({
        name: 'textStats',
        sql: `SELECT
          MIN(LENGTH(${col})) AS min_len,
          MAX(LENGTH(${col})) AS max_len,
          AVG(LENGTH(${col})) AS avg_len,
          SUM(CASE WHEN ${col} = '' THEN 1 ELSE 0 END) AS empty_count
          FROM ${tbl}
          WHERE ${col} IS NOT NULL`,
      });

      // Length distribution (10 buckets)
      queries.push({
        name: 'lengthHistogram',
        sql: `WITH bounds AS (
            SELECT MIN(LENGTH(${col})) AS lo, MAX(LENGTH(${col})) AS hi
            FROM ${tbl} WHERE ${col} IS NOT NULL AND ${col} != ''
          ),
          buckets AS (
            SELECT LENGTH(${col}) AS len,
              CASE WHEN hi = lo THEN 0
              ELSE MIN(CAST((LENGTH(${col}) - lo) * 10.0 / (hi - lo) AS INT), 9)
              END AS bucket
            FROM ${tbl}, bounds
            WHERE ${col} IS NOT NULL AND ${col} != ''
          )
          SELECT bucket, COUNT(*) AS cnt, MIN(len) AS bucket_min, MAX(len) AS bucket_max
          FROM buckets
          GROUP BY bucket
          ORDER BY bucket`,
      });

      // Pattern extraction (e.g., email domains)
      queries.push({
        name: 'patterns',
        sql: `SELECT
          SUBSTR(${col}, INSTR(${col}, '@')) AS pattern,
          COUNT(*) AS cnt
          FROM ${tbl}
          WHERE ${col} IS NOT NULL AND INSTR(${col}, '@') > 0
          GROUP BY pattern
          ORDER BY cnt DESC
          LIMIT 10`,
      });
    }

    return queries;
  }
}
```

### Profile Result

```typescript
interface IColumnProfile {
  table: string;
  column: string;
  type: string;
  isNumeric: boolean;

  // Universal
  totalRows: number;
  nonNullCount: number;
  nullCount: number;
  nullPercentage: number;
  distinctCount: number;
  topValues: { value: unknown; count: number; percentage: number }[];

  // Numeric only
  min?: number;
  max?: number;
  mean?: number;
  median?: number;
  stdDev?: number;
  histogram?: { bucketMin: number; bucketMax: number; count: number; percentage: number }[];
  outlierCount?: number;

  // Text only
  minLength?: number;
  maxLength?: number;
  avgLength?: number;
  emptyCount?: number;
  lengthHistogram?: { bucketMin: number; bucketMax: number; count: number; percentage: number }[];
  patterns?: { pattern: string; count: number; percentage: number }[];
}
```

### HTML Rendering

Histograms rendered as inline SVG bar charts:

```typescript
function renderHistogram(
  bins: { label: string; count: number; percentage: number }[],
): string {
  const maxCount = Math.max(...bins.map(b => b.count));
  const barWidth = 200;

  return bins.map(bin => {
    const width = maxCount > 0 ? (bin.count / maxCount) * barWidth : 0;
    return `
      <div class="hist-row">
        <span class="hist-label">${esc(bin.label)}</span>
        <div class="hist-bar" style="width: ${width}px"></div>
        <span class="hist-count">${bin.count} (${bin.percentage.toFixed(1)}%)</span>
      </div>
    `;
  }).join('');
}
```

## Server-Side Changes

None. All queries use existing `POST /api/sql`.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.profileColumn",
        "title": "Saropa Drift Advisor: Profile Column",
        "icon": "$(graph)"
      }
    ],
    "menus": {
      "view/item/context": [{
        "command": "driftViewer.profileColumn",
        "when": "viewItem == driftColumn",
        "group": "3_profile"
      }]
    }
  }
}
```

## Wiring in extension.ts

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.profileColumn', async (item?: ColumnItem) => {
    let table: string;
    let column: string;

    if (item) {
      table = item.tableName;
      column = item.columnMetadata.name;
    } else {
      table = await pickTable(client) ?? '';
      if (!table) return;
      column = await pickColumn(client, table) ?? '';
      if (!column) return;
    }

    const meta = await client.schemaMetadata();
    const colMeta = meta.tables
      .find(t => t.name === table)?.columns
      .find(c => c.name === column);
    if (!colMeta) return;

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Profiling ${table}.${column}…` },
      async () => {
        const queryBuilder = new ProfilerQueries();
        const queries = queryBuilder.buildQueries(table, column, colMeta.type);
        const results = new Map<string, object[]>();

        for (const q of queries) {
          try {
            const result = await client.sql(q.sql);
            results.set(q.name, result.rows);
          } catch {
            // Some queries may fail on unusual data — skip gracefully
          }
        }

        const profile = assembleProfile(table, column, colMeta.type, results);
        ProfilerPanel.createOrShow(context.extensionUri, profile);
      }
    );
  })
);
```

## Testing

- `profiler-queries.test.ts`:
  - Numeric column → generates numericStats, median, histogram, outliers queries
  - Text column → generates textStats, lengthHistogram, patterns queries
  - All columns → summary and topValues queries
  - Generated SQL is syntactically valid
  - Histogram bucket query handles min = max edge case
  - Column/table names are properly quoted

## Known Limitations

- Median query uses OFFSET — O(n log n) for large tables; may be slow on 100k+ rows
- Histogram uses 10 fixed buckets — not configurable
- Pattern extraction only detects `@` patterns (emails) — no generic pattern inference
- Standard deviation computed from variance formula — may have floating point drift
- IQR outlier detection only works for numeric columns
- All queries run sequentially — could parallelize for faster profiling
- No caching — profiling the same column twice re-runs all queries
- Window functions (ROW_NUMBER, COUNT OVER) require SQLite 3.25+ — older versions will fail
