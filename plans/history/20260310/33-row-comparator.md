# Feature 33: Row Comparator

## What It Does

Select any two rows — same table or different tables — and see a side-by-side diff. Highlights matching column names, value differences, and type mismatches. Answers "why does user A work but user B doesn't?" in one click.

## User Experience

1. Right-click a row in the table data viewer → "Compare Row…"
2. Pick the second row:
   - "Compare with another row in this table" → enter PK value
   - "Compare with row in another table" → pick table → enter PK value
3. A diff panel opens:

```
╔═══════════════════════════════════════════════════════════╗
║  ROW COMPARATOR                                           ║
║  users.id=42 vs users.id=99                              ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  Column         │ Row A (id=42)      │ Row B (id=99)     ║
║  ────────────────┼────────────────────┼───────────────────║
║  id             │ 42                 │ 99                 ║
║  name           │ "Alice Smith"      │ "Bob Jones"      ◄ ║
║  email          │ "alice@x.com"      │ "bob@x.com"      ◄ ║
║  role           │ "admin"            │ "admin"            ║
║  active         │ 1                  │ 0                 ◄ ║
║  created_at     │ "2026-01-15"       │ "2026-02-20"     ◄ ║
║  updated_at     │ "2026-03-10"       │ NULL             ◄ ║
║  login_count    │ 47                 │ 3                 ◄ ║
║  last_login     │ "2026-03-10"       │ "2026-02-21"     ◄ ║
║                                                           ║
║  Summary: 7 of 9 columns differ                         ║
║                                                           ║
║  [Swap A/B]  [Copy as JSON]  [Compare Different Rows]   ║
╚═══════════════════════════════════════════════════════════╝
```

For cross-table comparison, columns are aligned by name:

```
╔═══════════════════════════════════════════════════════════╗
║  ROW COMPARATOR                                           ║
║  users.id=42 vs customers.id=7                           ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  Column         │ users (id=42)      │ customers (id=7)  ║
║  ────────────────┼────────────────────┼───────────────────║
║  id             │ 42                 │ 7                  ║
║  name           │ "Alice Smith"      │ "Alice S."       ◄ ║
║  email          │ "alice@x.com"      │ "alice@x.com"     ║
║  phone          │ "+15551234"        │ (column missing)  ◄ ║
║  ──── only in users ────                                  ║
║  role           │ "admin"            │                    ║
║  active         │ 1                  │                    ║
║  ──── only in customers ────                              ║
║  customer_type  │                    │ "premium"          ║
║  discount_pct   │                    │ 15                 ║
╚═══════════════════════════════════════════════════════════╝
```

## New Files

```
extension/src/
  comparator/
    comparator-panel.ts        # Webview panel lifecycle
    comparator-html.ts         # HTML/CSS/JS template
    row-differ.ts              # Computes column-by-column diff
extension/src/test/
  row-differ.test.ts
```

## Dependencies

- `api-client.ts` — `sql()` for fetching row data, `schemaMetadata()` for column info

## Architecture

### Row Differ

Pure logic, no VS Code dependency:

```typescript
interface IRowDiffColumn {
  column: string;
  valueA: unknown;
  valueB: unknown;
  match: 'same' | 'different' | 'only_a' | 'only_b' | 'type_mismatch';
}

interface IRowDiff {
  labelA: string;           // "users.id=42"
  labelB: string;           // "users.id=99"
  columns: IRowDiffColumn[];
  sameCount: number;
  differentCount: number;
  onlyACount: number;
  onlyBCount: number;
}

class RowDiffer {
  diff(
    rowA: Record<string, unknown>,
    rowB: Record<string, unknown>,
    labelA: string,
    labelB: string,
  ): IRowDiff {
    const allColumns = new Set([...Object.keys(rowA), ...Object.keys(rowB)]);
    const columns: IRowDiffColumn[] = [];
    let same = 0, different = 0, onlyA = 0, onlyB = 0;

    for (const col of allColumns) {
      const hasA = col in rowA;
      const hasB = col in rowB;

      if (hasA && hasB) {
        const valA = rowA[col];
        const valB = rowB[col];

        if (this._deepEqual(valA, valB)) {
          columns.push({ column: col, valueA: valA, valueB: valB, match: 'same' });
          same++;
        } else if (this._isTypeMismatch(valA, valB)) {
          columns.push({ column: col, valueA: valA, valueB: valB, match: 'type_mismatch' });
          different++;
        } else {
          columns.push({ column: col, valueA: valA, valueB: valB, match: 'different' });
          different++;
        }
      } else if (hasA) {
        columns.push({ column: col, valueA: rowA[col], valueB: undefined, match: 'only_a' });
        onlyA++;
      } else {
        columns.push({ column: col, valueA: undefined, valueB: rowB[col], match: 'only_b' });
        onlyB++;
      }
    }

    // Sort: shared columns first (same then different), then only-A, then only-B
    columns.sort((a, b) => {
      const order = { same: 0, different: 1, type_mismatch: 2, only_a: 3, only_b: 4 };
      return order[a.match] - order[b.match];
    });

    return { labelA, labelB, columns, sameCount: same, differentCount: different, onlyACount: onlyA, onlyBCount: onlyB };
  }

  private _deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null) return false;
    // Numeric comparison (SQLite may return "42" or 42)
    if (typeof a === 'number' || typeof b === 'number') {
      return Number(a) === Number(b);
    }
    return String(a) === String(b);
  }

  private _isTypeMismatch(a: unknown, b: unknown): boolean {
    if (a === null || b === null) return false;
    return typeof a !== typeof b;
  }
}
```

