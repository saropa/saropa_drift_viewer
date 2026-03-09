import * as vscode from 'vscode';
import { ColumnMetadata, ForeignKey, TableMetadata } from '../api-client';

function columnIcon(col: ColumnMetadata): vscode.ThemeIcon {
  if (col.pk) return new vscode.ThemeIcon('key');
  const upper = col.type.toUpperCase();
  if (upper === 'INTEGER' || upper === 'REAL') {
    return new vscode.ThemeIcon('symbol-number');
  }
  if (upper === 'BLOB') {
    return new vscode.ThemeIcon('file-binary');
  }
  return new vscode.ThemeIcon('symbol-string');
}

export class ConnectionStatusItem extends vscode.TreeItem {
  constructor(baseUrl: string, connected: boolean) {
    super(
      connected ? 'Connected' : 'Disconnected',
      vscode.TreeItemCollapsibleState.None,
    );
    this.description = baseUrl;
    this.iconPath = connected
      ? new vscode.ThemeIcon('database', new vscode.ThemeColor('testing.iconPassed'))
      : new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
    this.contextValue = 'connectionStatus';
  }
}

export class TableItem extends vscode.TreeItem {
  constructor(public readonly table: TableMetadata) {
    super(table.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `${table.rowCount} ${table.rowCount === 1 ? 'row' : 'rows'}`;
    this.iconPath = new vscode.ThemeIcon('table');
    this.contextValue = 'driftTable';
  }
}

export class ColumnItem extends vscode.TreeItem {
  constructor(
    public readonly column: ColumnMetadata,
    public readonly tableName: string,
  ) {
    super(column.name, vscode.TreeItemCollapsibleState.None);
    this.description = column.type;
    this.iconPath = columnIcon(column);
    this.contextValue = column.pk ? 'driftColumnPk' : 'driftColumn';
  }
}

export class ForeignKeyItem extends vscode.TreeItem {
  constructor(public readonly fk: ForeignKey) {
    super(fk.fromColumn, vscode.TreeItemCollapsibleState.None);
    this.description = `\u2192 ${fk.toTable}.${fk.toColumn}`;
    this.iconPath = new vscode.ThemeIcon('references');
    this.contextValue = 'driftForeignKey';
  }
}
