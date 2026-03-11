import * as assert from 'assert';
import * as sinon from 'sinon';
import { DriftApiClient } from '../api-client';
import { HealthScorer, toGrade } from '../health/health-scorer';
import { HealthPanel } from '../health/health-panel';
import { resetMocks, createdPanels, clipboardMock } from './vscode-mock';

function makeClient(): DriftApiClient {
  return new DriftApiClient('127.0.0.1', 8642);
}

/** Stub all API methods to return a "perfect" database. */
function stubPerfectDb(client: DriftApiClient): void {
  sinon.stub(client, 'schemaMetadata').resolves([
    {
      name: 'users',
      columns: [
        { name: 'id', type: 'INTEGER', pk: true },
        { name: 'name', type: 'TEXT', pk: false },
      ],
      rowCount: 10,
    },
    {
      name: 'orders',
      columns: [
        { name: 'id', type: 'INTEGER', pk: true },
        { name: 'user_id', type: 'INTEGER', pk: false },
      ],
      rowCount: 20,
    },
  ]);
  sinon.stub(client, 'tableFkMeta').resolves([]);
  sinon.stub(client, 'indexSuggestions').resolves([]);
  sinon.stub(client, 'anomalies').resolves([]);
  sinon.stub(client, 'sql').resolves({ columns: ['total'], rows: [[10, 0, 0]] });
  sinon.stub(client, 'performance').resolves({
    totalQueries: 50,
    totalDurationMs: 200,
    avgDurationMs: 4,
    slowQueries: [],
    recentQueries: [],
  });
  sinon.stub(client, 'sizeAnalytics').resolves({
    pageSize: 4096,
    pageCount: 10,
    totalSizeBytes: 40960,
    freeSpaceBytes: 0,
    usedSizeBytes: 40960,
    journalMode: 'wal',
    tableCount: 2,
    tables: [
      { table: 'users', rowCount: 10, columnCount: 2, indexCount: 0, indexes: [] },
      { table: 'orders', rowCount: 20, columnCount: 2, indexCount: 0, indexes: [] },
    ],
  });
}

describe('toGrade', () => {
  it('should return A+ for 97+', () => {
    assert.strictEqual(toGrade(97), 'A+');
    assert.strictEqual(toGrade(100), 'A+');
  });

  it('should return A for 93–96', () => {
    assert.strictEqual(toGrade(93), 'A');
    assert.strictEqual(toGrade(96), 'A');
  });

  it('should return A- for 90–92', () => {
    assert.strictEqual(toGrade(90), 'A-');
    assert.strictEqual(toGrade(92), 'A-');
  });

  it('should return B+ for 87–89', () => {
    assert.strictEqual(toGrade(87), 'B+');
  });

  it('should return B for 83–86', () => {
    assert.strictEqual(toGrade(83), 'B');
  });

  it('should return B- for 80–82', () => {
    assert.strictEqual(toGrade(80), 'B-');
  });

  it('should return C+ for 77–79', () => {
    assert.strictEqual(toGrade(77), 'C+');
  });

  it('should return C for 73–76', () => {
    assert.strictEqual(toGrade(73), 'C');
  });

  it('should return C- for 70–72', () => {
    assert.strictEqual(toGrade(70), 'C-');
  });

  it('should return D+ for 67–69', () => {
    assert.strictEqual(toGrade(67), 'D+');
  });

  it('should return D for 63–66', () => {
    assert.strictEqual(toGrade(63), 'D');
  });

  it('should return D- for 60–62', () => {
    assert.strictEqual(toGrade(60), 'D-');
  });

  it('should return F for below 60', () => {
    assert.strictEqual(toGrade(59), 'F');
    assert.strictEqual(toGrade(0), 'F');
  });
});

describe('HealthScorer.WEIGHTS', () => {
  it('should sum to 1.0', () => {
    const sum = Object.values(HealthScorer.WEIGHTS).reduce((a, b) => a + b, 0);
    assert.strictEqual(sum, 1.0);
  });
});

