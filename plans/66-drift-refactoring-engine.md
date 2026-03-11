# Feature 66: Drift Refactoring Engine

## What It Does

Analyze the live database schema and suggest concrete refactorings: normalize repeated data into lookup tables, split wide tables, merge redundant columns, extract common column groups into shared tables. Each suggestion includes a multi-step migration plan with generated Dart code, data migration SQL, and a before/after schema comparison.

## User Experience

1. Command palette → "Saropa Drift Advisor: Suggest Schema Refactorings"
2. Extension analyzes schema structure, data patterns, and FK relationships
3. Results displayed in a webview with actionable suggestions

```
╔══════════════════════════════════════════════════════════════╗
║  SCHEMA REFACTORING SUGGESTIONS                             ║
║  Analyzed 12 tables, 67 columns                             ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  1. NORMALIZE: orders.status → new status_types table        ║
║     ┌──────────────────────────────────────────────────┐    ║
║     │ orders.status has 4 distinct values across 5,891  │    ║
║     │ rows: "pending", "shipped", "delivered", "failed" │    ║
║     │                                                    │    ║
║     │ Before:                                            │    ║
║     │   orders: id, user_id, total, status (TEXT)        │    ║
║     │                                                    │    ║
║     │ After:                                             │    ║
║     │   order_statuses: id (PK), name (UNIQUE)           │    ║
║     │   orders: id, user_id, total, status_id (FK)       │    ║
║     │                                                    │    ║
║     │ Impact: Saves ~35KB, adds referential integrity    │    ║
║     └──────────────────────────────────────────────────┘    ║
║     [View Migration Plan] [Copy All Code] [Dismiss]          ║
║                                                              ║
║  2. SPLIT: users table has 18 columns                        ║
║     ┌──────────────────────────────────────────────────┐    ║
║     │ Suggest splitting into:                            │    ║
║     │   users: id, email, name, active (core identity)   │    ║
║     │   user_profiles: user_id (FK), bio, avatar_url,    │    ║
║     │                  website, phone, ... (8 columns)   │    ║
║     │                                                    │    ║
║     │ Reason: 8 columns are NULL in >60% of rows         │    ║
║     └──────────────────────────────────────────────────┘    ║
║     [View Migration Plan] [Copy All Code] [Dismiss]          ║
║                                                              ║
║  3. MERGE: audit_log.actor_email duplicates users.email      ║
║     ┌──────────────────────────────────────────────────┐    ║
║     │ 98% of audit_log.actor_email values match a        │    ║
║     │ users.email. Replace with user_id FK.              │    ║
║     └──────────────────────────────────────────────────┘    ║
║     [View Migration Plan] [Copy All Code] [Dismiss]          ║
╚══════════════════════════════════════════════════════════════╝
```

### Migration Plan Detail

```
╔══════════════════════════════════════════════════════════════╗
║  MIGRATION PLAN: Normalize orders.status                     ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Step 1: Create lookup table                                 ║
║  ┌──────────────────────────────────────────────────────┐   ║
║  │ CREATE TABLE "order_statuses" (                       │   ║
║  │   "id" INTEGER PRIMARY KEY AUTOINCREMENT,             │   ║
║  │   "name" TEXT NOT NULL UNIQUE                         │   ║
║  │ );                                                    │   ║
║  └──────────────────────────────────────────────────────┘   ║
║                                                              ║
║  Step 2: Populate lookup table                               ║
║  ┌──────────────────────────────────────────────────────┐   ║
║  │ INSERT INTO "order_statuses" ("name")                 │   ║
║  │ SELECT DISTINCT "status" FROM "orders"                │   ║
║  │ WHERE "status" IS NOT NULL;                           │   ║
║  └──────────────────────────────────────────────────────┘   ║
║                                                              ║
║  Step 3: Add FK column                                       ║
║  ┌──────────────────────────────────────────────────────┐   ║
║  │ ALTER TABLE "orders"                                  │   ║
║  │ ADD COLUMN "status_id" INTEGER                        │   ║
║  │ REFERENCES "order_statuses"("id");                    │   ║
║  └──────────────────────────────────────────────────────┘   ║
║                                                              ║
║  Step 4: Migrate data                                        ║
║  ┌──────────────────────────────────────────────────────┐   ║
║  │ UPDATE "orders" SET "status_id" = (                   │   ║
║  │   SELECT "id" FROM "order_statuses"                   │   ║
║  │   WHERE "name" = "orders"."status"                    │   ║
║  │ );                                                    │   ║
║  └──────────────────────────────────────────────────────┘   ║
║                                                              ║
║  Step 5: Drop old column                                     ║
║  ┌──────────────────────────────────────────────────────┐   ║
║  │ ALTER TABLE "orders" DROP COLUMN "status";            │   ║
║  └──────────────────────────────────────────────────────┘   ║
║                                                              ║
║  [Copy SQL] [Copy Dart Migration] [Copy Drift Table Class]   ║
╚══════════════════════════════════════════════════════════════╝
```

