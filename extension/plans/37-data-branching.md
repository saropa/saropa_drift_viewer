# Feature 37: Git-style Data Branching

## What It Does

Create named "branches" of database state for safe experimentation. Capture the current state, mutate data freely, then diff against the original or other branches. "Merge" a branch by generating differential SQL. Like `git stash` + `git branch` for your database during debugging.

## User Experience

### 1. Create a Branch

Right-click the database root in tree view → "Create Data Branch" or command palette:

```
Enter branch name: experiment-1
✓ Branch "experiment-1" created from current state (8 tables, 52,389 rows)
```

### 2. Branch Manager Panel

Command palette → "Saropa Drift Advisor: Data Branches":

```
╔═══════════════════════════════════════════════════════════╗
║  DATA BRANCHES                         [+ New Branch]     ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  🔵 main (current live state)                            ║
║     8 tables, 52,389 rows                                ║
║                                                           ║
║  🟢 experiment-1                      Created 10:30      ║
║     Captured: 8 tables, 52,389 rows                      ║
║     [Diff vs Now] [Restore] [Merge to SQL] [Delete]     ║
║                                                           ║
║  🟢 before-migration                  Created 09:15      ║
║     Captured: 7 tables, 48,200 rows                      ║
║     [Diff vs Now] [Restore] [Merge to SQL] [Delete]     ║
║                                                           ║
║  🟢 production-snapshot               Created yesterday  ║
║     Captured: 8 tables, 120,450 rows                     ║
║     [Diff vs Now] [Diff vs experiment-1] [Delete]        ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
```

### 3. Diff Between Branches

Click "Diff vs Now" or "Diff vs [branch]":

```
╔═══════════════════════════════════════════════════════════╗
║  BRANCH DIFF: experiment-1 → current                     ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  ┌─ users ───────────────────────────────────────────┐   ║
║  │  +3 rows inserted                                  │   ║
║  │  ~1 row updated (id=42: name changed)             │   ║
║  │  -0 rows deleted                                   │   ║
║  │  [Show Details]                                    │   ║
║  └────────────────────────────────────────────────────┘   ║
║                                                           ║
║  ┌─ orders ──────────────────────────────────────────┐   ║
║  │  +2 rows inserted                                  │   ║
║  │  ~12 rows updated (status: pending → shipped)     │   ║
║  │  -0 rows deleted                                   │   ║
║  │  [Show Details]                                    │   ║
║  └────────────────────────────────────────────────────┘   ║
║                                                           ║
║  ┌─ products ────────────────────────────────────────┐   ║
║  │  +0 rows inserted                                  │   ║
║  │  ~0 rows updated                                   │   ║
║  │  -1 row deleted (id=7: "Widget Pro")              │   ║
║  │  [Show Details]                                    │   ║
║  └────────────────────────────────────────────────────┘   ║
║                                                           ║
║  [Generate Merge SQL]  [Generate Rollback SQL]           ║
╚═══════════════════════════════════════════════════════════╝
```

### 4. Restore a Branch

Click "Restore" → confirmation dialog:

```
⚠ This will overwrite the current database state with
  branch "experiment-1" (captured at 10:30).

  8 tables will be replaced. Current data will be lost.

  [Cancel]  [Create Backup Branch First]  [Restore Now]
```

"Create Backup Branch First" automatically creates a branch of the current state before restoring.

### 5. Merge to SQL

Click "Generate Merge SQL" → opens a `.sql` editor tab with the differential SQL to transform one branch's state into another:

```sql
-- Merge: experiment-1 → current
-- Applies changes made since branch "experiment-1" was created

-- users: 3 inserts, 1 update
INSERT INTO "users" ("id", "name", "email") VALUES (140, 'Eve Chen', 'eve@example.com');
INSERT INTO "users" ("id", "name", "email") VALUES (141, 'Frank Li', 'frank@example.com');
INSERT INTO "users" ("id", "name", "email") VALUES (142, 'Grace Kim', 'grace@example.com');
UPDATE "users" SET "name" = 'Alice Smith' WHERE "id" = 42;

-- orders: 2 inserts, 12 updates
...

-- products: 1 delete
DELETE FROM "products" WHERE "id" = 7;
```

## New Files

### Server-Side (Dart)

