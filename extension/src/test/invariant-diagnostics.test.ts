import * as assert from 'assert';
import * as sinon from 'sinon';
import { DriftApiClient } from '../api-client';
import { InvariantManager } from '../invariants/invariant-manager';
import { InvariantDiagnostics, InvariantCodeActionProvider } from '../invariants/invariant-diagnostics';
import { MockMemento, MockDiagnosticCollection } from './vscode-mock-classes';
import {
  createdDiagnosticCollections,
  resetMocks,
  workspace,
} from './vscode-mock';

function makeClient(): DriftApiClient {
  return new DriftApiClient('127.0.0.1', 8642);
}

function makeManager(client?: DriftApiClient): InvariantManager {
  return new InvariantManager(
    client ?? makeClient(),
    new MockMemento(),
  );
}

describe('InvariantDiagnostics', () => {
  let client: DriftApiClient;
  let manager: InvariantManager;

  beforeEach(() => {
    resetMocks();
    client = makeClient();
    manager = makeManager(client);
    sinon.stub(client, 'sql').resolves({ columns: [], rows: [] });
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should create a diagnostic collection', () => {
    const diag = new InvariantDiagnostics(manager);

    assert.ok(
      createdDiagnosticCollections.length > 0,
      'Expected diagnostic collection to be created',
    );

    diag.dispose();
  });

  it('should clear diagnostics when all invariants pass', async () => {
    const diag = new InvariantDiagnostics(manager);

    manager.add({
      name: 'Passing invariant',
      table: 'users',
      sql: 'SELECT 1 WHERE 0',
      expectation: 'zero_rows',
      severity: 'warning',
      enabled: true,
    });

    await manager.evaluateAll();

    const collection = createdDiagnosticCollections[
      createdDiagnosticCollections.length - 1
    ];
    assert.strictEqual(
      collection.diagnostics.size,
      0,
      'Expected no diagnostics for passing invariants',
    );

    diag.dispose();
  });

  it('should clear diagnostics on clear() call', () => {
    const diag = new InvariantDiagnostics(manager);

    diag.clear();

    const collection = createdDiagnosticCollections[
      createdDiagnosticCollections.length - 1
    ];
    assert.strictEqual(collection.clearedCount, 1);

    diag.dispose();
  });

  it('should dispose resources properly', () => {
    const diag = new InvariantDiagnostics(manager);

    diag.dispose();

    const collection = createdDiagnosticCollections[
      createdDiagnosticCollections.length - 1
    ];
    assert.ok(collection.disposed);
  });
});

describe('InvariantCodeActionProvider', () => {
  let manager: InvariantManager;

  beforeEach(() => {
    resetMocks();
    manager = makeManager();
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should provide quick fixes for invariant violations', () => {
    const provider = new InvariantCodeActionProvider(manager);

    const mockDiagnostic = {
      source: 'Saropa Drift Advisor',
      code: { value: 'invariant-violation', target: { toString: () => '' } },
      range: { start: { line: 0 }, end: { line: 0 } },
      message: 'Test violation',
    };

    const context = {
      diagnostics: [mockDiagnostic],
    };

    const actions = provider.provideCodeActions(
      {} as any,
      {} as any,
      context as any,
    );

    assert.ok(actions.length > 0);
    assert.ok(actions.some((a) => a.title === 'View Violating Rows'));
    assert.ok(actions.some((a) => a.title === 'Re-check Invariant'));
    assert.ok(actions.some((a) => a.title === 'Disable This Invariant'));
  });

  it('should ignore non-Saropa diagnostics', () => {
    const provider = new InvariantCodeActionProvider(manager);

    const mockDiagnostic = {
      source: 'Other Source',
      code: 'other-code',
      range: { start: { line: 0 }, end: { line: 0 } },
      message: 'Other diagnostic',
    };

    const context = {
      diagnostics: [mockDiagnostic],
    };

    const actions = provider.provideCodeActions(
      {} as any,
      {} as any,
      context as any,
    );

    assert.strictEqual(actions.length, 0);
  });

  it('should ignore non-invariant diagnostics', () => {
    const provider = new InvariantCodeActionProvider(manager);

    const mockDiagnostic = {
      source: 'Saropa Drift Advisor',
      code: 'index-suggestion',
      range: { start: { line: 0 }, end: { line: 0 } },
      message: 'Index suggestion',
    };

    const context = {
      diagnostics: [mockDiagnostic],
    };

    const actions = provider.provideCodeActions(
      {} as any,
      {} as any,
      context as any,
    );

    assert.strictEqual(actions.length, 0);
  });

  it('should have correct provided code action kinds', () => {
    assert.deepStrictEqual(
      InvariantCodeActionProvider.providedCodeActionKinds,
      [{ value: 'quickfix' }],
    );
  });
});
