# Feature 55: Clipboard Import

## What It Does

Paste tabular data from the clipboard directly into a database table. Supports data copied from Excel, Google Sheets, HTML tables, and TSV/CSV text. Detects the format automatically, shows a preview with column mapping, and imports the data.

## User Experience

1. Copy rows from Excel, Google Sheets, or any spreadsheet
2. Right-click a table in the tree → "Paste from Clipboard"
3. Preview shows parsed data with auto-detected column mapping
4. Select import strategy (insert/upsert/skip conflicts/dry run)
5. Click "Validate" → see validation errors and warnings
6. Fix or skip invalid rows
7. Optionally run dry run to preview exact changes
8. Confirm → data imported in a transaction
9. If errors occur, transaction rolls back automatically
10. Import logged to history for undo capability

```
╔══════════════════════════════════════════════════════════════╗
║  PASTE INTO: users                                           ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Detected: 3 rows, 4 columns (tab-separated)                ║
║                                                              ║
║  ┌─ Import Strategy ───────────────────────────────────────┐ ║
║  │ ○ Insert only        ○ Skip conflicts                   │ ║
║  │ ● Upsert             ○ Dry run                          │ ║
║  │                                                         │ ║
║  │ Match existing rows by: [id (Primary Key) ▼]            │ ║
║  │ ☐ Continue on error (import valid rows only)            │ ║
║  └─────────────────────────────────────────────────────────┘ ║
║                                                              ║
║  Column Mapping:                                             ║
║  ┌─────────────────┬──────────────────┬───────────────────┐ ║
║  │ Clipboard Col    │ → Table Col      │ Sample            │ ║
║  ├─────────────────┼──────────────────┼───────────────────┤ ║
║  │ Name             │ [name ▼]         │ Alice             │ ║
║  │ Email            │ [email ▼]        │ alice@example.com │ ║
║  │ Active           │ [active ▼]       │ 1                 │ ║
║  │ Notes            │ [(skip) ▼]       │ test account      │ ║
║  └─────────────────┴──────────────────┴───────────────────┘ ║
║                                                              ║
║  Preview:                                                    ║
║  │ name  │ email             │ active │ status │            ║
║  │ Alice │ alice@example.com │ 1      │ ✓      │            ║
║  │ Bob   │ bob@example.com   │ 1      │ ✓      │            ║
║  │ Carol │ carol@test.com    │ 0      │ ⚠ FK   │            ║
║                                                              ║
║  [Cancel]         [Validate]         [Import 3 rows]         ║
╚══════════════════════════════════════════════════════════════╝
```

## New Files

```
extension/src/import/
  clipboard-parser.ts       # Parse clipboard text into rows
  clipboard-import-panel.ts # Webview for preview + column mapping
  clipboard-import-html.ts  # HTML template
  import-validator.ts       # Pre-import validation logic
  import-executor.ts        # Transaction-wrapped import execution
  import-history.ts         # Import tracking and undo support
  schema-freshness.ts       # Schema version checking
extension/src/test/
  clipboard-parser.test.ts
  import-validator.test.ts
  import-executor.test.ts
```

## Modified Files

```
extension/src/extension.ts    # Register command
extension/package.json         # Command + context menu
```

## Dependencies

- `api-client.ts` — `schemaMetadata()`, `importData()`, `beginTransaction()`, `findByKey()`
- `vscode.env.clipboard` — read clipboard text
- `crypto` — UUID generation for import IDs, schema version hashing
- `schema-intelligence.ts` — column metadata, FK relationships

## Architecture

### Clipboard Parser

Detects format and parses into a uniform structure:

