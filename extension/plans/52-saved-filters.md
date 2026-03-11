# Feature 52: Saved Filters

## What It Does

Save named filter/sort/column-visibility configurations per table and switch between them instantly. Instead of re-typing WHERE clauses every session, save them as named views like "Active Users", "Recent Orders", or "Failed Payments".

## User Experience

1. In the table data view, configure filters (WHERE clause), sort order, visible columns
2. Click "Save Filter" → enter a name → saved to workspace state
3. A dropdown in the table header shows saved filters for the current table
4. Select a filter → view updates immediately
5. Right-click a saved filter → Rename, Update, Delete

```
╔══════════════════════════════════════════════════════════════╗
║  TABLE: orders                                               ║
║  Filter: [Recent Failed ▼]  [Save] [Clear]                  ║
║  ┌──────────────────────┐                                    ║
║  │ ● Recent Failed      │  WHERE: status = 'failed'         ║
║  │   All Rows           │    AND created_at > '2026-03-01'  ║
║  │   High Value         │  Sort: created_at DESC             ║
║  │   Pending Review     │  Show: id, user_id, total, status ║
║  └──────────────────────┘                                    ║
╠══════════════════════════════════════════════════════════════╣
║  id  │ user_id │ total  │ status │                           ║
║  ─── │──────── │─────── │─────── │                           ║
║  193 │ 42      │ 250.00 │ failed │                           ║
║  187 │ 17      │ 89.50  │ failed │                           ║
╚══════════════════════════════════════════════════════════════╝
```

## New Files

```
extension/src/filters/
  filter-store.ts        # CRUD + persistence for saved filters
  filter-types.ts        # Interfaces
extension/src/test/
  filter-store.test.ts
```

## Modified Files

```
extension/src/panel.ts                  # Inject filter bridge + dropdown UI
extension/src/sql-notebook/sql-notebook-panel.ts  # Optional: load filter as SQL
```

## Dependencies

- `vscode.Memento` (workspace state) — for persistence
- `api-client.ts` — `sql()` for executing filtered queries

## Architecture

### Filter Types

```typescript
interface ISavedFilter {
  id: string;           // crypto.randomUUID()
  name: string;
  table: string;
  where?: string;       // SQL WHERE clause (without WHERE keyword)
  orderBy?: string;     // e.g. "created_at DESC"
  columns?: string[];   // Visible columns (undefined = all)
  createdAt: number;
  updatedAt: number;
}
```

### Filter Store

```typescript
const FILTER_KEY = 'driftViewer.savedFilters';

class FilterStore {
  private readonly _onDidChange = new vscode.EventEmitter<string>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly _state: vscode.Memento) {}

  getForTable(table: string): ISavedFilter[] {
    return this._getAll().filter(f => f.table === table);
  }

  async save(filter: ISavedFilter): Promise<void> {
    const all = this._getAll();
    const idx = all.findIndex(f => f.id === filter.id);
    if (idx >= 0) {
      all[idx] = { ...filter, updatedAt: Date.now() };
    } else {
      all.push(filter);
    }
    await this._state.update(FILTER_KEY, all);
    this._onDidChange.fire(filter.table);
  }

  async delete(id: string): Promise<void> {
    const all = this._getAll();
    const filter = all.find(f => f.id === id);
    const updated = all.filter(f => f.id !== id);
    await this._state.update(FILTER_KEY, updated);
    if (filter) this._onDidChange.fire(filter.table);
  }

  private _getAll(): ISavedFilter[] {
    return this._state.get<ISavedFilter[]>(FILTER_KEY, []);
  }
}
```

### Query Building

The filter is applied by constructing a SQL query:

```typescript
function buildFilteredQuery(table: string, filter: ISavedFilter): string {
  const cols = filter.columns?.map(c => `"${c}"`).join(', ') ?? '*';
  let sql = `SELECT ${cols} FROM "${table}"`;
  if (filter.where) sql += ` WHERE ${filter.where}`;
  if (filter.orderBy) sql += ` ORDER BY ${filter.orderBy}`;
  return sql;
}
```

### Webview Message Protocol

Webview → Extension:
```typescript
{ command: 'getFilters', table: string }
{ command: 'saveFilter', filter: ISavedFilter }
{ command: 'applyFilter', filterId: string }
{ command: 'deleteFilter', filterId: string }
{ command: 'clearFilter' }
```

Extension → Webview:
```typescript
{ command: 'filters', table: string, filters: ISavedFilter[] }
{ command: 'filterApplied', filter: ISavedFilter, rows: unknown[], columns: string[] }
{ command: 'filterCleared' }
```

## Server-Side Changes

None. Filters are built as SQL and executed via existing `sql()` endpoint.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.saveFilter",
        "title": "Saropa Drift Advisor: Save Current Filter"
      }
    ]
  }
}
```

## Testing

- `filter-store.test.ts`:
  - Save filter → retrievable by table name
  - Update existing filter → `updatedAt` changes, data updates
  - Delete filter → no longer returned
  - `getForTable` returns only filters for that table
  - Multiple filters per table sorted by creation order
  - `onDidChange` fires with correct table name
  - Empty `where` and `orderBy` are optional (omit from query)
  - Column list of `undefined` means SELECT *
  - Filter ID is unique across all tables
  - Filter with SQL injection in WHERE is passed through (server validates)

## Known Limitations

- No validation of WHERE clause syntax — invalid SQL will produce an error at query time
- Column visibility requires knowing column names upfront (from schema metadata)
- Filters are workspace-scoped — not shared across machines
- No import/export of filter sets
- WHERE clause is raw SQL — no visual filter builder (that's Feature 21)
- Maximum filter storage is bounded only by Memento limits (~10MB for workspace state)
