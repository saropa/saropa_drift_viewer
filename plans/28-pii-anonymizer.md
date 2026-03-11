# Feature 28: Data Masking / PII Anonymizer

## What It Does

One-click anonymize sensitive data in the debug database. Auto-detect PII columns (email, name, phone, SSN, address) via column name patterns and replace with realistic fakes while preserving referential integrity and data distribution shape. Export the anonymized data as SQL, JSON, or a portable report.

## User Experience

1. Command palette → "Saropa Drift Advisor: Anonymize Database" or right-click snapshot → "Export Anonymized"
2. A configuration panel opens showing detected PII columns:

```
╔═══════════════════════════════════════════════════════════╗
║  PII ANONYMIZER                                           ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  Detected PII columns:                                    ║
║                                                           ║
║  ▼ users (1,250 rows)                                    ║
║    ☑ name        TEXT   → Full Name      "Alice Smith"   ║
║    ☑ email       TEXT   → Email          "user42@x.com"  ║
║    ☑ phone       TEXT   → Phone          "+1555…"        ║
║    ☐ role        TEXT   (not PII)                         ║
║    ☐ created_at  TEXT   (not PII)                         ║
║                                                           ║
║  ▼ orders (3,400 rows)                                   ║
║    ☐ id          INT    (not PII)                         ║
║    ☑ shipping_address TEXT → Address   "123 Main St…"    ║
║    ☐ total       REAL   (not PII)                         ║
║                                                           ║
║  ▼ payments (890 rows)                                   ║
║    ☑ card_last4  TEXT   → Redacted       "****"          ║
║    ☑ billing_name TEXT  → Full Name      "Bob Jones"     ║
║                                                           ║
║  Options:                                                 ║
║    ☑ Preserve referential integrity (same input → same   ║
║      output across tables)                                ║
║    ☑ Preserve NULL values                                ║
║    ☐ Preserve data distribution (match length/format)    ║
║                                                           ║
║  Output: (●) SQL  ( ) JSON  ( ) Portable Report         ║
║                                                           ║
║  [Preview 5 Rows]  [Anonymize All]                       ║
╚═══════════════════════════════════════════════════════════╝
```

3. User reviews detected columns, toggles any false positives/negatives
4. Click "Preview" → see 5 sample rows with original vs anonymized side by side
5. Click "Anonymize All" → generates output in chosen format
6. SQL output opens in editor tab; JSON saves to file; Portable Report opens in browser

## New Files

```
extension/src/
  anonymizer/
    anonymizer-panel.ts         # Webview panel for configuration UI
    anonymizer-html.ts          # HTML/CSS/JS template
    pii-detector.ts             # Detects PII columns from name/type/sample data
    anonymizer-engine.ts        # Generates fake replacements with consistency
    anonymizer-formatter.ts     # Formats anonymized data as SQL/JSON
extension/src/test/
  pii-detector.test.ts
  anonymizer-engine.test.ts
  anonymizer-formatter.test.ts
```

## Dependencies

- `api-client.ts` — `schemaMetadata()`, `tableFkMeta()`, `sql()` for data reading
- `data-management/dependency-sorter.ts` (from Feature 20a) — FK-ordered export to maintain referential integrity
- `data-management/dataset-export.ts` (from Feature 20a) — export anonymized data as `.drift-dataset.json`
- `data-management/dataset-types.ts` (from Feature 20a) — `IDriftDataset`, `IFkContext` shared interfaces
- Reuses column name pattern logic from Feature 20 (Test Data Seeder) `column-detector.ts`

## Architecture

### PII Detector

Detects sensitive columns by name pattern, type, and optionally by sampling actual values:

```typescript
type PiiCategory =
  | 'full_name' | 'first_name' | 'last_name'
  | 'email' | 'phone' | 'ssn' | 'credit_card'
  | 'street_address' | 'city' | 'zip_code' | 'country'
  | 'ip_address' | 'url' | 'username' | 'password_hash'
  | 'date_of_birth' | 'custom';

interface IPiiColumn {
  table: string;
  column: string;
  category: PiiCategory;
  confidence: 'high' | 'medium' | 'low';
  sampleValue?: string;
  enabled: boolean;          // user can toggle
}

class PiiDetector {
  private static readonly NAME_PATTERNS: [RegExp, PiiCategory, 'high' | 'medium'][] = [
    [/^e?mail(_address)?$/, 'email', 'high'],
    [/^(full_?)?name$/, 'full_name', 'high'],
    [/^first_?name$/, 'first_name', 'high'],
    [/^last_?name$/, 'last_name', 'high'],
    [/^phone(_number)?$|^mobile$|^tel$/, 'phone', 'high'],
    [/^ssn$|^social_security/, 'ssn', 'high'],
    [/^card_?(number|num|last4)/, 'credit_card', 'high'],
    [/^(street_?)?address(_line)?/, 'street_address', 'high'],
    [/^city$/, 'city', 'medium'],
    [/^zip(_?code)?$|^postal/, 'zip_code', 'medium'],
    [/^country$/, 'country', 'medium'],
    [/^ip(_address)?$/, 'ip_address', 'medium'],
    [/^user_?name$|^login$/, 'username', 'medium'],
    [/^password|^pwd|^pass_hash/, 'password_hash', 'high'],
    [/^(date_of_)?birth|^dob$/, 'date_of_birth', 'high'],
  ];

  detect(
    tables: TableMetadata[],
    sampleData?: Map<string, Record<string, unknown>[]>,
  ): IPiiColumn[] {
    const results: IPiiColumn[] = [];

    for (const table of tables) {
      for (const col of table.columns) {
        if (col.pk) continue; // Never anonymize PKs

        const nameMatch = this._matchByName(col.name);
        if (nameMatch) {
          const sample = sampleData?.get(table.name)?.[0]?.[col.name];
          results.push({
            table: table.name,
            column: col.name,
            category: nameMatch.category,
            confidence: nameMatch.confidence,
            sampleValue: sample != null ? String(sample) : undefined,
            enabled: nameMatch.confidence === 'high',
          });
          continue;
        }

        // Value-based detection (if sample data provided)
        if (sampleData && col.type.toUpperCase().includes('TEXT')) {
          const values = sampleData.get(table.name)
            ?.map(r => r[col.name])
            .filter(v => typeof v === 'string') as string[] | undefined;
          const valueMatch = this._matchByValue(values ?? []);
          if (valueMatch) {
            results.push({
              table: table.name,
              column: col.name,
              category: valueMatch,
              confidence: 'low',
              sampleValue: values?.[0],
              enabled: false, // low confidence = off by default
            });
          }
        }
      }
    }

    return results;
  }

  private _matchByValue(values: string[]): PiiCategory | null {
    if (values.length === 0) return null;
    const sample = values.slice(0, 20);

    // Email pattern
    if (sample.every(v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) return 'email';

    // Phone pattern (various formats)
    if (sample.every(v => /^[\d\s\-\+\(\)]{7,20}$/.test(v))) return 'phone';

    // IP address
    if (sample.every(v => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v))) return 'ip_address';

    return null;
  }
}
```

### Anonymizer Engine

Generates consistent fake replacements — same input value always maps to the same output (preserves referential integrity across tables):

```typescript
class AnonymizerEngine {
  private _mappings = new Map<string, Map<string, unknown>>();
  // Key: "category:originalValue" → fakeValue

  anonymize(
    category: PiiCategory,
    originalValue: unknown,
    preserveDistribution: boolean,
  ): unknown {
    if (originalValue === null || originalValue === undefined) return null;

    const key = `${category}:${String(originalValue)}`;

    // Check consistency cache
    const cached = this._getMapping(key);
    if (cached !== undefined) return cached;

    // Generate new fake
    const fake = this._generate(category, originalValue, preserveDistribution);
    this._setMapping(key, fake);
    return fake;
  }

  private _generate(
    category: PiiCategory,
    original: unknown,
    preserveDistribution: boolean,
  ): unknown {
    const str = String(original);

    switch (category) {
      case 'email': {
        const id = this._nextId('email');
        return `user${id}@example.com`;
      }
      case 'full_name': {
        const first = FIRST_NAMES[this._nextId('fname') % FIRST_NAMES.length];
        const last = LAST_NAMES[this._nextId('lname') % LAST_NAMES.length];
        return `${first} ${last}`;
      }
      case 'first_name':
        return FIRST_NAMES[this._nextId('fname') % FIRST_NAMES.length];
      case 'last_name':
        return LAST_NAMES[this._nextId('lname') % LAST_NAMES.length];
      case 'phone':
        return `+1555${this._randomDigits(7)}`;
      case 'ssn':
        return `***-**-${this._randomDigits(4)}`;
      case 'credit_card':
        return `****${this._randomDigits(4)}`;
      case 'street_address': {
        const num = 100 + this._nextId('addr');
        return `${num} ${STREET_NAMES[this._nextId('street') % STREET_NAMES.length]}`;
      }
      case 'city':
        return CITIES[this._nextId('city') % CITIES.length];
      case 'zip_code':
        return this._randomDigits(5);
      case 'ip_address':
        return `10.0.${this._rand(0, 255)}.${this._rand(1, 254)}`;
      case 'username': {
        const id = this._nextId('user');
        return `user_${id}`;
      }
      case 'password_hash':
        return '[REDACTED]';
      case 'date_of_birth':
        return `${this._rand(1950, 2005)}-${this._pad(this._rand(1, 12))}-${this._pad(this._rand(1, 28))}`;
      case 'country':
        return COUNTRIES[this._nextId('country') % COUNTRIES.length];
      default:
        // Preserve length if distribution mode, otherwise generic
        return preserveDistribution
          ? 'x'.repeat(str.length)
          : '[ANONYMIZED]';
    }
  }

  private _counters = new Map<string, number>();
  private _nextId(ns: string): number {
    const n = (this._counters.get(ns) ?? 0) + 1;
    this._counters.set(ns, n);
    return n;
  }
}
```

### Anonymizer Formatter