```typescript
interface IParsedClipboard {
  format: 'tsv' | 'csv' | 'html';
  headers: string[];
  rows: string[][];
  rawText: string;
}

class ClipboardParser {
  parse(text: string): IParsedClipboard {
    // Try HTML table first (from Excel/Sheets rich copy)
    if (text.includes('<table') || text.includes('<tr')) {
      return this._parseHtml(text);
    }

    // Detect delimiter: tabs (Excel/Sheets plain), commas (CSV)
    const firstLine = text.split('\n')[0];
    const tabCount = (firstLine.match(/\t/g) ?? []).length;
    const commaCount = (firstLine.match(/,/g) ?? []).length;

    if (tabCount > 0 && tabCount >= commaCount) {
      return this._parseTsv(text);
    }
    return this._parseCsv(text);
  }

  private _parseTsv(text: string): IParsedClipboard {
    const lines = text.trim().split('\n').map(l => l.split('\t'));
    return {
      format: 'tsv',
      headers: lines[0],
      rows: lines.slice(1),
      rawText: text,
    };
  }

  private _parseCsv(text: string): IParsedClipboard {
    const lines = this._parseCsvLines(text);
    return {
      format: 'csv',
      headers: lines[0],
      rows: lines.slice(1),
      rawText: text,
    };
  }

  private _parseHtml(text: string): IParsedClipboard {
    // Extract rows from <tr>/<td> tags using regex (no DOM in extension)
    const rows: string[][] = [];
    const trRegex = /<tr[^>]*>(.*?)<\/tr>/gis;
    let match: RegExpExecArray | null;
    while ((match = trRegex.exec(text)) !== null) {
      const cells: string[] = [];
      const tdRegex = /<t[dh][^>]*>(.*?)<\/t[dh]>/gis;
      let cell: RegExpExecArray | null;
      while ((cell = tdRegex.exec(match[1])) !== null) {
        cells.push(cell[1].replace(/<[^>]*>/g, '').trim());
      }
      if (cells.length > 0) rows.push(cells);
    }

    return {
      format: 'html',
      headers: rows[0] ?? [],
      rows: rows.slice(1),
      rawText: text,
    };
  }

  private _parseCsvLines(text: string): string[][] {
    // RFC 4180 compliant: handle quoted fields with embedded commas/newlines
    const rows: string[][] = [];
    let current: string[] = [];
    let field = '';
    let inQuote = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuote) {
        if (ch === '"' && text[i + 1] === '"') {
          field += '"';
          i++;
        } else if (ch === '"') {
          inQuote = false;
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuote = true;
      } else if (ch === ',') {
        current.push(field);
        field = '';
      } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        current.push(field);
        field = '';
        rows.push(current);
        current = [];
        if (ch === '\r') i++;
      } else {
        field += ch;
      }
    }
    if (field || current.length > 0) {
      current.push(field);
      rows.push(current);
    }
    return rows;
  }
}
```

### Column Mapping

Auto-maps clipboard headers to table columns by name similarity:

```typescript
interface IColumnMapping {
  clipboardIndex: number;
  clipboardHeader: string;
  tableColumn: string | null;  // null = skip this column
}

function autoMapColumns(
  clipboardHeaders: string[],
  tableColumns: string[],
): IColumnMapping[] {
  return clipboardHeaders.map((header, i) => {
    const lower = header.toLowerCase().replace(/[_\s-]/g, '');
    const match = tableColumns.find(col =>
      col.toLowerCase().replace(/[_\s-]/g, '') === lower
    );
    return {
      clipboardIndex: i,
      clipboardHeader: header,
      tableColumn: match ?? null,
    };
  });
}
```

### Import Execution

After user confirms mapping, convert to JSON and use existing import endpoint:

```typescript
function buildImportPayload(
  parsed: IParsedClipboard,
  mapping: IColumnMapping[],
): Record<string, unknown>[] {
  const activeMappings = mapping.filter(m => m.tableColumn !== null);
  return parsed.rows.map(row => {
    const record: Record<string, unknown> = {};
    for (const m of activeMappings) {
      record[m.tableColumn!] = row[m.clipboardIndex] ?? null;
    }
    return record;
  });
}
```

### Webview Message Protocol

Webview → Extension:
```typescript
{ command: 'import', mapping: IColumnMapping[] }
{ command: 'cancel' }
{ command: 'updateMapping', index: number, tableColumn: string | null }
```

