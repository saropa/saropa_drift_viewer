import * as assert from 'assert';
import * as sinon from 'sinon';
import { DriftApiClient } from '../api-client';
import {
  SnapshotStore,
  computeTableDiff,
  rowsToObjects,
} from '../timeline/snapshot-store';

function makeResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function metadataJson(tables = [
  { name: 'users', rowCount: 3, columns: [{ name: 'id', type: 'INTEGER', pk: true }, { name: 'name', type: 'TEXT', pk: false }] },
]) {
  return tables;
}

function sqlJson(columns: string[], rows: unknown[][]) {
  return { columns, rows };
}

describe('SnapshotStore', () => {
  let fetchStub: sinon.SinonStub;
  let clock: sinon.SinonFakeTimers;
  let client: DriftApiClient;

  beforeEach(() => {
    fetchStub = sinon.stub(globalThis, 'fetch');
    clock = sinon.useFakeTimers({ now: 1000000 });
    client = new DriftApiClient('127.0.0.1', 8642);
  });

  afterEach(() => {
    fetchStub.restore();
    clock.restore();
  });

  function stubCapture(): void {
    fetchStub.withArgs(sinon.match(/schema\/metadata/)).callsFake(async () =>
      makeResponse(metadataJson()),
    );
    fetchStub.withArgs(sinon.match(/api\/sql/)).callsFake(async () =>
      makeResponse(sqlJson(['id', 'name'], [[1, 'Alice'], [2, 'Bob'], [3, 'Carol']])),
    );
  }

  describe('capture()', () => {
    it('should store a snapshot with correct structure', async () => {
      stubCapture();
      const store = new SnapshotStore(20, 0);
      const snap = await store.capture(client);
      assert.ok(snap);
      assert.strictEqual(store.snapshots.length, 1);
      const t = snap.tables.get('users');
      assert.ok(t);
      assert.strictEqual(t.rowCount, 3);
      assert.deepStrictEqual(t.columns, ['id', 'name']);
      assert.deepStrictEqual(t.pkColumns, ['id']);
      assert.strictEqual(t.rows.length, 3);
      assert.deepStrictEqual(t.rows[0], { id: 1, name: 'Alice' });
    });

    it('should enforce maxSnapshots rolling window', async () => {
      stubCapture();
      const store = new SnapshotStore(2, 0);
      await store.capture(client);
      clock.tick(1);
      await store.capture(client);
      clock.tick(1);
      await store.capture(client);
      assert.strictEqual(store.snapshots.length, 2);
    });

    it('should fire onDidChange after capture', async () => {
      stubCapture();
      const store = new SnapshotStore(20, 0);
      let fired = false;
      store.onDidChange(() => { fired = true; });
      await store.capture(client);
      assert.strictEqual(fired, true);
    });

    it('should debounce captures within minIntervalMs', async () => {
      stubCapture();
      const store = new SnapshotStore(20, 5000);
      const snap1 = await store.capture(client);
      assert.ok(snap1);
      const snap2 = await store.capture(client);
      assert.strictEqual(snap2, null);
      clock.tick(5000);
      const snap3 = await store.capture(client);
      assert.ok(snap3);
      assert.strictEqual(store.snapshots.length, 2);
    });

    it('should return null on API failure', async () => {
      fetchStub.rejects(new Error('network error'));
      const store = new SnapshotStore(20, 0);
      const snap = await store.capture(client);
      assert.strictEqual(snap, null);
    });
  });

  describe('getById()', () => {
    it('should return snapshot by id', async () => {
      stubCapture();
      const store = new SnapshotStore(20, 0);
      const snap = await store.capture(client);
      assert.ok(snap);
      assert.strictEqual(store.getById(snap.id), snap);
    });

    it('should return undefined for unknown id', () => {
      const store = new SnapshotStore();
      assert.strictEqual(store.getById('nope'), undefined);
    });
  });

  describe('getNewerSnapshot()', () => {
    it('should return the next snapshot in sequence', async () => {
      stubCapture();
      const store = new SnapshotStore(20, 0);
      const snap1 = await store.capture(client);
      clock.tick(1);
      const snap2 = await store.capture(client);
      assert.ok(snap1 && snap2);
      assert.strictEqual(store.getNewerSnapshot(snap1), snap2);
    });

    it('should return undefined for the latest snapshot', async () => {
      stubCapture();
      const store = new SnapshotStore(20, 0);
      const snap = await store.capture(client);
      assert.ok(snap);
      assert.strictEqual(store.getNewerSnapshot(snap), undefined);
    });
  });

  describe('clear()', () => {
    it('should remove all snapshots and fire event', async () => {
      stubCapture();
      const store = new SnapshotStore(20, 0);
      await store.capture(client);
      let fired = false;
      store.onDidChange(() => { fired = true; });
      store.clear();
      assert.strictEqual(store.snapshots.length, 0);
      assert.strictEqual(fired, true);
    });
  });
});

