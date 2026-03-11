# Feature 43: Query Cost Analyzer

## What It Does

Run any SQL query and see its SQLite execution plan visualized as a tree. Highlights full table scans, missing indexes, and suboptimal joins. Suggests index creation statements that would improve performance. Adds an "Explain" button to every query result panel.

## User Experience

1. Run any SQL query → click "Explain" in the result panel header
2. Or: command palette → "Saropa Drift Advisor: Analyze Query Cost"
3. Analysis panel:

```
╔══════════════════════════════════════════════════════════════════╗
║  QUERY COST ANALYSIS                                            ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  SQL: SELECT u.name, COUNT(o.id) AS order_count                 ║
║       FROM users u JOIN orders o ON o.user_id = u.id            ║
║       WHERE u.active = 1 GROUP BY u.id                          ║
║                                                                  ║
║  Execution Plan                                                  ║
║  ─────────────                                                   ║
║  ├─ SCAN users                                                  ║
║  │  ⚠ Full table scan (no index on "active")                   ║
║  │  Est. rows: 1,250                                            ║
║  │                                                               ║
║  └─ SEARCH orders USING INDEX idx_orders_user_id                ║
║     ✓ Index used: idx_orders_user_id                            ║
║     Est. rows: ~3 per user                                      ║
║                                                                  ║
║  Performance Summary                                            ║
║  ───────────────────                                            ║
║  ⚠ 1 full table scan detected                                  ║
║  ✓ 1 index used                                                ║
║  Est. total rows examined: ~5,000                               ║
║                                                                  ║
║  💡 Suggestions                                                 ║
║  ──────────────                                                  ║
║  1. CREATE INDEX idx_users_active ON users(active);             ║
║     Reason: Avoids full scan on users WHERE active = 1          ║
║     [Copy] [Run]                                                ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```

4. Click "Run" on a suggestion to create the index immediately
5. Re-analyze to see the improvement

## New Files

```
extension/src/
  query-cost/
    query-cost-panel.ts        # Webview panel lifecycle
    query-cost-html.ts         # HTML template with plan tree visualization
    explain-parser.ts          # Parses EXPLAIN QUERY PLAN output
    index-suggester.ts         # Suggests indexes based on plan analysis
    query-cost-types.ts        # Shared interfaces
extension/src/test/
  explain-parser.test.ts
  index-suggester.test.ts
```

## Dependencies

- `api-client.ts` — `sql()` for running `EXPLAIN QUERY PLAN` and index creation

## Architecture

### Explain Parser

Parses the output of SQLite's `EXPLAIN QUERY PLAN`:

```typescript
interface IPlanNode {
  id: number;
  parent: number;
  detail: string;
  operation: 'scan' | 'search' | 'use_temp_btree' | 'compound' | 'other';
  table?: string;
  index?: string;
  isFullScan: boolean;
  estimatedRows?: number;
}

interface IParsedPlan {
  nodes: IPlanNode[];
  warnings: IPlanWarning[];
}

interface IPlanWarning {
  severity: 'warning' | 'info';
  message: string;
  table?: string;
  suggestion?: string;
}

class ExplainParser {
  async explain(
    client: DriftApiClient,
    sql: string,
  ): Promise<IParsedPlan> {
    const result = await client.sql(`EXPLAIN QUERY PLAN ${sql}`);
    const nodes: IPlanNode[] = [];
    const warnings: IPlanWarning[] = [];

    for (const row of result.rows) {
      const r = row as { id: number; parent: number; detail: string };
      const node = this._parseNode(r);
      nodes.push(node);

      if (node.isFullScan) {
        warnings.push({
          severity: 'warning',
          message: `Full table scan on "${node.table}"`,
          table: node.table,
          suggestion: `Consider adding an index on frequently filtered columns of "${node.table}"`,
        });
      }
    }

    return { nodes, warnings };
  }

  private _parseNode(row: { id: number; parent: number; detail: string }): IPlanNode {
    const detail = row.detail;

    // SCAN table
    const scanMatch = detail.match(/^SCAN (\w+)/);
    if (scanMatch) {
      return {
        id: row.id,
        parent: row.parent,
        detail,
        operation: 'scan',
        table: scanMatch[1],
        isFullScan: !detail.includes('USING INDEX') && !detail.includes('USING COVERING INDEX'),
      };
    }

    // SEARCH table USING INDEX
    const searchMatch = detail.match(/^SEARCH (\w+) USING (?:COVERING )?INDEX (\w+)/);
    if (searchMatch) {
      return {
        id: row.id,
        parent: row.parent,
        detail,
        operation: 'search',
        table: searchMatch[1],
        index: searchMatch[2],
        isFullScan: false,
      };
    }

    // USE TEMP B-TREE (for ORDER BY / GROUP BY without index)
    if (detail.includes('USE TEMP B-TREE')) {
      return {
        id: row.id,
        parent: row.parent,
        detail,
        operation: 'use_temp_btree',
        isFullScan: false,
      };
    }

    return {
      id: row.id,
      parent: row.parent,
      detail,
      operation: 'other',
      isFullScan: false,
    };
  }
}
```

### Index Suggester

Analyzes the query and plan to suggest useful indexes:

