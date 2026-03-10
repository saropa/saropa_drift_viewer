# Feature 2: CodeLens on Drift Table Classes

## What It Does

Shows inline annotations above Drift table class definitions in Dart files. Each table class gets a lens showing its live row count, with clickable actions to view the data or run a query.

## User Experience

In any `.dart` file containing a Drift table:

```dart
// $(database) 42 rows | View in Drift Viewer | Run Query
class Users extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get name => text()();
}
```

- **"42 rows"** — live count from the running server, updates when data changes
- **"View in Drift Viewer"** — opens the webview panel filtered to that table
- **"Run Query"** — runs `SELECT * FROM users` and shows results in a JSON editor tab
- If the server is offline, shows "not connected" instead of a count

## New Files

```
extension/src/
  codelens/
    drift-codelens-provider.ts   # CodeLensProvider implementation
    table-name-mapper.ts         # Dart PascalCase -> snake_case SQL name mapping
extension/src/test/
  drift-codelens-provider.test.ts
  table-name-mapper.test.ts
```

## Dependencies

Requires the shared `api-client.ts` and `generation-watcher.ts` from Feature 1.

## Table Name Mapping

Drift converts Dart class names to SQL table names using snake_case:

| Dart Class | SQL Table |
|-----------|-----------|
| `Users` | `users` |
| `TodoCategories` | `todo_categories` |
| `UserProfileSettings` | `user_profile_settings` |

```typescript
function dartClassToSnakeCase(className: string): string {
  return className
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}
```

The `TableNameMapper` class:
1. Converts PascalCase to snake_case
2. Validates against the actual table list from `/api/tables`
3. Falls back to case-insensitive matching
4. Caches results (cleared when server table list changes)

## CodeLens Detection

Regex pattern for Drift table classes:

```typescript
const TABLE_CLASS_REGEX = /^(\s*)class\s+(\w+)\s+extends\s+Table\s*\{/gm;
```

This matches the standard Drift pattern. It will also match non-Drift `extends Table` classes, but the lens shows "not connected" if the table name doesn't match anything on the server, so false positives are harmless.

## CodeLens Actions

Three lenses per table class:

| Lens | Command | Behavior |
|------|---------|----------|
| `$(database) 42 rows` | `driftViewer.refreshTree` | Refreshes data |
| `View in Drift Viewer` | `driftViewer.viewTableInPanel` | Opens webview filtered to table |
| `Run Query` | `driftViewer.runTableQuery` | Opens JSON results in editor tab |

## package.json Contributions

```jsonc
{
  "activationEvents": ["onLanguage:dart"],
  "contributes": {
    "commands": [
      { "command": "driftViewer.viewTableInPanel", "title": "Drift Viewer: View Table" },
      { "command": "driftViewer.runTableQuery", "title": "Drift Viewer: Run Table Query" }
    ]
  }
}
```

## Caching Strategy

```
provideCodeLenses() — SYNCHRONOUS, reads from in-memory cache only
                            |
                            reads from:
                            |
           _rowCounts map (tableName -> count)
           _mappingCache   (dartClass -> sqlName)
                            |
                            updated by:
                            |
           refreshRowCounts() — called on GenerationWatcher.onDidChange
                            |
                            fetches:
                            |
           GET /api/schema/metadata — single call returns all tables + counts
```

- `provideCodeLenses()` is called on every keystroke — must be fast (no async)
- Row counts update via generation watcher (long-poll, ~30s interval when idle)
- `onDidChangeCodeLenses` event fires after refresh to trigger VS Code re-render

## Wiring in extension.ts

```typescript
const mapper = new TableNameMapper();
const codeLensProvider = new DriftCodeLensProvider(client, mapper);

context.subscriptions.push(
  vscode.languages.registerCodeLensProvider(
    { language: 'dart', scheme: 'file' },
    codeLensProvider
  )
);

// Wire to generation watcher
watcher.onDidChange(async () => {
  await codeLensProvider.refreshRowCounts();
  codeLensProvider.notifyChange();
});

codeLensProvider.refreshRowCounts(); // initial load
```

## Run Query Command

Opens results in a temporary JSON editor:

```typescript
vscode.commands.registerCommand('driftViewer.runTableQuery', async (tableName: string) => {
  const result = await client.runSql(`SELECT * FROM "${tableName}"`);
  const doc = await vscode.workspace.openTextDocument({
    content: JSON.stringify(result.rows, null, 2),
    language: 'json',
  });
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
});
```

## Testing

- `table-name-mapper.test.ts`: test PascalCase->snake_case, case-insensitive fallback, cache invalidation
- `drift-codelens-provider.test.ts`: test regex matching on sample Dart code, lens generation with/without server connection
- Extend `vscode-mock.ts` with `CodeLens`, `Range`, `Position`, `languages.registerCodeLensProvider`

## Known Limitations

- Cannot distinguish `extends Table` from Drift vs other packages without parsing imports
- Custom `String get tableName => 'custom';` overrides not detected (would need to parse class body)
- Lens shows stale counts until next generation change (acceptable: usually within seconds)
