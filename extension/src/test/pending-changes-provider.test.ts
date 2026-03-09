import * as assert from 'assert';
import * as vscode from 'vscode';
import { ChangeTracker } from '../editing/change-tracker';
import {
  ChangeItem,
  PendingChangesProvider,
  TableGroupItem,
} from '../editing/pending-changes-provider';
import { MockOutputChannel } from './vscode-mock';

describe('PendingChangesProvider', () => {
  let tracker: ChangeTracker;
  let provider: PendingChangesProvider;

  beforeEach(() => {
    tracker = new ChangeTracker(new MockOutputChannel() as never);
    provider = new PendingChangesProvider(tracker);
  });

  afterEach(() => {
    tracker.dispose();
  });

  it('should return empty root when no changes', () => {
    const items = provider.getChildren();
    assert.strictEqual(items.length, 0);
  });

  it('should return table groups at root level', () => {
    tracker.addCellChange({
      table: 'users', pkColumn: 'id', pkValue: 1,
      column: 'name', oldValue: 'A', newValue: 'B',
    });
    tracker.addRowDelete('posts', 'id', 2);

    const items = provider.getChildren();
    assert.strictEqual(items.length, 2);
    assert.ok(items[0] instanceof TableGroupItem);
    assert.ok(items[1] instanceof TableGroupItem);
  });

  it('should group changes under table items', () => {
    tracker.addCellChange({
      table: 'users', pkColumn: 'id', pkValue: 1,
      column: 'name', oldValue: 'A', newValue: 'B',
    });
    tracker.addCellChange({
      table: 'users', pkColumn: 'id', pkValue: 2,
      column: 'email', oldValue: 'a@b', newValue: 'c@d',
    });

    const roots = provider.getChildren();
    assert.strictEqual(roots.length, 1);
    assert.strictEqual((roots[0] as TableGroupItem).table, 'users');

    const children = provider.getChildren(roots[0]);
    assert.strictEqual(children.length, 2);
    assert.ok(children[0] instanceof ChangeItem);
    assert.ok(children[1] instanceof ChangeItem);
  });

  it('should show correct label for UPDATE items', () => {
    tracker.addCellChange({
      table: 'users', pkColumn: 'id', pkValue: 42,
      column: 'name', oldValue: 'Alice', newValue: 'Bob',
    });

    const roots = provider.getChildren();
    const children = provider.getChildren(roots[0]);
    const item = children[0] as ChangeItem;
    assert.ok(item.label?.toString().includes('UPDATE'));
    assert.ok(item.label?.toString().includes('name'));
  });

  it('should show correct label for DELETE items', () => {
    tracker.addRowDelete('users', 'id', 99);

    const roots = provider.getChildren();
    const children = provider.getChildren(roots[0]);
    const item = children[0] as ChangeItem;
    assert.ok(item.label?.toString().includes('DELETE'));
  });

  it('should show correct label for INSERT items', () => {
    tracker.addRowInsert('users', { name: 'New' });

    const roots = provider.getChildren();
    const children = provider.getChildren(roots[0]);
    const item = children[0] as ChangeItem;
    assert.ok(item.label?.toString().includes('INSERT'));
  });

  it('should show edit icon for cell changes', () => {
    tracker.addCellChange({
      table: 'users', pkColumn: 'id', pkValue: 1,
      column: 'name', oldValue: 'A', newValue: 'B',
    });

    const roots = provider.getChildren();
    const children = provider.getChildren(roots[0]);
    const item = children[0] as ChangeItem;
    assert.ok(item.iconPath instanceof vscode.ThemeIcon);
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'edit');
  });

  it('should show trash icon for delete changes', () => {
    tracker.addRowDelete('users', 'id', 1);

    const roots = provider.getChildren();
    const children = provider.getChildren(roots[0]);
    const item = children[0] as ChangeItem;
    assert.ok(item.iconPath instanceof vscode.ThemeIcon);
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'trash');
  });

  it('should show add icon for insert changes', () => {
    tracker.addRowInsert('users', { name: 'X' });

    const roots = provider.getChildren();
    const children = provider.getChildren(roots[0]);
    const item = children[0] as ChangeItem;
    assert.ok(item.iconPath instanceof vscode.ThemeIcon);
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'add');
  });

  it('should set contextValue for context menus', () => {
    tracker.addCellChange({
      table: 'users', pkColumn: 'id', pkValue: 1,
      column: 'name', oldValue: 'A', newValue: 'B',
    });

    const roots = provider.getChildren();
    assert.strictEqual(roots[0].contextValue, 'pendingTable');

    const children = provider.getChildren(roots[0]);
    assert.strictEqual(children[0].contextValue, 'pendingChange');
  });

  it('should fire onDidChangeTreeData when tracker changes', () => {
    let fired = false;
    provider.onDidChangeTreeData(() => { fired = true; });

    tracker.addRowDelete('users', 'id', 1);
    assert.ok(fired);
  });

  it('should return the element as TreeItem', () => {
    tracker.addRowDelete('users', 'id', 1);
    const roots = provider.getChildren();
    assert.strictEqual(provider.getTreeItem(roots[0]), roots[0]);
  });

  it('should return empty array for leaf items', () => {
    tracker.addRowDelete('users', 'id', 1);
    const roots = provider.getChildren();
    const children = provider.getChildren(roots[0]);
    const grandchildren = provider.getChildren(children[0]);
    assert.strictEqual(grandchildren.length, 0);
  });

  it('should update table count in label', () => {
    tracker.addCellChange({
      table: 'users', pkColumn: 'id', pkValue: 1,
      column: 'name', oldValue: 'A', newValue: 'B',
    });
    tracker.addCellChange({
      table: 'users', pkColumn: 'id', pkValue: 2,
      column: 'name', oldValue: 'C', newValue: 'D',
    });

    const roots = provider.getChildren();
    assert.ok(roots[0].label?.toString().includes('(2)'));
  });
});
