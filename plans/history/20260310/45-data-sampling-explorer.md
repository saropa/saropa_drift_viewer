# Feature 45: Data Sampling Explorer

## What It Does

Smart data exploration beyond simple `SELECT * LIMIT N`. Draw stratified random samples, slice data by percentile ranges, group into cohorts by any column, and compare distributions across segments. Answer questions like "show me a representative sample of users across all age brackets" or "what do the top 1% of orders by total look like?"

## User Experience

1. Right-click a table → "Explore Data Sample" or command palette → "Saropa Drift Advisor: Data Sampling Explorer"
2. Sampling configuration panel:

```
╔══════════════════════════════════════════════════════════════════╗
║  DATA SAMPLING — orders (3,400 rows)                            ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  Sampling Mode                                                  ║
║  ─────────────                                                   ║
║  (●) Random sample          Size: [50]                          ║
║  ( ) Stratified by column   Column: [status ▾]                  ║
║  ( ) Percentile slice       Column: [total  ▾]  Range: [90-100] ║
║  ( ) Cohort comparison      Column: [status ▾]                  ║
║                                                                  ║
║  [Sample]                                                        ║
║                                                                  ║
║  ┌─ Results ────────────────────────────────────────────────┐   ║
║  │                                                           │   ║
║  │  50 rows sampled (1.5% of table)                         │   ║
║  │                                                           │   ║
║  │  id  │ user_id │ total   │ status                        │   ║
║  │  ────┼─────────┼─────────┼────────                       │   ║
║  │  42  │ 12      │ $149.99 │ shipped                       │   ║
║  │  891 │ 55      │ $29.50  │ pending                       │   ║
║  │  203 │ 8       │ $340.00 │ shipped                       │   ║
║  │  ...                                                      │   ║
║  │                                                           │   ║
║  │  [Export CSV] [Copy SQL] [Open in Query]                  │   ║
║  └───────────────────────────────────────────────────────────┘   ║
╚══════════════════════════════════════════════════════════════════╝
```

### Stratified Sample Output

```
Stratified by "status" — 50 rows total
───────────────────────────────────────
  "pending"  — 15 rows (30% of sample, 28% of population)
  "shipped"  — 20 rows (40% of sample, 42% of population)
  "delivered"— 10 rows (20% of sample, 22% of population)
  "cancelled"— 5 rows  (10% of sample, 8% of population)
```

### Cohort Comparison

```
Cohort Analysis by "status"
────────────────────────────
           │ pending │ shipped │ delivered │ cancelled
───────────┼─────────┼─────────┼───────────┼──────────
Count      │ 952     │ 1,428   │ 748       │ 272
Avg total  │ $45.20  │ $89.10  │ $112.50   │ $32.80
Min total  │ $1.99   │ $5.00   │ $8.00     │ $1.99
Max total  │ $499.99 │ $999.00 │ $850.00   │ $299.00
Null rate  │ 2%      │ 0%      │ 0%        │ 5%
```

## New Files

```
extension/src/
  sampling/
    sampling-panel.ts          # Webview panel lifecycle
    sampling-html.ts           # HTML template
    sampling-engine.ts         # Builds sampling SQL queries
    sampling-types.ts          # Shared interfaces
extension/src/test/
  sampling-engine.test.ts
```

## Dependencies

- `api-client.ts` — `schemaMetadata()`, `sql()`

## Architecture

### Sampling Engine

Generates SQL for each sampling mode:

