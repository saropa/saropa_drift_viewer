import * as assert from 'assert';
import * as sinon from 'sinon';
import { DriftApiClient } from '../api-client';
import { SchemaTracker } from '../schema-timeline/schema-tracker';
import { diffSchemaSnapshots } from '../schema-timeline/schema-differ';
import type { ISchemaSnapshot } from '../schema-timeline/schema-timeline-types';

// ---- Helpers ----

function makeResponse(body: unknown): Response {
  return {
    ok: true, status: 200, json: async () => body,
  } as unknown as Response;
}

function diagramJson(
  tables: { name: string; columns: { name: string; type: string; pk: number }[] }[] = [],
  foreignKeys: { fromTable: string; fromColumn: string; toTable: string; toColumn: string }[] = [],
) {
  return { tables, foreignKeys };
}

function snap(
  generation: number,
  tables: ISchemaSnapshot['tables'] = [],
  timestamp = '2026-01-01T00:00:00.000Z',
): ISchemaSnapshot {
  return { generation, timestamp, tables };
}

function col(name: string, type = 'TEXT', pk = false) {
  return { name, type, pk };
}

function fk(fromColumn: string, toTable: string, toColumn: string) {
  return { fromColumn, toTable, toColumn };
}

// ---- SchemaTracker tests ----

describe('SchemaTracker', () => {
  let fetchStub: sinon.SinonStub;
  let client: DriftApiClient;
  let state: { data: Record<string, unknown>; get: <T>(k: string, d: T) => T; update: (k: string, v: unknown) => void };

  beforeEach(() => {
    fetchStub = sinon.stub(globalThis, 'fetch');
    client = new DriftApiClient('127.0.0.1', 8642);
    state = {
      data: {},
      get<T>(key: string, defaultValue: T): T {
        return (this.data[key] as T) ?? defaultValue;
      },
      update(key: string, value: unknown) {
        this.data[key] = value;
      },
    };
  });

  afterEach(() => {
    fetchStub.restore();
  });

  function stubDiagram(
    tables = [{ name: 'users', columns: [{ name: 'id', type: 'INTEGER', pk: 1 }] }],
    foreignKeys: { fromTable: string; fromColumn: string; toTable: string; toColumn: string }[] = [],
  ): void {
    fetchStub.withArgs(sinon.match(/schema\/diagram/))
      .callsFake(async () => makeResponse(diagramJson(tables, foreignKeys)));
  }

  function makeWatcher() {
    const listeners: (() => void)[] = [];
    return {
      generation: 1,
      onDidChange(fn: () => void) {
        listeners.push(fn);
        return { dispose: () => { /* noop */ } };
      },
      fire() { for (const fn of listeners) fn(); },
    };
  }

  it('captures snapshot on generation change', async () => {
    stubDiagram();
    const watcher = makeWatcher();
    const tracker = new SchemaTracker(
      client, state as never, watcher as never,
    );
    watcher.fire();
    await new Promise((r) => setTimeout(r, 50));

    assert.strictEqual(tracker.getAll().length, 1);
    assert.strictEqual(tracker.getAll()[0].generation, 1);
    tracker.dispose();
  });

  it('persists snapshots in workspace state', async () => {
    stubDiagram();
    const watcher = makeWatcher();
    const tracker = new SchemaTracker(
      client, state as never, watcher as never,
    );
    watcher.fire();
    await new Promise((r) => setTimeout(r, 50));

    const stored = state.data['schema.timeline'] as ISchemaSnapshot[];
    assert.strictEqual(stored.length, 1);
    tracker.dispose();
  });

  it('limits snapshots to 100', async () => {
    // Pre-fill state with 100 snapshots
    const existing = Array.from({ length: 100 }, (_, i) => snap(i));
    state.data['schema.timeline'] = existing;

    stubDiagram();
    const watcher = makeWatcher();
    watcher.generation = 100;
    const tracker = new SchemaTracker(
      client, state as never, watcher as never,
    );
    watcher.fire();
    await new Promise((r) => setTimeout(r, 50));

    assert.strictEqual(tracker.getAll().length, 100);
    assert.strictEqual(tracker.getAll()[0].generation, 1);
    tracker.dispose();
  });

  it('skips sqlite_ system tables', async () => {
    stubDiagram([
      { name: 'users', columns: [{ name: 'id', type: 'INTEGER', pk: 1 }] },
      { name: 'sqlite_stat1', columns: [{ name: 'tbl', type: 'TEXT', pk: 0 }] },
    ]);
    const watcher = makeWatcher();
    const tracker = new SchemaTracker(
      client, state as never, watcher as never,
    );
    watcher.fire();
    await new Promise((r) => setTimeout(r, 50));

    const tables = tracker.getAll()[0].tables;
    assert.strictEqual(tables.length, 1);
    assert.strictEqual(tables[0].name, 'users');
    tracker.dispose();
  });

  it('fires onDidUpdate event', async () => {
    stubDiagram();
    const watcher = makeWatcher();
    const tracker = new SchemaTracker(
      client, state as never, watcher as never,
    );

    let fired = false;
    tracker.onDidUpdate(() => { fired = true; });
    watcher.fire();
    await new Promise((r) => setTimeout(r, 50));

    assert.strictEqual(fired, true);
    tracker.dispose();
  });

  it('clears all snapshots', async () => {
    stubDiagram();
    const watcher = makeWatcher();
    const tracker = new SchemaTracker(
      client, state as never, watcher as never,
    );
    watcher.fire();
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(tracker.getAll().length, 1);

    tracker.clear();
    assert.strictEqual(tracker.getAll().length, 0);
    assert.deepStrictEqual(state.data['schema.timeline'], []);
    tracker.dispose();
  });

  it('captures foreign keys per table', async () => {
    stubDiagram(
      [
        { name: 'orders', columns: [{ name: 'id', type: 'INTEGER', pk: 1 }, { name: 'user_id', type: 'INTEGER', pk: 0 }] },
        { name: 'users', columns: [{ name: 'id', type: 'INTEGER', pk: 1 }] },
      ],
      [{ fromTable: 'orders', fromColumn: 'user_id', toTable: 'users', toColumn: 'id' }],
    );
    const watcher = makeWatcher();
    const tracker = new SchemaTracker(
      client, state as never, watcher as never,
    );
    watcher.fire();
    await new Promise((r) => setTimeout(r, 50));

    const orders = tracker.getAll()[0].tables.find((t) => t.name === 'orders');
    assert.ok(orders);
    assert.strictEqual(orders.fks.length, 1);
    assert.strictEqual(orders.fks[0].toTable, 'users');
    tracker.dispose();
  });
});

