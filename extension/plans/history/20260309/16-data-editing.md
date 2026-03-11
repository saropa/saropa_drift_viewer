# Feature 16: Data Editing with Review Workflow

## What It Does

Click cells in the webview data grid to edit values. Changes accumulate in a "Pending Changes" sidebar (like staged git changes). Review all edits, then "Generate SQL" opens a `.sql` editor tab with the UPDATE/INSERT/DELETE statements. Full undo/redo.

## User Experience

### 1. Edit in Grid
In the Saropa Drift Advisor webview panel, cells become editable:
- Click a cell → inline editor appears
- Type new value → cell turns yellow (pending)
- Right-click row → "Delete Row" (row turns red, strikethrough)
- "Add Row" button at bottom → empty row appears (green)

### 2. Pending Changes Sidebar
A tree view shows accumulated changes:
```
PENDING CHANGES (5)
─────────────────────────
▼ users (3 changes)
    UPDATE id=42: name "Alice" → "Alice Smith"
    UPDATE id=42: email "old@x.com" → "new@x.com"
    DELETE id=99

▼ posts (2 changes)
    INSERT (title="New Post", author_id=42)
    UPDATE id=7: published false → true

  [Generate SQL]  [Discard All]
```

### 3. Generate SQL
Click "Generate SQL" → opens a new `.sql` editor tab:
```sql
-- Saropa Drift Advisor: Generated SQL (5 changes)
-- Review carefully before executing!

-- users: 3 changes
UPDATE "users" SET "name" = 'Alice Smith' WHERE "id" = 42;
UPDATE "users" SET "email" = 'new@x.com' WHERE "id" = 42;
DELETE FROM "users" WHERE "id" = 99;

-- posts: 2 changes
INSERT INTO "posts" ("title", "author_id") VALUES ('New Post', 42);
UPDATE "posts" SET "published" = 1 WHERE "id" = 7;
```

The user reviews, edits if needed, then can copy-paste into their migration or debug tool.

## New Files

```
extension/src/
  editing/
    change-tracker.ts             # Tracks pending cell/row changes
    sql-generator.ts              # Generates SQL from pending changes
    pending-changes-provider.ts   # TreeDataProvider for sidebar
    editing-bridge.ts             # Message bridge between webview and change tracker
extension/src/test/
  change-tracker.test.ts
  sql-generator.test.ts
  pending-changes-provider.test.ts
```

## Dependencies

- `api-client.ts` (Feature 1) — fetch current row data, schema metadata
- `panel.ts` (existing) — extend the webview to support cell editing

## How It Works

### Change Tracker

```typescript
interface CellChange {
  id: string;           // unique change ID
  table: string;
  pkColumn: string;
  pkValue: unknown;
  column: string;
  oldValue: unknown;
  newValue: unknown;
  timestamp: number;
}

interface RowInsert {
  id: string;
  table: string;
  values: Record<string, unknown>;
  timestamp: number;
}

interface RowDelete {
  id: string;
  table: string;
  pkColumn: string;
  pkValue: unknown;
  timestamp: number;
}

type PendingChange = CellChange | RowInsert | RowDelete;

class ChangeTracker implements vscode.Disposable {
  private _changes: PendingChange[] = [];
  private _undoStack: PendingChange[][] = [];  // snapshots for undo
  private _redoStack: PendingChange[][] = [];

  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  addCellChange(change: Omit<CellChange, 'id' | 'timestamp'>): void {
    this._saveUndoState();
    // Merge with existing change for same cell (avoid duplicate updates)
    const existing = this._changes.find(
      c => c.type === 'cell' && c.table === change.table &&
           c.pkValue === change.pkValue && c.column === change.column
    );
    if (existing) {
      (existing as CellChange).newValue = change.newValue;
    } else {
      this._changes.push({
        ...change,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
      });
    }
    this._onDidChange.fire();
  }

  addRowInsert(table: string, values: Record<string, unknown>): void { ... }
  addRowDelete(table: string, pkColumn: string, pkValue: unknown): void { ... }

  undo(): void {
    if (this._undoStack.length === 0) return;
    this._redoStack.push([...this._changes]);
    this._changes = this._undoStack.pop()!;
    this._onDidChange.fire();
  }

  redo(): void {
    if (this._redoStack.length === 0) return;
    this._undoStack.push([...this._changes]);
    this._changes = this._redoStack.pop()!;
    this._onDidChange.fire();
  }

  discardAll(): void {
    this._saveUndoState();
    this._changes = [];
    this._onDidChange.fire();
  }

  get changes(): readonly PendingChange[] { return this._changes; }
  get changeCount(): number { return this._changes.length; }
}
```

