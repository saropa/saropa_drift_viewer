# Feature 19: Data Breakpoints

## What It Does

Define conditions on database data ("break when `users.balance` < 0" or "pause when a row is deleted from `orders`") and the extension will pause the VS Code debugger when the condition is met. Combines the existing watch infrastructure with the debug adapter protocol.

## User Experience

1. Right-click a table in the tree view → "Add Data Breakpoint…"
2. A multi-step quick pick appears:
   - Step 1: Choose breakpoint type: "Row Changed", "Row Inserted", "Row Deleted", "Condition Met"
   - Step 2 (for "Condition Met"): Enter SQL condition, e.g., `SELECT COUNT(*) FROM "users" WHERE balance < 0`
3. Breakpoint appears in the "Data Breakpoints" section of the Run/Debug sidebar
4. During a debug session, the extension polls the database on each generation change
5. When the condition is met, VS Code pauses the debugger with a notification:
   > "Data breakpoint hit: users.balance < 0 (3 rows match)"
6. Click the notification to open the matching rows in a table view

### Breakpoint Types

| Type | Trigger |
|------|---------|
| Row Changed | Any cell value changes in the watched table |
| Row Inserted | Row count increases |
| Row Deleted | Row count decreases |
| Condition Met | A SQL query returns a non-zero count |

## New Files

```
extension/src/
  data-breakpoint/
    data-breakpoint-provider.ts   # Manages breakpoint definitions + evaluation
    data-breakpoint-checker.ts    # Polls DB and evaluates conditions
    data-breakpoint-items.ts      # Tree items for the debug sidebar
extension/src/test/
  data-breakpoint-checker.test.ts
```

## Dependencies

- `api-client.ts` — `sql()` for condition evaluation, table metadata for row counts
- `generation-watcher.ts` — triggers re-evaluation on DB changes
- VS Code Debug Adapter Protocol — `vscode.debug.activeDebugSession`

## Architecture

### Breakpoint Definition

```typescript
interface IDataBreakpoint {
  id: string;
  label: string;
  table: string;
  type: 'rowChanged' | 'rowInserted' | 'rowDeleted' | 'conditionMet';
  condition?: string;          // SQL query for conditionMet type
  enabled: boolean;
  lastRowCount?: number;       // for insert/delete detection
  lastRowHash?: string;        // for change detection (hash of all rows)
  hitCount: number;
}
```

### Breakpoint Checker

Runs on each generation change during an active debug session:

```typescript
class DataBreakpointChecker implements vscode.Disposable {
  constructor(
    private readonly _client: DriftApiClient,
    private readonly _breakpoints: IDataBreakpoint[],
  ) {}

  async evaluate(bp: IDataBreakpoint): Promise<IBreakpointHit | null> {
    switch (bp.type) {
      case 'conditionMet': {
        const result = await this._client.sql(bp.condition!);
        const count = this._extractCount(result);
        if (count > 0) {
          return { breakpoint: bp, matchCount: count, rows: result.rows };
        }
        return null;
      }

      case 'rowInserted': {
        const result = await this._client.sql(
          `SELECT COUNT(*) as cnt FROM "${bp.table}"`
        );
        const count = result.rows[0].cnt as number;
        if (bp.lastRowCount !== undefined && count > bp.lastRowCount) {
          const hit = {
            breakpoint: bp,
            matchCount: count - bp.lastRowCount,
            message: `${count - bp.lastRowCount} row(s) inserted`,
          };
          bp.lastRowCount = count;
          return hit;
        }
        bp.lastRowCount = count;
        return null;
      }

      case 'rowDeleted': {
        const result = await this._client.sql(
          `SELECT COUNT(*) as cnt FROM "${bp.table}"`
        );
        const count = result.rows[0].cnt as number;
        if (bp.lastRowCount !== undefined && count < bp.lastRowCount) {
          const hit = {
            breakpoint: bp,
            matchCount: bp.lastRowCount - count,
            message: `${bp.lastRowCount - count} row(s) deleted`,
          };
          bp.lastRowCount = count;
          return hit;
        }
        bp.lastRowCount = count;
        return null;
      }

      case 'rowChanged': {
        // Hash first N rows to detect changes
        const result = await this._client.sql(
          `SELECT * FROM "${bp.table}" LIMIT 1000`
        );
        const hash = this._hashRows(result.rows);
        if (bp.lastRowHash !== undefined && hash !== bp.lastRowHash) {
          bp.lastRowHash = hash;
          return { breakpoint: bp, matchCount: 0, message: 'Data changed' };
        }
        bp.lastRowHash = hash;
        return null;
      }
    }
  }

  private _hashRows(rows: object[]): string {
    return JSON.stringify(rows); // Simple — replace with proper hash if perf matters
  }

  private _extractCount(result: { rows: object[] }): number {
    if (result.rows.length === 0) return 0;
    const first = result.rows[0];
    const val = Object.values(first)[0];
    return typeof val === 'number' ? val : result.rows.length;
  }
}
```

### Debug Session Integration

