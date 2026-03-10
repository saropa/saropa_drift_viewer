# Feature 47: Bulk Edit Grid

## What It Does

A spreadsheet-like inline editor for table data. Click any cell to edit its value, add new rows, delete rows, and batch-commit all changes as a single transaction. Preview the generated SQL before executing. Undo/redo support within the editing session.

## User Experience

1. Right-click a table → "Edit Data" or command palette → "Drift Viewer: Edit Table Data"
2. Spreadsheet-style grid opens:

```
╔══════════════════════════════════════════════════════════════════╗
║  EDIT DATA — users (1,250 rows)                                 ║
║  Showing rows 1-50                    [+ Add Row] [Commit (3)]  ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  │   │ id   │ name          │ email              │ age │ active ║
║  ├───┼──────┼───────────────┼────────────────────┼─────┼────────║
║  │   │ 1    │ Alice Smith   │ alice@example.com  │ 32  │ 1      ║
║  │ ✎ │ 2    │ Bob Jones     │ bob@example.com    │ 28  │ 1      ║
║  │   │ 3    │ Carol Davis   │ carol@example.com  │ 45  │ 1      ║
║  │ ✎ │ 42   │ [Dave Wilson ]│ dave@example.com   │ 29  │ [0  ]  ║
║  │   │ ...  │               │                    │     │        ║
║  │ ✚ │ NEW  │ [           ] │ [                ] │ [ ] │ [ ]    ║
║  │ 🗑 │ 88   │ ~~Eve Park~~ │ ~~eve@example.com~~│ ~~51~~│ ~~1~~  ║
║  │   │      │               │                    │     │        ║
║                                                                  ║
║  ┌─ Pending Changes (3) ────────────────────────────────────┐  ║
║  │  ✎ UPDATE users SET name='Dave Wilson', active=0          │  ║
║  │     WHERE id=42                                           │  ║
║  │  ✚ INSERT INTO users (name, email, age, active)           │  ║
║  │     VALUES ('New User', 'new@test.com', 25, 1)           │  ║
║  │  🗑 DELETE FROM users WHERE id=88                         │  ║
║  │                                                           │  ║
║  │  [Undo Last] [Discard All] [Preview SQL] [Commit]        │  ║
║  └───────────────────────────────────────────────────────────┘  ║
╚══════════════════════════════════════════════════════════════════╝
```

3. Click a cell to edit its value inline
4. Tab between cells, Enter to confirm
5. Click "+ Add Row" to add a blank row at the bottom
6. Click the row gutter to select → Delete key to mark for deletion
7. "Preview SQL" shows the exact SQL that will execute
8. "Commit" sends all changes as a transaction

### Commit Confirmation

```
Commit 3 Changes?
──────────────────
  1 UPDATE, 1 INSERT, 1 DELETE

  [Preview SQL]  [Cancel]  [Commit]
```

## New Files

```
extension/src/
  bulk-edit/
    bulk-edit-panel.ts         # Webview panel lifecycle + message handling
    bulk-edit-html.ts          # HTML/CSS/JS with inline edit grid
    change-tracker.ts          # Tracks cell edits, inserts, deletes
    sql-generator.ts           # Generates SQL from tracked changes
    bulk-edit-types.ts         # Shared interfaces
extension/src/test/
  change-tracker.test.ts
  sql-generator.test.ts
```

## Dependencies

- `api-client.ts` — `schemaMetadata()`, `sql()`
- `data-management/dependency-sorter.ts` (from Feature 20a) — FK-ordered transaction execution for multi-table commits
- `data-management/dataset-types.ts` (from Feature 20a) — `IFkContext` shared interface for FK constraint validation
- Server: `writeQuery` callback required for executing changes

## Architecture

### Change Tracker

Tracks all pending changes in the editing session:

