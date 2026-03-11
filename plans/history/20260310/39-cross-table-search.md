# Feature 39: Cross-Table Global Search

## What It Does

Search for any value across every table and every column in the database simultaneously. Type "alice@example.com" and find it in `users.email`, `audit_log.actor`, `sessions.user_email`, and anywhere else it appears. Like Ctrl+Shift+F for your codebase, but for your database.

## User Experience

1. Command palette → "Saropa Drift Advisor: Search All Tables" or keyboard shortcut (Ctrl+Shift+D)
2. Quick input for the search term, then results appear in a webview:

```
╔══════════════════════════════════════════════════════════════╗
║  GLOBAL SEARCH                                               ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Search: [alice@example.com          ]  [🔍 Search]         ║
║  Mode:   (●) Exact  ( ) Contains  ( ) Regex                ║
║  Scope:  (●) All tables  ( ) Text columns only              ║
║                                                              ║
║  Found 4 matches across 3 tables (23ms)                     ║
║                                                              ║
║  ▼ users — 1 match                                          ║
║    │ Row id=42: email = "alice@example.com"                  ║
║    │            [View Row] [Copy]                            ║
║                                                              ║
║  ▼ audit_log — 2 matches                                    ║
║    │ Row id=301: actor = "alice@example.com"                 ║
║    │ Row id=445: actor = "alice@example.com"                 ║
║    │            [View Rows] [Copy]                           ║
║                                                              ║
║  ▼ sessions — 1 match                                       ║
║    │ Row id=88: user_email = "alice@example.com"             ║
║    │            [View Row] [Copy]                            ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

3. Click "View Row" to open the table data panel filtered to that row
4. Search history preserved in the panel for quick re-runs

## New Files

```
extension/src/
  global-search/
    global-search-panel.ts     # Webview panel lifecycle
    global-search-html.ts      # HTML template
    global-search-engine.ts    # Builds and executes search queries
    global-search-types.ts     # Shared interfaces
extension/src/test/
  global-search-engine.test.ts
```

## Dependencies

- `api-client.ts` — `schemaMetadata()`, `sql()`

## Architecture

### Search Engine

Builds per-table SQL queries and aggregates results:

```typescript
interface ISearchMatch {
  table: string;
  column: string;
  rowPk: unknown;
  pkColumn: string;
  matchedValue: string;
  row: Record<string, unknown>;
}

interface ISearchResult {
  query: string;
  mode: 'exact' | 'contains' | 'regex';
  matches: ISearchMatch[];
  tablesSearched: number;
  durationMs: number;
}

class GlobalSearchEngine {
  constructor(private readonly _client: DriftApiClient) {}

  async search(
    query: string,
    mode: 'exact' | 'contains' | 'regex',
    scope: 'all' | 'text_only',
  ): Promise<ISearchResult> {
    const meta = await this._client.schemaMetadata();
    const start = Date.now();
    const matches: ISearchMatch[] = [];

    const tables = meta.tables.filter(t => !t.name.startsWith('sqlite_'));

    await Promise.all(tables.map(async (table) => {
      const cols = scope === 'text_only'
        ? table.columns.filter(c => this._isTextType(c.type))
        : table.columns;

      if (cols.length === 0) return;

      const pkCol = table.columns.find(c => c.pk)?.name ?? 'rowid';
      const conditions = cols.map(c => this._buildCondition(c.name, query, mode));
      const where = conditions.join(' OR ');
      const sql = `SELECT *, "${pkCol}" AS _pk FROM "${table.name}" WHERE ${where} LIMIT 100`;

      try {
        const result = await this._client.sql(sql);
        for (const row of result.rows) {
          const r = row as Record<string, unknown>;
          for (const col of cols) {
            if (this._matches(String(r[col.name] ?? ''), query, mode)) {
              matches.push({
                table: table.name,
                column: col.name,
                rowPk: r._pk ?? r[pkCol],
                pkColumn: pkCol,
                matchedValue: String(r[col.name]),
                row: r,
              });
            }
          }
        }
      } catch {
        // Table may have been dropped between metadata fetch and query
      }
    }));

    return {
      query,
      mode,
      matches,
      tablesSearched: tables.length,
      durationMs: Date.now() - start,
    };
  }

