import * as assert from 'assert';
import * as sinon from 'sinon';
import {
  Diagnostic,
  DiagnosticSeverity,
  Range,
} from './vscode-mock-classes';
import { resetMocks } from './vscode-mock';
import { DataQualityProvider } from '../diagnostics/providers/data-quality-provider';
import type { IDartFileInfo, IDiagnosticContext } from '../diagnostics/diagnostic-types';
import { createDartFile } from './diagnostic-test-helpers';

describe('DataQualityProvider', () => {
  let provider: DataQualityProvider;
  let fetchStub: sinon.SinonStub;

  beforeEach(() => {
    fetchStub = sinon.stub(global, 'fetch');
    fetchStub.resolves(new Response(JSON.stringify([]), { status: 200 }));

    provider = new DataQualityProvider();
    resetMocks();
  });

  afterEach(() => {
    provider.dispose();
    sinon.restore();
  });

  describe('collectDiagnostics', () => {
    it('should report empty-table for tables with 0 rows', async () => {
      const ctx = createContext({
        dartFiles: [createDartFile('users', ['id', 'name'])],
        tables: [
          { name: 'users', columns: [{ name: 'id', type: 'INTEGER', pk: true }], rowCount: 0 },
        ],
      });

      const issues = await provider.collectDiagnostics(ctx);

      const issue = issues.find((i) => i.code === 'empty-table');
      assert.ok(issue, 'Should report empty-table');
      assert.ok(issue.message.includes('users'));
      assert.ok(issue.message.includes('0 rows'));
      assert.strictEqual(issue.severity, DiagnosticSeverity.Information);
    });

    it('should not report empty-table for tables with rows', async () => {
      const ctx = createContext({
        dartFiles: [createDartFile('users', ['id', 'name'])],
        tables: [
          { name: 'users', columns: [{ name: 'id', type: 'INTEGER', pk: true }], rowCount: 100 },
        ],
      });

      const issues = await provider.collectDiagnostics(ctx);

      const issue = issues.find((i) => i.code === 'empty-table');
      assert.ok(!issue, 'Should not report non-empty table');
    });

    it('should report data-skew when table has >50% of rows', async () => {
      const ctx = createContext({
        dartFiles: [
          createDartFile('logs', ['id', 'message']),
          createDartFile('users', ['id', 'name']),
        ],
        tables: [
          { name: 'logs', columns: [{ name: 'id', type: 'INTEGER', pk: true }], rowCount: 900 },
          { name: 'users', columns: [{ name: 'id', type: 'INTEGER', pk: true }], rowCount: 100 },
        ],
        sizeAnalytics: {
          tables: [
            { table: 'logs', rowCount: 900, columnCount: 2, indexCount: 1, indexes: [] },
            { table: 'users', rowCount: 100, columnCount: 2, indexCount: 1, indexes: [] },
          ],
        },
      });

      const issues = await provider.collectDiagnostics(ctx);

      const issue = issues.find((i) => i.code === 'data-skew');
      assert.ok(issue, 'Should report data-skew');
      assert.ok(issue.message.includes('logs'));
      assert.ok(issue.message.includes('90%'));
      assert.strictEqual(issue.severity, DiagnosticSeverity.Warning);
    });

    it('should not report data-skew when rows are balanced', async () => {
      const ctx = createContext({
        dartFiles: [
          createDartFile('users', ['id']),
          createDartFile('orders', ['id']),
        ],
        tables: [
          { name: 'users', columns: [{ name: 'id', type: 'INTEGER', pk: true }], rowCount: 100 },
          { name: 'orders', columns: [{ name: 'id', type: 'INTEGER', pk: true }], rowCount: 100 },
        ],
        sizeAnalytics: {
          tables: [
            { table: 'users', rowCount: 100, columnCount: 1, indexCount: 1, indexes: [] },
            { table: 'orders', rowCount: 100, columnCount: 1, indexCount: 1, indexes: [] },
          ],
        },
      });

      const issues = await provider.collectDiagnostics(ctx);

      const issue = issues.find((i) => i.code === 'data-skew');
      assert.ok(!issue, 'Should not report balanced data');
    });

    it('should report high-null-rate for columns with >50% nulls', async () => {
      const ctx = createContext({
        dartFiles: [createDartFile('users', ['id', 'bio'])],
        tables: [
          {
            name: 'users',
            columns: [
              { name: 'id', type: 'INTEGER', pk: true },
              { name: 'bio', type: 'TEXT', pk: false },
            ],
            rowCount: 100,
          },
        ],
        nullCounts: { bio: 75 },
      });

      const issues = await provider.collectDiagnostics(ctx);

      const issue = issues.find((i) => i.code === 'high-null-rate');
      assert.ok(issue, 'Should report high-null-rate');
      assert.ok(issue.message.includes('bio'));
      assert.ok(issue.message.includes('75%'));
      assert.strictEqual(issue.severity, DiagnosticSeverity.Warning);
    });

    it('should not report high-null-rate for columns with low null percentage', async () => {
      const ctx = createContext({
        dartFiles: [createDartFile('users', ['id', 'bio'])],
        tables: [
          {
            name: 'users',
            columns: [
              { name: 'id', type: 'INTEGER', pk: true },
              { name: 'bio', type: 'TEXT', pk: false },
            ],
            rowCount: 100,
          },
        ],
        nullCounts: { bio: 10 },
      });

      const issues = await provider.collectDiagnostics(ctx);

      const issue = issues.find((i) => i.code === 'high-null-rate');
      assert.ok(!issue, 'Should not report low null rate');
    });

    it('should skip null rate check for small tables', async () => {
      const ctx = createContext({
        dartFiles: [createDartFile('configs', ['id', 'value'])],
        tables: [
          {
            name: 'configs',
            columns: [
              { name: 'id', type: 'INTEGER', pk: true },
              { name: 'value', type: 'TEXT', pk: false },
            ],
            rowCount: 5,
          },
        ],
        nullCounts: { value: 4 },
      });

      const issues = await provider.collectDiagnostics(ctx);

      const issue = issues.find((i) => i.code === 'high-null-rate');
      assert.ok(!issue, 'Should skip small tables');
    });

    it('should return empty array when server is unreachable', async () => {
      const ctx = createContext({ dartFiles: [], tables: [] });
      (ctx.client.schemaMetadata as any) = () => Promise.reject(new Error('Server down'));

      const issues = await provider.collectDiagnostics(ctx);

      assert.strictEqual(issues.length, 0);
    });
  });

  describe('provideCodeActions', () => {
    it('should provide Profile Column action for high-null-rate', () => {
      const diag = new Diagnostic(
        new Range(10, 0, 10, 100),
        '[drift_advisor] High null rate',
        DiagnosticSeverity.Warning,
      );
      diag.code = 'high-null-rate';
      (diag as any).data = { table: 'users', column: 'bio' };

      const actions = provider.provideCodeActions(diag as any, {} as any);

      assert.ok(actions.some((a) => a.title.includes('Profile')));
    });

    it('should provide Seed Data and Import actions for empty-table', () => {
      const diag = new Diagnostic(
        new Range(10, 0, 10, 100),
        '[drift_advisor] Empty table',
        DiagnosticSeverity.Information,
      );
      diag.code = 'empty-table';
      (diag as any).data = { table: 'users' };

      const actions = provider.provideCodeActions(diag as any, {} as any);

      assert.ok(actions.some((a) => a.title.includes('Seed')));
      assert.ok(actions.some((a) => a.title.includes('Import')));
    });

    it('should provide Size Analytics action for data-skew', () => {
      const diag = new Diagnostic(
        new Range(10, 0, 10, 100),
        '[drift_advisor] Data skew',
        DiagnosticSeverity.Warning,
      );
      diag.code = 'data-skew';

      const actions = provider.provideCodeActions(diag as any, {} as any);

      assert.ok(actions.some((a) => a.title.includes('Size Analytics')));
    });
  });
});