```typescript
class DataBreakpointProvider implements vscode.Disposable {
  private _breakpoints: IDataBreakpoint[] = [];
  private _checker: DataBreakpointChecker;
  private _evaluating = false;

  async onGenerationChange(): Promise<void> {
    if (!vscode.debug.activeDebugSession || this._evaluating) return;

    this._evaluating = true;
    try {
      const enabled = this._breakpoints.filter(bp => bp.enabled);
      for (const bp of enabled) {
        const hit = await this._checker.evaluate(bp);
        if (hit) {
          bp.hitCount++;
          this._onBreakpointHit(hit);
        }
      }
    } finally {
      this._evaluating = false;
    }
  }

  private _onBreakpointHit(hit: IBreakpointHit): void {
    // Pause the debugger
    vscode.commands.executeCommand('workbench.action.debug.pause');

    // Show notification
    vscode.window.showWarningMessage(
      `Data breakpoint hit: ${hit.breakpoint.label} (${hit.message ?? hit.matchCount + ' rows match'})`,
      'View Rows'
    ).then(action => {
      if (action === 'View Rows' && hit.rows) {
        // Open matching rows in a table view
        this._showMatchingRows(hit);
      }
    });
  }
}
```

### Data Flow

```
Generation Change
    │
    ▼
DataBreakpointProvider.onGenerationChange()
    │
    ├── Is debug session active? ──No──▶ skip
    │
    ▼ Yes
DataBreakpointChecker.evaluate(bp)
    │
    ├── sql() / row count / hash
    │
    ▼
    Hit? ──No──▶ continue to next bp
    │
    ▼ Yes
    workbench.action.debug.pause
    │
    ▼
    Show notification + optional row viewer
```

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.addDataBreakpoint",
        "title": "Saropa Drift Advisor: Add Data Breakpoint",
        "icon": "$(debug-breakpoint-data)"
      },
      {
        "command": "driftViewer.removeDataBreakpoint",
        "title": "Saropa Drift Advisor: Remove Data Breakpoint"
      },
      {
        "command": "driftViewer.toggleDataBreakpoint",
        "title": "Saropa Drift Advisor: Toggle Data Breakpoint"
      }
    ],
    "menus": {
      "view/item/context": [{
        "command": "driftViewer.addDataBreakpoint",
        "when": "viewItem == driftTable",
        "group": "5_breakpoint"
      }]
    },
    "configuration": {
      "properties": {
        "driftViewer.dataBreakpoints.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Enable data breakpoint evaluation during debug sessions."
        },
        "driftViewer.dataBreakpoints.pollIntervalMs": {
          "type": "number",
          "default": 1000,
          "description": "Minimum interval between breakpoint evaluations (ms)."
        }
      }
    }
  }
}
```

## Wiring in extension.ts

```typescript
const dbpProvider = new DataBreakpointProvider(client);
context.subscriptions.push(dbpProvider);

// Evaluate on generation change (only during debug)
watcher.onDidChange(() => dbpProvider.onGenerationChange());

context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.addDataBreakpoint', async (item?: TableItem) => {
    const table = item?.tableMetadata.name ?? await pickTable(client);
    if (!table) return;

    const type = await vscode.window.showQuickPick(
      [
        { label: 'Condition Met', value: 'conditionMet', description: 'SQL returns non-zero count' },
        { label: 'Row Inserted', value: 'rowInserted', description: 'Row count increases' },
        { label: 'Row Deleted', value: 'rowDeleted', description: 'Row count decreases' },
        { label: 'Row Changed', value: 'rowChanged', description: 'Any data changes' },
      ],
      { placeHolder: 'Breakpoint type' }
    );
    if (!type) return;

    let condition: string | undefined;
    if (type.value === 'conditionMet') {
      condition = await vscode.window.showInputBox({
        prompt: 'SQL condition (must return count)',
        placeHolder: 'SELECT COUNT(*) FROM "users" WHERE balance < 0',
      });
      if (!condition) return;
    }

    dbpProvider.add(table, type.value as IDataBreakpoint['type'], condition);
  }),

  vscode.commands.registerCommand('driftViewer.removeDataBreakpoint', (bp: IDataBreakpoint) => {
    dbpProvider.remove(bp.id);
  }),

  vscode.commands.registerCommand('driftViewer.toggleDataBreakpoint', (bp: IDataBreakpoint) => {
    dbpProvider.toggle(bp.id);
  })
);
```

## Server-Side Changes

None. Uses existing `POST /api/sql` and table metadata endpoints.

## Testing

- `data-breakpoint-checker.test.ts`:
  - `conditionMet`: mock SQL returning count > 0 → hit; count 0 → no hit
  - `rowInserted`: mock count increasing → hit; same → no hit
  - `rowDeleted`: mock count decreasing → hit; same → no hit
  - `rowChanged`: mock different row data → hit; same → no hit
  - Edge: first evaluation (no baseline) → never hits
  - Edge: disabled breakpoint → skipped

## Known Limitations

- "Row Changed" type hashes up to 1000 rows — changes beyond that are invisible
- Pausing the debugger via command is a "soft pause" — not a true DAP data breakpoint
- Polling interval is bounded by generation watcher frequency (not sub-second)
- Condition SQL must be a SELECT — no validation that it's actually a count query
- Multiple breakpoints evaluating simultaneously could cause API congestion
- Breakpoints are persisted in workspace state — not shareable via settings sync
- No hit-count conditional breakpoints (e.g., "break after 5th insert")
