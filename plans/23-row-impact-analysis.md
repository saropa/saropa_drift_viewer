# Feature 23: Row Impact Analysis

## What It Does

Click any row in a table and see a visual graph of every related row across all tables via foreign key relationships. Shows both inbound references (what depends on this row) and outbound references (what this row depends on). Answers: "If I delete this row, what breaks?"

## User Experience

1. Right-click a row in the table data viewer → "Analyze Row Impact"
2. Or: command palette → "Saropa Drift Advisor: Analyze Row Impact" → pick table → enter PK value
3. A webview panel opens showing an interactive impact tree:

```
╔═══════════════════════════════════════════════════════════╗
║  ROW IMPACT ANALYSIS                                      ║
║  users.id = 42 ("Alice Smith")                           ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  ┌─ This row depends on (outbound FKs) ──────────────┐  ║
║  │  └─ departments.id = 5 ("Engineering")             │  ║
║  │  └─ roles.id = 2 ("Admin")                         │  ║
║  └────────────────────────────────────────────────────┘  ║
║                                                           ║
║  ┌─ Rows that depend on this (inbound FKs) ──────────┐  ║
║  │  ▼ orders (12 rows)                                │  ║
║  │  │  ├─ id=101 (total: $49.99, status: "shipped")  │  ║
║  │  │  │   └─ order_items (3 rows)                    │  ║
║  │  │  │       ├─ id=201 (product_id=7, qty=2)       │  ║
║  │  │  │       ├─ id=202 (product_id=12, qty=1)      │  ║
║  │  │  │       └─ id=203 (product_id=3, qty=5)       │  ║
║  │  │  ├─ id=102 (total: $129.00, status: "pending") │  ║
║  │  │  │   └─ order_items (1 row)                     │  ║
║  │  │  └─ … 10 more                                   │  ║
║  │  ▶ sessions (4 rows)                               │  ║
║  │  ▶ audit_log (23 rows)                             │  ║
║  └────────────────────────────────────────────────────┘  ║
║                                                           ║
║  ┌─ Summary ─────────────────────────────────────────┐   ║
║  │  Cascade delete would affect:                      │   ║
║  │    orders:      12 rows                            │   ║
║  │    order_items: 28 rows                            │   ║
║  │    sessions:     4 rows                            │   ║
║  │    audit_log:   23 rows                            │   ║
║  │    ─────────────────────                           │   ║
║  │    TOTAL:       67 rows across 4 tables            │   ║
║  └────────────────────────────────────────────────────┘  ║
║                                                           ║
║  [Generate DELETE SQL]  [Export JSON]                     ║
╚═══════════════════════════════════════════════════════════╝
```

4. Expand/collapse child nodes to explore the dependency tree
5. Click any row to jump to it in the table data viewer
6. "Generate DELETE SQL" produces a safe deletion script with correct FK order

## New Files

### Server-Side (Dart)

```
lib/src/server/
  impact_handler.dart         # GET /api/impact/:table/:pk endpoint
```

### Extension-Side (TypeScript)

```
extension/src/
  impact/
    impact-panel.ts           # Webview panel lifecycle
    impact-html.ts            # HTML/CSS/JS template for the tree
    impact-analyzer.ts        # Recursively walks FK relationships
    impact-types.ts           # Shared interfaces
extension/src/test/
  impact-analyzer.test.ts
```

## Dependencies

- `api-client.ts` — `schemaMetadata()`, `tableFkMeta()`, `sql()` for querying related rows
- FK metadata must include reverse lookups (which tables reference this table)

## Architecture

### Server-Side: Impact Handler

New endpoint that walks FK relationships recursively:

```dart
class ImpactHandler {
  final ServerContext _ctx;

  /// GET /api/impact?table=users&pk=42&depth=3
  Future<void> handle(HttpRequest request, HttpResponse response) async {
    final table = request.uri.queryParameters['table']!;
    final pkValue = request.uri.queryParameters['pk']!;
    final maxDepth = int.tryParse(
      request.uri.queryParameters['depth'] ?? '3',
    ) ?? 3;

    // Get outbound FKs (what this row depends on)
    final outbound = await _resolveOutbound(table, pkValue);

    // Get inbound FKs (what depends on this row) - recursive
    final inbound = await _resolveInbound(table, pkValue, maxDepth);

    _ctx.setJsonHeaders(response);
    response.write(jsonEncode({
      'root': {'table': table, 'pk': pkValue},
      'outbound': outbound,
      'inbound': inbound,
      'summary': _summarize(inbound),
    }));
    await response.close();
  }

  Future<List<Map<String, dynamic>>> _resolveInbound(
    String table,
    String pkValue,
    int depth,
  ) async {
    if (depth <= 0) return [];

    // Find all tables that have FKs pointing to this table
    final fks = await _getReverseFks(table);
    final results = <Map<String, dynamic>>[];

    for (final fk in fks) {
      // Query rows in the child table that reference this PK
      final rows = await _ctx.instrumentedQuery(
        'SELECT * FROM "${fk.fromTable}" '
        'WHERE "${fk.fromColumn}" = ${ServerContext.sqlLiteral(pkValue)} '
        'LIMIT 100',
      );

      if (rows.isEmpty) continue;

      // Get PK column of child table
      final childPk = await _getPkColumn(fk.fromTable);

      // Recursively resolve each child row's dependencies
      final children = <Map<String, dynamic>>[];
      for (final row in rows.take(10)) {  // limit recursion breadth
        final childPkValue = row[childPk]?.toString() ?? '';
        final grandchildren = await _resolveInbound(
          fk.fromTable, childPkValue, depth - 1,
        );
        children.add({
          'row': row,
          'children': grandchildren,
        });
      }

      results.add({
        'table': fk.fromTable,
        'column': fk.fromColumn,
        'totalCount': rows.length,
        'rows': children,
      });
    }

    return results;
  }
}
```

