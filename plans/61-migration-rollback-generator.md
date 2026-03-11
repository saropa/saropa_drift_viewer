# Feature 61: Migration Rollback Generator

## What It Does

Select any Drift migration step and auto-generate the reverse migration — both the rollback SQL and the Dart `MigrationStrategy` code. Answers "how do I undo this schema change?" for every `CREATE TABLE`, `ALTER TABLE ADD COLUMN`, `CREATE INDEX`, and `DROP` operation.

## User Experience

1. Command palette → "Saropa Drift Advisor: Generate Migration Rollback"
2. QuickPick lists recent schema changes (from Schema Evolution Timeline, Feature 41)
3. Select a change → extension generates the reverse SQL and Dart code
4. Preview panel shows both with copy buttons

```
╔══════════════════════════════════════════════════════════════╗
║  MIGRATION ROLLBACK GENERATOR                                ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Original migration (schema change #5 → #6):                ║
║  ┌──────────────────────────────────────────────────────┐   ║
║  │ ALTER TABLE "users" ADD COLUMN "phone" TEXT;          │   ║
║  │ CREATE INDEX "idx_users_phone" ON "users"("phone");   │   ║
║  └──────────────────────────────────────────────────────┘   ║
║                                                              ║
║  Generated rollback SQL:                                     ║
║  ┌──────────────────────────────────────────────────────┐   ║
║  │ DROP INDEX IF EXISTS "idx_users_phone";               │   ║
║  │ ALTER TABLE "users" DROP COLUMN "phone";              │   ║
║  └──────────────────────────────────────────────────────┘   ║
║  [Copy SQL]                                                  ║
║                                                              ║
║  Generated Dart migration code:                              ║
║  ┌──────────────────────────────────────────────────────┐   ║
║  │ // Rollback: undo schema change #5 → #6               │   ║
║  │ await customStatement(                                │   ║
║  │   'DROP INDEX IF EXISTS "idx_users_phone"',           │   ║
║  │ );                                                    │   ║
║  │ await customStatement(                                │   ║
║  │   'ALTER TABLE "users" DROP COLUMN "phone"',          │   ║
║  │ );                                                    │   ║
║  └──────────────────────────────────────────────────────┘   ║
║  [Copy Dart]                                                 ║
║                                                              ║
║  ⚠ Warning: DROP COLUMN requires SQLite 3.35.0+             ║
╚══════════════════════════════════════════════════════════════╝
```

## New Files

```
extension/src/migration-rollback/
  rollback-generator.ts       # SQL reversal logic
  rollback-panel.ts           # Webview panel
  rollback-html.ts            # HTML template
  rollback-types.ts           # Interfaces
extension/src/test/
  rollback-generator.test.ts
```

## Modified Files

```
extension/src/extension.ts    # Register command
extension/package.json         # Command
```

## Dependencies

- `SchemaTracker` (Feature 41) — provides schema fingerprints over time
- `api-client.ts` — `schemaDump()` for current CREATE statements

## Architecture

### Schema Diff Detection

Compares two schema snapshots to identify the forward migration:

```typescript
interface ISchemaDiff {
  added: ISchemaObject[];
  removed: ISchemaObject[];
  modified: ISchemaModification[];
}

interface ISchemaObject {
  type: 'table' | 'index' | 'view' | 'trigger';
  name: string;
  sql: string;
}

interface ISchemaModification {
  table: string;
  addedColumns: Array<{ name: string; type: string; defaultValue?: string }>;
  removedColumns: string[];
}

function diffSchemas(before: string, after: string): ISchemaDiff {
  const beforeObjs = parseCreateStatements(before);
  const afterObjs = parseCreateStatements(after);

  const beforeNames = new Set(beforeObjs.map(o => o.name));
  const afterNames = new Set(afterObjs.map(o => o.name));

  return {
    added: afterObjs.filter(o => !beforeNames.has(o.name)),
    removed: beforeObjs.filter(o => !afterNames.has(o.name)),
    modified: detectColumnChanges(beforeObjs, afterObjs),
  };
}
```

### Rollback Generator

Generates the reverse of each detected change:

