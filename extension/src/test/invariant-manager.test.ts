import * as assert from 'assert';
import * as sinon from 'sinon';
import { DriftApiClient } from '../api-client';
import { InvariantManager } from '../invariants/invariant-manager';
import type { IInvariant } from '../invariants/invariant-types';
import { MockMemento } from './vscode-mock-classes';

function makeClient(): DriftApiClient {
  return new DriftApiClient('127.0.0.1', 8642);
}

function makeManager(
  client?: DriftApiClient,
  state?: MockMemento,
): InvariantManager {
  return new InvariantManager(
    client ?? makeClient(),
    state ?? new MockMemento(),
  );
}

describe('InvariantManager', () => {
  let client: DriftApiClient;
  let state: MockMemento;

  beforeEach(() => {
    client = makeClient();
    state = new MockMemento();
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('add', () => {
    it('should add a new invariant with generated id', () => {
      const manager = makeManager(client, state);
      const inv = manager.add({
        name: 'Test invariant',
        table: 'users',
        sql: 'SELECT * FROM users WHERE id < 0',
        expectation: 'zero_rows',
        severity: 'warning',
        enabled: true,
      });

      assert.ok(inv.id, 'Expected id to be generated');
      assert.strictEqual(inv.name, 'Test invariant');
      assert.strictEqual(manager.invariants.length, 1);
    });

    it('should persist after add', () => {
      const manager = makeManager(client, state);
      manager.add({
        name: 'Test',
        table: 'users',
        sql: 'SELECT 1',
        expectation: 'zero_rows',
        severity: 'warning',
        enabled: true,
      });

      const stored = state.get<IInvariant[]>('driftViewer.invariants', [])!;
      assert.strictEqual(stored.length, 1);
    });

    it('should fire onDidChange event', () => {
      const manager = makeManager(client, state);
      let fired = false;
      manager.onDidChange(() => {
        fired = true;
      });

      manager.add({
        name: 'Test',
        table: 'users',
        sql: 'SELECT 1',
        expectation: 'zero_rows',
        severity: 'warning',
        enabled: true,
      });

      assert.ok(fired);
    });
  });

  describe('remove', () => {
    it('should remove invariant by id', () => {
      const manager = makeManager(client, state);
      const inv = manager.add({
        name: 'Test',
        table: 'users',
        sql: 'SELECT 1',
        expectation: 'zero_rows',
        severity: 'warning',
        enabled: true,
      });

      assert.strictEqual(manager.invariants.length, 1);
      const removed = manager.remove(inv.id);
      assert.ok(removed);
      assert.strictEqual(manager.invariants.length, 0);
    });

    it('should return false for non-existent id', () => {
      const manager = makeManager(client, state);
      const removed = manager.remove('non-existent-id');
      assert.strictEqual(removed, false);
    });
  });

  describe('toggle', () => {
    it('should toggle enabled state', () => {
      const manager = makeManager(client, state);
      const inv = manager.add({
        name: 'Test',
        table: 'users',
        sql: 'SELECT 1',
        expectation: 'zero_rows',
        severity: 'warning',
        enabled: true,
      });

      assert.strictEqual(manager.get(inv.id)?.enabled, true);
      manager.toggle(inv.id);
      assert.strictEqual(manager.get(inv.id)?.enabled, false);
      manager.toggle(inv.id);
      assert.strictEqual(manager.get(inv.id)?.enabled, true);
    });
  });

  describe('evaluateAll', () => {
    it('should evaluate all enabled invariants', async () => {
      sinon.stub(client, 'sql').resolves({ columns: [], rows: [] });

      const manager = makeManager(client, state);
      manager.add({
        name: 'Test 1',
        table: 'users',
        sql: 'SELECT 1',
        expectation: 'zero_rows',
        severity: 'warning',
        enabled: true,
      });
      manager.add({
        name: 'Test 2',
        table: 'orders',
        sql: 'SELECT 2',
        expectation: 'zero_rows',
        severity: 'warning',
        enabled: true,
      });

      await manager.evaluateAll();

      for (const inv of manager.invariants) {
        assert.ok(inv.lastResult, `Expected result for ${inv.name}`);
        assert.ok(inv.lastResult.passed);
      }
    });

    it('should skip disabled invariants', async () => {
      sinon.stub(client, 'sql').resolves({ columns: [], rows: [] });

      const manager = makeManager(client, state);
      manager.add({
        name: 'Disabled',
        table: 'users',
        sql: 'SELECT 1',
        expectation: 'zero_rows',
        severity: 'warning',
        enabled: false,
      });

      await manager.evaluateAll();

      const inv = manager.invariants[0];
      assert.strictEqual(inv.lastResult, undefined);
    });

    it('should mark invariant as failed when rows returned for zero_rows expectation', async () => {
      sinon.stub(client, 'sql').resolves({
        columns: ['id'],
        rows: [[1], [2], [3]],
      });

      const manager = makeManager(client, state);
      manager.add({
        name: 'Should fail',
        table: 'users',
        sql: 'SELECT * FROM users WHERE invalid',
        expectation: 'zero_rows',
        severity: 'warning',
        enabled: true,
      });

      await manager.evaluateAll();

      const inv = manager.invariants[0];
      assert.ok(inv.lastResult);
      assert.strictEqual(inv.lastResult.passed, false);
      assert.strictEqual(inv.lastResult.violationCount, 3);
    });

    it('should fire onViolation event when invariant fails', async () => {
      sinon.stub(client, 'sql').resolves({
        columns: ['id'],
        rows: [[1]],
      });

      const manager = makeManager(client, state);
      let violatedInvariantName: string | null = null;
      manager.onViolation((inv) => {
        violatedInvariantName = inv.name;
      });

      manager.add({
        name: 'Will fail',
        table: 'users',
        sql: 'SELECT 1',
        expectation: 'zero_rows',
        severity: 'warning',
        enabled: true,
      });

      await manager.evaluateAll();

      assert.ok(violatedInvariantName);
      assert.strictEqual(violatedInvariantName, 'Will fail');
    });

    it('should guard against concurrent evaluation', async () => {
      let callCount = 0;
      sinon.stub(client, 'sql').callsFake(async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, 10));
        return { columns: [], rows: [] };
      });

      const manager = makeManager(client, state);
      manager.add({
        name: 'Test',
        table: 'users',
        sql: 'SELECT 1',
        expectation: 'zero_rows',
        severity: 'warning',
        enabled: true,
      });

      const p1 = manager.evaluateAll();
      const p2 = manager.evaluateAll();
      await Promise.all([p1, p2]);

      assert.strictEqual(callCount, 1);
    });

    it('should handle SQL execution errors gracefully', async () => {
      sinon.stub(client, 'sql').rejects(new Error('SQL error'));

      const manager = makeManager(client, state);
      manager.add({
        name: 'Bad SQL',
        table: 'users',
        sql: 'INVALID SQL',
        expectation: 'zero_rows',
        severity: 'warning',
        enabled: true,
      });

      await manager.evaluateAll();

      const inv = manager.invariants[0];
      assert.ok(inv.lastResult);
      assert.strictEqual(inv.lastResult.passed, false);
      assert.strictEqual(inv.lastResult.violationCount, -1);
      assert.ok(inv.lastResult.error);
    });
  });

  describe('persistence', () => {
    it('should restore invariants from state', () => {
      const stored: IInvariant[] = [
        {
          id: 'test-id',
          name: 'Stored invariant',
          table: 'users',
          sql: 'SELECT 1',
          expectation: 'zero_rows',
          severity: 'warning',
          enabled: true,
        },
      ];
      state.update('driftViewer.invariants', stored);

      const manager = makeManager(client, state);
      assert.strictEqual(manager.invariants.length, 1);
      assert.strictEqual(manager.invariants[0].name, 'Stored invariant');
    });
  });

  describe('counts', () => {
    it('should count passing invariants', async () => {
      sinon.stub(client, 'sql').resolves({ columns: [], rows: [] });

      const manager = makeManager(client, state);
      manager.add({
        name: 'Passing',
        table: 'users',
        sql: 'SELECT 1',
        expectation: 'zero_rows',
        severity: 'warning',
        enabled: true,
      });

      await manager.evaluateAll();

      assert.strictEqual(manager.passingCount, 1);
      assert.strictEqual(manager.failingCount, 0);
      assert.strictEqual(manager.totalEnabled, 1);
    });

    it('should count failing invariants', async () => {
      sinon.stub(client, 'sql').resolves({ columns: ['id'], rows: [[1]] });

      const manager = makeManager(client, state);
      manager.add({
        name: 'Failing',
        table: 'users',
        sql: 'SELECT 1',
        expectation: 'zero_rows',
        severity: 'warning',
        enabled: true,
      });

      await manager.evaluateAll();

      assert.strictEqual(manager.passingCount, 0);
      assert.strictEqual(manager.failingCount, 1);
    });
  });

  describe('import/export', () => {
    it('should export invariants without results', () => {
      const manager = makeManager(client, state);
      const inv = manager.add({
        name: 'Test',
        table: 'users',
        sql: 'SELECT 1',
        expectation: 'zero_rows',
        severity: 'warning',
        enabled: true,
      });
      (inv as any).lastResult = { passed: true };

      const exported = manager.export();
      assert.strictEqual(exported.length, 1);
      assert.strictEqual(exported[0].lastResult, undefined);
    });

    it('should import invariants', () => {
      const manager = makeManager(client, state);
      const data: IInvariant[] = [
        {
          id: 'import-1',
          name: 'Imported',
          table: 'users',
          sql: 'SELECT 1',
          expectation: 'zero_rows',
          severity: 'warning',
          enabled: true,
        },
      ];

      const count = manager.import(data);
      assert.strictEqual(count, 1);
      assert.strictEqual(manager.invariants.length, 1);
    });
  });
});
