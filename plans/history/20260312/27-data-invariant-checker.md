# Feature 27: Data Invariant Checker

**Status: ✅ IMPLEMENTED** (2026-03-12)

## What It Does

Define data integrity rules ("every order has at least one line item", "user.email is unique and non-null", "account.balance >= 0") and run them continuously during debug or on-demand. Violations surface as VS Code diagnostics on the Dart table definition files, with links to the offending rows.

## User Experience

### 1. Define Rules

Command palette → "Saropa Drift Advisor: Manage Data Invariants" → opens a rule editor:

```
╔═══════════════════════════════════════════════════════════╗
║  DATA INVARIANTS                     [+ Add Rule] [Run All]║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  ✅ 1. users.email is unique                             ║
║     SELECT email, COUNT(*) c FROM "users"                ║
║     GROUP BY email HAVING c > 1                          ║
║     Expect: 0 rows                                       ║
║     Last check: 10:42:31 — PASS                         ║
║                                                           ║
║  ❌ 2. Every order has line items                        ║
║     SELECT o.id FROM "orders" o                          ║
║     LEFT JOIN "order_items" oi ON oi.order_id = o.id     ║
║     WHERE oi.id IS NULL                                  ║
║     Expect: 0 rows                                       ║
║     Last check: 10:42:31 — FAIL (3 rows)                ║
║     → order ids: 101, 203, 445                           ║
║                                                           ║
║  ✅ 3. account.balance >= 0                              ║
║     SELECT * FROM "accounts" WHERE balance < 0           ║
║     Expect: 0 rows                                       ║
║     Last check: 10:42:31 — PASS                         ║
║                                                           ║
║  ⏸ 4. No orphaned FK references (disabled)              ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
```

### 2. Quick Rule Templates

When adding a rule, offer common templates:

| Template | Generated SQL |
|----------|---------------|
| Column is unique | `SELECT col, COUNT(*) c FROM "t" GROUP BY col HAVING c > 1` |
| Column is not null | `SELECT * FROM "t" WHERE col IS NULL` |
| Column >= value | `SELECT * FROM "t" WHERE col < value` |
| FK references exist | `SELECT a.* FROM "t" a LEFT JOIN "parent" p ON a.fk = p.id WHERE p.id IS NULL` |
| Row count in range | `SELECT CASE WHEN COUNT(*) BETWEEN min AND max THEN 0 ELSE 1 END FROM "t"` |
| Every parent has children | `SELECT p.* FROM "parent" p LEFT JOIN "child" c ON c.fk = p.id WHERE c.id IS NULL` |
| Custom SQL | User writes their own query |

### 3. Continuous Checking

When enabled, invariants are re-evaluated on every generation change. Violations appear as:
- VS Code diagnostics (warnings/errors) on the Dart table definition file
- Problems panel entries with links to the offending rows
- Status bar indicator: "Invariants: 5/6 passing"

### 4. Violations View

Click a failed invariant → opens the violation rows in a table view with the offending values highlighted.

## New Files

### Extension-Side (TypeScript)

```
extension/src/
  invariants/
    invariant-manager.ts      # CRUD + evaluation of invariant rules
    invariant-panel.ts        # Webview panel for rule management
    invariant-html.ts         # HTML template
    invariant-diagnostics.ts  # Maps violations to VS Code diagnostics
    invariant-templates.ts    # Pre-built rule templates
    invariant-types.ts        # Shared interfaces
extension/src/test/
  invariant-manager.test.ts
  invariant-templates.test.ts
  invariant-diagnostics.test.ts
```

## Dependencies

- `api-client.ts` — `sql()` for rule evaluation, `schemaMetadata()` + `tableFkMeta()` for templates
- `generation-watcher.ts` — triggers re-evaluation on DB changes
- `codelens/table-name-mapper.ts` — maps table names to Dart file locations for diagnostics

## Architecture

### Invariant Definition

```typescript
interface IInvariant {
  id: string;
  name: string;                          // Human-readable label
  table: string;                         // Primary table this rule applies to
  sql: string;                           // Query that returns violating rows
  expectation: 'zero_rows' | 'non_zero'; // What constitutes a pass
  severity: 'error' | 'warning' | 'info';
  enabled: boolean;
  lastResult?: IInvariantResult;
}

interface IInvariantResult {
  passed: boolean;
  violationCount: number;
  violatingRows: Record<string, unknown>[];  // first N rows
  checkedAt: number;                          // timestamp
  durationMs: number;
}
```

