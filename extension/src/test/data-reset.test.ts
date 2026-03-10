import * as assert from 'assert';
import * as sinon from 'sinon';
import { DependencySorter } from '../data-management/dependency-sorter';
import { DataReset } from '../data-management/data-reset';

function makeClient(
  tables: { name: string; rowCount: number }[],
  fks: Record<string, { toTable: string }[]> = {},
) {
  const sqlResults: Record<string, { columns: string[]; rows: unknown[][] }> = {};
  for (const t of tables) {
    sqlResults[`SELECT COUNT(*) AS cnt FROM "${t.name}"`] = {
      columns: ['cnt'],
      rows: [[t.rowCount]],
    };
  }

  return {
    schemaMetadata: sinon.stub().resolves(
      tables.map((t) => ({
        name: t.name,
        columns: [],
        rowCount: t.rowCount,
      })),
    ),
    tableFkMeta: sinon.stub().callsFake(async (name: string) =>
      (fks[name] ?? []).map((fk) => ({
        fromColumn: 'id',
        toTable: fk.toTable,
        toColumn: 'id',
      })),
    ),
    sql: sinon.stub().callsFake(async (query: string) => {
      if (sqlResults[query]) return sqlResults[query];
      // DELETE statements return empty result
      return { columns: [], rows: [] };
    }),
  };
}

describe('DataReset', () => {
  let sorter: DependencySorter;

  beforeEach(() => {
    sorter = new DependencySorter();
  });

  it('clearAll deletes all non-sqlite tables', async () => {
    const client = makeClient([
      { name: 'users', rowCount: 10 },
      { name: 'orders', rowCount: 20 },
      { name: 'sqlite_sequence', rowCount: 2 },
    ]);
    const reset = new DataReset(client as never, sorter);

    const result = await reset.clearAll();
    assert.strictEqual(result.totalDeleted, 30);
    assert.strictEqual(result.tables.length, 2);

    // Verify DELETE was called for users and orders but not sqlite_sequence
    const deleteCalls = client.sql
      .getCalls()
      .filter((c: sinon.SinonSpyCall) => (c.args[0] as string).startsWith('DELETE'));
    assert.strictEqual(deleteCalls.length, 2);
    const deletedTables = deleteCalls.map(
      (c: sinon.SinonSpyCall) => (c.args[0] as string).match(/"([^"]+)"/)?.[1],
    );
    assert.ok(deletedTables.includes('users'));
    assert.ok(deletedTables.includes('orders'));
  });

  it('clearTable with dependents clears dependents first', async () => {
    const client = makeClient(
      [
        { name: 'users', rowCount: 5 },
        { name: 'orders', rowCount: 10 },
      ],
      { orders: [{ toTable: 'users' }] },
    );
    const reset = new DataReset(client as never, sorter);

    const result = await reset.clearTable('users');
    assert.strictEqual(result.totalDeleted, 15);
    assert.strictEqual(result.tables.length, 2);

    // orders should be deleted before users
    const deleteOrder = client.sql
      .getCalls()
      .filter((c: sinon.SinonSpyCall) => (c.args[0] as string).startsWith('DELETE'))
      .map(
        (c: sinon.SinonSpyCall) => (c.args[0] as string).match(/"([^"]+)"/)?.[1],
      );
    assert.strictEqual(deleteOrder[0], 'orders');
    assert.strictEqual(deleteOrder[1], 'users');
  });

  it('clearTable without dependents clears only that table', async () => {
    const client = makeClient([
      { name: 'users', rowCount: 5 },
      { name: 'orders', rowCount: 10 },
    ]);
    const reset = new DataReset(client as never, sorter);

    const result = await reset.clearTable('users');
    assert.strictEqual(result.totalDeleted, 5);
    assert.strictEqual(result.tables.length, 1);
    assert.strictEqual(result.tables[0].name, 'users');
  });

  it('clearGroup deletes specified tables in FK order', async () => {
    const client = makeClient(
      [
        { name: 'users', rowCount: 5 },
        { name: 'orders', rowCount: 10 },
        { name: 'products', rowCount: 3 },
      ],
      { orders: [{ toTable: 'users' }] },
    );
    const reset = new DataReset(client as never, sorter);

    const result = await reset.clearGroup(['users', 'orders']);
    assert.strictEqual(result.totalDeleted, 15);
    assert.strictEqual(result.tables.length, 2);
  });

  it('previewClear returns row counts without deleting', async () => {
    const client = makeClient([
      { name: 'users', rowCount: 100 },
      { name: 'orders', rowCount: 200 },
    ]);
    const reset = new DataReset(client as never, sorter);

    const preview = await reset.previewClear(['users', 'orders']);
    assert.strictEqual(preview.length, 2);
    const total = preview.reduce((s, p) => s + p.rowCount, 0);
    assert.strictEqual(total, 300);

    // No DELETE calls
    const deleteCalls = client.sql
      .getCalls()
      .filter((c: sinon.SinonSpyCall) => (c.args[0] as string).startsWith('DELETE'));
    assert.strictEqual(deleteCalls.length, 0);
  });

  it('returns accurate deleted row counts', async () => {
    const client = makeClient([
      { name: 'users', rowCount: 42 },
    ]);
    const reset = new DataReset(client as never, sorter);

    const result = await reset.clearTable('users');
    assert.strictEqual(result.tables[0].deletedRows, 42);
    assert.strictEqual(result.totalDeleted, 42);
  });
});