Extension → Webview:
```typescript
{ command: 'preview', parsed: IParsedClipboard, mapping: IColumnMapping[], tableColumns: string[] }
{ command: 'imported', count: number }
{ command: 'error', message: string }
```

## Server-Side Changes

None. Uses existing `importData()` endpoint with JSON format.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.clipboardImport",
        "title": "Paste from Clipboard",
        "icon": "$(clippy)"
      }
    ],
    "menus": {
      "view/item/context": [
        {
          "command": "driftViewer.clipboardImport",
          "when": "viewItem == driftTable || viewItem == driftTablePinned",
          "group": "6_data"
        }
      ]
    }
  }
}
```

## Testing

### clipboard-parser.test.ts

- TSV: tab-separated rows parsed correctly
- CSV: comma-separated with quoted fields containing commas
- CSV: quoted fields with embedded newlines
- CSV: escaped quotes (`""`) handled
- HTML table: `<table>/<tr>/<td>` extracted correctly
- HTML: nested tags inside cells stripped
- Auto-detect: tabs → TSV, commas → CSV, `<table>` → HTML
- Single row (header only) → empty rows array
- Empty clipboard → error
- Column auto-mapping: exact match, case-insensitive, underscore-insensitive
- Column auto-mapping: no match → mapped to null (skip)
- Import payload builds correct JSON from mapping
- Skipped columns excluded from payload
- Trailing empty rows/cells trimmed

### import-validator.test.ts

- NOT NULL violation detected for null values
- Type mismatch detected (string in integer column)
- Foreign key missing detected
- Unique constraint violation detected for duplicates
- Valid rows pass validation
- Multiple errors per row accumulated
- Warnings issued for type coercion
- Empty import → validation error
- All rows invalid → blocks import

### import-executor.test.ts

- Insert strategy: all rows inserted
- Insert strategy: fails on duplicate, rolls back all
- Insert-skip-conflicts: skips existing, inserts new
- Upsert: inserts new rows
- Upsert: updates existing rows, captures previous values
- Transaction rollback on error (continueOnError=false)
- Partial success with continueOnError=true
- Inserted IDs captured for undo
- Updated rows with previous values captured for undo
- Dry run: correct counts without database changes
- Dry run: diff preview shows column changes
- Schema freshness: detects column additions
- Schema freshness: detects column removals
- Schema freshness: detects type changes
- Undo: deletes inserted rows
- Undo: restores updated rows to previous values
- Undo blocked after subsequent modifications
- Large import (1000+ rows) completes in transaction

## Integration Points

### Shared Services Used

| Service | Usage |
|---------|-------|
| SchemaIntelligence | Table/column metadata for auto-mapping clipboard columns |
| RelationshipEngine | Validate FK columns in imported data |

### Consumes From

| Feature | Data/Action |
|---------|-------------|
| Schema Intelligence Cache (1.2) | Column names for auto-mapping |
| Data Management (20a) | Import infrastructure |

### Produces For

| Feature | Data/Action |
|---------|-------------|
| Bulk Edit Grid (47) | Paste action in edit mode |
| Unified Timeline (6.1) | Import event logged |
| Real-time Mutation Stream (22) | Generated INSERTs captured |

### Cross-Feature Actions

| From | Action | To |
|------|--------|-----|
| Tree View (table) | "Paste from Clipboard" | Clipboard Import panel |
| Bulk Edit Grid | "Paste Rows" | Import clipboard into pending changes |
| Data Management | "Quick Import" | Clipboard as data source |

### Unified Timeline Events

| Event Type | Data |
|------------|------|
| `clipboard-import` | `{ table, rowCount, source: 'tsv'|'csv'|'html', strategy, insertedIds, updatedCount, skippedCount, importId, timestamp }` |
| `clipboard-import-undo` | `{ table, importId, deletedCount, restoredCount, timestamp }` |

### Integration with Bulk Edit Grid

Clipboard Import can feed directly into Bulk Edit Grid as pending changes:

```typescript
// Three modes:
// 1. Direct import with validation (recommended)
const result = await executeImport(table, rows, {
  strategy: 'upsert',
  matchBy: 'pk',
  continueOnError: false,
});

