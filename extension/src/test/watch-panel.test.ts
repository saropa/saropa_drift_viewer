import * as assert from 'assert';
import * as sinon from 'sinon';
import { createdPanels, MockMemento, MockWebviewPanel, resetMocks } from './vscode-mock';
import { DriftApiClient } from '../api-client';
import { WatchManager } from '../watch/watch-manager';
import { WatchPanel } from '../watch/watch-panel';

describe('WatchPanel', () => {
  let fetchStub: sinon.SinonStub;
  let client: DriftApiClient;
  let manager: WatchManager;

  beforeEach(() => {
    resetMocks();
    (WatchPanel as any).currentPanel = undefined;
    fetchStub = sinon.stub(globalThis, 'fetch');
    fetchStub.rejects(new Error('connection refused'));
    client = new DriftApiClient('127.0.0.1', 8642);
    manager = new WatchManager(client, new MockMemento());
  });

  afterEach(() => {
    fetchStub.restore();
  });

  function fakeContext(): any {
    return { subscriptions: [] };
  }

  function latestPanel(): MockWebviewPanel {
    return createdPanels[createdPanels.length - 1];
  }

  it('should create a new panel when none exists', () => {
    WatchPanel.createOrShow(fakeContext(), manager);
    assert.strictEqual(createdPanels.length, 1);
    assert.ok(WatchPanel.currentPanel);
  });

  it('should reveal existing panel instead of creating a second', () => {
    WatchPanel.createOrShow(fakeContext(), manager);
    WatchPanel.createOrShow(fakeContext(), manager);
    assert.strictEqual(createdPanels.length, 1, 'should not create a second panel');
    assert.strictEqual(latestPanel().revealed, true);
  });

  it('should set initial HTML', () => {
    WatchPanel.createOrShow(fakeContext(), manager);
    const html = latestPanel().webview.html;
    assert.ok(html.includes('No active watches'), 'should contain empty state');
    assert.ok(html.includes('Watch Table'), 'should reference Watch Table action');
  });

  it('should post update message on create', () => {
    WatchPanel.createOrShow(fakeContext(), manager);
    const messages = latestPanel().webview.postedMessages as any[];
    assert.ok(messages.length >= 1);
    assert.strictEqual(messages[0].command, 'update');
    assert.ok(Array.isArray(messages[0].entries));
  });

  it('should handle removeWatch message', async () => {
    const data = { columns: ['id'], rows: [[1]] };
    fetchStub.resolves(new Response(JSON.stringify(data), { status: 200 }));
    const id = await manager.add('SELECT 1', 'test');

    WatchPanel.createOrShow(fakeContext(), manager);
    assert.strictEqual(manager.entries.length, 1);

    latestPanel().webview.simulateMessage({ command: 'removeWatch', id });
    assert.strictEqual(manager.entries.length, 0);
  });

  it('should handle pauseWatch message', async () => {
    const data = { columns: ['id'], rows: [[1]] };
    fetchStub.resolves(new Response(JSON.stringify(data), { status: 200 }));
    const id = await manager.add('SELECT 1', 'test');

    WatchPanel.createOrShow(fakeContext(), manager);
    latestPanel().webview.simulateMessage({ command: 'pauseWatch', id });
    assert.strictEqual(manager.entries[0].paused, true);
  });

  it('should handle resumeWatch message', async () => {
    const data = { columns: ['id'], rows: [[1]] };
    fetchStub.resolves(new Response(JSON.stringify(data), { status: 200 }));
    const id = await manager.add('SELECT 1', 'test');
    manager.setPaused(id!, true);

    WatchPanel.createOrShow(fakeContext(), manager);
    latestPanel().webview.simulateMessage({ command: 'resumeWatch', id });
    assert.strictEqual(manager.entries[0].paused, false);
  });

  it('should clear singleton on dispose', () => {
    WatchPanel.createOrShow(fakeContext(), manager);
    assert.ok(WatchPanel.currentPanel);

    latestPanel().simulateClose();
    assert.strictEqual(WatchPanel.currentPanel, undefined);
  });
});
