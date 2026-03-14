import * as assert from 'assert';
import { mockImpactClient, tbl, sqlResult } from './lineage-test-fixtures';

describe('ImpactAnalyzer', () => {
  it('returns empty outbound/inbound when no FKs exist', async () => {
    const analyzer = mockImpactClient({
      tables: [tbl('users')],
      fks: { users: [] },
      rows: { '"users"': sqlResult(['id', 'name'], [1, 'Alice']) },
    });

    const result = await analyzer.analyze('users', 'id', 1, 3);
    assert.strictEqual(result.root.table, 'users');
    assert.strictEqual(result.root.pkValue, 1);
    assert.strictEqual(result.outbound.length, 0);
    assert.strictEqual(result.inbound.length, 0);
    assert.strictEqual(result.summary.totalRows, 0);
    assert.strictEqual(result.summary.totalTables, 0);
  });

  it('resolves outbound parent refs', async () => {
    const analyzer = mockImpactClient({
      tables: [tbl('orders'), tbl('users')],
      fks: {
        orders: [{ fromColumn: 'user_id', toTable: 'users', toColumn: 'id' }],
        users: [],
      },
      rows: {
        '"orders"': sqlResult(
          ['id', 'user_id', 'name'], [10, 42, 'Order A'],
        ),
        '"users"': sqlResult(['id', 'name'], [42, 'Alice']),
      },
    });

    const result = await analyzer.analyze('orders', 'id', 10, 3);
    assert.strictEqual(result.outbound.length, 1);
    assert.strictEqual(result.outbound[0].table, 'users');
    assert.strictEqual(result.outbound[0].pkValue, 42);
    assert.strictEqual(result.outbound[0].fkColumn, 'user_id');
  });

  it('resolves inbound child branches with counts', async () => {
    const analyzer = mockImpactClient({
      tables: [tbl('users'), tbl('orders')],
      fks: {
        users: [],
        orders: [{ fromColumn: 'user_id', toTable: 'users', toColumn: 'id' }],
      },
      rows: {
        '"users" WHERE "id"': sqlResult(['id', 'name'], [1, 'Alice']),
        'COUNT(*) AS c FROM "orders"': sqlResult(['c'], [2]),
        '"orders" WHERE "user_id"': sqlResult(
          ['id', 'user_id', 'name'],
          [10, 1, 'Order A'],
          [11, 1, 'Order B'],
        ),
      },
    });

    const result = await analyzer.analyze('users', 'id', 1, 3);
    assert.strictEqual(result.inbound.length, 1);
    assert.strictEqual(result.inbound[0].table, 'orders');
    assert.strictEqual(result.inbound[0].fkColumn, 'user_id');
    assert.strictEqual(result.inbound[0].totalCount, 2);
    assert.strictEqual(result.inbound[0].rows.length, 2);
    assert.strictEqual(result.inbound[0].truncated, false);
  });

  it('groups children by table into separate branches', async () => {
    const analyzer = mockImpactClient({
      tables: [tbl('users'), tbl('orders'), tbl('sessions')],
      fks: {
        users: [],
        orders: [{ fromColumn: 'user_id', toTable: 'users', toColumn: 'id' }],
        sessions: [{ fromColumn: 'user_id', toTable: 'users', toColumn: 'id' }],
      },
      rows: {
        '"users" WHERE "id"': sqlResult(['id', 'name'], [1, 'Alice']),
        'COUNT(*) AS c FROM "orders"': sqlResult(['c'], [2]),
        'COUNT(*) AS c FROM "sessions"': sqlResult(['c'], [1]),
        '"orders" WHERE "user_id"': sqlResult(
          ['id', 'user_id'], [10, 1], [11, 1],
        ),
        '"sessions" WHERE "user_id"': sqlResult(
          ['id', 'user_id'], [20, 1],
        ),
      },
    });

    const result = await analyzer.analyze('users', 'id', 1, 3);
    assert.strictEqual(result.inbound.length, 2);
    const tables = result.inbound.map((b) => b.table).sort();
    assert.deepStrictEqual(tables, ['orders', 'sessions']);
  });

  it('resolves recursive children (depth > 1)', async () => {
    const analyzer = mockImpactClient({
      tables: [tbl('users'), tbl('orders'), tbl('items')],
      fks: {
        users: [],
        orders: [{ fromColumn: 'user_id', toTable: 'users', toColumn: 'id' }],
        items: [{ fromColumn: 'order_id', toTable: 'orders', toColumn: 'id' }],
      },
      rows: {
        '"users" WHERE "id"': sqlResult(['id', 'name'], [1, 'Alice']),
        'COUNT(*) AS c FROM "orders"': sqlResult(['c'], [1]),
        'COUNT(*) AS c FROM "items"': sqlResult(['c'], [2]),
        '"orders" WHERE "user_id"': sqlResult(
          ['id', 'user_id'], [10, 1],
        ),
        '"items" WHERE "order_id"': sqlResult(
          ['id', 'order_id'], [100, 10], [101, 10],
        ),
      },
    });

    const result = await analyzer.analyze('users', 'id', 1, 3);
    assert.strictEqual(result.inbound.length, 1);
    const ordersBranch = result.inbound[0];
    assert.strictEqual(ordersBranch.table, 'orders');
    assert.strictEqual(ordersBranch.rows.length, 1);
    assert.strictEqual(ordersBranch.rows[0].children.length, 1);
    const itemsBranch = ordersBranch.rows[0].children[0];
    assert.strictEqual(itemsBranch.table, 'items');
    assert.strictEqual(itemsBranch.rows.length, 2);
  });

  it('respects maxDepth limit', async () => {
    const analyzer = mockImpactClient({
      tables: [tbl('a'), tbl('b'), tbl('c')],
      fks: {
        a: [],
        b: [{ fromColumn: 'a_id', toTable: 'a', toColumn: 'id' }],
        c: [{ fromColumn: 'b_id', toTable: 'b', toColumn: 'id' }],
      },
      rows: {
        '"a" WHERE "id"': sqlResult(['id', 'name'], [1, 'A1']),
        'COUNT(*) AS c FROM "b"': sqlResult(['c'], [1]),
        'COUNT(*) AS c FROM "c"': sqlResult(['c'], [1]),
        '"b" WHERE "a_id"': sqlResult(['id', 'a_id'], [2, 1]),
        '"c" WHERE "b_id"': sqlResult(['id', 'b_id'], [3, 2]),
      },
    });

    // Depth 1 should find b but not recurse into c
    const result = await analyzer.analyze('a', 'id', 1, 1);
    assert.strictEqual(result.inbound.length, 1);
    assert.strictEqual(result.inbound[0].table, 'b');
    assert.strictEqual(result.inbound[0].rows[0].children.length, 0);
  });

  it('handles circular FK references', async () => {
    const analyzer = mockImpactClient({
      tables: [tbl('nodes')],
      fks: {
        nodes: [
          { fromColumn: 'parent_id', toTable: 'nodes', toColumn: 'id' },
        ],
      },
      rows: {
        '"nodes" WHERE "id" = 1': sqlResult(
          ['id', 'parent_id', 'name'], [1, 2, 'N1'],
        ),
        '"nodes" WHERE "id" = 2': sqlResult(
          ['id', 'parent_id', 'name'], [2, 1, 'N2'],
        ),
        'COUNT(*) AS c FROM "nodes" WHERE "parent_id" = 1': sqlResult(['c'], [1]),
        '"nodes" WHERE "parent_id" = 1': sqlResult(
          ['id', 'parent_id', 'name'], [2, 1, 'N2'],
        ),
        'COUNT(*) AS c FROM "nodes" WHERE "parent_id" = 2': sqlResult(['c'], [1]),
        '"nodes" WHERE "parent_id" = 2': sqlResult(
          ['id', 'parent_id', 'name'], [1, 2, 'N1'],
        ),
      },
    });

    // Should not infinite-loop
    const result = await analyzer.analyze('nodes', 'id', 1, 5);
    const totalInbound = result.summary.totalRows;
    assert.ok(totalInbound <= 3, `Expected <= 3 inbound rows, got ${totalInbound}`);
  });

  it('handles missing root row gracefully', async () => {
    const analyzer = mockImpactClient({
      tables: [tbl('users')],
      fks: { users: [] },
      rows: {},
    });

    const result = await analyzer.analyze('users', 'id', 999, 3);
    assert.strictEqual(result.root.table, 'users');
    assert.deepStrictEqual(result.root.preview, {});
    assert.strictEqual(result.outbound.length, 0);
    assert.strictEqual(result.inbound.length, 0);
  });

  it('skips null FK values in outbound', async () => {
    const analyzer = mockImpactClient({
      tables: [tbl('orders'), tbl('users')],
      fks: {
        orders: [{ fromColumn: 'user_id', toTable: 'users', toColumn: 'id' }],
        users: [],
      },
      rows: {
        // user_id is null in this row
        '"orders"': sqlResult(
          ['id', 'user_id', 'name'], [10, null, 'Order A'],
        ),
      },
    });

    const result = await analyzer.analyze('orders', 'id', 10, 3);
    assert.strictEqual(result.outbound.length, 0);
  });

  it('summary counts are accurate', async () => {
    const analyzer = mockImpactClient({
      tables: [tbl('users'), tbl('orders'), tbl('sessions')],
      fks: {
        users: [],
        orders: [{ fromColumn: 'user_id', toTable: 'users', toColumn: 'id' }],
        sessions: [{ fromColumn: 'user_id', toTable: 'users', toColumn: 'id' }],
      },
      rows: {
        '"users" WHERE "id"': sqlResult(['id', 'name'], [1, 'Alice']),
        'COUNT(*) AS c FROM "orders"': sqlResult(['c'], [5]),
        'COUNT(*) AS c FROM "sessions"': sqlResult(['c'], [3]),
        '"orders" WHERE "user_id"': sqlResult(
          ['id', 'user_id'], [10, 1], [11, 1],
        ),
        '"sessions" WHERE "user_id"': sqlResult(
          ['id', 'user_id'], [20, 1],
        ),
      },
    });

    const result = await analyzer.analyze('users', 'id', 1, 3);
    assert.strictEqual(result.summary.totalRows, 8);
    assert.strictEqual(result.summary.totalTables, 2);
    const ordersSummary = result.summary.tables.find((t) => t.name === 'orders');
    assert.strictEqual(ordersSummary?.rowCount, 5);
    const sessionsSummary = result.summary.tables.find((t) => t.name === 'sessions');
    assert.strictEqual(sessionsSummary?.rowCount, 3);

    // Verify truncation: COUNT=5 but only 2 rows expanded
    const ordersBranch = result.inbound.find((b) => b.table === 'orders');
    assert.strictEqual(ordersBranch?.truncated, true);
    assert.strictEqual(ordersBranch?.totalCount, 5);
    assert.strictEqual(ordersBranch?.rows.length, 2);
  });

  it('preview contains at most 5 columns', async () => {
    const analyzer = mockImpactClient({
      tables: [{
        name: 'wide',
        columns: [
          { name: 'id', type: 'INTEGER', pk: true },
          { name: 'a', type: 'TEXT', pk: false },
          { name: 'b', type: 'TEXT', pk: false },
          { name: 'c', type: 'TEXT', pk: false },
          { name: 'd', type: 'TEXT', pk: false },
          { name: 'e', type: 'TEXT', pk: false },
          { name: 'f', type: 'TEXT', pk: false },
        ],
        rowCount: 1,
      }],
      fks: { wide: [] },
      rows: {
        '"wide"': sqlResult(
          ['id', 'a', 'b', 'c', 'd', 'e', 'f'],
          [1, 'A', 'B', 'C', 'D', 'E', 'F'],
        ),
      },
    });

    const result = await analyzer.analyze('wide', 'id', 1, 1);
    assert.strictEqual(Object.keys(result.root.preview).length, 5);
  });
});
