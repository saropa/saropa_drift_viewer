# Feature 60: Time-Travel Data Slider

## What It Does

Scrub a timeline slider to see table data at any historical snapshot point. Built on the existing Snapshot Timeline infrastructure (Feature 12), this adds a visual slider control that lets you "rewind" a table to see its state at any captured snapshot. Watch rows appear, disappear, and change values frame-by-frame.

## User Experience

1. Open a table's data view
2. Click the clock icon to enable time-travel mode
3. A slider appears at the top spanning all captured snapshots
4. Drag the slider → table data updates to show the state at that snapshot
5. Changed cells highlighted with diff colors (green = added, red = removed, yellow = changed)
6. Play button auto-advances through snapshots like an animation

```
╔══════════════════════════════════════════════════════════════╗
║  TABLE: orders — Time Travel Mode                            ║
║  ◀ ▶ ⏸  ──●──────────────────────────────── ▶              ║
║  Snapshot 3 of 14 — 10:42:15 (2 min ago)                    ║
║  3 rows added, 1 changed since previous                      ║
╠══════════════════════════════════════════════════════════════╣
║  id  │ user_id │ total   │ status    │ created_at            ║
║  ────┼─────────┼─────────┼───────────┼───────────────────── ║
║   91 │ 42      │  59.99  │ shipped   │ 2026-03-08            ║
║   92 │ 42      │ 120.00  │ [pending] │ 2026-03-09  ← yellow ║
║  +93 │ 17      │  35.50  │ delivered │ 2026-03-10  ← green  ║
║  +94 │ 8       │  22.00  │ pending   │ 2026-03-10  ← green  ║
║  +95 │ 42      │  15.99  │ pending   │ 2026-03-10  ← green  ║
╚══════════════════════════════════════════════════════════════╝
```

## New Files

```
extension/src/time-travel/
  time-travel-panel.ts        # Webview panel with slider + table
  time-travel-html.ts         # HTML template
  time-travel-engine.ts       # Snapshot data retrieval + diff computation
  time-travel-types.ts        # Interfaces
extension/src/test/
  time-travel-engine.test.ts
```

## Modified Files

```
extension/src/extension.ts              # Register command
extension/src/timeline/timeline-provider.ts  # Expose snapshot data for time-travel
extension/package.json                  # Command + context menu
```

## Dependencies

- `DriftTimelineProvider` — existing snapshot capture and storage
- `api-client.ts` — `sql()` for fetching table data at current state
- Snapshot data stored in workspace state by the timeline provider

## Architecture

### Snapshot Data Model

The existing `DriftTimelineProvider` captures row snapshots on generation change. Each snapshot contains per-table row data:

```typescript
interface ITimelineSnapshot {
  id: number;
  timestamp: number;
  generation: number;
  tables: Record<string, ITableSnapshot>;
}

interface ITableSnapshot {
  rowCount: number;
  rows: Record<string, unknown>[];
  columns: string[];
}
```

### Time-Travel Engine

Retrieves snapshot data and computes diffs between adjacent snapshots:

