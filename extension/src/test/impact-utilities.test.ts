import * as assert from 'assert';
import {
  generateImpactDeleteSql, computeSummary,
} from '../impact/impact-analyzer';
import type { IImpactResult } from '../impact/impact-types';

describe('computeSummary', () => {
  it('computes totals from branches', () => {
    const summary = computeSummary([
      {
        table: 'orders', fkColumn: 'user_id', totalCount: 5,
        rows: [], truncated: true,
      },
      {
        table: 'sessions', fkColumn: 'user_id', totalCount: 3,
        rows: [], truncated: true,
      },
    ]);
    assert.strictEqual(summary.totalRows, 8);
    assert.strictEqual(summary.totalTables, 2);
    assert.strictEqual(summary.tables[0].name, 'orders');
    assert.strictEqual(summary.tables[0].rowCount, 5);
  });

  it('returns empty for no branches', () => {
    const summary = computeSummary([]);
    assert.strictEqual(summary.totalRows, 0);
    assert.strictEqual(summary.totalTables, 0);
  });
});

describe('generateImpactDeleteSql', () => {
  it('produces children-first DELETE statements', () => {
    const result: IImpactResult = {
      root: { table: 'users', pkColumn: 'id', pkValue: 1, preview: {} },
      outbound: [],
      inbound: [{
        table: 'orders', fkColumn: 'user_id', totalCount: 1,
        truncated: false,
        rows: [{
          pkColumn: 'id', pkValue: 10, preview: {},
          children: [{
            table: 'items', fkColumn: 'order_id', totalCount: 1,
            truncated: false,
            rows: [{
              pkColumn: 'id', pkValue: 100, preview: {},
              children: [],
            }],
          }],
        }],
      }],
      summary: { tables: [], totalRows: 0, totalTables: 0 },
    };

    const sql = generateImpactDeleteSql(result);
    const deletes = sql.split('\n').filter((l) => l.startsWith('DELETE'));
    assert.strictEqual(deletes.length, 3);
    assert.ok(deletes[0].includes('"items"'));
    assert.ok(deletes[1].includes('"orders"'));
    assert.ok(deletes[2].includes('"users"'));
  });

  it('skips outbound rows (parents are not deleted)', () => {
    const result: IImpactResult = {
      root: { table: 'orders', pkColumn: 'id', pkValue: 10, preview: {} },
      outbound: [{
        table: 'users', pkColumn: 'id', pkValue: 1,
        fkColumn: 'user_id', preview: {},
      }],
      inbound: [],
      summary: { tables: [], totalRows: 0, totalTables: 0 },
    };

    const sql = generateImpactDeleteSql(result);
    const deletes = sql.split('\n').filter((l) => l.startsWith('DELETE'));
    assert.strictEqual(deletes.length, 1);
    assert.ok(deletes[0].includes('"orders"'));
    assert.ok(!sql.includes('"users"'));
  });

  it('includes truncation note for incomplete branches', () => {
    const result: IImpactResult = {
      root: { table: 'users', pkColumn: 'id', pkValue: 1, preview: {} },
      outbound: [],
      inbound: [{
        table: 'orders', fkColumn: 'user_id', totalCount: 50,
        truncated: true,
        rows: [{
          pkColumn: 'id', pkValue: 10, preview: {},
          children: [],
        }],
      }],
      summary: { tables: [], totalRows: 0, totalTables: 0 },
    };

    const sql = generateImpactDeleteSql(result);
    assert.ok(sql.includes('NOTE:'));
    assert.ok(sql.includes('50 total rows'));
  });
});
