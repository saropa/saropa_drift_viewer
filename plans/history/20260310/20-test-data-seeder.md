# Feature 20: Test Data Seeder

## What It Does

Analyze the live schema and generate realistic test data respecting FK relationships. Auto-detects column semantics from names and types (e.g., `email` → email addresses, `user_id` FK → picks from parent table). Output as SQL, JSON, or execute directly. Export generated data as a reusable `.drift-dataset.json` file.

**Prerequisite:** [20a — Data Management](20a-data-management.md) (Reset, Import, Export, Table Groups)

## User Experience

1. Right-click a table → "Seed Test Data…" or command palette → "Saropa Drift Advisor: Seed All Tables"
2. Configuration panel:

```
╔══════════════════════════════════════════════════════════╗
║  TEST DATA SEEDER                                        ║
╠══════════════════════════════════════════════════════════╣
║  Rows per table:  [100]                                  ║
║                                                          ║
║  ▼ users (0 rows)                                       ║
║      id       — INTEGER PK (auto)                        ║
║      name     — TEXT  → Full Name                        ║
║      email    — TEXT  → Email                            ║
║      age      — INTEGER → Age 18-80                      ║
║      active   — INTEGER → Boolean                        ║
║                                                          ║
║  ▼ orders (0 rows)                                      ║
║      id       — INTEGER PK (auto)                        ║
║      user_id  — INTEGER FK→users.id                      ║
║      total    — REAL → Price $1-999                      ║
║      status   — TEXT → Enum pick                         ║
║                                                          ║
║  Output: (●) SQL  ( ) JSON  ( ) Run                     ║
║                                                          ║
║  [Preview]  [Generate]  [Export as Dataset]              ║
╚══════════════════════════════════════════════════════════╝
```

3. User can override the detected generator for each column
4. "Export as Dataset" saves to a `.drift-dataset.json` file for re-importing via Feature 20a

## New Files

```
extension/src/
  seeder/
    seeder-panel.ts           # Webview panel for seed configuration UI
    seeder-html.ts            # HTML template for the config panel
    column-detector.ts        # Detects column semantics from name/type patterns
    data-generator.ts         # Generates fake data per column type
    seed-formatter.ts         # Formats generated data as SQL or JSON
extension/src/test/
  column-detector.test.ts
  data-generator.test.ts
  seed-formatter.test.ts
```

## Dependencies

- `api-client.ts` — `schemaMetadata()`, `tableFkMeta()`, `sql()`
- `data-management/dependency-sorter.ts` (from Feature 20a) — FK-aware insertion order
- `data-management/dataset-export.ts` (from Feature 20a) — save generated data as `.drift-dataset.json`
- `data-management/dataset-types.ts` (from Feature 20a) — `IDriftDataset`, `IFkContext` shared interfaces
- `data-management/seed-formatter.ts` could be shared, but seeder owns it since it also generates SQL

## Architecture

### Column Detector

Maps column names and types to data generators:

```typescript
type GeneratorType =
  | 'auto_increment' | 'uuid'
  | 'full_name' | 'first_name' | 'last_name'
  | 'email' | 'phone' | 'url' | 'ip_address'
  | 'street_address' | 'city' | 'country' | 'zip_code'
  | 'datetime' | 'date' | 'timestamp' | 'past_date' | 'future_date'
  | 'boolean' | 'integer' | 'float' | 'price'
  | 'paragraph' | 'sentence' | 'word'
  | 'enum' | 'fk_reference'
  | 'random_string';

interface IColumnSeederConfig {
  column: string;
  type: string;          // SQL type
  generator: GeneratorType;
  params?: Record<string, unknown>;  // e.g., { min: 18, max: 80 } for age
  nullable: boolean;
  nullProbability: number;  // 0.0 - 1.0
}

class ColumnDetector {
  detect(column: ColumnMetadata, fk?: IFkContext): IColumnSeederConfig {
    const name = column.name.toLowerCase();
    const type = column.type.toUpperCase();

    // PK detection
    if (column.pk) {
      return { ...base, generator: type.includes('TEXT') ? 'uuid' : 'auto_increment' };
    }

    // FK detection
    if (fk) {
      return { ...base, generator: 'fk_reference', params: { table: fk.toTable, column: fk.toColumn } };
    }

    // Name-based patterns
    const patterns: [RegExp, GeneratorType][] = [
      [/^e?mail/, 'email'],
      [/phone|mobile|tel/, 'phone'],
      [/^url|website|link|href/, 'url'],
      [/^ip/, 'ip_address'],
      [/^(full_?)?name$/, 'full_name'],
      [/^first_?name/, 'first_name'],
      [/^last_?name/, 'last_name'],
      [/street|address_?line/, 'street_address'],
      [/^city/, 'city'],
      [/^country/, 'country'],
      [/^zip|postal/, 'zip_code'],
      [/created|updated|deleted|_at$|_date$|timestamp/, 'datetime'],
      [/^(is_|has_|can_|should_|active|enabled|visible|published)/, 'boolean'],
      [/price|cost|amount|total|fee/, 'price'],
      [/^age$/, 'integer'],
      [/^(bio|description|content|body|notes|comment)/, 'paragraph'],
      [/^(title|subject|headline)/, 'sentence'],
    ];

    for (const [regex, gen] of patterns) {
      if (regex.test(name)) return { ...base, generator: gen };
    }

    // Type-based fallback
    if (type.includes('INT')) return { ...base, generator: 'integer' };
    if (type.includes('REAL') || type.includes('FLOAT')) return { ...base, generator: 'float' };
    if (type.includes('TEXT') || type.includes('VARCHAR')) return { ...base, generator: 'random_string' };
    if (type.includes('BOOL')) return { ...base, generator: 'boolean' };

    return { ...base, generator: 'random_string' };
  }
}
```