### Reverse FK Lookup

The existing FK metadata endpoint returns outbound FKs (this table's columns → other tables). We need reverse lookups. Add to `schema_handler.dart`:

```dart
/// GET /api/schema/reverse-fks?table=users
/// Returns all FKs from OTHER tables that point TO this table.
Future<void> handleReverseFks(HttpRequest request, HttpResponse response) async {
  final table = request.uri.queryParameters['table']!;
  final allTables = await ServerContext.getTableNames(_ctx.instrumentedQuery);
  final reverseFks = <Map<String, dynamic>>[];

  for (final t in allTables) {
    final fks = await _ctx.instrumentedQuery(
      'PRAGMA foreign_key_list("$t")',
    );
    for (final fk in fks) {
      if (fk['table'] == table) {
        reverseFks.add({
          'fromTable': t,
          'fromColumn': fk['from'],
          'toTable': table,
          'toColumn': fk['to'],
        });
      }
    }
  }

  _ctx.setJsonHeaders(response);
  response.write(jsonEncode({'reverseFks': reverseFks}));
  await response.close();
}
```

### Extension-Side: Impact Analyzer

Consumes the server response and structures it for rendering:

```typescript
interface IImpactNode {
  table: string;
  pkColumn: string;
  pkValue: unknown;
  rowPreview: Record<string, unknown>;  // first 3 columns for display
  children: IImpactBranch[];
}

interface IImpactBranch {
  table: string;
  fkColumn: string;
  totalCount: number;
  rows: IImpactNode[];     // first N rows expanded
  truncated: boolean;       // true if totalCount > rows.length
}

interface IImpactSummary {
  tables: { name: string; rowCount: number }[];
  totalRows: number;
}
```

### Delete SQL Generator

Generates safe deletion SQL in correct FK order (leaves first, root last):

```typescript
function generateDeleteSql(root: IImpactNode): string {
  const lines: string[] = ['-- CASCADE DELETE script (review before executing!)'];
  const visited = new Set<string>();

  // Post-order traversal: delete children before parents
  function visit(node: IImpactNode): void {
    const key = `${node.table}:${node.pkValue}`;
    if (visited.has(key)) return;
    visited.add(key);

    for (const branch of node.children) {
      for (const child of branch.rows) visit(child);
    }
    lines.push(`DELETE FROM "${node.table}" WHERE "${node.pkColumn}" = ${sqlLiteral(node.pkValue)};`);
  }

  visit(root);
  return lines.join('\n');
}
```

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.analyzeRowImpact",
        "title": "Saropa Drift Advisor: Analyze Row Impact",
        "icon": "$(type-hierarchy)"
      }
    ],
    "menus": {
      "view/item/context": [{
        "command": "driftViewer.analyzeRowImpact",
        "when": "viewItem == driftTable",
        "group": "5_analysis"
      }]
    },
    "configuration": {
      "properties": {
        "driftViewer.impact.maxDepth": {
          "type": "number",
          "default": 3,
          "description": "Maximum FK traversal depth for impact analysis."
        },
        "driftViewer.impact.maxRowsPerTable": {
          "type": "number",
          "default": 100,
          "description": "Maximum rows to load per table in impact analysis."
        }
      }
    }
  }
}
```

## Wiring in extension.ts

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.analyzeRowImpact', async (item?: TableItem) => {
    const table = item?.tableMetadata.name ?? await pickTable(client);
    if (!table) return;

    const pkValue = await vscode.window.showInputBox({
      prompt: `Enter primary key value for "${table}"`,
      placeHolder: 'e.g., 42',
    });
    if (!pkValue) return;

    const config = vscode.workspace.getConfiguration('driftViewer.impact');
    const depth = config.get('maxDepth', 3);

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Analyzing row impact…' },
      async () => {
        const impact = await client.rowImpact(table, pkValue, depth);
        ImpactPanel.createOrShow(context.extensionUri, impact);
      }
    );
  })
);
```

## Testing

### Dart Tests
- `impact_handler_test.dart`: test recursive FK traversal, depth limiting, circular FK handling
- Test reverse FK lookup accuracy

### Extension Tests
- `impact-analyzer.test.ts`: test tree structure, summary calculation, delete SQL generation order
- Test truncation when exceeding maxRowsPerTable

## Known Limitations

- Depth limit (default 3) means deep FK chains are truncated — user can increase but at performance cost
- Breadth limit (10 expanded rows per branch) means large result sets show counts but not all rows
- Circular FK references are detected and stopped (no infinite loops) but display as "[circular]"
- Performance degrades with wide schemas (many tables with FKs to the target table)
- Reverse FK lookup iterates all tables with PRAGMA — slow for schemas with 100+ tables
- Only supports single-column PKs — composite PKs need manual SQL
- Delete SQL doesn't handle ON DELETE CASCADE (it generates explicit DELETEs regardless)
