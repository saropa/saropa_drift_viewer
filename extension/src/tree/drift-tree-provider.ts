import * as vscode from 'vscode';
import { DriftApiClient, TableMetadata } from '../api-client';
import {
  ColumnItem,
  ConnectionStatusItem,
  ForeignKeyItem,
  TableItem,
} from './tree-items';

type TreeNode = ConnectionStatusItem | TableItem | ColumnItem | ForeignKeyItem;

export class DriftTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _client: DriftApiClient;
  private _tables: TableMetadata[] = [];
  private _connected = false;
  private _refreshing = false;

  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    TreeNode | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(client: DriftApiClient) {
    this._client = client;
  }

  /** Fetch schema from server and re-render the tree. Serialised to prevent overlapping calls. */
  async refresh(): Promise<void> {
    if (this._refreshing) return;
    this._refreshing = true;
    try {
      await this._client.health();
      this._tables = await this._client.schemaMetadata();
      this._connected = true;
    } catch {
      this._tables = [];
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
    // Root level: connection status + tables
    if (!element) {
      const status = new ConnectionStatusItem(
        this._client.baseUrl,
        this._connected,
      );
      return [status, ...this._tables.map((t) => new TableItem(t))];
    }

    // Table level: columns + foreign keys (lazy-loaded)
    if (element instanceof TableItem) {
      const columns = element.table.columns.map(
        (c) => new ColumnItem(c, element.table.name),
      );
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

  get connected(): boolean {
    return this._connected;
  }
}