### Invariant Manager

```typescript
class InvariantManager implements vscode.Disposable {
  private _invariants: IInvariant[] = [];
  private _evaluating = false;

  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private _onViolation = new vscode.EventEmitter<IInvariant>();
  readonly onViolation = this._onViolation.event;

  constructor(
    private readonly _client: DriftApiClient,
    private readonly _state: vscode.Memento,
  ) {
    this._invariants = _state.get<IInvariant[]>('invariants', []);
  }

  add(invariant: Omit<IInvariant, 'id'>): void {
    this._invariants.push({
      ...invariant,
      id: crypto.randomUUID(),
    });
    this._persist();
    this._onDidChange.fire();
  }

  remove(id: string): void {
    this._invariants = this._invariants.filter(i => i.id !== id);
    this._persist();
    this._onDidChange.fire();
  }

  async evaluateAll(): Promise<void> {
    if (this._evaluating) return;
    this._evaluating = true;

    try {
      const enabled = this._invariants.filter(i => i.enabled);
      for (const inv of enabled) {
        await this._evaluate(inv);
      }
      this._persist();
      this._onDidChange.fire();
    } finally {
      this._evaluating = false;
    }
  }

  private async _evaluate(inv: IInvariant): Promise<void> {
    const start = Date.now();
    try {
      const result = await this._client.sql(inv.sql);
      const violationCount = result.rows.length;
      const passed = inv.expectation === 'zero_rows'
        ? violationCount === 0
        : violationCount > 0;

      inv.lastResult = {
        passed,
        violationCount,
        violatingRows: result.rows.slice(0, 20),  // cap at 20
        checkedAt: Date.now(),
        durationMs: Date.now() - start,
      };

      if (!passed) {
        this._onViolation.fire(inv);
      }
    } catch (err) {
      inv.lastResult = {
        passed: false,
        violationCount: -1,
        violatingRows: [],
        checkedAt: Date.now(),
        durationMs: Date.now() - start,
      };
    }
  }

  private _persist(): void {
    this._state.update('invariants', this._invariants);
  }

  get invariants(): readonly IInvariant[] { return this._invariants; }
  get passingCount(): number { return this._invariants.filter(i => i.lastResult?.passed).length; }
  get totalEnabled(): number { return this._invariants.filter(i => i.enabled).length; }
}
```

### Invariant Templates

Pre-built generators that create SQL from user selections:

```typescript
class InvariantTemplates {
  constructor(private readonly _client: DriftApiClient) {}

  async getTemplatesForTable(table: string): Promise<IInvariantTemplate[]> {
    const meta = await this._client.schemaMetadata();
    const tableMeta = meta.tables.find(t => t.name === table);
    if (!tableMeta) return [];

    const fks = await this._client.tableFkMeta(table);
    const templates: IInvariantTemplate[] = [];

    // Unique columns
    for (const col of tableMeta.columns) {
      templates.push({
        name: `${table}.${col.name} is unique`,
        sql: `SELECT "${col.name}", COUNT(*) AS cnt FROM "${table}" GROUP BY "${col.name}" HAVING cnt > 1`,
        expectation: 'zero_rows',
        severity: 'warning',
      });
    }

    // Not-null columns
    for (const col of tableMeta.columns.filter(c => !c.pk)) {
      templates.push({
        name: `${table}.${col.name} is not null`,
        sql: `SELECT * FROM "${table}" WHERE "${col.name}" IS NULL`,
        expectation: 'zero_rows',
        severity: 'warning',
      });
    }

    // FK integrity
    for (const fk of fks) {
      templates.push({
        name: `${table}.${fk.from} → ${fk.table}.${fk.to} (no orphans)`,
        sql: `SELECT a.* FROM "${table}" a LEFT JOIN "${fk.table}" b ON a."${fk.from}" = b."${fk.to}" WHERE b."${fk.to}" IS NULL AND a."${fk.from}" IS NOT NULL`,
        expectation: 'zero_rows',
        severity: 'error',
      });
    }

    return templates;
  }
}
```

### Diagnostics Integration

Maps violations to VS Code diagnostics on Dart source files:

