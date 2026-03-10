import * as assert from 'assert';
import * as sinon from 'sinon';
import { DatasetExport } from '../data-management/dataset-export';

function makeClient(
  tableData: Record<string, { columns: string[]; rows: unknown[][] }>,
) {
  return {
    sql: sinon.stub().callsFake(async (query: string) => {
      const match = query.match(/FROM "([^"]+)"/);
      const table = match?.[1] ?? '';
      return tableData[table] ?? { columns: [], rows: [] };
    }),
  };
}

describe('DatasetExport', () => {
  it('exports all rows from selected tables', async () => {
    const client = makeClient({
      users: {
        columns: ['id', 'name'],
        rows: [
          [1, 'Alice'],
          [2, 'Bob'],
        ],
      },
      orders: {
        columns: ['id', 'user_id', 'total'],
        rows: [[1, 1, 49.99]],
      },
    });
    const exporter = new DatasetExport(client as never);

    const dataset = await exporter.export(
      ['users', 'orders'],
      'my-export',
    );

    assert.strictEqual(dataset.name, 'my-export');
    assert.strictEqual(dataset.$schema, 'drift-dataset/v1');
    assert.strictEqual(dataset.tables['users'].length, 2);
    assert.strictEqual(dataset.tables['orders'].length, 1);

    // Verify row objects have correct keys
    const firstUser = dataset.tables['users'][0];
    assert.strictEqual(firstUser['id'], 1);
    assert.strictEqual(firstUser['name'], 'Alice');

    const order = dataset.tables['orders'][0];
    assert.strictEqual(order['total'], 49.99);
  });

  it('has correct $schema and name fields', async () => {
    const client = makeClient({
      t: { columns: ['id'], rows: [[1]] },
    });
    const exporter = new DatasetExport(client as never);

    const dataset = await exporter.export(['t'], 'test-name');

    assert.strictEqual(dataset.$schema, 'drift-dataset/v1');
    assert.strictEqual(dataset.name, 'test-name');
  });

  it('produces empty array for empty table', async () => {
    const client = makeClient({
      empty: { columns: ['id'], rows: [] },
    });
    const exporter = new DatasetExport(client as never);

    const dataset = await exporter.export(['empty'], 'empty-test');
    assert.deepStrictEqual(dataset.tables['empty'], []);
  });
});
