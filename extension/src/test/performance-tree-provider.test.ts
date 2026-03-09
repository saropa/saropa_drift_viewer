import * as assert from 'assert';
import * as sinon from 'sinon';
import { DriftApiClient, PerformanceData } from '../api-client';
import {
  CategoryItem,
  QueryItem,
  SummaryItem,
} from '../debug/performance-items';
import { PerformanceTreeProvider } from '../debug/performance-tree-provider';

describe('PerformanceTreeProvider', () => {
  let fetchStub: sinon.SinonStub;
  let client: DriftApiClient;
  let provider: PerformanceTreeProvider;

  const samplePerf: PerformanceData = {
    totalQueries: 47,
    totalDurationMs: 3200,
    avgDurationMs: 68,
    slowQueries: [
      { sql: 'SELECT * FROM posts WHERE content LIKE ?', durationMs: 1250, rowCount: 10000, at: '2026-03-09T10:00:00Z' },
      { sql: 'SELECT * FROM users JOIN orders ON users.id = orders.user_id', durationMs: 890, rowCount: 500, at: '2026-03-09T10:00:01Z' },
    ],
    recentQueries: [
      { sql: 'SELECT * FROM users WHERE id=?', durationMs: 15, rowCount: 1, at: '2026-03-09T10:00:02Z' },
      { sql: 'INSERT INTO posts VALUES (?)', durationMs: 22, rowCount: 1, at: '2026-03-09T10:00:03Z' },
    ],
  };

  beforeEach(() => {
    fetchStub = sinon.stub(globalThis, 'fetch');
    client = new DriftApiClient('127.0.0.1', 8642);
    provider = new PerformanceTreeProvider();
  });

  afterEach(() => {
    provider.stopAutoRefresh();
    fetchStub.restore();
  });

  describe('getChildren() — before refresh', () => {
    it('should return empty-state summary + categories', () => {
      const children = provider.getChildren();
      assert.strictEqual(children.length, 3);
      assert.ok(children[0] instanceof SummaryItem);
      assert.ok(children[1] instanceof CategoryItem);
      assert.ok(children[2] instanceof CategoryItem);

      const summary = children[0] as SummaryItem;
      assert.strictEqual(summary.label, '0 queries, 0ms total');
    });
  });

  describe('refresh()', () => {
    it('should populate data on success', async () => {
      fetchStub.resolves(
        new Response(JSON.stringify(samplePerf), { status: 200 }),
      );

      await provider.refresh(client);

      assert.ok(provider.data);
      assert.strictEqual(provider.data.totalQueries, 47);
    });

    it('should clear data on failure', async () => {
      // First load data
      fetchStub.resolves(
        new Response(JSON.stringify(samplePerf), { status: 200 }),
      );
      await provider.refresh(client);
      assert.ok(provider.data);

      // Then fail
      fetchStub.rejects(new Error('connection refused'));
      await provider.refresh(client);
      assert.strictEqual(provider.data, null);
    });

    it('should fire onDidChangeTreeData', async () => {
      fetchStub.rejects(new Error('connection refused'));

      let fired = false;
      provider.onDidChangeTreeData(() => { fired = true; });
      await provider.refresh(client);
      assert.strictEqual(fired, true);
    });

    it('should skip overlapping refresh calls', async () => {
      let resolveFirst!: (v: Response) => void;
      fetchStub.onFirstCall().returns(
        new Promise<Response>((r) => { resolveFirst = r; }),
      );

      const first = provider.refresh(client);
      const second = provider.refresh(client); // should be skipped

      resolveFirst(
        new Response(JSON.stringify(samplePerf), { status: 200 }),
      );
      await first;
      await second;

      assert.strictEqual(fetchStub.callCount, 1);
    });
  });

  describe('getChildren() — with data', () => {
    beforeEach(async () => {
      fetchStub.resolves(
        new Response(JSON.stringify(samplePerf), { status: 200 }),
      );
      await provider.refresh(client);
    });

    it('should return summary + 2 categories at root', () => {
      const children = provider.getChildren();
      assert.strictEqual(children.length, 3);

      const summary = children[0] as SummaryItem;
      assert.strictEqual(summary.label, '47 queries, 3200ms total');
      assert.strictEqual(summary.description, 'avg: 68ms');

      const slowCat = children[1] as CategoryItem;
      assert.strictEqual(slowCat.category, 'slow');

      const recentCat = children[2] as CategoryItem;
      assert.strictEqual(recentCat.category, 'recent');
    });

    it('should return slow queries for slow category', () => {
      const root = provider.getChildren();
      const slowCat = root[1] as CategoryItem;
      const queries = provider.getChildren(slowCat);

      assert.strictEqual(queries.length, 2);
      assert.ok(queries[0] instanceof QueryItem);
      assert.strictEqual(queries[0].description, '1250ms');
    });

    it('should return recent queries for recent category', () => {
      const root = provider.getChildren();
      const recentCat = root[2] as CategoryItem;
      const queries = provider.getChildren(recentCat);

      assert.strictEqual(queries.length, 2);
      assert.ok(queries[0] instanceof QueryItem);
      assert.strictEqual(queries[0].description, '15ms');
    });

    it('should return empty array for leaf items', () => {
      const root = provider.getChildren();
      const summary = root[0] as SummaryItem;
      assert.strictEqual(provider.getChildren(summary).length, 0);
    });
  });

  describe('query item icons', () => {
    it('should use flame icon for > 500ms queries', () => {
      const item = new QueryItem({
        sql: 'SELECT 1',
        durationMs: 600,
        rowCount: 1,
        at: '',
      });
      assert.strictEqual((item.iconPath as any).id, 'flame');
    });

    it('should use watch icon for 100-500ms queries', () => {
      const item = new QueryItem({
        sql: 'SELECT 1',
        durationMs: 200,
        rowCount: 1,
        at: '',
      });
      assert.strictEqual((item.iconPath as any).id, 'watch');
    });

    it('should use check icon for < 100ms queries', () => {
      const item = new QueryItem({
        sql: 'SELECT 1',
        durationMs: 50,
        rowCount: 1,
        at: '',
      });
      assert.strictEqual((item.iconPath as any).id, 'check');
    });
  });

  describe('query item click command', () => {
    it('should set showQueryDetail command', () => {
      const entry = { sql: 'SELECT 1', durationMs: 10, rowCount: 1, at: '' };
      const item = new QueryItem(entry);
      assert.strictEqual(item.command?.command, 'driftViewer.showQueryDetail');
      assert.deepStrictEqual(item.command?.arguments, [entry]);
    });
  });

  describe('auto-refresh lifecycle', () => {
    let clock: sinon.SinonFakeTimers;
    let perfStub: sinon.SinonStub;

    async function flush(): Promise<void> {
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }
    }

    beforeEach(() => {
      clock = sinon.useFakeTimers();
      perfStub = sinon.stub(client, 'performance').resolves(samplePerf);
    });

    afterEach(() => {
      provider.stopAutoRefresh();
      clock.restore();
      perfStub.restore();
    });

    it('should poll at the given interval', async () => {
      provider.startAutoRefresh(client, 3000);

      clock.tick(3000);
      await flush(); // let async refresh() resolve
      assert.strictEqual(perfStub.callCount, 1);

      clock.tick(3000);
      await flush();
      assert.strictEqual(perfStub.callCount, 2);
    });

    it('should stop polling after stopAutoRefresh', async () => {
      provider.startAutoRefresh(client, 3000);
      clock.tick(3000);
      await flush();
      assert.strictEqual(perfStub.callCount, 1);

      provider.stopAutoRefresh();
      clock.tick(9000);
      await flush();
      assert.strictEqual(perfStub.callCount, 1);
    });

    it('should restart cleanly', async () => {
      provider.startAutoRefresh(client, 3000);
      clock.tick(3000);
      await flush();
      assert.strictEqual(perfStub.callCount, 1);

      // Restart with different interval
      provider.startAutoRefresh(client, 1000);
      clock.tick(1000);
      await flush();
      assert.strictEqual(perfStub.callCount, 2);
    });
  });

  describe('getTreeItem()', () => {
    it('should return the element itself', () => {
      const item = new SummaryItem({
        totalQueries: 0,
        totalDurationMs: 0,
        avgDurationMs: 0,
        slowQueries: [],
        recentQueries: [],
      });
      assert.strictEqual(provider.getTreeItem(item), item);
    });
  });

  describe('SQL truncation', () => {
    it('should truncate long SQL in query item labels', () => {
      const longSql = 'SELECT ' + 'a'.repeat(100) + ' FROM table';
      const item = new QueryItem({
        sql: longSql,
        durationMs: 10,
        rowCount: 1,
        at: '',
      });
      assert.ok((item.label as string).length <= 50);
      assert.ok((item.label as string).endsWith('\u2026'));
    });

    it('should not truncate short SQL', () => {
      const item = new QueryItem({
        sql: 'SELECT 1',
        durationMs: 10,
        rowCount: 1,
        at: '',
      });
      assert.strictEqual(item.label, 'SELECT 1');
    });
  });
});
