# Feature 46: Automated Data Lineage

## What It Does

Click any cell in any table and trace its data lineage: follow FK references upstream to find where the value originated, and downstream to find everywhere it's referenced. Visualize the complete lineage path as an interactive graph. Answer "where did this value come from?" and "what depends on this row?"

## User Experience

1. Right-click any row in the data viewer → "Trace Data Lineage"
2. Or: command palette → "Saropa Drift Advisor: Trace Data Lineage" → pick table → pick row
3. Lineage panel:

```
╔══════════════════════════════════════════════════════════════════╗
║  DATA LINEAGE — orders.id = 201                                 ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  Depth: [3 ▾]   Direction: (●) Both ( ) Up ( ) Down            ║
║                                                                  ║
║  ┌─ Upstream (where this row's FK values come from) ────────┐  ║
║  │                                                           │  ║
║  │  users.id = 42                                           │  ║
║  │  ├─ name: "Alice Smith"                                  │  ║
║  │  ├─ email: "alice@example.com"                           │  ║
║  │  └─ Referenced by: orders.user_id = 42                   │  ║
║  │     └─ ★ orders.id = 201 (this row)                     │  ║
║  │                                                           │  ║
║  │  products.id = 15                                        │  ║
║  │  ├─ name: "Widget Pro"                                   │  ║
║  │  └─ Referenced by: order_items.product_id = 15           │  ║
║  │                                                           │  ║
║  └───────────────────────────────────────────────────────────┘  ║
║                                                                  ║
║  ┌─ Downstream (rows that reference this row) ──────────────┐  ║
║  │                                                           │  ║
║  │  order_items (3 rows reference orders.id = 201)          │  ║
║  │  ├─ id=501: product_id=15, qty=2, price=$29.99           │  ║
║  │  ├─ id=502: product_id=22, qty=1, price=$49.99           │  ║
║  │  └─ id=503: product_id=15, qty=1, price=$29.99           │  ║
║  │                                                           │  ║
║  │  payments (1 row references orders.id = 201)             │  ║
║  │  └─ id=88: amount=$109.97, method="card", status="paid"  │  ║
║  │                                                           │  ║
║  │  shipping (1 row references orders.id = 201)             │  ║
║  │  └─ id=55: carrier="FedEx", tracking="FX123456"          │  ║
║  │                                                           │  ║
║  └───────────────────────────────────────────────────────────┘  ║
║                                                                  ║
║  Total: 1 upstream parent, 5 downstream dependents              ║
║  [Export as JSON]  [Generate DELETE SQL]                         ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```

4. Click any node in the lineage tree to navigate to that row
5. "Generate DELETE SQL" produces safe deletion statements in FK order

## New Files

```
extension/src/
  lineage/
    lineage-panel.ts           # Webview panel lifecycle
    lineage-html.ts            # HTML template with tree visualization
    lineage-tracer.ts          # Traces FK relationships up and down
    lineage-types.ts           # Shared interfaces
extension/src/test/
  lineage-tracer.test.ts
```

## Dependencies

- `api-client.ts` — `schemaMetadata()`, `tableFkMeta()`, `sql()`
- `data-management/dependency-sorter.ts` (from Feature 20a) — FK-safe DELETE ordering for cascade previews
- `data-management/dataset-types.ts` (from Feature 20a) — `IFkContext` shared interface for FK graph traversal

## Architecture

### Lineage Types

```typescript
interface ILineageNode {
  table: string;
  pkColumn: string;
  pkValue: unknown;
  preview: Record<string, unknown>;    // First 5 columns
  direction: 'upstream' | 'downstream' | 'root';
  fkColumn?: string;                    // The FK column that connects this node
  children: ILineageNode[];
}

interface ILineageResult {
  root: ILineageNode;
  upstreamCount: number;
  downstreamCount: number;
}
```

### Lineage Tracer

