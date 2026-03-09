import * as assert from 'assert';
import * as sinon from 'sinon';
import {
  DriftTimelineProvider,
  formatRelativeTime,
} from '../timeline/drift-timeline-provider';
import { ISnapshot, ISnapshotTable, SnapshotStore } from '../timeline/snapshot-store';
import { CancellationToken, TimelineOptions, Uri } from 'vscode';

function makeTable(rowCount: number): ISnapshotTable {
  return {
    rowCount,
    columns: ['id', 'name'],
    pkColumns: ['id'],
    rows: [],
  };
}

function makeSnapshot(id: string, timestamp: number, tables: [string, ISnapshotTable][]): ISnapshot {
  return { id, timestamp, tables: new Map(tables) };
}

describe('DriftTimelineProvider', () => {
  let store: SnapshotStore;
  let provider: DriftTimelineProvider;

  beforeEach(() => {
    store = new SnapshotStore(20, 0);
    provider = new DriftTimelineProvider(store);
  });

  afterEach(() => {
    provider.dispose();
    store.dispose();
  });

  const dummyToken = {} as CancellationToken;
  const dummyOptions = {} as TimelineOptions;

  function uri(path: string) {
    return Uri.file(path);
  }

  it('should return empty items for unknown file', async () => {
    const result = await provider.provideTimeline(
      uri('/some/other.dart'), dummyOptions, dummyToken,
    );
    assert.strictEqual(result.items.length, 0);
  });

  it('should return items for file with matching table', async () => {
    // Populate store directly
    const snap = makeSnapshot('s1', 1000, [['users', makeTable(5)]]);
    (store as any)._snapshots.push(snap);

    const tableFileMap = new Map([['users', '/project/lib/user.dart']]);
    provider.updateFileToTables(tableFileMap);

    const result = await provider.provideTimeline(
      uri('/project/lib/user.dart'), dummyOptions, dummyToken,
    );
    assert.strictEqual(result.items.length, 1);
    assert.ok(result.items[0].label.includes('users: 5 rows'));
  });

  it('should show newest snapshot first', async () => {
    (store as any)._snapshots.push(
      makeSnapshot('s1', 1000, [['users', makeTable(3)]]),
      makeSnapshot('s2', 2000, [['users', makeTable(5)]]),
    );

    provider.updateFileToTables(new Map([['users', '/lib/user.dart']]));

    const result = await provider.provideTimeline(
      uri('/lib/user.dart'), dummyOptions, dummyToken,
    );
    assert.strictEqual(result.items.length, 2);
    assert.ok(result.items[0].label.includes('5 rows'));
    assert.ok(result.items[1].label.includes('3 rows'));
  });

  it('should compute delta string correctly', async () => {
    (store as any)._snapshots.push(
      makeSnapshot('s1', 1000, [['users', makeTable(3)]]),
      makeSnapshot('s2', 2000, [['users', makeTable(5)]]),
    );

    provider.updateFileToTables(new Map([['users', '/lib/user.dart']]));

    const result = await provider.provideTimeline(
      uri('/lib/user.dart'), dummyOptions, dummyToken,
    );
    // s2 is latest, s1 is older
    assert.ok(result.items[0].label.includes('(latest)'));
    assert.ok(result.items[1].label.includes('(+2)'));
  });

  it('should set showSnapshotDiff command on each item', async () => {
    (store as any)._snapshots.push(
      makeSnapshot('s1', 1000, [['users', makeTable(3)]]),
    );

    provider.updateFileToTables(new Map([['users', '/lib/user.dart']]));

    const result = await provider.provideTimeline(
      uri('/lib/user.dart'), dummyOptions, dummyToken,
    );
    const cmd = result.items[0].command;
    assert.strictEqual(cmd?.command, 'driftViewer.showSnapshotDiff');
    assert.deepStrictEqual(cmd?.arguments, ['s1', 'users']);
  });

  it('should handle multiple tables in one file', async () => {
    (store as any)._snapshots.push(
      makeSnapshot('s1', 1000, [
        ['users', makeTable(3)],
        ['posts', makeTable(10)],
      ]),
    );

    const tableFileMap = new Map([
      ['users', '/lib/tables.dart'],
      ['posts', '/lib/tables.dart'],
    ]);
    provider.updateFileToTables(tableFileMap);

    const result = await provider.provideTimeline(
      uri('/lib/tables.dart'), dummyOptions, dummyToken,
    );
    assert.strictEqual(result.items.length, 2);
  });
});

describe('formatRelativeTime', () => {
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    clock = sinon.useFakeTimers({ now: 100_000 });
  });

  afterEach(() => {
    clock.restore();
  });

  it('should format seconds', () => {
    assert.strictEqual(formatRelativeTime(100_000 - 30_000), '30s ago');
  });

  it('should format minutes', () => {
    assert.strictEqual(formatRelativeTime(100_000 - 120_000), '2m ago');
  });

  it('should format hours', () => {
    assert.strictEqual(formatRelativeTime(100_000 - 7_200_000), '2h ago');
  });
});
