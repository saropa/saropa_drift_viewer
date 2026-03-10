# Feature 15: Query Performance Panel in Debug Sidebar

> **Status: Implemented** — All files created/modified, 25 tests passing.

## What It Does

A live-updating panel in the Run & Debug sidebar (next to Variables, Call Stack) showing recent database queries sorted by duration. Slow queries are highlighted. Only appears during active Dart debug sessions.

## User Experience

In the Debug sidebar, a new section appears:
```
DRIFT QUERIES (last 30s)
─────────────────────────────────
▼ Slow Queries (3)
    SELECT * FROM posts WHERE ...      1250ms  ⚠ FULL SCAN
    SELECT * FROM users JOIN ...        890ms  ⚠ FULL SCAN
    SELECT count(*) FROM comments       450ms

▼ Recent Queries (12)
    SELECT * FROM users WHERE id=?       15ms
    SELECT name FROM categories           8ms
    INSERT INTO posts VALUES (...)       22ms
    ...

  Total: 47 queries, 3.2s total, 68ms avg
  Slowest: 1250ms (SELECT * FROM posts...)
```

Click a query → shows full SQL, explain plan, and execution details.

## New Files

```
extension/src/
  debug/
    performance-tree-provider.ts    # TreeDataProvider for debug sidebar
    performance-items.ts            # TreeItem subclasses
extension/src/test/
  performance-tree-provider.test.ts
```

## Dependencies

- `api-client.ts` (Feature 1) — for `GET /api/analytics/performance`
- `generation-watcher.ts` (Feature 1) — polling for updates

## API Endpoint

```
GET /api/analytics/performance
Response: {
  "totalQueries": 256,
  "totalDurationMs": 12345,
  "avgDurationMs": 48,
  "slowQueries": [
    { "sql": "SELECT ...", "durationMs": 1250, "rowCount": 10000, "at": "..." }
  ],
  "queryPatterns": [
    { "pattern": "SELECT * FROM users WHERE", "count": 45, "avgMs": 25, "maxMs": 150 }
  ],
  "recentQueries": [
    { "sql": "SELECT ...", "durationMs": 15, "rowCount": 1, "at": "..." }
  ]
}
```

## How It Works

### Tree View in Debug Container

Register the tree view in the `debug` views container with a `when` clause:

```jsonc
{
  "contributes": {
    "views": {
      "debug": [{
        "id": "driftViewer.queryPerformance",
        "name": "Drift Queries",
        "when": "inDebugMode && driftViewer.serverConnected"
      }]
    }
  }
}
```

The `when` clause uses:
- `inDebugMode` — built-in VS Code context key, true during debug sessions
- `driftViewer.serverConnected` — custom context key set by the extension

### Tree Structure

```typescript
type PerfTreeItem = SummaryItem | CategoryItem | QueryItem;

class CategoryItem extends vscode.TreeItem {
  constructor(label: string, count: number) {
    super(`${label} (${count})`, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon(label === 'Slow Queries' ? 'warning' : 'list-ordered');
  }
}

class QueryItem extends vscode.TreeItem {
  constructor(query: QueryEntry) {
    super(truncateSql(query.sql, 50), vscode.TreeItemCollapsibleState.None);
    this.description = `${query.durationMs}ms`;
    this.tooltip = new vscode.MarkdownString(
      `**SQL:** \`${query.sql}\`\n\n` +
      `**Duration:** ${query.durationMs}ms\n` +
      `**Rows:** ${query.rowCount}\n` +
      `**Time:** ${query.at}`
    );

    // Color-code by duration
    if (query.durationMs > 500) {
      this.iconPath = new vscode.ThemeIcon('flame', new vscode.ThemeColor('list.errorForeground'));
    } else if (query.durationMs > 100) {
      this.iconPath = new vscode.ThemeIcon('watch', new vscode.ThemeColor('list.warningForeground'));
    } else {
      this.iconPath = new vscode.ThemeIcon('check');
    }

    // Click to explain
    this.command = {
      command: 'driftViewer.explainFromPerf',
      title: 'Explain Query',
      arguments: [query.sql],
    };
  }
}