  private _buildCondition(column: string, query: string, mode: string): string {
    const escaped = query.replace(/'/g, "''");
    switch (mode) {
      case 'exact':
        return `CAST("${column}" AS TEXT) = '${escaped}'`;
      case 'contains':
        return `CAST("${column}" AS TEXT) LIKE '%${escaped}%'`;
      case 'regex':
        // SQLite doesn't support REGEXP by default, fall back to LIKE
        return `CAST("${column}" AS TEXT) LIKE '%${escaped}%'`;
      default:
        return `CAST("${column}" AS TEXT) = '${escaped}'`;
    }
  }

  private _matches(value: string, query: string, mode: string): boolean {
    switch (mode) {
      case 'exact': return value === query;
      case 'contains': return value.includes(query);
      case 'regex':
        try { return new RegExp(query).test(value); }
        catch { return false; }
      default: return false;
    }
  }

  private _isTextType(type: string): boolean {
    const upper = type.toUpperCase();
    return upper.includes('TEXT') || upper.includes('VARCHAR') || upper.includes('CHAR');
  }
}
```

### Result Grouping

Results are grouped by table for display:

```typescript
function groupByTable(matches: ISearchMatch[]): Map<string, ISearchMatch[]> {
  const groups = new Map<string, ISearchMatch[]>();
  for (const match of matches) {
    const group = groups.get(match.table) ?? [];
    group.push(match);
    groups.set(match.table, group);
  }
  return groups;
}
```

### Webview Message Protocol

Webview → Extension:
```typescript
{ command: 'search', query: string, mode: 'exact' | 'contains' | 'regex', scope: 'all' | 'text_only' }
{ command: 'viewRow', table: string, pkColumn: string, pkValue: unknown }
{ command: 'copyValue', value: string }
```

Extension → Webview:
```typescript
{ command: 'results', result: ISearchResult }
{ command: 'searching', query: string }
{ command: 'error', message: string }
```

## Server-Side Changes

None. Uses existing `schemaMetadata()` and `sql()`.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.globalSearch",
        "title": "Saropa Drift Advisor: Search All Tables",
        "icon": "$(search)"
      }
    ],
    "menus": {
      "view/title": [{
        "command": "driftViewer.globalSearch",
        "when": "view == driftViewer.databaseExplorer && driftViewer.serverConnected",
        "group": "navigation"
      }]
    },
    "keybindings": [{
      "command": "driftViewer.globalSearch",
      "key": "ctrl+shift+d",
      "mac": "cmd+shift+d",
      "when": "driftViewer.serverConnected"
    }]
  }
}
```

## Wiring in extension.ts

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.globalSearch', () => {
    GlobalSearchPanel.createOrShow(context.extensionUri, client);
  })
);
```

## Testing

- `global-search-engine.test.ts`:
  - Exact match finds value in correct table and column
  - Contains match finds partial strings
  - No matches returns empty array
  - Search skips `sqlite_` internal tables
  - Text-only scope excludes INTEGER/REAL columns
  - Special characters in query are escaped (SQL injection safe)
  - Multiple matches in same table grouped correctly
  - Table dropped between metadata and query → gracefully skipped
  - Limit of 100 matches per table enforced
  - Duration is measured accurately

## Known Limitations

- SQLite doesn't support `REGEXP` — regex mode falls back to `LIKE` on the SQL side, then filters with JS regex
- Large databases (100k+ rows) may be slow — each table requires a separate query
- Binary/BLOB columns are skipped (can't meaningfully search binary data)
- Results capped at 100 per table to prevent memory issues
- No index-aware optimization — always scans via `LIKE` or `CAST`
- Case sensitivity follows SQLite defaults (`=` is case-sensitive, `LIKE` is case-insensitive for ASCII)
- No search-as-you-type — must click Search or press Enter
- No saved searches — history is session-only
