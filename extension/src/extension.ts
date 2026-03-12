import * as vscode from 'vscode';
import { DriftApiClient } from './api-client';
import { DriftFileDecorationProvider, buildTableFileMap } from './decorations/file-decoration-provider';
import { ChangeTracker } from './editing/change-tracker';
import { EditingBridge } from './editing/editing-bridge';
import { PendingChangesProvider } from './editing/pending-changes-provider';
import { FilterBridge } from './filters/filter-bridge';
import { FilterStore } from './filters/filter-store';
import { DriftCodeActionProvider, SchemaDiagnostics } from './linter/schema-diagnostics';
import { DataQualityProvider, DiagnosticCodeActionProvider, DiagnosticManager, PerformanceProvider, SchemaProvider } from './diagnostics';
import { SchemaIntelligence } from './engines/schema-intelligence';
import { QueryIntelligence } from './engines/query-intelligence';
import { DriftCodeLensProvider } from './codelens/drift-codelens-provider';
import { TableNameMapper } from './codelens/table-name-mapper';
import { LogCaptureBridge } from './debug/log-capture-bridge';
import { DriftDefinitionProvider } from './definition/drift-definition-provider';
import { GenerationWatcher } from './generation-watcher';
import { DriftHoverProvider, HoverCache } from './hover/drift-hover-provider';
import { FkNavigator } from './navigation/fk-navigator';
import { ServerDiscovery } from './server-discovery';
import { ServerManager } from './server-manager';
import { DriftTaskProvider } from './tasks/drift-task-provider';
import { DriftTimelineProvider } from './timeline/drift-timeline-provider';
import { SnapshotStore } from './timeline/snapshot-store';
import { DriftTreeProvider } from './tree/drift-tree-provider';
import { WatchManager } from './watch/watch-manager';
import { DataBreakpointProvider } from './data-breakpoint/data-breakpoint-provider';
import { AnnotationStore } from './annotations/annotation-store';
import { registerAnnotationCommands } from './annotations/annotation-commands';
import { registerSeederCommands } from './seeder/seeder-commands';
import { registerConstraintWizardCommands } from './constraint-wizard/constraint-commands';
import { registerImpactCommands } from './impact/impact-commands';
import { registerIsarGenCommands } from './isar-gen/isar-gen-commands';
import { registerMigrationGenCommands } from './migration-gen/migration-gen-commands';
import { registerDataManagementCommands } from './data-management/data-management-commands';
import { registerChangelogCommands } from './changelog/changelog-commands';
import { registerComparatorCommands } from './comparator/comparator-commands';
import { registerSnippetCommands } from './snippets/snippet-commands';
import { registerSchemaDiffCommands } from './schema-diff/schema-diff-commands';
import { registerExportCommands } from './export/export-commands';
import { registerTreeCommands } from './tree/tree-commands';
import { registerNavCommands } from './navigation/nav-commands';
import { registerSnapshotCommands } from './timeline/snapshot-commands';
import { registerEditingCommands } from './editing/editing-commands';
import { registerDataBreakpointCommands } from './data-breakpoint/data-breakpoint-commands';
import { registerDebugCommands } from './debug/debug-commands';
import { registerHealthCommands } from './health/health-commands';
import { registerQueryCostCommands } from './query-cost/query-cost-commands';
import { registerDashboardCommands } from './dashboard/dashboard-commands';
import { DashboardPanel } from './dashboard/dashboard-panel';
import { HealthScorer } from './health/health-scorer';
import { updateStatusBar } from './status-bar';
import { registerInvariantCommands } from './invariants';

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

  // Schema linter (legacy diagnostics - kept for backward compatibility)
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

  // Intelligence engines (cached schema and query analysis)
  const schemaIntel = new SchemaIntelligence(client);
  const queryIntel = new QueryIntelligence(client);
  context.subscriptions.push(schemaIntel, queryIntel);

  // New centralized diagnostic manager (drift-advisor collection)
  const diagnosticManager = new DiagnosticManager(client, schemaIntel, queryIntel);
  context.subscriptions.push(diagnosticManager);

  // Register diagnostic providers
  context.subscriptions.push(
    diagnosticManager.registerProvider(new SchemaProvider()),
    diagnosticManager.registerProvider(new PerformanceProvider()),
    diagnosticManager.registerProvider(new DataQualityProvider()),
  );

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { language: 'dart', scheme: 'file' },
      new DiagnosticCodeActionProvider(diagnosticManager),
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
    diagnosticManager.refresh().catch(() => { /* refresh failed */ });
    refreshBadges().catch(() => { /* server down */ });
    if (cfg.get<boolean>('timeline.autoCapture', true)) {
      snapshotStore.capture(client).catch(() => { /* server down */ });
    }
    watchManager.refresh().catch(() => { /* server down */ });
    dbpProvider.onGenerationChange().catch(() => { /* eval failed */ });
    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.refreshAll().catch(() => { /* refresh failed */ });
    }
  });
  watcher.start();
  treeProvider.refresh(); // initial load
  codeLensProvider.refreshRowCounts(); // initial CodeLens load
  linter.refresh(); // initial linter scan
  diagnosticManager.refresh().catch(() => { /* refresh failed */ }); // initial diagnostic scan
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
    'Saropa Drift Advisor: Data Edits',
  );
  context.subscriptions.push(editOutputChannel);
  const changeTracker = new ChangeTracker(editOutputChannel);
  context.subscriptions.push(changeTracker);
  const editingBridge = new EditingBridge(changeTracker);
  context.subscriptions.push(editingBridge);
  const fkNavigator = new FkNavigator(client);
  context.subscriptions.push(fkNavigator);
  const filterStore = new FilterStore(context.workspaceState);
  const filterBridge = new FilterBridge(filterStore, client);
  context.subscriptions.push(filterBridge);
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
    logBridge.writeDataEdit(changeTracker.lastLogMessage);
  });

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
      diagnosticManager.refresh().catch(() => { /* refresh failed */ });
      refreshBadges().catch(() => { /* server down */ });
      watchManager.refresh().catch(() => { /* server down */ });
    }
  });
  discovery.onDidChangeServers(() =>
    updateStatusBar(statusItem, discovery, serverManager, discoveryEnabled),
  );

  // --- Register command modules ---

  registerTreeCommands(context, client, treeProvider, editingBridge, fkNavigator, filterBridge);
  registerNavCommands(context, client, linter, editingBridge, fkNavigator, serverManager, discovery, filterBridge);
  registerSnapshotCommands(context, client, snapshotStore);
  registerSchemaDiffCommands(context, client);
  registerEditingCommands(context, client, changeTracker, watchManager);
  registerExportCommands(context, client);
  registerSnippetCommands(context, client);
  registerDataBreakpointCommands(context, client, dbpProvider);
  registerMigrationGenCommands(context, client);
  registerDataManagementCommands(context, client);
  registerComparatorCommands(context, client);
  registerChangelogCommands(context, snapshotStore);
  registerAnnotationCommands(context, annotationStore, treeProvider);
  registerSeederCommands(context, client);
  registerConstraintWizardCommands(context, client);
  registerImpactCommands(context, client);
  registerIsarGenCommands(context);
  registerHealthCommands(context, client);
  registerQueryCostCommands(context, client);
  registerDashboardCommands(context, client, new HealthScorer());
  registerInvariantCommands(context, client, watcher);
  registerDebugCommands(context, {
    client, treeProvider, treeView, hoverCache, linter,
    logBridge, discovery, serverManager, watcher, codeLensProvider,
    watchManager, refreshBadges,
  });
}

export function deactivate(): void {}
