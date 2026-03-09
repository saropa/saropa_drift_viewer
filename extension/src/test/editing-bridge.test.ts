import * as assert from 'assert';
import { ChangeTracker } from '../editing/change-tracker';
import { EditingBridge } from '../editing/editing-bridge';
import { MockOutputChannel } from './vscode-mock';

describe('EditingBridge', () => {
  let tracker: ChangeTracker;
  let bridge: EditingBridge;

  beforeEach(() => {
    tracker = new ChangeTracker(new MockOutputChannel() as never);
    bridge = new EditingBridge(tracker);
  });

  afterEach(() => {
    bridge.dispose();
    tracker.dispose();
  });

  it('should handle cellEdit messages', () => {
    const handled = bridge.handleMessage({
      command: 'cellEdit',
      table: 'users',
      pkColumn: 'id',
      pkValue: 42,
      column: 'name',
      oldValue: 'Alice',
      newValue: 'Bob',
    });
    assert.ok(handled);
    assert.strictEqual(tracker.changeCount, 1);
    assert.strictEqual(tracker.changes[0].kind, 'cell');
  });

  it('should handle rowDelete messages', () => {
    const handled = bridge.handleMessage({
      command: 'rowDelete',
      table: 'users',
      pkColumn: 'id',
      pkValue: 99,
    });
    assert.ok(handled);
    assert.strictEqual(tracker.changeCount, 1);
    assert.strictEqual(tracker.changes[0].kind, 'delete');
  });

  it('should handle rowInsert messages', () => {
    const handled = bridge.handleMessage({
      command: 'rowInsert',
      table: 'posts',
      values: { title: 'Hello' },
    });
    assert.ok(handled);
    assert.strictEqual(tracker.changeCount, 1);
    assert.strictEqual(tracker.changes[0].kind, 'insert');
  });

  it('should handle undo messages', () => {
    tracker.addRowDelete('users', 'id', 1);
    bridge.handleMessage({ command: 'undo' });
    assert.strictEqual(tracker.changeCount, 0);
  });

  it('should handle redo messages', () => {
    tracker.addRowDelete('users', 'id', 1);
    tracker.undo();
    bridge.handleMessage({ command: 'redo' });
    assert.strictEqual(tracker.changeCount, 1);
  });

  it('should handle discardAll messages', () => {
    tracker.addRowDelete('users', 'id', 1);
    bridge.handleMessage({ command: 'discardAll' });
    assert.strictEqual(tracker.changeCount, 0);
  });

  it('should return false for unknown messages', () => {
    assert.ok(!bridge.handleMessage({ command: 'retry' }));
    assert.ok(!bridge.handleMessage({ command: 'unknown' }));
    assert.ok(!bridge.handleMessage(null));
    assert.ok(!bridge.handleMessage('not an object'));
    assert.ok(!bridge.handleMessage(42));
  });

  it('should sync state to attached webview', () => {
    const posted: unknown[] = [];
    const fakeWebview = {
      postMessage: (msg: unknown) => { posted.push(msg); },
    };
    bridge.attach(fakeWebview as never);

    tracker.addRowDelete('users', 'id', 1);

    assert.strictEqual(posted.length, 1);
    const msg = posted[0] as { command: string; changes: unknown[] };
    assert.strictEqual(msg.command, 'pendingChanges');
    assert.strictEqual(msg.changes.length, 1);
  });

  it('should not sync when no webview attached', () => {
    // Should not throw
    tracker.addRowDelete('users', 'id', 1);
    assert.strictEqual(tracker.changeCount, 1);
  });

  it('should stop syncing after detach', () => {
    const posted: unknown[] = [];
    const fakeWebview = {
      postMessage: (msg: unknown) => { posted.push(msg); },
    };
    bridge.attach(fakeWebview as never);
    bridge.detach();

    tracker.addRowDelete('users', 'id', 1);
    assert.strictEqual(posted.length, 0);
  });

  it('should provide injected script as non-empty string', () => {
    const script = EditingBridge.injectedScript();
    assert.ok(typeof script === 'string');
    assert.ok(script.length > 100);
    assert.ok(script.includes('acquireVsCodeApi'));
    assert.ok(script.includes('cellEdit'));
  });
});
