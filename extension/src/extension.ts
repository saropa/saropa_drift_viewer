/**
 * Drift Advisor extension entry point.
 * Activates client, discovery, then delegates to setup modules for providers,
 * diagnostics, editing, and command registration.
 * Master switch: when driftViewer.enabled is false, discovery and watcher do not
 * start; re-enabling applies state via onDidChangeConfiguration.
 */

import * as vscode from 'vscode';
import { DriftApiClient } from './api-client';
import { AnnotationStore } from './annotations/annotation-store';
import { GenerationWatcher } from './generation-watcher';
import { ServerDiscovery } from './server-discovery';
import { ServerManager } from './server-manager';
import { SchemaIntelligence } from './engines/schema-intelligence';
import { QueryIntelligence } from './engines/query-intelligence';
import { DashboardPanel } from './dashboard/dashboard-panel';
import { updateStatusBar } from './status-bar';
import { hasFlutterOrDartDebugSession, tryAdbForwardAndRetry } from './android-forward';
import { setupProviders } from './extension-providers';
import { setupDiagnostics } from './extension-diagnostics';
import { setupEditing } from './extension-editing';
import { registerAllCommands } from './extension-commands';

export function activate(context: vscode.ExtensionContext): void {
  const cfg = vscode.workspace.getConfiguration('driftViewer');
  const extensionEnabled = cfg.get<boolean>('enabled', true) !== false;
  void vscode.commands.executeCommand('setContext', 'driftViewer.enabled', extensionEnabled);

  const host = cfg.get<string>('host', '127.0.0.1') ?? '127.0.0.1';
  const port = cfg.get<number>('port', 8642) ?? 8642;

  const client = new DriftApiClient(host, port);
  const authToken = cfg.get<string>('authToken', '') ?? '';
  if (authToken) client.setAuthToken(authToken);
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
  const lastKnownPorts = context.workspaceState.get<number[]>('driftViewer.lastKnownPorts', []);
  const discovery = new ServerDiscovery({
    host,
    portRangeStart: cfg.get<number>('discovery.portRangeStart', 8642) ?? 8642,
    portRangeEnd: cfg.get<number>('discovery.portRangeEnd', 8649) ?? 8649,
    additionalPorts: lastKnownPorts,
  });
  const serverManager = new ServerManager(discovery, client, context.workspaceState);
  const discoveryEnabled = cfg.get<boolean>('discovery.enabled', true) !== false;

  if (!extensionEnabled) {
    serverManager.clearActive();
  } else {
    if (discoveryEnabled) discovery.start();
  }
  context.subscriptions.push({ dispose: () => discovery.dispose() });
  context.subscriptions.push({ dispose: () => serverManager.dispose() });

  context.subscriptions.push(
    discovery.onDidChangeServers((servers) => {
      if (servers.length > 0) return;
      if (!hasFlutterOrDartDebugSession()) return;
      void tryAdbForwardAndRetry(client.port, discovery, context.workspaceState);
    }),
  );

  const annotationStore = new AnnotationStore(context.workspaceState);
  const providers = setupProviders(context, client, annotationStore);

  const schemaIntel = new SchemaIntelligence(client);
  const queryIntel = new QueryIntelligence(client);
  context.subscriptions.push(schemaIntel, queryIntel);
  const { diagnosticManager } = setupDiagnostics(context, client, schemaIntel, queryIntel);

  const editing = setupEditing(context, client);
  editing.changeTracker.onDidChange(() => {
    vscode.commands.executeCommand('setContext', 'driftViewer.hasEdits', editing.changeTracker.changeCount > 0);
    vscode.commands.executeCommand('setContext', 'driftViewer.editingActive', editing.changeTracker.changeCount > 0);
    providers.logBridge.writeDataEdit(editing.changeTracker.lastLogMessage);
  });

  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  const refreshStatusBar = (): void =>
    updateStatusBar(statusItem, discovery, serverManager, discoveryEnabled, client);
  refreshStatusBar();
  context.subscriptions.push(statusItem);

  /** Apply master switch: start/stop discovery and watcher, clear or refresh UI. */
  const applyEnabledState = (enabled: boolean): void => {
    void vscode.commands.executeCommand('setContext', 'driftViewer.enabled', enabled);
    if (!enabled) {
      discovery.stop();
      watcher.stop();
      serverManager.clearActive();
    } else {
      if (discoveryEnabled) discovery.start();
      watcher.start();
      providers.treeProvider.refresh();
      providers.codeLensProvider.refreshRowCounts();
      providers.linter.refresh();
      diagnosticManager.refresh().catch(() => {});
      providers.refreshBadges().catch(() => {});
    }
    refreshStatusBar();
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('driftViewer.enabled')) {
        const enabled = vscode.workspace.getConfiguration('driftViewer').get<boolean>('enabled', true) !== false;
        applyEnabledState(enabled);
      }
    }),
  );

  serverManager.onDidChangeActive((server) => {
    refreshStatusBar();
    void vscode.commands.executeCommand('setContext', 'driftViewer.serverConnected', server !== undefined);
    if (server) {
      watcher.stop();
      watcher.reset();
      watcher.start();
      providers.treeProvider.refresh();
      providers.codeLensProvider.refreshRowCounts();
      providers.linter.refresh();
      diagnosticManager.refresh().catch(() => {});
      providers.refreshBadges().catch(() => {});
      providers.watchManager.refresh().catch(() => {});
    }
  });
  discovery.onDidChangeServers(refreshStatusBar);

  // On generation change: refresh tree, codelens, linter, diagnostics, badges, timeline, watch, dashboard. Fire-and-forget async to avoid blocking.
  watcher.onDidChange(async () => {
    providers.treeProvider.refresh();
    providers.definitionProvider.clearCache();
    providers.hoverCache.clear();
    await providers.codeLensProvider.refreshRowCounts();
    providers.codeLensProvider.notifyChange();
    providers.linter.refresh();
    diagnosticManager.refresh().catch(() => {});
    providers.refreshBadges().catch(() => {});
    if (cfg.get<boolean>('timeline.autoCapture', true)) {
      providers.snapshotStore.capture(client).catch(() => {});
    }
    providers.watchManager.refresh().catch(() => {});
    providers.dbpProvider.onGenerationChange().catch(() => {});
    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.refreshAll().catch(() => {});
    }
  });
  if (extensionEnabled) {
    watcher.start();
    providers.treeProvider.refresh();
    providers.codeLensProvider.refreshRowCounts();
    providers.linter.refresh();
    diagnosticManager.refresh().catch(() => {});
    providers.refreshBadges().catch(() => {});
  }
  context.subscriptions.push({ dispose: () => watcher.stop() });

  registerAllCommands(context, client, {
    ...providers,
    ...editing,
    annotationStore,
    statusItem,
    discovery,
    serverManager,
    discoveryEnabled,
    watcher,
    updateStatusBar: refreshStatusBar,
  });
}

export function deactivate(): void {}