## New Files

```
extension/src/refactoring/
  refactoring-analyzer.ts      # Schema analysis + suggestion detection
  refactoring-plan-builder.ts  # Multi-step migration plan generation
  refactoring-panel.ts         # Webview panel
  refactoring-html.ts          # HTML template
  refactoring-types.ts         # Interfaces
extension/src/test/
  refactoring-analyzer.test.ts
  refactoring-plan-builder.test.ts
```

## Modified Files

```
extension/src/extension.ts    # Register command
extension/package.json         # Command
```

## Dependencies

- `api-client.ts` — `schemaMetadata()`, `tableFkMeta()`, `sql()`, `schemaDump()`
- Column profiler data (Feature 29) — null percentages, distinct value counts

## Architecture

### Refactoring Analyzer

Detects refactoring opportunities from schema and data analysis:

```typescript
interface IRefactoringSuggestion {
  type: 'normalize' | 'split' | 'merge' | 'extract';
  title: string;
  description: string;
  tables: string[];
  columns: string[];
  impact: {
    spaceSaved?: number;
    integrityImproved: boolean;
    queryComplexity: 'simpler' | 'same' | 'more-complex';
  };
  confidence: number;  // 0-1, how confident the suggestion is
}

class RefactoringAnalyzer {
  constructor(private readonly _client: DriftApiClient) {}

  async analyze(): Promise<IRefactoringSuggestion[]> {
    const suggestions: IRefactoringSuggestion[] = [];
    const meta = await this._client.schemaMetadata();
    const tables = meta.filter(t => !t.name.startsWith('sqlite_'));

    suggestions.push(...await this._detectNormalization(tables));
    suggestions.push(...this._detectWideTables(tables));
    suggestions.push(...await this._detectDuplicateColumns(tables));
    suggestions.push(...this._detectCommonColumnGroups(tables));

    return suggestions.filter(s => s.confidence > 0.5)
      .sort((a, b) => b.confidence - a.confidence);
  }

  private async _detectNormalization(tables: TableMetadata[]): Promise<IRefactoringSuggestion[]> {
    const suggestions: IRefactoringSuggestion[] = [];

    for (const table of tables) {
      const textCols = table.columns.filter(c =>
        c.type.toUpperCase().includes('TEXT') && !c.pk
      );

      for (const col of textCols) {
        // Check distinct value count vs row count
        const result = await this._client.sql(
          `SELECT COUNT(DISTINCT "${col.name}") as distinct_count, COUNT(*) as total FROM "${table.name}" WHERE "${col.name}" IS NOT NULL`
        );
        const row = result.rows[0] as Record<string, number>;
        const ratio = row.distinct_count / Math.max(row.total, 1);

        // Low cardinality TEXT column → normalization candidate
        if (row.distinct_count <= 20 && row.total > 50 && ratio < 0.1) {
          suggestions.push({
            type: 'normalize',
            title: `Normalize ${table.name}.${col.name}`,
            description: `${col.name} has ${row.distinct_count} distinct values across ${row.total} rows. Extract to a lookup table with FK.`,
            tables: [table.name],
            columns: [col.name],
            impact: {
              integrityImproved: true,
              queryComplexity: 'more-complex',
            },
            confidence: ratio < 0.01 ? 0.9 : 0.7,
          });
        }
      }
    }

    return suggestions;
  }

  private _detectWideTables(tables: TableMetadata[]): IRefactoringSuggestion[] {
    return tables
      .filter(t => t.columns.length > 12)
      .map(table => {
        // Group columns: PK + FK columns stay, others are candidates for split
        const core = table.columns.filter(c => c.pk);
        const optional = table.columns.filter(c => !c.pk);

        return {
          type: 'split' as const,
          title: `Split ${table.name} (${table.columns.length} columns)`,
          description: `Table has ${table.columns.length} columns. Consider splitting into a core table and a profile/details table.`,
          tables: [table.name],
          columns: optional.map(c => c.name),
          impact: {
            integrityImproved: false,
            queryComplexity: 'more-complex',
          },
          confidence: table.columns.length > 20 ? 0.8 : 0.6,
        };
      });
  }

  private async _detectDuplicateColumns(tables: TableMetadata[]): Promise<IRefactoringSuggestion[]> {
    const suggestions: IRefactoringSuggestion[] = [];

    // Find columns with same name across tables that aren't FK-linked
    for (let i = 0; i < tables.length; i++) {
      for (let j = i + 1; j < tables.length; j++) {
        const fksI = await this._client.tableFkMeta(tables[i].name);
        const fksJ = await this._client.tableFkMeta(tables[j].name);

        for (const colI of tables[i].columns) {
          const colJ = tables[j].columns.find(c => c.name === colI.name && !c.pk);
          if (!colJ || colI.pk) continue;

          // Check if already FK-linked
          const linked = fksI.some(fk => fk.fromColumn === colI.name && fk.toTable === tables[j].name) ||
                         fksJ.some(fk => fk.fromColumn === colJ.name && fk.toTable === tables[i].name);
          if (linked) continue;

          // Check data overlap
          const overlap = await this._client.sql(
            `SELECT COUNT(*) as cnt FROM "${tables[i].name}" a INNER JOIN "${tables[j].name}" b ON a."${colI.name}" = b."${colJ.name}"`
          );
          const count = (overlap.rows[0] as Record<string, number>).cnt;
          if (count > 0) {
            suggestions.push({
              type: 'merge',
              title: `Merge: ${tables[i].name}.${colI.name} ↔ ${tables[j].name}.${colJ.name}`,
              description: `${count} rows have matching values. Consider replacing with an FK relationship.`,
              tables: [tables[i].name, tables[j].name],
              columns: [colI.name],
              impact: { integrityImproved: true, queryComplexity: 'same' },
              confidence: 0.6,
            });
          }
        }
      }
    }

    return suggestions;
  }
}
```