```
lib/src/server/
  branch_handler.dart          # Branch CRUD + restore endpoints
lib/src/
  branch_store.dart            # In-memory branch storage (snapshot data)
```

### Extension-Side (TypeScript)

```
extension/src/
  branching/
    branch-manager.ts          # CRUD operations, diff logic
    branch-panel.ts            # Webview panel for branch management
    branch-html.ts             # HTML template
    branch-diff.ts             # Diff between two branch states
    branch-merge-sql.ts        # Generate differential SQL between branches
    branch-types.ts            # Shared interfaces
extension/src/test/
  branch-diff.test.ts
  branch-merge-sql.test.ts
```

## Dependencies

- `api-client.ts` — `schemaMetadata()`, `sql()` for capturing state
- `snapshot/snapshot-store.ts` — reuses snapshot capture logic
- `data-management/dependency-sorter.ts` (from Feature 20a) — FK-safe table ordering for restore operations
- `data-management/data-reset.ts` (from Feature 20a) — clear tables in FK order before restoring branch state
- `data-management/dataset-types.ts` (from Feature 20a) — `IFkContext`, `IResetResult` shared interfaces
- Server: `writeQuery` callback for restore functionality (optional)

## Architecture

### Branch Definition

```typescript
interface IDataBranch {
  id: string;
  name: string;
  createdAt: string;
  description?: string;
  tables: IBranchTable[];
  metadata: {
    tableCount: number;
    totalRows: number;
  };
}

interface IBranchTable {
  name: string;
  columns: ColumnMetadata[];
  rows: Record<string, unknown>[];
  pkColumn: string;
}
```

### Branch Manager

```typescript
class BranchManager implements vscode.Disposable {
  private _branches: IDataBranch[] = [];

  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(
    private readonly _client: DriftApiClient,
    private readonly _state: vscode.Memento,
  ) {
    this._branches = _state.get<IDataBranch[]>('branches', []);
  }

  async createBranch(name: string): Promise<IDataBranch> {
    const meta = await this._client.schemaMetadata();
    const tables: IBranchTable[] = [];

    for (const table of meta.tables) {
      if (table.name.startsWith('sqlite_')) continue;

      const result = await this._client.sql(`SELECT * FROM "${table.name}"`);
      const pkCol = table.columns.find(c => c.pk)?.name ?? 'id';

      tables.push({
        name: table.name,
        columns: table.columns,
        rows: result.rows as Record<string, unknown>[],
        pkColumn: pkCol,
      });
    }

    const branch: IDataBranch = {
      id: crypto.randomUUID(),
      name,
      createdAt: new Date().toISOString(),
      tables,
      metadata: {
        tableCount: tables.length,
        totalRows: tables.reduce((s, t) => s + t.rows.length, 0),
      },
    };

    this._branches.push(branch);
    this._persist();
    this._onDidChange.fire();
    return branch;
  }

  deleteBranch(id: string): void {
    this._branches = this._branches.filter(b => b.id !== id);
    this._persist();
    this._onDidChange.fire();
  }

  getBranch(id: string): IDataBranch | undefined {
    return this._branches.find(b => b.id === id);
  }

  get branches(): readonly IDataBranch[] { return this._branches; }

  private _persist(): void {
    this._state.update('branches', this._branches);
  }
}
```

### Branch Diff

Compares a branch's captured state against the current live state or another branch:

