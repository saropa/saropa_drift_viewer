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
    assert.ok('driftViewer.exportTableCsv' in registered);
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
    // Total = 54
    assert.strictEqual(subscriptions.length, 54, `expected 54 disposables, got ${subscriptions.length}`);
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