function createContext(options: {
  dartFiles: IDartFileInfo[];
  tables?: Array<{ name: string; columns: Array<{ name: string; type: string; pk: boolean }>; rowCount: number }>;
  sizeAnalytics?: { tables: Array<{ table: string; rowCount: number; columnCount: number; indexCount: number; indexes: string[] }> };
  nullCounts?: Record<string, number>;
}): IDiagnosticContext {
  const tables = options.tables ?? [];
  const sizeAnalytics = options.sizeAnalytics ?? {
    pageSize: 4096, pageCount: 10, totalSizeBytes: 40960,
    freeSpaceBytes: 1000, usedSizeBytes: 39960, journalMode: 'wal',
    tableCount: tables.length,
    tables: tables.map((t) => ({
      table: t.name, rowCount: t.rowCount, columnCount: t.columns.length, indexCount: 1, indexes: [],
    })),
  };
  const nullCounts = options.nullCounts ?? {};
  const client = {
    schemaMetadata: () => Promise.resolve(tables),
    sizeAnalytics: () => Promise.resolve(sizeAnalytics),
    sql: (query: string) => {
      if (query.includes('IS NULL')) {
        const result: number[] = [];
        for (const table of tables) {
          for (const col of table.columns) { result.push(nullCounts[col.name] ?? 0); }
        }
        return Promise.resolve({ columns: [], rows: [result] });
      }
      return Promise.resolve({ columns: [], rows: [] });
    },
  } as any;
  return {
    client, schemaIntel: {} as any, queryIntel: {} as any,
    dartFiles: options.dartFiles,
    config: {
      enabled: true, refreshOnSave: true, refreshIntervalMs: 30000,
      categories: { schema: true, performance: true, dataQuality: true, bestPractices: true, naming: false, runtime: true },
      disabledRules: new Set(), severityOverrides: {},
    },
  };
}