### Migration Plan Builder

Generates step-by-step migration code for each suggestion:

```typescript
interface IMigrationPlan {
  steps: IMigrationStep[];
  dartCode: string;
  driftTableClass: string;
}

interface IMigrationStep {
  title: string;
  description: string;
  sql: string;
  reversible: boolean;
}

class MigrationPlanBuilder {
  buildNormalizationPlan(
    table: string,
    column: string,
    newTable: string,
  ): IMigrationPlan {
    const steps: IMigrationStep[] = [
      {
        title: 'Create lookup table',
        description: `New table "${newTable}" for distinct ${column} values`,
        sql: `CREATE TABLE "${newTable}" (\n  "id" INTEGER PRIMARY KEY AUTOINCREMENT,\n  "name" TEXT NOT NULL UNIQUE\n);`,
        reversible: true,
      },
      {
        title: 'Populate lookup table',
        description: `Insert distinct values from ${table}.${column}`,
        sql: `INSERT INTO "${newTable}" ("name")\nSELECT DISTINCT "${column}" FROM "${table}"\nWHERE "${column}" IS NOT NULL;`,
        reversible: true,
      },
      {
        title: 'Add FK column',
        description: `Add ${column}_id referencing ${newTable}`,
        sql: `ALTER TABLE "${table}"\nADD COLUMN "${column}_id" INTEGER\nREFERENCES "${newTable}"("id");`,
        reversible: true,
      },
      {
        title: 'Migrate data',
        description: `Set FK values from existing text values`,
        sql: `UPDATE "${table}" SET "${column}_id" = (\n  SELECT "id" FROM "${newTable}"\n  WHERE "name" = "${table}"."${column}"\n);`,
        reversible: false,
      },
      {
        title: 'Drop old column',
        description: `Remove the denormalized text column`,
        sql: `ALTER TABLE "${table}" DROP COLUMN "${column}";`,
        reversible: false,
      },
    ];

    const dartCode = this._generateDartMigration(steps);
    const driftTableClass = this._generateDriftTable(newTable, [
      { name: 'id', type: 'IntColumn', pk: true },
      { name: 'name', type: 'TextColumn', unique: true },
    ]);

    return { steps, dartCode, driftTableClass };
  }

  private _generateDartMigration(steps: IMigrationStep[]): string {
    const statements = steps.map(s =>
      `    // ${s.title}\n    await customStatement(\n      '${s.sql.replace(/\n/g, "\\n").replace(/'/g, "\\'")}',\n    );`
    ).join('\n\n');

    return `onUpgrade: (m, from, to) async {\n${statements}\n}`;
  }

  private _generateDriftTable(name: string, columns: Array<{ name: string; type: string; pk?: boolean; unique?: boolean }>): string {
    const cols = columns.map(c => {
      let def = `  ${c.type} get ${c.name}`;
      if (c.pk) def += ' => integer().autoIncrement()()';
      else if (c.unique) def += ' => text().unique()()';
      else def += ' => text()()';
      return def + ';';
    }).join('\n');

    return `class ${pascalCase(name)} extends Table {\n${cols}\n}`;
  }
}
```

### Webview Message Protocol

Webview → Extension:
```typescript
{ command: 'analyze' }
{ command: 'viewPlan', suggestionIndex: number }
{ command: 'copySql', suggestionIndex: number }
{ command: 'copyDart', suggestionIndex: number }
{ command: 'copyDriftTable', suggestionIndex: number }
{ command: 'dismiss', suggestionIndex: number }
```

Extension → Webview:
```typescript
{ command: 'analyzing', tableCount: number }
{ command: 'suggestions', suggestions: IRefactoringSuggestion[] }
{ command: 'plan', plan: IMigrationPlan, suggestion: IRefactoringSuggestion }
{ command: 'error', message: string }
```

## Server-Side Changes

None. Uses existing schema, FK, and SQL endpoints.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.suggestRefactorings",
        "title": "Saropa Drift Advisor: Suggest Schema Refactorings",
        "icon": "$(wrench)"
      }
    ]
  }
}
```

