import * as assert from 'assert';
import { commands, resetMocks } from './vscode-mock';
import { activate, deactivate } from '../extension';
import * as vscode from 'vscode';

describe('Extension activation', () => {
  let subscriptions: vscode.Disposable[];

  beforeEach(() => {
    resetMocks();
    subscriptions = [];
  });

  afterEach(() => {
    subscriptions.forEach((d) => d.dispose());
  });

  function fakeContext(): vscode.ExtensionContext {
    return { subscriptions } as unknown as vscode.ExtensionContext;
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

  it('should push 3 disposables (2 commands + status bar)', () => {
    activate(fakeContext());
    assert.strictEqual(subscriptions.length, 3, 'should have 3 disposables');
  });

  it('deactivate should not throw', () => {
    assert.doesNotThrow(() => deactivate());
  });
});