```typescript
interface IBranchDiff {
  branchA: string;            // "experiment-1"
  branchB: string;            // "current" or another branch name
  tableDiffs: ITableDiff[];
  summary: {
    inserts: number;
    updates: number;
    deletes: number;
    tablesChanged: number;
  };
}

interface ITableDiff {
  table: string;
  inserts: Record<string, unknown>[];     // Rows in B not in A
  updates: IRowUpdate[];                   // Rows in both but different
  deletes: Record<string, unknown>[];     // Rows in A not in B
}

interface IRowUpdate {
  pk: unknown;
  changes: { column: string; oldValue: unknown; newValue: unknown }[];
}

class BranchDiff {
  async diffBranchVsCurrent(
    branch: IDataBranch,
    client: DriftApiClient,
  ): Promise<IBranchDiff> {
    const tableDiffs: ITableDiff[] = [];
    let inserts = 0, updates = 0, deletes = 0;

    for (const branchTable of branch.tables) {
      const currentResult = await client.sql(`SELECT * FROM "${branchTable.name}"`);
      const currentRows = currentResult.rows as Record<string, unknown>[];

      const diff = this._diffRows(
        branchTable.rows,
        currentRows,
        branchTable.pkColumn,
      );

      if (diff.inserts.length + diff.updates.length + diff.deletes.length > 0) {
        tableDiffs.push({ table: branchTable.name, ...diff });
        inserts += diff.inserts.length;
        updates += diff.updates.length;
        deletes += diff.deletes.length;
      }
    }

    return {
      branchA: branch.name,
      branchB: 'current',
      tableDiffs,
      summary: { inserts, updates, deletes, tablesChanged: tableDiffs.length },
    };
  }

  diffBranchVsBranch(branchA: IDataBranch, branchB: IDataBranch): IBranchDiff {
    // Same logic but comparing two branch snapshots
    const tableDiffs: ITableDiff[] = [];
    let inserts = 0, updates = 0, deletes = 0;

    for (const tableA of branchA.tables) {
      const tableB = branchB.tables.find(t => t.name === tableA.name);
      if (!tableB) {
        // Table exists in A but not B → all rows are "deleted" from B's perspective
        deletes += tableA.rows.length;
        tableDiffs.push({ table: tableA.name, inserts: [], updates: [], deletes: tableA.rows });
        continue;
      }

      const diff = this._diffRows(tableA.rows, tableB.rows, tableA.pkColumn);
      if (diff.inserts.length + diff.updates.length + diff.deletes.length > 0) {
        tableDiffs.push({ table: tableA.name, ...diff });
        inserts += diff.inserts.length;
        updates += diff.updates.length;
        deletes += diff.deletes.length;
      }
    }

    return {
      branchA: branchA.name,
      branchB: branchB.name,
      tableDiffs,
      summary: { inserts, updates, deletes, tablesChanged: tableDiffs.length },
    };
  }

  private _diffRows(
    rowsA: Record<string, unknown>[],
    rowsB: Record<string, unknown>[],
    pkCol: string,
  ): { inserts: Record<string, unknown>[]; updates: IRowUpdate[]; deletes: Record<string, unknown>[] } {
    const mapA = new Map(rowsA.map(r => [String(r[pkCol]), r]));
    const mapB = new Map(rowsB.map(r => [String(r[pkCol]), r]));

    const inserts = rowsB.filter(r => !mapA.has(String(r[pkCol])));
    const deletes = rowsA.filter(r => !mapB.has(String(r[pkCol])));
    const updates: IRowUpdate[] = [];

    for (const [pk, rowB] of mapB) {
      const rowA = mapA.get(pk);
      if (!rowA) continue;
      const changes: { column: string; oldValue: unknown; newValue: unknown }[] = [];
      for (const col of Object.keys(rowA)) {
        if (col === pkCol) continue;
        if (JSON.stringify(rowA[col]) !== JSON.stringify(rowB[col])) {
          changes.push({ column: col, oldValue: rowA[col], newValue: rowB[col] });
        }
      }
      if (changes.length > 0) updates.push({ pk: rowA[pkCol], changes });
    }

    return { inserts, updates, deletes };
  }
}
```

### Merge SQL Generator

Generates the SQL to transform branch A into branch B:

```typescript
class BranchMergeSql {
  generate(diff: IBranchDiff, direction: 'forward' | 'rollback'): string {
    const lines: string[] = [];
    const isForward = direction === 'forward';

    lines.push(`-- ${isForward ? 'Merge' : 'Rollback'}: ${diff.branchA} → ${diff.branchB}`);
    lines.push(`-- Generated: ${new Date().toISOString()}`);
    lines.push('');

    for (const td of diff.tableDiffs) {
      lines.push(`-- ${td.table}`);

      if (isForward) {
        // Forward: apply B's changes to A
        for (const row of td.inserts) {
          lines.push(this._insertSql(td.table, row));
        }
        for (const upd of td.updates) {
          lines.push(this._updateSql(td.table, upd));
        }
        for (const row of td.deletes) {
          const pk = Object.keys(row)[0]; // First column assumed PK
          lines.push(`DELETE FROM "${td.table}" WHERE "${pk}" = ${sqlLiteral(row[pk])};`);
        }
      } else {
        // Rollback: undo B's changes (reverse operations)
        for (const row of td.inserts) {
          const pk = Object.keys(row)[0];
          lines.push(`DELETE FROM "${td.table}" WHERE "${pk}" = ${sqlLiteral(row[pk])};`);
        }
        for (const upd of td.updates) {
          const setClauses = upd.changes.map(c => `"${c.column}" = ${sqlLiteral(c.oldValue)}`);
          lines.push(`UPDATE "${td.table}" SET ${setClauses.join(', ')} WHERE "${Object.keys(upd)[0]}" = ${sqlLiteral(upd.pk)};`);
        }
        for (const row of td.deletes) {
          lines.push(this._insertSql(td.table, row));
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private _insertSql(table: string, row: Record<string, unknown>): string {
    const cols = Object.keys(row);
    const vals = cols.map(c => sqlLiteral(row[c]));
    return `INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${vals.join(', ')});`;
  }

  private _updateSql(table: string, upd: IRowUpdate): string {
    const setClauses = upd.changes.map(c => `"${c.column}" = ${sqlLiteral(c.newValue)}`);
    return `UPDATE "${table}" SET ${setClauses.join(', ')} WHERE "id" = ${sqlLiteral(upd.pk)};`;
  }
}
```

### Restore (Server-Side)

Requires new server endpoints for full database restore:

```dart
class BranchHandler {
  final ServerContext _ctx;

  /// POST /api/branch/restore
  /// Body: { tables: [ { name, rows: [...] } ] }
  /// Drops and re-inserts all data for the specified tables.
  Future<void> handleRestore(HttpRequest request, HttpResponse response) async {
    if (_ctx.writeQuery == null) {
      response.statusCode = HttpStatus.notImplemented;
      response.write('{"error": "Write queries not enabled"}');
      await response.close();
      return;
    }

    final body = await ServerContext.parseJsonMap(request);
    final tables = body['tables'] as List<dynamic>;

    for (final tableData in tables) {
      final name = tableData['name'] as String;
      final rows = tableData['rows'] as List<dynamic>;

      // Delete all existing rows
      await _ctx.writeQuery!('DELETE FROM "$name"');

      // Insert branch rows
      for (final row in rows) {
        final map = row as Map<String, dynamic>;
        final cols = map.keys.toList();
        final vals = cols.map((c) => ServerContext.sqlLiteral(map[c])).join(', ');
        final colNames = cols.map((c) => '"$c"').join(', ');
        await _ctx.writeQuery!('INSERT INTO "$name" ($colNames) VALUES ($vals)');
      }
    }

    _ctx.setJsonHeaders(response);
    response.write('{"restored": true}');
    await response.close();
  }
}
```

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.createBranch",
        "title": "Saropa Drift Advisor: Create Data Branch",
        "icon": "$(git-branch)"
      },
      {
        "command": "driftViewer.openBranches",
        "title": "Saropa Drift Advisor: Data Branches",
        "icon": "$(git-branch)"
      },
      {
        "command": "driftViewer.diffBranch",
        "title": "Saropa Drift Advisor: Diff Branch vs Current"
      },
      {
        "command": "driftViewer.restoreBranch",
        "title": "Saropa Drift Advisor: Restore Branch"
      },
      {
        "command": "driftViewer.mergeBranchSql",
        "title": "Saropa Drift Advisor: Generate Merge SQL"
      },
      {
        "command": "driftViewer.deleteBranch",
        "title": "Saropa Drift Advisor: Delete Branch"
      }
    ],
    "menus": {
      "view/title": [{
        "command": "driftViewer.openBranches",
        "when": "view == driftViewer.databaseExplorer && driftViewer.serverConnected",
        "group": "navigation"
      }]
    },
    "configuration": {
      "properties": {
        "driftViewer.branching.maxBranches": {
          "type": "number",
          "default": 10,
          "description": "Maximum number of data branches to store."
        },
        "driftViewer.branching.maxRowsPerTable": {
          "type": "number",
          "default": 10000,
          "description": "Maximum rows per table to capture in a branch."
        }
      }
    }
  }
}
```

## Wiring in extension.ts

```typescript
const branchManager = new BranchManager(client, context.workspaceState);