### SQL Generator

```typescript
class SqlGenerator {
  generate(changes: PendingChange[]): string {
    const lines: string[] = [
      `-- Saropa Drift Advisor: Generated SQL (${changes.length} changes)`,
      '-- Review carefully before executing!',
      '',
    ];

    // Group by table
    const byTable = groupBy(changes, c => c.table);

    for (const [table, tableChanges] of byTable) {
      lines.push(`-- ${table}: ${tableChanges.length} change(s)`);

      for (const change of tableChanges) {
        if (isCellChange(change)) {
          lines.push(
            `UPDATE "${table}" SET "${change.column}" = ${sqlLiteral(change.newValue)} ` +
            `WHERE "${change.pkColumn}" = ${sqlLiteral(change.pkValue)};`
          );
        } else if (isRowInsert(change)) {
          const cols = Object.keys(change.values);
          const vals = cols.map(c => sqlLiteral(change.values[c]));
          lines.push(
            `INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) ` +
            `VALUES (${vals.join(', ')});`
          );
        } else if (isRowDelete(change)) {
          lines.push(
            `DELETE FROM "${table}" WHERE "${change.pkColumn}" = ${sqlLiteral(change.pkValue)};`
          );
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  // Escape single quotes
  return `'${String(value).replace(/'/g, "''")}'`;
}
```

### Webview Editing Bridge

The existing `DriftViewerPanel` webview needs to be enhanced to support cell editing. The bridge handles messages:

**Webview -> Extension:**
```typescript
{ command: 'cellEdit', table: string, pkColumn: string, pkValue: any, column: string, oldValue: any, newValue: any }
{ command: 'rowDelete', table: string, pkColumn: string, pkValue: any }
{ command: 'rowInsert', table: string, values: Record<string, any> }
{ command: 'undo' }
{ command: 'redo' }
{ command: 'generateSql' }
{ command: 'discardAll' }
```

**Extension -> Webview:**
```typescript
{ command: 'pendingChanges', changes: PendingChange[] }  // sync state back to webview for highlighting
{ command: 'editingEnabled', enabled: boolean }
```

### Pending Changes Tree View

```typescript
class PendingChangesProvider implements vscode.TreeDataProvider<PendingChangeItem> {
  // Shows changes grouped by table
  // Each change item has:
  //   - Label: "UPDATE id=42: name" or "DELETE id=99" or "INSERT (new row)"
  //   - Description: old → new value
  //   - Icon: pencil (edit), trash (delete), plus (insert)
  //   - Context menu: "Remove Change", "View Details"
}
```

### Generate SQL Command

```typescript
vscode.commands.registerCommand('driftViewer.generateSql', async () => {
  const sql = sqlGenerator.generate(changeTracker.changes);

  // Open as virtual document with SQL language
  const doc = await vscode.workspace.openTextDocument({
    content: sql,
    language: 'sql',
  });
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
});
```

### Webview Grid Modifications

The existing HTML served by the Dart server needs to support editing. Two approaches:

**Option A: Modify the server's HTML** (in `html_content.dart`)
- Add `contenteditable` attribute to table cells
- Add JS event listeners for cell blur/change
- Add row insert/delete UI buttons

**Option B: Overlay editing in the extension's webview**
- After fetching the server HTML, inject additional JS that adds editing capabilities
- The injected JS intercepts cell clicks, creates input elements, and sends `postMessage` to the extension

Recommended: **Option B** — keeps the Dart server read-only and editing is an extension-only feature. The server doesn't need to know about edits.

## package.json Contributions

```jsonc
{
  "contributes": {
    "views": {
      "driftViewer": [{
        "id": "driftViewer.pendingChanges",
        "name": "Pending Changes",
        "when": "driftViewer.hasEdits"
      }]
    },
    "commands": [
      { "command": "driftViewer.generateSql", "title": "Saropa Drift Advisor: Generate SQL from Edits", "icon": "$(file-code)" },
      { "command": "driftViewer.discardAllEdits", "title": "Saropa Drift Advisor: Discard All Edits", "icon": "$(trash)" },
      { "command": "driftViewer.undoEdit", "title": "Saropa Drift Advisor: Undo Edit" },
      { "command": "driftViewer.redoEdit", "title": "Saropa Drift Advisor: Redo Edit" },
      { "command": "driftViewer.toggleEditing", "title": "Saropa Drift Advisor: Toggle Editing Mode" }
    ],
    "keybindings": [
      { "command": "driftViewer.undoEdit", "key": "ctrl+z", "when": "driftViewer.editingActive" },
      { "command": "driftViewer.redoEdit", "key": "ctrl+shift+z", "when": "driftViewer.editingActive" }
    ],
    "menus": {
      "view/title": [
        {
          "command": "driftViewer.generateSql",
          "when": "view == driftViewer.pendingChanges",
          "group": "navigation"
        },
        {
          "command": "driftViewer.discardAllEdits",
          "when": "view == driftViewer.pendingChanges",
          "group": "navigation"
        }
      ]
    }
  }
}
```

## Wiring in extension.ts

```typescript
const changeTracker = new ChangeTracker();
const sqlGenerator = new SqlGenerator();
const pendingProvider = new PendingChangesProvider(changeTracker);

