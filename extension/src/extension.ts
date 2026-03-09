import * as vscode from 'vscode';
import { DriftApiClient } from './api-client';
import { GenerationWatcher } from './generation-watcher';
import { DriftViewerPanel } from './panel';
import { DriftTreeProvider } from './tree/drift-tree-provider';
import { ColumnItem, TableItem } from './tree/tree-items';

function escapeCsvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function getServerConfig(): { host: string; port: number } {
  const cfg = vscode.workspace.getConfiguration('driftViewer');
  return {
    host: cfg.get<string>('host', '127.0.0.1') ?? '127.0.0.1',
    port: cfg.get<number>('port', 8642) ?? 8642,
  };
}

export function activate(context: vscode.ExtensionContext): void {
  const { host, port } = getServerConfig();

  // Shared API client & services
  const client = new DriftApiClient(host, port);
  const watcher = new GenerationWatcher(client);
  const treeProvider = new DriftTreeProvider(client);

  // Tree view
  const treeView = vscode.window.createTreeView(
    'driftViewer.databaseExplorer',
    { treeDataProvider: treeProvider, showCollapseAll: true },
  );
  context.subscriptions.push(treeView);

  // Auto-refresh on data changes
  watcher.onDidChange(() => treeProvider.refresh());
  watcher.start();
  treeProvider.refresh(); // initial load

  context.subscriptions.push({ dispose: () => watcher.stop() });

  // --- Commands ---

  // Refresh tree
  context.subscriptions.push(
    vscode.commands.registerCommand('driftViewer.refreshTree', () =>
      treeProvider.refresh(),
    ),
  );

  // View table data (placeholder — opens panel; future: pass table context)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.viewTableData',
      (_item: TableItem) => {
        DriftViewerPanel.createOrShow(host, port);
      },
    ),
  );

  // Copy table name
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.copyTableName',
      (item: TableItem) => {
        vscode.env.clipboard.writeText(item.table.name);
      },
    ),
  );

  // Export table as CSV
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.exportTableCsv',
      async (item: TableItem) => {
        try {
          const csv = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Exporting ${item.table.name}\u2026`,
            },
            async () => {
              const result = await client.sql(
                `SELECT * FROM "${item.table.name}"`,
              );
              const header = result.columns.map(escapeCsvCell).join(',');
              const rows = result.rows.map((row) =>
                row.map(escapeCsvCell).join(','),
              );
              return [header, ...rows].join('\n');
            },
          );
          const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`${item.table.name}.csv`),
            filters: { CSV: ['csv'] },
          });
          if (uri) {
            await vscode.workspace.fs.writeFile(
              uri,
              Buffer.from(csv, 'utf-8'),
            );
            vscode.window.showInformationMessage(
              `Exported ${item.table.name} to CSV.`,
            );
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Export failed: ${msg}`);
        }
      },
    ),
  );

  // Copy column name
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.copyColumnName',
      (item: ColumnItem) => {
        vscode.env.clipboard.writeText(item.column.name);
      },
    ),
  );

  // Filter by column (placeholder — opens panel; future: pass column context)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.filterByColumn',
      (_item: ColumnItem) => {
        DriftViewerPanel.createOrShow(host, port);
      },
    ),
  );

  // Open in browser
  context.subscriptions.push(
    vscode.commands.registerCommand('driftViewer.openInBrowser', async () => {
      const cfg = getServerConfig();
      await vscode.env.openExternal(
        vscode.Uri.parse(`http://${cfg.host}:${cfg.port}`),
      );
    }),
  );

  // Open in editor panel
  context.subscriptions.push(
    vscode.commands.registerCommand('driftViewer.openInPanel', () => {
      const cfg = getServerConfig();
      DriftViewerPanel.createOrShow(cfg.host, cfg.port);
    }),
  );

  // Status bar item
  const statusItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusItem.text = '$(database) Drift Viewer';
  statusItem.command = 'driftViewer.openInPanel';
  statusItem.tooltip = 'Open Drift Viewer in editor panel';
  statusItem.show();
  context.subscriptions.push(statusItem);
}

export function deactivate(): void {}
