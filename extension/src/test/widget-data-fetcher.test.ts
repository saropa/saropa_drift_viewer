import * as assert from 'assert';
import * as sinon from 'sinon';
import { DriftApiClient } from '../api-client';
import { WidgetDataFetcher, getDefaultWidgetConfig } from '../dashboard/widget-data-fetcher';
import type { IWidgetConfig } from '../dashboard/dashboard-types';
import type { IHealthScore } from '../health/health-types';

function makeClient(): DriftApiClient {
  return new DriftApiClient('127.0.0.1', 8642);
}

describe('WidgetDataFetcher', () => {
  let client: DriftApiClient;
  let fetcher: WidgetDataFetcher;

  beforeEach(() => {
    client = makeClient();
    fetcher = new WidgetDataFetcher(client);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('fetchOne', () => {
    it('should fetch table stats widget data', async () => {
      sinon.stub(client, 'schemaMetadata').resolves([
        { name: 'users', columns: [{ name: 'id', type: 'INTEGER', pk: true }], rowCount: 100 },
        { name: 'orders', columns: [{ name: 'id', type: 'INTEGER', pk: true }], rowCount: 50 },
      ]);

      const widget: IWidgetConfig = {
        id: 'w1',
        type: 'tableStats',
        title: 'Users Stats',
        gridX: 0,
        gridY: 0,
        gridW: 1,
        gridH: 1,
        config: { table: 'users' },
      };

      const result = await fetcher.fetchOne(widget);

      assert.strictEqual(result.id, 'w1');
      assert.ok(result.html.includes('100'));
      assert.ok(!result.error);
    });

    it('should fetch row count widget data', async () => {
      sinon.stub(client, 'sql').resolves({
        columns: ['cnt'],
        rows: [[250]],
      });

      const widget: IWidgetConfig = {
        id: 'w2',
        type: 'rowCount',
        title: 'Order Count',
        gridX: 0,
        gridY: 0,
        gridW: 1,
        gridH: 1,
        config: { table: 'orders' },
      };

      const result = await fetcher.fetchOne(widget);

      assert.strictEqual(result.id, 'w2');
      assert.ok(result.html.includes('250'));
      assert.ok(!result.error);
    });

    it('should fetch query result widget data', async () => {
      sinon.stub(client, 'sql').resolves({
        columns: ['name', 'email'],
        rows: [
          ['Alice', 'alice@example.com'],
          ['Bob', 'bob@example.com'],
        ],
      });

      const widget: IWidgetConfig = {
        id: 'w3',
        type: 'queryResult',
        title: 'Recent Users',
        gridX: 0,
        gridY: 0,
        gridW: 2,
        gridH: 2,
        config: { sql: 'SELECT name, email FROM users', limit: 10 },
      };

      const result = await fetcher.fetchOne(widget);

      assert.strictEqual(result.id, 'w3');
      assert.ok(result.html.includes('Alice'));
      assert.ok(result.html.includes('Bob'));
      assert.ok(!result.error);
    });

    it('should handle widget fetch errors gracefully', async () => {
      sinon.stub(client, 'sql').rejects(new Error('Database connection failed'));

      const widget: IWidgetConfig = {
        id: 'w4',
        type: 'queryResult',
        title: 'Failing Query',
        gridX: 0,
        gridY: 0,
        gridW: 2,
        gridH: 2,
        config: { sql: 'SELECT * FROM nonexistent', limit: 10 },
      };

      const result = await fetcher.fetchOne(widget);

      assert.strictEqual(result.id, 'w4');
      assert.ok(result.error);
      assert.ok(result.html.includes('Database connection failed'));
    });

    it('should return error for unknown widget type', async () => {
      const widget: IWidgetConfig = {
        id: 'w5',
        type: 'unknownType' as unknown as IWidgetConfig['type'],
        title: 'Unknown',
        gridX: 0,
        gridY: 0,
        gridW: 1,
        gridH: 1,
        config: {},
      };

      const result = await fetcher.fetchOne(widget);

      assert.strictEqual(result.id, 'w5');
      assert.ok(result.error);
      assert.ok(result.error.includes('Unknown widget type'));
    });

    it('should render custom text widget', async () => {
      const widget: IWidgetConfig = {
        id: 'w6',
        type: 'customText',
        title: 'Notes',
        gridX: 0,
        gridY: 0,
        gridW: 1,
        gridH: 1,
        config: { text: 'Important notes here' },
      };

      const result = await fetcher.fetchOne(widget);

      assert.strictEqual(result.id, 'w6');
      assert.ok(result.html.includes('Important notes here'));
      assert.ok(!result.error);
    });

    it('should fetch health score widget with scorer', async () => {
      const mockScore: IHealthScore = {
        overall: 85,
        grade: 'B+',
        metrics: [
          { name: 'Index', key: 'indexCoverage', score: 90, grade: 'A-', weight: 0.25, summary: 'Good', details: [] },
        ],
        recommendations: [],
      };

      const healthScorer = {
        compute: sinon.stub().resolves(mockScore),
      };

      const fetcherWithScorer = new WidgetDataFetcher(client, healthScorer);

      const widget: IWidgetConfig = {
        id: 'w7',
        type: 'healthScore',
        title: 'Health',
        gridX: 0,
        gridY: 0,
        gridW: 2,
        gridH: 1,
        config: {},
      };

      const result = await fetcherWithScorer.fetchOne(widget);

      assert.strictEqual(result.id, 'w7');
      assert.ok(result.html.includes('B+'));
      assert.ok(result.html.includes('85'));
      assert.ok(!result.error);
    });
  });

  describe('fetchAll', () => {
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

  describe('fetchAllAsArray', () => {
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

  describe('getTableNames', () => {
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
});

describe('getDefaultWidgetConfig', () => {
  it('should return default config for rowCount widget', () => {
    const config = getDefaultWidgetConfig('rowCount');
    assert.deepStrictEqual(config, {});
  });

  it('should return default config for tablePreview widget', () => {
    const config = getDefaultWidgetConfig('tablePreview');
    assert.strictEqual(config.limit, 5);
  });

  it('should return default config for chart widget', () => {
    const config = getDefaultWidgetConfig('chart');
    assert.strictEqual(config.chartType, 'bar');
  });

  it('should return empty config for unknown widget type', () => {
    const config = getDefaultWidgetConfig('unknownWidget');
    assert.deepStrictEqual(config, {});
  });
});
