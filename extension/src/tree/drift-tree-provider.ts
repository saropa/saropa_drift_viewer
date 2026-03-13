import * as vscode from 'vscode';
import { DriftApiClient, TableMetadata } from '../api-client';
import type { AnnotationStore } from '../annotations/annotation-store';
import type { PinStore } from './pin-store';
import {
  ColumnItem,
  ConnectionStatusItem,
  ForeignKeyItem,
  PinnedGroupItem,
  TableItem,
} from './tree-items';

type TreeNode =
  | ConnectionStatusItem
  | PinnedGroupItem
  | TableItem
  | ColumnItem
  | ForeignKeyItem;

export class DriftTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _client: DriftApiClient;
  private readonly _annotationStore?: AnnotationStore;
  private _tables: TableMetadata[] = [];
  private _tableItems: TableItem[] = [];
  private _pinStore?: PinStore;
  private _connected = false;
  private _refreshing = false;

  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    TreeNode | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(client: DriftApiClient, annotationStore?: AnnotationStore) {
    this._client = client;
    this._annotationStore = annotationStore;
  }

  setPinStore(store: PinStore): void {
    this._pinStore = store;
  }

  /** Fetch schema from server and re-render the tree. Serialised to prevent overlapping calls. */
  async refresh(): Promise<void> {
    if (this._refreshing) return;
    this._refreshing = true;
    try {
      await this._client.health();
      this._tables = await this._client.schemaMetadata();
      this._tableItems = this._tables.map(
        (t) => new TableItem(t, this._pinStore?.isPinned(t.name)),
      );
      this._connected = true;
    } catch {
      this._tables = [];
      this._tableItems = [];
      this._connected = false;
    } finally {
      this._refreshing = false;
    }
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    // Root level: return empty when disconnected to show viewsWelcome content
    if (!element) {
      if (!this._connected) {
        return [];
      }
      const status = new ConnectionStatusItem(
        this._client.connectionDisplayName,
        this._connected,
      );
      this._decorateTableItems();

      const pinned = this._tableItems.filter((t) => t.pinned);
      const unpinned = this._tableItems.filter((t) => !t.pinned);
      const items: TreeNode[] = [status];
      if (pinned.length > 0) {
        items.push(new PinnedGroupItem(pinned.length));
      }
      items.push(...pinned, ...unpinned);
      return items;
    }

    // Table level: columns + foreign keys (lazy-loaded)
    if (element instanceof TableItem) {
      const columns = element.table.columns.map(
        (c) => new ColumnItem(c, element.table.name),
      );
      this._decorateColumnItems(columns, element.table.name);
      let fks: ForeignKeyItem[] = [];
      try {
        const fkData = await this._client.tableFkMeta(element.table.name);
        fks = fkData.map((fk) => new ForeignKeyItem(fk));
      } catch {
        // FK fetch failed — show columns only
      }
      return [...columns, ...fks];
    }

    return [];
  }

  /** Append annotation count to table item descriptions. */
  private _decorateTableItems(): void {
    if (!this._annotationStore) return;
    for (const item of this._tableItems) {
      // Reset to base description to avoid accumulation on repeated calls
      const rc = item.table.rowCount;
      const base = `${rc} ${rc === 1 ? 'row' : 'rows'}`;
      const count = this._annotationStore.countForTable(
        item.table.name,
      );
      item.description = count > 0
        ? `${base} \u00B7 ${count === 1 ? '1 note' : `${count} notes`}`
        : base;
    }
  }

  /** Append annotation indicator to column item descriptions. */
  private _decorateColumnItems(
    columns: ColumnItem[],
    tableName: string,
  ): void {
    if (!this._annotationStore) return;
    for (const col of columns) {
      const has = this._annotationStore.hasAnnotations(
        tableName,
        col.column.name,
      );
      if (has) {
        col.description = `${col.description} \u00B7 \u{1F4CC}`;
      }
    }
  }

  /** Find a cached TableItem by name (for tree view reveal). */
  findTableItem(name: string): TableItem | undefined {
    return this._tableItems.find((item) => item.table.name === name);
  }

  get connected(): boolean {
    return this._connected;
  }
}