```typescript
interface ITimeTravelState {
  snapshotIndex: number;
  table: string;
  rows: ITimeTravelRow[];
  totalSnapshots: number;
  timestamp: number;
  diffSummary: { added: number; removed: number; changed: number };
}

interface ITimeTravelRow {
  data: Record<string, unknown>;
  status: 'unchanged' | 'added' | 'removed' | 'changed';
  changedColumns: string[];
}

class TimeTravelEngine {
  constructor(private readonly _timeline: DriftTimelineProvider) {}

  getSnapshotCount(): number {
    return this._timeline.snapshots.length;
  }

  getStateAt(table: string, snapshotIndex: number): ITimeTravelState {
    const snapshots = this._timeline.snapshots;
    const current = snapshots[snapshotIndex];
    const previous = snapshotIndex > 0 ? snapshots[snapshotIndex - 1] : undefined;

    const currentRows = current.tables[table]?.rows ?? [];
    const previousRows = previous?.tables[table]?.rows ?? [];

    const rows = this._diffRows(currentRows, previousRows, current.tables[table]?.columns ?? []);

    return {
      snapshotIndex,
      table,
      rows,
      totalSnapshots: snapshots.length,
      timestamp: current.timestamp,
      diffSummary: {
        added: rows.filter(r => r.status === 'added').length,
        removed: rows.filter(r => r.status === 'removed').length,
        changed: rows.filter(r => r.status === 'changed').length,
      },
    };
  }

  private _diffRows(
    current: Record<string, unknown>[],
    previous: Record<string, unknown>[],
    columns: string[],
  ): ITimeTravelRow[] {
    const pkCol = columns[0];  // Assume first column is PK
    const prevMap = new Map(previous.map(r => [String(r[pkCol]), r]));
    const currMap = new Map(current.map(r => [String(r[pkCol]), r]));
    const rows: ITimeTravelRow[] = [];

    // Current rows: unchanged, added, or changed
    for (const row of current) {
      const pk = String(row[pkCol]);
      const prev = prevMap.get(pk);
      if (!prev) {
        rows.push({ data: row, status: 'added', changedColumns: [] });
      } else {
        const changed = columns.filter(c => row[c] !== prev[c]);
        rows.push({
          data: row,
          status: changed.length > 0 ? 'changed' : 'unchanged',
          changedColumns: changed,
        });
      }
    }

    // Removed rows (in previous but not current)
    for (const row of previous) {
      const pk = String(row[pkCol]);
      if (!currMap.has(pk)) {
        rows.push({ data: row, status: 'removed', changedColumns: [] });
      }
    }

    return rows;
  }
}
```

### Playback Controller

Client-side JS in the webview handles animation playback:

```typescript
// Webview-side
let playbackInterval: number | null = null;
const PLAYBACK_SPEED_MS = 1000;

function play(): void {
  playbackInterval = setInterval(() => {
    if (currentIndex >= totalSnapshots - 1) {
      pause();
      return;
    }
    currentIndex++;
    slider.value = String(currentIndex);
    vscode.postMessage({ command: 'seekTo', index: currentIndex });
  }, PLAYBACK_SPEED_MS);
}

function pause(): void {
  if (playbackInterval !== null) {
    clearInterval(playbackInterval);
    playbackInterval = null;
  }
}
```

### Webview Message Protocol

Webview → Extension:
```typescript
{ command: 'seekTo', index: number }
{ command: 'play' }
{ command: 'pause' }
{ command: 'setTable', table: string }
{ command: 'setSpeed', speedMs: number }
```

Extension → Webview:
```typescript
{ command: 'state', state: ITimeTravelState }
{ command: 'snapshotInfo', count: number, timestamps: number[] }
{ command: 'tables', names: string[] }
```

## Server-Side Changes

None. Uses existing snapshot data captured by `DriftTimelineProvider`.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.timeTravel",
        "title": "Saropa Drift Advisor: Time Travel",
        "icon": "$(history)"
      }
    ],
    "menus": {
      "view/item/context": [
        {
          "command": "driftViewer.timeTravel",
          "when": "viewItem == driftTable || viewItem == driftTablePinned",
          "group": "1_view"
        }
      ]
    },
    "configuration": {
      "properties": {
        "driftViewer.timeTravel.playbackSpeedMs": {
          "type": "number",
          "default": 1000,
          "minimum": 200,
          "maximum": 5000,
          "description": "Playback speed in milliseconds per snapshot."
        }
      }
    }
  }
}
```

## Testing

- `time-travel-engine.test.ts`:
  - Single snapshot → all rows "unchanged", no diff
  - Row added between snapshots → status "added"
  - Row removed between snapshots → status "removed"
  - Row value changed → status "changed", `changedColumns` populated
  - First snapshot (no previous) → all rows "added"
  - Empty table at snapshot → empty rows array
  - Table not present in snapshot → empty rows array
  - Multiple changes in same row → all changed columns listed
  - Diff summary counts are accurate
  - Snapshot index bounds checked (0 to count-1)

## Known Limitations

- Depends on snapshots being captured — if auto-capture is disabled or interval is too long, gaps appear in the timeline
- Maximum 20 snapshots retained (existing timeline limit) — older data is lost
- Snapshot data is stored in workspace state, which has size limits — large tables with many snapshots may be truncated
- PK detection assumes first column — tables without a clear PK may show incorrect diffs
- Removed rows shown at the bottom with strikethrough — no positional stability
- No interpolation between snapshots — data jumps discretely
- Playback doesn't capture new snapshots — it only replays existing ones
