/**
 * Command registration: wires all register*Commands with shared context and dependencies.
 */

import * as vscode from 'vscode';
import type { DriftApiClient } from './api-client';
import type { AnnotationStore } from './annotations/annotation-store';
import type { ServerDiscovery } from './server-discovery';
import type { ServerManager } from './server-manager';
import type { GenerationWatcher } from './generation-watcher';
import type { ProviderSetupResult } from './extension-providers';
import type { EditingSetupResult } from './extension-editing';
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
import { registerInvariantCommands } from './invariants';
import { registerErDiagramCommands } from './er-diagram';
import { registerNarratorCommands } from './narrator';
import { registerClipboardImportCommands } from './import/clipboard-import-commands';
import { HealthScorer } from './health/health-scorer';
import { updateStatusBar } from './status-bar';

export interface CommandRegistrationDeps extends ProviderSetupResult, EditingSetupResult {
  annotationStore: AnnotationStore;
  statusItem: vscode.StatusBarItem;
  discovery: ServerDiscovery;
  serverManager: ServerManager;
  discoveryEnabled: boolean;
  watcher: GenerationWatcher;
  updateStatusBar: () => void;
}

/**
 * Register all extension commands. Call after setupProviders, setupDiagnostics, setupEditing.
 */
export function registerAllCommands(
  context: vscode.ExtensionContext,
  client: DriftApiClient,
  deps: CommandRegistrationDeps,
): void {
  const {
    treeProvider,
    treeView,
    codeLensProvider,
    hoverCache,
    linter,
    snapshotStore,
    watchManager,
    refreshBadges,
    dbpProvider,
    logBridge,
    editingBridge,
    fkNavigator,
    filterBridge,
    changeTracker,
    annotationStore,
    statusItem,
    discovery,
    serverManager,
    discoveryEnabled,
    watcher,
    updateStatusBar,
  } = deps;

  registerTreeCommands(context, client, treeProvider, editingBridge, fkNavigator, filterBridge, serverManager);
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
  registerNarratorCommands(context, client);
  registerErDiagramCommands(context, client, watcher);
  registerClipboardImportCommands(context, client);

  // Connection log for troubleshooting (Output > Saropa Drift Advisor)
  const connectionChannel = vscode.window.createOutputChannel('Saropa Drift Advisor');
  context.subscriptions.push(connectionChannel);
  registerDebugCommands(context, {
    client,
    treeProvider,
    treeView,
    hoverCache,
    linter,
    logBridge,
    discovery,
    serverManager,
    watcher,
    codeLensProvider,
    watchManager,
    refreshBadges,
    refreshStatusBar: updateStatusBar,
    connectionLog: { appendLine: (msg) => connectionChannel.appendLine(msg) },
  });
}
