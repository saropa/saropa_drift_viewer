import * as assert from 'assert';
import * as sinon from 'sinon';
import { DriftApiClient } from '../api-client';
import { WidgetDataFetcher, getDefaultWidgetConfig } from '../dashboard/widget-data-fetcher';
import type { IWidgetConfig } from '../dashboard/dashboard-types';

function makeClient(): DriftApiClient {
  return new DriftApiClient('127.0.0.1', 8642);
}

describe('WidgetDataFetcher — fetchAll', () => {
  let client: DriftApiClient;
  let fetcher: WidgetDataFetcher;

  beforeEach(() => {
    client = makeClient();
    fetcher = new WidgetDataFetcher(client);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should fetch data for all widgets in parallel', async () => {
    sinon.stub(client, 'schemaMetadata').resolves([
      { name: 'users', columns: [], rowCount: 100 },
    ]);
    sinon.stub(client, 'sql').resolves({
      columns: ['cnt'],
      rows: [[200]],
    });

    const widgets: IWidgetConfig[] = [
      {
        id: 'w1',
        type: 'tableStats',
        title: 'Stats',
        gridX: 0,
        gridY: 0,
        gridW: 1,
        gridH: 1,
        config: { table: 'users' },
      },
      {
        id: 'w2',
        type: 'rowCount',
        title: 'Count',
        gridX: 1,
        gridY: 0,
        gridW: 1,
        gridH: 1,
        config: { table: 'users' },
      },
    ];

    const results = await fetcher.fetchAll(widgets);

    assert.strictEqual(results.size, 2);
    assert.ok(results.has('w1'));
    assert.ok(results.has('w2'));
  });

  it('should not block on widget errors', async () => {
    sinon.stub(client, 'schemaMetadata').resolves([
      { name: 'users', columns: [], rowCount: 100 },
    ]);
    sinon.stub(client, 'sql').rejects(new Error('SQL error'));

    const widgets: IWidgetConfig[] = [
      {
        id: 'w1',
        type: 'tableStats',
        title: 'Stats',
        gridX: 0,
        gridY: 0,
        gridW: 1,
        gridH: 1,
        config: { table: 'users' },
      },
      {
        id: 'w2',
        type: 'rowCount',
        title: 'Failing',
        gridX: 1,
        gridY: 0,
        gridW: 1,
        gridH: 1,
        config: { table: 'users' },
      },
    ];

    const results = await fetcher.fetchAll(widgets);

    assert.strictEqual(results.size, 2);
    const w1 = results.get('w1')!;
    const w2 = results.get('w2')!;
    assert.ok(!w1.error);
    assert.ok(w2.error);
  });
});

describe('WidgetDataFetcher — fetchAllAsArray', () => {
  let client: DriftApiClient;
  let fetcher: WidgetDataFetcher;

  beforeEach(() => {
    client = makeClient();
    fetcher = new WidgetDataFetcher(client);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should return results as array', async () => {
    sinon.stub(client, 'schemaMetadata').resolves([
      { name: 'users', columns: [], rowCount: 100 },
    ]);

    const widgets: IWidgetConfig[] = [
      {
        id: 'w1',
        type: 'tableStats',
        title: 'Stats',
        gridX: 0,
        gridY: 0,
        gridW: 1,
        gridH: 1,
        config: { table: 'users' },
      },
    ];

    const results = await fetcher.fetchAllAsArray(widgets);

    assert.ok(Array.isArray(results));
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].id, 'w1');
  });
});

describe('WidgetDataFetcher — getTableNames', () => {
  let client: DriftApiClient;
  let fetcher: WidgetDataFetcher;

  beforeEach(() => {
    client = makeClient();
    fetcher = new WidgetDataFetcher(client);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should return table names from schema', async () => {
    sinon.stub(client, 'schemaMetadata').resolves([
      { name: 'users', columns: [], rowCount: 0 },
      { name: 'orders', columns: [], rowCount: 0 },
      { name: 'products', columns: [], rowCount: 0 },
    ]);

    const tables = await fetcher.getTableNames();

    assert.deepStrictEqual(tables, ['users', 'orders', 'products']);
  });

  it('should return empty array on error', async () => {
    sinon.stub(client, 'schemaMetadata').rejects(new Error('Connection failed'));

    const tables = await fetcher.getTableNames();

    assert.deepStrictEqual(tables, []);
  });
});
