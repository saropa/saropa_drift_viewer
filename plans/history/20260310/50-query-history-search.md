# Feature 50: Query History Search — DONE

## What It Does

Enhance the existing SQL Notebook query history with full-text search, filtering, and persistent cross-session access. Currently history is saved to globalState (max 50 entries) but there's no way to search or filter it. This feature adds a searchable history panel inside the SQL Notebook.

## User Experience

1. In the SQL Notebook, click the history icon (clock) in the toolbar
2. A history sidebar/section slides open with a search box and the full list
3. Type to filter — matches against SQL text, timestamps, error messages
4. Click any entry to load it into the active editor tab
5. Right-click → "Copy SQL", "Delete from History", "Run Again"

```
╔══════════════════════════════════════════════════════════════╗
║  SQL NOTEBOOK                                                ║
╠══════════════════════════════════════════════════════════════╣
║  [Tab 1] [Tab 2] [+]                    📋 ⏱ [History ▼]   ║
║                                                              ║
║  ┌─ HISTORY ──────────────────────────┐  ┌─ EDITOR ───────┐ ║
║  │ Search: [users              ] 🔍   │  │ SELECT *       │ ║
║  │                                    │  │ FROM users     │ ║
║  │ 3 of 47 entries                    │  │ WHERE active=1 │ ║
║  │                                    │  │                │ ║
║  │ ⏱ 10:42 — 12 rows, 3ms           │  │ [▶ Run]        │ ║
║  │ SELECT * FROM users WHERE ac...    │  └────────────────┘ ║
║  │                                    │                      ║
║  │ ⏱ 10:38 — 1,204 rows, 15ms       │  ┌─ RESULTS ──────┐ ║
║  │ SELECT * FROM users                │  │ id │ email     │ ║
║  │                                    │  │  1 │ alice@... │ ║
║  │ ❌ 09:55 — error                   │  │  2 │ bob@...   │ ║
║  │ SELECT * FROM user WHERE ...       │  │ ...            │ ║
║  └────────────────────────────────────┘  └────────────────┘ ║
╚══════════════════════════════════════════════════════════════╝
```

## New Files

```
extension/src/sql-notebook/
  query-history-store.ts      # Search, filter, CRUD operations on history
extension/src/test/
  query-history-store.test.ts
```

## Modified Files

```
extension/src/sql-notebook/sql-notebook-panel.ts   # Add history sidebar messages
extension/src/sql-notebook/sql-notebook-html.ts    # History sidebar HTML/CSS/JS
```

## Dependencies

- `vscode.Memento` (globalState) — existing `driftViewer.sqlNotebookHistory` key
- `IQueryHistoryEntry` — existing interface

## Architecture

### Query History Store

Wraps the existing globalState persistence with search and management:

```typescript
interface IQueryHistoryEntry {
  sql: string;
  timestamp: number;
  rowCount: number;
  durationMs: number;
  error?: string;
}

class QueryHistoryStore {
  private static readonly _KEY = 'driftViewer.sqlNotebookHistory';
  private static readonly _MAX = 200;  // Increase from 50

  constructor(private readonly _state: vscode.Memento) {}

  getAll(): IQueryHistoryEntry[] {
    return this._state.get<IQueryHistoryEntry[]>(QueryHistoryStore._KEY, []);
  }

  search(query: string): IQueryHistoryEntry[] {
    const lower = query.toLowerCase();
    return this.getAll().filter(e =>
      e.sql.toLowerCase().includes(lower) ||
      (e.error?.toLowerCase().includes(lower) ?? false)
    );
  }

  async delete(timestamp: number): Promise<void> {
    const entries = this.getAll().filter(e => e.timestamp !== timestamp);
    await this._state.update(QueryHistoryStore._KEY, entries);
  }

  async clear(): Promise<void> {
    await this._state.update(QueryHistoryStore._KEY, []);
  }

  async add(entry: IQueryHistoryEntry): Promise<void> {
    const entries = [entry, ...this.getAll()].slice(0, QueryHistoryStore._MAX);
    await this._state.update(QueryHistoryStore._KEY, entries);
  }
}
```

### Webview Message Protocol

Webview → Extension (new messages):
```typescript
{ command: 'searchHistory', query: string }
{ command: 'deleteHistoryEntry', timestamp: number }
{ command: 'clearHistory' }
{ command: 'loadHistoryEntry', timestamp: number }
```

Extension → Webview (new messages):
```typescript
{ command: 'historyResults', entries: IQueryHistoryEntry[], query: string }
```

### HTML Changes

The history sidebar is a `<div>` that toggles visibility. Search input uses `input` event with 200ms debounce. Entries render as clickable cards showing:
- Truncated SQL (first 80 chars)
- Timestamp (relative: "2 min ago", "yesterday")
- Row count and duration, or error indicator
- Right-click context menu for Copy/Delete

## Server-Side Changes

None. History is entirely extension-side.

## package.json Contributions

No new commands — history toggle is internal to the SQL Notebook webview.

Increase max history in configuration:

```jsonc
{
  "contributes": {
    "configuration": {
      "properties": {
        "driftViewer.sqlNotebook.maxHistory": {
          "type": "number",
          "default": 200,
          "minimum": 10,
          "maximum": 1000,
          "description": "Maximum number of SQL queries to keep in history."
        }
      }
    }
  }
}
```

## Testing

- `query-history-store.test.ts`:
  - `search()` filters by SQL text (case-insensitive)
  - `search()` matches error messages
  - Empty search returns all entries
  - `delete()` removes entry by timestamp
  - `clear()` removes all entries
  - `add()` prepends entry and trims to max
  - Duplicate timestamps handled correctly
  - History persists across store re-creation

## Known Limitations

- Search is substring match only — no SQL-aware parsing or regex
- globalState has no hard size limit but very large histories (1000+ entries with long SQL) may slow persistence
- No export/import of history
- Deduplication is not automatic — running the same query twice creates two entries
