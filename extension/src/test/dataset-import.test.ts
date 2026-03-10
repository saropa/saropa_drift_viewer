import * as assert from 'assert';
import * as sinon from 'sinon';
import { DependencySorter } from '../data-management/dependency-sorter';
import { DataReset } from '../data-management/data-reset';
import { DatasetImport } from '../data-management/dataset-import';
import type { IDriftDataset } from '../data-management/dataset-types';

function makeClient(
  tables: { name: string; columns: { name: string }[] }[],
) {
  return {
    schemaMetadata: sinon.stub().resolves(
      tables.map((t) => ({
        name: t.name,
        columns: t.columns.map((c) => ({
          name: c.name,
          type: 'TEXT',
          pk: false,
        })),
        rowCount: 0,
      })),
    ),
    tableFkMeta: sinon.stub().resolves([]),
    sql: sinon.stub().callsFake(async (query: string) => {
      // Support COUNT queries used by DataReset
      const countMatch = query.match(/SELECT COUNT\(\*\) AS cnt FROM "([^"]+)"/);
      if (countMatch) {
        return { columns: ['cnt'], rows: [[0]] };
      }
      return { columns: [], rows: [] };
    }),
    importData: sinon.stub().resolves({ imported: 0, errors: [] }),
  };
}

function makeDataset(
  tables: Record<string, Record<string, unknown>[]>,
): IDriftDataset {
  return {
    $schema: 'drift-dataset/v1',
    name: 'test',
    tables,
  };
}

describe('DatasetImport', () => {
  let sorter: DependencySorter;

  beforeEach(() => {
    sorter = new DependencySorter();
  });

  describe('validate', () => {
    it('passes for valid dataset', async () => {
      const client = makeClient([
        { name: 'users', columns: [{ name: 'id' }, { name: 'name' }] },
      ]);
      const reset = new DataReset(client as never, sorter);
      const imp = new DatasetImport(client as never, sorter, reset);

      const dataset = makeDataset({
        users: [{ id: 1, name: 'Alice' }],
      });
      const result = await imp.validate(dataset);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('reports error for missing table', async () => {
      const client = makeClient([
        { name: 'users', columns: [{ name: 'id' }] },
      ]);
      const reset = new DataReset(client as never, sorter);
      const imp = new DatasetImport(client as never, sorter, reset);

      const dataset = makeDataset({
        nonexistent: [{ id: 1 }],
      });
      const result = await imp.validate(dataset);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].includes('nonexistent'));
    });

    it('reports warning for extra columns', async () => {
      const client = makeClient([
        { name: 'users', columns: [{ name: 'id' }] },
      ]);
      const reset = new DataReset(client as never, sorter);
      const imp = new DatasetImport(client as never, sorter, reset);

      const dataset = makeDataset({
        users: [{ id: 1, extra_col: 'foo' }],
      });
      const result = await imp.validate(dataset);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.warnings.length, 1);
      assert.ok(result.warnings[0].includes('extra_col'));
    });
  });

  describe('import', () => {
    it('appends without clearing in append mode', async () => {
      const client = makeClient([
        { name: 'users', columns: [{ name: 'id' }] },
      ]);
      const reset = new DataReset(client as never, sorter);
      const clearSpy = sinon.spy(reset, 'clearGroup');
      const imp = new DatasetImport(client as never, sorter, reset);

      const dataset = makeDataset({
        users: [{ id: 1 }, { id: 2 }],
      });
      const result = await imp.import(dataset, 'append');
      assert.strictEqual(result.totalInserted, 2);
      assert.strictEqual(clearSpy.callCount, 0);
    });

    it('clears then inserts in replace mode', async () => {
      const client = makeClient([
        { name: 'users', columns: [{ name: 'id' }] },
      ]);
      const reset = new DataReset(client as never, sorter);
      const clearSpy = sinon.spy(reset, 'clearGroup');
      const imp = new DatasetImport(client as never, sorter, reset);

      const dataset = makeDataset({
        users: [{ id: 1 }],
      });
      const result = await imp.import(dataset, 'replace');
      assert.strictEqual(result.totalInserted, 1);
      assert.strictEqual(clearSpy.callCount, 1);
    });

    it('respects FK insert order', async () => {
      const client = makeClient([
        { name: 'users', columns: [{ name: 'id' }] },
        { name: 'orders', columns: [{ name: 'id' }, { name: 'user_id' }] },
      ]);
      // orders depends on users
      client.tableFkMeta.callsFake(async (name: string) => {
        if (name === 'orders') {
          return [{ fromColumn: 'user_id', toTable: 'users', toColumn: 'id' }];
        }
        return [];
      });
      const reset = new DataReset(client as never, sorter);
      const imp = new DatasetImport(client as never, sorter, reset);

      const dataset = makeDataset({
        orders: [{ id: 1, user_id: 1 }],
        users: [{ id: 1 }],
      });
      await imp.import(dataset, 'append');

      // users should be imported before orders
      const importCalls = client.importData.getCalls();
      assert.strictEqual(importCalls[0].args[1], 'users');
      assert.strictEqual(importCalls[1].args[1], 'orders');
    });

    it('handles empty dataset as no-op', async () => {
      const client = makeClient([]);
      const reset = new DataReset(client as never, sorter);
      const imp = new DatasetImport(client as never, sorter, reset);

      const dataset = makeDataset({});
      const result = await imp.import(dataset, 'append');
      assert.strictEqual(result.totalInserted, 0);
      assert.strictEqual(result.tables.length, 0);
    });
  });

  describe('toSql', () => {
    it('produces valid INSERT statements', () => {
      const client = makeClient([]);
      const reset = new DataReset(client as never, sorter);
      const imp = new DatasetImport(client as never, sorter, reset);

      const dataset = makeDataset({
        users: [
          { id: 1, name: 'Alice', active: true },
          { id: 2, name: "Bob's", active: null },
        ],
      });
      const sql = imp.toSql(dataset);
      assert.ok(sql.includes('INSERT INTO "users"'));
      assert.ok(sql.includes("'Alice'"));
      assert.ok(sql.includes("'Bob''s'"));
      assert.ok(sql.includes('NULL'));
      assert.ok(sql.includes('-- Dataset: test'));
    });

    it('handles empty dataset', () => {
      const client = makeClient([]);
      const reset = new DataReset(client as never, sorter);
      const imp = new DatasetImport(client as never, sorter, reset);

      const dataset = makeDataset({});
      const sql = imp.toSql(dataset);
      assert.ok(sql.includes('-- Dataset: test'));
      assert.ok(!sql.includes('INSERT'));
    });
  });
});
