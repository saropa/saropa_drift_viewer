/**
 * Tree, language, and file decoration provider registration.
 * Registers tree view, definition/codelens/hover, file badges, timeline, task/terminal, log bridge.
 */

import * as vscode from 'vscode';
import type { DriftApiClient } from './api-client';
import type { AnnotationStore } from './annotations/annotation-store';
import { DriftFileDecorationProvider, buildTableFileMap } from './decorations/file-decoration-provider';
import { DriftCodeActionProvider, SchemaDiagnostics } from './linter/schema-diagnostics';
import { DriftCodeLensProvider } from './codelens/drift-codelens-provider';
import { TableNameMapper } from './codelens/table-name-mapper';
import { LogCaptureBridge } from './debug/log-capture-bridge';
import { DriftDefinitionProvider } from './definition/drift-definition-provider';
import { DriftHoverProvider, HoverCache } from './hover/drift-hover-provider';
import { DriftTaskProvider } from './tasks/drift-task-provider';
import { HealthTerminalLinkProvider } from './tasks/health-link-provider';
import { DriftTimelineProvider } from './timeline/drift-timeline-provider';
import { SnapshotStore } from './timeline/snapshot-store';
import { DriftTreeProvider } from './tree/drift-tree-provider';
import { WatchManager } from './watch/watch-manager';
import { DataBreakpointProvider } from './data-breakpoint/data-breakpoint-provider';

export interface ProviderSetupResult {
  treeProvider: DriftTreeProvider;
  treeView: vscode.TreeView<unknown>;
  definitionProvider: DriftDefinitionProvider;
  codeLensProvider: DriftCodeLensProvider;
  hoverCache: HoverCache;
  hoverProvider: DriftHoverProvider;
  fileDecoProvider: DriftFileDecorationProvider;
  mapper: TableNameMapper;
  linter: SchemaDiagnostics;
  snapshotStore: SnapshotStore;
  timelineProvider: DriftTimelineProvider;
  watchManager: WatchManager;
  refreshBadges: () => Promise<void>;
  dbpProvider: DataBreakpointProvider;
  logBridge: LogCaptureBridge;
}

/**
 * Register tree view, language providers (definition, codelens, hover), legacy linter,
 * file decorations, timeline, watch manager, data breakpoint provider, task/terminal, log bridge.
 */
export function setupProviders(
  context: vscode.ExtensionContext,
  client: DriftApiClient,
  annotationStore: AnnotationStore,
): ProviderSetupResult {
  const cfg = vscode.workspace.getConfiguration('driftViewer');
  const treeProvider = new DriftTreeProvider(client, annotationStore);
  const treeView = vscode.window.createTreeView(
    'driftViewer.databaseExplorer',
    { treeDataProvider: treeProvider, showCollapseAll: true },
  );
  context.subscriptions.push(treeView);

  const definitionProvider = new DriftDefinitionProvider(client);
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      { language: 'dart', scheme: 'file' },
      definitionProvider,
    ),
  );

  const mapper = new TableNameMapper();
  const codeLensProvider = new DriftCodeLensProvider(client, mapper);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: 'dart', scheme: 'file' },
      codeLensProvider,
    ),
  );

  const hoverCache = new HoverCache();
  const hoverProvider = new DriftHoverProvider(client, mapper, hoverCache);
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { language: 'dart', scheme: 'file' },
      hoverProvider,
    ),
  );

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

  const fileDecoProvider = new DriftFileDecorationProvider();
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(fileDecoProvider),
  );
  let tableFileMap: Map<string, string> | null = null;

  const snapshotStore = new SnapshotStore(
    cfg.get<number>('timeline.maxSnapshots', 20) ?? 20,
    cfg.get<number>('timeline.minIntervalMs', 10000) ?? 10000,
  );
  const timelineProvider = new DriftTimelineProvider(snapshotStore);
  context.subscriptions.push(
    vscode.workspace.registerTimelineProvider('file', timelineProvider),
  );
  context.subscriptions.push({ dispose: () => snapshotStore.dispose() });

  const watchManager = new WatchManager(client, context.workspaceState);
  watchManager.restore().catch(() => { /* no stored watches */ });

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
    const driftCfg = vscode.workspace.getConfiguration('driftViewer');
    if (!driftCfg.get<boolean>('fileBadges.enabled', true)) return;
    await fileDecoProvider.refresh(client, map);
  }

  const dbpProvider = new DataBreakpointProvider(client);
  context.subscriptions.push(dbpProvider);

  context.subscriptions.push(
    vscode.tasks.registerTaskProvider(DriftTaskProvider.type, new DriftTaskProvider()),
  );
  context.subscriptions.push(
    vscode.window.registerTerminalLinkProvider(new HealthTerminalLinkProvider()),
  );

  const logBridge = new LogCaptureBridge();
  logBridge.init(context, client).catch(() => { /* extension not installed */ });
  context.subscriptions.push({ dispose: () => logBridge.dispose() });

  return {
    treeProvider,
    treeView,
    definitionProvider,
    codeLensProvider,
    hoverCache,
    hoverProvider,
    fileDecoProvider,
    mapper,
    linter,
    snapshotStore,
    timelineProvider,
    watchManager,
    refreshBadges,
    dbpProvider,
    logBridge,
  };
}
