import * as assert from 'assert';
import * as sinon from 'sinon';
import {
  SamplingEngine, sqlLiteral,
} from '../sampling/sampling-engine';
import { zipRow } from '../shared-utils';
import type { DriftApiClient } from '../api-client';
import type { TableMetadata } from '../api-types';

function makeMeta(overrides: Partial<TableMetadata> = {}): TableMetadata {
  return {
    name: 'orders',
    columns: [
      { name: 'id', type: 'INTEGER', pk: true },
      { name: 'total', type: 'REAL', pk: false },
      { name: 'status', type: 'TEXT', pk: false },
    ],
    rowCount: 100,
    ...overrides,
  };
}

function fakeClient(
  tables: TableMetadata[],
  sqlResults: Map<string, { columns: string[]; rows: unknown[][] }>,
): DriftApiClient {
  return {
    schemaMetadata: sinon.stub().resolves(tables),
    sql: sinon.stub().callsFake((query: string) => {
      for (const [key, val] of sqlResults) {
        if (query.includes(key)) return Promise.resolve(val);
      }
      return Promise.resolve({ columns: [], rows: [] });
    }),
  } as unknown as DriftApiClient;
}

describe('SamplingEngine — random', () => {
  it('should generate ORDER BY RANDOM() SQL', async () => {
    const sqlStub = sinon.stub();
    sqlStub.onFirstCall().resolves({ columns: ['cnt'], rows: [[100]] });
    sqlStub.onSecondCall().resolves({
      columns: ['id', 'total', 'status'],
      rows: [[1, 9.99, 'pending'], [2, 19.99, 'shipped']],
    });

    const client = {
      schemaMetadata: sinon.stub().resolves([makeMeta()]),
      sql: sqlStub,
    } as unknown as DriftApiClient;

    const engine = new SamplingEngine(client);
    const result = await engine.sample({
      table: 'orders', mode: 'random', sampleSize: 50,
    });

    assert.strictEqual(result.mode, 'random');
    assert.strictEqual(result.totalRows, 100);
    assert.strictEqual(result.sampledRows, 2);
    assert.strictEqual(result.rows.length, 2);
    assert.ok(result.sql.includes('ORDER BY RANDOM()'));
    assert.ok(result.sql.includes('LIMIT 50'));
  });

  it('should return totalRows from COUNT query', async () => {
    const sqlStub = sinon.stub();
    sqlStub.onFirstCall().resolves({ columns: ['cnt'], rows: [[42]] });
    sqlStub.onSecondCall().resolves({
      columns: ['id'], rows: [],
    });

    const client = {
      schemaMetadata: sinon.stub().resolves([makeMeta()]),
      sql: sqlStub,
    } as unknown as DriftApiClient;

    const engine = new SamplingEngine(client);
    const result = await engine.sample({
      table: 'orders', mode: 'random', sampleSize: 10,
    });

    assert.strictEqual(result.totalRows, 42);
    assert.strictEqual(result.sampledRows, 0);
  });
});

