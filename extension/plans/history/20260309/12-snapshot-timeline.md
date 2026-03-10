# Feature 12: Snapshot Timeline

## What It Does

Database change history appears in VS Code's Timeline panel (below the file explorer, alongside git history). Auto-snapshots every N seconds. Click an entry to see a diff view of rows added/removed/changed since that point.

## User Experience

In the Timeline panel (when a `.dart` table file is selected):
```
TIMELINE
  ○ Now — users: 42 rows
  ● 30s ago — users: 41 rows (+1 row)
  ● 1m ago — users: 40 rows (+2 rows, 1 changed)
  ● 2m ago — users: 38 rows (initial snapshot)
  ─── Git History ───
  ○ 3h ago — "Add user migration" (commit abc123)
```

Click a timeline entry → opens a webview diff showing:
- Rows added (green)
- Rows removed (red)
- Cells changed (yellow highlights with before/after)

## New Files

```
extension/src/
  timeline/
    drift-timeline-provider.ts    # TimelineProvider implementation
    snapshot-store.ts             # In-memory snapshot storage + auto-capture
    snapshot-diff-panel.ts        # Webview for diff visualization
extension/src/test/
  drift-timeline-provider.test.ts
  snapshot-store.test.ts
```

## Dependencies

- `api-client.ts` (Feature 1) — fetch table data for snapshots
- `generation-watcher.ts` (Feature 1) — trigger snapshots on data change

## API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `GET /api/schema/metadata` | Current table list and row counts |
| `POST /api/sql` | Fetch full table data for snapshot |
| `POST /api/snapshot` | Server-side snapshot (alternative) |
| `GET /api/snapshot/compare` | Server-side diff (alternative) |

Two approaches:
- **Client-side snapshots**: Extension fetches and stores row data locally. More control, works offline after capture.
- **Server-side snapshots**: Use existing `/api/snapshot` + `/api/snapshot/compare`. Simpler but only 1 snapshot at a time.

Recommended: **Hybrid** — use server-side for the initial snapshot and comparison API, but store multiple snapshots client-side for timeline history.

## How It Works

### Snapshot Store

```typescript
interface Snapshot {
  id: string;                          // ISO timestamp
  timestamp: number;                   // Date.now()
  tables: Map<string, SnapshotTable>;  // tableName -> data
}

interface SnapshotTable {
  rowCount: number;
  rows: Record<string, unknown>[];     // full row data (limited to first 1000 rows)
  columns: string[];
}

class SnapshotStore implements vscode.Disposable {
  private _snapshots: Snapshot[] = [];
  private _maxSnapshots = 20;          // rolling window
  private _autoInterval: ReturnType<typeof setInterval> | undefined;

  /** Capture current DB state as a snapshot */
  async capture(client: DriftApiClient): Promise<Snapshot> {
    const metadata = await client.schemaMetadata();
    const tables = new Map<string, SnapshotTable>();

    for (const table of metadata.tables) {
      // Limit to 1000 rows per table to keep memory reasonable
      const result = await client.runSql(
        `SELECT * FROM "${table.name}" ORDER BY rowid LIMIT 1000`
      );
      tables.set(table.name, {
        rowCount: table.rowCount,
        rows: result.rows,
        columns: table.columns.map(c => c.name),
      });
    }

    const snapshot: Snapshot = {
      id: new Date().toISOString(),
      timestamp: Date.now(),
      tables,
    };

    this._snapshots.push(snapshot);
    if (this._snapshots.length > this._maxSnapshots) {
      this._snapshots.shift(); // remove oldest
    }

    return snapshot;
  }

  /** Start auto-capturing on generation changes */
  startAuto(watcher: GenerationWatcher, client: DriftApiClient): void {
    watcher.onDidChange(() => this.capture(client));
  }
}
```

### Timeline Provider