```typescript
class InvariantDiagnostics implements vscode.Disposable {
  private _collection: vscode.DiagnosticCollection;

  constructor(
    private readonly _manager: InvariantManager,
    private readonly _mapper: TableNameMapper,
  ) {
    this._collection = vscode.languages.createDiagnosticCollection('driftInvariants');

    _manager.onDidChange(() => this._updateDiagnostics());
  }

  private _updateDiagnostics(): void {
    this._collection.clear();

    for (const inv of this._manager.invariants) {
      if (!inv.lastResult || inv.lastResult.passed) continue;

      // Find the Dart file that defines this table
      const location = this._mapper.getLocation(inv.table);
      if (!location) continue;

      const diag = new vscode.Diagnostic(
        location.range,
        `Data invariant failed: ${inv.name} (${inv.lastResult.violationCount} violations)`,
        inv.severity === 'error'
          ? vscode.DiagnosticSeverity.Error
          : inv.severity === 'warning'
            ? vscode.DiagnosticSeverity.Warning
            : vscode.DiagnosticSeverity.Information,
      );
      diag.source = 'Saropa Drift Advisor';
      diag.code = inv.id;

      const existing = this._collection.get(location.uri) ?? [];
      this._collection.set(location.uri, [...existing, diag]);
    }
  }
}
```

### Status Bar

```typescript
const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 40);
statusItem.command = 'driftViewer.manageInvariants';

manager.onDidChange(() => {
  const passing = manager.passingCount;
  const total = manager.totalEnabled;
  if (total === 0) {
    statusItem.hide();
    return;
  }
  statusItem.text = passing === total
    ? `$(check) Invariants: ${passing}/${total}`
    : `$(warning) Invariants: ${passing}/${total}`;
  statusItem.backgroundColor = passing === total
    ? undefined
    : new vscode.ThemeColor('statusBarItem.warningBackground');
  statusItem.show();
});
```

## Server-Side Changes

None. Uses existing `POST /api/sql` and schema endpoints.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.manageInvariants",
        "title": "Saropa Drift Advisor: Manage Data Invariants",
        "icon": "$(shield)"
      },
      {
        "command": "driftViewer.addInvariant",
        "title": "Saropa Drift Advisor: Add Data Invariant"
      },
      {
        "command": "driftViewer.runAllInvariants",
        "title": "Saropa Drift Advisor: Run All Invariants"
      }
    ],
    "menus": {
      "view/item/context": [{
        "command": "driftViewer.addInvariant",
        "when": "viewItem == driftTable",
        "group": "6_invariant"
      }],
      "view/title": [{
        "command": "driftViewer.manageInvariants",
        "when": "view == driftViewer.databaseExplorer && driftViewer.serverConnected",
        "group": "navigation"
      }]
    },
    "configuration": {
      "properties": {
        "driftViewer.invariants.continuous": {
          "type": "boolean",
          "default": false,
          "description": "Re-evaluate invariants on every database change (performance impact)."
        },
        "driftViewer.invariants.defaultSeverity": {
          "type": "string",
          "enum": ["error", "warning", "info"],
          "default": "warning",
          "description": "Default severity for new invariant violations."
        }
      }
    }
  }
}
```

## Wiring in extension.ts

```typescript
const invariantManager = new InvariantManager(client, context.workspaceState);
const invariantDiagnostics = new InvariantDiagnostics(invariantManager, tableNameMapper);

context.subscriptions.push(
  invariantManager,
  invariantDiagnostics,

  vscode.commands.registerCommand('driftViewer.manageInvariants', () => {
    InvariantPanel.createOrShow(context.extensionUri, invariantManager, client);
  }),

  vscode.commands.registerCommand('driftViewer.addInvariant', async (item?: TableItem) => {
    const table = item?.tableMetadata.name ?? await pickTable(client);
    if (!table) return;

    const templates = new InvariantTemplates(client);
    const available = await templates.getTemplatesForTable(table);

    const picks = await vscode.window.showQuickPick([
      ...available.map(t => ({ label: t.name, detail: t.sql, template: t })),
      { label: 'Custom SQL…', detail: 'Write your own invariant query', template: null },
    ], { placeHolder: 'Select an invariant template' });

    if (!picks) return;

    if (picks.template) {
      invariantManager.add({ ...picks.template, table, enabled: true });
    } else {
      const sql = await vscode.window.showInputBox({
        prompt: 'SQL query (should return violating rows)',
        placeHolder: `SELECT * FROM "${table}" WHERE ...`,
      });
      if (!sql) return;
      const name = await vscode.window.showInputBox({ prompt: 'Rule name' });
      if (!name) return;
      invariantManager.add({
        name, table, sql,
        expectation: 'zero_rows',
        severity: 'warning',
        enabled: true,
      });
    }
  }),

  vscode.commands.registerCommand('driftViewer.runAllInvariants', () => {
    invariantManager.evaluateAll();
  })
);

