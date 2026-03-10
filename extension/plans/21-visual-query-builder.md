# Feature 21: Visual Query Builder

## What It Does

A drag-and-drop webview panel where users build SQL queries visually: pick tables, draw joins, add WHERE filters with dropdowns, choose columns, apply GROUP BY with aggregation pickers. Live SQL preview updates as you build. Execute the query and see results side-by-side.

## User Experience

1. Command palette → "Drift Viewer: Visual Query Builder" or right-click table → "Build Query From…"
2. A webview panel opens with three zones:

```
╔═══════════════════════════════════════════════════════════╗
║  VISUAL QUERY BUILDER                                     ║
╠═══════════════════════════════════════════════════════════╣
║  ┌─────────────┐    ┌────────────────────────────────┐   ║
║  │ TABLES       │    │ CANVAS                         │   ║
║  │              │    │                                 │   ║
║  │  ☐ users     │    │  ┌─────────┐    ┌──────────┐  │   ║
║  │  ☐ orders    │    │  │ users   │───▶│ orders   │  │   ║
║  │  ☐ products  │    │  │ ☑ id    │    │ ☑ id     │  │   ║
║  │  ☐ categories│    │  │ ☑ name  │    │ ☑ total  │  │   ║
║  │              │    │  │ ☐ email │    │ ☑ status │  │   ║
║  │              │    │  └─────────┘    └──────────┘  │   ║
║  └─────────────┘    └────────────────────────────────┘   ║
║                                                           ║
║  ┌─────────────────────────────────────────────────────┐ ║
║  │ WHERE   users.name LIKE [%alice%]  [+ Add Filter]  │ ║
║  │ GROUP BY  users.name                                │ ║
║  │ ORDER BY  orders.total DESC                         │ ║
║  │ LIMIT     [100]                                     │ ║
║  └─────────────────────────────────────────────────────┘ ║
║                                                           ║
║  ┌─ SQL Preview ────────────────────────────────────────┐ ║
║  │ SELECT "users"."name", SUM("orders"."total")        │ ║
║  │ FROM "users"                                         │ ║
║  │ JOIN "orders" ON "orders"."user_id" = "users"."id"  │ ║
║  │ WHERE "users"."name" LIKE '%alice%'                  │ ║
║  │ GROUP BY "users"."name"                              │ ║
║  │ ORDER BY "orders"."total" DESC                       │ ║
║  │ LIMIT 100                                            │ ║
║  └──────────────────────────────────────────────────────┘ ║
║                                                           ║
║  [Run Query]  [Copy SQL]  [Open in Notebook]             ║
╚═══════════════════════════════════════════════════════════╝
```

3. **Adding tables**: Click a table in the sidebar → it appears as a card on the canvas
4. **Joins**: Drag from a column in one table card to a column in another → join line appears with type selector (INNER/LEFT/RIGHT)
5. **Selecting columns**: Check/uncheck columns in each table card
6. **Filters**: Click "+ Add Filter" → pick column → pick operator (=, !=, <, >, LIKE, IN, IS NULL, IS NOT NULL) → enter value
7. **Aggregations**: When GROUP BY is set, non-grouped columns show aggregation picker (SUM, COUNT, AVG, MIN, MAX)
8. **SQL Preview**: Updates live as the user modifies the visual query
9. **Run Query**: Executes via `POST /api/sql` and shows results in a table below

## New Files

```
extension/src/
  query-builder/
    query-builder-panel.ts     # Webview panel lifecycle (singleton)
    query-builder-html.ts      # HTML/CSS/JS template for the interactive builder
    query-model.ts             # Data model representing the visual query
    sql-renderer.ts            # Converts query model to SQL string
extension/src/test/
  query-model.test.ts
  sql-renderer.test.ts
```

## Dependencies

- `api-client.ts` — `schemaMetadata()` for table list, `tableFkMeta()` for join suggestions, `sql()` for execution
- `panel.ts` — base webview panel pattern

## Architecture

### Query Model

Pure TypeScript data model, no VS Code dependency:

```typescript
interface IQueryModel {
  tables: IQueryTable[];
  joins: IQueryJoin[];
  selectedColumns: ISelectedColumn[];
  filters: IQueryFilter[];
  groupBy: string[];          // ["users.name"]
  orderBy: IOrderByClause[];
  limit: number | null;
}

interface IQueryTable {
  name: string;
  alias: string;             // auto-generated: t0, t1, t2...
  columns: ColumnMetadata[];
}

interface IQueryJoin {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  type: 'INNER' | 'LEFT' | 'RIGHT';
}

interface ISelectedColumn {
  table: string;
  column: string;
  aggregation?: 'SUM' | 'COUNT' | 'AVG' | 'MIN' | 'MAX';
  alias?: string;
}

interface IQueryFilter {
  id: string;
  table: string;
  column: string;
  operator: '=' | '!=' | '<' | '>' | '<=' | '>=' | 'LIKE' | 'IN' | 'IS NULL' | 'IS NOT NULL';
  value?: string;             // undefined for IS NULL / IS NOT NULL
  conjunction: 'AND' | 'OR';
}

interface IOrderByClause {
  table: string;
  column: string;
  direction: 'ASC' | 'DESC';
}
```

### SQL Renderer

Converts the model to valid SQLite SQL:

```typescript
class SqlRenderer {
  render(model: IQueryModel): string {
    const parts: string[] = [];

    // SELECT
    const cols = model.selectedColumns.map(c => {
      const ref = `"${c.table}"."${c.column}"`;
      if (c.aggregation) {
        const alias = c.alias ?? `${c.aggregation.toLowerCase()}_${c.column}`;
        return `${c.aggregation}(${ref}) AS "${alias}"`;
      }
      return ref;
    });
    parts.push(`SELECT ${cols.length > 0 ? cols.join(', ') : '*'}`);

    // FROM
    parts.push(`FROM "${model.tables[0].name}"`);

    // JOINs
    for (const join of model.joins) {
      parts.push(
        `${join.type} JOIN "${join.toTable}" ON "${join.toTable}"."${join.toColumn}" = "${join.fromTable}"."${join.fromColumn}"`
      );
    }

    // WHERE
    if (model.filters.length > 0) {
      const conditions = model.filters.map((f, i) => {
        const ref = `"${f.table}"."${f.column}"`;
        const prefix = i === 0 ? 'WHERE' : f.conjunction;
        if (f.operator === 'IS NULL' || f.operator === 'IS NOT NULL') {
          return `${prefix} ${ref} ${f.operator}`;
        }
        return `${prefix} ${ref} ${f.operator} ${sqlLiteral(f.value)}`;
      });
      parts.push(conditions.join('\n'));
    }

    // GROUP BY
    if (model.groupBy.length > 0) {
      parts.push(`GROUP BY ${model.groupBy.map(g => {
        const [t, c] = g.split('.');
        return `"${t}"."${c}"`;
      }).join(', ')}`);
    }

    // ORDER BY
    if (model.orderBy.length > 0) {
      parts.push(`ORDER BY ${model.orderBy.map(o =>
        `"${o.table}"."${o.column}" ${o.direction}`
      ).join(', ')}`);
    }

    // LIMIT
    if (model.limit !== null) parts.push(`LIMIT ${model.limit}`);

    return parts.join('\n');
  }
}
```

### Webview Message Protocol

**Webview → Extension:**
```typescript
{ command: 'addTable', table: string }
{ command: 'removeTable', table: string }
{ command: 'addJoin', join: IQueryJoin }
{ command: 'removeJoin', index: number }
{ command: 'toggleColumn', table: string, column: string, selected: boolean }
{ command: 'setAggregation', table: string, column: string, aggregation: string | null }
{ command: 'addFilter', filter: Omit<IQueryFilter, 'id'> }
{ command: 'removeFilter', id: string }
{ command: 'setGroupBy', columns: string[] }
{ command: 'setOrderBy', clauses: IOrderByClause[] }
{ command: 'setLimit', limit: number | null }
{ command: 'runQuery' }
{ command: 'copySql' }
{ command: 'openInNotebook' }
```

**Extension → Webview:**
```typescript
{ command: 'init', tables: TableMetadata[], fks: IFkContext[] }
{ command: 'sqlPreview', sql: string }
{ command: 'queryResult', columns: string[], rows: object[], rowCount: number }
{ command: 'queryError', message: string }
```

### Auto-Join Suggestions

When a second table is added, the builder checks FK metadata and auto-suggests joins:

```typescript
function suggestJoins(tables: string[], fks: IFkContext[]): IQueryJoin[] {
  return fks.filter(fk =>
    tables.includes(fk.fromTable) && tables.includes(fk.toTable)
  ).map(fk => ({
    fromTable: fk.fromTable,
    fromColumn: fk.fromColumn,
    toTable: fk.toTable,
    toColumn: fk.toColumn,
    type: 'LEFT' as const,
  }));
}
```

### Canvas Rendering (HTML/JS)

Table cards are positioned using CSS Grid or absolute positioning. Join lines are drawn using SVG `<line>` elements between column endpoints. The JS uses vanilla DOM manipulation (no framework) to keep the bundle small.

## Server-Side Changes

None. Uses existing `schemaMetadata()`, `tableFkMeta()`, and `sql()` endpoints.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.openQueryBuilder",
        "title": "Drift Viewer: Visual Query Builder",
        "icon": "$(layout)"
      },
      {
        "command": "driftViewer.buildQueryFromTable",
        "title": "Drift Viewer: Build Query From Table"
      }
    ],
    "menus": {
      "view/item/context": [{
        "command": "driftViewer.buildQueryFromTable",
        "when": "viewItem == driftTable",
        "group": "7_query"
      }],
      "view/title": [{
        "command": "driftViewer.openQueryBuilder",
        "when": "view == driftViewer.databaseExplorer && driftViewer.serverConnected",
        "group": "navigation"
      }]
    }
  }
}
```

## Wiring in extension.ts

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.openQueryBuilder', () => {
    QueryBuilderPanel.createOrShow(context.extensionUri, client);
  }),

  vscode.commands.registerCommand('driftViewer.buildQueryFromTable', (item: TableItem) => {
    QueryBuilderPanel.createOrShow(context.extensionUri, client, item.tableMetadata.name);
  })
);
```

## Testing

- `query-model.test.ts`: test model mutations (add/remove table, toggle column, add filter, etc.)
- `sql-renderer.test.ts`:
  - Single table, all columns → `SELECT * FROM "t"`
  - Two tables with join → correct JOIN clause
  - Filters with different operators → correct WHERE
  - GROUP BY with aggregations → correct SELECT + GROUP BY
  - ORDER BY + LIMIT → correct clauses
  - Empty model → `SELECT * FROM "t"`
  - SQL injection in filter values → properly escaped

## Known Limitations

- No HAVING clause support (only WHERE)
- No subquery or UNION support — single query only
- Canvas drag-and-drop is click-based (not true HTML5 DnD) for simplicity
- No query save/load — ephemeral per session (copy SQL to persist)
- Join lines may overlap visually with many tables — no layout algorithm
- No column type validation in filters (user can compare TEXT with integer literal)
- Maximum ~10 tables on canvas before it becomes unwieldy
