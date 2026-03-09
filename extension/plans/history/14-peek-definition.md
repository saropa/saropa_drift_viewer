# Feature 14: Peek Definition for SQL Table/Column Names

## What It Does

Place your cursor on `users` inside a raw SQL string in Dart code → press Alt+F12 → peek window shows `class Users extends Table { ... }`. Works for column names too. Bridges the SQL world with the Dart world.

## User Experience

```dart
final results = await db.customSelect(
  'SELECT name, email FROM users WHERE id = ?',  // ← cursor on "users"
  //                          ^^^^^
  //                    Alt+F12 here
);
```

Peek window opens showing:
```dart
// lib/database/tables/users.dart
class Users extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get name => text()();
  TextColumn get email => text().nullable()();
  DateTimeColumn get createdAt => dateTime()();
}
```

Also works for column names: cursor on `email` → peeks to the `get email` getter line.

## New Files

```
extension/src/
  definition/
    drift-definition-provider.ts    # DefinitionProvider implementation
    sql-string-detector.ts          # Detects if cursor is inside a SQL string
extension/src/test/
  drift-definition-provider.test.ts
  sql-string-detector.test.ts
```

## Dependencies

- `codelens/table-name-mapper.ts` (Feature 2) — reverse-map SQL names to Dart classes
- Dart parser from Feature 5 (`dart-parser.ts`) — locate source definitions
- `api-client.ts` (Feature 1) — fetch table/column names for validation

## How It Works

### Step 1: Detect if Cursor is in a SQL String

```typescript
function isInsideSqlString(document: vscode.TextDocument, position: vscode.Position): boolean {
  const line = document.lineAt(position.line).text;

  // Check if position is inside a string literal containing SQL keywords
  // Look for enclosing quotes (single, double, or triple)
  const beforeCursor = line.substring(0, position.character);
  const afterCursor = line.substring(position.character);

  // Count unescaped quotes before cursor
  const inSingleQuote = (beforeCursor.match(/'/g)?.length ?? 0) % 2 === 1;
  const inDoubleQuote = (beforeCursor.match(/"/g)?.length ?? 0) % 2 === 1;

  if (!inSingleQuote && !inDoubleQuote) return false;

  // Verify the string contains SQL keywords
  const fullString = extractEnclosingString(line, position.character);
  return /\b(SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|JOIN|CREATE|ALTER)\b/i.test(fullString);
}
```

### Step 2: Extract the Word Under Cursor

Get the identifier at the cursor position. In SQL strings, identifiers are separated by spaces, commas, dots, parentheses, etc.

```typescript
function getSqlIdentifier(document: vscode.TextDocument, position: vscode.Position): string | null {
  const range = document.getWordRangeAtPosition(position, /[\w]+/);
  if (!range) return null;
  return document.getText(range);
}
```

### Step 3: Determine if it's a Table or Column Name

```typescript
function classifyIdentifier(
  word: string,
  context: string, // surrounding SQL text
  knownTables: string[],
  knownColumns: Map<string, string[]>, // tableName -> columnNames
): { type: 'table' | 'column'; tableName?: string } | null {
  // Check if it's a known table name
  if (knownTables.includes(word)) {
    return { type: 'table' };
  }

  // Check if it's a known column name
  for (const [table, columns] of knownColumns) {
    if (columns.includes(word)) {
      // Verify context: is this column from a table referenced in the SQL?
      if (context.toLowerCase().includes(table)) {
        return { type: 'column', tableName: table };
      }
    }
  }

  return null;
}
```

### Step 4: Resolve to Dart Source Location

```typescript
class DriftDefinitionProvider implements vscode.DefinitionProvider {
  constructor(
    private readonly _mapper: TableNameMapper,
    private readonly _dartParser: DartParser,
    private readonly _client: DriftApiClient,
  ) {}

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Location | null> {
    // Only in Dart files, inside SQL strings
    if (document.languageId !== 'dart') return null;
    if (!isInsideSqlString(document, position)) return null;

    const word = getSqlIdentifier(document, position);
    if (!word) return null;

    // Get known tables and columns
    const tables = await this._client.tables();
    const metadata = await this._client.schemaMetadata();
    const columnMap = new Map(
      metadata.tables.map(t => [t.name, t.columns.map(c => c.name)])
    );

    const classification = classifyIdentifier(
      word,
      document.lineAt(position.line).text,
      tables,
      columnMap,
    );
    if (!classification) return null;

    // Find Dart source location
    const parsedTables = await this._dartParser.parseWorkspace();

    if (classification.type === 'table') {
      const dartTable = parsedTables.find(
        t => t.sqlTableName === word
      );
      if (!dartTable) return null;
      return new vscode.Location(
        vscode.Uri.file(dartTable.sourceFile),
        new vscode.Position(dartTable.sourceLine, 0),
      );
    }

    if (classification.type === 'column' && classification.tableName) {
      const dartTable = parsedTables.find(
        t => t.sqlTableName === classification.tableName
      );
      if (!dartTable) return null;

      const dartColumn = dartTable.columns.find(
        c => c.sqlName === word
      );
      if (!dartColumn) return null;

      return new vscode.Location(
        vscode.Uri.file(dartTable.sourceFile),
        new vscode.Position(dartColumn.sourceLine, 0),
      );
    }

    return null;
  }
}
```

## Registration

```typescript
// Registers for BOTH definition (F12) and peek definition (Alt+F12)
context.subscriptions.push(
  vscode.languages.registerDefinitionProvider(
    { language: 'dart', scheme: 'file' },
    new DriftDefinitionProvider(mapper, dartParser, client)
  )
);
```

VS Code uses the same provider for both Go to Definition (F12) and Peek Definition (Alt+F12). The peek window is the VS Code UI layer on top.

## package.json Contributions

No special contributions needed — definition providers are registered programmatically.

## Caching

- Table/column lists: cached from `/api/schema/metadata`, refreshed on generation change
- Dart parse results: cached with file mtime, refreshed on file save
- Both caches shared with Features 2, 5, 7

## Edge Cases

| SQL Pattern | Word | Resolution |
|-------------|------|-----------|
| `FROM users` | `users` | → `class Users` |
| `users.email` | `email` | → `get email` in Users class |
| `u.email` (alias) | `email` | → `get email` (if unambiguous) |
| `SELECT email` | `email` | → `get email` (if only one table has that column) |
| `"users"` (quoted) | `users` | → `class Users` (strip quotes) |

## Testing

- `sql-string-detector.test.ts`: test detection inside single/double/triple quoted strings, negative cases (not in string, not SQL)
- `drift-definition-provider.test.ts`: test table resolution, column resolution, ambiguous column, no match
- Use inline Dart code strings as test fixtures

## Known Limitations

- Only works inside string literals in Dart files — not in `.sql` files or other contexts
- Ambiguous column names (same column in multiple tables) may resolve to the wrong table
- SQL aliases (`FROM users u`) are not tracked — `u.email` won't resolve via alias
- Multi-line SQL strings require scanning beyond the current line for full context
- Depends on Dart parser (Feature 5) for source locations — falls back gracefully if parser unavailable
- String detection is heuristic — may false-positive on non-SQL strings containing SQL keywords
