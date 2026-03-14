import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from './vscode-mock';
import {
  CodeAction,
  CodeActionKind,
  Diagnostic,
  DiagnosticSeverity,
  MockDiagnosticCollection,
  Range,
} from './vscode-mock-classes';
import { resetMocks, workspace } from './vscode-mock';
import { DriftApiClient } from '../api-client';
import { SchemaIntelligence } from '../engines/schema-intelligence';
import { QueryIntelligence } from '../engines/query-intelligence';
import {
  DiagnosticManager,
} from '../diagnostics/diagnostic-manager';
import {
  DIAGNOSTIC_PREFIX,
  type IDiagnosticIssue,
  type IDiagnosticProvider,
} from '../diagnostics/diagnostic-types';
import { createMockProvider, createMockIssue } from './diagnostic-test-helpers';

describe('DiagnosticManager', () => {
  let client: DriftApiClient;
  let schemaIntel: SchemaIntelligence;
  let queryIntel: QueryIntelligence;
  let manager: DiagnosticManager;
  let fetchStub: sinon.SinonStub;

  beforeEach(() => {
    fetchStub = sinon.stub(global, 'fetch');
    fetchStub.resolves(new Response(JSON.stringify([]), { status: 200 }));

    client = new DriftApiClient('127.0.0.1', 8642);
    schemaIntel = new SchemaIntelligence(client);
    queryIntel = new QueryIntelligence(client);
    manager = new DiagnosticManager(client, schemaIntel, queryIntel);

    resetMocks();
  });

  afterEach(() => {
    manager.dispose();
    sinon.restore();
  });

  describe('provider registration', () => {
    it('should register a provider', () => {
      const provider = createMockProvider('test', 'schema', []);
      const disposable = manager.registerProvider(provider);

      assert.strictEqual(manager.providerCount, 1);
      assert.strictEqual(manager.getProvider('test'), provider);

      disposable.dispose();
      assert.strictEqual(manager.providerCount, 0);
    });

    it('should throw when registering duplicate provider id', () => {
      const provider1 = createMockProvider('test', 'schema', []);
      const provider2 = createMockProvider('test', 'schema', []);

      manager.registerProvider(provider1);

      assert.throws(
        () => manager.registerProvider(provider2),
        /already registered/,
      );
    });

    it('should dispose provider when unregistered', () => {
      const provider = createMockProvider('test', 'schema', []);
      const disposeSpy = sinon.spy(provider, 'dispose');

      const disposable = manager.registerProvider(provider);
      disposable.dispose();

      assert.ok(disposeSpy.calledOnce);
    });
  });

  describe('refresh', () => {
    it('should collect diagnostics from all providers', async () => {
      const issues1: IDiagnosticIssue[] = [
        createMockIssue('missing-fk-index', 'Test issue 1', 10),
      ];
      const issues2: IDiagnosticIssue[] = [
        createMockIssue('full-table-scan', 'Test issue 2', 20),
      ];

      manager.registerProvider(createMockProvider('schema', 'schema', issues1));
      manager.registerProvider(createMockProvider('perf', 'performance', issues2));

      await manager.refresh();

      const collection = manager.collection as unknown as MockDiagnosticCollection;
      const allDiags = [...collection.entries().values()].flat();

      assert.strictEqual(allDiags.length, 2);
    });

    it('should apply [drift_advisor] prefix to all messages', async () => {
      const issues: IDiagnosticIssue[] = [
        createMockIssue('missing-fk-index', 'FK column missing index', 10),
      ];

      manager.registerProvider(createMockProvider('schema', 'schema', issues));

      await manager.refresh();

      const collection = manager.collection as unknown as MockDiagnosticCollection;
      const allDiags = [...collection.entries().values()].flat();

      assert.strictEqual(allDiags.length, 1);
      assert.ok(allDiags[0].message.startsWith(DIAGNOSTIC_PREFIX));
    });

    it('should set correct source on diagnostics', async () => {
      const issues: IDiagnosticIssue[] = [
        createMockIssue('missing-fk-index', 'Test', 10),
      ];

      manager.registerProvider(createMockProvider('schema', 'schema', issues));

      await manager.refresh();

      const collection = manager.collection as unknown as MockDiagnosticCollection;
      const allDiags = [...collection.entries().values()].flat();

      assert.strictEqual(allDiags[0].source, 'Drift Advisor');
    });

    it('should skip disabled categories', async () => {
      const schemaIssues: IDiagnosticIssue[] = [
        createMockIssue('missing-fk-index', 'Schema issue', 10),
      ];
      const namingIssues: IDiagnosticIssue[] = [
        createMockIssue('table-name-case', 'Naming issue', 20),
      ];

      manager.registerProvider(createMockProvider('schema', 'schema', schemaIssues));
      manager.registerProvider(createMockProvider('naming', 'naming', namingIssues));

      await manager.refresh();

      const collection = manager.collection as unknown as MockDiagnosticCollection;
      const allDiags = [...collection.entries().values()].flat();

      assert.strictEqual(allDiags.length, 1);
      assert.ok(allDiags[0].message.includes('Schema issue'));
    });

    it('should clear diagnostics when disabled', async () => {
      const issues: IDiagnosticIssue[] = [
        createMockIssue('missing-fk-index', 'Test', 10),
      ];
      manager.registerProvider(createMockProvider('schema', 'schema', issues));

      await manager.refresh();

      const collection = manager.collection as unknown as MockDiagnosticCollection;
      assert.strictEqual([...collection.entries().values()].flat().length, 1);

      sinon.stub(workspace, 'getConfiguration').returns({
        get: (key: string, defaultVal?: unknown) => {
          if (key === 'enabled') return false;
          return defaultVal;
        },
      } as any);

      (manager as any)._lastRefresh = 0;
      await manager.refresh();

      assert.strictEqual([...collection.entries().values()].flat().length, 0);
    });

    it('should handle provider errors gracefully', async () => {
      const goodProvider = createMockProvider('good', 'schema', [
        createMockIssue('missing-fk-index', 'Good issue', 10),
      ]);
      const badProvider: IDiagnosticProvider = {
        id: 'bad',
        category: 'performance',
        collectDiagnostics: () => Promise.reject(new Error('Provider failed')),
        dispose: () => {},
      };

      manager.registerProvider(goodProvider);
      manager.registerProvider(badProvider);

      await manager.refresh();

      const collection = manager.collection as unknown as MockDiagnosticCollection;
      const allDiags = [...collection.entries().values()].flat();
      assert.strictEqual(allDiags.length, 1);
    });
  });

  describe('clear', () => {
    it('should clear all diagnostics', async () => {
      const issues: IDiagnosticIssue[] = [
        createMockIssue('missing-fk-index', 'Test', 10),
      ];
      manager.registerProvider(createMockProvider('schema', 'schema', issues));

      await manager.refresh();

      const collection = manager.collection as unknown as MockDiagnosticCollection;
      assert.strictEqual([...collection.entries().values()].flat().length, 1);

      manager.clear();

      assert.strictEqual([...collection.entries().values()].flat().length, 0);
    });
  });

  describe('code actions', () => {
    it('should delegate code actions to provider', async () => {
      const codeAction = new CodeAction('Fix it', CodeActionKind.QuickFix);

      const provider: IDiagnosticProvider = {
        id: 'schema',
        category: 'schema',
        collectDiagnostics: () => Promise.resolve([]),
        provideCodeActions: () => [codeAction] as any,
        dispose: () => {},
      };

      manager.registerProvider(provider);

      const diag = new Diagnostic(
        new Range(0, 0, 0, 10),
        'Test',
        DiagnosticSeverity.Warning,
      );
      diag.code = 'missing-fk-index';

      const actions = manager.provideCodeActions(diag as any, {} as any);

      assert.strictEqual(actions.length, 1);
      assert.strictEqual(actions[0].title, 'Fix it');
    });

    it('should return empty array for unknown diagnostic code', () => {
      const diag = new Diagnostic(
        new Range(0, 0, 0, 10),
        'Test',
        DiagnosticSeverity.Warning,
      );
      diag.code = 'unknown-code';

      const actions = manager.provideCodeActions(diag as any, {} as any);

      assert.strictEqual(actions.length, 0);
    });
  });

  describe('dispose', () => {
    it('should dispose all providers', () => {
      const provider1 = createMockProvider('p1', 'schema', []);
      const provider2 = createMockProvider('p2', 'performance', []);
      const spy1 = sinon.spy(provider1, 'dispose');
      const spy2 = sinon.spy(provider2, 'dispose');

      manager.registerProvider(provider1);
      manager.registerProvider(provider2);

      manager.dispose();

      assert.ok(spy1.calledOnce);
      assert.ok(spy2.calledOnce);
    });
  });
});

