# Feature 4: Live Data Watch

## What It Does

Pin SQL queries or tables and see their results update in real-time as your app writes to the database. Changed rows are highlighted with diff colors. Think of it as a live dashboard for your database during development.

## User Experience

1. Right-click a table in the tree view: "Watch Table"
2. Or from the SQL notebook: "Watch This Query"
3. A **Watch panel** opens showing pinned queries
4. Results auto-refresh when data changes (via generation watcher)
5. Diff highlighting:
   - **Green** rows: newly added since last check
   - **Red** rows: removed since last check
   - **Yellow** cells: value changed
6. Badge on the watch panel tab: "3 changes" since last viewed
7. Optional desktop notification on data change
8. Multiple watchers running simultaneously

## New Files

```
extension/src/
  watch/
    watch-panel.ts          # WebviewPanel for displaying watched queries
    watch-manager.ts        # Manages multiple watchers, diff calculation
    watch-html.ts           # HTML template for the watch panel
extension/src/test/
  watch-manager.test.ts
```

## Dependencies

Requires `api-client.ts` and `generation-watcher.ts` from Feature 1.

## Architecture

### Watch Manager

```typescript
interface WatchEntry {
  id: string;
  label: string;          // "users" or custom SQL
  sql: string;            // SELECT * FROM "users" or custom
  previousRows: object[]; // last known results (for diffing)
  currentRows: object[];  // latest results
  diff: WatchDiff;        // computed diff
  createdAt: number;
  lastChangedAt: number;
}

interface WatchDiff {
  addedRows: object[];
  removedRows: object[];
  changedRows: ChangedRow[];
  unchangedCount: number;
}

interface ChangedRow {
  pk: string;             // stringified PK value(s)
  row: object;
  changedColumns: string[];
  previousValues: Record<string, unknown>;
}
```

The `WatchManager` class:
- Maintains a list of `WatchEntry` objects
- Subscribes to `GenerationWatcher.onDidChange`
- On each change: re-runs all watched queries, computes diffs, notifies panel
- Persists watch list in `context.workspaceState` (survives restarts)

### Diff Calculation

For each watcher on generation change:
1. Run the SQL query via `POST /api/sql`
2. Compare `currentRows` to `previousRows`:
   - **Primary key detection**: use first column, or columns named `id`/`_id`
   - **Added**: rows in current but not in previous (by PK)
   - **Removed**: rows in previous but not in current (by PK)
   - **Changed**: rows in both, but with different cell values (deep equality)
3. Store diff in `WatchEntry.diff`
4. Update `previousRows = currentRows`

If no PK can be detected, fall back to row-index-based comparison (less accurate but still useful).

### Webview Panel

A single `WatchPanel` webview showing all active watchers in a tabbed or stacked layout:

**Message Protocol:**

Webview -> Extension:
```typescript
{ command: 'addWatch', sql: string, label: string }
{ command: 'removeWatch', id: string }
{ command: 'pauseWatch', id: string }
{ command: 'resumeWatch', id: string }
{ command: 'clearDiff', id: string }
```

Extension -> Webview:
```typescript
{ command: 'update', watches: WatchEntry[] }
{ command: 'removed', id: string }
```

### Diff Rendering

HTML table with CSS classes for diff state:

```css
.row-added    { background: rgba(0, 200, 0, 0.15); }
.row-removed  { background: rgba(200, 0, 0, 0.15); text-decoration: line-through; }
.cell-changed { background: rgba(200, 200, 0, 0.2); font-weight: bold; }
```

Each watched query renders as a card:
- Header: label, row count, last changed time, pause/remove buttons
- Table: current results with diff highlights
- Footer: "3 added, 1 removed, 2 changed" summary

### Badge / Notification

```typescript
// Badge on panel tab title
panel.title = unseenChanges > 0
  ? `Watch (${unseenChanges})`
  : 'Watch';

// Desktop notification (optional, configurable)
if (config.get('watch.notifications', false) && diff.hasChanges) {
  vscode.window.showInformationMessage(
    `Drift Watch: ${entry.label} — ${diff.addedRows.length} added, ${diff.changedRows.length} changed`
  );
}
```

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      { "command": "driftViewer.watchTable", "title": "Saropa Drift Advisor: Watch Table" },
      { "command": "driftViewer.watchQuery", "title": "Saropa Drift Advisor: Watch Query" },
      { "command": "driftViewer.openWatchPanel", "title": "Saropa Drift Advisor: Open Watch Panel" }
    ],
    "menus": {
      "view/item/context": [{
        "command": "driftViewer.watchTable",
        "when": "viewItem == driftTable",
        "group": "4_watch"
      }]
    },
    "configuration": {
      "properties": {
        "driftViewer.watch.notifications": {
          "type": "boolean",
          "default": false,
          "description": "Show desktop notifications when watched data changes."
        },
        "driftViewer.watch.maxWatchers": {
          "type": "number",
          "default": 10,
          "description": "Maximum number of simultaneous watch queries."
        }
      }
    }
  }
}
```

## Wiring in extension.ts

```typescript
const watchManager = new WatchManager(client);
watcher.onDidChange(() => watchManager.refresh());

context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.watchTable', (item: TableItem) => {
    watchManager.add(`SELECT * FROM "${item.tableMetadata.name}"`, item.tableMetadata.name);
    WatchPanel.createOrShow(context, watchManager);
  }),
  vscode.commands.registerCommand('driftViewer.watchQuery', (sql: string) => {
    watchManager.add(sql, sql.substring(0, 40));
    WatchPanel.createOrShow(context, watchManager);
  }),
  vscode.commands.registerCommand('driftViewer.openWatchPanel', () => {
    WatchPanel.createOrShow(context, watchManager);
  })
);
```

## Testing

- `watch-manager.test.ts`: test diff calculation (added/removed/changed rows), PK detection, edge cases (empty table, no PK)
- Test badge update on unseen changes
- Mock `api-client` to return controlled row sets for deterministic diffs

## Known Limitations

- PK detection is heuristic (first column or `id`); may fail for composite PKs
- Watching many tables with many rows could be slow (each watch re-runs its full query)
- Diff is row-level, not streaming — entire result set is compared each time
- No support for watching queries that return different columns over time