### Data Generator

Pure functions for each generator type. No external faker library:

```typescript
class DataGenerator {
  private _counter = 0;

  generate(config: IColumnSeederConfig): unknown {
    if (config.nullable && Math.random() < config.nullProbability) return null;

    switch (config.generator) {
      case 'auto_increment': return ++this._counter;
      case 'uuid': return this._uuid();
      case 'full_name': return `${this._pick(FIRST_NAMES)} ${this._pick(LAST_NAMES)}`;
      case 'email': return `${this._pick(FIRST_NAMES).toLowerCase()}${this._randInt(1, 999)}@example.com`;
      case 'phone': return `+1${this._randDigits(10)}`;
      case 'boolean': return Math.random() > 0.5 ? 1 : 0;
      case 'integer': return this._randInt(config.params?.min ?? 0, config.params?.max ?? 10000);
      case 'price': return +(Math.random() * 998 + 1).toFixed(2);
      case 'datetime': return this._randomDate().toISOString();
      case 'paragraph': return this._sentences(3);
      case 'fk_reference': return null; // Resolved later by dependency sorter
      // ...
    }
  }
}

const FIRST_NAMES = ['Alice', 'Bob', 'Carol', 'David', /* ... ~50 */];
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', /* ... ~50 */];
```

### FK-Aware Generation Order

Uses `DependencySorter` from Feature 20a to determine insertion order. FK columns in child tables pick randomly from previously generated parent rows:

```typescript
const generatedIds = new Map<string, unknown[]>();  // table → generated PK values
generatedIds.set('users', [1, 2, 3, ..., 100]);

// When generating "orders.user_id" (FK → users.id):
const parentIds = generatedIds.get('users')!;
const value = parentIds[Math.floor(Math.random() * parentIds.length)];
```

### Seed Formatter

```typescript
class SeedFormatter {
  toSql(tables: Map<string, object[]>): string {
    const lines: string[] = ['-- Generated test data'];
    for (const [table, rows] of tables) {
      lines.push(`\n-- ${table}: ${rows.length} rows`);
      for (const row of rows) {
        const cols = Object.keys(row);
        const vals = cols.map(c => sqlLiteral((row as Record<string, unknown>)[c]));
        lines.push(
          `INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${vals.join(', ')});`
        );
      }
    }
    return lines.join('\n');
  }

  toJson(tables: Map<string, object[]>, name: string): string {
    const dataset: IDriftDataset = {
      $schema: 'drift-dataset/v1',
      name,
      tables: Object.fromEntries(tables),
    };
    return JSON.stringify(dataset, null, 2);
  }
}
```

## Server-Side Changes

None. Uses existing `schemaMetadata()`, `tableFkMeta()`, and `sql()`.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.seedTable",
        "title": "Saropa Drift Advisor: Seed Test Data for Table",
        "icon": "$(beaker)"
      },
      {
        "command": "driftViewer.seedAllTables",
        "title": "Saropa Drift Advisor: Seed All Tables"
      }
    ],
    "menus": {
      "view/item/context": [
        {
          "command": "driftViewer.seedTable",
          "when": "viewItem == driftTable",
          "group": "6_seed"
        }
      ]
    },
    "configuration": {
      "properties": {
        "driftViewer.seeder.defaultRowCount": {
          "type": "number",
          "default": 100,
          "description": "Default number of rows to generate per table."
        },
        "driftViewer.seeder.nullProbability": {
          "type": "number",
          "default": 0.05,
          "description": "Probability of generating NULL for nullable columns (0.0–1.0)."
        }
      }
    }
  }
}
```

## Wiring in extension.ts

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.seedTable', async (item?: TableItem) => {
    const table = item?.tableMetadata.name ?? await pickTable(client);
    if (!table) return;
    SeederPanel.createOrShow(context.extensionUri, client, [table]);
  }),

  vscode.commands.registerCommand('driftViewer.seedAllTables', async () => {
    const meta = await client.schemaMetadata();
    const tables = meta.tables
      .map(t => t.name)
      .filter(n => !n.startsWith('sqlite_'));
    SeederPanel.createOrShow(context.extensionUri, client, tables);
  }),
);
```

## Testing

- `column-detector.test.ts`: pattern matching for all name patterns, FK detection, type fallbacks, unknown columns
- `data-generator.test.ts`: each generator returns valid types, range constraints, null probability
- `seed-formatter.test.ts`: SQL escaping, JSON output with `$schema` field, empty table, NULL values

## Known Limitations

- No external faker library — name/address lists are small (~50 entries each)
- Circular FK dependencies are detected and reported but not resolved (user must break the cycle)
- UNIQUE constraint violations may occur on generated data — retry logic for collisions
- No support for CHECK constraints (generator doesn't know valid value ranges)
- Enum detection is heuristic (looks at existing values if table has data)
- Auto-increment detection assumes INTEGER PK — may not match all Drift patterns
- Generated data is random, not deterministic — no seed value for reproducibility (could add)
- Large table seeding (10k+ rows) may be slow due to row-by-row SQL execution
