import * as assert from 'assert';
import * as sinon from 'sinon';
import { SchemaSearchEngine } from '../schema-search/schema-search-engine';
import type { DriftApiClient } from '../api-client';
import type { ForeignKey, TableMetadata } from '../api-types';

const USERS: TableMetadata = {
  name: 'users',
  columns: [
    { name: 'id', type: 'INTEGER', pk: true },
    { name: 'email', type: 'TEXT', pk: false },
    { name: 'name', type: 'TEXT', pk: false },
  ],
  rowCount: 150,
};

const AUDIT_LOG: TableMetadata = {
  name: 'audit_log',
  columns: [
    { name: 'id', type: 'INTEGER', pk: true },
    { name: 'email', type: 'TEXT', pk: false },
    { name: 'action', type: 'TEXT', pk: false },
    { name: 'created_at', type: 'INTEGER', pk: false },
  ],
  rowCount: 89,
};

const ORDERS: TableMetadata = {
  name: 'orders',
  columns: [
    { name: 'id', type: 'INTEGER', pk: true },
    { name: 'total', type: 'REAL', pk: false },
    { name: 'data', type: 'BLOB', pk: false },
  ],
  rowCount: 42,
};

const SQLITE_INTERNAL: TableMetadata = {
  name: 'sqlite_sequence',
  columns: [{ name: 'seq', type: 'INTEGER', pk: false }],
  rowCount: 3,
};

function fakeClient(
  tables: TableMetadata[],
  fks: Map<string, ForeignKey[]> = new Map(),
): DriftApiClient {
  return {
    schemaMetadata: sinon.stub().resolves(tables),
    tableFkMeta: sinon.stub().callsFake((name: string) =>
      Promise.resolve(fks.get(name) ?? []),
    ),
  } as unknown as DriftApiClient;
}

