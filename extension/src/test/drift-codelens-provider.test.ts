import * as assert from 'assert';
import * as sinon from 'sinon';
import { DriftApiClient } from '../api-client';
import { TableNameMapper } from '../codelens/table-name-mapper';
import { DriftCodeLensProvider } from '../codelens/drift-codelens-provider';

function fakeDocument(content: string): any {
  return { getText: () => content };
}

const SAMPLE_DART = `
import 'package:drift/drift.dart';

class Users extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get name => text()();
}

class SomeHelper {
  // not a table
}

class TodoCategories extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get title => text()();
}
`;

describe('DriftCodeLensProvider', () => {
  let fetchStub: sinon.SinonStub;
  let client: DriftApiClient;
  let mapper: TableNameMapper;
  let provider: DriftCodeLensProvider;

  beforeEach(() => {
    fetchStub = sinon.stub(globalThis, 'fetch');
    client = new DriftApiClient('127.0.0.1', 8642);
    mapper = new TableNameMapper();
    provider = new DriftCodeLensProvider(client, mapper);
  });

  afterEach(() => {
    fetchStub.restore();
  });

  describe('provideCodeLenses() — no server data', () => {
    it('should return "not connected" lenses for each table class', () => {
      const doc = fakeDocument(SAMPLE_DART);
      const lenses = provider.provideCodeLenses(doc);

      // 2 table classes, each gets 2 lenses (count + view; no Run Query without sqlName)
      assert.strictEqual(lenses.length, 4);
      assert.strictEqual(lenses[0].command?.title, '$(database) not connected');
      assert.strictEqual(lenses[1].command?.title, 'View in Saropa Drift Advisor');
      assert.strictEqual(lenses[2].command?.title, '$(database) not connected');
      assert.strictEqual(lenses[3].command?.title, 'View in Saropa Drift Advisor');
    });

    it('should pass Dart class name as fallback argument for View', () => {
      const doc = fakeDocument(SAMPLE_DART);
      const lenses = provider.provideCodeLenses(doc);

      assert.deepStrictEqual(lenses[1].command?.arguments, ['Users']);
      assert.deepStrictEqual(lenses[3].command?.arguments, ['TodoCategories']);
    });
  });

  describe('provideCodeLenses() — with server data', () => {
    beforeEach(async () => {
      const metadata = [
        { name: 'users', columns: [], rowCount: 42 },
        { name: 'todo_categories', columns: [], rowCount: 7 },
      ];
      fetchStub.resolves(
        new Response(JSON.stringify(metadata), { status: 200 }),
      );
      await provider.refreshRowCounts();
    });

    it('should return 3 lenses per table when connected', () => {
      const doc = fakeDocument(SAMPLE_DART);
      const lenses = provider.provideCodeLenses(doc);

      // 2 tables * 3 lenses = 6
      assert.strictEqual(lenses.length, 6);
    });

    it('should show correct row counts', () => {
      const doc = fakeDocument(SAMPLE_DART);
      const lenses = provider.provideCodeLenses(doc);

      assert.strictEqual(lenses[0].command?.title, '$(database) 42 rows');
      assert.strictEqual(lenses[3].command?.title, '$(database) 7 rows');
    });

    it('should pluralise "1 row" correctly', async () => {
      const metadata = [{ name: 'users', columns: [], rowCount: 1 }];
      fetchStub.resolves(
        new Response(JSON.stringify(metadata), { status: 200 }),
      );
      await provider.refreshRowCounts();

      const doc = fakeDocument('class Users extends Table {\n}\n');
      const lenses = provider.provideCodeLenses(doc);

      assert.strictEqual(lenses[0].command?.title, '$(database) 1 row');
    });

    it('should show "0 rows" for empty table', async () => {
      const metadata = [{ name: 'users', columns: [], rowCount: 0 }];
      fetchStub.resolves(
        new Response(JSON.stringify(metadata), { status: 200 }),
      );
      await provider.refreshRowCounts();

      const doc = fakeDocument('class Users extends Table {\n}\n');
      const lenses = provider.provideCodeLenses(doc);

      assert.strictEqual(lenses[0].command?.title, '$(database) 0 rows');
    });

    it('should include Run Query lens with correct SQL table name', () => {
      const doc = fakeDocument(SAMPLE_DART);
      const lenses = provider.provideCodeLenses(doc);

      // Lenses for Users: [0]=count, [1]=view, [2]=run query
      assert.strictEqual(lenses[2].command?.title, 'Run Query');
      assert.deepStrictEqual(lenses[2].command?.arguments, ['users']);

      // Lenses for TodoCategories: [3]=count, [4]=view, [5]=run query
      assert.strictEqual(lenses[5].command?.title, 'Run Query');
      assert.deepStrictEqual(lenses[5].command?.arguments, ['todo_categories']);
    });

    it('should use resolved SQL name for View argument', () => {
      const doc = fakeDocument(SAMPLE_DART);
      const lenses = provider.provideCodeLenses(doc);

      assert.deepStrictEqual(lenses[1].command?.arguments, ['users']);
      assert.deepStrictEqual(lenses[4].command?.arguments, ['todo_categories']);
    });
  });

  describe('provideCodeLenses() — line positions', () => {
    it('should place lenses on the correct lines', () => {
      const doc = fakeDocument(SAMPLE_DART);
      const lenses = provider.provideCodeLenses(doc);

      const usersLine = lenses[0].range.start.line;
      const todoLine = lenses[lenses.length - 1].range.start.line;

      assert.ok(usersLine < todoLine, 'Users should be before TodoCategories');
    });
  });

  describe('provideCodeLenses() — no table classes', () => {
    it('should return empty array for non-table Dart file', () => {
      const doc = fakeDocument('class MyWidget extends StatelessWidget {}');
      const lenses = provider.provideCodeLenses(doc);
      assert.strictEqual(lenses.length, 0);
    });
  });

  describe('refreshRowCounts()', () => {
    it('should set connected=true on success', async () => {
      fetchStub.resolves(
        new Response(JSON.stringify([]), { status: 200 }),
      );
      await provider.refreshRowCounts();
      assert.strictEqual(provider.connected, true);
    });

    it('should set connected=false on failure', async () => {
      fetchStub.rejects(new Error('connection refused'));
      await provider.refreshRowCounts();
      assert.strictEqual(provider.connected, false);
    });
  });

  describe('notifyChange()', () => {
    it('should fire onDidChangeCodeLenses event', () => {
      let fired = false;
      provider.onDidChangeCodeLenses(() => {
        fired = true;
      });
      provider.notifyChange();
      assert.strictEqual(fired, true);
    });
  });

  describe('regex edge cases', () => {
    it('should match class with leading whitespace', () => {
      const doc = fakeDocument('  class Users extends Table {\n  }\n');
      const lenses = provider.provideCodeLenses(doc);
      assert.ok(lenses.length > 0, 'should match indented class');
    });

    it('should not match classes extending other base classes', () => {
      const doc = fakeDocument(
        'class MyWidget extends StatelessWidget {\n}\n',
      );
      const lenses = provider.provideCodeLenses(doc);
      assert.strictEqual(lenses.length, 0);
    });

    it('should not match comments containing class pattern', () => {
      const doc = fakeDocument('// class Users extends Table {\n');
      const lenses = provider.provideCodeLenses(doc);
      assert.strictEqual(lenses.length, 0);
    });
  });
});
