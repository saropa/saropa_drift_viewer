# Feature 54: Schema Search + Column Cross-Reference — DONE

## What It Does

Search across all table names, column names, and column types in the schema. Find "all TEXT columns", "every column named email", or "tables with a created_at column". Also provides column cross-reference: for any column, instantly see every other table with the same column name — surfacing potential missing foreign keys.

This complements Feature 39 (Global Search), which searches *data values*. This feature searches *schema structure*.

## User Experience

1. Command palette → "Drift Viewer: Search Schema" or click search icon in tree view title
2. QuickPick with live filtering across tables and columns
3. Results grouped by table, showing matching tables and columns
4. Select a result → reveal it in the tree view

```
╔══════════════════════════════════════════════════════════════╗
║  SCHEMA SEARCH                                               ║
╠══════════════════════════════════════════════════════════════╣
║  Search: [email                    ]                         ║
║  Scope:  (●) All  ( ) Tables only  ( ) Columns only         ║
║  Type:   (●) Any  ( ) TEXT  ( ) INTEGER  ( ) REAL  ( ) BLOB ║
║                                                              ║
║  Found 4 matches across 3 tables                             ║
║                                                              ║
║  📋 users                                                     ║
║    └─ 🔤 email TEXT  ← also in: audit_log, sessions          ║
║                                                              ║
║  📋 audit_log                                                 ║
║    └─ 🔤 email TEXT  ← also in: users, sessions              ║
║                                                              ║
║  📋 sessions                                                  ║
║    └─ 🔤 user_email TEXT  (name match: "email")              ║
║                                                              ║
║  Cross-reference: "email" appears in 3 tables                ║
║  ⚠ No FK between audit_log.email → users.email              ║
╚══════════════════════════════════════════════════════════════╝
```

## New Files

```
extension/src/schema-search/
  schema-search.ts            # Search engine + cross-reference logic
  schema-search-types.ts      # Interfaces
extension/src/test/
  schema-search.test.ts
```

## Modified Files

```
extension/src/extension.ts     # Register command
extension/package.json         # Command + keybinding + tree title button
```

## Dependencies

- `api-client.ts` — `schemaMetadata()`, `tableFkMeta()`
- `drift-tree-provider.ts` — `revealTableItem()` for navigation

## Architecture

### Schema Search Engine

```typescript
interface ISchemaMatch {
  type: 'table' | 'column';
  table: string;
  column?: string;
  columnType?: string;
  isPk?: boolean;
  alsoIn?: string[];       // Cross-reference: other tables with same column name
  hasFk?: boolean;         // Whether an FK exists for this cross-reference
}

interface ISchemaSearchResult {
  query: string;
  matches: ISchemaMatch[];
  crossReferences: ICrossReference[];
}

interface ICrossReference {
  columnName: string;
  tables: string[];
  missingFks: Array<{ from: string; to: string }>;
}

class SchemaSearchEngine {
  constructor(private readonly _client: DriftApiClient) {}

  async search(
    query: string,
    scope: 'all' | 'tables' | 'columns',
    typeFilter?: string,
  ): Promise<ISchemaSearchResult> {
    const meta = await this._client.schemaMetadata();
    const lower = query.toLowerCase();
    const matches: ISchemaMatch[] = [];

    for (const table of meta) {
      if (table.name.startsWith('sqlite_')) continue;

      // Match table names
      if (scope !== 'columns' && table.name.toLowerCase().includes(lower)) {
        matches.push({ type: 'table', table: table.name });
      }

      // Match column names and types
      if (scope !== 'tables') {
        for (const col of table.columns) {
          if (typeFilter && !col.type.toUpperCase().includes(typeFilter.toUpperCase())) {
            continue;
          }
          if (col.name.toLowerCase().includes(lower) ||
              col.type.toLowerCase().includes(lower)) {
            matches.push({
              type: 'column',
              table: table.name,
              column: col.name,
              columnType: col.type,
              isPk: col.pk,
            });
          }
        }
      }
    }

    // Build cross-references for matched columns
    const crossRefs = await this._buildCrossReferences(meta, matches);

    return { query, matches, crossReferences: crossRefs };
  }

  private async _buildCrossReferences(
    meta: TableMetadata[],
    matches: ISchemaMatch[],
  ): Promise<ICrossReference[]> {
    const columnNames = new Set(
      matches.filter(m => m.type === 'column').map(m => m.column!)
    );

    const refs: ICrossReference[] = [];

    for (const colName of columnNames) {
      const tables = meta
        .filter(t => !t.name.startsWith('sqlite_'))
        .filter(t => t.columns.some(c => c.name === colName))
        .map(t => t.name);

      if (tables.length <= 1) continue;

      // Check which pairs have FK relationships
      const missingFks: Array<{ from: string; to: string }> = [];
      for (const fromTable of tables) {
        const fks = await this._client.tableFkMeta(fromTable);
        for (const toTable of tables) {
          if (fromTable === toTable) continue;
          const hasFk = fks.some(
            fk => fk.fromColumn === colName && fk.toTable === toTable
          );
          if (!hasFk) {
            missingFks.push({ from: fromTable, to: toTable });
          }
        }
      }

      refs.push({ columnName: colName, tables, missingFks });
    }

    return refs;
  }
}
```