describe('SchemaSearchEngine', () => {
  it('should find matching tables by name', async () => {
    const engine = new SchemaSearchEngine(fakeClient([USERS, ORDERS]));
    const result = await engine.search('user', 'all');
    const tableMatches = result.matches.filter((m) => m.type === 'table');
    assert.strictEqual(tableMatches.length, 1);
    assert.strictEqual(tableMatches[0].table, 'users');
  });

  it('should find matching columns by name', async () => {
    const engine = new SchemaSearchEngine(fakeClient([USERS, AUDIT_LOG]));
    const result = await engine.search('email', 'all');
    const colMatches = result.matches.filter((m) => m.type === 'column');
    assert.strictEqual(colMatches.length, 2);
    assert.ok(colMatches.some((m) => m.table === 'users'));
    assert.ok(colMatches.some((m) => m.table === 'audit_log'));
  });

  it('should find columns by type', async () => {
    const engine = new SchemaSearchEngine(fakeClient([USERS, ORDERS]));
    const result = await engine.search('real', 'all');
    const colMatches = result.matches.filter((m) => m.type === 'column');
    assert.strictEqual(colMatches.length, 1);
    assert.strictEqual(colMatches[0].column, 'total');
    assert.strictEqual(colMatches[0].columnType, 'REAL');
  });

  it('should filter by type when typeFilter is set', async () => {
    const engine = new SchemaSearchEngine(fakeClient([USERS, ORDERS]));
    const result = await engine.search('', 'columns', 'INTEGER');
    const cols = result.matches.filter((m) => m.type === 'column');
    assert.ok(cols.every((m) => m.columnType === 'INTEGER'));
    assert.ok(cols.length >= 2); // users.id + orders.id
  });

  it('should scope to tables only', async () => {
    const engine = new SchemaSearchEngine(fakeClient([USERS, ORDERS]));
    const result = await engine.search('', 'tables');
    assert.ok(result.matches.every((m) => m.type === 'table'));
    assert.strictEqual(result.matches.length, 2);
  });

  it('should scope to columns only', async () => {
    const engine = new SchemaSearchEngine(fakeClient([USERS]));
    const result = await engine.search('users', 'columns');
    assert.ok(result.matches.every((m) => m.type === 'column'));
  });

  it('should exclude sqlite_ internal tables', async () => {
    const engine = new SchemaSearchEngine(
      fakeClient([USERS, SQLITE_INTERNAL]),
    );
    const result = await engine.search('', 'all');
    assert.ok(result.matches.every((m) => !m.table.startsWith('sqlite_')));
  });

  it('should return all items for empty query (browse mode)', async () => {
    const engine = new SchemaSearchEngine(fakeClient([USERS, ORDERS]));
    const result = await engine.search('', 'all');
    assert.ok(result.matches.length > 0);
    const tableMatches = result.matches.filter((m) => m.type === 'table');
    assert.strictEqual(tableMatches.length, 2);
  });

  it('should match case-insensitively', async () => {
    const engine = new SchemaSearchEngine(fakeClient([USERS]));
    const result = await engine.search('EMAIL', 'all');
    const colMatches = result.matches.filter((m) => m.type === 'column');
    assert.strictEqual(colMatches.length, 1);
    assert.strictEqual(colMatches[0].column, 'email');
  });

  it('should match partial names', async () => {
    const engine = new SchemaSearchEngine(fakeClient([USERS]));
    const result = await engine.search('usr', 'tables');
    // "usr" is not in "users" — this should not match
    assert.strictEqual(result.matches.length, 0);
    // But "use" is a substring of "users"
    const result2 = await engine.search('use', 'tables');
    assert.strictEqual(result2.matches.length, 1);
  });

  it('should include rowCount and columnCount for table matches', async () => {
    const engine = new SchemaSearchEngine(fakeClient([USERS]));
    const result = await engine.search('users', 'tables');
    assert.strictEqual(result.matches.length, 1);
    assert.strictEqual(result.matches[0].rowCount, 150);
    assert.strictEqual(result.matches[0].columnCount, 3);
  });

  it('should mark PK columns', async () => {
    const engine = new SchemaSearchEngine(fakeClient([USERS]));
    const result = await engine.search('id', 'columns');
    const idMatch = result.matches.find((m) => m.column === 'id');
    assert.ok(idMatch);
    assert.strictEqual(idMatch.isPk, true);
  });

  describe('cross-references', () => {
    it('should detect columns in multiple tables', async () => {
      const engine = new SchemaSearchEngine(
        fakeClient([USERS, AUDIT_LOG]),
      );
      const result = await engine.search('email', 'columns');
      assert.strictEqual(result.crossReferences.length, 1);
      const ref = result.crossReferences[0];
      assert.strictEqual(ref.columnName, 'email');
      assert.deepStrictEqual(ref.tables.sort(), ['audit_log', 'users']);
    });

    it('should annotate alsoIn on matches', async () => {
      const engine = new SchemaSearchEngine(
        fakeClient([USERS, AUDIT_LOG]),
      );
      const result = await engine.search('email', 'columns');
      const usersEmail = result.matches.find(
        (m) => m.table === 'users' && m.column === 'email',
      );
      assert.ok(usersEmail?.alsoIn);
      assert.deepStrictEqual(usersEmail.alsoIn, ['audit_log']);
    });

    it('should report missing FKs', async () => {
      const engine = new SchemaSearchEngine(
        fakeClient([USERS, AUDIT_LOG]),
      );
      const result = await engine.search('email', 'columns');
      const ref = result.crossReferences[0];
      assert.ok(ref.missingFks.length > 0);
    });

    it('should not report missing FK when FK exists', async () => {
      const fks = new Map<string, ForeignKey[]>([
        ['audit_log', [{ fromColumn: 'email', toTable: 'users', toColumn: 'email' }]],
      ]);
      const engine = new SchemaSearchEngine(
        fakeClient([USERS, AUDIT_LOG], fks),
      );
      const result = await engine.search('email', 'columns');
      const ref = result.crossReferences[0];
      const auditToUsers = ref.missingFks.filter(
        (fk) => fk.from === 'audit_log' && fk.to === 'users',
      );
      assert.strictEqual(auditToUsers.length, 0);
    });

    it('should not cross-reference columns in only one table', async () => {
      const engine = new SchemaSearchEngine(fakeClient([USERS, ORDERS]));
      const result = await engine.search('total', 'columns');
      assert.strictEqual(result.crossReferences.length, 0);
    });
  });

  describe('getAllMetadata', () => {
    it('should exclude sqlite_ tables', async () => {
      const engine = new SchemaSearchEngine(
        fakeClient([USERS, SQLITE_INTERNAL]),
      );
      const meta = await engine.getAllMetadata();
      assert.strictEqual(meta.length, 1);
      assert.strictEqual(meta[0].name, 'users');
    });
  });
});
