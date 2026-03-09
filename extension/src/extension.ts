import * as vscode from 'vscode';
import { DriftApiClient, QueryEntry } from './api-client';
import { DriftCodeLensProvider } from './codelens/drift-codelens-provider';
import { TableNameMapper } from './codelens/table-name-mapper';
import { LogCaptureBridge } from './debug/log-capture-bridge';
import { PerformanceTreeProvider } from './debug/performance-tree-provider';
import { DriftDefinitionProvider } from './definition/drift-definition-provider';
import { GenerationWatcher } from './generation-watcher';
import { DriftViewerPanel } from './panel';
import { DriftTaskProvider } from './tasks/drift-task-provider';
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

  // Peek / Go to Definition for SQL table/column names in Dart strings
  const definitionProvider = new DriftDefinitionProvider(client);
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      { language: 'dart', scheme: 'file' },
      definitionProvider,
    ),
  );

  // CodeLens on Drift table classes
  const mapper = new TableNameMapper();
  const codeLensProvider = new DriftCodeLensProvider(client, mapper);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: 'dart', scheme: 'file' },
      codeLensProvider,
    ),
  );

  // Auto-refresh on data changes
  watcher.onDidChange(async () => {
    treeProvider.refresh();
    definitionProvider.clearCache();
    await codeLensProvider.refreshRowCounts();
    codeLensProvider.notifyChange();
  });
  watcher.start();
  treeProvider.refresh(); // initial load
  codeLensProvider.refreshRowCounts(); // initial CodeLens load

  context.subscriptions.push({ dispose: () => watcher.stop() });

  // Task provider for preLaunchTask integration
  context.subscriptions.push(
    vscode.tasks.registerTaskProvider(DriftTaskProvider.type, new DriftTaskProvider()),
  );

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

  // View table in panel (CodeLens action)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.viewTableInPanel',
      (_tableName: string) => {
        DriftViewerPanel.createOrShow(host, port);
      },
    ),
  );

  // Run table query (CodeLens action)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.runTableQuery',
      async (tableName: string) => {
        try {
          const result = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Querying ${tableName}\u2026`,
            },
            () => client.sql(`SELECT * FROM "${tableName}"`),
          );
          const doc = await vscode.workspace.openTextDocument({
            content: JSON.stringify(result.rows, null, 2),
            language: 'json',
          });
          await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Query failed: ${msg}`);
        }
      },
    ),
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

  // --- Query Performance Panel (Debug sidebar) ---

  const perfProvider = new PerformanceTreeProvider();
  const perfView = vscode.window.createTreeView(
    'driftViewer.queryPerformance',
    { treeDataProvider: perfProvider },
  );
  context.subscriptions.push(perfView);

  // Saropa Log Capture integration (optional)
  const logBridge = new LogCaptureBridge();
  logBridge.init(context, client).catch(() => { /* extension not installed */ });
  context.subscriptions.push({ dispose: () => logBridge.dispose() });

  // Refresh performance
  context.subscriptions.push(
    vscode.commands.registerCommand('driftViewer.refreshPerformance', () =>
      perfProvider.refresh(client),
    ),
  );

  // Clear performance stats
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.clearPerformance',
      async () => {
        try {
          await client.clearPerformance();
          await perfProvider.refresh(client);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Clear stats failed: ${msg}`);
        }
      },
    ),
  );

  // Show query detail (click on a query item)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.showQueryDetail',
      async (query: QueryEntry) => {
        const content = [
          `-- Duration: ${query.durationMs}ms`,
          `-- Rows: ${query.rowCount}`,
          `-- Time: ${query.at}`,
          '',
          query.sql,
        ].join('\n');
        const doc = await vscode.workspace.openTextDocument({
          content,
          language: 'sql',
        });
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
      },
    ),
  );

  // Debug session lifecycle — start/stop performance auto-refresh
  const perfCfg = vscode.workspace.getConfiguration('driftViewer');
  const refreshInterval =
    perfCfg.get<number>('performance.refreshIntervalMs', 3000) ?? 3000;

  context.subscriptions.push(
    vscode.debug.onDidStartDebugSession(async (session) => {
      if (session.type !== 'dart') return;

      // Check server connectivity before showing panel
      try {
        await client.health();
        vscode.commands.executeCommand(
          'setContext',
          'driftViewer.serverConnected',
          true,
        );
        perfProvider.startAutoRefresh(client, refreshInterval);
        logBridge.writeConnectionEvent(
          `Connected to Drift debug server at ${client.baseUrl}`,
        );
      } catch {
        // Server not reachable — panel stays hidden
      }
    }),
  );

  context.subscriptions.push(
    vscode.debug.onDidTerminateDebugSession((session) => {
      if (session.type !== 'dart') return;
      vscode.commands.executeCommand(
        'setContext',
        'driftViewer.serverConnected',
        false,
      );
      perfProvider.stopAutoRefresh();
      logBridge.writeConnectionEvent('Drift debug server disconnected');
    }),
  );

  context.subscriptions.push({
    dispose: () => perfProvider.stopAutoRefresh(),
  });
}

export function deactivate(): void {}