describe('rowsToObjects', () => {
  it('should convert array rows to keyed objects', () => {
    const result = rowsToObjects(['a', 'b'], [[1, 2], [3, 4]]);
    assert.deepStrictEqual(result, [{ a: 1, b: 2 }, { a: 3, b: 4 }]);
  });
});

describe('computeTableDiff', () => {
  it('should identify added rows by PK', () => {
    const diff = computeTableDiff(
      'users', ['id', 'name'], ['id'],
      [{ id: 1, name: 'Alice' }],
      [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
      1, 2,
    );
    assert.strictEqual(diff.addedRows.length, 1);
    assert.deepStrictEqual(diff.addedRows[0], { id: 2, name: 'Bob' });
    assert.strictEqual(diff.removedRows.length, 0);
    assert.strictEqual(diff.changedRows.length, 0);
  });

  it('should identify removed rows by PK', () => {
    const diff = computeTableDiff(
      'users', ['id', 'name'], ['id'],
      [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
      [{ id: 1, name: 'Alice' }],
      2, 1,
    );
    assert.strictEqual(diff.removedRows.length, 1);
    assert.deepStrictEqual(diff.removedRows[0], { id: 2, name: 'Bob' });
  });

  it('should identify changed rows with changedColumns', () => {
    const diff = computeTableDiff(
      'users', ['id', 'name'], ['id'],
      [{ id: 1, name: 'Alice' }],
      [{ id: 1, name: 'Alicia' }],
      1, 1,
    );
    assert.strictEqual(diff.changedRows.length, 1);
    assert.deepStrictEqual(diff.changedRows[0].changedColumns, ['name']);
    assert.strictEqual(diff.changedRows[0].before.name, 'Alice');
    assert.strictEqual(diff.changedRows[0].after.name, 'Alicia');
  });

  it('should handle tables with no PK (signature mode)', () => {
    const diff = computeTableDiff(
      'logs', ['msg'], [],
      [{ msg: 'a' }, { msg: 'b' }],
      [{ msg: 'b' }, { msg: 'c' }],
      2, 2,
    );
    assert.strictEqual(diff.addedRows.length, 1);
    assert.deepStrictEqual(diff.addedRows[0], { msg: 'c' });
    assert.strictEqual(diff.removedRows.length, 1);
    assert.deepStrictEqual(diff.removedRows[0], { msg: 'a' });
    assert.strictEqual(diff.changedRows.length, 0);
  });

  it('should handle no differences', () => {
    const diff = computeTableDiff(
      'users', ['id', 'name'], ['id'],
      [{ id: 1, name: 'Alice' }],
      [{ id: 1, name: 'Alice' }],
      1, 1,
    );
    assert.strictEqual(diff.addedRows.length, 0);
    assert.strictEqual(diff.removedRows.length, 0);
    assert.strictEqual(diff.changedRows.length, 0);
  });

  it('should handle empty inputs', () => {
    const diff = computeTableDiff('t', ['id'], ['id'], [], [], 0, 0);
    assert.strictEqual(diff.addedRows.length, 0);
    assert.strictEqual(diff.removedRows.length, 0);
  });

  it('should handle duplicate rows in signature mode', () => {
    const diff = computeTableDiff(
      'logs', ['msg'], [],
      [{ msg: 'a' }, { msg: 'a' }],
      [{ msg: 'a' }],
      2, 1,
    );
    assert.strictEqual(diff.addedRows.length, 0);
    assert.strictEqual(diff.removedRows.length, 1);
  });
});
