import * as vscode from 'vscode';
import {
  ChangeTracker,
  PendingChange,
  describeChange,
  groupByTable,
} from './change-tracker';

export type PendingChangeItem = TableGroupItem | ChangeItem;

export class TableGroupItem extends vscode.TreeItem {
  constructor(
    public readonly table: string,
    count: number,
  ) {
    super(`${table} (${count})`, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon('table');
    this.contextValue = 'pendingTable';
  }
}

export class ChangeItem extends vscode.TreeItem {
  constructor(public readonly change: PendingChange) {
    super(changeLabel(change), vscode.TreeItemCollapsibleState.None);
    this.description = changeDescription(change);
    this.iconPath = changeIcon(change);
    this.tooltip = describeChange(change);
    this.contextValue = 'pendingChange';
  }
}

function changeLabel(c: PendingChange): string {
  switch (c.kind) {
    case 'cell':
      return `UPDATE ${c.column} (${c.pkColumn}=${formatBrief(c.pkValue)})`;
    case 'insert':
      return 'INSERT (new row)';
    case 'delete':
      return `DELETE (${c.pkColumn}=${formatBrief(c.pkValue)})`;
  }
}

function changeDescription(c: PendingChange): string {
  switch (c.kind) {
    case 'cell':
      return `${formatBrief(c.oldValue)} \u2192 ${formatBrief(c.newValue)}`;
    case 'insert': {
      const keys = Object.keys(c.values).slice(0, 3);
      const summary = keys.map((k) => `${k}=${formatBrief(c.values[k])}`).join(', ');
      return keys.length < Object.keys(c.values).length
        ? `${summary}, \u2026`
        : summary;
    }
    case 'delete':
      return '';
  }
}

function changeIcon(c: PendingChange): vscode.ThemeIcon {
  switch (c.kind) {
    case 'cell':
      return new vscode.ThemeIcon('edit');
    case 'insert':
      return new vscode.ThemeIcon('add');
    case 'delete':
      return new vscode.ThemeIcon(
        'trash',
        new vscode.ThemeColor('list.errorForeground'),
      );
  }
}

function formatBrief(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  const s = String(v);
  return s.length > 20 ? s.slice(0, 19) + '\u2026' : s;
}

export class PendingChangesProvider
  implements vscode.TreeDataProvider<PendingChangeItem>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    PendingChangeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly _tracker: ChangeTracker) {
    this._tracker.onDidChange(() => this._onDidChangeTreeData.fire());
  }

  getTreeItem(element: PendingChangeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: PendingChangeItem): PendingChangeItem[] {
    if (!element) {
      return Array.from(groupByTable(this._tracker.changes).entries()).map(
        ([table, changes]) => new TableGroupItem(table, changes.length),
      );
    }

    if (element instanceof TableGroupItem) {
      return this._tracker.changes
        .filter((c) => c.table === element.table)
        .map((c) => new ChangeItem(c));
    }

    return [];
  }
}