```typescript
class DriftTimelineProvider implements vscode.TimelineProvider {
  readonly id = 'driftViewer.timeline';
  readonly label = 'Drift Database';
  readonly scheme = 'file';

  private readonly _onDidChange = new vscode.EventEmitter<vscode.TimelineChangeEvent>();
  readonly onDidChange = this._onDidChange.event;

  constructor(
    private readonly _store: SnapshotStore,
    private readonly _tableFileMap: Map<string, string>,  // sqlTable -> filePath
  ) {}

  async provideTimeline(
    uri: vscode.Uri,
    options: vscode.TimelineOptions,
    token: vscode.CancellationToken,
  ): Promise<vscode.Timeline> {
    // Find which table(s) are defined in this file
    const tables = this.getTablesForFile(uri);
    if (tables.length === 0) return { items: [] };

    const items: vscode.TimelineItem[] = [];

    for (const snapshot of this._store.snapshots.reverse()) {
      for (const tableName of tables) {
        const tableData = snapshot.tables.get(tableName);
        if (!tableData) continue;

        // Compare with next-newer snapshot to get delta
        const delta = this.computeDelta(tableName, snapshot);

        const item = new vscode.TimelineItem(
          `${tableName}: ${tableData.rowCount} rows${delta}`,
          snapshot.timestamp,
        );
        item.description = formatRelativeTime(snapshot.timestamp);
        item.command = {
          command: 'driftViewer.showSnapshotDiff',
          title: 'Show Diff',
          arguments: [snapshot.id, tableName],
        };
        item.iconPath = new vscode.ThemeIcon('history');
        items.push(item);
      }
    }

    return { items };
  }

  private computeDelta(tableName: string, snapshot: Snapshot): string {
    const newer = this._store.getNewerSnapshot(snapshot);
    if (!newer) return '';

    const oldCount = snapshot.tables.get(tableName)?.rowCount ?? 0;
    const newCount = newer.tables.get(tableName)?.rowCount ?? 0;
    const diff = newCount - oldCount;

    if (diff > 0) return ` (+${diff})`;
    if (diff < 0) return ` (${diff})`;
    return ' (unchanged)';
  }
}
```

### Diff Visualization

When clicking a timeline entry, open a webview showing the row-level diff between that snapshot and the current state:

```typescript
vscode.commands.registerCommand('driftViewer.showSnapshotDiff', (snapshotId, tableName) => {
  const snapshot = store.getById(snapshotId);
  const oldRows = snapshot.tables.get(tableName)?.rows ?? [];
  const currentRows = /* fetch current via API */;
  const diff = computeRowDiff(oldRows, currentRows);
  SnapshotDiffPanel.createOrShow(context, tableName, diff);
});
```

Row diff uses the same algorithm as Feature 4 (Live Watch) — PK-based matching, cell-level comparison.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      { "command": "driftViewer.captureSnapshot", "title": "Drift Viewer: Capture Snapshot" },
      { "command": "driftViewer.showSnapshotDiff", "title": "Drift Viewer: Show Snapshot Diff" }
    ],
    "configuration": {
      "properties": {
        "driftViewer.timeline.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Show database snapshots in the Timeline panel."
        },
        "driftViewer.timeline.maxSnapshots": {
          "type": "number",
          "default": 20,
          "description": "Maximum number of snapshots to keep in memory."
        },
        "driftViewer.timeline.autoCapture": {
          "type": "boolean",
          "default": true,
          "description": "Automatically capture snapshots on data changes."
        }
      }
    }
  }
}
```

## Wiring in extension.ts

```typescript
const snapshotStore = new SnapshotStore();
const timelineProvider = new DriftTimelineProvider(snapshotStore, tableFileMap);

context.subscriptions.push(
  vscode.workspace.registerTimelineProvider('file', timelineProvider)
);

// Auto-capture on data change
if (config.get('timeline.autoCapture', true)) {
  snapshotStore.startAuto(watcher, client);
}

// Manual capture command
context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.captureSnapshot', async () => {
    await snapshotStore.capture(client);
    vscode.window.showInformationMessage('Drift snapshot captured.');
  })
);
```

## Testing

- Test snapshot capture stores correct data
- Test rolling window (oldest removed when max exceeded)
- Test timeline items generated for correct tables based on file URI
- Test delta calculation (added/removed/unchanged)
- Test empty state (no snapshots yet)

## Known Limitations

- Snapshots are in-memory only — lost on extension reload / VS Code restart
- Row limit of 1000 per table per snapshot — large tables are truncated
- Auto-capture on every data change could be noisy; consider debouncing (min 10s between captures)
- Timeline panel is file-scoped — requires knowing which file defines which table (depends on Dart parser)
- Memory usage: 20 snapshots x N tables x 1000 rows could be significant for large schemas
