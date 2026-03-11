import * as vscode from 'vscode';
import { DriftApiClient } from '../api-client';
import { TableNameMapper } from './table-name-mapper';

const TABLE_CLASS_REGEX = /^\s*class\s+(\w+)\s+extends\s+Table\s*\{/gm;

export class DriftCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _client: DriftApiClient;
  private readonly _mapper: TableNameMapper;
  private _rowCounts = new Map<string, number>();
  private _connected = false;

  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor(client: DriftApiClient, mapper: TableNameMapper) {
    this._client = client;
    this._mapper = mapper;
  }

  /**
   * Fetch current row counts from the server and update internal caches.
   * Called when GenerationWatcher fires onDidChange.
   */
  async refreshRowCounts(): Promise<void> {
    try {
      const tables = await this._client.schemaMetadata();
      this._mapper.updateTableList(tables.map((t) => t.name));
      this._rowCounts.clear();
      for (const t of tables) {
        this._rowCounts.set(t.name, t.rowCount);
      }
      this._connected = true;
    } catch {
      this._rowCounts.clear();
      this._connected = false;
    }
  }

  /** Fire onDidChangeCodeLenses so VS Code re-calls provideCodeLenses(). */
  notifyChange(): void {
    this._onDidChangeCodeLenses.fire();
  }

  /**
   * Synchronous — reads from in-memory caches only.
   * Called by VS Code on every keystroke in Dart files.
   */
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const text = document.getText();
    const lenses: vscode.CodeLens[] = [];

    TABLE_CLASS_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = TABLE_CLASS_REGEX.exec(text)) !== null) {
      const dartClassName = match[1];
      const line = text.substring(0, match.index).split('\n').length - 1;
      const range = new vscode.Range(line, 0, line, 0);

      const sqlName = this._mapper.resolve(dartClassName);

      // Lens 1: Row count
      if (sqlName && this._connected) {
        const count = this._rowCounts.get(sqlName);
        const rowText =
          count !== undefined
            ? `$(database) ${count} ${count === 1 ? 'row' : 'rows'}`
            : '$(database) unknown';
        lenses.push(
          new vscode.CodeLens(range, {
            title: rowText,
            command: 'driftViewer.refreshTree',
          }),
        );
      } else {
        lenses.push(
          new vscode.CodeLens(range, {
            title: '$(database) not connected',
            command: 'driftViewer.refreshTree',
          }),
        );
      }

      // Lens 2: View in Saropa Drift Advisor
      lenses.push(
        new vscode.CodeLens(range, {
          title: 'View in Saropa Drift Advisor',
          command: 'driftViewer.viewTableInPanel',
          arguments: [sqlName ?? dartClassName],
        }),
      );

      // Lens 3: Run Query (only when table is resolved on server)
      if (sqlName) {
        lenses.push(
          new vscode.CodeLens(range, {
            title: 'Run Query',
            command: 'driftViewer.runTableQuery',
            arguments: [sqlName],
          }),
        );
      }
    }

    return lenses;
  }

  get connected(): boolean {
    return this._connected;
  }
}