// 2. Import as pending edits — user reviews before commit
BulkEditPanel.addPendingRows(rows);

// 3. Dry run first, then import
const preview = await dryRunImport(table, rows, options);
if (userConfirms(preview)) {
  await executeImport(table, rows, options);
}
```

### Smart Column Mapping

Auto-mapping uses SchemaIntelligence for better matches:

```typescript
function autoMapColumns(clipboardHeaders: string[], tableColumns: string[]): IColumnMapping[] {
  // Enhanced with SchemaIntelligence
  const schema = await schemaIntelligence.getTable(tableName);
  
  return clipboardHeaders.map(header => {
    // Try exact match
    let match = tableColumns.find(c => c.toLowerCase() === header.toLowerCase());
    
    // Try without underscores/spaces
    if (!match) {
      const normalized = header.toLowerCase().replace(/[_\s-]/g, '');
      match = tableColumns.find(c => 
        c.toLowerCase().replace(/[_\s-]/g, '') === normalized
      );
    }
    
    // Use column type for disambiguation
    // (e.g., if clipboard has "ID" and table has both "id" and "user_id",
    //  prefer the PK column)
    
    return { clipboardHeader: header, tableColumn: match ?? null };
  });
}
```

---

## Data Safety

### Import Strategy Selection

User must choose how to handle conflicts before import:

```
╔══════════════════════════════════════════════════════════════╗
║  Import Strategy:                                            ║
║                                                              ║
║  ○ Insert only — fail if any row conflicts                   ║
║  ○ Insert, skip conflicts — import only new rows             ║
║  ○ Upsert — insert new, update existing (match by: [PK ▼])   ║
║  ○ Dry run — preview what would happen, no changes           ║
║                                                              ║
║  Match existing rows by: [Primary Key ▼]                     ║
║    Options: Primary Key | Unique columns | Custom column(s)  ║
╚══════════════════════════════════════════════════════════════╝
```

```typescript
type ImportStrategy = 'insert' | 'insert_skip_conflicts' | 'upsert' | 'dry_run';

interface IImportOptions {
  strategy: ImportStrategy;
  matchBy: 'pk' | 'unique' | string[];  // column names for matching
  continueOnError: boolean;             // false = rollback all on first error
}
```

### Pre-Import Validation

Validate all data **before** any database writes:

```typescript
interface IValidationResult {
  row: number;
  errors: IValidationError[];
  warnings: IValidationWarning[];
}

interface IValidationError {
  column: string;
  value: unknown;
  code: 'type_mismatch' | 'not_null' | 'fk_missing' | 'unique_violation' | 'check_failed';
  message: string;
}

interface IValidationWarning {
  column: string;
  code: 'truncation' | 'type_coercion' | 'default_applied';
  message: string;
}

