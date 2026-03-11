import * as assert from 'assert';
import * as sinon from 'sinon';
import { DriftApiClient } from '../api-client';
import { IndexSuggester } from '../query-cost/index-suggester';
import type { IParsedPlan, IPlanNode, IPerformanceSummary } from '../query-cost/query-cost-types';

function makeClient(): DriftApiClient {
  return new DriftApiClient('127.0.0.1', 9999);
}

function makeSummary(overrides: Partial<IPerformanceSummary> = {}): IPerformanceSummary {
  return { scanCount: 0, indexCount: 0, tempBTreeCount: 0, totalNodes: 0, ...overrides };
}

function makeNode(overrides: Partial<IPlanNode> = {}): IPlanNode {
  return {
    id: 2,
    parent: 0,
    detail: '',
    operation: 'other',
    isFullScan: false,
    children: [],
    ...overrides,
  };
}

function makePlan(nodes: IPlanNode[], summary?: Partial<IPerformanceSummary>): IParsedPlan {
  return { nodes, warnings: [], summary: makeSummary(summary) };
}

describe('IndexSuggester', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('should suggest index for WHERE clause column on scanned table', async () => {
    const client = makeClient();
    sinon.stub(client, 'sql').resolves({ columns: ['name'], rows: [] });

    const suggester = new IndexSuggester(client);
    const plan = makePlan([
      makeNode({
        detail: 'SCAN TABLE users',
        operation: 'scan',
        table: 'users',
        isFullScan: true,
      }),
    ]);

    const suggestions = await suggester.suggest(
      'SELECT * FROM users WHERE active = 1',
      plan,
    );

    assert.strictEqual(suggestions.length, 1);
    assert.ok(suggestions[0].sql.includes('idx_users_active'));
    assert.ok(suggestions[0].sql.includes('ON "users"'));
    assert.ok(suggestions[0].reason.includes('users'));
    assert.strictEqual(suggestions[0].impact, 'high');
  });

  it('should suggest index for JOIN column', async () => {
    const client = makeClient();
    sinon.stub(client, 'sql').resolves({ columns: ['name'], rows: [] });

    const suggester = new IndexSuggester(client);
    const plan = makePlan([
      makeNode({
        detail: 'SCAN TABLE orders',
        operation: 'scan',
        table: 'orders',
        isFullScan: true,
      }),
    ]);

    const suggestions = await suggester.suggest(
      'SELECT * FROM orders JOIN users ON orders.user_id = users.id',
      plan,
    );

    assert.strictEqual(suggestions.length, 1);
    assert.ok(suggestions[0].sql.includes('user_id'));
    assert.ok(suggestions[0].sql.includes('ON "orders"'));
  });

  it('should suggest index for ORDER BY with temp B-tree', async () => {
    const client = makeClient();
    sinon.stub(client, 'sql').resolves({ columns: ['name'], rows: [] });

    const suggester = new IndexSuggester(client);
    const plan = makePlan([
      makeNode({
        detail: 'SCAN TABLE users',
        operation: 'scan',
        table: 'users',
        isFullScan: true,
      }),
      makeNode({
        id: 4,
        detail: 'USE TEMP B-TREE FOR ORDER BY',
        operation: 'use_temp_btree',
      }),
    ]);

    const suggestions = await suggester.suggest(
      'SELECT * FROM users ORDER BY name',
      plan,
    );

    // Should have both a scan suggestion and an ORDER BY suggestion
    const orderSuggestion = suggestions.find((s) =>
      s.reason.includes('ORDER BY'),
    );
    assert.ok(orderSuggestion, 'should suggest index for ORDER BY');
    assert.ok(orderSuggestion!.sql.includes('name'));
    assert.strictEqual(orderSuggestion!.impact, 'medium');
  });

  it('should skip suggestion if index already exists', async () => {
    const client = makeClient();
    sinon.stub(client, 'sql').resolves({
      columns: ['name'],
      rows: [['idx_users_active']],
    });

    const suggester = new IndexSuggester(client);
    const plan = makePlan([
      makeNode({
        detail: 'SCAN TABLE users',
        operation: 'scan',
        table: 'users',
        isFullScan: true,
      }),
    ]);

    const suggestions = await suggester.suggest(
      'SELECT * FROM users WHERE active = 1',
      plan,
    );

    assert.strictEqual(suggestions.length, 0);
  });

  it('should return no suggestions when all indexes used', async () => {
    const client = makeClient();
    sinon.stub(client, 'sql').resolves({ columns: ['name'], rows: [] });

    const suggester = new IndexSuggester(client);
    const plan = makePlan([
      makeNode({
        detail: 'SEARCH TABLE users USING INDEX idx_email (email=?)',
        operation: 'search',
        table: 'users',
        index: 'idx_email',
        isFullScan: false,
      }),
    ]);

    const suggestions = await suggester.suggest(
      'SELECT * FROM users WHERE email = ?',
      plan,
    );

    assert.strictEqual(suggestions.length, 0);
  });

  it('should generate multiple suggestions for multiple scans', async () => {
    const client = makeClient();
    sinon.stub(client, 'sql').resolves({ columns: ['name'], rows: [] });

    const suggester = new IndexSuggester(client);
    const plan = makePlan([
      makeNode({
        id: 2,
        detail: 'SCAN TABLE users',
        operation: 'scan',
        table: 'users',
        isFullScan: true,
      }),
      makeNode({
        id: 3,
        detail: 'SCAN TABLE orders',
        operation: 'scan',
        table: 'orders',
        isFullScan: true,
      }),
    ]);

    const suggestions = await suggester.suggest(
      'SELECT * FROM users JOIN orders ON orders.user_id = users.id WHERE users.active = 1',
      plan,
    );

    assert.ok(suggestions.length >= 2, `expected >= 2 suggestions, got ${suggestions.length}`);
  });

  it('should set impact to high for full scan suggestions', async () => {
    const client = makeClient();
    sinon.stub(client, 'sql').resolves({ columns: ['name'], rows: [] });

    const suggester = new IndexSuggester(client);
    const plan = makePlan([
      makeNode({
        detail: 'SCAN TABLE users',
        operation: 'scan',
        table: 'users',
        isFullScan: true,
      }),
    ]);

    const suggestions = await suggester.suggest(
      'SELECT * FROM users WHERE active = 1',
      plan,
    );

    assert.strictEqual(suggestions.length, 1);
    assert.strictEqual(suggestions[0].impact, 'high');
  });
});