describe('SamplingEngine — stratified', () => {
  it('should issue one query per stratum', async () => {
    const sqlStub = sinon.stub();
    // Group query returns 2 strata
    sqlStub.onFirstCall().resolves({
      columns: ['status', 'cnt'],
      rows: [['shipped', 70], ['pending', 30]],
    });
    // Shipped stratum sample
    sqlStub.onSecondCall().resolves({
      columns: ['id', 'total', 'status'],
      rows: [[1, 50, 'shipped'], [2, 60, 'shipped'], [3, 70, 'shipped']],
    });
    // Pending stratum sample
    sqlStub.onThirdCall().resolves({
      columns: ['id', 'total', 'status'],
      rows: [[4, 10, 'pending'], [5, 20, 'pending']],
    });

    const client = {
      schemaMetadata: sinon.stub().resolves([makeMeta()]),
      sql: sqlStub,
    } as unknown as DriftApiClient;

    const engine = new SamplingEngine(client);
    const result = await engine.sample({
      table: 'orders', mode: 'stratified', sampleSize: 5,
      stratifyColumn: 'status',
    });

    assert.strictEqual(result.mode, 'stratified');
    assert.strictEqual(result.totalRows, 100);
    assert.strictEqual(result.sampledRows, 5);
    // 3 calls: 1 group + 2 strata
    assert.strictEqual(sqlStub.callCount, 3);
  });

  it('should handle single group', async () => {
    const sqlStub = sinon.stub();
    sqlStub.onFirstCall().resolves({
      columns: ['status', 'cnt'],
      rows: [['active', 50]],
    });
    sqlStub.onSecondCall().resolves({
      columns: ['id', 'status'],
      rows: [[1, 'active'], [2, 'active']],
    });

    const client = {
      schemaMetadata: sinon.stub().resolves([makeMeta()]),
      sql: sqlStub,
    } as unknown as DriftApiClient;

    const engine = new SamplingEngine(client);
    const result = await engine.sample({
      table: 'orders', mode: 'stratified', sampleSize: 10,
      stratifyColumn: 'status',
    });

    assert.strictEqual(result.sampledRows, 2);
    assert.strictEqual(sqlStub.callCount, 2);
  });

  it('should use IS NULL for null group values', async () => {
    const sqlStub = sinon.stub();
    sqlStub.onFirstCall().resolves({
      columns: ['status', 'cnt'],
      rows: [[null, 20], ['active', 80]],
    });
    sqlStub.onSecondCall().resolves({
      columns: ['id', 'status'],
      rows: [[1, null]],
    });
    sqlStub.onThirdCall().resolves({
      columns: ['id', 'status'],
      rows: [[2, 'active'], [3, 'active'], [4, 'active']],
    });

    const client = {
      schemaMetadata: sinon.stub().resolves([makeMeta()]),
      sql: sqlStub,
    } as unknown as DriftApiClient;

    const engine = new SamplingEngine(client);
    await engine.sample({
      table: 'orders', mode: 'stratified', sampleSize: 5,
      stratifyColumn: 'status',
    });

    // NULL stratum query should use IS NULL, not = NULL
    const nullSql = sqlStub.secondCall.args[0] as string;
    assert.ok(nullSql.includes('IS NULL'), 'Should use IS NULL for null group');
    assert.ok(!nullSql.includes('= NULL'), 'Should not use = NULL');
  });
});

describe('SamplingEngine — percentile', () => {
  it('should compute correct OFFSET and LIMIT for 90-100', async () => {
    const sqlStub = sinon.stub();
    sqlStub.onFirstCall().resolves({ columns: ['cnt'], rows: [[1000]] });
    sqlStub.onSecondCall().resolves({
      columns: ['id', 'total'],
      rows: [[99, 500], [100, 600]],
    });

    const client = {
      schemaMetadata: sinon.stub().resolves([makeMeta()]),
      sql: sqlStub,
    } as unknown as DriftApiClient;

    const engine = new SamplingEngine(client);
    const result = await engine.sample({
      table: 'orders', mode: 'percentile', sampleSize: 50,
      percentileColumn: 'total', percentileMin: 90, percentileMax: 100,
    });

    assert.strictEqual(result.mode, 'percentile');
    // SQL should have OFFSET 900 (90% of 1000), LIMIT 50 (min of 100, 50)
    assert.ok(result.sql.includes('OFFSET 900'));
    assert.ok(result.sql.includes('LIMIT 50'));
  });

  it('should filter NULL values', async () => {
    const sqlStub = sinon.stub();
    sqlStub.onFirstCall().resolves({ columns: ['cnt'], rows: [[80]] });
    sqlStub.onSecondCall().resolves({
      columns: ['id', 'total'], rows: [],
    });

    const client = {
      schemaMetadata: sinon.stub().resolves([makeMeta()]),
      sql: sqlStub,
    } as unknown as DriftApiClient;

    const engine = new SamplingEngine(client);
    const result = await engine.sample({
      table: 'orders', mode: 'percentile', sampleSize: 10,
      percentileColumn: 'total', percentileMin: 0, percentileMax: 100,
    });

    // Count query should exclude NULLs
    const countSql = sqlStub.firstCall.args[0] as string;
    assert.ok(countSql.includes('IS NOT NULL'));
    assert.strictEqual(result.totalRows, 80);
  });
});

