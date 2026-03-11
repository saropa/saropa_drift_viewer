# Feature 41: Schema Evolution Timeline

## What It Does

Track and visualize how the database schema changes over time. Every time the generation changes, capture a schema fingerprint (tables, columns, types, FKs). Display a visual timeline showing when tables were added/removed, columns changed type, and FKs were modified. See your schema's history without needing to look at migration files.

## User Experience

1. Command palette → "Saropa Drift Advisor: Show Schema Timeline" or status bar click
2. A webview panel shows the evolution timeline:

```
╔══════════════════════════════════════════════════════════════════╗
║  SCHEMA EVOLUTION TIMELINE                        [Export]      ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  ● Gen 1 — 10:30:15 (Initial)                                  ║
║  │  3 tables: users, orders, products                           ║
║  │                                                               ║
║  ● Gen 2 — 10:31:42 (+1m 27s)                                  ║
║  │  ✚ Added table: sessions (4 columns)                         ║
║  │                                                               ║
║  ● Gen 3 — 10:33:10 (+1m 28s)                                  ║
║  │  ✎ Modified users: added column "avatar_url" (TEXT)          ║
║  │  ✎ Modified orders: "total" type changed REAL → TEXT         ║
║  │                                                               ║
║  ● Gen 4 — 10:35:55 (+2m 45s)                                  ║
║  │  ✚ Added table: order_items (5 columns)                      ║
║  │  ✚ Added FK: order_items.order_id → orders.id               ║
║  │                                                               ║
║  ● Gen 5 — 10:40:01 (+4m 6s)                                   ║
║  │  ✖ Dropped table: products                                   ║
║  │  ✎ Modified users: removed column "age"                      ║
║  │                                                               ║
║  ● Gen 6 — 10:42:30 (current)                                  ║
║  │  No schema changes (data only)                               ║
║                                                                  ║
║  ──────────────────────────────────────────────────              ║
║  Summary: 4 tables added, 1 dropped, 3 modified, 1 FK added    ║
╚══════════════════════════════════════════════════════════════════╝
```

3. Click any generation to see full schema details at that point
4. Click between two generations to see the diff

## New Files

```
extension/src/
  schema-timeline/
    schema-timeline-panel.ts   # Webview panel lifecycle
    schema-timeline-html.ts    # HTML template with timeline visualization
    schema-tracker.ts          # Captures and stores schema snapshots
    schema-differ.ts           # Diffs two schema snapshots
    schema-timeline-types.ts   # Shared interfaces
extension/src/test/
  schema-tracker.test.ts
  schema-differ.test.ts
```

## Dependencies

- `api-client.ts` — `schemaMetadata()`, `tableFkMeta()`
- `generation-watcher.ts` — triggers snapshot capture on generation change

## Architecture

### Schema Snapshot

```typescript
interface ISchemaSnapshot {
  generation: number;
  timestamp: string;
  tables: ITableSnapshot[];
}

interface ITableSnapshot {
  name: string;
  columns: IColumnSnapshot[];
  fks: IFkSnapshot[];
  rowCount: number;
}

interface IColumnSnapshot {
  name: string;
  type: string;
  pk: boolean;
  nullable: boolean;
  defaultValue: string | null;
}

interface IFkSnapshot {
  fromColumn: string;
  toTable: string;
  toColumn: string;
}
```

### Schema Tracker

Captures snapshots on generation change and stores them:

```typescript
class SchemaTracker implements vscode.Disposable {
  private _snapshots: ISchemaSnapshot[] = [];
  private _disposable: vscode.Disposable;

  private _onDidUpdate = new vscode.EventEmitter<ISchemaSnapshot[]>();
  readonly onDidUpdate = this._onDidUpdate.event;

  constructor(
    private readonly _client: DriftApiClient,
    private readonly _state: vscode.Memento,
    watcher: GenerationWatcher,
  ) {
    this._snapshots = _state.get<ISchemaSnapshot[]>('schema.timeline', []);

    this._disposable = watcher.onDidChange(async (gen) => {
      await this._capture(gen);
    });
  }

  private async _capture(generation: number): Promise<void> {
    const meta = await this._client.schemaMetadata();
    const tables: ITableSnapshot[] = [];

    for (const table of meta.tables) {
      if (table.name.startsWith('sqlite_')) continue;

      const fks = await this._client.tableFkMeta(table.name);
      tables.push({
        name: table.name,
        columns: table.columns.map(c => ({
          name: c.name,
          type: c.type,
          pk: c.pk,
          nullable: c.nullable,
          defaultValue: c.defaultValue,
        })),
        fks: fks.map((fk: { from: string; table: string; to: string }) => ({
          fromColumn: fk.from,
          toTable: fk.table,
          toColumn: fk.to,
        })),
        rowCount: table.rowCount,
      });
    }

    const snapshot: ISchemaSnapshot = {
      generation,
      timestamp: new Date().toISOString(),
      tables,
    };

    this._snapshots.push(snapshot);

    // Keep last 100 snapshots
    if (this._snapshots.length > 100) {
      this._snapshots = this._snapshots.slice(-100);
    }

    this._state.update('schema.timeline', this._snapshots);
    this._onDidUpdate.fire(this._snapshots);
  }

  getAll(): readonly ISchemaSnapshot[] {
    return this._snapshots;
  }

  dispose(): void {
    this._disposable.dispose();
    this._onDidUpdate.dispose();
  }
}
```

### Schema Differ

Compares two snapshots and produces a structured diff:

```typescript
type SchemaChangeType =
  | 'table_added'
  | 'table_dropped'
  | 'column_added'
  | 'column_removed'
  | 'column_type_changed'
  | 'fk_added'
  | 'fk_removed'
  | 'data_only';

interface ISchemaChange {
  type: SchemaChangeType;
  table: string;
  detail: string;
}

class SchemaDiffer {
  diff(before: ISchemaSnapshot, after: ISchemaSnapshot): ISchemaChange[] {
    const changes: ISchemaChange[] = [];
    const beforeTables = new Map(before.tables.map(t => [t.name, t]));
    const afterTables = new Map(after.tables.map(t => [t.name, t]));

    // Added tables
    for (const [name, table] of afterTables) {
      if (!beforeTables.has(name)) {
        changes.push({
          type: 'table_added',
          table: name,
          detail: `${table.columns.length} columns`,
        });
      }
    }

    // Dropped tables
    for (const [name] of beforeTables) {
      if (!afterTables.has(name)) {
        changes.push({
          type: 'table_dropped',
          table: name,
          detail: '',
        });
      }
    }

    // Modified tables
    for (const [name, afterTable] of afterTables) {
      const beforeTable = beforeTables.get(name);
      if (!beforeTable) continue;

      // Column changes
      const beforeCols = new Map(beforeTable.columns.map(c => [c.name, c]));
      const afterCols = new Map(afterTable.columns.map(c => [c.name, c]));

      for (const [colName, col] of afterCols) {
        if (!beforeCols.has(colName)) {
          changes.push({
            type: 'column_added',
            table: name,
            detail: `"${colName}" (${col.type})`,
          });
        } else {
          const beforeCol = beforeCols.get(colName)!;
          if (beforeCol.type !== col.type) {
            changes.push({
              type: 'column_type_changed',
              table: name,
              detail: `"${colName}" ${beforeCol.type} → ${col.type}`,
            });
          }
        }
      }

      for (const [colName] of beforeCols) {
        if (!afterCols.has(colName)) {
          changes.push({
            type: 'column_removed',
            table: name,
            detail: `"${colName}"`,
          });
        }
      }

      // FK changes
      const beforeFkKeys = new Set(
        beforeTable.fks.map(f => `${f.fromColumn}->${f.toTable}.${f.toColumn}`)
      );
      const afterFkKeys = new Set(
        afterTable.fks.map(f => `${f.fromColumn}->${f.toTable}.${f.toColumn}`)
      );

      for (const fk of afterTable.fks) {
        const key = `${fk.fromColumn}->${fk.toTable}.${fk.toColumn}`;
        if (!beforeFkKeys.has(key)) {
          changes.push({
            type: 'fk_added',
            table: name,
            detail: `${name}.${fk.fromColumn} → ${fk.toTable}.${fk.toColumn}`,
          });
        }
      }

      for (const fk of beforeTable.fks) {
        const key = `${fk.fromColumn}->${fk.toTable}.${fk.toColumn}`;
        if (!afterFkKeys.has(key)) {
          changes.push({
            type: 'fk_removed',
            table: name,
            detail: `${name}.${fk.fromColumn} → ${fk.toTable}.${fk.toColumn}`,
          });
        }
      }
    }

    return changes;
  }
}
```

### Webview Message Protocol

Webview → Extension:
```typescript
{ command: 'selectGeneration', generation: number }
{ command: 'diffGenerations', from: number, to: number }
{ command: 'export' }
```

Extension → Webview:
```typescript
{ command: 'init', snapshots: ISchemaSnapshot[], diffs: { from: number; to: number; changes: ISchemaChange[] }[] }
{ command: 'update', snapshots: ISchemaSnapshot[], diffs: ... }
{ command: 'generationDetail', snapshot: ISchemaSnapshot }
```

## Server-Side Changes

None.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.showSchemaTimeline",
        "title": "Saropa Drift Advisor: Show Schema Timeline",
        "icon": "$(history)"
      }
    ],
    "menus": {
      "view/title": [{
        "command": "driftViewer.showSchemaTimeline",
        "when": "view == driftViewer.databaseExplorer && driftViewer.serverConnected",
        "group": "navigation"
      }]
    }
  }
}
```

## Wiring in extension.ts

```typescript
const schemaTracker = new SchemaTracker(client, context.workspaceState, watcher);
context.subscriptions.push(schemaTracker);

context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.showSchemaTimeline', () => {
    const snapshots = schemaTracker.getAll();
    SchemaTimelinePanel.createOrShow(context.extensionUri, snapshots, schemaTracker);
  })
);
```

## Testing

- `schema-tracker.test.ts`:
  - Captures snapshot on generation change
  - Stores snapshots in workspace state
  - Limits to 100 snapshots (oldest pruned)
  - Fires `onDidUpdate` event
  - Skips `sqlite_` tables
- `schema-differ.test.ts`:
  - Detects added tables
  - Detects dropped tables
  - Detects added columns
  - Detects removed columns
  - Detects type changes
  - Detects FK additions and removals
  - Identical snapshots → no changes
  - Data-only change (same schema) → empty diff

## Known Limitations

- Tracking starts from the moment the extension activates — no historical data from before
- Schema snapshots are stored in workspace state — may grow large with many generations
- Capped at 100 snapshots to prevent memory issues
- Column default value changes are not tracked (only type changes)
- Nullable/PK attribute changes are not tracked (only structural changes)
- No "revert to schema" action — timeline is read-only
- Cross-session tracking requires workspace state to persist
- No timeline filtering or date range selection
- Multiple rapid schema changes may flood the timeline