```typescript
class LineageTracer {
  constructor(private readonly _client: DriftApiClient) {}

  async trace(
    table: string,
    pkColumn: string,
    pkValue: unknown,
    maxDepth: number,
    direction: 'both' | 'up' | 'down',
  ): Promise<ILineageResult> {
    const meta = await this._client.schemaMetadata();
    const fkMap = await this._buildFkMap(meta.tables);

    // Fetch the root row
    const rootRow = await this._fetchRow(table, pkColumn, pkValue);
    const root: ILineageNode = {
      table,
      pkColumn,
      pkValue,
      preview: this._preview(rootRow),
      direction: 'root',
      children: [],
    };

    let upstreamCount = 0;
    let downstreamCount = 0;

    // Trace upstream (follow FKs from this row to parent rows)
    if (direction === 'both' || direction === 'up') {
      const upstream = await this._traceUpstream(
        table, rootRow, fkMap, maxDepth, new Set()
      );
      root.children.push(...upstream);
      upstreamCount = this._countNodes(upstream);
    }

    // Trace downstream (find rows that reference this row's PK)
    if (direction === 'both' || direction === 'down') {
      const downstream = await this._traceDownstream(
        table, pkColumn, pkValue, fkMap, maxDepth, new Set()
      );
      root.children.push(...downstream);
      downstreamCount = this._countNodes(downstream);
    }

    return { root, upstreamCount, downstreamCount };
  }

  /** Follow FK columns in the current row to find parent rows. */
  private async _traceUpstream(
    table: string,
    row: Record<string, unknown>,
    fkMap: IFkMap,
    depth: number,
    visited: Set<string>,
  ): Promise<ILineageNode[]> {
    if (depth <= 0) return [];

    const nodes: ILineageNode[] = [];
    const outgoing = fkMap.outgoing.get(table) ?? [];

    for (const fk of outgoing) {
      const fkValue = row[fk.fromColumn];
      if (fkValue === null || fkValue === undefined) continue;

      const key = `${fk.toTable}:${fkValue}`;
      if (visited.has(key)) continue;
      visited.add(key);

      const parentRow = await this._fetchRow(fk.toTable, fk.toColumn, fkValue);
      if (!parentRow) continue;

      const parentPk = this._getPkValue(parentRow, fk.toTable, fkMap);
      const node: ILineageNode = {
        table: fk.toTable,
        pkColumn: fk.toColumn,
        pkValue: parentPk,
        preview: this._preview(parentRow),
        direction: 'upstream',
        fkColumn: fk.fromColumn,
        children: [],
      };

      // Recurse upward
      node.children = await this._traceUpstream(
        fk.toTable, parentRow, fkMap, depth - 1, visited
      );

      nodes.push(node);
    }

    return nodes;
  }

  /** Find rows in other tables that reference this row's PK. */
  private async _traceDownstream(
    table: string,
    pkColumn: string,
    pkValue: unknown,
    fkMap: IFkMap,
    depth: number,
    visited: Set<string>,
  ): Promise<ILineageNode[]> {
    if (depth <= 0) return [];

    const nodes: ILineageNode[] = [];
    const incoming = fkMap.incoming.get(table) ?? [];

    for (const fk of incoming) {
      const sql = `
        SELECT * FROM "${fk.fromTable}"
        WHERE "${fk.fromColumn}" = ${sqlLiteral(pkValue)}
        LIMIT 50
      `;

      try {
        const result = await this._client.sql(sql);
        for (const row of result.rows) {
          const r = row as Record<string, unknown>;
          const childPk = this._getPkValue(r, fk.fromTable, fkMap);
          const key = `${fk.fromTable}:${childPk}`;
          if (visited.has(key)) continue;
          visited.add(key);

          const childPkCol = this._getPkColumn(fk.fromTable, fkMap);
          const node: ILineageNode = {
            table: fk.fromTable,
            pkColumn: childPkCol,
            pkValue: childPk,
            preview: this._preview(r),
            direction: 'downstream',
            fkColumn: fk.fromColumn,
            children: [],
          };

          // Recurse downward
          node.children = await this._traceDownstream(
            fk.fromTable, childPkCol, childPk, fkMap, depth - 1, visited
          );

          nodes.push(node);
        }
      } catch {
        // Skip tables that error
      }
    }

    return nodes;
  }

  /** Build bidirectional FK map for quick lookup. */
  private async _buildFkMap(
    tables: TableMetadata[],
  ): Promise<IFkMap> {
    const outgoing = new Map<string, IFkRef[]>();
    const incoming = new Map<string, IFkRef[]>();

    for (const table of tables) {
      if (table.name.startsWith('sqlite_')) continue;
      const fks = await this._client.tableFkMeta(table.name);

      for (const fk of fks) {
        const ref: IFkRef = {
          fromTable: table.name,
          fromColumn: fk.from,
          toTable: fk.table,
          toColumn: fk.to,
        };

        const out = outgoing.get(table.name) ?? [];
        out.push(ref);
        outgoing.set(table.name, out);

        const inc = incoming.get(fk.table) ?? [];
        inc.push(ref);
        incoming.set(fk.table, inc);
      }
    }

    return { outgoing, incoming };
  }

  private async _fetchRow(
    table: string,
    column: string,
    value: unknown,
  ): Promise<Record<string, unknown> | null> {
    const sql = `SELECT * FROM "${table}" WHERE "${column}" = ${sqlLiteral(value)} LIMIT 1`;
    try {
      const result = await this._client.sql(sql);
      return (result.rows[0] as Record<string, unknown>) ?? null;
    } catch {
      return null;
    }
  }

  private _preview(row: Record<string, unknown>): Record<string, unknown> {
    const keys = Object.keys(row).slice(0, 5);
    return Object.fromEntries(keys.map(k => [k, row[k]]));
  }

  private _countNodes(nodes: ILineageNode[]): number {
    let count = nodes.length;
    for (const node of nodes) {
      count += this._countNodes(node.children);
    }
    return count;
  }
}

interface IFkRef {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

interface IFkMap {
  outgoing: Map<string, IFkRef[]>;
  incoming: Map<string, IFkRef[]>;
}
```

