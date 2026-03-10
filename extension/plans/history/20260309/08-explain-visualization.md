# Feature 8: Query Explain Plan Visualization

## What It Does

Right-click any SQL string in Dart code or the SQL notebook → "Explain Query Plan" → opens an interactive tree diagram showing how SQLite will execute the query. Nodes are color-coded by performance impact. One-click to copy suggested index DDL.

## User Experience

1. Select a SQL string in a Dart file (e.g., `'SELECT * FROM users WHERE email = ?'`)
2. Right-click → "Drift Viewer: Explain Query Plan"
3. A panel opens with a tree visualization:

```
QUERY PLAN
├─ SEARCH TABLE users USING INDEX idx_users_email (email=?)  [GREEN]
│  └─ estimated rows: 1
└─ SCAN TABLE posts                                           [RED]
   └─ estimated rows: 10,000
   └─ Suggestion: CREATE INDEX idx_posts_user_id ON posts(user_id)
```

4. Green = index lookup (fast), Yellow = partial/covering index, Red = full table scan (slow)
5. Click "Create Index" → copies DDL to clipboard
6. Also accessible from the SQL Notebook (Feature 3) via an "Explain" button

## New Files

```
extension/src/
  explain/
    explain-panel.ts          # WebviewPanel for the visualization
    explain-html.ts           # HTML/CSS/JS template with tree rendering
    sql-extractor.ts          # Extract SQL strings from Dart source
extension/src/test/
  explain-panel.test.ts
  sql-extractor.test.ts
```

## Dependencies

- `api-client.ts` (Feature 1) — for `POST /api/sql/explain`

## API Endpoint

```
POST /api/sql/explain
Body: { "sql": "SELECT * FROM users WHERE email = ?" }
Response: { "rows": [...], "sql": "EXPLAIN QUERY PLAN SELECT ..." }
```

The server prepends `EXPLAIN QUERY PLAN` and returns the result rows. Each row typically has columns: `id`, `parent`, `notused`, `detail`.

## SQL Extraction from Dart Code

When the user right-clicks in a Dart file, extract the SQL string from the selection or surrounding context:

```typescript
// sql-extractor.ts

function extractSqlFromSelection(document: vscode.TextDocument, selection: vscode.Selection): string | null {
  // 1. If user selected text, use it directly
  const selectedText = document.getText(selection);
  if (selectedText.trim().toUpperCase().startsWith('SELECT')) {
    return selectedText.trim();
  }

  // 2. Look for enclosing string literal (single or double quotes, or triple quotes)
  const line = document.lineAt(selection.start.line).text;

  // Match Dart string literals containing SQL keywords
  const stringPattern = /(['"])(SELECT\b[^'"]*)\1/i;
  const triplePattern = /'''(SELECT[\s\S]*?)'''/i;

  let match = triplePattern.exec(line) || stringPattern.exec(line);
  if (match) {
    return match[match.length === 3 ? 2 : 1].trim();
  }

  // 3. Multi-line: scan backward for opening quote, forward for closing
  // ... (more complex extraction for multi-line SQL strings)

  return null;
}
```

Also handle `customSelect('...')` and `customStatement('...')` Drift patterns.

## Explain Tree Rendering

The EXPLAIN QUERY PLAN output is a flat list of rows with parent-child relationships via `id`/`parent` columns. Build a tree:

```typescript
interface ExplainNode {
  id: number;
  parent: number;
  detail: string;
  children: ExplainNode[];
  scanType: 'search' | 'scan' | 'temp' | 'other';
}

function parseExplainRows(rows: Record<string, unknown>[]): ExplainNode[] {
  // Build tree from flat rows using id/parent
  // Classify scan type from detail text:
  //   "SEARCH TABLE ... USING INDEX" -> search (green)
  //   "SCAN TABLE" -> scan (red)
  //   "USE TEMP B-TREE" -> temp (yellow)
}
```

## Webview HTML

Tree rendered as nested `<div>` elements with CSS:

```css
.node-search  { border-left: 4px solid var(--vscode-charts-green);  background: rgba(0,200,0,0.08); }
.node-scan    { border-left: 4px solid var(--vscode-charts-red);    background: rgba(200,0,0,0.08); }
.node-temp    { border-left: 4px solid var(--vscode-charts-yellow); background: rgba(200,200,0,0.08); }
```

Uses VS Code theme CSS variables (`--vscode-*`) so it matches light/dark themes.

Additional features:
- "Copy SQL" button (the original query)
- "Copy Plan" button (text representation of the tree)
- If a full table scan is detected, show an inline suggestion:
  `Suggestion: CREATE INDEX idx_tablename_colname ON "tablename"("colname");`
  with a "Copy" button

## Index Suggestion Logic

When a `SCAN TABLE tablename` node is found, cross-reference with `/api/index-suggestions` to find if there's a matching suggestion. If so, display it inline. If not, generate a basic one from the WHERE clause columns (if parseable from the original SQL).

## Context Menu Registration

```jsonc
{
  "contributes": {
    "commands": [{
      "command": "driftViewer.explainQuery",
      "title": "Drift Viewer: Explain Query Plan"
    }],
    "menus": {
      "editor/context": [{
        "command": "driftViewer.explainQuery",
        "when": "editorLangId == dart",
        "group": "drift@1"
      }]
    }
  }
}
```

## Wiring in extension.ts

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.explainQuery', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const sql = extractSqlFromSelection(editor.document, editor.selection);
    if (!sql) {
      vscode.window.showWarningMessage('No SQL query found at cursor position.');
      return;
    }

    const result = await client.explainSql(sql);
    ExplainPanel.createOrShow(context, sql, result);
  })
);
```

## Testing

- `sql-extractor.test.ts`: test extraction from single-line strings, multi-line strings, `customSelect()` calls, selected text
- `explain-panel.test.ts`: test tree building from EXPLAIN rows, scan type classification
- Test with real EXPLAIN output shapes from SQLite

## Known Limitations

- SQL extraction from Dart is heuristic — parameterized queries (`?` placeholders) may not explain correctly without bound values
- The explain plan format varies between SQLite versions
- Cannot detect index suggestions for complex queries (JOINs with multiple conditions)
- Only works when server is running (obviously)