context.subscriptions.push(
  branchManager,

  vscode.commands.registerCommand('driftViewer.createBranch', async () => {
    const name = await vscode.window.showInputBox({
      prompt: 'Branch name',
      placeHolder: 'e.g., before-migration, experiment-1',
      validateInput: v => v.trim() ? null : 'Name required',
    });
    if (!name) return;

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Creating branch "${name}"…` },
      async () => {
        const branch = await branchManager.createBranch(name.trim());
        vscode.window.showInformationMessage(
          `Branch "${branch.name}" created (${branch.metadata.tableCount} tables, ${branch.metadata.totalRows.toLocaleString()} rows)`
        );
      }
    );
  }),

  vscode.commands.registerCommand('driftViewer.openBranches', () => {
    BranchPanel.createOrShow(context.extensionUri, branchManager, client);
  }),

  vscode.commands.registerCommand('driftViewer.diffBranch', async (branchId?: string) => {
    const branch = branchId
      ? branchManager.getBranch(branchId)
      : await pickBranch(branchManager);
    if (!branch) return;

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Computing diff…' },
      async () => {
        const differ = new BranchDiff();
        const diff = await differ.diffBranchVsCurrent(branch, client);
        BranchPanel.showDiff(context.extensionUri, diff);
      }
    );
  }),

  vscode.commands.registerCommand('driftViewer.restoreBranch', async (branchId?: string) => {
    const branch = branchId
      ? branchManager.getBranch(branchId)
      : await pickBranch(branchManager);
    if (!branch) return;

    const choice = await vscode.window.showWarningMessage(
      `Restore branch "${branch.name}"? This will overwrite current data.`,
      'Create Backup First', 'Restore Now', 'Cancel'
    );

    if (choice === 'Cancel' || !choice) return;
    if (choice === 'Create Backup First') {
      await branchManager.createBranch(`backup-${new Date().toISOString().slice(11, 19)}`);
    }

    await client.branchRestore(branch.tables);
    vscode.window.showInformationMessage(`Branch "${branch.name}" restored.`);
  }),

  vscode.commands.registerCommand('driftViewer.mergeBranchSql', async (branchId?: string) => {
    const branch = branchId
      ? branchManager.getBranch(branchId)
      : await pickBranch(branchManager);
    if (!branch) return;

    const differ = new BranchDiff();
    const diff = await differ.diffBranchVsCurrent(branch, client);
    const merger = new BranchMergeSql();
    const sql = merger.generate(diff, 'forward');

    const doc = await vscode.workspace.openTextDocument({ content: sql, language: 'sql' });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
  }),

  vscode.commands.registerCommand('driftViewer.deleteBranch', async (branchId?: string) => {
    const branch = branchId
      ? branchManager.getBranch(branchId)
      : await pickBranch(branchManager);
    if (!branch) return;

    const confirm = await vscode.window.showWarningMessage(
      `Delete branch "${branch.name}"?`, 'Delete', 'Cancel'
    );
    if (confirm === 'Delete') branchManager.deleteBranch(branch.id);
  })
);
```

## Testing

- `branch-diff.test.ts`:
  - No changes → empty diff, all zeros
  - Inserts only → correct insert list
  - Deletes only → correct delete list
  - Updates only → correct column changes
  - Mixed → all types present
  - Cross-branch diff (A vs B) with tables only in one branch
  - PK-based matching works correctly
- `branch-merge-sql.test.ts`:
  - Forward merge generates INSERT for new rows
  - Forward merge generates UPDATE for changed rows
  - Forward merge generates DELETE for removed rows
  - Rollback reverses all operations
  - SQL escaping handles quotes and NULLs
  - Empty diff → only comments, no SQL statements
  - FK order: deletes child rows before parent rows

## Known Limitations

- Branch data is stored in workspace state — large branches (10k+ rows per table) may hit VS Code storage limits
- `maxRowsPerTable` cap means large tables are partially captured
- Restore requires `writeQuery` — read-only servers can only diff and generate SQL
- No atomic restore — if restore fails mid-table, database is in an inconsistent state
- Branch capture is a full snapshot (all rows) — no incremental branching
- No merge conflict resolution — merging two branches that both modified the same row produces last-write-wins
- Auto-increment values may conflict on restore (existing rows may have advanced the sequence)
- Schema changes between branch creation and restore will cause errors
- No branch protection (e.g., "don't delete main backup")
- Storage grows linearly with branch count × table size — no deduplication