Outputs the anonymized data in the chosen format:

```typescript
class AnonymizerFormatter {
  toSql(
    originalTables: Map<string, Record<string, unknown>[]>,
    anonymizedTables: Map<string, Record<string, unknown>[]>,
    piiColumns: IPiiColumn[],
  ): string {
    const lines: string[] = [
      '-- Anonymized database export',
      `-- Generated: ${new Date().toISOString()}`,
      `-- PII columns anonymized: ${piiColumns.filter(c => c.enabled).length}`,
      '',
    ];

    for (const [table, rows] of anonymizedTables) {
      const affected = piiColumns
        .filter(c => c.table === table && c.enabled)
        .map(c => c.column);
      lines.push(`-- ${table}: ${rows.length} rows (anonymized: ${affected.join(', ') || 'none'})`);

      for (const row of rows) {
        const cols = Object.keys(row);
        const vals = cols.map(c => sqlLiteral(row[c]));
        lines.push(
          `INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${vals.join(', ')});`
        );
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  toJson(anonymizedTables: Map<string, Record<string, unknown>[]>): string {
    return JSON.stringify(Object.fromEntries(anonymizedTables), null, 2);
  }
}
```

### Data Flow

```
schemaMetadata() + sql("SELECT * FROM t LIMIT 5")
    │
    ▼
PiiDetector.detect(tables, sampleData)
    │
    ▼
User reviews/toggles PII columns in panel
    │
    ▼
sql("SELECT * FROM t")  for each selected table
    │
    ▼
AnonymizerEngine.anonymize(category, value)  per PII cell
    │ (consistent mapping: same input → same output)
    ▼
AnonymizerFormatter.toSql() / toJson()
    │
    ▼
Output in editor tab or file
```

## Server-Side Changes

None. Uses existing `schemaMetadata()`, `tableFkMeta()`, and `sql()` endpoints. All anonymization runs extension-side.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.anonymizeDatabase",
        "title": "Saropa Drift Advisor: Anonymize Database",
        "icon": "$(shield)"
      }
    ],
    "menus": {
      "view/title": [{
        "command": "driftViewer.anonymizeDatabase",
        "when": "view == driftViewer.databaseExplorer && driftViewer.serverConnected",
        "group": "navigation"
      }]
    },
    "configuration": {
      "properties": {
        "driftViewer.anonymizer.preserveReferentialIntegrity": {
          "type": "boolean",
          "default": true,
          "description": "Ensure the same original value always maps to the same anonymized value across all tables."
        },
        "driftViewer.anonymizer.preserveNulls": {
          "type": "boolean",
          "default": true,
          "description": "Keep NULL values as NULL (do not replace with fake data)."
        },
        "driftViewer.anonymizer.maxRowsPerTable": {
          "type": "number",
          "default": 5000,
          "description": "Maximum rows per table to anonymize."
        }
      }
    }
  }
}
```

## Wiring in extension.ts

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.anonymizeDatabase', async () => {
    const meta = await client.schemaMetadata();
    const tables = meta.tables.filter(t => !t.name.startsWith('sqlite_'));

    // Sample first 5 rows for PII detection
    const sampleData = new Map<string, Record<string, unknown>[]>();
    for (const t of tables) {
      const result = await client.sql(`SELECT * FROM "${t.name}" LIMIT 5`);
      sampleData.set(t.name, result.rows);
    }

    const detector = new PiiDetector();
    const piiColumns = detector.detect(tables, sampleData);

    if (piiColumns.length === 0) {
      vscode.window.showInformationMessage('No PII columns detected.');
      return;
    }

    AnonymizerPanel.createOrShow(context.extensionUri, client, piiColumns, tables);
  })
);
```

## Testing

- `pii-detector.test.ts`:
  - Detects all name patterns (email, name, phone, ssn, etc.)
  - Skips PK columns
  - Value-based detection for email/phone/IP patterns
  - Confidence levels are correct (high for strong matches, low for value-only)
  - Returns empty for tables with no PII columns
- `anonymizer-engine.test.ts`:
  - Same input → same output (consistency)
  - Different inputs → different outputs
  - NULL preservation
  - Each category generates valid-looking data (email has @, phone has digits, etc.)
  - Cross-table consistency (email in users and orders maps the same)
- `anonymizer-formatter.test.ts`:
  - SQL output has valid INSERT statements
  - JSON output is valid JSON
  - SQL escaping handles quotes and special characters
  - Comment header includes timestamp and PII column count

## Known Limitations

- Name-based detection only — columns named `data` or `notes` containing PII won't be detected
- Value-based detection requires at least 5 sample rows of consistent format
- No support for PII embedded in JSON columns or free-text fields
- Anonymization is one-way — no "de-anonymize" capability
- Large tables (10k+ rows) may take noticeable time to process extension-side
- Consistency map is in-memory — anonymizing the same database twice produces different results
- No support for preserving statistical distribution of numeric PII (e.g., age ranges)
- Generated fake data uses small built-in lists (~50 names) — may have collisions on large datasets
- BLOB columns are skipped entirely
