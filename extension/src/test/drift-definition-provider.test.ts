import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { DriftApiClient } from '../api-client';
import { snakeToPascal } from '../dart-names';
import { DriftDefinitionProvider } from '../definition/drift-definition-provider';

// Re-import mock helpers for type access
const vscodeMock = vscode as any;

describe('snakeToPascal()', () => {
  it('should convert simple names', () => {
    assert.strictEqual(snakeToPascal('users'), 'Users');
  });

  it('should convert multi-word snake_case', () => {
    assert.strictEqual(snakeToPascal('user_profiles'), 'UserProfiles');
  });

  it('should handle single character segments', () => {
    assert.strictEqual(snakeToPascal('a_b_c'), 'ABC');
  });

  it('should handle already capitalized input', () => {
    assert.strictEqual(snakeToPascal('USERS'), 'Users');
  });
});

describe('DriftDefinitionProvider', () => {
  let fetchStub: sinon.SinonStub;
  let findFilesStub: sinon.SinonStub;
  let openTextDocumentStub: sinon.SinonStub;
  let client: DriftApiClient;
  let provider: DriftDefinitionProvider;

  const sampleSchema = [
    {
      name: 'users',
      columns: [
        { name: 'id', type: 'INTEGER', pk: true },
        { name: 'name', type: 'TEXT', pk: false },
        { name: 'email', type: 'TEXT', pk: false },
        { name: 'created_at', type: 'INTEGER', pk: false },
      ],
      rowCount: 42,
    },
    {
      name: 'orders',
      columns: [
        { name: 'id', type: 'INTEGER', pk: true },
        { name: 'user_id', type: 'INTEGER', pk: false },
        { name: 'total', type: 'REAL', pk: false },
      ],
      rowCount: 10,
    },
  ];

  const dartTableContent = [
    'import \'package:drift/drift.dart\';',
    '',
    'class Users extends Table {',
    '  IntColumn get id => integer().autoIncrement()();',
    '  TextColumn get name => text()();',
    '  TextColumn get email => text().nullable()();',
    '  IntColumn get createdAt => integer()();',
    '}',
  ].join('\n');

  function makeDocument(lineText: string, languageId = 'dart'): any {
    return {
      languageId,
      lineAt: (_line: number) => ({ text: lineText }),
    };
  }

  function makeDartFileDocument(content: string): any {
    return {
      getText: () => content,
      positionAt: (offset: number) => {
        const before = content.substring(0, offset);
        const lines = before.split('\n');
        return new vscodeMock.Position(
          lines.length - 1,
          lines[lines.length - 1].length,
        );
      },
      languageId: 'dart',
    };
  }

  const cancelToken = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: () => { /* no-op */ } }),
  };

  beforeEach(() => {
    fetchStub = sinon.stub(globalThis, 'fetch');
    client = new DriftApiClient('127.0.0.1', 8642);
    provider = new DriftDefinitionProvider(client);

    // Stub workspace methods
    findFilesStub = sinon.stub(vscodeMock.workspace, 'findFiles');
    openTextDocumentStub = sinon.stub(vscodeMock.workspace, 'openTextDocument');
  });

  afterEach(() => {
    fetchStub.restore();
    findFilesStub.restore();
    openTextDocumentStub.restore();
    provider.clearCache();
  });

  function stubSchemaMetadata(): void {
    fetchStub.resolves(
      new Response(JSON.stringify(sampleSchema), { status: 200 }),
    );
  }

  describe('provideDefinition()', () => {
    it('should return null for non-dart files', async () => {
      const doc = makeDocument("'SELECT * FROM users'", 'javascript');
      const pos = new vscodeMock.Position(0, 18);
      const result = await provider.provideDefinition(doc, pos, cancelToken);
      assert.strictEqual(result, null);
    });

    it('should return null when cursor is not inside a string', async () => {
      const doc = makeDocument('var users = getUsers();');
      const pos = new vscodeMock.Position(0, 4);
      const result = await provider.provideDefinition(doc, pos, cancelToken);
      assert.strictEqual(result, null);
    });

    it('should return null when string is not SQL', async () => {
      const doc = makeDocument("var x = 'hello world';");
      const pos = new vscodeMock.Position(0, 12);
      const result = await provider.provideDefinition(doc, pos, cancelToken);
      assert.strictEqual(result, null);
    });

    it('should return null when cursor is on a non-identifier character in SQL', async () => {
      const doc = makeDocument("  'SELECT * FROM users',");
      const pos = new vscodeMock.Position(0, 11); // on '*'
      const result = await provider.provideDefinition(doc, pos, cancelToken);
      assert.strictEqual(result, null);
    });

    it('should return null when word is not a known table or column', async () => {
      stubSchemaMetadata();
      const doc = makeDocument("  'SELECT foobar FROM users',");
      const pos = new vscodeMock.Position(0, 12); // on 'foobar'
      const result = await provider.provideDefinition(doc, pos, cancelToken);
      assert.strictEqual(result, null);
    });

    it('should resolve a table name to its Dart class definition', async () => {
      stubSchemaMetadata();
      const fileUri = vscodeMock.Uri.file('/project/lib/tables/users.dart');
      findFilesStub.resolves([fileUri]);
      openTextDocumentStub.resolves(makeDartFileDocument(dartTableContent));

      const doc = makeDocument("  'SELECT name, email FROM users WHERE id = ?',");
      // cursor on 'u' of 'users' — position 31
      const pos = new vscodeMock.Position(0, 31);
      const result = await provider.provideDefinition(doc, pos, cancelToken);

      assert.ok(result, 'Expected a Location result');
      assert.strictEqual(result.uri, fileUri);
      // Should point to 'class Users extends Table' line
      assert.strictEqual(result.range.start.line, 2);
    });

    it('should resolve a column name to its getter definition', async () => {
      stubSchemaMetadata();
      const fileUri = vscodeMock.Uri.file('/project/lib/tables/users.dart');
      findFilesStub.resolves([fileUri]);
      openTextDocumentStub.resolves(makeDartFileDocument(dartTableContent));

      const doc = makeDocument("  'SELECT email FROM users WHERE id = ?',");
      // cursor on 'e' of 'email' — position 10
      const pos = new vscodeMock.Position(0, 10);
      const result = await provider.provideDefinition(doc, pos, cancelToken);

      assert.ok(result, 'Expected a Location result');
      assert.strictEqual(result.uri, fileUri);
      // Should point to 'get email' line
      assert.strictEqual(result.range.start.line, 5);
    });

    it('should resolve snake_case column to camelCase getter', async () => {
      stubSchemaMetadata();
      const fileUri = vscodeMock.Uri.file('/project/lib/tables/users.dart');
      findFilesStub.resolves([fileUri]);
      openTextDocumentStub.resolves(makeDartFileDocument(dartTableContent));

      const doc = makeDocument("  'SELECT created_at FROM users',");
      // cursor on 'created_at'
      const pos = new vscodeMock.Position(0, 12);
      const result = await provider.provideDefinition(doc, pos, cancelToken);

      assert.ok(result, 'Expected a Location result');
      // Should find 'get createdAt' line (line 6)
      assert.strictEqual(result.range.start.line, 6);
    });

    it('should return null when no dart file matches the table class', async () => {
      stubSchemaMetadata();
      const fileUri = vscodeMock.Uri.file('/project/lib/other.dart');
      findFilesStub.resolves([fileUri]);
      openTextDocumentStub.resolves(
        makeDartFileDocument('class Other extends StatelessWidget {}'),
      );

      const doc = makeDocument("  'SELECT * FROM users',");
      const pos = new vscodeMock.Position(0, 19); // on 'users'
      const result = await provider.provideDefinition(doc, pos, cancelToken);
      assert.strictEqual(result, null);
    });

    it('should return null when schema fetch fails and no cache', async () => {
      fetchStub.rejects(new Error('connection refused'));

      const doc = makeDocument("  'SELECT * FROM users',");
      const pos = new vscodeMock.Position(0, 19);
      const result = await provider.provideDefinition(doc, pos, cancelToken);
      assert.strictEqual(result, null);
    });

    it('should use cached schema on subsequent calls', async () => {
      stubSchemaMetadata();
      findFilesStub.resolves([]);

      const doc = makeDocument("  'SELECT * FROM users',");
      const pos = new vscodeMock.Position(0, 19);

      // First call — fetches schema
      await provider.provideDefinition(doc, pos, cancelToken);
      assert.strictEqual(fetchStub.callCount, 1);

      // Second call — should use cache
      await provider.provideDefinition(doc, pos, cancelToken);
      assert.strictEqual(fetchStub.callCount, 1);
    });

    it('should refetch schema after clearCache()', async () => {
      stubSchemaMetadata();
      findFilesStub.resolves([]);

      const doc = makeDocument("  'SELECT * FROM users',");
      const pos = new vscodeMock.Position(0, 19);

      await provider.provideDefinition(doc, pos, cancelToken);
      assert.strictEqual(fetchStub.callCount, 1);

      provider.clearCache();
      await provider.provideDefinition(doc, pos, cancelToken);
      assert.strictEqual(fetchStub.callCount, 2);
    });
  });
});
