import * as assert from 'assert';
import * as sinon from 'sinon';
import { AssertionInferrer } from '../test-gen/assertion-inferrer';
import type { AssertionType } from '../test-gen/test-gen-types';

function makeClient(opts: {
  tables?: { name: string; columns: { name: string; type: string; pk: boolean }[]; rowCount: number }[];
  fks?: Record<string, { fromColumn: string; toTable: string; toColumn: string }[]>;
  sqlResults?: Record<string, { columns: string[]; rows: unknown[][] }>;
}) {
  return {
    schemaMetadata: sinon.stub().resolves(opts.tables ?? []),
    tableFkMeta: sinon.stub().callsFake(
      async (t: string) => opts.fks?.[t] ?? [],
    ),
    sql: sinon.stub().callsFake(async (q: string) => {
      if (opts.sqlResults?.[q]) return opts.sqlResults[q];
      return { columns: ['cnt'], rows: [[0]] };
    }),
  };
}

function allTypes(): Set<AssertionType> {
  return new Set(['rowCount', 'fkIntegrity', 'notNull', 'unique', 'valueRange']);
}

describe('AssertionInferrer', () => {
  it('should generate row count assertion', async () => {
    const client = makeClient({
      tables: [{ name: 'users', columns: [], rowCount: 42 }],
    });
    const inferrer = new AssertionInferrer(client as never);
    const result = await inferrer.infer(['users'], new Set(['rowCount']));

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].type, 'rowCount');
    assert.strictEqual(result[0].table, 'users');
    assert.strictEqual(result[0].expectation, 'equals 42');
    assert.ok(result[0].sql.includes('COUNT(*)'));
    assert.ok(result[0].sql.includes('"users"'));
  });

  it('should generate FK integrity assertion', async () => {
    const client = makeClient({
      tables: [{ name: 'orders', columns: [], rowCount: 10 }],
      fks: {
        orders: [
          { fromColumn: 'user_id', toTable: 'users', toColumn: 'id' },
        ],
      },
    });
    const inferrer = new AssertionInferrer(client as never);
    const result = await inferrer.infer(['orders'], new Set(['fkIntegrity']));

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].type, 'fkIntegrity');
    assert.strictEqual(result[0].column, 'user_id');
    assert.ok(result[0].sql.includes('LEFT JOIN'));
    assert.ok(result[0].sql.includes('"users"'));
    assert.ok(result[0].sql.includes('"user_id"'));
    assert.strictEqual(result[0].expectation, 'is empty');
  });

  it('should generate not-null assertion for 0-null columns', async () => {
    const client = makeClient({
      tables: [{
        name: 'users',
        columns: [
          { name: 'id', type: 'INTEGER', pk: true },
          { name: 'email', type: 'TEXT', pk: false },
        ],
        rowCount: 5,
      }],
      sqlResults: {
        'SELECT COUNT(*) AS cnt FROM "users" WHERE "email" IS NULL': {
          columns: ['cnt'], rows: [[0]],
        },
      },
    });
    const inferrer = new AssertionInferrer(client as never);
    const result = await inferrer.infer(['users'], new Set(['notNull']));

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].type, 'notNull');
    assert.strictEqual(result[0].column, 'email');
    assert.strictEqual(result[0].expectation, 'equals 0');
  });

  it('should skip not-null for columns with nulls', async () => {
    const client = makeClient({
      tables: [{
        name: 'users',
        columns: [
          { name: 'bio', type: 'TEXT', pk: false },
        ],
        rowCount: 5,
      }],
      sqlResults: {
        'SELECT COUNT(*) AS cnt FROM "users" WHERE "bio" IS NULL': {
          columns: ['cnt'], rows: [[3]],
        },
      },
    });
    const inferrer = new AssertionInferrer(client as never);
    const result = await inferrer.infer(['users'], new Set(['notNull']));

    assert.strictEqual(result.length, 0);
  });

  it('should skip PK columns for not-null', async () => {
    const client = makeClient({
      tables: [{
        name: 'users',
        columns: [
          { name: 'id', type: 'INTEGER', pk: true },
        ],
        rowCount: 5,
      }],
    });
    const inferrer = new AssertionInferrer(client as never);
    const result = await inferrer.infer(['users'], new Set(['notNull']));

    assert.strictEqual(result.length, 0);
  });

  it('should generate uniqueness assertion when distinct equals total', async () => {
    const client = makeClient({
      tables: [{
        name: 'users',
        columns: [
          { name: 'id', type: 'INTEGER', pk: true },
          { name: 'email', type: 'TEXT', pk: false },
        ],
        rowCount: 20,
      }],
      sqlResults: {
        'SELECT COUNT(DISTINCT "email") AS dist, COUNT("email") AS total FROM "users"': {
          columns: ['dist', 'total'], rows: [[20, 20]],
        },
      },
    });
    const inferrer = new AssertionInferrer(client as never);
    const result = await inferrer.infer(['users'], new Set(['unique']));

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].type, 'unique');
    assert.strictEqual(result[0].column, 'email');
    assert.strictEqual(result[0].confidence, 'high');
  });

  it('should skip uniqueness when values are not unique', async () => {
    const client = makeClient({
      tables: [{
        name: 'users',
        columns: [
          { name: 'role', type: 'TEXT', pk: false },
        ],
        rowCount: 20,
      }],
      sqlResults: {
        'SELECT COUNT(DISTINCT "role") AS dist, COUNT("role") AS total FROM "users"': {
          columns: ['dist', 'total'], rows: [[3, 20]],
        },
      },
    });
    const inferrer = new AssertionInferrer(client as never);
    const result = await inferrer.infer(['users'], new Set(['unique']));

    assert.strictEqual(result.length, 0);
  });

  it('should set medium confidence when unique count is low', async () => {
    const client = makeClient({
      tables: [{
        name: 'items',
        columns: [
          { name: 'code', type: 'TEXT', pk: false },
        ],
        rowCount: 5,
      }],
      sqlResults: {
        'SELECT COUNT(DISTINCT "code") AS dist, COUNT("code") AS total FROM "items"': {
          columns: ['dist', 'total'], rows: [[5, 5]],
        },
      },
    });
    const inferrer = new AssertionInferrer(client as never);
    const result = await inferrer.infer(['items'], new Set(['unique']));

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].confidence, 'medium');
  });

  it('should generate value range for numeric columns', async () => {
    const client = makeClient({
      tables: [{
        name: 'orders',
        columns: [
          { name: 'total', type: 'REAL', pk: false },
          { name: 'note', type: 'TEXT', pk: false },
        ],
        rowCount: 10,
      }],
      sqlResults: {
        'SELECT MIN("total") AS mn, MAX("total") AS mx FROM "orders" WHERE "total" IS NOT NULL': {
          columns: ['mn', 'mx'], rows: [[5.5, 99.9]],
        },
      },
    });
    const inferrer = new AssertionInferrer(client as never);
    const result = await inferrer.infer(['orders'], new Set(['valueRange']));

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].type, 'valueRange');
    assert.strictEqual(result[0].column, 'total');
    assert.ok(result[0].sql.includes('5.5'));
    assert.ok(result[0].sql.includes('99.9'));
  });

  it('should skip value range for text columns', async () => {
    const client = makeClient({
      tables: [{
        name: 'users',
        columns: [
          { name: 'name', type: 'TEXT', pk: false },
        ],
        rowCount: 10,
      }],
    });
    const inferrer = new AssertionInferrer(client as never);
    const result = await inferrer.infer(['users'], new Set(['valueRange']));

    assert.strictEqual(result.length, 0);
  });

  it('should skip not-null and uniqueness for empty tables', async () => {
    const client = makeClient({
      tables: [{
        name: 'empty_table',
        columns: [
          { name: 'id', type: 'INTEGER', pk: true },
          { name: 'name', type: 'TEXT', pk: false },
        ],
        rowCount: 0,
      }],
    });
    const inferrer = new AssertionInferrer(client as never);
    const result = await inferrer.infer(
      ['empty_table'], new Set(['notNull', 'unique']),
    );

    assert.strictEqual(result.length, 0);
  });

  it('should skip unknown tables', async () => {
    const client = makeClient({ tables: [] });
    const inferrer = new AssertionInferrer(client as never);
    const result = await inferrer.infer(['nonexistent'], allTypes());

    assert.strictEqual(result.length, 0);
  });

  it('should generate multiple assertion types together', async () => {
    const client = makeClient({
      tables: [{
        name: 'users',
        columns: [
          { name: 'id', type: 'INTEGER', pk: true },
          { name: 'age', type: 'INTEGER', pk: false },
        ],
        rowCount: 50,
      }],
      fks: { users: [] },
      sqlResults: {
        'SELECT COUNT(*) AS cnt FROM "users" WHERE "age" IS NULL': {
          columns: ['cnt'], rows: [[0]],
        },
        'SELECT COUNT(DISTINCT "age") AS dist, COUNT("age") AS total FROM "users"': {
          columns: ['dist', 'total'], rows: [[40, 50]],
        },
        'SELECT MIN("age") AS mn, MAX("age") AS mx FROM "users" WHERE "age" IS NOT NULL': {
          columns: ['mn', 'mx'], rows: [[18, 65]],
        },
      },
    });
    const inferrer = new AssertionInferrer(client as never);
    const result = await inferrer.infer(['users'], allTypes());

    const types = result.map((a) => a.type);
    assert.ok(types.includes('rowCount'));
    assert.ok(types.includes('notNull'));
    assert.ok(types.includes('valueRange'));
    // uniqueness skipped (40 != 50)
    assert.ok(!types.includes('unique'));
  });
});
