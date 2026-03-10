import * as assert from 'assert';
import { ChangelogGenerator } from '../changelog/changelog-generator';
import type { ISnapshotRef } from '../changelog/changelog-types';
import type { ISnapshotTable } from '../timeline/snapshot-store';

const REF_A: ISnapshotRef = { name: 'snap-a', timestamp: '2026-03-10 10:00' };
const REF_B: ISnapshotRef = { name: 'snap-b', timestamp: '2026-03-10 10:15' };

function table(
  rows: Record<string, unknown>[],
  pk: string[] = ['id'],
  cols?: string[],
): ISnapshotTable {
  const columns = cols ?? (rows.length > 0 ? Object.keys(rows[0]) : []);
  return { rowCount: rows.length, columns, pkColumns: pk, rows };
}

function gen(
  fromTables: Map<string, ISnapshotTable>,
  toTables: Map<string, ISnapshotTable>,
) {
  return new ChangelogGenerator().generate(REF_A, REF_B, fromTables, toTables);
}

describe('ChangelogGenerator', () => {
  it('should return empty changelog when no tables exist', () => {
    const result = gen(new Map(), new Map());
    assert.strictEqual(result.entries.length, 0);
    assert.strictEqual(result.summary.totalInserts, 0);
    assert.strictEqual(result.summary.totalUpdates, 0);
    assert.strictEqual(result.summary.totalDeletes, 0);
    assert.strictEqual(result.summary.tablesChanged, 0);
    assert.strictEqual(result.summary.tablesUnchanged, 0);
  });

  it('should detect no changes for identical snapshots', () => {
    const t = table([{ id: 1, name: 'Alice' }]);
    const result = gen(
      new Map([['users', t]]),
      new Map([['users', t]]),
    );
    assert.strictEqual(result.entries.length, 0);
    assert.strictEqual(result.unchangedTables.length, 1);
    assert.strictEqual(result.unchangedTables[0], 'users');
    assert.strictEqual(result.summary.tablesUnchanged, 1);
  });

  it('should detect inserts only', () => {
    const from = table([{ id: 1, name: 'Alice' }]);
    const to = table([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ]);
    const result = gen(
      new Map([['users', from]]),
      new Map([['users', to]]),
    );

    assert.strictEqual(result.entries.length, 1);
    assert.strictEqual(result.entries[0].inserts.length, 1);
    assert.strictEqual(result.entries[0].inserts[0].pk, 2);
    assert.strictEqual(result.entries[0].updates.length, 0);
    assert.strictEqual(result.entries[0].deletes.length, 0);
    assert.strictEqual(result.summary.totalInserts, 1);
  });

  it('should detect deletes only', () => {
    const from = table([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ]);
    const to = table([{ id: 1, name: 'Alice' }]);
    const result = gen(
      new Map([['users', from]]),
      new Map([['users', to]]),
    );

    assert.strictEqual(result.entries.length, 1);
    assert.strictEqual(result.entries[0].deletes.length, 1);
    assert.strictEqual(result.entries[0].deletes[0].pk, 2);
    assert.strictEqual(result.summary.totalDeletes, 1);
  });

  it('should detect updates only', () => {
    const from = table([{ id: 1, name: 'Alice', role: 'user' }]);
    const to = table([{ id: 1, name: 'Alice Smith', role: 'admin' }]);
    const result = gen(
      new Map([['users', from]]),
      new Map([['users', to]]),
    );

    assert.strictEqual(result.entries.length, 1);
    const updates = result.entries[0].updates;
    assert.strictEqual(updates.length, 1);
    assert.strictEqual(updates[0].pk, 1);
    assert.strictEqual(updates[0].changes.length, 2);

    const nameChange = updates[0].changes.find((c) => c.column === 'name');
    assert.strictEqual(nameChange?.oldValue, 'Alice');
    assert.strictEqual(nameChange?.newValue, 'Alice Smith');
  });

  it('should detect mixed changes across tables', () => {
    const fromUsers = table([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ]);
    const toUsers = table([
      { id: 1, name: 'Alice Updated' },
      { id: 3, name: 'Charlie' },
    ]);
    const fromOrders = table([{ id: 10, total: 50 }]);
    const toOrders = table([{ id: 10, total: 50 }]);

    const result = gen(
      new Map([['users', fromUsers], ['orders', fromOrders]]),
      new Map([['users', toUsers], ['orders', toOrders]]),
    );

    assert.strictEqual(result.entries.length, 1); // only users changed
    assert.strictEqual(result.unchangedTables.length, 1);
    assert.strictEqual(result.unchangedTables[0], 'orders');

    const users = result.entries[0];
    assert.strictEqual(users.inserts.length, 1); // Charlie
    assert.strictEqual(users.updates.length, 1); // Alice Updated
    assert.strictEqual(users.deletes.length, 1); // Bob
  });

  it('should handle non-id PK columns', () => {
    const from = table(
      [{ code: 'A1', label: 'Alpha' }],
      ['code'],
    );
    const to = table(
      [{ code: 'A1', label: 'Alpha Updated' }],
      ['code'],
    );
    const result = gen(
      new Map([['items', from]]),
      new Map([['items', to]]),
    );

    assert.strictEqual(result.entries[0].updates.length, 1);
    assert.strictEqual(result.entries[0].updates[0].pk, 'A1');
  });

  it('should skip sqlite_ tables', () => {
    const t = table([{ id: 1 }]);
    const result = gen(
      new Map([['sqlite_stat1', t], ['users', t]]),
      new Map([['sqlite_stat1', t], ['users', t]]),
    );
    // sqlite_ table is silently excluded
    assert.strictEqual(result.unchangedTables.length, 1);
    assert.strictEqual(result.unchangedTables[0], 'users');
  });

  it('should detect entire table added', () => {
    const to = table([{ id: 1, name: 'New' }]);
    const result = gen(
      new Map(),
      new Map([['newtable', to]]),
    );

    assert.strictEqual(result.entries.length, 1);
    assert.strictEqual(result.entries[0].inserts.length, 1);
    assert.strictEqual(result.summary.totalInserts, 1);
  });

  it('should detect entire table removed', () => {
    const from = table([{ id: 1, name: 'Old' }]);
    const result = gen(
      new Map([['oldtable', from]]),
      new Map(),
    );

    assert.strictEqual(result.entries.length, 1);
    assert.strictEqual(result.entries[0].deletes.length, 1);
    assert.strictEqual(result.summary.totalDeletes, 1);
  });

  it('should handle empty tables in both snapshots', () => {
    const t = table([], ['id'], ['id', 'name']);
    const result = gen(
      new Map([['empty', t]]),
      new Map([['empty', t]]),
    );
    assert.strictEqual(result.entries.length, 0);
    assert.strictEqual(result.unchangedTables.length, 1);
  });

  it('should include preview columns in inserts', () => {
    const to = table([{ id: 1, name: 'Alice', email: 'a@b.c', role: 'admin' }]);
    const result = gen(
      new Map([['users', table([])]]),
      new Map([['users', to]]),
    );

    const preview = result.entries[0].inserts[0].preview;
    assert.strictEqual(preview['name'], 'Alice');
    assert.strictEqual(preview['email'], 'a@b.c');
  });

  it('should preserve snapshot refs', () => {
    const result = gen(new Map(), new Map());
    assert.deepStrictEqual(result.fromSnapshot, REF_A);
    assert.deepStrictEqual(result.toSnapshot, REF_B);
  });

  it('should handle composite primary keys', () => {
    const from = table(
      [{ a: 1, b: 'x', val: 'old' }],
      ['a', 'b'],
    );
    const to = table(
      [{ a: 1, b: 'x', val: 'new' }],
      ['a', 'b'],
    );
    const result = gen(
      new Map([['multi', from]]),
      new Map([['multi', to]]),
    );

    assert.strictEqual(result.entries[0].updates.length, 1);
    assert.deepStrictEqual(result.entries[0].updates[0].pk, [1, 'x']);
  });

  it('should treat no-PK rows as insert+delete on change', () => {
    const from = table([{ name: 'Alice', age: 30 }], []);
    const to = table([{ name: 'Alice', age: 31 }], []);
    const result = gen(
      new Map([['nopk', from]]),
      new Map([['nopk', to]]),
    );

    // No PK means full-row signature keying: changed row = delete + insert
    assert.strictEqual(result.entries[0].inserts.length, 1);
    assert.strictEqual(result.entries[0].deletes.length, 1);
    assert.strictEqual(result.entries[0].updates.length, 0);
  });

  it('should limit preview to 5 columns for full-table add', () => {
    const to = table(
      [{ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 }],
      ['a'],
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    );
    const result = gen(new Map(), new Map([['wide', to]]));

    const preview = result.entries[0].inserts[0].preview;
    assert.strictEqual(Object.keys(preview).length, 5);
    assert.strictEqual('f' in preview, false);
  });
});
