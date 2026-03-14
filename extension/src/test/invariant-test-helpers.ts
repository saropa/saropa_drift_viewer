/**
 * Shared test helpers for invariant-manager tests.
 */

import { DriftApiClient } from '../api-client';
import { InvariantManager } from '../invariants/invariant-manager';
import { MockMemento } from './vscode-mock-classes';

export function makeClient(): DriftApiClient {
  return new DriftApiClient('127.0.0.1', 8642);
}

export function makeManager(
  client?: DriftApiClient,
  state?: MockMemento,
): InvariantManager {
  return new InvariantManager(
    client ?? makeClient(),
    state ?? new MockMemento(),
  );
}
