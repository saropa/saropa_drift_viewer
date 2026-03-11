# Feature 62: Data Story Narrator

## What It Does

Select any row in any table and generate a human-readable English narrative that follows all FK chains to tell the "story" of that entity. Instead of mentally joining tables, read: "User Alice (created Jan 5) has 3 orders totaling $142.50, with 7 items across 4 categories. Her most recent session was 2 hours ago from Chrome on macOS."

## User Experience

1. Right-click a row in table data → "Tell This Row's Story"
2. Or: right-click a table in the tree → "Narrate Row…" → enter PK value
3. Extension follows all FK relationships outward from the selected row
4. Generates a paragraph-style narrative displayed in a panel

```
╔══════════════════════════════════════════════════════════════╗
║  DATA STORY — users #42                                      ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  User "Alice" (id: 42) was created on 2026-01-15 and is     ║
║  currently active (active = 1). Their email is               ║
║  alice@example.com.                                          ║
║                                                              ║
║  This user has 3 orders:                                     ║
║  • Order #91 ($59.99, shipped on 2026-03-08) with 2 items:  ║
║    - Product "Widget A" ×1 ($29.99)                          ║
║    - Product "Widget B" ×2 ($15.00 each)                     ║
║  • Order #92 ($120.00, pending since 2026-03-09) with 3     ║
║    items across 2 categories                                 ║
║  • Order #95 ($15.99, pending since 2026-03-10) with 1 item ║
║                                                              ║
║  Total spending: $195.98 across 6 items.                     ║
║                                                              ║
║  This user has 2 active sessions:                            ║
║  • Session from Chrome/macOS (last seen 2 hours ago)         ║
║  • Session from Safari/iOS (last seen 3 days ago)            ║
║                                                              ║
║  Referenced by 12 rows in audit_log.                         ║
║                                                              ║
║  [Copy Text] [Copy Markdown] [Regenerate]                    ║
╚══════════════════════════════════════════════════════════════╝
```

## New Files

```
extension/src/narrator/
  data-narrator.ts            # FK traversal + narrative generation
  narrator-panel.ts           # Webview panel
  narrator-html.ts            # HTML template
  narrator-types.ts           # Interfaces
extension/src/test/
  data-narrator.test.ts
```

## Modified Files

```
extension/src/extension.ts    # Register command
extension/package.json         # Command + context menu
```

## Dependencies

- `api-client.ts` — `schemaMetadata()`, `tableFkMeta()`, `sql()`
- No LLM required — narrative is template-driven from data

## Architecture

### FK Graph Traversal

Starting from a selected row, walks outward through FK relationships:

```typescript
interface IEntityGraph {
  root: IEntityNode;
  relatedTables: Map<string, IRelatedData>;
}

interface IEntityNode {
  table: string;
  pkColumn: string;
  pkValue: unknown;
  row: Record<string, unknown>;
  columns: string[];
}

interface IRelatedData {
  table: string;
  direction: 'parent' | 'child';  // parent = this row references it, child = it references this row
  fkColumn: string;
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;  // True if more rows exist than the limit
}

class DataNarrator {
  private static readonly _MAX_RELATED_ROWS = 10;

  constructor(private readonly _client: DriftApiClient) {}

  async buildGraph(table: string, pkColumn: string, pkValue: unknown): Promise<IEntityGraph> {
    // Fetch the root row
    const rootResult = await this._client.sql(
      `SELECT * FROM "${table}" WHERE "${pkColumn}" = ${sqlLiteral(pkValue)}`
    );
    const root: IEntityNode = {
      table, pkColumn, pkValue,
      row: rootResult.rows[0],
      columns: rootResult.columns,
    };

    // Find parent rows (this row's FK columns point to other tables)
    const fks = await this._client.tableFkMeta(table);
    const related = new Map<string, IRelatedData>();

    for (const fk of fks) {
      const fkValue = root.row[fk.fromColumn];
      if (fkValue === null || fkValue === undefined) continue;

      const result = await this._client.sql(
        `SELECT * FROM "${fk.toTable}" WHERE "${fk.toColumn}" = ${sqlLiteral(fkValue)} LIMIT 1`
      );
      if (result.rows.length > 0) {
        related.set(`parent:${fk.toTable}`, {
          table: fk.toTable,
          direction: 'parent',
          fkColumn: fk.toColumn,
          rows: result.rows,
          rowCount: result.rows.length,
          truncated: false,
        });
      }
    }

    // Find child rows (other tables' FK columns reference this row)
    const allMeta = await this._client.schemaMetadata();
    for (const otherTable of allMeta) {
      if (otherTable.name === table || otherTable.name.startsWith('sqlite_')) continue;
      const otherFks = await this._client.tableFkMeta(otherTable.name);
      for (const fk of otherFks) {
        if (fk.toTable === table && fk.toColumn === pkColumn) {
          const countResult = await this._client.sql(
            `SELECT COUNT(*) as cnt FROM "${otherTable.name}" WHERE "${fk.fromColumn}" = ${sqlLiteral(pkValue)}`
          );
          const count = (countResult.rows[0] as Record<string, unknown>).cnt as number;
          if (count === 0) continue;

          const result = await this._client.sql(
            `SELECT * FROM "${otherTable.name}" WHERE "${fk.fromColumn}" = ${sqlLiteral(pkValue)} LIMIT ${DataNarrator._MAX_RELATED_ROWS}`
          );
          related.set(`child:${otherTable.name}`, {
            table: otherTable.name,
            direction: 'child',
            fkColumn: fk.fromColumn,
            rows: result.rows,
            rowCount: count,
            truncated: count > DataNarrator._MAX_RELATED_ROWS,
          });
        }
      }
    }

    return { root, relatedTables: related };
  }
}
```

