import * as assert from 'assert';
import * as sinon from 'sinon';
import { DriftApiClient } from '../api-client';
import type { IInvariant } from '../invariants/invariant-types';
import { MockMemento } from './vscode-mock-classes';
import { makeClient, makeManager } from './invariant-test-helpers';

describe('InvariantManager — counts', () => {
  let client: DriftApiClient;
  let state: MockMemento;

  beforeEach(() => {
    client = makeClient();
    state = new MockMemento();
  });

  afterEach(() => {
    sinon.restore();
  });

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

describe('InvariantManager — import/export', () => {
  let client: DriftApiClient;
  let state: MockMemento;

  beforeEach(() => {
    client = makeClient();
    state = new MockMemento();
  });

  afterEach(() => {
    sinon.restore();
  });

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
