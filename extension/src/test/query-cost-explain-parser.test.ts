import * as assert from 'assert';
import * as sinon from 'sinon';
import { DriftApiClient } from '../api-client';
import { ExplainParser } from '../query-cost/explain-parser';

function makeClient(): DriftApiClient {
  return new DriftApiClient('127.0.0.1', 9999);
}

describe('ExplainParser', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('should parse a SCAN node with table name', async () => {
    const client = makeClient();
    sinon.stub(client, 'explainSql').resolves({
      rows: [{ id: 2, parent: 0, notused: 0, detail: 'SCAN TABLE users' }],
      sql: 'EXPLAIN QUERY PLAN SELECT * FROM users',
    });

    const parser = new ExplainParser();
    const result = await parser.explain(client, 'SELECT * FROM users');

    assert.strictEqual(result.nodes.length, 1);
    assert.strictEqual(result.nodes[0].operation, 'scan');
    assert.strictEqual(result.nodes[0].table, 'users');
    assert.strictEqual(result.nodes[0].isFullScan, true);
  });

  it('should parse a SEARCH node with index name', async () => {
    const client = makeClient();
    sinon.stub(client, 'explainSql').resolves({
      rows: [{
        id: 2,
        parent: 0,
        notused: 0,
        detail: 'SEARCH TABLE orders USING INDEX idx_orders_user_id (user_id=?)',
      }],
      sql: 'EXPLAIN QUERY PLAN SELECT * FROM orders WHERE user_id = 1',
    });

    const parser = new ExplainParser();
    const result = await parser.explain(
      client,
      'SELECT * FROM orders WHERE user_id = 1',
    );

    assert.strictEqual(result.nodes.length, 1);
    assert.strictEqual(result.nodes[0].operation, 'search');
    assert.strictEqual(result.nodes[0].table, 'orders');
    assert.strictEqual(result.nodes[0].index, 'idx_orders_user_id');
    assert.strictEqual(result.nodes[0].isFullScan, false);
  });

  it('should detect full table scan (SCAN without USING INDEX)', async () => {
    const client = makeClient();
    sinon.stub(client, 'explainSql').resolves({
      rows: [
        { id: 2, parent: 0, notused: 0, detail: 'SCAN TABLE users' },
        { id: 3, parent: 0, notused: 0, detail: 'SCAN TABLE logs USING INDEX idx_logs_ts' },
      ],
      sql: 'EXPLAIN QUERY PLAN SELECT * FROM users, logs',
    });

    const parser = new ExplainParser();
    const result = await parser.explain(client, 'SELECT * FROM users, logs');

    assert.strictEqual(result.nodes[0].isFullScan, true);
    assert.strictEqual(result.nodes[1].isFullScan, false);
  });

  it('should parse USE TEMP B-TREE node', async () => {
    const client = makeClient();
    sinon.stub(client, 'explainSql').resolves({
      rows: [
        { id: 2, parent: 0, notused: 0, detail: 'SCAN TABLE users' },
        { id: 4, parent: 0, notused: 0, detail: 'USE TEMP B-TREE FOR ORDER BY' },
      ],
      sql: 'EXPLAIN QUERY PLAN SELECT * FROM users ORDER BY name',
    });

    const parser = new ExplainParser();
    const result = await parser.explain(
      client,
      'SELECT * FROM users ORDER BY name',
    );

    const tempNode = result.nodes.find(
      (n) => n.operation === 'use_temp_btree',
    );
    assert.ok(tempNode, 'should have a use_temp_btree node');
    assert.strictEqual(tempNode!.isFullScan, false);
  });

  it('should generate warnings for full table scans', async () => {
    const client = makeClient();
    sinon.stub(client, 'explainSql').resolves({
      rows: [
        { id: 2, parent: 0, notused: 0, detail: 'SCAN TABLE users' },
      ],
      sql: 'EXPLAIN QUERY PLAN SELECT * FROM users',
    });

    const parser = new ExplainParser();
    const result = await parser.explain(client, 'SELECT * FROM users');

    const scanWarnings = result.warnings.filter(
      (w) => w.severity === 'warning',
    );
    assert.strictEqual(scanWarnings.length, 1);
    assert.ok(scanWarnings[0].message.includes('users'));
    assert.strictEqual(scanWarnings[0].table, 'users');
  });

  it('should generate info warning for temp B-tree', async () => {
    const client = makeClient();
    sinon.stub(client, 'explainSql').resolves({
      rows: [
        { id: 2, parent: 0, notused: 0, detail: 'USE TEMP B-TREE FOR ORDER BY' },
      ],
      sql: 'EXPLAIN QUERY PLAN SELECT * FROM users ORDER BY name',
    });

    const parser = new ExplainParser();
    const result = await parser.explain(
      client,
      'SELECT * FROM users ORDER BY name',
    );

    const infoWarnings = result.warnings.filter(
      (w) => w.severity === 'info',
    );
    assert.strictEqual(infoWarnings.length, 1);
    assert.ok(infoWarnings[0].message.includes('Temporary B-tree'));
  });

  it('should handle COMPOUND queries', async () => {
    const client = makeClient();
    sinon.stub(client, 'explainSql').resolves({
      rows: [
        { id: 1, parent: 0, notused: 0, detail: 'COMPOUND SUBQUERIES 1 AND 2 USING TEMP B-TREE (UNION)' },
      ],
      sql: 'EXPLAIN QUERY PLAN SELECT 1 UNION SELECT 2',
    });

    const parser = new ExplainParser();
    const result = await parser.explain(
      client,
      'SELECT 1 UNION SELECT 2',
    );

    assert.strictEqual(result.nodes.length, 1);
    assert.strictEqual(result.nodes[0].operation, 'compound');
    assert.strictEqual(result.nodes[0].isFullScan, false);
  });

  it('should return empty plan for empty rows', async () => {
    const client = makeClient();
    sinon.stub(client, 'explainSql').resolves({
      rows: [],
      sql: 'EXPLAIN QUERY PLAN SELECT 1',
    });

    const parser = new ExplainParser();
    const result = await parser.explain(client, 'SELECT 1');

    assert.strictEqual(result.nodes.length, 0);
    assert.strictEqual(result.warnings.length, 0);
    assert.strictEqual(result.summary.totalNodes, 0);
  });

  it('should compute correct performance summary', async () => {
    const client = makeClient();
    sinon.stub(client, 'explainSql').resolves({
      rows: [
        { id: 2, parent: 0, notused: 0, detail: 'SCAN TABLE users' },
        { id: 3, parent: 0, notused: 0, detail: 'SEARCH TABLE orders USING INDEX idx_user_id (user_id=?)' },
        { id: 4, parent: 0, notused: 0, detail: 'USE TEMP B-TREE FOR ORDER BY' },
      ],
      sql: 'EXPLAIN QUERY PLAN ...',
    });

    const parser = new ExplainParser();
    const result = await parser.explain(client, 'SELECT ...');

    assert.strictEqual(result.summary.scanCount, 1);
    assert.strictEqual(result.summary.indexCount, 1);
    assert.strictEqual(result.summary.tempBTreeCount, 1);
    assert.strictEqual(result.summary.totalNodes, 3);
  });

  it('should build tree structure from parent-child rows', async () => {
    const client = makeClient();
    sinon.stub(client, 'explainSql').resolves({
      rows: [
        { id: 3, parent: 0, notused: 0, detail: 'SEARCH TABLE users USING INDEX idx_email (email=?)' },
        { id: 5, parent: 3, notused: 0, detail: 'SCAN TABLE posts' },
      ],
      sql: 'EXPLAIN QUERY PLAN ...',
    });

    const parser = new ExplainParser();
    const result = await parser.explain(client, 'SELECT ...');

    assert.strictEqual(result.nodes.length, 1);
    assert.strictEqual(result.nodes[0].children.length, 1);
    assert.strictEqual(result.nodes[0].children[0].operation, 'scan');
    assert.strictEqual(result.nodes[0].children[0].table, 'posts');
  });
});