### DELETE SQL Generator

```typescript
function generateDeleteSql(lineage: ILineageResult): string {
  const statements: string[] = [];
  const visited = new Set<string>();

  // Collect all downstream nodes (depth-first, leaves first)
  function collect(node: ILineageNode): void {
    for (const child of node.children) {
      if (child.direction === 'downstream') {
        collect(child);
      }
    }
    const key = `${node.table}:${node.pkValue}`;
    if (!visited.has(key) && node.direction !== 'upstream') {
      visited.add(key);
      statements.push(
        `DELETE FROM "${node.table}" WHERE "${node.pkColumn}" = ${sqlLiteral(node.pkValue)};`
      );
    }
  }

  collect(lineage.root);
  return `-- Safe deletion order (children first)\n${statements.join('\n')}`;
}
```

### Webview Message Protocol

Webview → Extension:
```typescript
{ command: 'trace', table: string, pkColumn: string, pkValue: unknown, depth: number, direction: string }
{ command: 'navigateToRow', table: string, pkColumn: string, pkValue: unknown }
{ command: 'generateDelete' }
{ command: 'exportJson' }
```

Extension → Webview:
```typescript
{ command: 'result', lineage: ILineageResult }
{ command: 'deleteSql', sql: string }
{ command: 'error', message: string }
```

## Server-Side Changes

None.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.traceLineage",
        "title": "Saropa Drift Advisor: Trace Data Lineage",
        "icon": "$(git-merge)"
      }
    ],
    "menus": {
      "view/item/context": [{
        "command": "driftViewer.traceLineage",
        "when": "viewItem == driftTable",
        "group": "5_tools"
      }]
    }
  }
}
```

## Wiring in extension.ts

```typescript
const lineageTracer = new LineageTracer(client);

context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.traceLineage', async (item?: TableItem) => {
    const table = item?.tableMetadata.name ?? await pickTable(client);
    if (!table) return;

    const meta = await client.schemaMetadata();
    const tableMeta = meta.tables.find(t => t.name === table);
    if (!tableMeta) return;

    const pkCol = tableMeta.columns.find(c => c.pk)?.name ?? 'rowid';
    const pkInput = await vscode.window.showInputBox({
      prompt: `Enter ${pkCol} value to trace`,
    });
    if (!pkInput) return;

    const pkValue = isNaN(Number(pkInput)) ? pkInput : Number(pkInput);
    LineagePanel.createOrShow(context.extensionUri, lineageTracer, table, pkCol, pkValue);
  })
);
```

## Testing

- `lineage-tracer.test.ts`:
  - Row with no FKs → root only, no upstream/downstream
  - Row with FK → upstream parent found
  - Row referenced by child → downstream children found
  - Depth limit prevents infinite traversal
  - Circular references handled via visited set
  - Upstream direction only → no downstream nodes
  - Downstream direction only → no upstream nodes
  - Multi-level traversal (grandparent → parent → child → grandchild)
  - Missing row → gracefully handled (null)
  - Downstream capped at 50 per FK reference
  - FK map built correctly for bidirectional lookup

## Known Limitations

- Downstream search limited to 50 rows per FK reference to prevent explosion
- Depth limit prevents full traversal of deep hierarchies (default 3)
- Self-referencing FKs (e.g., `parent_id`) may produce deep recursion up to depth limit
- Builds FK map by querying all tables on each trace — could be cached
- No interactive graph visualization — uses indented tree view only
- DELETE SQL generator doesn't handle ON DELETE CASCADE (may produce redundant statements)
- No support for composite foreign keys
- Large fan-out (table with 1000 child rows) truncated at 50