```typescript
type SamplingMode = 'random' | 'stratified' | 'percentile' | 'cohort';

interface ISamplingConfig {
  table: string;
  mode: SamplingMode;
  sampleSize: number;
  stratifyColumn?: string;
  percentileColumn?: string;
  percentileMin?: number;      // 0-100
  percentileMax?: number;      // 0-100
  cohortColumn?: string;
}

interface ISamplingResult {
  mode: SamplingMode;
  totalRows: number;
  sampledRows: number;
  columns: string[];
  rows: Record<string, unknown>[];
  stats?: ICohortStats[];
}

interface ICohortStats {
  cohortValue: string;
  count: number;
  percentage: number;
  numericStats?: {
    column: string;
    avg: number;
    min: number;
    max: number;
  };
  nullRate: number;
}

class SamplingEngine {
  constructor(private readonly _client: DriftApiClient) {}

  async sample(config: ISamplingConfig): Promise<ISamplingResult> {
    switch (config.mode) {
      case 'random':
        return this._randomSample(config);
      case 'stratified':
        return this._stratifiedSample(config);
      case 'percentile':
        return this._percentileSlice(config);
      case 'cohort':
        return this._cohortComparison(config);
    }
  }

  private async _randomSample(config: ISamplingConfig): Promise<ISamplingResult> {
    const countResult = await this._client.sql(
      `SELECT COUNT(*) AS cnt FROM "${config.table}"`
    );
    const total = (countResult.rows[0] as { cnt: number }).cnt;

    const sql = `SELECT * FROM "${config.table}" ORDER BY RANDOM() LIMIT ${config.sampleSize}`;
    const result = await this._client.sql(sql);

    return {
      mode: 'random',
      totalRows: total,
      sampledRows: result.rows.length,
      columns: result.columns,
      rows: result.rows as Record<string, unknown>[],
    };
  }

  private async _stratifiedSample(config: ISamplingConfig): Promise<ISamplingResult> {
    const col = config.stratifyColumn!;

    // Get distinct values and their counts
    const groupSql = `
      SELECT "${col}", COUNT(*) AS cnt
      FROM "${config.table}"
      GROUP BY "${col}"
      ORDER BY cnt DESC
    `;
    const groups = await this._client.sql(groupSql);
    const total = (groups.rows as { cnt: number }[]).reduce((s, r) => s + r.cnt, 0);

    // Proportional allocation
    const allRows: Record<string, unknown>[] = [];
    for (const group of groups.rows as Record<string, unknown>[]) {
      const groupCount = group.cnt as number;
      const allocation = Math.max(1, Math.round(
        (groupCount / total) * config.sampleSize
      ));

      const sampleSql = `
        SELECT * FROM "${config.table}"
        WHERE "${col}" = ${sqlLiteral(group[col])}
        ORDER BY RANDOM()
        LIMIT ${allocation}
      `;
      const result = await this._client.sql(sampleSql);
      allRows.push(...(result.rows as Record<string, unknown>[]));
    }

    return {
      mode: 'stratified',
      totalRows: total,
      sampledRows: allRows.length,
      columns: Object.keys(allRows[0] ?? {}),
      rows: allRows,
    };
  }

  private async _percentileSlice(config: ISamplingConfig): Promise<ISamplingResult> {
    const col = config.percentileColumn!;
    const pMin = config.percentileMin ?? 0;
    const pMax = config.percentileMax ?? 100;

    const countResult = await this._client.sql(
      `SELECT COUNT(*) AS cnt FROM "${config.table}" WHERE "${col}" IS NOT NULL`
    );
    const total = (countResult.rows[0] as { cnt: number }).cnt;

    const offset = Math.floor((pMin / 100) * total);
    const limit = Math.floor(((pMax - pMin) / 100) * total);

    const sql = `
      SELECT * FROM "${config.table}"
      WHERE "${col}" IS NOT NULL
      ORDER BY "${col}"
      LIMIT ${Math.min(limit, config.sampleSize)}
      OFFSET ${offset}
    `;
    const result = await this._client.sql(sql);

    return {
      mode: 'percentile',
      totalRows: total,
      sampledRows: result.rows.length,
      columns: result.columns,
      rows: result.rows as Record<string, unknown>[],
    };
  }

  private async _cohortComparison(config: ISamplingConfig): Promise<ISamplingResult> {
    const col = config.cohortColumn!;

    // Get cohort statistics
    const meta = await this._client.schemaMetadata();
    const table = meta.tables.find(t => t.name === config.table);
    const numericCols = table?.columns.filter(c =>
      c.type.toUpperCase().includes('INT') || c.type.toUpperCase().includes('REAL')
    ) ?? [];

    const statsSql = `
      SELECT
        "${col}" AS cohort_value,
        COUNT(*) AS count
        ${numericCols.length > 0 ? `, AVG("${numericCols[0].name}") AS avg_val,
        MIN("${numericCols[0].name}") AS min_val,
        MAX("${numericCols[0].name}") AS max_val` : ''}
      FROM "${config.table}"
      GROUP BY "${col}"
      ORDER BY count DESC
    `;
    const statsResult = await this._client.sql(statsSql);
    const totalRows = (statsResult.rows as { count: number }[])
      .reduce((s, r) => s + r.count, 0);

    const stats: ICohortStats[] = (statsResult.rows as Record<string, unknown>[]).map(r => ({
      cohortValue: String(r.cohort_value),
      count: r.count as number,
      percentage: ((r.count as number) / totalRows) * 100,
      numericStats: numericCols.length > 0 ? {
        column: numericCols[0].name,
        avg: r.avg_val as number,
        min: r.min_val as number,
        max: r.max_val as number,
      } : undefined,
      nullRate: 0,
    }));

    return {
      mode: 'cohort',
      totalRows,
      sampledRows: statsResult.rows.length,
      columns: ['cohort_value', 'count', 'percentage'],
      rows: statsResult.rows as Record<string, unknown>[],
      stats,
    };
  }
}
```

