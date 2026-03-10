# Feature 9: DB Row Preview on Hover

## What It Does

During a debug session, hover over a Drift table class name or DAO reference in Dart code and see a hover card with live row count, the 3 most recent rows, and a schema summary. Zero cost when not debugging.

## User Experience

Hover over `Users` in `class Users extends Table`:

```
┌─────────────────────────────────────────┐
│ 📊 users — 42 rows                      │
│                                          │
│ Schema: id INTEGER PK, name TEXT,        │
│         email TEXT?, created_at INTEGER   │
│                                          │
│ Recent rows:                             │
│ ┌────┬───────┬──────────────┐            │
│ │ id │ name  │ email        │            │
│ ├────┼───────┼──────────────┤            │
│ │ 42 │ Alice │ alice@ex.com │            │
│ │ 41 │ Bob   │ bob@ex.com   │            │
│ │ 40 │ Carol │ null         │            │
│ └────┴───────┴──────────────┘            │
│                                          │
│ [View All] [Run Query]                   │
└─────────────────────────────────────────┘
```

Only appears when:
1. A Dart debug session is active (`vscode.debug.activeDebugSession`)
2. The Drift server is reachable
3. The hovered identifier resolves to a known Drift table

## New Files

```
extension/src/
  hover/
    drift-hover-provider.ts     # HoverProvider implementation
extension/src/test/
  drift-hover-provider.test.ts
```

## Dependencies

- `api-client.ts` (Feature 1) — fetch table data and metadata
- `codelens/table-name-mapper.ts` (Feature 2) — resolve Dart name to SQL table
- `generation-watcher.ts` (Feature 1) — cache invalidation

## How It Works

### HoverProvider

```typescript
class DriftHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly _client: DriftApiClient,
    private readonly _mapper: TableNameMapper,
    private readonly _cache: HoverCache,
  ) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Hover | null> {
    // Gate: only during debug sessions
    if (!vscode.debug.activeDebugSession) return null;

    // Get word under cursor
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) return null;
    const word = document.getText(wordRange);

    // Check if this word is a Drift table class name
    const sqlTable = this._mapper.resolve(word);
    if (!sqlTable) return null;

    // Check cache first
    const cached = this._cache.get(sqlTable);
    if (cached) return cached;

    // Fetch data from server
    try {
      const [metadata, rows] = await Promise.all([
        this._client.schemaMetadata(),
        this._client.runSql(`SELECT * FROM "${sqlTable}" ORDER BY rowid DESC LIMIT 3`),
      ]);

      const table = metadata.tables.find(t => t.name === sqlTable);
      if (!table) return null;

      const hover = buildHoverMarkdown(table, rows.rows);
      this._cache.set(sqlTable, hover, 10_000); // cache 10s
      return hover;
    } catch {
      return null; // server unreachable, no hover
    }
  }
}
```

### Hover Markdown Content

```typescript
function buildHoverMarkdown(
  table: TableMetadata,
  recentRows: Record<string, unknown>[],
): vscode.Hover {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportHtml = true;

  // Header
  md.appendMarkdown(`**${table.name}** — ${table.rowCount} rows\n\n`);

  // Schema summary
  const schemaLine = table.columns
    .map(c => `\`${c.name}\` ${c.type}${c.pk ? ' PK' : ''}`)
    .join(', ');
  md.appendMarkdown(`Schema: ${schemaLine}\n\n`);

  // Recent rows as markdown table
  if (recentRows.length > 0) {
    md.appendMarkdown('Recent rows:\n\n');
    const cols = Object.keys(recentRows[0]);
    md.appendMarkdown(`| ${cols.join(' | ')} |\n`);
    md.appendMarkdown(`| ${cols.map(() => '---').join(' | ')} |\n`);
    for (const row of recentRows) {
      const cells = cols.map(c => truncate(String(row[c] ?? 'null'), 20));
      md.appendMarkdown(`| ${cells.join(' | ')} |\n`);
    }
    md.appendMarkdown('\n');
  }

  // Action links
  md.appendMarkdown(
    `[View All](command:driftViewer.viewTableInPanel?${encodeURIComponent(JSON.stringify(table.name))}) | ` +
    `[Run Query](command:driftViewer.runTableQuery?${encodeURIComponent(JSON.stringify(table.name))})`
  );

  return new vscode.Hover(md);
}
```

### Debug Session Gating

The provider checks `vscode.debug.activeDebugSession` on every hover call. This is a synchronous property read (no API call), so it's essentially free when no debug session is running.

Additionally, subscribe to debug session changes to clear the cache:

```typescript
vscode.debug.onDidStartDebugSession(() => {
  hoverCache.clear();
  // Server might now be reachable
});

vscode.debug.onDidTerminateDebugSession(() => {
  hoverCache.clear();
  // Server is likely gone
});
```

### Caching

```typescript
class HoverCache {
  private _entries = new Map<string, { hover: vscode.Hover; expires: number }>();

  get(key: string): vscode.Hover | null {
    const entry = this._entries.get(key);
    if (!entry || Date.now() > entry.expires) return null;
    return entry.hover;
  }

  set(key: string, hover: vscode.Hover, ttlMs: number): void {
    this._entries.set(key, { hover, expires: Date.now() + ttlMs });
  }

  clear(): void { this._entries.clear(); }
}
```

TTL of 10 seconds — hovers should feel live but not hammer the server on rapid mouse movements. Cache is invalidated on generation change.

## Where Hovers Trigger

The provider matches words that:
1. Are PascalCase identifiers (potential table class names)
2. Resolve via `TableNameMapper` to a known SQL table

This means hovers work on:
- Table class definitions: `class Users extends Table`
- Table references in queries: `db.select(db.users)`
- Variable types: `final Users table = ...`
- Import references, type annotations, etc.

## package.json Contributions

```jsonc
{
  "contributes": {
    "configuration": {
      "properties": {
        "driftViewer.hover.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Show database row preview on hover during debug sessions."
        },
        "driftViewer.hover.maxRows": {
          "type": "number",
          "default": 3,
          "description": "Number of recent rows to show in hover preview."
        }
      }
    }
  }
}
```

No command needed — the hover provider registers automatically.

## Wiring in extension.ts

```typescript
const hoverCache = new HoverCache();
const hoverProvider = new DriftHoverProvider(client, mapper, hoverCache);

context.subscriptions.push(
  vscode.languages.registerHoverProvider(
    { language: 'dart', scheme: 'file' },
    hoverProvider
  )
);

// Invalidate cache on data change
watcher.onDidChange(() => hoverCache.clear());
```

## Testing

- Test hover returns null when no debug session active
- Test hover returns null for non-table words
- Test hover content format (markdown table, schema line, action links)
- Test cache TTL expiry and invalidation
- Mock `vscode.debug.activeDebugSession` in test setup

## Known Limitations

- Only triggers on PascalCase words that match table names — won't trigger on snake_case SQL table names in string literals
- `ORDER BY rowid DESC` assumes rowid exists (true for all non-WITHOUT ROWID tables in SQLite)
- Action links in hover markdown require `md.isTrusted = true` — works in VS Code but may not in all forks
- Hover data is read-only (consistent with server's read-only API)
- If the debug session is active but the Drift server hasn't started yet, hover silently returns null