// ---- diffSchemaSnapshots tests ----

describe('diffSchemaSnapshots', () => {
  it('detects added tables', () => {
    const before = snap(1, []);
    const after = snap(2, [{ name: 'users', columns: [col('id')], fks: [] }]);
    const changes = diffSchemaSnapshots(before, after);

    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].type, 'table_added');
    assert.strictEqual(changes[0].table, 'users');
  });

  it('detects dropped tables', () => {
    const before = snap(1, [{ name: 'old', columns: [col('id')], fks: [] }]);
    const after = snap(2, []);
    const changes = diffSchemaSnapshots(before, after);

    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].type, 'table_dropped');
    assert.strictEqual(changes[0].table, 'old');
  });

  it('detects added columns', () => {
    const before = snap(1, [{ name: 't', columns: [col('id')], fks: [] }]);
    const after = snap(2, [{ name: 't', columns: [col('id'), col('name')], fks: [] }]);
    const changes = diffSchemaSnapshots(before, after);

    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].type, 'column_added');
    assert.ok(changes[0].detail.includes('name'));
  });

  it('detects removed columns', () => {
    const before = snap(1, [{ name: 't', columns: [col('id'), col('age')], fks: [] }]);
    const after = snap(2, [{ name: 't', columns: [col('id')], fks: [] }]);
    const changes = diffSchemaSnapshots(before, after);

    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].type, 'column_removed');
    assert.ok(changes[0].detail.includes('age'));
  });

  it('detects column type changes', () => {
    const before = snap(1, [{ name: 't', columns: [col('total', 'REAL')], fks: [] }]);
    const after = snap(2, [{ name: 't', columns: [col('total', 'TEXT')], fks: [] }]);
    const changes = diffSchemaSnapshots(before, after);

    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].type, 'column_type_changed');
    assert.ok(changes[0].detail.includes('REAL'));
    assert.ok(changes[0].detail.includes('TEXT'));
  });

  it('detects FK additions', () => {
    const before = snap(1, [{ name: 'orders', columns: [col('user_id')], fks: [] }]);
    const after = snap(2, [
      { name: 'orders', columns: [col('user_id')], fks: [fk('user_id', 'users', 'id')] },
    ]);
    const changes = diffSchemaSnapshots(before, after);

    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].type, 'fk_added');
  });

  it('detects FK removals', () => {
    const before = snap(1, [
      { name: 'orders', columns: [col('user_id')], fks: [fk('user_id', 'users', 'id')] },
    ]);
    const after = snap(2, [{ name: 'orders', columns: [col('user_id')], fks: [] }]);
    const changes = diffSchemaSnapshots(before, after);

    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].type, 'fk_removed');
  });

  it('returns empty array for identical schemas', () => {
    const tables = [{ name: 't', columns: [col('id')], fks: [] }];
    const changes = diffSchemaSnapshots(snap(1, tables), snap(2, tables));
    assert.strictEqual(changes.length, 0);
  });

  it('returns empty array when both snapshots have no tables', () => {
    const changes = diffSchemaSnapshots(snap(1), snap(2));
    assert.strictEqual(changes.length, 0);
  });
});
