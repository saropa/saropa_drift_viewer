import * as assert from 'assert';
import * as sinon from 'sinon';
import { DriftApiClient } from '../api-client';
import { QueryCostPanel } from '../query-cost/query-cost-panel';
import {
  resetMocks,
  createdPanels,
  clipboardMock,
  messageMock,
} from './vscode-mock';

function makeClient(): DriftApiClient {
  return new DriftApiClient('127.0.0.1', 9999);
}

function latestPanel() {
  return createdPanels[createdPanels.length - 1];
}

function stubExplain(client: DriftApiClient, detail = 'SCAN TABLE users') {
  sinon.stub(client, 'explainSql').resolves({
    rows: [{ id: 2, parent: 0, notused: 0, detail }],
    sql: `EXPLAIN QUERY PLAN SELECT * FROM users`,
  });
}

function stubSql(client: DriftApiClient, rows: unknown[][] = []) {
  sinon.stub(client, 'sql').resolves({ columns: ['name'], rows });
}

describe('QueryCostPanel', () => {
  beforeEach(() => {
    resetMocks();
    (QueryCostPanel as any)._currentPanel = undefined;
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should create a webview panel with cost analysis HTML', async () => {
    const client = makeClient();
    stubExplain(client);
    stubSql(client);

    await QueryCostPanel.createOrShow(client, 'SELECT * FROM users');

    assert.strictEqual(createdPanels.length, 1);
    const html = latestPanel().webview.html;
    assert.ok(html.includes('Query Cost Analysis'));
    assert.ok(html.includes('SCAN TABLE users'));
    assert.ok(html.includes('FULL SCAN'));
  });

  it('should reuse existing panel on second call', async () => {
    const client = makeClient();
    stubExplain(client);
    stubSql(client);

    await QueryCostPanel.createOrShow(client, 'SELECT * FROM users');
    await QueryCostPanel.createOrShow(client, 'SELECT * FROM users');

    assert.strictEqual(createdPanels.length, 1);
  });

  it('should show performance summary', async () => {
    const client = makeClient();
    stubExplain(client);
    stubSql(client);

    await QueryCostPanel.createOrShow(client, 'SELECT * FROM users');

    const html = latestPanel().webview.html;
    assert.ok(html.includes('Performance Summary'));
    assert.ok(html.includes('1 full table scan'));
  });

  it('should show warnings for full scans', async () => {
    const client = makeClient();
    stubExplain(client);
    stubSql(client);

    await QueryCostPanel.createOrShow(client, 'SELECT * FROM users');

    const html = latestPanel().webview.html;
    assert.ok(html.includes('Warnings'));
    assert.ok(html.includes('Full table scan'));
  });

  it('should copy SQL on copySql message', async () => {
    const client = makeClient();
    stubExplain(client);
    stubSql(client);

    await QueryCostPanel.createOrShow(client, 'SELECT * FROM users');
    clipboardMock.reset();
    latestPanel().webview.simulateMessage({ command: 'copySql' });

    assert.strictEqual(clipboardMock.text, 'SELECT * FROM users');
  });

  it('should copy plan text on copyPlan message', async () => {
    const client = makeClient();
    stubExplain(client);
    stubSql(client);

    await QueryCostPanel.createOrShow(client, 'SELECT * FROM users');
    clipboardMock.reset();
    latestPanel().webview.simulateMessage({ command: 'copyPlan' });

    assert.ok(clipboardMock.text?.includes('SCAN TABLE users'));
  });

  it('should show index suggestions for scanned tables', async () => {
    const client = makeClient();
    stubExplain(client);
    stubSql(client);

    await QueryCostPanel.createOrShow(
      client,
      'SELECT * FROM users WHERE active = 1',
    );

    const html = latestPanel().webview.html;
    assert.ok(html.includes('Suggestions'));
    assert.ok(html.includes('idx_users_active'));
  });

  it('should copy suggestion SQL on copySuggestion message', async () => {
    const client = makeClient();
    stubExplain(client);
    stubSql(client);

    await QueryCostPanel.createOrShow(
      client,
      'SELECT * FROM users WHERE active = 1',
    );
    clipboardMock.reset();
    latestPanel().webview.simulateMessage({
      command: 'copySuggestion',
      index: 0,
    });

    assert.ok(clipboardMock.text?.includes('CREATE INDEX'));
    assert.ok(clipboardMock.text?.includes('idx_users_active'));
  });

  it('should run suggestion and show success message', async () => {
    const client = makeClient();
    stubExplain(client);
    stubSql(client);

    await QueryCostPanel.createOrShow(
      client,
      'SELECT * FROM users WHERE active = 1',
    );
    messageMock.reset();
    latestPanel().webview.simulateMessage({
      command: 'runSuggestion',
      index: 0,
    });

    // Allow async _runSuggestion to complete
    await new Promise((r) => setTimeout(r, 50));

    assert.ok(
      messageMock.infos.some((m) => m.includes('Index created')),
    );
  });

  it('should show error when run suggestion fails', async () => {
    const client = makeClient();
    stubExplain(client);
    const sqlStub = sinon.stub(client, 'sql');
    // First call is _getExistingIndexes (returns empty)
    sqlStub.onFirstCall().resolves({ columns: ['name'], rows: [] });
    // Second call is the DDL execution (fails)
    sqlStub.onSecondCall().rejects(new Error('permission denied'));

    await QueryCostPanel.createOrShow(
      client,
      'SELECT * FROM users WHERE active = 1',
    );
    messageMock.reset();
    latestPanel().webview.simulateMessage({
      command: 'runSuggestion',
      index: 0,
    });

    await new Promise((r) => setTimeout(r, 50));

    assert.ok(
      messageMock.errors.some((m) => m.includes('permission denied')),
    );
  });

  it('should clean up on dispose', async () => {
    const client = makeClient();
    stubExplain(client);
    stubSql(client);

    await QueryCostPanel.createOrShow(client, 'SELECT * FROM users');
    assert.strictEqual(createdPanels.length, 1);

    latestPanel().dispose();

    // Creating again should make a new panel
    await QueryCostPanel.createOrShow(client, 'SELECT * FROM users');
    assert.strictEqual(createdPanels.length, 2);
  });
});
