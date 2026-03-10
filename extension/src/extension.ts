import * as vscode from 'vscode';
import { DriftApiClient, QueryEntry } from './api-client';
import { DriftFileDecorationProvider, buildTableFileMap } from './decorations/file-decoration-provider';
import { ChangeTracker } from './editing/change-tracker';
import { EditingBridge } from './editing/editing-bridge';
import { ChangeItem, PendingChangesProvider } from './editing/pending-changes-provider';
import { generateSql } from './editing/sql-generator';
import { DriftCodeActionProvider, SchemaDiagnostics } from './linter/schema-diagnostics';
import { DriftCodeLensProvider } from './codelens/drift-codelens-provider';
import { TableNameMapper } from './codelens/table-name-mapper';
import { LogCaptureBridge } from './debug/log-capture-bridge';
import { PerformanceTreeProvider } from './debug/performance-tree-provider';
import { DriftDefinitionProvider } from './definition/drift-definition-provider';
import { GenerationWatcher } from './generation-watcher';
import { DriftHoverProvider, HoverCache } from './hover/drift-hover-provider';
import { ExplainPanel } from './explain/explain-panel';
import { extractSqlFromContext } from './explain/sql-extractor';
import { DriftViewerPanel } from './panel';
import { ServerDiscovery } from './server-discovery';
import { ServerManager } from './server-manager';
import { DriftTaskProvider } from './tasks/drift-task-provider';
import { DriftTerminalLinkProvider } from './terminal/drift-terminal-link-provider';
import { DriftTimelineProvider } from './timeline/drift-timeline-provider';
import { SnapshotDiffPanel } from './timeline/snapshot-diff-panel';
import { computeTableDiff, ROW_LIMIT, rowsToObjects, SnapshotStore } from './timeline/snapshot-store';
import { DriftTreeProvider } from './tree/drift-tree-provider';
import { ColumnItem, TableItem } from './tree/tree-items';
import { SqlNotebookPanel } from './sql-notebook/sql-notebook-panel';
import { parseDartTables } from './schema-diff/dart-parser';
import {
  computeSchemaDiff,
  generateFullSchemaSql,
  generateMigrationSql,
} from './schema-diff/schema-diff';
import { SchemaDiffPanel } from './schema-diff/schema-diff-panel';
import { registerMigrationGenCommands } from './migration-gen/migration-gen-commands';
import { SizePanel } from './analytics/size-panel';
import { ComparePanel } from './compare/compare-panel';
import { DiagramPanel } from './diagram/diagram-panel';
import { runImportWizard } from './import/import-command';
import { annotateSession, openSession, shareSession } from './session/session-commands';
import { WatchManager } from './watch/watch-manager';
import { WatchPanel } from './watch/watch-panel';
import { generateDartTables } from './codegen/dart-codegen';
import { registerDataManagementCommands } from './data-management/data-management-commands';
import { registerChangelogCommands } from './changelog/changelog-commands';
import { registerComparatorCommands } from './comparator/comparator-commands';
import { collectSchemaDocsData } from './schema-docs/schema-docs-command';
import { DocsHtmlRenderer } from './schema-docs/docs-html-renderer';
import { DocsMdRenderer } from './schema-docs/docs-md-renderer';
import { GlobalSearchPanel } from './global-search/global-search-panel';
import { buildProfileQueries, assembleProfile } from './profiler/profiler-queries';
import { ProfilerPanel } from './profiler/profiler-panel';
import { DataBreakpointProvider } from './data-breakpoint/data-breakpoint-provider';
import type { DataBreakpointType } from './data-breakpoint/data-breakpoint-types';
import { AnnotationStore } from './annotations/annotation-store';
import { registerAnnotationCommands } from './annotations/annotation-commands';
import { registerSeederCommands } from './seeder/seeder-commands';
import { registerConstraintWizardCommands } from './constraint-wizard/constraint-commands';
import { registerIsarGenCommands } from './isar-gen/isar-gen-commands';

async function pickTable(
  client: DriftApiClient,
): Promise<string | undefined> {
  const meta = await client.schemaMetadata();
  const names = meta
    .filter((t) => !t.name.startsWith('sqlite_'))
    .map((t) => t.name)
    .sort();
  return vscode.window.showQuickPick(names, {
    placeHolder: 'Select a table',
  });
}

function escapeCsvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function updateStatusBar(
  item: vscode.StatusBarItem,
  discovery: ServerDiscovery,
  manager: ServerManager,
  discoveryEnabled: boolean,
): void {
  const active = manager.activeServer;
  const count = manager.servers.length;

  if (active && count <= 1) {
    item.text = `$(database) Drift: :${active.port}`;
    item.command = 'driftViewer.openInPanel';
    item.tooltip = `Connected to ${active.host}:${active.port}`;
    item.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.prominentBackground',
    );
  } else if (active && count > 1) {
    item.text = `$(database) Drift: ${count} servers`;
    item.command = 'driftViewer.selectServer';
    item.tooltip = `Active: :${active.port} (${count} servers found)`;
    item.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.prominentBackground',
    );
  } else if (discoveryEnabled && discovery.state === 'searching') {
    item.text = '$(sync~spin) Drift: Searching...';
    item.command = 'driftViewer.retryDiscovery';
    item.tooltip = 'Scanning for Drift debug servers\u2026';
    item.backgroundColor = undefined;
  } else if (!discoveryEnabled) {
    item.text = '$(database) Drift Viewer';
    item.command = 'driftViewer.openInPanel';
    item.tooltip = 'Open Drift Viewer in editor panel';
    item.backgroundColor = undefined;
  } else {
    item.text = '$(circle-slash) Drift: Offline';
    item.command = 'driftViewer.retryDiscovery';
    item.tooltip = 'No Drift debug servers found';
    item.backgroundColor = undefined;
  }
  item.show();
}