```typescript
type ChangeType = 'update' | 'insert' | 'delete';

interface ICellEdit {
  rowPk: unknown;
  column: string;
  oldValue: unknown;
  newValue: unknown;
}

interface IRowInsert {
  tempId: string;              // Temporary ID for the new row in the UI
  values: Record<string, unknown>;
}

interface IRowDelete {
  rowPk: unknown;
  originalValues: Record<string, unknown>;
}

interface IChangeSet {
  edits: ICellEdit[];
  inserts: IRowInsert[];
  deletes: IRowDelete[];
}

class ChangeTracker {
  private _edits = new Map<string, ICellEdit>();   // key: "pk:column"
  private _inserts: IRowInsert[] = [];
  private _deletes = new Map<unknown, IRowDelete>();
  private _history: IChangeAction[] = [];

  editCell(rowPk: unknown, column: string, oldValue: unknown, newValue: unknown): void {
    const key = `${rowPk}:${column}`;

    // If editing back to original value, remove the edit
    const existing = this._edits.get(key);
    if (existing && newValue === existing.oldValue) {
      this._edits.delete(key);
      this._history.push({ type: 'undo_edit', key });
      return;
    }

    const edit: ICellEdit = {
      rowPk,
      column,
      oldValue: existing?.oldValue ?? oldValue,
      newValue,
    };
    this._edits.set(key, edit);
    this._history.push({ type: 'edit', key, edit });
  }

  insertRow(values: Record<string, unknown>): string {
    const tempId = `new_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const insert: IRowInsert = { tempId, values };
    this._inserts.push(insert);
    this._history.push({ type: 'insert', tempId });
    return tempId;
  }

  deleteRow(rowPk: unknown, originalValues: Record<string, unknown>): void {
    // If deleting a newly inserted row, just remove the insert
    const insertIdx = this._inserts.findIndex(i => i.tempId === rowPk);
    if (insertIdx >= 0) {
      this._inserts.splice(insertIdx, 1);
      this._history.push({ type: 'undo_insert', tempId: String(rowPk) });
      return;
    }

    this._deletes.set(rowPk, { rowPk, originalValues });

    // Remove any edits for this row
    for (const [key, edit] of this._edits) {
      if (edit.rowPk === rowPk) this._edits.delete(key);
    }

    this._history.push({ type: 'delete', rowPk });
  }

  undo(): boolean {
    const last = this._history.pop();
    if (!last) return false;

    switch (last.type) {
      case 'edit':
        this._edits.delete(last.key!);
        break;
      case 'insert':
        this._inserts = this._inserts.filter(i => i.tempId !== last.tempId);
        break;
      case 'delete':
        this._deletes.delete(last.rowPk);
        break;
    }
    return true;
  }

  getChangeSet(): IChangeSet {
    return {
      edits: [...this._edits.values()],
      inserts: [...this._inserts],
      deletes: [...this._deletes.values()],
    };
  }

  get changeCount(): number {
    // Group edits by row to count unique rows modified
    const editedRows = new Set([...this._edits.values()].map(e => e.rowPk));
    return editedRows.size + this._inserts.length + this._deletes.size;
  }

  clear(): void {
    this._edits.clear();
    this._inserts = [];
    this._deletes.clear();
    this._history = [];
  }
}

interface IChangeAction {
  type: 'edit' | 'insert' | 'delete' | 'undo_edit' | 'undo_insert';
  key?: string;
  edit?: ICellEdit;
  tempId?: string;
  rowPk?: unknown;
}
```

### SQL Generator

```typescript
class BulkEditSqlGenerator {
  generate(
    table: string,
    pkColumn: string,
    changes: IChangeSet,
  ): string[] {
    const statements: string[] = [];

    // Deletes first (in case of FK constraints)
    for (const del of changes.deletes) {
      statements.push(
        `DELETE FROM "${table}" WHERE "${pkColumn}" = ${sqlLiteral(del.rowPk)};`
      );
    }

    // Updates
    const editsByRow = new Map<unknown, ICellEdit[]>();
    for (const edit of changes.edits) {
      const group = editsByRow.get(edit.rowPk) ?? [];
      group.push(edit);
      editsByRow.set(edit.rowPk, group);
    }

    for (const [rowPk, edits] of editsByRow) {
      const sets = edits
        .map(e => `"${e.column}" = ${sqlLiteral(e.newValue)}`)
        .join(', ');
      statements.push(
        `UPDATE "${table}" SET ${sets} WHERE "${pkColumn}" = ${sqlLiteral(rowPk)};`
      );
    }

    // Inserts last
    for (const insert of changes.inserts) {
      const cols = Object.keys(insert.values)
        .filter(k => insert.values[k] !== undefined);
      const vals = cols.map(c => sqlLiteral(insert.values[c]));
      statements.push(
        `INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${vals.join(', ')});`
      );
    }

    return statements;
  }

  /** Wrap all statements in a transaction. */
  toTransaction(statements: string[]): string {
    return ['BEGIN TRANSACTION;', ...statements, 'COMMIT;'].join('\n');
  }
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replace(/'/g, "''")}'`;
}
```

### Grid Keyboard Navigation (webview JS)

```typescript
function getGridJs(): string {
  return `
    let editingCell = null;

    document.addEventListener('keydown', (e) => {
      if (!editingCell) return;

      switch (e.key) {
        case 'Tab':
          e.preventDefault();
          commitEdit();
          moveToNextCell(e.shiftKey ? 'left' : 'right');
          break;
        case 'Enter':
          commitEdit();
          moveToNextCell('down');
          break;
        case 'Escape':
          cancelEdit();
          break;
        case 'Delete':
          if (!editingCell && selectedRow) {
            markRowForDeletion(selectedRow);
          }
          break;
        case 'z':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            vscode.postMessage({ command: 'undo' });
          }
          break;
      }
    });