describe('HealthScorer.compute', () => {
  let client: DriftApiClient;

  beforeEach(() => {
    client = makeClient();
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should give perfect database a high score', async () => {
    stubPerfectDb(client);
    const scorer = new HealthScorer();
    const result = await scorer.compute(client);

    assert.strictEqual(result.metrics.length, 6);
    assert.ok(result.overall >= 90, `Expected >= 90, got ${result.overall}`);
    assert.ok(result.grade.startsWith('A'), `Expected A grade, got ${result.grade}`);
  });

  it('should return 6 metrics with expected keys', async () => {
    stubPerfectDb(client);
    const scorer = new HealthScorer();
    const result = await scorer.compute(client);

    const keys = result.metrics.map((m) => m.key).sort();
    assert.deepStrictEqual(keys, [
      'fkIntegrity',
      'indexCoverage',
      'nullDensity',
      'queryPerformance',
      'schemaQuality',
      'tableBalance',
    ]);
  });

  it('should drop indexCoverage score when suggestions exist', async () => {
    stubPerfectDb(client);
    // Override: 1 FK column exists, 1 suggestion (missing index)
    (client.tableFkMeta as sinon.SinonStub).resolves([
      { fromColumn: 'user_id', toTable: 'users', toColumn: 'id' },
    ]);
    (client.indexSuggestions as sinon.SinonStub).resolves([
      { table: 'orders', column: 'user_id', reason: 'FK without index', sql: 'CREATE INDEX ...', priority: 'high' as const },
    ]);

    const scorer = new HealthScorer();
    const result = await scorer.compute(client);

    const indexMetric = result.metrics.find((m) => m.key === 'indexCoverage')!;
    // 2 tables each returning 1 FK = 2 total, 1 suggestion = 1/2 indexed = 50%
    assert.ok(indexMetric.score < 100, `Expected < 100, got ${indexMetric.score}`);
    assert.ok(indexMetric.details.length > 0);
  });

  it('should drop fkIntegrity score when error anomalies exist', async () => {
    stubPerfectDb(client);
    (client.anomalies as sinon.SinonStub).resolves([
      { message: 'orphan in orders.user_id', severity: 'error' },
      { message: 'orphan in orders.product_id', severity: 'error' },
      { message: 'nullable column warning', severity: 'warning' },
    ]);

    const scorer = new HealthScorer();
    const result = await scorer.compute(client);

    const fkMetric = result.metrics.find((m) => m.key === 'fkIntegrity')!;
    // 2 errors * 10 = 20 penalty → score 80
    assert.strictEqual(fkMetric.score, 80);
    assert.strictEqual(fkMetric.details.length, 2);
  });

  it('should drop nullDensity score for high null percentage', async () => {
    stubPerfectDb(client);
    // Override sql: 10 rows, 5 nulls in col1, 5 nulls in col2 = 50% null
    (client.sql as sinon.SinonStub).resolves({
      columns: ['total', 'nulls_col1', 'nulls_col2'],
      rows: [[10, 5, 5]],
    });

    const scorer = new HealthScorer();
    const result = await scorer.compute(client);

    const nullMetric = result.metrics.find((m) => m.key === 'nullDensity')!;
    // 50% null → score = max(0, 100 - 50 * 5) = max(0, 100 - 250) = 0
    assert.ok(nullMetric.score < 50, `Expected < 50, got ${nullMetric.score}`);
  });

  it('should drop queryPerformance score when slow queries exist', async () => {
    stubPerfectDb(client);
    (client.performance as sinon.SinonStub).resolves({
      totalQueries: 10,
      totalDurationMs: 5000,
      avgDurationMs: 500,
      slowQueries: [
        { sql: 'SELECT * FROM big_table', durationMs: 1500, rowCount: 10000, at: '2024-01-01' },
        { sql: 'SELECT * FROM big_table2', durationMs: 2000, rowCount: 5000, at: '2024-01-01' },
        { sql: 'SELECT * FROM big_table3', durationMs: 1000, rowCount: 3000, at: '2024-01-01' },
      ],
      recentQueries: [],
    });

    const scorer = new HealthScorer();
    const result = await scorer.compute(client);

    const perfMetric = result.metrics.find((m) => m.key === 'queryPerformance')!;
    // 3 slow out of 10 total = 70% good → score 70
    assert.strictEqual(perfMetric.score, 70);
    assert.ok(perfMetric.details.length <= 5);
  });

  it('should drop tableBalance score when one table dominates', async () => {
    stubPerfectDb(client);
    (client.sizeAnalytics as sinon.SinonStub).resolves({
      pageSize: 4096,
      pageCount: 100,
      totalSizeBytes: 409600,
      freeSpaceBytes: 0,
      usedSizeBytes: 409600,
      journalMode: 'wal',
      tableCount: 2,
      tables: [
        { table: 'audit_log', rowCount: 9000, columnCount: 5, indexCount: 1, indexes: ['idx_1'] },
        { table: 'users', rowCount: 1000, columnCount: 3, indexCount: 0, indexes: [] },
      ],
    });

    const scorer = new HealthScorer();
    const result = await scorer.compute(client);

    const balanceMetric = result.metrics.find((m) => m.key === 'tableBalance')!;
    // audit_log has 90% of rows, maxPct = 0.9 → score = (1 - (0.9 - 0.3) / 0.7) * 100 ≈ 14
    assert.ok(balanceMetric.score < 50, `Expected < 50, got ${balanceMetric.score}`);
    assert.ok(balanceMetric.details.length > 0);
  });

  it('should drop schemaQuality score when tables lack primary keys', async () => {
    stubPerfectDb(client);
    (client.schemaMetadata as sinon.SinonStub).resolves([
      {
        name: 'users',
        columns: [
          { name: 'id', type: 'INTEGER', pk: true },
          { name: 'name', type: 'TEXT', pk: false },
        ],
        rowCount: 10,
      },
      {
        name: 'logs',
        columns: [
          { name: 'message', type: 'TEXT', pk: false },
          { name: 'level', type: 'TEXT', pk: false },
        ],
        rowCount: 100,
      },
    ]);

    const scorer = new HealthScorer();
    const result = await scorer.compute(client);

    const schemaMetric = result.metrics.find((m) => m.key === 'schemaQuality')!;
    // 1 out of 2 tables missing PK → score 50
    assert.strictEqual(schemaMetric.score, 50);
    assert.ok(schemaMetric.details.some((d) => d.includes('logs')));
  });

  it('should sort recommendations by severity (errors first)', async () => {
    stubPerfectDb(client);
    // Create a mix of severities by having index issues and anomaly errors
    (client.indexSuggestions as sinon.SinonStub).resolves([
      { table: 'orders', column: 'user_id', reason: 'FK', sql: 'CREATE INDEX ...', priority: 'high' as const },
    ]);
    (client.tableFkMeta as sinon.SinonStub).resolves([
      { fromColumn: 'user_id', toTable: 'users', toColumn: 'id' },
    ]);
    // Make fkIntegrity have errors (low score → error severity recommendations)
    (client.anomalies as sinon.SinonStub).resolves([
      { message: 'orphan 1', severity: 'error' },
      { message: 'orphan 2', severity: 'error' },
      { message: 'orphan 3', severity: 'error' },
      { message: 'orphan 4', severity: 'error' },
      { message: 'orphan 5', severity: 'error' },
      { message: 'orphan 6', severity: 'error' },
    ]);

    const scorer = new HealthScorer();
    const result = await scorer.compute(client);

    if (result.recommendations.length > 1) {
      for (let i = 1; i < result.recommendations.length; i++) {
        const order = { error: 0, warning: 1, info: 2 };
        const prev = order[result.recommendations[i - 1].severity];
        const curr = order[result.recommendations[i].severity];
        assert.ok(prev <= curr, `Recommendation ${i} out of order: ${result.recommendations[i - 1].severity} > ${result.recommendations[i].severity}`);
      }
    }
  });

  it('should handle empty database gracefully', async () => {
    sinon.stub(client, 'schemaMetadata').resolves([]);
    sinon.stub(client, 'tableFkMeta').resolves([]);
    sinon.stub(client, 'indexSuggestions').resolves([]);
    sinon.stub(client, 'anomalies').resolves([]);
    sinon.stub(client, 'sql').resolves({ columns: [], rows: [] });
    sinon.stub(client, 'performance').resolves({
      totalQueries: 0,
      totalDurationMs: 0,
      avgDurationMs: 0,
      slowQueries: [],
      recentQueries: [],
    });
    sinon.stub(client, 'sizeAnalytics').resolves({
      pageSize: 4096,
      pageCount: 1,
      totalSizeBytes: 4096,
      freeSpaceBytes: 4096,
      usedSizeBytes: 0,
      journalMode: 'wal',
      tableCount: 0,
      tables: [],
    });

    const scorer = new HealthScorer();
    const result = await scorer.compute(client);

    assert.strictEqual(result.overall, 100);
    assert.strictEqual(result.grade, 'A+');
    assert.strictEqual(result.recommendations.length, 0);
  });

  it('should skip sqlite_ internal tables', async () => {
    sinon.stub(client, 'schemaMetadata').resolves([
      {
        name: 'sqlite_sequence',
        columns: [
          { name: 'name', type: 'TEXT', pk: false },
          { name: 'seq', type: 'INTEGER', pk: false },
        ],
        rowCount: 5,
      },
      {
        name: 'users',
        columns: [
          { name: 'id', type: 'INTEGER', pk: true },
        ],
        rowCount: 10,
      },
    ]);
    sinon.stub(client, 'tableFkMeta').resolves([]);
    sinon.stub(client, 'indexSuggestions').resolves([]);
    sinon.stub(client, 'anomalies').resolves([]);
    sinon.stub(client, 'sql').resolves({ columns: ['total', 'nulls'], rows: [[10, 0]] });
    sinon.stub(client, 'performance').resolves({
      totalQueries: 0,
      totalDurationMs: 0,
      avgDurationMs: 0,
      slowQueries: [],
      recentQueries: [],
    });
    sinon.stub(client, 'sizeAnalytics').resolves({
      pageSize: 4096,
      pageCount: 1,
      totalSizeBytes: 4096,
      freeSpaceBytes: 0,
      usedSizeBytes: 4096,
      journalMode: 'wal',
      tableCount: 1,
      tables: [
        { table: 'users', rowCount: 10, columnCount: 1, indexCount: 0, indexes: [] },
      ],
    });

    const scorer = new HealthScorer();
    const result = await scorer.compute(client);

    // sqlite_sequence should not cause schema quality to drop (no PK but it's internal)
    const schemaMetric = result.metrics.find((m) => m.key === 'schemaQuality')!;
    assert.strictEqual(schemaMetric.score, 100);
  });
});

