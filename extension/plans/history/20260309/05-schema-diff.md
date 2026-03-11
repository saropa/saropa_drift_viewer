# Feature 5: Schema Diff (Code vs Runtime)

## What It Does

Compares the Drift table definitions in your Dart source code against the actual schema in the running SQLite database. Highlights missing tables, extra columns, type mismatches, and suggests migration SQL.

## User Experience

1. Command palette: "Saropa Drift Advisor: Schema Diff (Code vs Runtime)"
2. Extension scans all `.dart` files for `class ... extends Table` definitions
3. Fetches the live schema from the running server
4. Opens a webview panel showing a structured diff:

```
                     Code vs Runtime Schema Diff
   ─────────────────────────────────────────────────────
   MATCHED (3 tables)
     users          4 columns   4 columns    OK
     posts          6 columns   6 columns    1 type mismatch
     comments       5 columns   5 columns    OK

   ONLY IN CODE (needs migration)
     user_settings  3 columns   —            CREATE TABLE needed

   ONLY IN DATABASE (orphaned?)
     —              —           old_cache     May need DROP TABLE

   TYPE MISMATCHES
     posts.created_at   Code: TEXT   DB: INTEGER
```

5. "Copy Migration SQL" button generates ALTER/CREATE/DROP statements
6. Click any table/column name to jump to the Dart source file

## New Files

```
extension/src/
  schema-diff/
    dart-parser.ts            # Regex-based extraction of Drift table definitions
    dart-schema.ts            # Data types for parsed Dart schema
    schema-diff.ts            # Diff algorithm (code vs runtime)
    schema-diff-panel.ts      # Webview panel rendering the diff
    schema-diff-html.ts       # HTML template
extension/src/test/
  dart-parser.test.ts
  schema-diff.test.ts
```

## Dependencies

Requires `api-client.ts` from Feature 1.

## Dart Parsing Strategy

**Regex-based** (not AST). There is no TypeScript Dart parser, and the Drift table DSL is regular enough for regex:

### Pass 1: Find table classes

```typescript
const TABLE_CLASS_RE = /class\s+(\w+)\s+extends\s+Table\s*\{/g;
```

For each match, extract the class body by counting brace depth (handles nested braces correctly).

### Pass 2: Extract columns from class body

```typescript
const COLUMN_RE = /(\w+Column)\s+get\s+(\w+)\s*=>\s*([^;]+);/g;
```

From the builder chain (capture group 3), detect:
- `.nullable()` — column allows NULL
- `.autoIncrement()` — auto-increment PK
- `.named('custom_sql_name')` — overrides snake_case column name
- `.withDefault(...)` — has default value

### Table name override

```typescript
const TABLE_NAME_OVERRIDE_RE = /String\s+get\s+tableName\s*=>\s*['"](\w+)['"]/;
```

If found inside the class body, use this instead of PascalCase->snake_case.

## Type Mapping

| Dart Column Type | SQL Type |
|-----------------|----------|
| `IntColumn` | `INTEGER` |
| `TextColumn` | `TEXT` |
| `BoolColumn` | `INTEGER` (SQLite stores 0/1) |
| `DateTimeColumn` | `INTEGER` (Unix epoch, default) |
| `RealColumn` | `REAL` |
| `BlobColumn` | `BLOB` |
| `Int64Column` | `INTEGER` |

## Diff Algorithm

### Level 1: Table diff
- Map code tables by `sqlTableName`
- Map runtime tables by `name` (from `/api/schema/metadata`)
- Compute: `onlyInCode`, `onlyInDb`, `inBoth`

### Level 2: Column diff (for tables in both)
- Map code columns by `sqlName`
- Map runtime columns by `name`
- Compute: `onlyInCode`, `onlyInDb`, `inBoth`

### Level 3: Type comparison (for columns in both)
- Compare mapped SQL type from Dart vs actual runtime type
- Case-insensitive comparison

```typescript
interface SchemaDiffResult {
  tablesOnlyInCode: DartTable[];
  tablesOnlyInDb: RuntimeTable[];
  tableDiffs: TableDiff[];
}

interface TableDiff {
  tableName: string;
  columnsOnlyInCode: DartColumn[];
  columnsOnlyInDb: RuntimeColumn[];
  typeMismatches: { column: string; codeType: string; dbType: string }[];
}
```

## Migration SQL Generation

For each diff item, generate SQL locally:

| Diff | Generated SQL |
|------|--------------|
| Table only in code | `CREATE TABLE "name" (col1 TYPE, col2 TYPE, ...);` |
| Table only in DB | `-- DROP TABLE IF EXISTS "name"; (review before running)` |
| Column only in code | `ALTER TABLE "name" ADD COLUMN "col" TYPE;` |
| Column only in DB | `-- Column "col" exists in DB but not in code (orphaned?)` |
| Type mismatch | `-- Type mismatch: "col" is TYPE in DB, expected TYPE from code` |

## Dart File Discovery

```typescript
const dartFiles = await vscode.workspace.findFiles(
  '**/*.dart',
  '{**/build/**,.dart_tool/**,**/*.g.dart,**/*.freezed.dart}'
);
```

Filter to only files containing `extends Table`. Cache results with file mtime; use `FileSystemWatcher` to invalidate.

## Webview UI

Custom webview panel (follows existing `DriftViewerPanel` singleton pattern):
- Summary section: matched/code-only/db-only counts
- Color-coded rows: green=matched, yellow=mismatch, red=missing
- Expandable table rows showing column details
- "Copy Migration SQL" button
- Click table/column name -> `postMessage({ command: 'navigate', file, line })`
- Extension handles navigation: `vscode.window.showTextDocument(uri, { selection })`

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [{
      "command": "driftViewer.schemaDiff",
      "title": "Saropa Drift Advisor: Schema Diff (Code vs Runtime)"
    }]
  }
}
```

## Wiring in extension.ts

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.schemaDiff', async () => {
    SchemaDiffPanel.createOrShow(context, client);
  })
);
```

## Testing

- `dart-parser.test.ts`: parse sample Dart snippets, verify table/column extraction, test `.named()` override, `.nullable()` detection, `tableName` getter override
- `schema-diff.test.ts`: construct DartTable[] and RuntimeSchema, verify diff results for all scenarios (matched, missing, extra, type mismatch)
- No need to test against actual Dart files — use inline strings

## Known Limitations

- **DateTimeColumn ambiguity**: Drift can store as INTEGER (default) or TEXT (if `storeDateTimeValuesAsText: true`). Parser assumes INTEGER; mismatch may be a false positive.
- **Nullable comparison**: The `/api/schema/metadata` endpoint doesn't include nullable info (would need server-side enhancement to expose `PRAGMA table_info` notnull column).
- **Custom table names via annotation**: `@DataClassName` doesn't affect SQL name, but other advanced patterns might be missed.
- **Multi-file table definitions**: Drift supports `@UseRowClass` and mixin-based tables — these won't be detected by the regex parser.