## Testing

- `refactoring-analyzer.test.ts`:
  - Low-cardinality TEXT column (5 values, 1000 rows) → normalize suggestion
  - High-cardinality TEXT column (500 values, 1000 rows) → no suggestion
  - Wide table (20 columns) → split suggestion
  - Narrow table (5 columns) → no split suggestion
  - Duplicate column values across tables without FK → merge suggestion
  - Duplicate column with existing FK → no suggestion
  - `sqlite_` tables excluded
  - Empty table → no suggestions
  - Confidence threshold: suggestions below 0.5 filtered out
  - Results sorted by confidence descending

- `refactoring-plan-builder.test.ts`:
  - Normalization plan: 5 steps in correct order
  - Step SQL is valid (parseable)
  - Dart migration code contains all steps
  - Drift table class is valid Dart syntax
  - Table/column names with special chars properly quoted
  - Split plan generates correct FK between new tables
  - Merge plan generates correct UPDATE + DROP statements

## Known Limitations

- Analysis requires querying data (DISTINCT counts, JOINs) — slow on large databases
- Split suggestions are heuristic (column count threshold) — no analysis of query patterns to determine optimal grouping
- Merge detection via data overlap can produce false positives (coincidental value matches)
- Generated migration code is a starting point — complex schemas may need manual adjustment
- No support for detecting enum-like INTEGER columns (only TEXT columns checked for normalization)
- SQLite `ALTER TABLE DROP COLUMN` requires 3.35.0+ — may not work on older Android
- Common column group extraction (address fields, audit fields) not yet implemented
- Only single-column FKs supported in generated code
