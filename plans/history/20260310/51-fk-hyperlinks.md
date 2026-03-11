# Feature 51: FK Hyperlinks — DONE

## What It Does

Make foreign key values clickable in table data views. When a column is a foreign key, its values render as hyperlinks. Click a value to navigate to the referenced row in the parent table. Navigate relationships like browsing the web — with back/forward history.

## User Experience

1. Open any table that has FK columns
2. FK values appear as blue underlined links
3. Click a value → the panel navigates to the referenced row in the target table
4. A breadcrumb trail shows navigation history
5. Click the back arrow to return to the previous table/row

```
╔══════════════════════════════════════════════════════════════╗
║  TABLE: orders                                               ║
║  ← Back                                                     ║
║  orders > users (id=42)                                      ║
╠══════════════════════════════════════════════════════════════╣
║  id │ user_id    │ total  │ status    │ created_at           ║
║  ───┼────────────┼────────┼───────────┼──────────────────── ║
║  91 │ [42] →     │ 59.99  │ shipped   │ 2026-03-08           ║
║  92 │ [42] →     │ 120.00 │ pending   │ 2026-03-09           ║
║  93 │ [17] →     │ 35.50  │ delivered │ 2026-03-10           ║
║                                                              ║
║  Click [42] to navigate to users WHERE id = 42               ║
╚══════════════════════════════════════════════════════════════╝
```

After clicking `[42]`:

```
╔══════════════════════════════════════════════════════════════╗
║  TABLE: users                                                ║
║  ← Back to orders                                            ║
║  orders > users (id=42)                                      ║
╠══════════════════════════════════════════════════════════════╣
║  id │ email             │ name    │ active │ created_at       ║
║  ───┼───────────────────┼─────────┼────────┼──────────────── ║
║  42 │ alice@example.com │ Alice   │ 1      │ 2026-01-15       ║
╚══════════════════════════════════════════════════════════════╝
```

## New Files

```
extension/src/navigation/
  fk-navigator.ts          # Navigation state, history stack, FK resolution
  fk-navigator-types.ts    # Interfaces
extension/src/test/
  fk-navigator.test.ts
```

## Modified Files

```
extension/src/panel.ts                    # Inject FK navigation bridge script
extension/src/tree/drift-tree-provider.ts # Provide FK metadata to navigator
```

## Dependencies

- `api-client.ts` — `tableFkMeta()`, `sql()`
- `schemaMetadata()` — to identify FK columns before rendering

## Architecture

### FK Navigator

Manages navigation state and resolves FK targets:

```typescript
interface INavigationEntry {
  table: string;
  filter?: { column: string; value: unknown };
}

interface IFkLink {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

class FkNavigator {
  private readonly _history: INavigationEntry[] = [];
  private _cursor = -1;
  private _fkMap = new Map<string, IFkLink[]>();

  constructor(private readonly _client: DriftApiClient) {}

  async loadFkMetadata(): Promise<void> {
    const meta = await this._client.schemaMetadata();
    this._fkMap.clear();
    for (const table of meta) {
      const fks = await this._client.tableFkMeta(table.name);
      this._fkMap.set(table.name, fks.map(fk => ({
        fromTable: table.name,
        fromColumn: fk.fromColumn,
        toTable: fk.toTable,
        toColumn: fk.toColumn,
      })));
    }
  }

  getFkColumns(table: string): IFkLink[] {
    return this._fkMap.get(table) ?? [];
  }

  navigate(entry: INavigationEntry): void {
    this._history.splice(this._cursor + 1);
    this._history.push(entry);
    this._cursor = this._history.length - 1;
  }

  back(): INavigationEntry | undefined {
    if (this._cursor <= 0) return undefined;
    this._cursor--;
    return this._history[this._cursor];
  }

  forward(): INavigationEntry | undefined {
    if (this._cursor >= this._history.length - 1) return undefined;
    this._cursor++;
    return this._history[this._cursor];
  }

  get canGoBack(): boolean { return this._cursor > 0; }
  get canGoForward(): boolean { return this._cursor < this._history.length - 1; }
  get breadcrumbs(): INavigationEntry[] { return this._history.slice(0, this._cursor + 1); }
}
```

### Panel Integration

The main viewer panel (`DriftViewerPanel`) injects a bridge script that:

1. On table render, queries FK metadata for the current table
2. Wraps FK column values in `<a data-fk-table="users" data-fk-column="id" data-fk-value="42">` tags
3. Handles click events on FK links → posts message to extension
4. Extension resolves the target → runs `SELECT * FROM {toTable} WHERE {toColumn} = {value}`
5. Sends result back to render the target table with filter applied

### Webview Message Protocol

Webview → Extension:
```typescript
{ command: 'fkNavigate', toTable: string, toColumn: string, value: unknown }
{ command: 'fkBack' }
{ command: 'fkForward' }
{ command: 'fkGetColumns', table: string }
```

Extension → Webview:
```typescript
{ command: 'fkColumns', table: string, fkColumns: IFkLink[] }
{ command: 'fkNavigated', table: string, filter: { column: string, value: unknown }, rows: unknown[], columns: string[] }
{ command: 'fkBreadcrumbs', entries: INavigationEntry[], canBack: boolean, canForward: boolean }
```

## Server-Side Changes

None. Uses existing `tableFkMeta()` and `sql()`.

## package.json Contributions

```jsonc
{
  "contributes": {
    "configuration": {
      "properties": {
        "driftViewer.fkHyperlinks.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Show foreign key values as clickable links in table data views."
        }
      }
    }
  }
}
```

## Testing

- `fk-navigator.test.ts`:
  - Navigate to table → appears in history
  - Back returns previous entry
  - Forward returns next entry after back
  - Navigate after back truncates forward history
  - `canGoBack` / `canGoForward` report correctly
  - Breadcrumbs reflect current history up to cursor
  - FK metadata loads and maps correctly
  - `getFkColumns` returns empty array for tables with no FKs
  - Multiple FK columns on same table all resolved
  - Composite FKs not supported (single-column only) — documented limitation

## Known Limitations

- Composite foreign keys (multi-column) are not supported — only single-column FKs become hyperlinks
- Navigation history is session-only — not persisted
- NULL FK values are not clickable
- The bridge script must detect FK columns from metadata before rendering, adding a small delay on first table load
- Deep navigation chains (>20 hops) are not capped but the breadcrumb trail may overflow
