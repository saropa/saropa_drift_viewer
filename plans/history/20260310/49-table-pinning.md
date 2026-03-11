# Feature 49: Table Pinning — DONE

## What It Does

Pin frequently-used tables to the top of the Database Explorer tree view. Pinned tables appear in a collapsible "Pinned" group above the regular table list. Pins persist per workspace across sessions.

## User Experience

1. Right-click any table in the tree → "Pin Table"
2. Pinned tables appear at the top in a "Pinned" group with a pin icon
3. Right-click a pinned table → "Unpin Table"
4. Pinned tables still show row counts, annotations, and all context menu actions

```
╔══════════════════════════════════════════════╗
║  DATABASE EXPLORER                           ║
╠══════════════════════════════════════════════╣
║  ● Connected — 8 tables                     ║
║                                              ║
║  📌 Pinned                                   ║
║  ├─ 📋 users (1,204 rows)                   ║
║  │  ├─ 🔑 id INTEGER                        ║
║  │  ├─ 🔤 email TEXT                         ║
║  │  └─ ...                                   ║
║  └─ 📋 orders (5,891 rows)                  ║
║                                              ║
║  📋 audit_log (12,403 rows)                  ║
║  📋 categories (24 rows)                     ║
║  📋 order_items (15,220 rows)                ║
║  📋 products (312 rows)                      ║
║  📋 sessions (89 rows)                       ║
║  📋 settings (7 rows)                        ║
╚══════════════════════════════════════════════╝
```

## New Files

```
extension/src/tree/
  pin-store.ts          # Workspace-state persistence for pinned tables
extension/src/test/
  pin-store.test.ts
```

## Modified Files

```
extension/src/tree/drift-tree-provider.ts   # Sort pinned tables to top
extension/src/tree/tree-items.ts            # PinnedGroupItem, pin icon on TableItem
extension/package.json                      # Commands + context menus
extension/src/extension.ts                  # Register pin/unpin commands
```

## Dependencies

- `vscode.Memento` (workspace state) — for persistence
- `drift-tree-provider.ts` — for tree refresh

## Architecture

### Pin Store

Thin wrapper over workspace state:

```typescript
const PIN_KEY = 'driftViewer.pinnedTables';

class PinStore {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly _state: vscode.Memento) {}

  get pinnedNames(): ReadonlySet<string> {
    return new Set(this._state.get<string[]>(PIN_KEY, []));
  }

  async pin(tableName: string): Promise<void> {
    const pins = new Set(this.pinnedNames);
    pins.add(tableName);
    await this._state.update(PIN_KEY, [...pins]);
    this._onDidChange.fire();
  }

  async unpin(tableName: string): Promise<void> {
    const pins = new Set(this.pinnedNames);
    pins.delete(tableName);
    await this._state.update(PIN_KEY, [...pins]);
    this._onDidChange.fire();
  }

  isPinned(tableName: string): boolean {
    return this.pinnedNames.has(tableName);
  }
}
```

### Tree Provider Changes

In `getChildren()` at root level, partition tables into pinned and unpinned:

```typescript
private _buildRootChildren(tables: TableMetadata[]): vscode.TreeItem[] {
  const items: vscode.TreeItem[] = [this._connectionItem];

  const pinned = tables.filter(t => this._pinStore.isPinned(t.name));
  const unpinned = tables.filter(t => !this._pinStore.isPinned(t.name));

  if (pinned.length > 0) {
    items.push(new PinnedGroupItem(pinned.length));
    items.push(...pinned.map(t => this._makeTableItem(t, true)));
  }

  items.push(...unpinned.map(t => this._makeTableItem(t, false)));
  return items;
}
```

### Tree Items

```typescript
class PinnedGroupItem extends vscode.TreeItem {
  constructor(count: number) {
    super('Pinned', vscode.TreeItemCollapsibleState.Expanded);
    this.description = `${count} table${count === 1 ? '' : 's'}`;
    this.iconPath = new vscode.ThemeIcon('pin');
    this.contextValue = 'pinnedGroup';
  }
}
```

`TableItem` gains a `pinned` property that changes its context value:
- Pinned: `contextValue = 'driftTablePinned'`
- Unpinned: `contextValue = 'driftTable'` (unchanged)

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.pinTable",
        "title": "Pin Table",
        "icon": "$(pin)"
      },
      {
        "command": "driftViewer.unpinTable",
        "title": "Unpin Table",
        "icon": "$(pinned)"
      }
    ],
    "menus": {
      "view/item/context": [
        {
          "command": "driftViewer.pinTable",
          "when": "viewItem == driftTable",
          "group": "0_pin"
        },
        {
          "command": "driftViewer.unpinTable",
          "when": "viewItem == driftTablePinned",
          "group": "0_pin"
        }
      ]
    }
  }
}
```

## Wiring in extension.ts

```typescript
const pinStore = new PinStore(context.workspaceState);
treeProvider.setPinStore(pinStore);

context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.pinTable', (item: TableItem) => {
    pinStore.pin(item.tableName);
  }),
  vscode.commands.registerCommand('driftViewer.unpinTable', (item: TableItem) => {
    pinStore.unpin(item.tableName);
  }),
  pinStore.onDidChange(() => treeProvider.refresh()),
);
```

## Testing

- `pin-store.test.ts`:
  - Pin a table → appears in `pinnedNames`
  - Unpin a table → removed from `pinnedNames`
  - Pin persists across store re-creation (same Memento)
  - Duplicate pin is idempotent
  - Unpin non-pinned table is safe (no-op)
  - `onDidChange` fires on pin and unpin
  - Pinned table that no longer exists in schema is silently ignored in tree

## Known Limitations

- Pin order is insertion order (Set iteration). No drag-to-reorder within pinned group.
- If a pinned table is dropped from the schema, the pin remains in state but the table won't render. Stale pins are harmless.
- No keyboard shortcut for pin/unpin — context menu only.
