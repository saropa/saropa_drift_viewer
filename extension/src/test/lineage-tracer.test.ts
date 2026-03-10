import * as assert from 'assert';
import {
  LineageTracer, sqlLiteral, generateDeleteSql,
} from '../lineage/lineage-tracer';
import type { ILineageResult } from '../lineage/lineage-types';

// ---- Stub API client ----

interface ISqlResult {
  columns: string[];
  rows: unknown[][];
}

interface IFkResult {
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

interface ITableMeta {
  name: string;
  columns: { name: string; type: string; pk: boolean }[];
  rowCount: number;
}

/** Build a minimal mock client for testing. */
function mockClient(opts: {
  tables: ITableMeta[];
  fks: Record<string, IFkResult[]>;
  rows: Record<string, ISqlResult>;
}): InstanceType<typeof LineageTracer> {
  const client = {
    schemaMetadata: async () => opts.tables,
    tableFkMeta: async (name: string) => opts.fks[name] ?? [],
    sql: async (query: string) => {
      for (const [key, val] of Object.entries(opts.rows)) {
        if (query.includes(key)) return val;
      }
      return { columns: [], rows: [] };
    },
  };
  return new LineageTracer(client as never);
}

// ---- Test data builders ----

function tbl(name: string, pk = 'id'): ITableMeta {
  return {
    name,
    columns: [
      { name: pk, type: 'INTEGER', pk: true },
      { name: 'name', type: 'TEXT', pk: false },
    ],
    rowCount: 1,
  };
}

function sqlResult(
  columns: string[], ...rows: unknown[][]
): ISqlResult {
  return { columns, rows };
}

// ---- Tests ----

describe('sqlLiteral', () => {
  it('handles numbers', () => {
    assert.strictEqual(sqlLiteral(42), '42');
    assert.strictEqual(sqlLiteral(3.14), '3.14');
  });

  it('handles numeric strings', () => {
    assert.strictEqual(sqlLiteral('42'), '42');
  });

  it('quotes non-numeric strings', () => {
    assert.strictEqual(sqlLiteral('hello'), "'hello'");
  });

  it('escapes single quotes in strings', () => {
    assert.strictEqual(sqlLiteral("it's"), "'it''s'");
  });

  it('handles null and undefined', () => {
    assert.strictEqual(sqlLiteral(null), 'NULL');
    assert.strictEqual(sqlLiteral(undefined), 'NULL');
  });
});

describe('LineageTracer', () => {
  it('returns root only when no FKs exist', async () => {
    const tracer = mockClient({
      tables: [tbl('users')],
      fks: {},
      rows: { '"users"': sqlResult(['id', 'name'], [1, 'Alice']) },
    });

    const result = await tracer.trace('users', 'id', 1, 3, 'both');
    assert.strictEqual(result.root.table, 'users');
    assert.strictEqual(result.root.pkValue, 1);
    assert.strictEqual(result.upstreamCount, 0);
    assert.strictEqual(result.downstreamCount, 0);
    assert.strictEqual(result.root.children.length, 0);
  });

  it('finds upstream parent via FK', async () => {
    const tracer = mockClient({
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

    const result = await tracer.trace('orders', 'id', 10, 3, 'both');
    const upstream = result.root.children.filter(
      (c) => c.direction === 'upstream',
    );
    assert.strictEqual(upstream.length, 1);
    assert.strictEqual(upstream[0].table, 'users');
    assert.strictEqual(upstream[0].pkValue, 42);
    assert.strictEqual(upstream[0].fkColumn, 'user_id');
    assert.strictEqual(result.upstreamCount, 1);
  });

  it('finds downstream children', async () => {
    const tracer = mockClient({
      tables: [tbl('users'), tbl('orders')],
      fks: {
        users: [],
        orders: [{ fromColumn: 'user_id', toTable: 'users', toColumn: 'id' }],
      },
      rows: {
        '"users" WHERE "id"': sqlResult(['id', 'name'], [1, 'Alice']),
        '"orders" WHERE "user_id"': sqlResult(
          ['id', 'user_id', 'name'],
          [10, 1, 'Order A'],
          [11, 1, 'Order B'],
        ),
      },
    });

    const result = await tracer.trace('users', 'id', 1, 3, 'both');
    const downstream = result.root.children.filter(
      (c) => c.direction === 'downstream',
    );
    assert.strictEqual(downstream.length, 2);
    assert.strictEqual(result.downstreamCount, 2);
  });

  it('respects depth limit', async () => {
    const tracer = mockClient({
      tables: [tbl('a'), tbl('b'), tbl('c')],
      fks: {
        a: [],
        b: [{ fromColumn: 'a_id', toTable: 'a', toColumn: 'id' }],
        c: [{ fromColumn: 'b_id', toTable: 'b', toColumn: 'id' }],
      },
      rows: {
        '"a" WHERE "id"': sqlResult(['id', 'name'], [1, 'A1']),
        '"b" WHERE "a_id"': sqlResult(['id', 'a_id', 'name'], [2, 1, 'B1']),
        '"c" WHERE "b_id"': sqlResult(['id', 'b_id', 'name'], [3, 2, 'C1']),
      },
    });

    // Depth 1 should find b but not c
    const result = await tracer.trace('a', 'id', 1, 1, 'down');
    const downstream = result.root.children;
    assert.strictEqual(downstream.length, 1);
    assert.strictEqual(downstream[0].table, 'b');
    assert.strictEqual(downstream[0].children.length, 0);
  });

  it('handles circular references via visited set', async () => {
    const tracer = mockClient({
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
        '"nodes" WHERE "parent_id" = 1': sqlResult(
          ['id', 'parent_id', 'name'], [2, 1, 'N2'],
        ),
      },
    });

    const result = await tracer.trace('nodes', 'id', 1, 5, 'both');
    // Should not infinite-loop; total nodes should be finite
    const total = result.upstreamCount + result.downstreamCount;
    assert.ok(total <= 3, `Expected <= 3 nodes, got ${total}`);
  });

  it('upstream-only returns no downstream nodes', async () => {
    const tracer = mockClient({
      tables: [tbl('users'), tbl('orders')],
      fks: {
        users: [],
        orders: [{ fromColumn: 'user_id', toTable: 'users', toColumn: 'id' }],
      },
      rows: {
        '"orders"': sqlResult(
          ['id', 'user_id', 'name'], [10, 1, 'Order'],
        ),
        '"users"': sqlResult(['id', 'name'], [1, 'Alice']),
      },
    });

    const result = await tracer.trace('orders', 'id', 10, 3, 'up');
    assert.strictEqual(result.downstreamCount, 0);
    assert.strictEqual(result.upstreamCount, 1);
  });

  it('downstream-only returns no upstream nodes', async () => {
    const tracer = mockClient({
      tables: [tbl('users'), tbl('orders')],
      fks: {
        users: [],
        orders: [{ fromColumn: 'user_id', toTable: 'users', toColumn: 'id' }],
      },
      rows: {
        '"users" WHERE "id"': sqlResult(['id', 'name'], [1, 'Alice']),
        '"orders" WHERE "user_id"': sqlResult(
          ['id', 'user_id', 'name'], [10, 1, 'Order'],
        ),
      },
    });

    const result = await tracer.trace('users', 'id', 1, 3, 'down');
    assert.strictEqual(result.upstreamCount, 0);
    assert.strictEqual(result.downstreamCount, 1);
  });

  it('handles missing root row gracefully', async () => {
    const tracer = mockClient({
      tables: [tbl('users')],
      fks: { users: [] },
      rows: {},
    });

    const result = await tracer.trace('users', 'id', 999, 3, 'both');
    assert.strictEqual(result.root.table, 'users');
    assert.deepStrictEqual(result.root.preview, {});
    assert.strictEqual(result.upstreamCount, 0);
  });

  it('preview contains at most 5 columns', async () => {
    const tracer = mockClient({
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

    const result = await tracer.trace('wide', 'id', 1, 1, 'both');
    assert.strictEqual(
      Object.keys(result.root.preview).length, 5,
    );
  });
});

describe('generateDeleteSql', () => {
  it('produces children-first DELETE statements', () => {
    const lineage: ILineageResult = {
      root: {
        table: 'users', pkColumn: 'id', pkValue: 1,
        preview: {}, direction: 'root', children: [
          {
            table: 'orders', pkColumn: 'id', pkValue: 10,
            preview: {}, direction: 'downstream',
            fkColumn: 'user_id', children: [
              {
                table: 'items', pkColumn: 'id', pkValue: 100,
                preview: {}, direction: 'downstream',
                fkColumn: 'order_id', children: [],
              },
            ],
          },
        ],
      },
      upstreamCount: 0,
      downstreamCount: 2,
    };

    const sql = generateDeleteSql(lineage);
    const lines = sql.split('\n').filter((l) => l.startsWith('DELETE'));
    assert.strictEqual(lines.length, 3);
    assert.ok(lines[0].includes('"items"'));
    assert.ok(lines[1].includes('"orders"'));
    assert.ok(lines[2].includes('"users"'));
  });

  it('skips upstream nodes', () => {
    const lineage: ILineageResult = {
      root: {
        table: 'orders', pkColumn: 'id', pkValue: 10,
        preview: {}, direction: 'root', children: [
          {
            table: 'users', pkColumn: 'id', pkValue: 1,
            preview: {}, direction: 'upstream',
            fkColumn: 'user_id', children: [],
          },
        ],
      },
      upstreamCount: 1,
      downstreamCount: 0,
    };

    const sql = generateDeleteSql(lineage);
    const lines = sql.split('\n').filter((l) => l.startsWith('DELETE'));
    assert.strictEqual(lines.length, 1);
    assert.ok(lines[0].includes('"orders"'));
  });
});