describe('IndexSuggester SQL extraction helpers', () => {
  it('should extract WHERE columns for a given table', () => {
    const client = makeClient();
    const suggester = new IndexSuggester(client);
    const cols = suggester.extractWhereColumns(
      'SELECT * FROM users WHERE active = 1 AND status = 2',
      'users',
    );
    assert.ok(cols.includes('active'));
    assert.ok(cols.includes('status'));
  });

  it('should extract JOIN columns for a given table', () => {
    const client = makeClient();
    const suggester = new IndexSuggester(client);
    const cols = suggester.extractJoinColumns(
      'SELECT * FROM orders JOIN users ON orders.user_id = users.id',
      'orders',
    );
    assert.ok(cols.includes('user_id'));
  });

  it('should extract ORDER BY columns', () => {
    const client = makeClient();
    const suggester = new IndexSuggester(client);
    const cols = suggester.extractOrderByColumns(
      'SELECT * FROM users ORDER BY name ASC, email DESC',
    );
    assert.deepStrictEqual(cols, ['name', 'email']);
  });

  it('should extract main table from FROM clause', () => {
    const client = makeClient();
    const suggester = new IndexSuggester(client);
    const table = suggester.extractMainTable(
      'SELECT * FROM users WHERE active = 1',
    );
    assert.strictEqual(table, 'users');
  });
});