### HTML Template

```typescript
function renderRowDiff(diff: IRowDiff): string {
  return `
    <h2>${esc(diff.labelA)} vs ${esc(diff.labelB)}</h2>

    <table class="diff-table">
      <thead>
        <tr>
          <th>Column</th>
          <th>${esc(diff.labelA)}</th>
          <th>${esc(diff.labelB)}</th>
        </tr>
      </thead>
      <tbody>
        ${diff.columns.map(c => `
          <tr class="diff-${c.match}">
            <td class="col-name">${esc(c.column)}</td>
            <td>${c.match === 'only_b' ? '' : formatValue(c.valueA)}</td>
            <td>${c.match === 'only_a' ? '' : formatValue(c.valueB)}
              ${c.match === 'different' || c.match === 'type_mismatch' ? ' ◄' : ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <p class="summary">
      ${diff.sameCount} same, ${diff.differentCount} different${
        diff.onlyACount > 0 ? `, ${diff.onlyACount} only in A` : ''}${
        diff.onlyBCount > 0 ? `, ${diff.onlyBCount} only in B` : ''}
    </p>
  `;
}
```

CSS:
```css
.diff-same td { opacity: 0.6; }
.diff-different td:nth-child(2), .diff-different td:nth-child(3) {
  background: rgba(200, 200, 0, 0.15);
  font-weight: bold;
}
.diff-only_a td:nth-child(2) { background: rgba(0, 200, 0, 0.15); }
.diff-only_b td:nth-child(3) { background: rgba(0, 200, 0, 0.15); }
.diff-type_mismatch td { background: rgba(200, 0, 0, 0.1); }
```

## Server-Side Changes

None. Uses existing `POST /api/sql` to fetch row data.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.compareRows",
        "title": "Saropa Drift Advisor: Compare Two Rows",
        "icon": "$(diff)"
      }
    ],
    "menus": {
      "view/item/context": [{
        "command": "driftViewer.compareRows",
        "when": "viewItem == driftTable",
        "group": "5_compare"
      }]
    }
  }
}
```

## Wiring in extension.ts

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.compareRows', async (item?: TableItem) => {
    // Row A
    const tableA = item?.tableMetadata.name ?? await pickTable(client) ?? '';
    if (!tableA) return;
    const pkA = await vscode.window.showInputBox({ prompt: `Row A: Primary key value in "${tableA}"` });
    if (!pkA) return;

    // Row B
    const scope = await vscode.window.showQuickPick([
      { label: `Same table (${tableA})`, value: 'same' },
      { label: 'Different table', value: 'different' },
    ]);
    if (!scope) return;

    const tableB = scope.value === 'same' ? tableA : (await pickTable(client) ?? '');
    if (!tableB) return;
    const pkB = await vscode.window.showInputBox({ prompt: `Row B: Primary key value in "${tableB}"` });
    if (!pkB) return;

    // Fetch rows
    const meta = await client.schemaMetadata();
    const pkColA = meta.tables.find(t => t.name === tableA)?.columns.find(c => c.pk)?.name ?? 'id';
    const pkColB = meta.tables.find(t => t.name === tableB)?.columns.find(c => c.pk)?.name ?? 'id';

    const [resultA, resultB] = await Promise.all([
      client.sql(`SELECT * FROM "${tableA}" WHERE "${pkColA}" = ${sqlLiteral(pkA)} LIMIT 1`),
      client.sql(`SELECT * FROM "${tableB}" WHERE "${pkColB}" = ${sqlLiteral(pkB)} LIMIT 1`),
    ]);

    if (resultA.rows.length === 0) {
      vscode.window.showWarningMessage(`Row not found: ${tableA}.${pkColA}=${pkA}`);
      return;
    }
    if (resultB.rows.length === 0) {
      vscode.window.showWarningMessage(`Row not found: ${tableB}.${pkColB}=${pkB}`);
      return;
    }

    const differ = new RowDiffer();
    const diff = differ.diff(
      resultA.rows[0] as Record<string, unknown>,
      resultB.rows[0] as Record<string, unknown>,
      `${tableA}.${pkColA}=${pkA}`,
      `${tableB}.${pkColB}=${pkB}`,
    );

    ComparatorPanel.createOrShow(context.extensionUri, diff);
  })
);
```

## Testing

- `row-differ.test.ts`:
  - Same values → all columns marked `same`
  - Different values → marked `different` with correct values
  - Column only in A → marked `only_a`
  - Column only in B → marked `only_b`
  - Numeric string vs number (42 vs "42") → treated as `same`
  - NULL vs NULL → treated as `same`
  - NULL vs value → treated as `different`
  - Type mismatch (string "42" vs boolean true) → marked `type_mismatch`
  - Empty rows → empty columns array
  - Sorting: same columns first, then different, then only-A/B

## Known Limitations

- Only compares single rows — no multi-row comparison
- PK detection is heuristic (first column with `pk: true`, fallback to `id`)
- PK value input is a text box — no autocomplete or validation
- No BLOB comparison (shown as "[BLOB]" on both sides)
- Large row data (TEXT columns with 10KB+) may render poorly in the panel
- Cross-table comparison aligns by column name only — no semantic matching
- No "Compare with clipboard" or "Compare with last viewed row" shortcut
- No highlight of which part of a string value changed (full-value diff only)
