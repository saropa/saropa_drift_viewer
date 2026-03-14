import * as assert from 'assert';
import * as sinon from 'sinon';
import {
  CodeAction,
  Diagnostic,
  DiagnosticRelatedInformation,
  DiagnosticSeverity,
  Location,
  Range,
  Uri,
} from './vscode-mock-classes';
import { resetMocks } from './vscode-mock';
import { DriftApiClient } from '../api-client';
import { SchemaIntelligence } from '../engines/schema-intelligence';
import { QueryIntelligence } from '../engines/query-intelligence';
import { SchemaProvider } from '../diagnostics/providers/schema-provider';
import type { IDartFileInfo, IDiagnosticContext } from '../diagnostics/diagnostic-types';
import { createDartFile } from './diagnostic-test-helpers';

describe('SchemaProvider', () => {
  let client: DriftApiClient;
  let schemaIntel: SchemaIntelligence;
  let queryIntel: QueryIntelligence;
  let provider: SchemaProvider;
  let fetchStub: sinon.SinonStub;

  beforeEach(() => {
    fetchStub = sinon.stub(global, 'fetch');
    fetchStub.resolves(new Response(JSON.stringify([]), { status: 200 }));

    client = new DriftApiClient('127.0.0.1', 8642);
    schemaIntel = new SchemaIntelligence(client);
    queryIntel = new QueryIntelligence(client);
    provider = new SchemaProvider();

    resetMocks();
  });

  afterEach(() => {
    provider.dispose();
    sinon.restore();
  });

  describe('collectDiagnostics', () => {
    it('should report missing-table-in-db when Dart table not in database', async () => {
      const ctx = createContext({
        dartFiles: [createDartFile('users', ['id', 'name'])],
        dbTables: [], // Empty database
      });

      const issues = await provider.collectDiagnostics(ctx);

      const issue = issues.find((i) => i.code === 'missing-table-in-db');
      assert.ok(issue, 'Should report missing-table-in-db');
      assert.ok(issue.message.includes('users'));
      assert.strictEqual(issue.severity, DiagnosticSeverity.Error);
    });

    it('should report missing-column-in-db when Dart column not in database', async () => {
      const ctx = createContext({
        dartFiles: [createDartFile('users', ['id', 'name', 'email'])],
        dbTables: [{ name: 'users', columns: [
          { name: 'id', type: 'INTEGER', pk: true },
          { name: 'name', type: 'TEXT', pk: false },
        ], rowCount: 10 }],
      });

      const issues = await provider.collectDiagnostics(ctx);

      const issue = issues.find((i) => i.code === 'missing-column-in-db');
      assert.ok(issue, 'Should report missing-column-in-db');
      assert.ok(issue.message.includes('email'));
      assert.strictEqual(issue.severity, DiagnosticSeverity.Error);
    });

    it('should report no-primary-key when table lacks PK', async () => {
      const dartFile = createDartFile('logs', ['id', 'message']);
      dartFile.tables[0].columns[0].autoIncrement = false;

      const ctx = createContext({
        dartFiles: [dartFile],
        dbTables: [{ name: 'logs', columns: [
          { name: 'id', type: 'INTEGER', pk: false },
          { name: 'message', type: 'TEXT', pk: false },
        ], rowCount: 100 }],
      });

      const issues = await provider.collectDiagnostics(ctx);

      const issue = issues.find((i) => i.code === 'no-primary-key');
      assert.ok(issue, 'Should report no-primary-key');
      assert.ok(issue.message.includes('logs'));
    });

    it('should report column-type-drift when types mismatch', async () => {
      const ctx = createContext({
        dartFiles: [createDartFile('users', ['id', 'user_id'])],
        dbTables: [{ name: 'users', columns: [
          { name: 'id', type: 'INTEGER', pk: true },
          { name: 'user_id', type: 'TEXT', pk: false }, // Should be INTEGER (ends with _id)
        ], rowCount: 10 }],
      });

      const issues = await provider.collectDiagnostics(ctx);

      const issue = issues.find((i) => i.code === 'column-type-drift');
      assert.ok(issue, 'Should report column-type-drift');
      assert.ok(issue.message.includes('user_id'));
      assert.ok(issue.message.includes('INTEGER'));
      assert.ok(issue.message.includes('TEXT'));
    });

    it('should report extra-column-in-db for DB-only columns', async () => {
      const ctx = createContext({
        dartFiles: [createDartFile('users', ['id'])],
        dbTables: [{ name: 'users', columns: [
          { name: 'id', type: 'INTEGER', pk: true },
          { name: 'legacy_field', type: 'TEXT', pk: false },
        ], rowCount: 10 }],
      });

      const issues = await provider.collectDiagnostics(ctx);

      const issue = issues.find((i) => i.code === 'extra-column-in-db');
      assert.ok(issue, 'Should report extra-column-in-db');
      assert.ok(issue.message.includes('legacy_field'));
      assert.strictEqual(issue.severity, DiagnosticSeverity.Information);
    });

    it('should report text-pk for TEXT primary keys', async () => {
      const ctx = createContext({
        dartFiles: [createDartFile('configs', ['key', 'value'])],
        dbTables: [{ name: 'configs', columns: [
          { name: 'key', type: 'TEXT', pk: true },
          { name: 'value', type: 'TEXT', pk: false },
        ], rowCount: 5 }],
      });

      const issues = await provider.collectDiagnostics(ctx);

      const issue = issues.find((i) => i.code === 'text-pk');
      assert.ok(issue, 'Should report text-pk');
      assert.ok(issue.message.includes('configs'));
      assert.ok(issue.message.includes('INTEGER recommended'));
    });

    it('should report missing-fk-index from index suggestions', async () => {
      const ctx = createContext({
        dartFiles: [createDartFile('orders', ['id', 'user_id'])],
        dbTables: [{ name: 'orders', columns: [
          { name: 'id', type: 'INTEGER', pk: true },
          { name: 'user_id', type: 'INTEGER', pk: false },
        ], rowCount: 100 }],
        indexSuggestions: [{
          table: 'orders',
          column: 'user_id',
          reason: 'Foreign key without index',
          sql: 'CREATE INDEX idx_orders_user_id ON orders(user_id)',
          priority: 'high',
        }],
      });

      const issues = await provider.collectDiagnostics(ctx);

      const issue = issues.find((i) => i.code === 'missing-fk-index');
      assert.ok(issue, 'Should report missing-fk-index');
      assert.ok(issue.message.includes('user_id'));
      assert.ok(issue.relatedInfo?.[0].message.includes('CREATE INDEX'));
    });

    it('should report orphaned-fk from anomalies', async () => {
      const ctx = createContext({
        dartFiles: [createDartFile('orders', ['id', 'user_id'])],
        dbTables: [{ name: 'orders', columns: [
          { name: 'id', type: 'INTEGER', pk: true },
          { name: 'user_id', type: 'INTEGER', pk: false },
        ], rowCount: 100 }],
        anomalies: [{
          message: '5 orphaned FK values in orders.user_id',
          severity: 'error',
        }],
      });

      const issues = await provider.collectDiagnostics(ctx);

      const issue = issues.find((i) => i.code === 'orphaned-fk');
      assert.ok(issue, 'Should report orphaned-fk');
      assert.strictEqual(issue.severity, DiagnosticSeverity.Error);
    });

    it('should return empty array when server is unreachable', async () => {
      sinon.stub(schemaIntel, 'getInsights').rejects(new Error('Server down'));

      const ctx = createContext({ dartFiles: [], dbTables: [] });
      const issues = await provider.collectDiagnostics(ctx);

      assert.strictEqual(issues.length, 0);
    });
  });

  describe('provideCodeActions', () => {
    it('should provide Copy and Run actions for missing-fk-index', () => {
      const diag = new Diagnostic(
        new Range(10, 0, 10, 100),
        '[drift_advisor] FK column lacks index',
        DiagnosticSeverity.Warning,
      );
      diag.code = 'missing-fk-index';
      diag.relatedInformation = [
        new DiagnosticRelatedInformation(
          new Location(
            Uri.parse('file:///test.dart'),
            new Range(10, 0, 10, 100),
          ),
          'Suggested: CREATE INDEX idx_test ON test(col)',
        ),
      ];

      const actions = provider.provideCodeActions(diag as any, {} as any);

      assert.strictEqual(actions.length, 2);
      assert.ok(actions.some((a) => a.title.includes('Copy')));
      assert.ok(actions.some((a) => a.title.includes('Run')));
    });

    it('should provide migration actions for missing-column-in-db', () => {
      const diag = new Diagnostic(
        new Range(10, 0, 10, 100),
        '[drift_advisor] Column missing',
        DiagnosticSeverity.Error,
      );
      diag.code = 'missing-column-in-db';

      const actions = provider.provideCodeActions(diag as any, {} as any);

      assert.ok(actions.some((a) => a.title.includes('Generate Migration')));
      assert.ok(actions.some((a) => a.title.includes('Schema Diff')));
    });

    it('should provide View Anomaly action for orphaned-fk', () => {
      const diag = new Diagnostic(
        new Range(10, 0, 10, 100),
        '[drift_advisor] Orphaned FK',
        DiagnosticSeverity.Error,
      );
      diag.code = 'orphaned-fk';

      const actions = provider.provideCodeActions(diag as any, {} as any);

      assert.ok(actions.some((a) => a.title.includes('Anomaly Panel')));
    });
  });
});