```typescript
interface IIndexSuggestion {
  sql: string;
  reason: string;
  impact: 'high' | 'medium' | 'low';
}

class IndexSuggester {
  constructor(private readonly _client: DriftApiClient) {}

  async suggest(
    sql: string,
    plan: IParsedPlan,
  ): Promise<IIndexSuggestion[]> {
    const suggestions: IIndexSuggestion[] = [];

    // Get existing indexes
    const existingIndexes = await this._getExistingIndexes();

    for (const node of plan.nodes) {
      if (!node.isFullScan || !node.table) continue;

      // Parse the WHERE clause to find filterable columns
      const whereColumns = this._extractWhereColumns(sql, node.table);
      const joinColumns = this._extractJoinColumns(sql, node.table);
      const targetColumns = [...whereColumns, ...joinColumns];

      if (targetColumns.length === 0) continue;

      // Check if an index already covers these columns
      const indexName = `idx_${node.table}_${targetColumns.join('_')}`;
      if (existingIndexes.has(indexName)) continue;

      const colList = targetColumns.map(c => `"${c}"`).join(', ');
      suggestions.push({
        sql: `CREATE INDEX "${indexName}" ON "${node.table}"(${colList});`,
        reason: `Avoids full scan on "${node.table}" when filtering by ${targetColumns.join(', ')}`,
        impact: node.operation === 'scan' ? 'high' : 'medium',
      });
    }

    // Suggest for temp b-tree (ORDER BY / GROUP BY)
    for (const node of plan.nodes) {
      if (node.operation !== 'use_temp_btree') continue;

      const orderColumns = this._extractOrderByColumns(sql);
      if (orderColumns.length > 0) {
        const table = this._extractMainTable(sql);
        if (table) {
          suggestions.push({
            sql: `CREATE INDEX "idx_${table}_${orderColumns.join('_')}" ON "${table}"(${orderColumns.map(c => `"${c}"`).join(', ')});`,
            reason: `Avoids temporary sort for ORDER BY ${orderColumns.join(', ')}`,
            impact: 'medium',
          });
        }
      }
    }

    return suggestions;
  }

  private async _getExistingIndexes(): Promise<Set<string>> {
    const result = await this._client.sql(
      "SELECT name FROM sqlite_master WHERE type='index'"
    );
    return new Set(result.rows.map((r: { name: string }) => r.name));
  }

  private _extractWhereColumns(sql: string, table: string): string[] {
    // Simple heuristic: find column references in WHERE clause
    const whereMatch = sql.match(/WHERE\s+(.+?)(?:GROUP|ORDER|LIMIT|$)/is);
    if (!whereMatch) return [];

    const columns: string[] = [];
    const colPattern = new RegExp(`(?:${table}\\.|"${table}"\\.)?"?(\\w+)"?\\s*[=<>!]`, 'gi');
    let match;
    while ((match = colPattern.exec(whereMatch[1])) !== null) {
      columns.push(match[1]);
    }
    return [...new Set(columns)];
  }

  private _extractJoinColumns(sql: string, table: string): string[] {
    const columns: string[] = [];
    const joinPattern = new RegExp(
      `(?:${table}\\.)?"?(\\w+)"?\\s*=\\s*\\w+\\.\\w+|\\w+\\.\\w+\\s*=\\s*(?:${table}\\.)?"?(\\w+)"?`,
      'gi'
    );
    let match;
    while ((match = joinPattern.exec(sql)) !== null) {
      if (match[1]) columns.push(match[1]);
      if (match[2]) columns.push(match[2]);
    }
    return [...new Set(columns)];
  }

  private _extractOrderByColumns(sql: string): string[] {
    const match = sql.match(/ORDER\s+BY\s+(.+?)(?:LIMIT|$)/is);
    if (!match) return [];
    return match[1].split(',').map(c => c.trim().replace(/\s+(ASC|DESC)$/i, '').replace(/"/g, ''));
  }

  private _extractMainTable(sql: string): string | null {
    const match = sql.match(/FROM\s+"?(\w+)"?/i);
    return match ? match[1] : null;
  }
}
```

### Webview Message Protocol

Webview → Extension:
```typescript
{ command: 'analyze', sql: string }
{ command: 'runSuggestion', sql: string }
{ command: 'copySql', sql: string }
```

Extension → Webview:
```typescript
{ command: 'result', plan: IParsedPlan, suggestions: IIndexSuggestion[], sql: string }
{ command: 'suggestionApplied', indexName: string }
{ command: 'error', message: string }
```

## Server-Side Changes

None. Uses existing `sql()` endpoint with `EXPLAIN QUERY PLAN` prefix.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.analyzeQueryCost",
        "title": "Saropa Drift Advisor: Analyze Query Cost",
        "icon": "$(pulse)"
      }
    ]
  }
}
```

## Wiring in extension.ts

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.analyzeQueryCost', async () => {
    const sql = await vscode.window.showInputBox({
      prompt: 'SQL query to analyze',
      placeHolder: 'SELECT ...',
    });
    if (!sql) return;

    QueryCostPanel.createOrShow(context.extensionUri, client, sql);
  })
);
```

## Testing

- `explain-parser.test.ts`:
  - Parses SCAN node with table name
  - Parses SEARCH node with index name
  - Detects full table scan (SCAN without USING INDEX)
  - Parses USE TEMP B-TREE
  - Generates warnings for full scans
  - Handles COMPOUND queries (UNION)
  - Empty plan → no nodes
- `index-suggester.test.ts`:
  - Suggests index for WHERE clause column on scanned table
  - Suggests index for JOIN column
  - Suggests index for ORDER BY with temp b-tree
  - Skips if index already exists
  - No suggestions when all indexes used
  - Multiple suggestions for multiple scans
  - Impact is 'high' for full scans

## Known Limitations

- SQLite's `EXPLAIN QUERY PLAN` output format may vary across versions
- Estimated row counts are not available from SQLite's explain (shown as "unknown")
- Index suggestions are heuristic — may not always be optimal (e.g., composite vs. single-column)
- Cannot detect if a suggested index would actually help without running the query with it
- No support for analyzing multiple queries at once
- Regex-based SQL parsing is fragile — complex subqueries may not be parsed correctly
- No comparison view (before/after index creation)
- "Run" for index creation uses `sql()` which may not support DDL on all server configurations