async function validateImport(
  table: string,
  rows: Record<string, unknown>[],
  options: IImportOptions,
): Promise<IValidationResult[]> {
  const schema = await schemaIntelligence.getTable(table);
  const results: IValidationResult[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const errors: IValidationError[] = [];
    const warnings: IValidationWarning[] = [];

    for (const [col, value] of Object.entries(row)) {
      const colSchema = schema.columns.find(c => c.name === col);
      if (!colSchema) continue;

      // NOT NULL check
      if (value === null && !colSchema.nullable && colSchema.defaultValue === undefined) {
        errors.push({
          column: col,
          value,
          code: 'not_null',
          message: `Column "${col}" cannot be null`,
        });
      }

      // Type compatibility check
      const typeError = checkTypeCompatibility(value, colSchema.type);
      if (typeError) {
        errors.push({ column: col, value, code: 'type_mismatch', message: typeError });
      }

      // Foreign key existence check
      if (colSchema.foreignKey && value !== null) {
        const exists = await checkFkExists(colSchema.foreignKey, value);
        if (!exists) {
          errors.push({
            column: col,
            value,
            code: 'fk_missing',
            message: `Foreign key value "${value}" does not exist in ${colSchema.foreignKey.table}`,
          });
        }
      }
    }

    // Unique constraint check (for insert strategy)
    if (options.strategy === 'insert') {
      const existingRow = await findExistingRow(table, row, options.matchBy);
      if (existingRow) {
        errors.push({
          column: options.matchBy === 'pk' ? schema.primaryKey : options.matchBy.join(', '),
          value: row,
          code: 'unique_violation',
          message: 'Row with this key already exists',
        });
      }
    }

    if (errors.length > 0 || warnings.length > 0) {
      results.push({ row: i, errors, warnings });
    }
  }

  return results;
}
```

### Validation Preview UI

Show validation results before import:

```
╔══════════════════════════════════════════════════════════════╗
║  Validation Results                                          ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  ✓ 97 rows valid                                             ║
║  ✗ 3 rows have errors:                                       ║
║                                                              ║
║  Row 12: FK violation                                        ║
║    └─ user_id: "999" does not exist in users.id             ║
║                                                              ║
║  Row 45: NOT NULL violation                                  ║
║    └─ email: cannot be null                                  ║
║                                                              ║
║  Row 88: Duplicate                                           ║
║    └─ id: "42" already exists                                ║
║                                                              ║
║  ┌─────────────────────────────────────────────────────────┐ ║
║  │ ☐ Import valid rows only (97 rows)                      │ ║
║  │ ☐ Cancel and fix data                                   │ ║
║  └─────────────────────────────────────────────────────────┘ ║
║                                                              ║
║  [Cancel]                    [Import 97 Valid Rows]          ║
╚══════════════════════════════════════════════════════════════╝
```

### Transaction Handling

All imports wrapped in a transaction with explicit rollback:

```typescript
interface IImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  errors: IRowError[];
  insertedIds: (string | number)[];  // For undo tracking
  updatedRows: IUpdatedRow[];        // For undo tracking
  transactionId: string;
}

interface IRowError {
  row: number;
  error: string;
  data: Record<string, unknown>;
}

interface IUpdatedRow {
  id: string | number;
  previousValues: Record<string, unknown>;
}

async function executeImport(
  table: string,
  rows: Record<string, unknown>[],
  options: IImportOptions,
): Promise<IImportResult> {
  const txn = await client.beginTransaction();
  const result: IImportResult = {
    success: false,
    imported: 0,
    skipped: 0,
    errors: [],
    insertedIds: [],
    updatedRows: [],
    transactionId: txn.id,
  };

  try {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      try {
        if (options.strategy === 'upsert') {
          const existing = await txn.findByKey(table, row, options.matchBy);
          if (existing) {
            // Capture previous values for undo
            result.updatedRows.push({ id: existing.id, previousValues: existing });
            await txn.update(table, existing.id, row);
          } else {
            const id = await txn.insert(table, row);
            result.insertedIds.push(id);
          }
        } else if (options.strategy === 'insert_skip_conflicts') {
          const existing = await txn.findByKey(table, row, options.matchBy);
          if (existing) {
            result.skipped++;
            continue;
          }
          const id = await txn.insert(table, row);
          result.insertedIds.push(id);
        } else {
          const id = await txn.insert(table, row);
          result.insertedIds.push(id);
        }
        result.imported++;
      } catch (e) {
        if (!options.continueOnError) {
          await txn.rollback();
          return {
            ...result,
            success: false,
            errors: [{ row: i, error: e.message, data: row }],
          };
        }
        result.errors.push({ row: i, error: e.message, data: row });
      }
    }

    await txn.commit();
    result.success = true;
    return result;

  } catch (e) {
    await txn.rollback();
    throw new Error(`Import failed and was rolled back: ${e.message}`);
  }
}
```

### Schema Freshness Check

Verify schema hasn't changed since mapping was created:

```typescript
interface ISchemaSnapshot {
  table: string;
  columns: { name: string; type: string; nullable: boolean }[];
  version: string;  // Hash of schema structure
  capturedAt: Date;
}

