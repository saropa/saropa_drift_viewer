# Feature 17: Generate Dart Table Code from Runtime Schema

## What It Does

Generates Drift table class definitions (Dart code) from the live SQLite schema. This is the reverse of the schema-diff feature: instead of comparing code against DB, it creates code from the DB. Useful for reverse-engineering an existing database or bootstrapping Dart table definitions for tables that exist in the DB but have no Dart counterpart.

## User Experience

1. Command palette: "Saropa Drift Advisor: Generate Dart from Schema"
2. Extension fetches runtime schema from the running server
3. If schema-diff data is available, only db-only tables are offered (no duplicates)
4. User picks which tables to generate (Quick Pick, multi-select)
5. Opens a new untitled Dart editor with generated code:

```dart
import 'package:drift/drift.dart';

class UserSettings extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get name => text()();
  TextColumn get value => text().nullable()();
}

class OldCache extends Table {
  IntColumn get id => integer().autoIncrement()();
  BlobColumn get data => blob()();
  IntColumn get expiresAt => integer()();
}
```

6. User reviews, adjusts, and saves to their desired location

## New Files

```
extension/src/
  codegen/
    dart-codegen.ts             # Pure function: SQLite schema -> Dart source
extension/src/test/
  dart-codegen.test.ts
```

## Dependencies

- `api-client.ts` — `schemaMetadata()` for runtime schema
- `TableMetadata`, `ColumnMetadata` from `api-client.ts`
- `PRAGMA table_info` data is already available via `/api/schema/metadata`

## Type Mapping (reverse of dart-schema.ts)

| SQLite Type | Dart Column Type |
|-------------|-----------------|
| `INTEGER` | `IntColumn` |
| `TEXT` | `TextColumn` |
| `REAL` | `RealColumn` |
| `BLOB` | `BlobColumn` |
| `NUMERIC` | `IntColumn` (fallback) |
| Unknown | `TextColumn` (safe fallback) |

Note: `BoolColumn`, `DateTimeColumn`, `Int64Column` all map to `INTEGER` in SQLite, so the reverse mapping can only produce `IntColumn`. A comment is added for INTEGER columns suggesting they may be `BoolColumn` or `DateTimeColumn` based on naming heuristics (e.g., `is_active` -> likely Bool, `created_at` -> likely DateTime).

## Code Generation Logic

### Table name -> Dart class

`snake_case` -> `PascalCase`: `user_settings` -> `UserSettings`

### Column name -> Dart getter

`snake_case` -> `camelCase`: `created_at` -> `createdAt`

If the generated getter name would differ from the column's snake_case via `dartClassToSnakeCase`, emit `.named('original_name')` to preserve the SQL name.

### Column modifiers

- `pk = true` in metadata -> `.autoIncrement()` (if INTEGER PK, which is the SQLite auto-increment convention)
- `notnull = false` (if available from PRAGMA) -> `.nullable()`
- For non-PK INTEGER columns with heuristic names:
  - `is_*`, `has_*`, `can_*` -> `// Consider: BoolColumn`
  - `*_at`, `*_date`, `*_time` -> `// Consider: DateTimeColumn`

### Output structure

```dart
import 'package:drift/drift.dart';

/// Generated from runtime schema — review before using.

class TableName extends Table {
  DartType get getterName => builder()();
}
```

## Command Wiring

### package.json

```jsonc
{
  "contributes": {
    "commands": [{
      "command": "driftViewer.generateDart",
      "title": "Saropa Drift Advisor: Generate Dart from Schema"
    }]
  }
}
```

### extension.ts

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.generateDart', async () => {
    const schema = await client.schemaMetadata();
    const picked = await vscode.window.showQuickPick(
      schema.map(t => ({ label: t.name, table: t })),
      { canPickMany: true, placeHolder: 'Select tables to generate' },
    );
    if (!picked?.length) return;
    const dart = generateDartTables(picked.map(p => p.table));
    const doc = await vscode.workspace.openTextDocument({
      content: dart, language: 'dart',
    });
    vscode.window.showTextDocument(doc);
  }),
);
```

## Testing

- `dart-codegen.test.ts`: test `generateDartTables()` with constructed `TableMetadata[]`
  - Basic table with INTEGER, TEXT, REAL, BLOB columns
  - PK detection -> autoIncrement
  - snake_case -> camelCase getter naming
  - Unknown type fallback to TextColumn
  - Empty table
  - Multiple tables
  - Heuristic comments for Bool/DateTime candidates
  - Named override when camelCase round-trip doesn't match

## Known Limitations

- **INTEGER ambiguity**: Cannot distinguish `IntColumn` from `BoolColumn`, `DateTimeColumn`, or `Int64Column`. Adds heuristic comments only.
- **No foreign key generation**: Drift FK references require knowledge of the target table's Dart class, which may not exist yet. FK info is logged as comments.
- **No index/unique constraint generation**: `PRAGMA index_list` data would be needed; currently not fetched.
- **No `@DataClassName` or `@UseRowClass`**: Generated code uses simple class-per-table pattern.
- **Custom column names**: If the original Dart code used `.named()`, the reverse mapping will use the SQL name directly and may produce a different getter name.