export function activate(context: vscode.ExtensionContext): void {
  const cfg = vscode.workspace.getConfiguration('driftViewer');
  const host = cfg.get<string>('host', '127.0.0.1') ?? '127.0.0.1';
  const port = cfg.get<number>('port', 8642) ?? 8642;

  // Shared API client & services
  const client = new DriftApiClient(host, port);
  const authToken = cfg.get<string>('authToken', '') ?? '';
  if (authToken) {
    client.setAuthToken(authToken);
  }
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('driftViewer.authToken')) {
        const token = vscode.workspace
          .getConfiguration('driftViewer')
          .get<string>('authToken', '') ?? '';
        client.setAuthToken(token || undefined);
      }
    }),
  );
  const watcher = new GenerationWatcher(client);

  // Auto-discovery (include last-known ports for faster reconnection)
  const lastKnownPorts = context.workspaceState
    .get<number[]>('driftViewer.lastKnownPorts', []);
  const discovery = new ServerDiscovery({
    host,
    portRangeStart: cfg.get<number>('discovery.portRangeStart', 8642) ?? 8642,
    portRangeEnd: cfg.get<number>('discovery.portRangeEnd', 8649) ?? 8649,
    additionalPorts: lastKnownPorts,
  });
  const serverManager = new ServerManager(
    discovery, client, context.workspaceState,
  );
  const discoveryEnabled = cfg.get<boolean>('discovery.enabled', true) !== false;
  if (discoveryEnabled) {
    discovery.start();
  }
  context.subscriptions.push({ dispose: () => discovery.dispose() });
  context.subscriptions.push({ dispose: () => serverManager.dispose() });
  const annotationStore = new AnnotationStore(context.workspaceState);
  const treeProvider = new DriftTreeProvider(client, annotationStore);

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

  // Hover preview on Drift table class names (debug-only)
  const hoverCache = new HoverCache();
  const hoverProvider = new DriftHoverProvider(client, mapper, hoverCache);
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { language: 'dart', scheme: 'file' },
      hoverProvider,
    ),
  );

  // Schema linter (diagnostics on Drift tables)
  const diagnosticCollection = vscode.languages.createDiagnosticCollection('drift-linter');
  context.subscriptions.push(diagnosticCollection);
  const linter = new SchemaDiagnostics(client, diagnosticCollection);
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { language: 'dart', scheme: 'file' },
      new DriftCodeActionProvider(),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
  );

  // File decoration badges (row counts on table files)
  const fileDecoProvider = new DriftFileDecorationProvider();
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(fileDecoProvider),
  );
  let tableFileMap: Map<string, string> | null = null;

  // Snapshot timeline
  const snapshotStore = new SnapshotStore(
    cfg.get<number>('timeline.maxSnapshots', 20) ?? 20,
    cfg.get<number>('timeline.minIntervalMs', 10000) ?? 10000,
  );
  const timelineProvider = new DriftTimelineProvider(snapshotStore);
  context.subscriptions.push(
    vscode.workspace.registerTimelineProvider('file', timelineProvider),
  );
  context.subscriptions.push({ dispose: () => snapshotStore.dispose() });

  // Live data watch
  const watchManager = new WatchManager(client, context.workspaceState);
  watchManager.restore().catch(() => { /* no stored watches */ });

  /** Build/refresh the table-to-file mapping (shared by badges + timeline). */
  async function ensureTableFileMap(): Promise<Map<string, string>> {
    if (!tableFileMap) {
      const meta = await client.schemaMetadata();
      mapper.updateTableList(meta.map((t) => t.name));
      tableFileMap = await buildTableFileMap(mapper);
    }
    timelineProvider.updateFileToTables(tableFileMap);
    return tableFileMap;
  }

  async function refreshBadges(): Promise<void> {
    const map = await ensureTableFileMap();
    const cfg = vscode.workspace.getConfiguration('driftViewer');
    if (!cfg.get<boolean>('fileBadges.enabled', true)) return;
    await fileDecoProvider.refresh(client, map);
  }

  // Data breakpoints (evaluate on generation change during debug)
  const dbpProvider = new DataBreakpointProvider(client);
  context.subscriptions.push(dbpProvider);

  // Auto-refresh on data changes
  watcher.onDidChange(async () => {
    treeProvider.refresh();
    definitionProvider.clearCache();
    hoverCache.clear();
    await codeLensProvider.refreshRowCounts();
    codeLensProvider.notifyChange();
    linter.refresh();
    refreshBadges().catch(() => { /* server down */ });
    if (cfg.get<boolean>('timeline.autoCapture', true)) {
      snapshotStore.capture(client).catch(() => { /* server down */ });
    }
    watchManager.refresh().catch(() => { /* server down */ });
    dbpProvider.onGenerationChange().catch(() => { /* eval failed */ });
  });
  watcher.start();
  treeProvider.refresh(); // initial load
  codeLensProvider.refreshRowCounts(); // initial CodeLens load
  linter.refresh(); // initial linter scan
  refreshBadges().catch(() => { /* server down */ });

  context.subscriptions.push({ dispose: () => watcher.stop() });

  // Task provider for preLaunchTask integration
  context.subscriptions.push(
    vscode.tasks.registerTaskProvider(DriftTaskProvider.type, new DriftTaskProvider()),
  );

  // Saropa Log Capture integration (optional)
  const logBridge = new LogCaptureBridge();
  logBridge.init(context, client).catch(() => { /* extension not installed */ });
  context.subscriptions.push({ dispose: () => logBridge.dispose() });

  // --- Data Editing (review workflow) ---

  const editOutputChannel = vscode.window.createOutputChannel(
    'Drift Viewer: Data Edits',
  );
  context.subscriptions.push(editOutputChannel);
  const changeTracker = new ChangeTracker(editOutputChannel);
  context.subscriptions.push(changeTracker);
  const editingBridge = new EditingBridge(changeTracker);
  context.subscriptions.push(editingBridge);
  const pendingProvider = new PendingChangesProvider(changeTracker);

  const pendingView = vscode.window.createTreeView(
    'driftViewer.pendingChanges',
    { treeDataProvider: pendingProvider },
  );
  context.subscriptions.push(pendingView);

  // Keep context keys and log bridge in sync with pending edits
  changeTracker.onDidChange(() => {
    vscode.commands.executeCommand(
      'setContext',
      'driftViewer.hasEdits',
      changeTracker.changeCount > 0,
    );
    vscode.commands.executeCommand(
      'setContext',
      'driftViewer.editingActive',
      changeTracker.changeCount > 0,
    );
    // Mirror action to LogCaptureBridge
    logBridge.writeDataEdit(changeTracker.lastLogMessage);
  });

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
        DriftViewerPanel.createOrShow(client.host, client.port, editingBridge);
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
        DriftViewerPanel.createOrShow(client.host, client.port, editingBridge);
      },
    ),
  );

  // Open in browser
  context.subscriptions.push(
    vscode.commands.registerCommand('driftViewer.openInBrowser', async () => {
      await vscode.env.openExternal(
        vscode.Uri.parse(`http://${client.host}:${client.port}`),
      );
    }),
  );

  // Open in editor panel
  context.subscriptions.push(
    vscode.commands.registerCommand('driftViewer.openInPanel', () => {
      DriftViewerPanel.createOrShow(client.host, client.port, editingBridge);
    }),
  );

  // View table in panel (CodeLens action)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.viewTableInPanel',
      (_tableName: string) => {
        DriftViewerPanel.createOrShow(client.host, client.port, editingBridge);
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

  // Schema linter commands
  context.subscriptions.push(
    vscode.commands.registerCommand('driftViewer.runLinter', () =>
      linter.refresh(),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.copySuggestedSql',
      (sql: string) => {
        vscode.env.clipboard.writeText(sql);
      },
    ),
  );

  // Discovery commands
  context.subscriptions.push(
    vscode.commands.registerCommand('driftViewer.selectServer', () =>
      serverManager.selectServer(),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('driftViewer.retryDiscovery', () =>
      discovery.retry(),
    ),
  );

  // Snapshot commands
  context.subscriptions.push(
    vscode.commands.registerCommand('driftViewer.captureSnapshot', async () => {
      const snap = await snapshotStore.capture(client);
      if (snap) {
        vscode.window.showInformationMessage('Drift snapshot captured.');
      } else {
        vscode.window.showWarningMessage(
          'Snapshot skipped (too soon or server unreachable).',
        );
      }
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.showSnapshotDiff',
      async (snapshotId: string, tableName: string) => {
        const snapshot = snapshotStore.getById(snapshotId);
        if (!snapshot) return;
        const snapTable = snapshot.tables.get(tableName);
        if (!snapTable) return;
        try {
          const [result, meta] = await Promise.all([
            client.sql(
              `SELECT * FROM "${tableName}" ORDER BY rowid LIMIT ${ROW_LIMIT}`,
            ),
            client.schemaMetadata(),
          ]);
          const currentRows = rowsToObjects(result.columns, result.rows);
          const tableMeta = meta.find((t) => t.name === tableName);
          const diff = computeTableDiff(
            tableName,
            snapTable.columns,
            snapTable.pkColumns,
            snapTable.rows,
            currentRows,
            snapTable.rowCount,
            tableMeta?.rowCount ?? currentRows.length,
          );
          SnapshotDiffPanel.createOrShow(tableName, diff);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Snapshot diff failed: ${msg}`);
        }
      },
    ),
  );

  // Explain query plan (right-click SQL in Dart files)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.explainQuery',
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const sql = extractSqlFromContext(
          editor.document.getText(),
          editor.document.getText(editor.selection),
          editor.selection.start.line,
        );
        if (!sql) {
          vscode.window.showWarningMessage(
            'No SQL query found at cursor position.',
          );
          return;
        }
        try {
          const [result, suggestions] = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'Explaining query plan\u2026',
            },
            () => Promise.all([
              client.explainSql(sql),
              client.indexSuggestions(),
            ]),
          );
          ExplainPanel.createOrShow(sql, result, suggestions);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Explain failed: ${msg}`);
        }
      },
    ),
  );

  // Schema diff (code vs runtime)
  context.subscriptions.push(
    vscode.commands.registerCommand('driftViewer.schemaDiff', async () => {
      try {
        const { diff, sql, fullSql } = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Comparing schema\u2026',
          },
          async () => {
            const dartUris = await vscode.workspace.findFiles(
              '**/*.dart',
              '{**/build/**,.dart_tool/**,**/*.g.dart,**/*.freezed.dart}',
            );
            const tables = [];
            for (const uri of dartUris) {
              const doc = await vscode.workspace.openTextDocument(uri);
              tables.push(
                ...parseDartTables(doc.getText(), uri.toString()),
              );
            }
            const runtime = await client.schemaMetadata();
            const d = computeSchemaDiff(tables, runtime);
            return {
              diff: d,
              sql: generateMigrationSql(d),
              fullSql: generateFullSchemaSql(tables),
            };
          },
        );
        SchemaDiffPanel.createOrShow(diff, sql, fullSql);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Schema diff failed: ${msg}`);
      }
    }),
  );

  // --- Drift Migration Generator ---
  registerMigrationGenCommands(context, client);

  // Generate Dart from runtime schema
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.generateDart',
      async () => {
        try {
          const schema = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'Fetching schema\u2026',
            },
            () => client.schemaMetadata(),
          );
          if (schema.length === 0) {
            vscode.window.showInformationMessage('No tables found.');
            return;
          }
          const picked = await vscode.window.showQuickPick(
            schema.map((t) => ({
              label: t.name,
              description: `${t.columns.length} columns`,
              table: t,
            })),
            { canPickMany: true, placeHolder: 'Select tables to generate' },
          );
          if (!picked?.length) return;
          const dart = generateDartTables(picked.map((p) => p.table));
          const doc = await vscode.workspace.openTextDocument({
            content: dart,
            language: 'dart',
          });
          await vscode.window.showTextDocument(doc);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `Generate Dart failed: ${msg}`,
          );
        }
      },
    ),
  );

  // Watch commands
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.watchTable',
      (item: TableItem) => {
        watchManager.add(
          `SELECT * FROM "${item.table.name}"`,
          item.table.name,
          item.table.columns,
        );
        WatchPanel.createOrShow(context, watchManager);
      },
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.watchQuery',
      (sql: string) => {
        watchManager.add(sql, sql.substring(0, 40));
        WatchPanel.createOrShow(context, watchManager);
      },
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('driftViewer.openWatchPanel', () => {
      WatchPanel.createOrShow(context, watchManager);
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('driftViewer.openSqlNotebook', () => {
      SqlNotebookPanel.createOrShow(context, client);
    }),
  );

  // --- Data Editing Commands ---

  context.subscriptions.push(
    vscode.commands.registerCommand('driftViewer.generateSql', async () => {
      if (changeTracker.changeCount === 0) {
        vscode.window.showInformationMessage('No pending edits.');
        return;
      }
      changeTracker.logGenerateSql();
      const sql = generateSql(changeTracker.changes);
      const doc = await vscode.workspace.openTextDocument({
        content: sql,
        language: 'sql',
      });
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.discardAllEdits',
      async () => {
        if (changeTracker.changeCount === 0) return;
        const answer = await vscode.window.showWarningMessage(
          `Discard ${changeTracker.changeCount} pending edit(s)?`,
          { modal: true },
          'Discard',
        );
        if (answer === 'Discard') {
          changeTracker.discardAll();
        }
      },
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('driftViewer.undoEdit', () =>
      changeTracker.undo(),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('driftViewer.redoEdit', () =>
      changeTracker.redo(),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('driftViewer.toggleEditing', () => {
      const active = changeTracker.changeCount > 0;
      vscode.commands.executeCommand(
        'setContext',
        'driftViewer.editingActive',
        !active,
      );
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.removeChange',
      (item: ChangeItem) => {
        changeTracker.removeChange(item.change.id);
      },
    ),
  );

  // Status bar item (dynamic via discovery)
  const statusItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  updateStatusBar(statusItem, discovery, serverManager, discoveryEnabled);
  context.subscriptions.push(statusItem);

  serverManager.onDidChangeActive((server) => {
    updateStatusBar(statusItem, discovery, serverManager, discoveryEnabled);
    vscode.commands.executeCommand(
      'setContext',
      'driftViewer.serverConnected',
      server !== undefined,
    );
    if (server) {
      watcher.stop();
      watcher.reset();
      watcher.start();
      treeProvider.refresh();
      codeLensProvider.refreshRowCounts();
      linter.refresh();
      refreshBadges().catch(() => { /* server down */ });
      watchManager.refresh().catch(() => { /* server down */ });
    }
  });
  discovery.onDidChangeServers(() =>
    updateStatusBar(statusItem, discovery, serverManager, discoveryEnabled),
  );

  // --- Query Performance Panel (Debug sidebar) ---

  const perfProvider = new PerformanceTreeProvider();
  const perfView = vscode.window.createTreeView(
    'driftViewer.queryPerformance',
    { treeDataProvider: perfProvider },
  );
  context.subscriptions.push(perfView);

  // Terminal link provider — clickable SQLite errors
  const revealTable = async (name: string): Promise<void> => {
    let item = treeProvider.findTableItem(name);
    if (!item) {
      await treeProvider.refresh();
      item = treeProvider.findTableItem(name);
    }
    if (item) {
      await treeView.reveal(item, { select: true, focus: true });
    } else {
      await vscode.commands.executeCommand(
        'driftViewer.databaseExplorer.focus',
      );
    }
  };
  context.subscriptions.push(
    vscode.window.registerTerminalLinkProvider(
      new DriftTerminalLinkProvider(client, revealTable, logBridge),
    ),
  );

  // Show all tables (QuickPick)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.showAllTables',
      async () => {
        try {
          const meta = await client.schemaMetadata();
          const names = meta.map((t) => t.name).sort();
          if (names.length === 0) {
            vscode.window.showInformationMessage('No tables found.');
            return;
          }
          const picked = await vscode.window.showQuickPick(names, {
            placeHolder: 'Select a table to reveal',
          });
          if (picked) await revealTable(picked);
        } catch {
          vscode.window.showWarningMessage(
            'Drift debug server not reachable.',
          );
        }
      },
    ),
  );

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

  // --- Gap closures: export commands ---

  // Export full SQL dump
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.exportDump',
      async () => {
        try {
          const sql = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'Exporting SQL dump\u2026',
            },
            () => client.schemaDump(),
          );
          const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file('dump.sql'),
            filters: { SQL: ['sql'] },
          });
          if (uri) {
            await vscode.workspace.fs.writeFile(
              uri, Buffer.from(sql, 'utf-8'),
            );
            vscode.window.showInformationMessage('SQL dump exported.');
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Export dump failed: ${msg}`);
        }
      },
    ),
  );

  // Download raw SQLite database file
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.downloadDatabase',
      async () => {
        try {
          const data = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'Downloading database\u2026',
            },
            () => client.databaseFile(),
          );
          const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file('app.db'),
            filters: { SQLite: ['db', 'sqlite'] },
          });
          if (uri) {
            await vscode.workspace.fs.writeFile(
              uri, Buffer.from(data),
            );
            vscode.window.showInformationMessage('Database file saved.');
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Download failed: ${msg}`);
        }
      },
    ),
  );

  // Schema diagram (ER-style table visualization)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.schemaDiagram',
      async () => {
        try {
          const data = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'Loading schema diagram\u2026',
            },
            () => client.schemaDiagram(),
          );
          DiagramPanel.createOrShow(data);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Schema diagram failed: ${msg}`);
        }
      },
    ),
  );

  // Compare databases (A vs B report)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.compareReport',
      async () => {
        try {
          const report = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'Comparing databases\u2026',
            },
            () => client.compareReport(),
          );
          ComparePanel.createOrShow(report);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Compare failed: ${msg}`);
        }
      },
    ),
  );

  // Preview migration SQL (compare → migration DDL)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.migrationPreview',
      async () => {
        try {
          const result = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'Generating migration preview\u2026',
            },
            () => client.migrationPreview(),
          );
          const header = [
            `-- Migration Preview (${result.changeCount} changes)`,
            result.hasWarnings ? '-- WARNING: review before executing' : '',
            `-- Generated: ${result.generatedAt}`,
            '',
          ].filter(Boolean).join('\n');
          const doc = await vscode.workspace.openTextDocument({
            content: header + result.migrationSql,
            language: 'sql',
          });
          await vscode.window.showTextDocument(
            doc, vscode.ViewColumn.Beside,
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `Migration preview failed: ${msg}`,
          );
        }
      },
    ),
  );

  // Size analytics dashboard
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.sizeAnalytics',
      async () => {
        try {
          const data = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'Loading size analytics\u2026',
            },
            () => client.sizeAnalytics(),
          );
          SizePanel.createOrShow(data);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Size analytics failed: ${msg}`);
        }
      },
    ),
  );

  // Import data wizard
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.importData',
      () => runImportWizard(client),
    ),
  );

  // --- Gap closures: session commands ---

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.shareSession', () => shareSession(client),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.openSession', () => openSession(client),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.annotateSession', () => annotateSession(client),
    ),
  );

  // --- Column Profiler ---
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.profileColumn',
      async (item: ColumnItem) => {
        try {
          const profile = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Profiling ${item.tableName}.${item.column.name}\u2026`,
            },
            async () => {
              const queries = buildProfileQueries(
                item.tableName, item.column.name, item.column.type,
              );
              const results = new Map<string, unknown[][]>();
              for (const query of queries) {
                try {
                  const r = await client.sql(query.sql);
                  results.set(query.name, r.rows);
                } catch {
                  // Skip failed queries gracefully
                }
              }
              return assembleProfile(
                item.tableName, item.column.name,
                item.column.type, results,
              );
            },
          );
          ProfilerPanel.createOrShow(profile);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Profile failed: ${msg}`);
        }
      },
    ),
  );

  // --- Schema Documentation Generator ---
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.generateSchemaDocs',
      async () => {
        const format = await vscode.window.showQuickPick(
          [
            {
              label: 'HTML',
              description: 'Self-contained web page',
              value: 'html' as const,
            },
            {
              label: 'Markdown',
              description: 'Plain text, VCS-friendly',
              value: 'md' as const,
            },
          ],
          { placeHolder: 'Output format' },
        );
        if (!format) {
          return;
        }

        try {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'Generating documentation\u2026',
            },
            async () => {
              const data = await collectSchemaDocsData(client);

              if (format.value === 'html') {
                const html = new DocsHtmlRenderer().render(data);
                const uri = await vscode.window.showSaveDialog({
                  defaultUri: vscode.Uri.file('schema-docs.html'),
                  filters: { HTML: ['html'] },
                });
                if (uri) {
                  await vscode.workspace.fs.writeFile(
                    uri, Buffer.from(html, 'utf-8'),
                  );
                  await vscode.env.openExternal(uri);
                }
              } else {
                const md = new DocsMdRenderer().render(data);
                const doc = await vscode.workspace.openTextDocument({
                  content: md,
                  language: 'markdown',
                });
                await vscode.window.showTextDocument(doc);
              }
            },
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `Schema docs failed: ${msg}`,
          );
        }
      },
    ),
  );

  // --- Global Search ---
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.globalSearch',
      () => GlobalSearchPanel.createOrShow(client),
    ),
  );

  // --- Data Management (reset, import, export) ---
  registerDataManagementCommands(context, client);

  // --- Row Comparator ---
  registerComparatorCommands(context, client);

  // --- Snapshot Changelog ---
  registerChangelogCommands(context, snapshotStore);

  // --- Annotations & Bookmarks ---
  registerAnnotationCommands(context, annotationStore, treeProvider);

  // --- Test Data Seeder ---
  registerSeederCommands(context, client);
  // --- Constraint Wizard ---
  registerConstraintWizardCommands(context, client);
  // --- Isar-to-Drift Schema Generator ---
  registerIsarGenCommands(context);

  // --- Data Breakpoints ---
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.addDataBreakpoint',
      async (item?: TableItem) => {
        const table = item?.table.name ?? await pickTable(client);
        if (!table) return;

        const type = await vscode.window.showQuickPick(
          [
            {
              label: 'Condition Met',
              value: 'conditionMet' as DataBreakpointType,
              description: 'SQL returns non-zero count',
            },
            {
              label: 'Row Inserted',
              value: 'rowInserted' as DataBreakpointType,
              description: 'Row count increases',
            },
            {
              label: 'Row Deleted',
              value: 'rowDeleted' as DataBreakpointType,
              description: 'Row count decreases',
            },
            {
              label: 'Row Changed',
              value: 'rowChanged' as DataBreakpointType,
              description: 'Any data changes',
            },
          ],
          { placeHolder: 'Breakpoint type' },
        );
        if (!type) return;

        let condition: string | undefined;
        if (type.value === 'conditionMet') {
          condition = await vscode.window.showInputBox({
            prompt: 'SQL condition (must return count)',
            placeHolder:
              'SELECT COUNT(*) FROM "users" WHERE balance < 0',
          });
          if (!condition) return;
        }

        dbpProvider.add(table, type.value, condition);
        vscode.window.showInformationMessage(
          `Data breakpoint added on ${table}.`,
        );
      },
    ),
    vscode.commands.registerCommand(
      'driftViewer.removeDataBreakpoint',
      (id: string) => dbpProvider.remove(id),
    ),
    vscode.commands.registerCommand(
      'driftViewer.toggleDataBreakpoint',
      (id: string) => dbpProvider.toggle(id),
    ),
  );

  // Debug session lifecycle — start/stop performance auto-refresh
  const perfCfg = vscode.workspace.getConfiguration('driftViewer');
  const refreshInterval =
    perfCfg.get<number>('performance.refreshIntervalMs', 3000) ?? 3000;

  context.subscriptions.push(
    vscode.debug.onDidStartDebugSession(async (session) => {
      if (session.type !== 'dart') return;

      // If discovery is active and no server found yet, trigger retry
      if (!serverManager.activeServer) {
        discovery.retry();
      }

      // Check server connectivity before showing panel
      hoverCache.clear();
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
      hoverCache.clear();
      perfProvider.stopAutoRefresh();
      linter.clear();
      logBridge.writeConnectionEvent('Drift debug server disconnected');
    }),
  );

  context.subscriptions.push({
    dispose: () => perfProvider.stopAutoRefresh(),
  });
}

export function deactivate(): void {}