function computeSchemaVersion(schema: ITableSchema): string {
  const structure = schema.columns.map(c => `${c.name}:${c.type}:${c.nullable}`).join('|');
  return crypto.createHash('md5').update(structure).digest('hex').slice(0, 8);
}

async function checkSchemaFreshness(snapshot: ISchemaSnapshot): Promise<{
  fresh: boolean;
  changes?: string[];
}> {
  const current = await schemaIntelligence.getTable(snapshot.table, { forceRefresh: true });
  const currentVersion = computeSchemaVersion(current);

  if (currentVersion === snapshot.version) {
    return { fresh: true };
  }

  // Detect specific changes
  const changes: string[] = [];
  for (const col of snapshot.columns) {
    const currentCol = current.columns.find(c => c.name === col.name);
    if (!currentCol) {
      changes.push(`Column "${col.name}" was removed`);
    } else if (currentCol.type !== col.type) {
      changes.push(`Column "${col.name}" type changed: ${col.type} → ${currentCol.type}`);
    } else if (currentCol.nullable !== col.nullable) {
      changes.push(`Column "${col.name}" nullable changed: ${col.nullable} → ${currentCol.nullable}`);
    }
  }
  for (const col of current.columns) {
    if (!snapshot.columns.find(c => c.name === col.name)) {
      changes.push(`Column "${col.name}" was added`);
    }
  }

  return { fresh: false, changes };
}
```

Schema change warning UI:

```
╔══════════════════════════════════════════════════════════════╗
║  ⚠ Schema Changed                                            ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  The table schema has changed since you created the mapping: ║
║                                                              ║
║  • Column "status" type changed: VARCHAR → ENUM              ║
║  • Column "verified_at" was added                            ║
║                                                              ║
║  [Refresh Mapping]              [Continue Anyway]  [Cancel]  ║
╚══════════════════════════════════════════════════════════════╝
```

### Import History & Undo

Track all imports for audit and reversal:

```typescript
interface IImportHistoryEntry {
  id: string;
  table: string;
  timestamp: Date;
  strategy: ImportStrategy;
  source: 'clipboard' | 'file' | 'api';
  format: 'tsv' | 'csv' | 'html';
  rowCount: number;
  insertedIds: (string | number)[];
  updatedRows: IUpdatedRow[];
  canUndo: boolean;  // false if subsequent changes affect these rows
}

class ImportHistory {
  private entries: Map<string, IImportHistoryEntry> = new Map();

  async recordImport(result: IImportResult, meta: ImportMeta): Promise<string> {
    const entry: IImportHistoryEntry = {
      id: crypto.randomUUID(),
      table: meta.table,
      timestamp: new Date(),
      strategy: meta.strategy,
      source: 'clipboard',
      format: meta.format,
      rowCount: result.imported,
      insertedIds: result.insertedIds,
      updatedRows: result.updatedRows,
      canUndo: true,
    };
    this.entries.set(entry.id, entry);
    await this.persist(entry);
    return entry.id;
  }

  async undoImport(importId: string): Promise<{ success: boolean; error?: string }> {
    const entry = this.entries.get(importId);
    if (!entry) {
      return { success: false, error: 'Import not found' };
    }
    if (!entry.canUndo) {
      return { success: false, error: 'Cannot undo: rows have been modified since import' };
    }

    const txn = await client.beginTransaction();
    try {
      // Delete inserted rows
      for (const id of entry.insertedIds) {
        await txn.delete(entry.table, id);
      }

      // Restore updated rows to previous values
      for (const update of entry.updatedRows) {
        await txn.update(entry.table, update.id, update.previousValues);
      }

      await txn.commit();
      entry.canUndo = false;
      return { success: true };

    } catch (e) {
      await txn.rollback();
      return { success: false, error: e.message };
    }
  }

