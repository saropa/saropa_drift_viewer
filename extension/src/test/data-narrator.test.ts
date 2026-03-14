import * as assert from 'assert';
import { mockNarratorClient, tbl, sqlResult } from './narrator-test-fixtures';

describe('DataNarrator', () => {
  it('describes root row with no FKs', async () => {
    const narrator = mockNarratorClient({
      tables: [tbl('users')],
      fks: { users: [] },
      rows: { '"users"': sqlResult(['id', 'name'], [42, 'Alice']) },
    });

    const graph = await narrator.buildGraph('users', 'id', 42);
    assert.strictEqual(graph.root.table, 'users');
    assert.strictEqual(graph.root.pkValue, 42);
    assert.strictEqual(graph.root.row['name'], 'Alice');
    assert.strictEqual(graph.relatedTables.size, 0);

    const result = narrator.generateNarrative(graph);
    assert.ok(result.text.includes('User'));
    assert.ok(result.text.includes('Alice'));
    assert.ok(result.text.includes('42'));
  });

  it('describes parent relationships', async () => {
    const narrator = mockNarratorClient({
      tables: [tbl('orders'), tbl('users')],
      fks: {
        orders: [{ fromColumn: 'user_id', toTable: 'users', toColumn: 'id' }],
        users: [],
      },
      rows: {
        '"orders"': sqlResult(['id', 'user_id', 'name'], [10, 42, 'Order A']),
        '"users"': sqlResult(['id', 'name'], [42, 'Alice']),
      },
    });

    const graph = await narrator.buildGraph('orders', 'id', 10);
    assert.strictEqual(graph.relatedTables.size, 1);

    const parentKey = Array.from(graph.relatedTables.keys()).find((k) => k.startsWith('parent:'));
    assert.ok(parentKey, 'Should have a parent relationship');

    const parent = graph.relatedTables.get(parentKey!);
    assert.strictEqual(parent?.table, 'users');
    assert.strictEqual(parent?.direction, 'parent');

    const result = narrator.generateNarrative(graph);
    assert.ok(result.text.includes('Belongs to'));
    assert.ok(result.text.includes('User'));
    assert.ok(result.text.includes('Alice'));
  });

  it('describes child relationships with counts', async () => {
    const narrator = mockNarratorClient({
      tables: [tbl('users'), tbl('orders')],
      fks: {
        users: [],
        orders: [{ fromColumn: 'user_id', toTable: 'users', toColumn: 'id' }],
      },
      rows: {
        '"users" WHERE "id"': sqlResult(['id', 'name'], [1, 'Alice']),
        'COUNT(*) as cnt FROM "orders"': sqlResult(['cnt'], [3]),
        '"orders" WHERE "user_id"': sqlResult(
          ['id', 'user_id', 'name'],
          [10, 1, 'Order A'],
          [11, 1, 'Order B'],
          [12, 1, 'Order C'],
        ),
      },
    });

    const graph = await narrator.buildGraph('users', 'id', 1);
    const childKey = Array.from(graph.relatedTables.keys()).find((k) => k.startsWith('child:'));
    assert.ok(childKey, 'Should have a child relationship');

    const child = graph.relatedTables.get(childKey!);
    assert.strictEqual(child?.table, 'orders');
    assert.strictEqual(child?.direction, 'child');
    assert.strictEqual(child?.rowCount, 3);

    const result = narrator.generateNarrative(graph);
    assert.ok(result.text.includes('Has 3 orders'));
    assert.ok(result.text.includes('Order A'));
  });

  it('handles truncated child results', async () => {
    const narrator = mockNarratorClient({
      tables: [tbl('users'), tbl('orders')],
      fks: {
        users: [],
        orders: [{ fromColumn: 'user_id', toTable: 'users', toColumn: 'id' }],
      },
      rows: {
        '"users" WHERE "id"': sqlResult(['id', 'name'], [1, 'Alice']),
        'COUNT(*) as cnt FROM "orders"': sqlResult(['cnt'], [15]),
        '"orders" WHERE "user_id"': sqlResult(
          ['id', 'user_id', 'name'],
          [10, 1, 'Order A'],
          [11, 1, 'Order B'],
        ),
      },
    });

    const graph = await narrator.buildGraph('users', 'id', 1);
    const childKey = Array.from(graph.relatedTables.keys()).find((k) => k.startsWith('child:'));
    const child = graph.relatedTables.get(childKey!);
    assert.strictEqual(child?.rowCount, 15);
    assert.strictEqual(child?.truncated, true);

    const result = narrator.generateNarrative(graph);
    assert.ok(result.text.includes('showing first'));
  });

  it('skips null FK values', async () => {
    const narrator = mockNarratorClient({
      tables: [tbl('orders'), tbl('users')],
      fks: {
        orders: [{ fromColumn: 'user_id', toTable: 'users', toColumn: 'id' }],
        users: [],
      },
      rows: {
        '"orders"': sqlResult(['id', 'user_id', 'name'], [10, null, 'Order A']),
      },
    });

    const graph = await narrator.buildGraph('orders', 'id', 10);
    const hasParent = Array.from(graph.relatedTables.keys()).some((k) => k.startsWith('parent:'));
    assert.strictEqual(hasParent, false);
  });

  it('skips tables with zero child rows', async () => {
    const narrator = mockNarratorClient({
      tables: [tbl('users'), tbl('orders')],
      fks: {
        users: [],
        orders: [{ fromColumn: 'user_id', toTable: 'users', toColumn: 'id' }],
      },
      rows: {
        '"users" WHERE "id"': sqlResult(['id', 'name'], [1, 'Alice']),
        'COUNT(*) as cnt FROM "orders"': sqlResult(['cnt'], [0]),
      },
    });

    const graph = await narrator.buildGraph('users', 'id', 1);
    assert.strictEqual(graph.relatedTables.size, 0);
  });

  it('detects name column from common names', async () => {
    const narrator = mockNarratorClient({
      tables: [{
        name: 'products',
        columns: [
          { name: 'id', type: 'INTEGER', pk: true },
          { name: 'title', type: 'TEXT', pk: false },
          { name: 'price', type: 'REAL', pk: false },
        ],
        rowCount: 1,
      }],
      fks: { products: [] },
      rows: { '"products"': sqlResult(['id', 'title', 'price'], [1, 'Widget', 9.99]) },
    });

    const graph = await narrator.buildGraph('products', 'id', 1);
    const result = narrator.generateNarrative(graph);
    assert.ok(result.text.includes('Widget'));
  });

  it('handles missing name column gracefully', async () => {
    const narrator = mockNarratorClient({
      tables: [{
        name: 'metrics',
        columns: [
          { name: 'id', type: 'INTEGER', pk: true },
          { name: 'value', type: 'REAL', pk: false },
        ],
        rowCount: 1,
      }],
      fks: { metrics: [] },
      rows: { '"metrics"': sqlResult(['id', 'value'], [1, 42.5]) },
    });

    const graph = await narrator.buildGraph('metrics', 'id', 1);
    const result = narrator.generateNarrative(graph);
    assert.ok(result.text.includes('Metric'));
    assert.ok(result.text.includes('id: 1'));
  });

  it('generates valid Markdown output', async () => {
    const narrator = mockNarratorClient({
      tables: [tbl('users')],
      fks: { users: [] },
      rows: { '"users"': sqlResult(['id', 'name'], [1, 'Alice']) },
    });

    const graph = await narrator.buildGraph('users', 'id', 1);
    const result = narrator.generateNarrative(graph);
    assert.ok(result.markdown.includes('**User'));
    assert.ok(result.markdown.includes('Alice'));
  });

  it('throws when row not found', async () => {
    const narrator = mockNarratorClient({
      tables: [tbl('users')],
      fks: { users: [] },
      rows: {},
    });

    try {
      await narrator.buildGraph('users', 'id', 999);
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('Row not found'));
    }
  });

  it('handles multiple parent FKs', async () => {
    const narrator = mockNarratorClient({
      tables: [tbl('order_items'), tbl('orders'), tbl('products')],
      fks: {
        order_items: [
          { fromColumn: 'order_id', toTable: 'orders', toColumn: 'id' },
          { fromColumn: 'product_id', toTable: 'products', toColumn: 'id' },
        ],
        orders: [],
        products: [],
      },
      rows: {
        '"order_items"': sqlResult(
          ['id', 'order_id', 'product_id'],
          [1, 10, 20],
        ),
        '"orders"': sqlResult(['id', 'name'], [10, 'Order A']),
        '"products"': sqlResult(['id', 'name'], [20, 'Widget']),
      },
    });

    const graph = await narrator.buildGraph('order_items', 'id', 1);
    const parentKeys = Array.from(graph.relatedTables.keys()).filter((k) => k.startsWith('parent:'));
    assert.strictEqual(parentKeys.length, 2);
  });

  it('handles multiple child tables', async () => {
    const narrator = mockNarratorClient({
      tables: [tbl('users'), tbl('orders'), tbl('sessions')],
      fks: {
        users: [],
        orders: [{ fromColumn: 'user_id', toTable: 'users', toColumn: 'id' }],
        sessions: [{ fromColumn: 'user_id', toTable: 'users', toColumn: 'id' }],
      },
      rows: {
        '"users" WHERE "id"': sqlResult(['id', 'name'], [1, 'Alice']),
        'COUNT(*) as cnt FROM "orders"': sqlResult(['cnt'], [2]),
        'COUNT(*) as cnt FROM "sessions"': sqlResult(['cnt'], [1]),
        '"orders" WHERE "user_id"': sqlResult(['id', 'user_id'], [10, 1], [11, 1]),
        '"sessions" WHERE "user_id"': sqlResult(['id', 'user_id'], [20, 1]),
      },
    });

    const graph = await narrator.buildGraph('users', 'id', 1);
    const childKeys = Array.from(graph.relatedTables.keys()).filter((k) => k.startsWith('child:'));
    assert.strictEqual(childKeys.length, 2);

    const result = narrator.generateNarrative(graph);
    assert.ok(result.text.includes('orders'));
    assert.ok(result.text.includes('session'));
  });
});
