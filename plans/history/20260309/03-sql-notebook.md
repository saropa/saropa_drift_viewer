# Feature 3: SQL Query Notebook

## What It Does

An interactive SQL editor panel inside VS Code — schema-aware autocomplete, sortable result tables, EXPLAIN visualization, query history, charts, and multi-tab support. Like a mini DataGrip built into your editor.

## User Experience

1. Command palette: "Saropa Drift Advisor: Open SQL Notebook"
2. A webview panel opens with:
   - SQL text area with schema-aware autocomplete (table/column names)
   - Ctrl+Enter to execute
   - Results rendered as a sortable, filterable HTML table
   - "Explain" button shows query plan with color-coded scan types
   - "Chart" button visualizes numeric results (bar/pie/line)
   - "Copy JSON" / "Copy CSV" buttons
   - Tab bar for multiple concurrent queries
   - Query history sidebar (persisted across sessions)

## New Files

```
extension/src/
  sql-notebook/
    sql-notebook-panel.ts     # WebviewPanel managing the notebook UI
    sql-notebook-html.ts      # HTML/CSS/JS template for the webview
extension/src/test/
  sql-notebook-panel.test.ts
```

## Dependencies

Requires `api-client.ts` from Feature 1.

## API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `GET /api/schema/metadata` | Table/column names for autocomplete |
| `POST /api/sql` | Execute queries |
| `POST /api/sql/explain` | Get query plan |

## Architecture

**Webview-based** (not Monaco editor). Monaco adds significant bundle size and complexity. Instead, use a `<textarea>` with a custom autocomplete dropdown — simpler, lighter, and sufficient for SQL editing.

### Message Protocol (extension <-> webview)

**Webview -> Extension:**
```typescript
{ command: 'execute', sql: string, tabId: string }
{ command: 'explain', sql: string, tabId: string }
{ command: 'getSchema' }
{ command: 'copyToClipboard', text: string }
{ command: 'saveHistory', history: QueryHistoryEntry[] }
{ command: 'loadHistory' }
```

**Extension -> Webview:**
```typescript
{ command: 'queryResult', tabId: string, rows: object[], elapsed: number }
{ command: 'queryError', tabId: string, error: string }
{ command: 'explainResult', tabId: string, rows: object[], sql: string }
{ command: 'schema', tables: TableMetadata[] }
{ command: 'history', entries: QueryHistoryEntry[] }
```

### Autocomplete

The webview JS listens for input events on the textarea. When the user types:
- After `FROM ` or `JOIN `: suggest table names
- After `tablename.` or `SELECT `: suggest column names
- After `WHERE ` or `AND `: suggest `columnName =`, `columnName LIKE`, etc.

Schema data is fetched once on panel open via `getSchema` message and cached in the webview.

### Result Table

HTML `<table>` with:
- Sortable columns (click header to toggle asc/desc)
- Client-side text filter input
- Truncation of long values with "..." and tooltip
- Row count displayed: "42 rows (15ms)"

### Explain Visualization

The EXPLAIN QUERY PLAN results are rendered as a tree:
- **Red background**: `SCAN TABLE` (full table scan — bad)
- **Green background**: `SEARCH TABLE ... USING INDEX` (index lookup — good)
- **Yellow background**: `USING TEMPORARY B-TREE` (temp sort — okay)

### Query History

```typescript
interface QueryHistoryEntry {
  sql: string;
  timestamp: number;     // Date.now()
  rowCount: number;
  durationMs: number;
  error?: string;
}
```

Persisted via `context.globalState` (survives across sessions). The extension handles save/load; the webview renders a collapsible sidebar list. Click an entry to re-populate the SQL editor.

### Multi-Tab

The webview maintains an array of tab objects:
```typescript
interface QueryTab {
  id: string;
  title: string;      // "Query 1", "Query 2", etc.
  sql: string;
  results?: object[];
  error?: string;
}
```

Tabs are purely client-side (webview state). `retainContextWhenHidden: true` preserves them when the panel is not visible.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [{
      "command": "driftViewer.openSqlNotebook",
      "title": "Saropa Drift Advisor: Open SQL Notebook",
      "icon": "$(terminal)"
    }],
    "keybindings": [{
      "command": "driftViewer.openSqlNotebook",
      "key": "ctrl+shift+q",
      "mac": "cmd+shift+q"
    }]
  }
}
```

## Wiring in extension.ts

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.openSqlNotebook', () => {
    SqlNotebookPanel.createOrShow(context, client);
  })
);
```

The panel singleton handles all message passing internally.

## Copy Support

```typescript
// Extension side, on 'copyToClipboard' message:
case 'copyToClipboard':
  await vscode.env.clipboard.writeText(msg.text);
  vscode.window.showInformationMessage('Copied to clipboard');
  break;
```

CSV conversion happens in the webview JS (avoids round-trip for simple transforms).

## Testing

- Test panel creation and singleton behavior
- Test message handling (mock webview `postMessage`)
- Test query history persistence (mock `globalState`)
- HTML/JS template: manual testing in extension dev host

## Known Limitations

- No syntax highlighting in textarea (would need Monaco or CodeMirror for that)
- Autocomplete is basic keyword-level, not full SQL parser
- Charts are inline SVG (same approach as the web UI), not interactive D3/Chart.js
- Query results limited by server's response size (no client-side streaming)
