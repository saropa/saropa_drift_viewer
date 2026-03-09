import * as assert from 'assert';
import * as sinon from 'sinon';
import {
  clipboardMock,
  createdPanels,
  MockMemento,
  MockWebviewPanel,
  resetMocks,
} from './vscode-mock';
import {
  IQueryHistoryEntry,
  SqlNotebookPanel,
} from '../sql-notebook/sql-notebook-panel';
import { DriftApiClient } from '../api-client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Msg = Record<string, any>;

describe('SqlNotebookPanel', () => {
  let fetchStub: sinon.SinonStub;

  beforeEach(() => {
    resetMocks();
    (SqlNotebookPanel as any).currentPanel = undefined;
    fetchStub = sinon.stub(globalThis, 'fetch');
    fetchStub.rejects(new Error('connection refused'));
  });

  afterEach(() => {
    fetchStub.restore();
  });

  function fakeContext(): any {
    return {
      subscriptions: [],
      globalState: new MockMemento(),
    };
  }

  function makeClient(): DriftApiClient {
    return new DriftApiClient('127.0.0.1', 8642);
  }

  function latestPanel(): MockWebviewPanel {
    return createdPanels[createdPanels.length - 1];
  }

  function posted(command: string): Msg[] {
    return (latestPanel().webview.postedMessages as Msg[]).filter(
      (m) => m.command === command,
    );
  }

  async function flush(): Promise<void> {
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
  }

  // --- Singleton behaviour ---

  it('should create a new panel when none exists', () => {
    SqlNotebookPanel.createOrShow(fakeContext(), makeClient());
    assert.strictEqual(createdPanels.length, 1);
    assert.ok(SqlNotebookPanel.currentPanel);
  });

  it('should reveal existing panel instead of creating a second', () => {
    const ctx = fakeContext();
    const client = makeClient();
    SqlNotebookPanel.createOrShow(ctx, client);
    SqlNotebookPanel.createOrShow(ctx, client);
    assert.strictEqual(createdPanels.length, 1);
    assert.ok(latestPanel().revealed);
  });

  it('should clear singleton on dispose', () => {
    SqlNotebookPanel.createOrShow(fakeContext(), makeClient());
    latestPanel().simulateClose();
    assert.strictEqual(SqlNotebookPanel.currentPanel, undefined);
  });

  // --- Initial HTML ---

  it('should set HTML with SQL input and toolbar', () => {
    SqlNotebookPanel.createOrShow(fakeContext(), makeClient());
    const html = latestPanel().webview.html;
    assert.ok(html.includes('sql-input'), 'should contain sql-input textarea');
    assert.ok(html.includes('btn-execute'), 'should contain execute button');
    assert.ok(html.includes('btn-explain'), 'should contain explain button');
    assert.ok(html.includes('tab-bar'), 'should contain tab bar');
    assert.ok(html.includes('history-sidebar'), 'should contain history sidebar');
  });

  // --- Query execution ---

  it('should post queryResult on successful execute', async () => {
    const client = makeClient();
    const sqlStub = sinon.stub(client, 'sql').resolves({
      columns: ['id', 'name'],
      rows: [[1, 'Alice']],
    });

    SqlNotebookPanel.createOrShow(fakeContext(), client);

    latestPanel().webview.simulateMessage({
      command: 'execute',
      sql: 'SELECT * FROM users',
      tabId: 't1',
    });
    await flush();

    const results = posted('queryResult');
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].tabId, 't1');
    assert.deepStrictEqual(results[0].columns, ['id', 'name']);
    assert.deepStrictEqual(results[0].rows, [[1, 'Alice']]);
    assert.ok(typeof results[0].elapsed === 'number');

    sqlStub.restore();
  });

  it('should post queryError on SQL failure', async () => {
    const client = makeClient();
    const sqlStub = sinon
      .stub(client, 'sql')
      .rejects(new Error('no such table: users'));

    SqlNotebookPanel.createOrShow(fakeContext(), client);

    latestPanel().webview.simulateMessage({
      command: 'execute',
      sql: 'SELECT * FROM users',
      tabId: 't1',
    });
    await flush();

    const errors = posted('queryError');
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].tabId, 't1');
    assert.ok(
      (errors[0].error as string).includes('no such table'),
    );

    sqlStub.restore();
  });

  // --- Explain ---

  it('should post explainResult on successful explain', async () => {
    const client = makeClient();
    const explainStub = sinon.stub(client, 'explainSql').resolves({
      rows: [{ id: 0, parent: 0, detail: 'SCAN TABLE users' }],
      sql: 'EXPLAIN QUERY PLAN SELECT * FROM users',
    });

    SqlNotebookPanel.createOrShow(fakeContext(), client);

    latestPanel().webview.simulateMessage({
      command: 'explain',
      sql: 'SELECT * FROM users',
      tabId: 't1',
    });
    await flush();

    const results = posted('explainResult');
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].tabId, 't1');
    assert.ok((results[0].rows as unknown[]).length > 0);

    explainStub.restore();
  });

  it('should post queryError on explain failure', async () => {
    const client = makeClient();
    const explainStub = sinon
      .stub(client, 'explainSql')
      .rejects(new Error('syntax error'));

    SqlNotebookPanel.createOrShow(fakeContext(), client);

    latestPanel().webview.simulateMessage({
      command: 'explain',
      sql: 'INVALID SQL',
      tabId: 't1',
    });
    await flush();

    const errors = posted('queryError');
    assert.strictEqual(errors.length, 1);
    assert.ok((errors[0].error as string).includes('syntax error'));

    explainStub.restore();
  });

  // --- Schema ---

  it('should send schema on getSchema message', async () => {
    const client = makeClient();
    const schemaStub = sinon.stub(client, 'schemaMetadata').resolves([
      { name: 'users', columns: [{ name: 'id', type: 'INTEGER', pk: true }], rowCount: 10 },
    ]);

    SqlNotebookPanel.createOrShow(fakeContext(), client);
    await flush();

    const schemas = posted('schema');
    assert.ok(schemas.length >= 1, 'should have sent schema');
    assert.strictEqual(
      (schemas[0].tables as Array<{ name: string }>)[0].name,
      'users',
    );

    schemaStub.restore();
  });

  it('should handle schema fetch failure gracefully', async () => {
    const client = makeClient();
    sinon.stub(client, 'schemaMetadata').rejects(new Error('unreachable'));

    SqlNotebookPanel.createOrShow(fakeContext(), client);
    await flush();
    assert.ok(SqlNotebookPanel.currentPanel, 'panel should still exist');
  });

  // --- Clipboard ---

  it('should copy text to clipboard on copyToClipboard message', async () => {
    SqlNotebookPanel.createOrShow(fakeContext(), makeClient());
    latestPanel().webview.simulateMessage({
      command: 'copyToClipboard',
      text: 'hello world',
    });
    await flush();
    assert.strictEqual(clipboardMock.text, 'hello world');
  });

  // --- History persistence ---

  it('should save history to globalState', async () => {
    const ctx = fakeContext();
    SqlNotebookPanel.createOrShow(ctx, makeClient());

    const entry: IQueryHistoryEntry = {
      sql: 'SELECT 1',
      timestamp: Date.now(),
      rowCount: 1,
      durationMs: 5,
    };

    latestPanel().webview.simulateMessage({
      command: 'saveHistory',
      history: [entry],
    });
    await flush();

    const stored = ctx.globalState.get(
      'driftViewer.sqlNotebookHistory',
    ) as IQueryHistoryEntry[];
    assert.ok(Array.isArray(stored));
    assert.strictEqual(stored.length, 1);
    assert.strictEqual(stored[0].sql, 'SELECT 1');
  });

  it('should load history from globalState', async () => {
    const ctx = fakeContext();
    const entry: IQueryHistoryEntry = {
      sql: 'SELECT 42',
      timestamp: 1000,
      rowCount: 1,
      durationMs: 3,
    };
    await ctx.globalState.update('driftViewer.sqlNotebookHistory', [entry]);

    SqlNotebookPanel.createOrShow(ctx, makeClient());
    await flush();

    const historyMsgs = posted('history');
    assert.ok(historyMsgs.length >= 1);
    assert.strictEqual(
      (historyMsgs[0].entries as IQueryHistoryEntry[])[0].sql,
      'SELECT 42',
    );
  });

  it('should trim history to MAX_HISTORY on save', async () => {
    const ctx = fakeContext();
    SqlNotebookPanel.createOrShow(ctx, makeClient());

    const entries: IQueryHistoryEntry[] = [];
    for (let i = 0; i < 60; i++) {
      entries.push({
        sql: `SELECT ${i}`,
        timestamp: i,
        rowCount: 1,
        durationMs: 1,
      });
    }

    latestPanel().webview.simulateMessage({
      command: 'saveHistory',
      history: entries,
    });
    await flush();

    const stored = ctx.globalState.get(
      'driftViewer.sqlNotebookHistory',
    ) as IQueryHistoryEntry[];
    assert.ok(stored);
    assert.strictEqual(stored.length, 50);
  });

  // --- Dispose safety ---

  it('should not post messages after dispose', async () => {
    const client = makeClient();
    const sqlStub = sinon.stub(client, 'sql').resolves({
      columns: ['x'],
      rows: [[1]],
    });

    SqlNotebookPanel.createOrShow(fakeContext(), client);
    const panel = latestPanel();
    const countBefore = panel.webview.postedMessages.length;

    panel.simulateClose();
    panel.webview.simulateMessage({
      command: 'execute',
      sql: 'SELECT 1',
      tabId: 't1',
    });
    await flush();

    const newMsgs = (panel.webview.postedMessages as Msg[])
      .slice(countBefore)
      .filter((m) => m.command === 'queryResult');
    assert.strictEqual(newMsgs.length, 0);

    sqlStub.restore();
  });
});
