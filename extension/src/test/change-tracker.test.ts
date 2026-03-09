import * as assert from 'assert';
import { ChangeTracker, describeChange, PendingChange } from '../editing/change-tracker';
import { MockOutputChannel } from './vscode-mock';

describe('ChangeTracker', () => {
  let tracker: ChangeTracker;
  let channel: MockOutputChannel;

  beforeEach(() => {
    channel = new MockOutputChannel();
    tracker = new ChangeTracker(channel as never);
  });

  afterEach(() => {
    tracker.dispose();
  });

  it('should start empty', () => {
    assert.strictEqual(tracker.changeCount, 0);
    assert.deepStrictEqual([...tracker.changes], []);
  });

  it('should add a cell change', () => {
    tracker.addCellChange({
      table: 'users',
      pkColumn: 'id',
      pkValue: 42,
      column: 'name',
      oldValue: 'Alice',
      newValue: 'Alice Smith',
    });
    assert.strictEqual(tracker.changeCount, 1);
    const c = tracker.changes[0];
    assert.strictEqual(c.kind, 'cell');
    if (c.kind === 'cell') {
      assert.strictEqual(c.table, 'users');
      assert.strictEqual(c.column, 'name');
      assert.strictEqual(c.newValue, 'Alice Smith');
    }
  });

  it('should merge cell changes for the same cell', () => {
    tracker.addCellChange({
      table: 'users', pkColumn: 'id', pkValue: 42,
      column: 'name', oldValue: 'Alice', newValue: 'Bob',
    });
    tracker.addCellChange({
      table: 'users', pkColumn: 'id', pkValue: 42,
      column: 'name', oldValue: 'Bob', newValue: 'Charlie',
    });
    assert.strictEqual(tracker.changeCount, 1);
    const c = tracker.changes[0] as Extract<PendingChange, { kind: 'cell' }>;
    assert.strictEqual(c.newValue, 'Charlie');
  });

  it('should not merge changes for different cells', () => {
    tracker.addCellChange({
      table: 'users', pkColumn: 'id', pkValue: 42,
      column: 'name', oldValue: 'Alice', newValue: 'Bob',
    });
    tracker.addCellChange({
      table: 'users', pkColumn: 'id', pkValue: 42,
      column: 'email', oldValue: 'a@b.c', newValue: 'x@y.z',
    });
    assert.strictEqual(tracker.changeCount, 2);
  });

  it('should add a row insert', () => {
    tracker.addRowInsert('users', { name: 'New', email: 'n@x.com' });
    assert.strictEqual(tracker.changeCount, 1);
    const c = tracker.changes[0];
    assert.strictEqual(c.kind, 'insert');
  });

  it('should add a row delete', () => {
    tracker.addRowDelete('users', 'id', 99);
    assert.strictEqual(tracker.changeCount, 1);
    const c = tracker.changes[0];
    assert.strictEqual(c.kind, 'delete');
    if (c.kind === 'delete') {
      assert.strictEqual(c.pkValue, 99);
    }
  });

  it('should undo the last change', () => {
    tracker.addCellChange({
      table: 'users', pkColumn: 'id', pkValue: 1,
      column: 'name', oldValue: 'A', newValue: 'B',
    });
    tracker.addRowDelete('users', 'id', 2);
    assert.strictEqual(tracker.changeCount, 2);

    tracker.undo();
    assert.strictEqual(tracker.changeCount, 1);
    assert.strictEqual(tracker.changes[0].kind, 'cell');
  });

  it('should redo after undo', () => {
    tracker.addCellChange({
      table: 'users', pkColumn: 'id', pkValue: 1,
      column: 'name', oldValue: 'A', newValue: 'B',
    });
    tracker.undo();
    assert.strictEqual(tracker.changeCount, 0);

    tracker.redo();
    assert.strictEqual(tracker.changeCount, 1);
  });

  it('should clear redo stack on new change', () => {
    tracker.addCellChange({
      table: 'users', pkColumn: 'id', pkValue: 1,
      column: 'name', oldValue: 'A', newValue: 'B',
    });
    tracker.undo();
    assert.ok(tracker.canRedo);

    tracker.addRowDelete('users', 'id', 3);
    assert.ok(!tracker.canRedo);
  });

  it('should discard all changes', () => {
    tracker.addCellChange({
      table: 'users', pkColumn: 'id', pkValue: 1,
      column: 'name', oldValue: 'A', newValue: 'B',
    });
    tracker.addRowDelete('users', 'id', 2);
    tracker.discardAll();
    assert.strictEqual(tracker.changeCount, 0);
  });

  it('should allow undo after discard', () => {
    tracker.addCellChange({
      table: 'users', pkColumn: 'id', pkValue: 1,
      column: 'name', oldValue: 'A', newValue: 'B',
    });
    tracker.discardAll();
    tracker.undo();
    assert.strictEqual(tracker.changeCount, 1);
  });

  it('should remove a single change by id', () => {
    tracker.addCellChange({
      table: 'users', pkColumn: 'id', pkValue: 1,
      column: 'name', oldValue: 'A', newValue: 'B',
    });
    tracker.addRowDelete('users', 'id', 2);
    const id = tracker.changes[0].id;
    tracker.removeChange(id);
    assert.strictEqual(tracker.changeCount, 1);
    assert.strictEqual(tracker.changes[0].kind, 'delete');
  });

  it('should not crash on removing nonexistent id', () => {
    tracker.removeChange('nonexistent');
    assert.strictEqual(tracker.changeCount, 0);
  });

  it('should fire onDidChange for each mutation', () => {
    let fireCount = 0;
    tracker.onDidChange(() => fireCount++);

    tracker.addCellChange({
      table: 'users', pkColumn: 'id', pkValue: 1,
      column: 'name', oldValue: 'A', newValue: 'B',
    });
    tracker.addRowDelete('users', 'id', 2);
    tracker.undo();
    tracker.redo();
    tracker.discardAll();

    assert.strictEqual(fireCount, 5);
  });

  it('should log every mutation to the output channel', () => {
    tracker.addCellChange({
      table: 'users', pkColumn: 'id', pkValue: 42,
      column: 'name', oldValue: 'Alice', newValue: 'Bob',
    });
    tracker.addRowInsert('posts', { title: 'Hello' });
    tracker.addRowDelete('users', 'id', 99);
    tracker.undo();
    tracker.redo();
    tracker.discardAll();
    tracker.logGenerateSql();

    assert.strictEqual(channel.lines.length, 7);
    assert.ok(channel.lines[0].includes('EDIT users.name'));
    assert.ok(channel.lines[1].includes('INSERT posts'));
    assert.ok(channel.lines[2].includes('DELETE users'));
    assert.ok(channel.lines[3].includes('UNDO'));
    assert.ok(channel.lines[4].includes('REDO'));
    assert.ok(channel.lines[5].includes('DISCARD ALL'));
    assert.ok(channel.lines[6].includes('GENERATE SQL'));
  });

  it('should not fire on empty discard', () => {
    let fired = false;
    tracker.onDidChange(() => { fired = true; });
    tracker.discardAll();
    assert.ok(!fired);
  });

  it('should not fire on undo with empty stack', () => {
    let fired = false;
    tracker.onDidChange(() => { fired = true; });
    tracker.undo();
    assert.ok(!fired);
  });
});

