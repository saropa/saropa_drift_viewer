# Feature 40: SQL Snippet Library

## What It Does

Save, organize, and reuse frequently-used SQL queries. Tag snippets by category, add descriptions, and use parameterized templates with variable substitution (`${table}`, `${limit}`, `${id}`). Snippets are stored in workspace state and can be exported/imported as JSON for team sharing.

## User Experience

1. After running any SQL query, a "Save as Snippet" button appears in the result panel
2. Command palette → "Drift Viewer: Open Snippet Library"
3. Library panel:

```
╔══════════════════════════════════════════════════════════════╗
║  SQL SNIPPET LIBRARY                   [+ New] [Import]     ║
╠══════════════════════════════════════════════════════════════╣
║  🔍 [Search snippets...              ]                      ║
║                                                              ║
║  ▼ Debugging (3)                                            ║
║    │ 📋 Find orphaned FKs                                   ║
║    │    SELECT o.id FROM "${table}" o LEFT JOIN ...          ║
║    │    [Run] [Edit] [Delete]                               ║
║    │                                                         ║
║    │ 📋 Recent changes (last N rows)                        ║
║    │    SELECT * FROM "${table}" ORDER BY id DESC LIMIT ${n} ║
║    │    [Run] [Edit] [Delete]                               ║
║    │                                                         ║
║    │ 📋 Row count by status                                 ║
║    │    SELECT status, COUNT(*) FROM "${table}" GROUP BY ... ║
║    │    [Run] [Edit] [Delete]                               ║
║                                                              ║
║  ▼ Performance (2)                                          ║
║    │ 📋 Table sizes                                         ║
║    │ 📋 Index usage check                                   ║
║                                                              ║
║  ▼ Uncategorized (1)                                        ║
║    │ 📋 Custom query                                        ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

4. Click "Run" → prompted for variable values, then query executes
5. Variables appear as input fields:

```
Run Snippet: "Recent changes (last N rows)"
──────────────────────────────────────────
  ${table}: [orders    ▾]    (table picker)
  ${n}:     [20         ]    (number input)

  Preview: SELECT * FROM "orders" ORDER BY id DESC LIMIT 20

  [Cancel]  [Run]
```

## New Files

```
extension/src/
  snippets/
    snippet-library-panel.ts   # Webview panel lifecycle
    snippet-library-html.ts    # HTML template
    snippet-store.ts           # CRUD for snippets in workspace state
    snippet-runner.ts          # Variable substitution + execution
    snippet-types.ts           # Shared interfaces
extension/src/test/
  snippet-store.test.ts
  snippet-runner.test.ts
```

## Dependencies

- `api-client.ts` — `sql()`, `schemaMetadata()` (for table picker variables)

## Architecture

### Snippet Types

```typescript
interface ISqlSnippet {
  id: string;
  name: string;
  description?: string;
  sql: string;                           // May contain ${var} placeholders
  category: string;
  variables: ISnippetVariable[];
  createdAt: string;
  lastUsedAt?: string;
  useCount: number;
}

interface ISnippetVariable {
  name: string;                          // e.g., "table", "limit", "id"
  type: 'text' | 'number' | 'table';    // 'table' shows a table picker
  default?: string;
  description?: string;
}

interface ISnippetExport {
  $schema: 'drift-snippets/v1';
  snippets: ISqlSnippet[];
}
```

### Snippet Store

```typescript
class SnippetStore {
  constructor(private readonly _state: vscode.Memento) {}

  getAll(): ISqlSnippet[] {
    return this._state.get<ISqlSnippet[]>('snippets.library', []);
  }

  save(snippet: ISqlSnippet): void {
    const all = this.getAll();
    const idx = all.findIndex(s => s.id === snippet.id);
    if (idx >= 0) {
      all[idx] = snippet;
    } else {
      all.push(snippet);
    }
    this._state.update('snippets.library', all);
  }

  delete(id: string): void {
    const all = this.getAll().filter(s => s.id !== id);
    this._state.update('snippets.library', all);
  }

  getCategories(): string[] {
    const cats = new Set(this.getAll().map(s => s.category));
    return [...cats].sort();
  }

  search(query: string): ISqlSnippet[] {
    const lower = query.toLowerCase();
    return this.getAll().filter(s =>
      s.name.toLowerCase().includes(lower) ||
      s.sql.toLowerCase().includes(lower) ||
      (s.description?.toLowerCase().includes(lower) ?? false)
    );
  }

  exportAll(): string {
    const data: ISnippetExport = {
      $schema: 'drift-snippets/v1',
      snippets: this.getAll(),
    };
    return JSON.stringify(data, null, 2);
  }

  importFrom(json: string): number {
    const data = JSON.parse(json) as ISnippetExport;
    const existing = this.getAll();
    const existingIds = new Set(existing.map(s => s.id));
    let added = 0;

    for (const snippet of data.snippets) {
      if (!existingIds.has(snippet.id)) {
        existing.push(snippet);
        added++;
      }
    }

    this._state.update('snippets.library', existing);
    return added;
  }
}
```

### Snippet Runner

```typescript
class SnippetRunner {
  constructor(private readonly _client: DriftApiClient) {}

  /** Extract variable names from SQL template. */
  extractVariables(sql: string): string[] {
    const matches = sql.matchAll(/\$\{(\w+)\}/g);
    return [...new Set([...matches].map(m => m[1]))];
  }

  /** Substitute variables and return final SQL. */
  interpolate(sql: string, values: Record<string, string>): string {
    return sql.replace(/\$\{(\w+)\}/g, (_, name) => {
      const value = values[name];
      if (value === undefined) return `\${${name}}`;
      return value;
    });
  }

