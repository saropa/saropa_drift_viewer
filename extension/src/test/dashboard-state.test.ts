import * as assert from 'assert';
import { DashboardState } from '../dashboard/dashboard-state';
import type { IDashboardLayout } from '../dashboard/dashboard-types';

class MockMemento {
  private _data: Map<string, unknown> = new Map();

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    if (this._data.has(key)) {
      return this._data.get(key) as T;
    }
    return defaultValue;
  }

  update(key: string, value: unknown): Thenable<void> {
    if (value === undefined) {
      this._data.delete(key);
    } else {
      this._data.set(key, value);
    }
    return Promise.resolve();
  }

  keys(): readonly string[] {
    return Array.from(this._data.keys());
  }

  clear(): void {
    this._data.clear();
  }
}

describe('DashboardState', () => {
  let memento: MockMemento;
  let state: DashboardState;

  beforeEach(() => {
    memento = new MockMemento();
    state = new DashboardState(memento);
  });

  describe('save and load', () => {
    it('should save and load a layout', () => {
      const layout: IDashboardLayout = {
        version: 1,
        name: 'test-layout',
        columns: 4,
        widgets: [
          {
            id: 'w1',
            type: 'rowCount',
            title: 'Users Count',
            gridX: 0,
            gridY: 0,
            gridW: 1,
            gridH: 1,
            config: { table: 'users' },
          },
        ],
      };

      state.save(layout);
      const loaded = state.load('test-layout');

      assert.deepStrictEqual(loaded, layout);
    });

    it('should load current layout when no name provided', () => {
      const layout: IDashboardLayout = {
        version: 1,
        name: 'current-dashboard',
        columns: 4,
        widgets: [],
      };

      state.save(layout);
      const loaded = state.load();

      assert.deepStrictEqual(loaded, layout);
    });

    it('should return undefined for missing layout', () => {
      const loaded = state.load('nonexistent');
      assert.strictEqual(loaded, undefined);
    });

    it('should return undefined when no current layout set', () => {
      const loaded = state.load();
      assert.strictEqual(loaded, undefined);
    });
  });

  describe('listSaved', () => {
    it('should return empty array when no dashboards saved', () => {
      const list = state.listSaved();
      assert.deepStrictEqual(list, []);
    });

    it('should list all saved dashboard names', () => {
      const layout1: IDashboardLayout = {
        version: 1,
        name: 'dashboard-a',
        columns: 4,
        widgets: [],
      };
      const layout2: IDashboardLayout = {
        version: 1,
        name: 'dashboard-b',
        columns: 4,
        widgets: [],
      };

      state.save(layout1);
      state.save(layout2);

      const list = state.listSaved();
      assert.ok(list.includes('dashboard-a'));
      assert.ok(list.includes('dashboard-b'));
      assert.strictEqual(list.length, 2);
    });

    it('should not duplicate names when saving same dashboard twice', () => {
      const layout: IDashboardLayout = {
        version: 1,
        name: 'same-name',
        columns: 4,
        widgets: [],
      };

      state.save(layout);
      state.save({ ...layout, widgets: [{ id: 'w1', type: 'customText', title: 'Test', gridX: 0, gridY: 0, gridW: 1, gridH: 1, config: {} }] });

      const list = state.listSaved();
      assert.deepStrictEqual(list, ['same-name']);
    });
  });

  describe('delete', () => {
    it('should delete a dashboard', () => {
      const layout: IDashboardLayout = {
        version: 1,
        name: 'to-delete',
        columns: 4,
        widgets: [],
      };

      state.save(layout);
      assert.ok(state.load('to-delete'));

      state.delete('to-delete');

      assert.strictEqual(state.load('to-delete'), undefined);
      assert.ok(!state.listSaved().includes('to-delete'));
    });

    it('should update current pointer when deleting current dashboard', () => {
      const layout1: IDashboardLayout = { version: 1, name: 'first', columns: 4, widgets: [] };
      const layout2: IDashboardLayout = { version: 1, name: 'second', columns: 4, widgets: [] };

      state.save(layout1);
      state.save(layout2);
      assert.strictEqual(state.getCurrentName(), 'second');

      state.delete('second');

      assert.strictEqual(state.getCurrentName(), 'first');
    });

    it('should clear current when deleting last dashboard', () => {
      const layout: IDashboardLayout = { version: 1, name: 'only-one', columns: 4, widgets: [] };

      state.save(layout);
      state.delete('only-one');

      assert.strictEqual(state.getCurrentName(), undefined);
    });
  });

  describe('getCurrentName', () => {
    it('should return undefined when no dashboard saved', () => {
      assert.strictEqual(state.getCurrentName(), undefined);
    });

    it('should return name of most recently saved dashboard', () => {
      state.save({ version: 1, name: 'first', columns: 4, widgets: [] });
      state.save({ version: 1, name: 'second', columns: 4, widgets: [] });

      assert.strictEqual(state.getCurrentName(), 'second');
    });
  });

  describe('createDefault', () => {
    it('should create default layout with given name', () => {
      const layout = DashboardState.createDefault('my-dashboard');

      assert.strictEqual(layout.version, 1);
      assert.strictEqual(layout.name, 'my-dashboard');
      assert.strictEqual(layout.columns, 4);
      assert.deepStrictEqual(layout.widgets, []);
    });

    it('should use "default" as name when not provided', () => {
      const layout = DashboardState.createDefault();
      assert.strictEqual(layout.name, 'default');
    });
  });
});
