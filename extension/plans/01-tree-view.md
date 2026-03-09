# Feature 1: Database Explorer Tree View — IMPLEMENTED

## What It Does

Adds a sidebar panel showing your live database structure — tables with row counts, columns with types, primary keys, and foreign key relationships. Auto-refreshes when data changes. Right-click actions for viewing data, copying names, and exporting CSV.

## User Experience

1. A **database icon** appears in the VS Code activity bar
2. Clicking it opens a tree view showing:
   - Connection status (green/red)
   - Each table as an expandable node with row count badge
   - Under each table: columns with type icons (key, number, string, blob) and FK links
3. Right-click a table: "View Data", "Copy Name", "Export CSV"
4. Right-click a column: "Copy Name", "Filter by Column"
5. Tree auto-refreshes when the app writes to the database
6. Manual refresh button in the tree header

## New Files

```
extension/src/
  api-client.ts              # Shared HTTP client for all /api/* endpoints
  generation-watcher.ts      # Long-poll /api/generation, fires change events
  tree/
    drift-tree-provider.ts   # TreeDataProvider implementation
    tree-items.ts            # TreeItem subclasses (table, column, FK, status)
extension/src/test/
  api-client.test.ts
  drift-tree-provider.test.ts
  generation-watcher.test.ts
```

## API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | Connection status indicator |
| `GET /api/schema/metadata` | Tables, columns, types, PKs, row counts (single call) |
| `GET /api/table/{name}/fk-meta` | Foreign key relationships per table |
| `GET /api/generation?since=N` | Long-poll for data change detection |
| `POST /api/sql` | Export CSV (runs `SELECT * FROM table`) |

## package.json Contributions

```jsonc
{
  "contributes": {
    "viewsContainers": {
      "activitybar": [{
        "id": "driftViewer",
        "title": "Drift Viewer",
        "icon": "$(database)"
      }]
    },
    "views": {
      "driftViewer": [{
        "id": "driftViewer.databaseExplorer",
        "name": "Database"
      }]
    },
    "commands": [
      { "command": "driftViewer.refreshTree", "title": "Refresh", "icon": "$(refresh)" },
      { "command": "driftViewer.viewTableData", "title": "View Table Data" },
      { "command": "driftViewer.copyTableName", "title": "Copy Table Name" },
      { "command": "driftViewer.exportTableCsv", "title": "Export as CSV" },
      { "command": "driftViewer.copyColumnName", "title": "Copy Column Name" },
      { "command": "driftViewer.filterByColumn", "title": "Filter by Column" }
    ],
    "menus": {
      "view/title": [{
        "command": "driftViewer.refreshTree",
        "when": "view == driftViewer.databaseExplorer",
        "group": "navigation"
      }],
      "view/item/context": [
        { "command": "driftViewer.viewTableData", "when": "viewItem == driftTable", "group": "1_view" },
        { "command": "driftViewer.copyTableName", "when": "viewItem == driftTable", "group": "2_copy" },
        { "command": "driftViewer.exportTableCsv", "when": "viewItem == driftTable", "group": "3_export" },
        { "command": "driftViewer.copyColumnName", "when": "viewItem == driftColumn || viewItem == driftColumnPk", "group": "2_copy" },
        { "command": "driftViewer.filterByColumn", "when": "viewItem == driftColumn || viewItem == driftColumnPk", "group": "1_view" }
      ]
    }
  }
}
```

## Key Interfaces

```typescript
// api-client.ts
interface TableMetadata {
  name: string;
  columns: ColumnMetadata[];
  rowCount: number;
}
interface ColumnMetadata {
  name: string;
  type: string;  // INTEGER, TEXT, REAL, BLOB
  pk: boolean;
}
interface ForeignKey {
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

// DriftApiClient class wraps all fetch calls with typed returns
```

## Tree Item Types

| Node | Icon | Description | contextValue |
|------|------|-------------|-------------|
| Connection status | `$(database)` green / `$(error)` red | Shows base URL | `connectionStatus` |
| Table | `$(table)` | Row count as description | `driftTable` |
| Column (PK) | `$(key)` | Type as description | `driftColumnPk` |
| Column (int) | `$(symbol-number)` | Type as description | `driftColumn` |
| Column (text) | `$(symbol-string)` | Type as description | `driftColumn` |
| Column (blob) | `$(file-binary)` | Type as description | `driftColumn` |
| Foreign Key | `$(references)` | `-> targetTable.targetCol` | `driftForeignKey` |

## Data Flow

```
GenerationWatcher --[onDidChange]--> DriftTreeProvider.refresh()
                                          |
                                          v
                                  DriftApiClient.schemaMetadata()  (1 HTTP call)
                                  DriftApiClient.tableFkMeta()     (N calls, lazy on expand)
                                          |
                                          v
                                  fire(onDidChangeTreeData)
                                          |
                                          v
                                  VS Code re-renders tree
```

## Wiring in extension.ts

```typescript
const client = new DriftApiClient(host, port);
const watcher = new GenerationWatcher(client);
const treeProvider = new DriftTreeProvider(client);

const treeView = vscode.window.createTreeView('driftViewer.databaseExplorer', {
  treeDataProvider: treeProvider,
  showCollapseAll: true,
});

watcher.onDidChange(() => treeProvider.refresh());
watcher.start();
treeProvider.refresh(); // initial load
```

## Testing

- Stub `fetch` with Sinon to mock API responses
- Test tree provider returns correct children for root (status + tables) and table nodes (columns + FKs)
- Test generation watcher fires events on generation change
- Test graceful handling when server is offline
- Extend `vscode-mock.ts` with `TreeItem`, `ThemeIcon`, `ThemeColor`, `MarkdownString`, `createTreeView`

## Known Limitations

- FK metadata requires one call per table; lazy-load on expand to avoid N+1 on initial load
- If the server is down at activation, tree shows "Disconnected" until server starts
- No authentication support in API client initially (add later if needed)
