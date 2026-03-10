import * as assert from 'assert';
import { MockMemento } from './vscode-mock';
import { SnippetStore } from '../snippets/snippet-store';
import type { ISqlSnippet } from '../snippets/snippet-types';

function makeSnippet(overrides: Partial<ISqlSnippet> = {}): ISqlSnippet {
  return {
    id: 'test-1',
    name: 'Test snippet',
    sql: 'SELECT * FROM "users"',
    category: 'Basics',
    variables: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    useCount: 0,
    ...overrides,
  };
}

describe('SnippetStore', () => {
  let state: MockMemento;
  let store: SnippetStore;

  beforeEach(() => {
    state = new MockMemento();
    store = new SnippetStore(state as any);
  });

  it('should save and retrieve a snippet', () => {
    const snippet = makeSnippet();
    store.save(snippet);
    const all = store.getAll();
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].name, 'Test snippet');
    assert.strictEqual(all[0].sql, 'SELECT * FROM "users"');
  });

  it('should update an existing snippet by ID', () => {
    store.save(makeSnippet());
    store.save(makeSnippet({ name: 'Updated name' }));
    const all = store.getAll();
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].name, 'Updated name');
  });

  it('should delete a snippet by ID', () => {
    store.save(makeSnippet({ id: 'a' }));
    store.save(makeSnippet({ id: 'b', name: 'Second' }));
    store.delete('a');
    const all = store.getAll();
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].id, 'b');
  });

  it('should search by name, SQL, and description', () => {
    store.save(makeSnippet({ id: 'a', name: 'Find orphans' }));
    store.save(makeSnippet({
      id: 'b', name: 'Row count',
      sql: 'SELECT COUNT(*) FROM "orders"',
    }));
    store.save(makeSnippet({
      id: 'c', name: 'Other',
      description: 'checks for orphaned records',
    }));

    const byName = store.search('orphan');
    assert.strictEqual(byName.length, 2);

    const bySql = store.search('orders');
    assert.strictEqual(bySql.length, 1);
    assert.strictEqual(bySql[0].id, 'b');

    const byDesc = store.search('orphaned records');
    assert.strictEqual(byDesc.length, 1);
    assert.strictEqual(byDesc[0].id, 'c');
  });

  it('should export valid JSON with $schema', () => {
    store.save(makeSnippet());
    const json = store.exportAll();
    const parsed = JSON.parse(json);
    assert.strictEqual(parsed.$schema, 'drift-snippets/v1');
    assert.strictEqual(parsed.snippets.length, 1);
  });

  it('should import only new snippets (no duplicates)', () => {
    store.save(makeSnippet({ id: 'existing' }));
    const json = JSON.stringify({
      $schema: 'drift-snippets/v1',
      snippets: [
        makeSnippet({ id: 'existing', name: 'Dupe' }),
        makeSnippet({ id: 'new-one', name: 'Fresh' }),
      ],
    });
    const added = store.importFrom(json);
    assert.strictEqual(added, 1);
    assert.strictEqual(store.getAll().length, 2);
    assert.strictEqual(
      store.getAll().find((s) => s.id === 'existing')?.name,
      'Test snippet',
    );
  });

  it('should compute categories from all snippets', () => {
    store.save(makeSnippet({ id: 'a', category: 'Debugging' }));
    store.save(makeSnippet({ id: 'b', category: 'Basics' }));
    store.save(makeSnippet({ id: 'c', category: 'Debugging' }));
    const cats = store.getCategories();
    assert.deepStrictEqual(cats, ['Basics', 'Debugging']);
  });

  it('should reject import with wrong schema', () => {
    const json = JSON.stringify({ $schema: 'wrong', snippets: [] });
    assert.throws(() => store.importFrom(json), /drift-snippets\/v1/);
  });
});