  /** Run a snippet with variable values. */
  async run(
    snippet: ISqlSnippet,
    values: Record<string, string>,
  ): Promise<{ columns: string[]; rows: object[] }> {
    const sql = this.interpolate(snippet.sql, values);
    return this._client.sql(sql);
  }

  /** Auto-detect variable types from names. */
  inferVariableTypes(names: string[]): ISnippetVariable[] {
    return names.map(name => {
      if (name === 'table' || name.endsWith('_table')) {
        return { name, type: 'table' as const, description: 'Table name' };
      }
      if (name === 'limit' || name === 'n' || name === 'count') {
        return { name, type: 'number' as const, default: '10' };
      }
      return { name, type: 'text' as const };
    });
  }
}
```

### Built-in Starter Snippets

```typescript
const STARTER_SNIPPETS: ISqlSnippet[] = [
  {
    id: 'builtin-row-count',
    name: 'Row count',
    sql: 'SELECT COUNT(*) AS count FROM "${table}"',
    category: 'Basics',
    variables: [{ name: 'table', type: 'table' }],
    useCount: 0, createdAt: '',
  },
  {
    id: 'builtin-recent-rows',
    name: 'Recent rows',
    sql: 'SELECT * FROM "${table}" ORDER BY rowid DESC LIMIT ${n}',
    category: 'Debugging',
    variables: [
      { name: 'table', type: 'table' },
      { name: 'n', type: 'number', default: '20' },
    ],
    useCount: 0, createdAt: '',
  },
  {
    id: 'builtin-distinct-values',
    name: 'Distinct values',
    sql: 'SELECT DISTINCT "${column}" FROM "${table}" ORDER BY 1',
    category: 'Exploration',
    variables: [
      { name: 'table', type: 'table' },
      { name: 'column', type: 'text' },
    ],
    useCount: 0, createdAt: '',
  },
  {
    id: 'builtin-null-check',
    name: 'NULL counts per column',
    sql: 'SELECT COUNT(*) - COUNT("${column}") AS null_count FROM "${table}"',
    category: 'Data Quality',
    variables: [
      { name: 'table', type: 'table' },
      { name: 'column', type: 'text' },
    ],
    useCount: 0, createdAt: '',
  },
];
```

### Webview Message Protocol

Webview → Extension:
```typescript
{ command: 'runSnippet', id: string, values: Record<string, string> }
{ command: 'saveSnippet', snippet: ISqlSnippet }
{ command: 'deleteSnippet', id: string }
{ command: 'search', query: string }
{ command: 'exportAll' }
{ command: 'importFile' }
```

Extension → Webview:
```typescript
{ command: 'init', snippets: ISqlSnippet[], categories: string[], tables: string[] }
{ command: 'updated', snippets: ISqlSnippet[] }
{ command: 'queryResult', snippetId: string, columns: string[], rows: object[] }
{ command: 'error', snippetId: string, message: string }
```

## Server-Side Changes

None.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.openSnippetLibrary",
        "title": "Drift Viewer: Open SQL Snippet Library",
        "icon": "$(notebook)"
      },
      {
        "command": "driftViewer.saveAsSnippet",
        "title": "Drift Viewer: Save Query as Snippet"
      }
    ],
    "menus": {
      "view/title": [{
        "command": "driftViewer.openSnippetLibrary",
        "when": "view == driftViewer.databaseExplorer && driftViewer.serverConnected",
        "group": "navigation"
      }]
    }
  }
}
```

## Wiring in extension.ts

```typescript
const snippetStore = new SnippetStore(context.workspaceState);
const snippetRunner = new SnippetRunner(client);

// Initialize with starter snippets on first run
if (snippetStore.getAll().length === 0) {
  for (const starter of STARTER_SNIPPETS) {
    snippetStore.save({ ...starter, createdAt: new Date().toISOString() });
  }
}

context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.openSnippetLibrary', () => {
    SnippetLibraryPanel.createOrShow(
      context.extensionUri, client, snippetStore, snippetRunner
    );
  }),

  vscode.commands.registerCommand('driftViewer.saveAsSnippet', async () => {
    const sql = await vscode.window.showInputBox({ prompt: 'SQL query to save' });
    if (!sql) return;
    const name = await vscode.window.showInputBox({ prompt: 'Snippet name' });
    if (!name) return;

    const runner = new SnippetRunner(client);
    const varNames = runner.extractVariables(sql);
    const variables = runner.inferVariableTypes(varNames);

    snippetStore.save({
      id: crypto.randomUUID(),
      name,
      sql,
      category: 'Uncategorized',
      variables,
      createdAt: new Date().toISOString(),
      useCount: 0,
    });

    vscode.window.showInformationMessage(`Snippet "${name}" saved.`);
  })
);
```

## Testing

- `snippet-store.test.ts`:
  - Save and retrieve round-trip
  - Update existing snippet by ID
  - Delete removes snippet
  - Search by name, SQL, description
  - Export produces valid JSON with `$schema`
  - Import adds only new snippets (no duplicates)
  - Categories computed from all snippets
- `snippet-runner.test.ts`:
  - Extract variables from SQL template
  - Interpolate replaces all occurrences
  - Unknown variables left as-is
  - `inferVariableTypes` detects table/number/text
  - Run executes interpolated SQL against client

## Known Limitations

- Variable substitution is simple string replacement — no escaping of user-provided values in the template
- No syntax highlighting in the snippet SQL editor (plain textarea)
- Categories are free-text — no predefined taxonomy
- No version control on snippets — edits overwrite
- Snippet import doesn't merge — duplicates are skipped by ID
- No snippet sharing via URL or cloud sync
- Built-in starter snippets can be deleted — no "restore defaults" option
- No autocomplete for variable names in SQL templates