```typescript
interface IRollback {
  sql: string[];
  dart: string;
  warnings: string[];
}

function generateRollback(diff: ISchemaDiff): IRollback {
  const sql: string[] = [];
  const warnings: string[] = [];

  // Reverse added objects (drop them)
  for (const obj of diff.added) {
    sql.push(`DROP ${obj.type.toUpperCase()} IF EXISTS "${obj.name}";`);
  }

  // Reverse removed objects (re-create them)
  for (const obj of diff.removed) {
    sql.push(obj.sql + ';');
  }

  // Reverse column additions (drop them)
  for (const mod of diff.modified) {
    for (const col of mod.addedColumns) {
      sql.push(`ALTER TABLE "${mod.table}" DROP COLUMN "${col.name}";`);
      warnings.push('DROP COLUMN requires SQLite 3.35.0+ (2021-03-12)');
    }
  }

  // Reverse column removals — cannot be done with ALTER TABLE
  for (const mod of diff.modified) {
    if (mod.removedColumns.length > 0) {
      warnings.push(
        `Cannot reverse column removal for ${mod.table}.${mod.removedColumns.join(', ')}. ` +
        'SQLite does not support ADD COLUMN with constraints from the original schema. ' +
        'Manual migration required.'
      );
    }
  }

  // Order: drop indexes before dropping columns, recreate tables before indexes
  const ordered = orderRollbackStatements(sql);

  const dart = ordered.map(s =>
    `await customStatement(\n  '${s.replace(/'/g, "\\'")}',\n);`
  ).join('\n');

  return { sql: ordered, dart, warnings: [...new Set(warnings)] };
}
```

### CREATE Statement Parser

Extracts structured data from `CREATE TABLE` / `CREATE INDEX` SQL:

```typescript
function parseCreateStatements(schemaDump: string): ISchemaObject[] {
  const objects: ISchemaObject[] = [];
  const regex = /CREATE\s+(TABLE|INDEX|UNIQUE\s+INDEX|VIEW|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?\s*([^;]*);/gi;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(schemaDump)) !== null) {
    objects.push({
      type: normalizeType(match[1]),
      name: match[2],
      sql: match[0].replace(/;$/, ''),
    });
  }
  return objects;
}

function detectColumnChanges(
  before: ISchemaObject[],
  after: ISchemaObject[],
): ISchemaModification[] {
  const mods: ISchemaModification[] = [];

  for (const afterObj of after) {
    if (afterObj.type !== 'table') continue;
    const beforeObj = before.find(b => b.name === afterObj.name && b.type === 'table');
    if (!beforeObj) continue;

    const beforeCols = parseColumns(beforeObj.sql);
    const afterCols = parseColumns(afterObj.sql);
    const beforeNames = new Set(beforeCols.map(c => c.name));
    const afterNames = new Set(afterCols.map(c => c.name));

    const added = afterCols.filter(c => !beforeNames.has(c.name));
    const removed = beforeCols.filter(c => !afterNames.has(c.name)).map(c => c.name);

    if (added.length > 0 || removed.length > 0) {
      mods.push({ table: afterObj.name, addedColumns: added, removedColumns: removed });
    }
  }
  return mods;
}
```

### Webview Message Protocol

Webview → Extension:
```typescript
{ command: 'copySql' }
{ command: 'copyDart' }
{ command: 'selectDiff', fromIndex: number, toIndex: number }
```

Extension → Webview:
```typescript
{ command: 'rollback', forward: ISchemaDiff, rollback: IRollback }
{ command: 'schemaVersions', versions: Array<{ index: number; timestamp: number; label: string }> }
{ command: 'error', message: string }
```

## Server-Side Changes

None. Uses existing `schemaDump()` and schema tracker workspace state.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.migrationRollback",
        "title": "Saropa Drift Advisor: Generate Migration Rollback",
        "icon": "$(discard)"
      }
    ]
  }
}
```

## Testing

- `rollback-generator.test.ts`:
  - `CREATE TABLE` → rollback is `DROP TABLE IF EXISTS`
  - `CREATE INDEX` → rollback is `DROP INDEX IF EXISTS`
  - `ALTER TABLE ADD COLUMN` → rollback is `ALTER TABLE DROP COLUMN`
  - `DROP TABLE` → rollback re-creates with original SQL
  - Multiple changes → rollback in reverse order
  - Column removal → warning about manual migration
  - Unique index → rollback drops it correctly
  - Table with same name but different columns → detected as modification
  - Empty diff → empty rollback
  - SQL escaping: table/column names with special chars quoted correctly
  - Dart code escaping: single quotes in SQL escaped
  - `sqlite_` internal objects excluded from diff
  - Schema dump parser handles multi-line CREATE statements
  - Rollback ordering: indexes dropped before tables, tables created before indexes

## Known Limitations

- `ALTER TABLE DROP COLUMN` requires SQLite 3.35.0+ — older Android devices may not support it
- Cannot reverse complex column removals (re-adding with constraints, defaults, FK references)
- Cannot reverse data-only changes (INSERT/UPDATE/DELETE) — schema changes only
- `CREATE TABLE` with complex constraints may not round-trip perfectly through the parser
- Views and triggers with complex bodies may not parse correctly
- No detection of column type changes or constraint changes (only additions/removals)
- Relies on schema tracker having captured the "before" state — if the extension wasn't running during a migration, no diff is available