class SummaryItem extends vscode.TreeItem {
  constructor(stats: PerformanceStats) {
    super(
      `${stats.totalQueries} queries, ${stats.totalDurationMs}ms total`,
      vscode.TreeItemCollapsibleState.None
    );
    this.description = `avg: ${stats.avgDurationMs}ms`;
    this.iconPath = new vscode.ThemeIcon('graph');
  }
}
```

### Tree Data Provider

```typescript
class PerformanceTreeProvider implements vscode.TreeDataProvider<PerfTreeItem> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private _data: PerformanceData | null = null;
  private _refreshTimer: ReturnType<typeof setInterval> | undefined;

  async refresh(client: DriftApiClient): Promise<void> {
    try {
      this._data = await client.performance();
      this._onDidChange.fire();
    } catch {
      this._data = null;
      this._onDidChange.fire();
    }
  }

  getChildren(element?: PerfTreeItem): PerfTreeItem[] {
    if (!this._data) return [new SummaryItem({ totalQueries: 0, totalDurationMs: 0, avgDurationMs: 0 })];

    if (!element) {
      // Root: summary + categories
      return [
        new SummaryItem(this._data),
        new CategoryItem('Slow Queries', this._data.slowQueries.length),
        new CategoryItem('Recent Queries', this._data.recentQueries.length),
      ];
    }

    if (element instanceof CategoryItem) {
      const queries = element.label?.toString().startsWith('Slow')
        ? this._data.slowQueries
        : this._data.recentQueries;
      return queries.map(q => new QueryItem(q));
    }

    return [];
  }

  /** Start auto-refresh during debug sessions */
  startAutoRefresh(client: DriftApiClient): void {
    this._refreshTimer = setInterval(() => this.refresh(client), 3000);
  }

  stopAutoRefresh(): void {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = undefined;
    }
  }
}
```

### Debug Session Lifecycle

```typescript
// Start/stop auto-refresh based on debug session
vscode.debug.onDidStartDebugSession((session) => {
  if (session.type === 'dart') {
    vscode.commands.executeCommand('setContext', 'driftViewer.serverConnected', true);
    perfProvider.startAutoRefresh(client);
  }
});

vscode.debug.onDidTerminateDebugSession((session) => {
  if (session.type === 'dart') {
    vscode.commands.executeCommand('setContext', 'driftViewer.serverConnected', false);
    perfProvider.stopAutoRefresh();
  }
});
```

### Slow Query Threshold

Configurable via settings:

```jsonc
{
  "driftViewer.performance.slowThresholdMs": {
    "type": "number",
    "default": 500,
    "description": "Queries slower than this (ms) are highlighted as slow."
  },
  "driftViewer.performance.refreshIntervalMs": {
    "type": "number",
    "default": 3000,
    "description": "How often to refresh performance data during debug (ms)."
  }
}
```

## package.json Contributions

```jsonc
{
  "contributes": {
    "views": {
      "debug": [{
        "id": "driftViewer.queryPerformance",
        "name": "Drift Queries",
        "when": "inDebugMode"
      }]
    },
    "commands": [
      { "command": "driftViewer.clearPerformance", "title": "Drift Viewer: Clear Query Stats", "icon": "$(trash)" },
      { "command": "driftViewer.refreshPerformance", "title": "Refresh", "icon": "$(refresh)" }
    ],
    "menus": {
      "view/title": [
        {
          "command": "driftViewer.refreshPerformance",
          "when": "view == driftViewer.queryPerformance",
          "group": "navigation"
        },
        {
          "command": "driftViewer.clearPerformance",
          "when": "view == driftViewer.queryPerformance",
          "group": "navigation"
        }
      ]
    }
  }
}
```

## Wiring in extension.ts

```typescript
const perfProvider = new PerformanceTreeProvider();
context.subscriptions.push(
  vscode.window.createTreeView('driftViewer.queryPerformance', {
    treeDataProvider: perfProvider,
  })
);

// Clear stats command
context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.clearPerformance', async () => {
    await client.clearPerformance(); // DELETE /api/analytics/performance
    perfProvider.refresh(client);
  })
);

// Click query → explain
context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.explainFromPerf', (sql: string) => {
    // Reuse Feature 8's ExplainPanel
    ExplainPanel.createOrShow(context, sql, client);
  })
);
```

## Testing

- Test tree structure: root has summary + 2 categories, categories contain query items
- Test query item color coding (green < 100ms, yellow 100-500ms, red > 500ms)
- Test auto-refresh starts/stops with debug sessions
- Test empty state when no performance data

## Known Limitations

- Refreshes every 3 seconds (configurable) — not truly real-time, but close enough
- Server's ring buffer holds last 500 queries; older queries are lost
- Only appears for Dart debug sessions (`session.type === 'dart'`)
- Performance data is server-side — if the server restarts, history is lost
- The `inDebugMode` context key shows the panel for ALL debug sessions, not just Dart; the custom context key `driftViewer.serverConnected` helps but may flash briefly