context.subscriptions.push(
  vscode.window.createTreeView('driftViewer.pendingChanges', {
    treeDataProvider: pendingProvider,
  })
);

// Update context key for when clause
changeTracker.onDidChange(() => {
  vscode.commands.executeCommand(
    'setContext', 'driftViewer.hasEdits', changeTracker.changeCount > 0
  );
  pendingProvider.refresh();
});

// Commands
context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.generateSql', () => {
    const sql = sqlGenerator.generate([...changeTracker.changes]);
    vscode.workspace.openTextDocument({ content: sql, language: 'sql' })
      .then(doc => vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside));
  }),
  vscode.commands.registerCommand('driftViewer.discardAllEdits', () => {
    changeTracker.discardAll();
  }),
  vscode.commands.registerCommand('driftViewer.undoEdit', () => changeTracker.undo()),
  vscode.commands.registerCommand('driftViewer.redoEdit', () => changeTracker.redo()),
);
```

## Safety Model

This feature is deliberately **non-destructive**:
- Edits are **never** sent directly to the database
- The server API is read-only by default (`writeQuery` is optional and disabled in most setups)
- Changes only exist as pending state in the extension
- "Generate SQL" produces a text file the user must manually review and execute
- This is a **review workflow**, not direct data manipulation

If the server has `writeQuery` enabled, a future enhancement could add an "Execute SQL" button, but the default is review-only.

## Testing

- `change-tracker.test.ts`: test add/remove/merge changes, undo/redo, discard all
- `sql-generator.test.ts`: test SQL output for UPDATE, INSERT, DELETE, NULL values, string escaping, grouped by table
- `pending-changes-provider.test.ts`: test tree structure, grouping, labels

## Known Limitations

- Primary key detection is heuristic (first column or columns named `id`/`_id`)
- Editing requires the webview panel to be open — changes can't be made from the tree view alone
- Undo/redo is per-session only — lost on extension reload
- Generated SQL uses simple WHERE by PK — doesn't handle composite PKs well
- No validation of edited values against column types (user is responsible for correct SQL)
- Cell editing JS is injected into the server's HTML — may break if the server's HTML structure changes
- No batch operations (e.g., "set all NULL emails to empty string")
