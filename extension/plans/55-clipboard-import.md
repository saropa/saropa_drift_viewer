# Feature 55: Clipboard Import

## What It Does

Paste tabular data from the clipboard directly into a database table. Supports data copied from Excel, Google Sheets, HTML tables, and TSV/CSV text. Detects the format automatically, shows a preview with column mapping, and imports the data.

## User Experience

1. Copy rows from Excel, Google Sheets, or any spreadsheet
2. Right-click a table in the tree → "Paste from Clipboard"
3. Preview shows parsed data with auto-detected column mapping
4. Confirm → data imported via existing import endpoint

```
╔══════════════════════════════════════════════════════════════╗
║  PASTE INTO: users                                           ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Detected: 3 rows, 4 columns (tab-separated)                ║
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
║  │ name  │ email             │ active │                      ║
║  │ Alice │ alice@example.com │ 1      │                      ║
║  │ Bob   │ bob@example.com   │ 1      │                      ║
║  │ Carol │ carol@test.com    │ 0      │                      ║
║                                                              ║
║  [Cancel]                              [Import 3 rows]       ║
╚══════════════════════════════════════════════════════════════╝
```

## New Files

```
extension/src/import/
  clipboard-parser.ts       # Parse clipboard text into rows
  clipboard-import-panel.ts # Webview for preview + column mapping
  clipboard-import-html.ts  # HTML template
extension/src/test/
  clipboard-parser.test.ts
```

## Modified Files

```
extension/src/extension.ts    # Register command
extension/package.json         # Command + context menu
```

## Dependencies

- `api-client.ts` — `schemaMetadata()`, `importData()`
- `vscode.env.clipboard` — read clipboard text

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

- `clipboard-parser.test.ts`:
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

## Known Limitations

- HTML parsing uses regex, not a full DOM parser — may fail on malformed or complex HTML
- `vscode.env.clipboard.readText()` only reads plain text — rich clipboard (HTML) from Excel requires the extension to try parsing the text as HTML
- No type coercion — all values imported as strings. The server handles type conversion.
- Large clipboard pastes (10,000+ rows) may be slow in the preview
- No undo after import — use data management (Feature 20a) to revert
- First row is always treated as headers — no option for headerless data
