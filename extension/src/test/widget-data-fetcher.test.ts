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