// Continuous checking (if enabled)
const continuous = vscode.workspace.getConfiguration('driftViewer.invariants').get('continuous', false);
if (continuous) {
  watcher.onDidChange(() => invariantManager.evaluateAll());
}
```

## Testing

- `invariant-manager.test.ts`:
  - Add/remove/toggle rules
  - Evaluate rule with zero violations → pass
  - Evaluate rule with violations → fail + onViolation event
  - Concurrent evaluation guard (no double-evaluate)
  - Persistence round-trip via Memento
  - Disabled rules are skipped
  - SQL execution error → fail result with violationCount -1
- `invariant-templates.test.ts`:
  - Generates correct SQL for each template type
  - Handles tables with no FKs (no FK templates generated)
  - Handles tables with multiple FKs
- `invariant-diagnostics.test.ts`:
  - Creates diagnostics for failed rules with correct severity
  - Clears diagnostics when rules pass
  - Maps to correct Dart source file location
  - No diagnostics when no rules are defined

## Integration Points

### Shared Services Used

| Service | Usage |
|---------|-------|
| SchemaIntelligence | `getTable()`, `getForeignKeys()` for template generation |
| RelationshipEngine | FK integrity check templates use `walkDownstream()` |

### Consumes From

| Feature | Data/Action |
|---------|-------------|
| Schema Intelligence Cache (1.2) | Table/column metadata for rule templates |
| Schema Linter (7) | Schema issues can suggest related data invariants |
| Generation Watcher | Triggers invariant re-evaluation on DB change |

### Produces For

| Feature | Data/Action |
|---------|-------------|
| Health Score (30) | Invariant pass/fail ratio → "Data Quality" metric |
| Dashboard Builder (36) | "Invariant Status" widget |
| Pre-Launch Tasks (13) | Block launch if critical invariants fail |
| Data Editing (16) | Warning when editing rows that would violate invariants |
| Portable Report (25) | Include invariant status in exported report |

### Cross-Feature Actions

| From | Action | To |
|------|--------|-----|
| Invariant Violation | "View Violating Rows" | Table data viewer filtered to violations |
| Invariant Violation | "Fix in Editor" | Bulk Edit Grid with violating rows pre-selected |
| Invariant Violation | "Generate Fix SQL" | SQL to resolve violations |
| Health Score | "Fix Data Quality" | Invariant panel with failed invariants |
| Anomaly Detection | "Add as Invariant" | Create invariant from detected anomaly |

### Health Score Contribution

| Metric | Contribution |
|--------|--------------|
| Data Quality | `passingCount / totalEnabled` ratio |
| Action | "View Invariants" → opens Invariant Manager |
| Quick Fix | "Run All Invariants" to re-evaluate |

### Unified Timeline Events

| Event Type | Data |
|------------|------|
| `invariant-check` | `{ timestamp, passed, failed, violations[] }` |

### Actionable Health Score Integration

The Health Score "Data Quality" metric links directly to invariant actions:

```
Health Score Card: Data Quality — C (68%)
  │
  ├── "3 of 9 invariants failing"
  ├── [View Details] → Invariant Manager panel
  └── [Run Checks] → Re-evaluate all invariants
```

### Data Editing Guard

When editing data in Bulk Edit Grid (Feature 47), changes are validated against active invariants before commit:

```typescript
// Before committing bulk edits
const violations = await invariantManager.previewViolations(pendingChanges);
if (violations.length > 0) {
  // Show warning: "This change would violate 2 invariants"
}
```

---

## Known Limitations

- Continuous checking on every generation change can be expensive with many rules
- SQL validation is minimal — invalid SQL in custom rules will produce error results
- Diagnostics only appear if `TableNameMapper` can find the Dart source file for the table
- No support for cross-table invariants that span more than what a single SQL query can express
- Rule ordering is not configurable — all rules evaluate independently
- No "auto-fix" capability — violations are reported but not corrected
- Violation rows are capped at 20 — large violation sets show count but not all rows
- No export/import of rule sets — rules are stored in workspace state only
- No parameterized rules (e.g., "column > $threshold" where threshold is configurable)
