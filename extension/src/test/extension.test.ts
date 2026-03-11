import * as assert from 'assert';
import * as sinon from 'sinon';
import {
  commands,
  MockMemento,
  registeredCodeActionProviders,
  registeredCodeLensProviders,
  registeredHoverProviders,
  resetMocks,
  tasks,
} from './vscode-mock';
import { activate, deactivate } from '../extension';
import * as vscode from 'vscode';

describe('Extension activation', () => {
  let subscriptions: vscode.Disposable[];
  let fetchStub: sinon.SinonStub;

  beforeEach(() => {
    resetMocks();
    subscriptions = [];
    fetchStub = sinon.stub(globalThis, 'fetch');
    // Default: server unreachable (tree provider refresh won't hang)
    fetchStub.rejects(new Error('connection refused'));
  });

  afterEach(() => {
    fetchStub.restore();
    subscriptions.forEach((d) => d.dispose());
  });

  function fakeContext(): vscode.ExtensionContext {
    return {
      subscriptions,
      workspaceState: new MockMemento(),
    } as unknown as vscode.ExtensionContext;
  }

  it('should register driftViewer.openInBrowser command', () => {
    activate(fakeContext());
    const registered = commands.getRegistered();
    assert.ok('driftViewer.openInBrowser' in registered, 'openInBrowser should be registered');
  });

  it('should register driftViewer.openInPanel command', () => {
    activate(fakeContext());
    const registered = commands.getRegistered();
    assert.ok('driftViewer.openInPanel' in registered, 'openInPanel should be registered');
  });

  it('should register tree view commands', () => {
    activate(fakeContext());
    const registered = commands.getRegistered();
    assert.ok('driftViewer.refreshTree' in registered);
    assert.ok('driftViewer.viewTableData' in registered);
    assert.ok('driftViewer.copyTableName' in registered);
    assert.ok('driftViewer.exportTable' in registered);
    assert.ok('driftViewer.copyColumnName' in registered);
    assert.ok('driftViewer.filterByColumn' in registered);
  });

  it('should push expected disposables', () => {
    activate(fakeContext());
    // Providers: treeView, definitionProvider, codeLensProvider, hoverProvider,
    //   diagnosticCollection, codeActionProvider, fileDecoProvider, taskProvider,
    //   terminalLinkProvider, timelineProvider (10)
    // Discovery: discovery, serverManager (2)
    // Lifecycle: watcher, statusBar, perfView, logBridge, 2 debug listeners,
    //   perf cleanup, snapshotStore (8)
    // Codegen: generateDart (1)
    // Auth: onDidChangeConfiguration (1)
    // Gap closures: exportDump, downloadDatabase, schemaDiagram, compareReport,
    //   migrationPreview, sizeAnalytics, importData, shareSession, openSession,
    //   annotateSession (10)
    // Data management: clearTable, clearAllTables, clearTableGroup,
    //   importDataset, exportDataset (5)
    // Global search: globalSearch (1)
    // Row comparator: compareRows (1)
    // Schema docs: generateSchemaDocs (1)
    // Column profiler: profileColumn (1)
    // Snapshot changelog: snapshotChangelog (1)
    // Data breakpoints: dbpProvider, addDataBreakpoint,
    //   removeDataBreakpoint, toggleDataBreakpoint (4)
    // Annotations: annotateTable, annotateColumn, openBookmarks,
    //   exportAnnotations, importAnnotations (5)
    // Seeder: seedTable, seedAllTables (2)
    // Constraint wizard: constraintWizard (1)
    // Isar-to-Drift: isarToDrift (1)
    // Snippet library: openSnippetLibrary, saveAsSnippet (2)
    // FK navigation: fkNavigator (1)
    // Schema search: schemaSearchViewProvider (1)
    // Pin store: pinTable, unpinTable, onDidChange, dispose (4)
    // Health score: healthScore (1)
    // Impact analysis: analyzeRowImpact (1)
    // Total = 102
    assert.strictEqual(subscriptions.length, 102, `expected 102 disposables, got ${subscriptions.length}`);
  });

  it('should register driftViewer.viewTableInPanel command', () => {
    activate(fakeContext());
    const registered = commands.getRegistered();
    assert.ok('driftViewer.viewTableInPanel' in registered);
  });

  it('should register driftViewer.runTableQuery command', () => {
    activate(fakeContext());
    const registered = commands.getRegistered();
    assert.ok('driftViewer.runTableQuery' in registered);
  });

  it('should register a CodeLens provider for Dart files', () => {
    activate(fakeContext());
    assert.strictEqual(registeredCodeLensProviders.length, 1);
    assert.deepStrictEqual(registeredCodeLensProviders[0].selector, {
      language: 'dart',
      scheme: 'file',
    });
  });

  it('should register a drift task provider', () => {
    activate(fakeContext());
    const providers = tasks.getRegisteredProviders();
    assert.strictEqual(providers.length, 1);
    assert.strictEqual(providers[0].type, 'drift');
  });

  it('should register performance commands', () => {
    activate(fakeContext());
    const registered = commands.getRegistered();
    assert.ok('driftViewer.refreshPerformance' in registered);
    assert.ok('driftViewer.clearPerformance' in registered);
    assert.ok('driftViewer.showQueryDetail' in registered);
  });

  it('should register schema linter commands', () => {
    activate(fakeContext());
    const registered = commands.getRegistered();
    assert.ok('driftViewer.runLinter' in registered);
    assert.ok('driftViewer.copySuggestedSql' in registered);
  });

  it('should register discovery commands', () => {
    activate(fakeContext());
    const registered = commands.getRegistered();
    assert.ok('driftViewer.selectServer' in registered);
    assert.ok('driftViewer.retryDiscovery' in registered);
  });

  it('should register snapshot commands', () => {
    activate(fakeContext());
    const registered = commands.getRegistered();
    assert.ok('driftViewer.captureSnapshot' in registered);
    assert.ok('driftViewer.showSnapshotDiff' in registered);
  });

  it('should register watch commands', () => {
    activate(fakeContext());
    const registered = commands.getRegistered();
    assert.ok('driftViewer.watchTable' in registered);
    assert.ok('driftViewer.watchQuery' in registered);
    assert.ok('driftViewer.openWatchPanel' in registered);
  });

  it('should register driftViewer.openSqlNotebook command', () => {
    activate(fakeContext());
    const registered = commands.getRegistered();
    assert.ok('driftViewer.openSqlNotebook' in registered);
  });

  it('should register driftViewer.globalSearch command', () => {
    activate(fakeContext());
    const registered = commands.getRegistered();
    assert.ok('driftViewer.globalSearch' in registered);
  });

  it('should register a HoverProvider for Dart files', () => {
    activate(fakeContext());
    assert.strictEqual(registeredHoverProviders.length, 1);
    assert.deepStrictEqual(registeredHoverProviders[0].selector, {
      language: 'dart',
      scheme: 'file',
    });
  });

  it('should register a CodeAction provider for Dart files', () => {
    activate(fakeContext());
    assert.strictEqual(registeredCodeActionProviders.length, 1);
    assert.deepStrictEqual(registeredCodeActionProviders[0].selector, {
      language: 'dart',
      scheme: 'file',
    });
  });

  it('deactivate should not throw', () => {
    assert.doesNotThrow(() => deactivate());
  });
});