### Narrative Generator

Converts the entity graph into readable English using templates:

```typescript
function generateNarrative(graph: IEntityGraph): string {
  const parts: string[] = [];
  const root = graph.root;

  // Root row description
  parts.push(describeRow(root.table, root.row, root.columns));

  // Parent relationships (this row belongs to...)
  for (const [, related] of graph.relatedTables) {
    if (related.direction === 'parent' && related.rows.length > 0) {
      parts.push(describeParent(related));
    }
  }

  // Child relationships (this row has...)
  for (const [, related] of graph.relatedTables) {
    if (related.direction === 'child') {
      parts.push(describeChildren(related));
    }
  }

  return parts.join('\n\n');
}

function describeRow(table: string, row: Record<string, unknown>, columns: string[]): string {
  const nameCol = columns.find(c => ['name', 'title', 'label', 'description'].includes(c.toLowerCase()));
  const name = nameCol ? `"${row[nameCol]}"` : '';
  const pk = row[columns[0]];

  let desc = `${capitalize(singularize(table))} ${name} (id: ${pk})`;

  // Add notable column values
  const notable = columns.filter(c =>
    !['id', 'rowid', nameCol].includes(c) && row[c] !== null
  ).slice(0, 4);

  if (notable.length > 0) {
    const details = notable.map(c => `${c} = ${formatValue(row[c])}`).join(', ');
    desc += ` — ${details}`;
  }

  return desc + '.';
}

function describeChildren(related: IRelatedData): string {
  const count = related.rowCount;
  const tableName = related.table;
  const noun = count === 1 ? singularize(tableName) : tableName;

  let desc = `Has ${count} ${noun}`;
  if (related.truncated) {
    desc += ` (showing first ${related.rows.length})`;
  }
  desc += ':';

  const items = related.rows.map(row => `  • ${summarizeRow(row)}`);
  return desc + '\n' + items.join('\n');
}
```

### Webview Message Protocol

Webview → Extension:
```typescript
{ command: 'narrate', table: string, pkColumn: string, pkValue: unknown }
{ command: 'copyText' }
{ command: 'copyMarkdown' }
{ command: 'regenerate' }
```

Extension → Webview:
```typescript
{ command: 'narrative', text: string, markdown: string, graph: IEntityGraph }
{ command: 'generating', table: string, pkValue: unknown }
{ command: 'error', message: string }
```

## Server-Side Changes

None. Uses existing `schemaMetadata()`, `tableFkMeta()`, and `sql()`.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.narrateRow",
        "title": "Saropa Drift Advisor: Tell This Row's Story",
        "icon": "$(book)"
      }
    ],
    "menus": {
      "view/item/context": [
        {
          "command": "driftViewer.narrateRow",
          "when": "viewItem == driftTable || viewItem == driftTablePinned",
          "group": "1_view"
        }
      ]
    }
  }
}
```

## Testing

- `data-narrator.test.ts`:
  - Root row with no FKs → single paragraph description
  - Root row with parent FK → "belongs to" parent described
  - Root row with child rows → "has N children" listed
  - Multiple child tables → each described separately
  - Child table truncated at limit → "(showing first 10)" noted
  - NULL FK value → parent skipped
  - Zero child rows → table not mentioned
  - Name column detected from common names (name, title, label)
  - No name column → uses PK only
  - `singularize` handles common patterns (orders→order, categories→category)
  - Narrative output is valid Markdown
  - Graph traversal depth is 1 level (no recursive FK following)

## Known Limitations

- Only traverses one FK level deep — does not recursively follow children's children
- `singularize()` is a simple heuristic (strip trailing 's', handle 'ies'→'y') — not a full NLP stemmer
- Aggregate calculations (totals, averages) require numeric column detection — may miss some
- Column value formatting is basic: dates shown as-is, numbers not locale-formatted
- No LLM enhancement in v1 — purely template-driven. Could optionally use LLM for richer prose in a future version.
- Large entity graphs (row referenced by 1000+ child rows) only show the first 10 per table
- No circular FK handling — mutual references would infinite-loop without the depth limit