describe('SamplingEngine — cohort', () => {
  it('should return stats per distinct value', async () => {
    const sqlStub = sinon.stub();
    sqlStub.resolves({
      columns: ['cohort_value', 'count', 'avg_val', 'min_val', 'max_val'],
      rows: [
        ['shipped', 70, 89.1, 5, 999],
        ['pending', 30, 45.2, 1.99, 499.99],
      ],
    });

    const client = {
      schemaMetadata: sinon.stub().resolves([makeMeta()]),
      sql: sqlStub,
    } as unknown as DriftApiClient;

    const engine = new SamplingEngine(client);
    const result = await engine.sample({
      table: 'orders', mode: 'cohort', sampleSize: 50,
      cohortColumn: 'status',
    });

    assert.strictEqual(result.mode, 'cohort');
    assert.strictEqual(result.stats!.length, 2);
    assert.strictEqual(result.stats![0].cohortValue, 'shipped');
    assert.strictEqual(result.stats![0].count, 70);
    assert.ok(result.stats![0].percentage > 69);
    assert.strictEqual(result.stats![0].numericStats!.column, 'id');
    assert.strictEqual(result.stats![0].numericStats!.avg, 89.1);
  });

  it('should detect numeric columns for AVG/MIN/MAX', async () => {
    const sqlStub = sinon.stub();
    sqlStub.resolves({
      columns: ['cohort_value', 'count', 'avg_val', 'min_val', 'max_val'],
      rows: [['a', 10, 5, 1, 10]],
    });

    const client = {
      schemaMetadata: sinon.stub().resolves([makeMeta()]),
      sql: sqlStub,
    } as unknown as DriftApiClient;

    const engine = new SamplingEngine(client);
    const result = await engine.sample({
      table: 'orders', mode: 'cohort', sampleSize: 50,
      cohortColumn: 'status',
    });

    // SQL should include AVG/MIN/MAX for the first numeric column
    const sql = sqlStub.firstCall.args[0] as string;
    assert.ok(sql.includes('AVG('));
    assert.ok(sql.includes('MIN('));
    assert.ok(sql.includes('MAX('));
  });

  it('should omit numeric stats when no numeric columns', async () => {
    const textOnlyMeta = makeMeta({
      columns: [
        { name: 'id', type: 'TEXT', pk: true },
        { name: 'name', type: 'TEXT', pk: false },
      ],
    });
    const sqlStub = sinon.stub();
    sqlStub.resolves({
      columns: ['cohort_value', 'count'],
      rows: [['a', 10]],
    });

    const client = {
      schemaMetadata: sinon.stub().resolves([textOnlyMeta]),
      sql: sqlStub,
    } as unknown as DriftApiClient;

    const engine = new SamplingEngine(client);
    const result = await engine.sample({
      table: 'orders', mode: 'cohort', sampleSize: 50,
      cohortColumn: 'name',
    });

    assert.strictEqual(result.stats![0].numericStats, undefined);
  });
});

describe('SamplingEngine — edge cases', () => {
  it('should handle empty table gracefully', async () => {
    const sqlStub = sinon.stub();
    sqlStub.onFirstCall().resolves({ columns: ['cnt'], rows: [[0]] });
    sqlStub.onSecondCall().resolves({ columns: ['id'], rows: [] });

    const client = {
      schemaMetadata: sinon.stub().resolves([makeMeta()]),
      sql: sqlStub,
    } as unknown as DriftApiClient;

    const engine = new SamplingEngine(client);
    const result = await engine.sample({
      table: 'orders', mode: 'random', sampleSize: 10,
    });

    assert.strictEqual(result.totalRows, 0);
    assert.strictEqual(result.sampledRows, 0);
    assert.deepStrictEqual(result.rows, []);
  });
});

describe('sqlLiteral', () => {
  it('should quote strings with single quotes', () => {
    assert.strictEqual(sqlLiteral('hello'), "'hello'");
  });

  it('should escape embedded single quotes', () => {
    assert.strictEqual(sqlLiteral("O'Brien"), "'O''Brien'");
  });

  it('should return numbers as-is', () => {
    assert.strictEqual(sqlLiteral(42), '42');
    assert.strictEqual(sqlLiteral(3.14), '3.14');
  });

  it('should return NULL for null/undefined', () => {
    assert.strictEqual(sqlLiteral(null), 'NULL');
    assert.strictEqual(sqlLiteral(undefined), 'NULL');
  });
});

describe('zipRow', () => {
  it('should zip columns and row array into object', () => {
    const obj = zipRow(['a', 'b', 'c'], [1, 'two', null]);
    assert.deepStrictEqual(obj, { a: 1, b: 'two', c: null });
  });

  it('should handle empty arrays', () => {
    assert.deepStrictEqual(zipRow([], []), {});
  });
});