  // Mark imports as non-undoable when their rows are modified
  async markAffectedImports(table: string, affectedIds: (string | number)[]): Promise<void> {
    for (const entry of this.entries.values()) {
      if (entry.table !== table || !entry.canUndo) continue;

      const hasAffectedInsert = entry.insertedIds.some(id => affectedIds.includes(id));
      const hasAffectedUpdate = entry.updatedRows.some(u => affectedIds.includes(u.id));

      if (hasAffectedInsert || hasAffectedUpdate) {
        entry.canUndo = false;
      }
    }
  }
}
```

### Dry Run Mode

Preview exact impact without making changes:

```typescript
interface IDryRunResult {
  wouldInsert: number;
  wouldUpdate: number;
  wouldSkip: number;
  conflicts: IConflictPreview[];
  validationErrors: IValidationResult[];
}

interface IConflictPreview {
  row: number;
  existingId: string | number;
  existingValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
  diff: { column: string; from: unknown; to: unknown }[];
}

async function dryRunImport(
  table: string,
  rows: Record<string, unknown>[],
  options: IImportOptions,
): Promise<IDryRunResult> {
  const result: IDryRunResult = {
    wouldInsert: 0,
    wouldUpdate: 0,
    wouldSkip: 0,
    conflicts: [],
    validationErrors: await validateImport(table, rows, options),
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const existing = await client.findByKey(table, row, options.matchBy);

    if (existing) {
      if (options.strategy === 'insert') {
        result.wouldSkip++;  // Would fail
      } else if (options.strategy === 'insert_skip_conflicts') {
        result.wouldSkip++;
      } else if (options.strategy === 'upsert') {
        result.wouldUpdate++;
        // Show diff
        const diff: { column: string; from: unknown; to: unknown }[] = [];
        for (const [col, val] of Object.entries(row)) {
          if (existing[col] !== val) {
            diff.push({ column: col, from: existing[col], to: val });
          }
        }
        if (diff.length > 0) {
          result.conflicts.push({
            row: i,
            existingId: existing.id,
            existingValues: existing,
            newValues: row,
            diff,
          });
        }
      }
    } else {
      result.wouldInsert++;
    }
  }

  return result;
}
```

Dry run preview UI:

```
╔══════════════════════════════════════════════════════════════╗
║  Dry Run Preview                                             ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  If you import with strategy "Upsert":                       ║
║                                                              ║
║    INSERT  12 new rows                                       ║
║    UPDATE   3 existing rows                                  ║
║    SKIP     0 rows                                           ║
║                                                              ║
║  Updates Preview:                                            ║
║  ┌──────┬──────────────┬───────────────┬──────────────────┐  ║
║  │ Row  │ Column       │ Current       │ New              │  ║
║  ├──────┼──────────────┼───────────────┼──────────────────┤  ║
║  │  3   │ email        │ old@test.com  │ new@test.com     │  ║
║  │  3   │ active       │ 0             │ 1                │  ║
║  │  7   │ name         │ Bob           │ Robert           │  ║
║  │ 14   │ email        │ x@y.com       │ x@z.com          │  ║
║  └──────┴──────────────┴───────────────┴──────────────────┘  ║
║                                                              ║
║  [Cancel]                     [Proceed with Import]          ║
╚══════════════════════════════════════════════════════════════╝
```

### Updated Message Protocol

Extension → Webview (additions):
```typescript
{ command: 'validationResults', results: IValidationResult[], canProceed: boolean }
{ command: 'schemaChanged', changes: string[] }
{ command: 'dryRunResults', results: IDryRunResult }
{ command: 'importComplete', result: IImportResult }
```

Webview → Extension (additions):
```typescript
{ command: 'import', mapping: IColumnMapping[], options: IImportOptions }
{ command: 'validate' }
{ command: 'dryRun' }
{ command: 'refreshSchema' }
{ command: 'undoImport', importId: string }
```

---

## Known Limitations

- HTML parsing uses regex, not a full DOM parser — may fail on malformed or complex HTML
- `vscode.env.clipboard.readText()` only reads plain text — rich clipboard (HTML) from Excel requires the extension to try parsing the text as HTML
- Large clipboard pastes (10,000+ rows) may be slow in the preview and validation
- First row is always treated as headers — no option for headerless data
- Undo is only available if imported rows haven't been subsequently modified
- Foreign key validation requires additional queries and may be slow for large imports