function createContext(options: {
  dartFiles: IDartFileInfo[];
  dbTables: Array<{ name: string; columns: Array<{ name: string; type: string; pk: boolean }>; rowCount: number }>;
  indexSuggestions?: Array<{ table: string; column: string; reason: string; sql: string; priority: 'high' | 'low' }>;
  anomalies?: Array<{ message: string; severity: 'error' | 'warning' | 'info' }>;
}): IDiagnosticContext {
  const schemaIntel = {
    getInsights: () => Promise.resolve({
      tables: [],
      totalTables: 0,
      totalColumns: 0,
      totalRows: 0,
      missingIndexes: options.indexSuggestions ?? [],
      anomalies: options.anomalies ?? [],
      tablesWithoutPk: [],
      orphanedFkTables: [],
    }),
  } as any;

  const client = {
    schemaMetadata: () => Promise.resolve(options.dbTables),
  } as any;

  return {
    client,
    schemaIntel,
    queryIntel: {} as any,
    dartFiles: options.dartFiles,
    config: {
      enabled: true,
      refreshOnSave: true,
      refreshIntervalMs: 30000,
      categories: {
        schema: true,
        performance: true,
        dataQuality: true,
        bestPractices: true,
        naming: false,
        runtime: true,
      },
      disabledRules: new Set(),
      severityOverrides: {},
    },
  };
}

