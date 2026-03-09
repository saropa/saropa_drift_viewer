import * as assert from 'assert';
import * as sinon from 'sinon';
import {
  MockDiagnosticCollection,
  resetMocks,
} from './vscode-mock';
import { DriftApiClient } from '../api-client';
import { SchemaDiagnostics, DriftCodeActionProvider } from '../linter/schema-diagnostics';
import * as vscode from 'vscode';

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    json: () => Promise.resolve(data),
  } as Response;
}

describe('SchemaDiagnostics', () => {
  let fetchStub: sinon.SinonStub;
  let client: DriftApiClient;
  let collection: MockDiagnosticCollection;
  let linter: SchemaDiagnostics;

  beforeEach(() => {
    resetMocks();
    fetchStub = sinon.stub(globalThis, 'fetch');
    client = new DriftApiClient('127.0.0.1', 8642);
    collection = new MockDiagnosticCollection('drift-linter');
    linter = new SchemaDiagnostics(client, collection as any);
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it('should clear diagnostics when no issues found', async () => {
    fetchStub
      .onFirstCall().resolves(jsonResponse([]))  // indexSuggestions
      .onSecondCall().resolves(jsonResponse([])); // anomalies

    await linter.refresh();
    assert.strictEqual(collection.entries().size, 0);
  });

  it('should clear diagnostics on server error', async () => {
    fetchStub.rejects(new Error('connection refused'));

    // Pre-populate to verify clear
    collection.set({ toString: () => 'test' }, []);
    await linter.refresh();
    assert.strictEqual(collection.entries().size, 0);
  });

  it('should create diagnostics for index suggestions', async () => {
    fetchStub
      .onFirstCall().resolves(jsonResponse([
        { table: 'users', column: 'email', reason: 'FK target', sql: 'CREATE INDEX idx ON users(email)', priority: 'high' },
      ]))
      .onSecondCall().resolves(jsonResponse([])); // anomalies

    // Mock workspace.findFiles to return a fake Dart file
    const findFilesStub = sinon.stub(vscode.workspace, 'findFiles');
    const fakeUri = vscode.Uri.file('lib/users.dart');
    findFilesStub.resolves([fakeUri]);

    // Mock openTextDocument
    const openDocStub = sinon.stub(vscode.workspace, 'openTextDocument');
    openDocStub.resolves({
      getText: () => [
        'class Users extends Table {',
        '  IntColumn get id => integer().autoIncrement()()',
        '  TextColumn get email => text()()',
        '}',
      ].join('\n'),
    } as any);

    await linter.refresh();

    const entries = collection.entries();
    assert.strictEqual(entries.size, 1);

    findFilesStub.restore();
    openDocStub.restore();
  });

  it('should debounce rapid refreshes', async () => {
    fetchStub
      .resolves(jsonResponse([]));

    // First call goes through
    await linter.refresh();
    const firstCallCount = fetchStub.callCount;

    // Second call within debounce window should be deferred
    await linter.refresh();
    assert.strictEqual(fetchStub.callCount, firstCallCount,
      'should not make additional API calls within debounce window');
  });

  it('should clear diagnostics when linter is disabled via config', async () => {
    const getConfigStub = sinon.stub(vscode.workspace, 'getConfiguration');
    getConfigStub.returns({
      get: (key: string) => key === 'linter.enabled' ? false : undefined,
    } as any);

    // Pre-populate to verify clear
    collection.set({ toString: () => 'test' }, []);
    await linter.refresh();
    assert.strictEqual(collection.entries().size, 0);
    // Should not have called fetch at all (early return)
    assert.strictEqual(fetchStub.callCount, 0);

    getConfigStub.restore();
  });

  it('should clear diagnostics via clear()', () => {
    collection.set({ toString: () => 'test' }, []);
    assert.strictEqual(collection.entries().size, 1);

    linter.clear();
    assert.strictEqual(collection.entries().size, 0);
  });
});

describe('DriftCodeActionProvider', () => {
  const provider = new DriftCodeActionProvider();

  it('should return empty array for non-Drift diagnostics', () => {
    const diag = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 10),
      'unrelated error',
      vscode.DiagnosticSeverity.Error,
    );
    diag.source = 'typescript';

    const actions = provider.provideCodeActions(
      {} as any,
      new vscode.Range(0, 0, 0, 10),
      { diagnostics: [diag] } as any,
    );
    assert.strictEqual(actions.length, 0);
  });

  it('should offer Copy SQL action for index-suggestion diagnostics', () => {
    const diag = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 10),
      'users.email: FK target',
      vscode.DiagnosticSeverity.Warning,
    );
    diag.source = 'Drift Viewer';
    diag.code = 'index-suggestion';
    diag.relatedInformation = [
      new vscode.DiagnosticRelatedInformation(
        new vscode.Location(vscode.Uri.file('test.dart'), new vscode.Range(0, 0, 0, 10)),
        'Suggested fix: CREATE INDEX idx ON users(email)',
      ),
    ];

    const actions = provider.provideCodeActions(
      {} as any,
      new vscode.Range(0, 0, 0, 10),
      { diagnostics: [diag] } as any,
    );

    assert.strictEqual(actions.length, 1);
    assert.strictEqual(actions[0].title, 'Copy CREATE INDEX SQL');
    assert.strictEqual(actions[0].command!.command, 'driftViewer.copySuggestedSql');
    assert.deepStrictEqual(
      actions[0].command!.arguments,
      ['CREATE INDEX idx ON users(email)'],
    );
  });

  it('should skip index-suggestion without relatedInformation', () => {
    const diag = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 10),
      'test',
      vscode.DiagnosticSeverity.Warning,
    );
    diag.source = 'Drift Viewer';
    diag.code = 'index-suggestion';

    const actions = provider.provideCodeActions(
      {} as any,
      new vscode.Range(0, 0, 0, 10),
      { diagnostics: [diag] } as any,
    );
    assert.strictEqual(actions.length, 0);
  });

  it('should skip anomaly diagnostics (no quick fix)', () => {
    const diag = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 10),
      'NULL values detected',
      vscode.DiagnosticSeverity.Warning,
    );
    diag.source = 'Drift Viewer';
    diag.code = 'anomaly';

    const actions = provider.provideCodeActions(
      {} as any,
      new vscode.Range(0, 0, 0, 10),
      { diagnostics: [diag] } as any,
    );
    assert.strictEqual(actions.length, 0);
  });
});
