import * as assert from 'assert';
import { DependencySorter } from '../data-management/dependency-sorter';
import type { IFkContext } from '../data-management/dataset-types';

describe('DependencySorter', () => {
  let sorter: DependencySorter;

  beforeEach(() => {
    sorter = new DependencySorter();
  });

  describe('sortForInsert', () => {
    it('returns empty for empty input', () => {
      assert.deepStrictEqual(sorter.sortForInsert([], []), []);
    });

    it('returns tables unchanged when no FKs', () => {
      const result = sorter.sortForInsert(['a', 'b', 'c'], []);
      assert.strictEqual(result.length, 3);
      assert.ok(result.includes('a'));
      assert.ok(result.includes('b'));
      assert.ok(result.includes('c'));
    });

    it('sorts a linear chain (A→B→C) with parents first', () => {
      // orders depends on users, order_items depends on orders
      const fks: IFkContext[] = [
        { fromTable: 'orders', toTable: 'users' },
        { fromTable: 'order_items', toTable: 'orders' },
      ];
      const result = sorter.sortForInsert(
        ['order_items', 'orders', 'users'],
        fks,
      );
      const iUsers = result.indexOf('users');
      const iOrders = result.indexOf('orders');
      const iItems = result.indexOf('order_items');
      assert.ok(iUsers < iOrders, 'users before orders');
      assert.ok(iOrders < iItems, 'orders before order_items');
    });

    it('handles diamond dependency correctly', () => {
      // D depends on B and C; B and C both depend on A
      const fks: IFkContext[] = [
        { fromTable: 'B', toTable: 'A' },
        { fromTable: 'C', toTable: 'A' },
        { fromTable: 'D', toTable: 'B' },
        { fromTable: 'D', toTable: 'C' },
      ];
      const result = sorter.sortForInsert(
        ['D', 'C', 'B', 'A'],
        fks,
      );
      const iA = result.indexOf('A');
      const iB = result.indexOf('B');
      const iC = result.indexOf('C');
      const iD = result.indexOf('D');
      assert.ok(iA < iB, 'A before B');
      assert.ok(iA < iC, 'A before C');
      assert.ok(iB < iD, 'B before D');
      assert.ok(iC < iD, 'C before D');
    });

    it('ignores FKs referencing tables outside the set', () => {
      const fks: IFkContext[] = [
        { fromTable: 'orders', toTable: 'users' },
      ];
      // users is not in the table list
      const result = sorter.sortForInsert(['orders'], fks);
      assert.deepStrictEqual(result, ['orders']);
    });

    it('handles circular dependency without crashing', () => {
      const fks: IFkContext[] = [
        { fromTable: 'A', toTable: 'B' },
        { fromTable: 'B', toTable: 'A' },
      ];
      const result = sorter.sortForInsert(['A', 'B'], fks);
      assert.strictEqual(result.length, 2);
      assert.ok(result.includes('A'));
      assert.ok(result.includes('B'));
    });
  });

  describe('sortForDelete', () => {
    it('returns reverse of insert order (children first)', () => {
      const fks: IFkContext[] = [
        { fromTable: 'orders', toTable: 'users' },
        { fromTable: 'order_items', toTable: 'orders' },
      ];
      const result = sorter.sortForDelete(
        ['order_items', 'orders', 'users'],
        fks,
      );
      const iItems = result.indexOf('order_items');
      const iOrders = result.indexOf('orders');
      const iUsers = result.indexOf('users');
      assert.ok(iItems < iOrders, 'order_items before orders');
      assert.ok(iOrders < iUsers, 'orders before users');
    });

    it('returns empty for empty input', () => {
      assert.deepStrictEqual(sorter.sortForDelete([], []), []);
    });
  });

  describe('hasCircularDeps', () => {
    it('returns false for acyclic graph', () => {
      const fks: IFkContext[] = [
        { fromTable: 'orders', toTable: 'users' },
      ];
      assert.strictEqual(
        sorter.hasCircularDeps(['orders', 'users'], fks),
        false,
      );
    });

    it('returns true for circular graph', () => {
      const fks: IFkContext[] = [
        { fromTable: 'A', toTable: 'B' },
        { fromTable: 'B', toTable: 'A' },
      ];
      assert.strictEqual(
        sorter.hasCircularDeps(['A', 'B'], fks),
        true,
      );
    });

    it('returns false for empty input', () => {
      assert.strictEqual(sorter.hasCircularDeps([], []), false);
    });
  });
});