### QuickPick Integration

Uses VS Code's native QuickPick for fast, keyboard-driven search:

```typescript
async function showSchemaSearch(
  engine: SchemaSearchEngine,
  treeProvider: DriftTreeProvider,
): Promise<void> {
  const quickPick = vscode.window.createQuickPick();
  quickPick.placeholder = 'Search tables, columns, types…';
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;

  const meta = await engine.getAllMetadata();
  const allItems = buildQuickPickItems(meta);
  quickPick.items = allItems;

  quickPick.onDidAccept(() => {
    const selected = quickPick.selectedItems[0];
    if (selected) {
      treeProvider.revealTableItem(selected.tableName, selected.columnName);
    }
    quickPick.hide();
  });

  quickPick.show();
}
```

Each QuickPick item shows:
- **Label**: column name or table name
- **Description**: type, table membership
- **Detail**: cross-reference info ("also in: users, sessions — no FK")

## Server-Side Changes

None. Uses existing `schemaMetadata()` and `tableFkMeta()`.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.schemaSearch",
        "title": "Drift Viewer: Search Schema",
        "icon": "$(search)"
      }
    ],
    "menus": {
      "view/title": [{
        "command": "driftViewer.schemaSearch",
        "when": "view == driftViewer.databaseExplorer && driftViewer.serverConnected",
        "group": "navigation"
      }]
    },
    "keybindings": [{
      "command": "driftViewer.schemaSearch",
      "key": "ctrl+shift+s",
      "mac": "cmd+shift+s",
      "when": "driftViewer.serverConnected"
    }]
  }
}
```

## Testing

- `schema-search.test.ts`:
  - Search by table name → finds matching tables
  - Search by column name → finds matching columns with table context
  - Search by type (e.g., "TEXT") → finds all columns of that type
  - Type filter restricts results to specified type
  - Scope "tables" excludes column matches
  - Scope "columns" excludes table name matches
  - Cross-reference: column in 3 tables → reports all 3 with FK status
  - Cross-reference: FK exists between two tables → `hasFk = true`
  - Cross-reference: no FK → appears in `missingFks`
  - Internal `sqlite_` tables excluded
  - Empty query returns all items (browse mode)
  - Case-insensitive matching
  - Partial name match works ("usr" matches "users")

## Known Limitations

- Cross-reference FK checking requires one `tableFkMeta()` call per table — may be slow on schemas with 50+ tables. Results are cached per search.
- Column name matching is exact for cross-references (not fuzzy). "user_id" and "userId" are not cross-referenced.
- No regex search — substring match only.
- QuickPick doesn't support grouping, so results are a flat list with table name in the description.
- Keybinding `Ctrl+Shift+S` may conflict with "Save All" — check for conflicts.