    function startEdit(cell) {
      const input = document.createElement('input');
      input.value = cell.dataset.value ?? '';
      input.className = 'cell-editor';
      cell.textContent = '';
      cell.appendChild(input);
      input.focus();
      input.select();
      editingCell = { cell, input, original: cell.dataset.value };
    }

    function commitEdit() {
      if (!editingCell) return;
      const { cell, input, original } = editingCell;
      const newValue = input.value;
      cell.textContent = newValue;
      cell.dataset.value = newValue;

      if (newValue !== original) {
        cell.classList.add('modified');
        vscode.postMessage({
          command: 'cellEdited',
          rowPk: cell.dataset.rowPk,
          column: cell.dataset.column,
          oldValue: original,
          newValue: newValue,
        });
      }
      editingCell = null;
    }
  `;
}
```

### Webview Message Protocol

Webview → Extension:
```typescript
{ command: 'cellEdited', rowPk: unknown, column: string, oldValue: unknown, newValue: unknown }
{ command: 'addRow', values: Record<string, unknown> }
{ command: 'deleteRow', rowPk: unknown }
{ command: 'undo' }
{ command: 'discardAll' }
{ command: 'previewSql' }
{ command: 'commit' }
{ command: 'loadPage', offset: number, limit: number }
```

Extension → Webview:
```typescript
{ command: 'init', table: string, columns: ColumnMetadata[], rows: object[], totalRows: number, pkColumn: string }
{ command: 'pageLoaded', rows: object[], offset: number }
{ command: 'changeCount', count: number }
{ command: 'previewSql', sql: string }
{ command: 'committed', success: boolean, message: string }
{ command: 'undone', changeCount: number }
```

## Server-Side Changes

None directly, but requires the existing `sql()` endpoint to support write operations (INSERT, UPDATE, DELETE). The `writeQuery` callback must be available on the server.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.editTableData",
        "title": "Drift Viewer: Edit Table Data",
        "icon": "$(edit)"
      }
    ],
    "menus": {
      "view/item/context": [{
        "command": "driftViewer.editTableData",
        "when": "viewItem == driftTable && driftViewer.serverConnected",
        "group": "4_edit"
      }]
    }
  }
}
```

## Wiring in extension.ts

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.editTableData', async (item?: TableItem) => {
    const table = item?.tableMetadata.name ?? await pickTable(client);
    if (!table) return;

    const meta = await client.schemaMetadata();
    const tableMeta = meta.tables.find(t => t.name === table);
    if (!tableMeta) return;

    const pkCol = tableMeta.columns.find(c => c.pk)?.name;
    if (!pkCol) {
      vscode.window.showWarningMessage(
        `Table "${table}" has no primary key — editing requires a PK column.`
      );
      return;
    }

    BulkEditPanel.createOrShow(context.extensionUri, client, tableMeta, pkCol);
  })
);
```

## Testing

- `change-tracker.test.ts`:
  - Edit cell tracks old and new values
  - Edit back to original removes the edit
  - Insert row assigns temp ID
  - Delete row removes associated edits
  - Delete inserted row removes the insert
  - Undo reverses last action
  - Multiple undos in sequence
  - `changeCount` counts unique modified rows
  - `clear` resets all state
  - `getChangeSet` returns current state
- `sql-generator.test.ts`:
  - DELETE generates correct WHERE clause
  - UPDATE groups multiple column changes per row
  - INSERT includes all non-undefined values
  - SQL literal escaping: strings, numbers, NULL, booleans
  - Transaction wrapping adds BEGIN/COMMIT
  - Empty changeset → no statements
  - Order: DELETEs first, then UPDATEs, then INSERTs

## Known Limitations

- Requires a primary key column — tables without PK cannot be edited
- No support for BLOB columns — displayed as "[BLOB]" and not editable
- No type validation on input — entering "abc" in an INTEGER column will error at commit time
- No auto-increment for inserted rows — user must leave PK empty for auto-assignment
- No concurrent edit detection — if another process modifies the same row, changes overwrite
- Pagination loads 50 rows at a time — cannot edit rows outside the current page
- No multi-cell selection or paste from clipboard
- Undo is per-cell, not per-transaction
- No "save draft" — closing the panel discards uncommitted changes
- FK constraint violations detected only at commit time, not during editing
- No support for computed columns or triggers that modify values on insert