describe('HealthPanel', () => {
  beforeEach(() => {
    resetMocks();
    (HealthPanel as any)._currentPanel = undefined;
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should create a webview panel with health HTML', () => {
    const score = {
      overall: 87,
      grade: 'B+',
      metrics: [
        {
          name: 'Index Coverage',
          key: 'indexCoverage' as const,
          score: 100,
          grade: 'A+',
          weight: 0.25,
          summary: '0/0 FK columns indexed',
          details: [],
        },
      ],
      recommendations: [],
    };
    const client = makeClient();
    HealthPanel.createOrShow(score, client);

    assert.strictEqual(createdPanels.length, 1);
    const html = createdPanels[0].webview.html;
    assert.ok(html.includes('Database Health Score'));
    assert.ok(html.includes('B+'));
    assert.ok(html.includes('87/100'));
  });

  it('should reuse existing panel on second call', () => {
    const score = { overall: 90, grade: 'A-', metrics: [], recommendations: [] };
    const client = makeClient();
    HealthPanel.createOrShow(score, client);
    HealthPanel.createOrShow(score, client);

    assert.strictEqual(createdPanels.length, 1);
  });

  it('should copy report on copyReport message', () => {
    const score = { overall: 85, grade: 'B', metrics: [], recommendations: [] };
    const client = makeClient();
    HealthPanel.createOrShow(score, client);

    clipboardMock.reset();
    createdPanels[0].webview.simulateMessage({ command: 'copyReport' });
    assert.ok(clipboardMock.text.includes('"overall": 85'));
  });
});