### Webview Message Protocol

Webview → Extension:
```typescript
{ command: 'sample', config: ISamplingConfig }
{ command: 'exportCsv' }
{ command: 'copySql', sql: string }
```

Extension → Webview:
```typescript
{ command: 'init', table: string, columns: ColumnMetadata[], totalRows: number }
{ command: 'result', result: ISamplingResult }
{ command: 'error', message: string }
```

## Server-Side Changes

None.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.dataSampling",
        "title": "Saropa Drift Advisor: Data Sampling Explorer",
        "icon": "$(filter)"
      }
    ],
    "menus": {
      "view/item/context": [{
        "command": "driftViewer.dataSampling",
        "when": "viewItem == driftTable",
        "group": "5_tools"
      }]
    }
  }
}
```

## Wiring in extension.ts

```typescript
const samplingEngine = new SamplingEngine(client);

context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.dataSampling', async (item?: TableItem) => {
    const table = item?.tableMetadata.name ?? await pickTable(client);
    if (!table) return;

    SamplingPanel.createOrShow(context.extensionUri, client, samplingEngine, table);
  })
);
```

## Testing

- `sampling-engine.test.ts`:
  - Random sample returns correct number of rows
  - Random sample uses `ORDER BY RANDOM()`
  - Stratified sample proportionally allocates across groups
  - Stratified with 1 group returns sample from that group
  - Percentile slice with 90-100 returns top 10%
  - Percentile skips NULL values
  - Cohort comparison returns stats per distinct value
  - Cohort numeric stats (avg, min, max) computed correctly
  - Empty table returns empty result
  - Sample size larger than table → returns all rows

## Known Limitations

- `ORDER BY RANDOM()` in SQLite scans the entire table — slow for large tables
- Stratified sampling issues one query per stratum — may be slow with many distinct values
- Percentile calculation is approximate (offset-based, not true percentile function)
- Cohort comparison only shows stats for the first numeric column (not all)
- No visualization (histograms, charts) — results are tabular only
- CSV export uses simple comma separation — no proper RFC 4180 quoting
- Maximum sample size not enforced beyond SQL LIMIT
- No saved sampling configurations — must reconfigure each time