describe('describeChange', () => {
  it('should describe a cell change', () => {
    const desc = describeChange({
      kind: 'cell', id: '1', table: 'users', pkColumn: 'id',
      pkValue: 42, column: 'name', oldValue: 'Alice',
      newValue: 'Bob', timestamp: 0,
    });
    assert.ok(desc.includes('users.name'));
    assert.ok(desc.includes('"Alice"'));
    assert.ok(desc.includes('"Bob"'));
  });

  it('should describe a row insert', () => {
    const desc = describeChange({
      kind: 'insert', id: '2', table: 'posts',
      values: { title: 'Hello' }, timestamp: 0,
    });
    assert.ok(desc.includes('INSERT posts'));
    assert.ok(desc.includes('title: "Hello"'));
  });

  it('should describe a row delete', () => {
    const desc = describeChange({
      kind: 'delete', id: '3', table: 'users',
      pkColumn: 'id', pkValue: 99, timestamp: 0,
    });
    assert.ok(desc.includes('DELETE users'));
    assert.ok(desc.includes('99'));
  });

  it('should handle NULL values', () => {
    const desc = describeChange({
      kind: 'cell', id: '4', table: 't', pkColumn: 'id',
      pkValue: 1, column: 'c', oldValue: null,
      newValue: 'val', timestamp: 0,
    });
    assert.ok(desc.includes('NULL'));
  });
});
