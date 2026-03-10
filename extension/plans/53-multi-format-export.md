# Feature 53: Multi-Format Export — DONE

## What It Does

Export table data in multiple formats from a single command: JSON, CSV, SQL INSERT statements, Dart map literals, and Markdown tables. Currently only CSV export exists. This adds a format picker and generates output suitable for pasting into code, documentation, bug reports, or test fixtures.

## User Experience

1. Right-click a table in the tree → "Export Table…"
2. QuickPick: choose format (JSON, CSV, SQL INSERT, Dart, Markdown)
3. Choose destination: Clipboard or File
4. Data exported in chosen format

```
╔══════════════════════════════════════════════╗
║  Export Table: users                         ║
╠══════════════════════════════════════════════╣
║  Format:                                     ║
║  ● JSON (array of objects)                   ║
║  ○ CSV (comma-separated)                     ║
║  ○ SQL INSERT statements                     ║
║  ○ Dart List<Map> literal                    ║
║  ○ Markdown table                            ║
║                                              ║
║  Destination:                                ║
║  ● Copy to clipboard                         ║
║  ○ Save to file                              ║
║                                              ║
║  Rows: (●) All  ( ) Limit: [___]            ║
╚══════════════════════════════════════════════╝
```

### Output Examples

**JSON:**
```json
[
  { "id": 1, "email": "alice@example.com", "name": "Alice" },
  { "id": 2, "email": "bob@example.com", "name": "Bob" }
]
```

**SQL INSERT:**
```sql
INSERT INTO "users" ("id", "email", "name") VALUES (1, 'alice@example.com', 'Alice');
INSERT INTO "users" ("id", "email", "name") VALUES (2, 'bob@example.com', 'Bob');
```

**Dart:**
```dart
const users = <Map<String, Object?>>[
  {'id': 1, 'email': 'alice@example.com', 'name': 'Alice'},
  {'id': 2, 'email': 'bob@example.com', 'name': 'Bob'},
];
```

**Markdown:**
```markdown
| id | email | name |
|---|---|---|
| 1 | alice@example.com | Alice |
| 2 | bob@example.com | Bob |
```

## New Files

```
extension/src/export/
  format-export.ts          # Format conversion logic
  format-export-types.ts    # Interfaces
extension/src/test/
  format-export.test.ts
```

## Modified Files

```
extension/src/extension.ts    # Register export command
extension/package.json         # Command + context menu
```

## Dependencies

- `api-client.ts` — `sql()`
- `shared-utils.ts` — `escapeCsvCell()`, `q()`

## Architecture

### Format Converters

```typescript
type ExportFormat = 'json' | 'csv' | 'sql' | 'dart' | 'markdown';

interface IExportOptions {
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
  format: ExportFormat;
}

function formatExport(options: IExportOptions): string {
  switch (options.format) {
    case 'json': return formatJson(options);
    case 'csv': return formatCsv(options);
    case 'sql': return formatSqlInsert(options);
    case 'dart': return formatDart(options);
    case 'markdown': return formatMarkdown(options);
  }
}
```

Each formatter is a pure function:

```typescript
function formatJson(o: IExportOptions): string {
  return JSON.stringify(o.rows, null, 2);
}

function formatSqlInsert(o: IExportOptions): string {
  const colList = o.columns.map(c => `"${c}"`).join(', ');
  return o.rows.map(row => {
    const vals = o.columns.map(c => sqlLiteral(row[c]));
    return `INSERT INTO "${o.table}" (${colList}) VALUES (${vals.join(', ')});`;
  }).join('\n');
}

function formatDart(o: IExportOptions): string {
  const entries = o.rows.map(row => {
    const pairs = o.columns.map(c => `'${c}': ${dartLiteral(row[c])}`);
    return `  {${pairs.join(', ')}}`;
  });
  return `const ${o.table} = <Map<String, Object?>>[
${entries.join(',\n')},
];`;
}

function formatMarkdown(o: IExportOptions): string {
  const header = `| ${o.columns.join(' | ')} |`;
  const sep = `|${o.columns.map(() => '---').join('|')}|`;
  const rows = o.rows.map(row =>
    `| ${o.columns.map(c => String(row[c] ?? '')).join(' | ')} |`
  );
  return [header, sep, ...rows].join('\n');
}
```

### Value Escaping Helpers

```typescript
function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

function dartLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "\\'")}'`;
}
```

### Command Flow

```typescript
async function exportTable(client: DriftApiClient, tableName: string): Promise<void> {
  const format = await vscode.window.showQuickPick(
    ['JSON', 'CSV', 'SQL INSERT', 'Dart', 'Markdown'],
    { placeHolder: `Export ${tableName} as…` }
  );
  if (!format) return;

  const dest = await vscode.window.showQuickPick(
    ['Copy to clipboard', 'Save to file'],
    { placeHolder: 'Destination' }
  );
  if (!dest) return;

  const result = await client.sql(`SELECT * FROM "${tableName}"`);
  const output = formatExport({
    table: tableName,
    columns: result.columns,
    rows: result.rows,
    format: formatKey(format),
  });

  if (dest === 'Copy to clipboard') {
    await vscode.env.clipboard.writeText(output);
    vscode.window.showInformationMessage(`Copied ${result.rows.length} rows as ${format}`);
  } else {
    const ext = fileExtension(formatKey(format));
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${tableName}.${ext}`),
      filters: { [format]: [ext] },
    });
    if (uri) {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(output, 'utf-8'));
    }
  }
}
```

## Server-Side Changes

None. Uses existing `sql()` endpoint.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.exportTable",
        "title": "Export Table…",
        "icon": "$(export)"
      }
    ],
    "menus": {
      "view/item/context": [
        {
          "command": "driftViewer.exportTable",
          "when": "viewItem == driftTable || viewItem == driftTablePinned",
          "group": "3_export"
        }
      ]
    }
  }
}
```

## Testing

- `format-export.test.ts`:
  - JSON: valid JSON, all rows present, correct keys
  - CSV: proper escaping of commas, quotes, newlines in values
  - SQL INSERT: NULL handled, strings escaped, numeric values unquoted
  - Dart: null literal, string escaping, correct `Map<String, Object?>` syntax
  - Markdown: pipe characters in values escaped, header + separator + rows
  - Empty table → format-appropriate empty output (empty array, no rows, etc.)
  - Single row table works for all formats
  - BLOB/binary values rendered as hex or `<binary>` placeholder
  - Unicode characters preserved in all formats
  - Large row counts (1000+) don't crash

## Known Limitations

- Exports all rows by default — very large tables (100k+) may be slow or hit memory limits
- No row limit option in initial version (can be added to QuickPick flow)
- BLOB columns exported as `<binary>` placeholder — not base64 encoded
- Dart format assumes all values are primitives (no nested objects)
- No custom delimiter option for CSV (always comma)
- Replaces existing `driftViewer.exportTableCsv` command with the unified export
