/**
 * Manages data invariant rules: CRUD operations, persistence, and evaluation.
 */

import * as vscode from 'vscode';
import type { DriftApiClient } from '../api-client';
import type {
  IInvariant,
  IInvariantResult,
  IInvariantSummary,
} from './invariant-types';

const MAX_VIOLATION_ROWS = 20;
const STORAGE_KEY = 'driftViewer.invariants';

/**
 * Manages data invariant rules and their evaluation.
 * Stores rules in workspace state for persistence.
 */
export class InvariantManager implements vscode.Disposable {
  private _invariants: IInvariant[] = [];
  private _evaluating = false;
  private _disposed = false;

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private readonly _onViolation = new vscode.EventEmitter<IInvariant>();
  readonly onViolation = this._onViolation.event;

  constructor(
    private readonly _client: DriftApiClient,
    private readonly _state: vscode.Memento,
  ) {
    this._load();
  }

  private _load(): void {
    const stored = this._state.get<IInvariant[]>(STORAGE_KEY, []);
    this._invariants = stored;
  }

  private _persist(): void {
    this._state.update(STORAGE_KEY, this._invariants);
  }

  /** All invariants (readonly access). */
  get invariants(): readonly IInvariant[] {
    return this._invariants;
  }

  /** Number of enabled invariants that passed their last check. */
  get passingCount(): number {
    return this._invariants.filter(
      (i) => i.enabled && i.lastResult?.passed,
    ).length;
  }

  /** Number of enabled invariants that failed their last check. */
  get failingCount(): number {
    return this._invariants.filter(
      (i) => i.enabled && i.lastResult && !i.lastResult.passed,
    ).length;
  }

  /** Number of enabled invariants. */
  get totalEnabled(): number {
    return this._invariants.filter((i) => i.enabled).length;
  }

  /** Whether evaluation is currently in progress. */
  get isEvaluating(): boolean {
    return this._evaluating;
  }

  /** Get a summary of invariant status. */
  getSummary(): IInvariantSummary {
    const enabled = this._invariants.filter((i) => i.enabled);
    const lastChecks = enabled
      .map((i) => i.lastResult?.checkedAt)
      .filter((t): t is number => t !== undefined);

    return {
      totalEnabled: enabled.length,
      passingCount: this.passingCount,
      failingCount: this.failingCount,
      lastCheckTime: lastChecks.length > 0 ? Math.max(...lastChecks) : undefined,
    };
  }

  /** Get an invariant by ID. */
  get(id: string): IInvariant | undefined {
    return this._invariants.find((i) => i.id === id);
  }

  /** Add a new invariant. */
  add(invariant: Omit<IInvariant, 'id'>): IInvariant {
    const newInvariant: IInvariant = {
      ...invariant,
      id: crypto.randomUUID(),
    };
    this._invariants.push(newInvariant);
    this._persist();
    this._onDidChange.fire();
    return newInvariant;
  }

  /** Update an existing invariant. */
  update(id: string, updates: Partial<Omit<IInvariant, 'id'>>): boolean {
    const idx = this._invariants.findIndex((i) => i.id === id);
    if (idx < 0) return false;

    this._invariants[idx] = {
      ...this._invariants[idx],
      ...updates,
    };
    this._persist();
    this._onDidChange.fire();
    return true;
  }

  /** Remove an invariant. */
  remove(id: string): boolean {
    const initialLength = this._invariants.length;
    this._invariants = this._invariants.filter((i) => i.id !== id);

    if (this._invariants.length < initialLength) {
      this._persist();
      this._onDidChange.fire();
      return true;
    }
    return false;
  }

  /** Toggle an invariant's enabled state. */
  toggle(id: string): boolean {
    const inv = this._invariants.find((i) => i.id === id);
    if (!inv) return false;

    inv.enabled = !inv.enabled;
    this._persist();
    this._onDidChange.fire();
    return true;
  }

  /** Evaluate all enabled invariants. */
  async evaluateAll(): Promise<void> {
    if (this._evaluating || this._disposed) return;
    this._evaluating = true;

    try {
      const enabled = this._invariants.filter((i) => i.enabled);
      for (const inv of enabled) {
        if (this._disposed) break;
        await this._evaluate(inv);
      }
      this._persist();
      this._onDidChange.fire();
    } finally {
      this._evaluating = false;
    }
  }

  /** Evaluate a single invariant by ID. */
  async evaluateOne(id: string): Promise<IInvariantResult | undefined> {
    const inv = this._invariants.find((i) => i.id === id);
    if (!inv || this._disposed) return undefined;

    await this._evaluate(inv);
    this._persist();
    this._onDidChange.fire();
    return inv.lastResult;
  }

  private async _evaluate(inv: IInvariant): Promise<void> {
    const start = Date.now();

    try {
      const result = await this._client.sql(inv.sql);
      const violationCount = result.rows.length;
      const passed =
        inv.expectation === 'zero_rows'
          ? violationCount === 0
          : violationCount > 0;

      const violatingRows: Record<string, unknown>[] = result.rows
        .slice(0, MAX_VIOLATION_ROWS)
        .map((row) => {
          const record: Record<string, unknown> = {};
          result.columns.forEach((col, idx) => {
            record[col] = row[idx];
          });
          return record;
        });

      inv.lastResult = {
        passed,
        violationCount,
        violatingRows,
        checkedAt: Date.now(),
        durationMs: Date.now() - start,
      };

      if (!passed) {
        this._onViolation.fire(inv);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      inv.lastResult = {
        passed: false,
        violationCount: -1,
        violatingRows: [],
        checkedAt: Date.now(),
        durationMs: Date.now() - start,
        error: errorMsg,
      };
    }
  }

  /** Clear all invariants. */
  clear(): void {
    this._invariants = [];
    this._persist();
    this._onDidChange.fire();
  }

  /** Import invariants from JSON data. */
  import(data: IInvariant[]): number {
    let imported = 0;
    for (const inv of data) {
      if (inv.id && inv.name && inv.sql && inv.table) {
        const existing = this._invariants.find((i) => i.id === inv.id);
        if (existing) {
          Object.assign(existing, inv);
        } else {
          this._invariants.push({
            ...inv,
            id: inv.id || crypto.randomUUID(),
            lastResult: undefined,
          });
        }
        imported++;
      }
    }

    if (imported > 0) {
      this._persist();
      this._onDidChange.fire();
    }
    return imported;
  }

  /** Export all invariants as JSON-serializable data. */
  export(): IInvariant[] {
    return this._invariants.map((inv) => ({
      ...inv,
      lastResult: undefined,
    }));
  }

  dispose(): void {
    this._disposed = true;
    this._onDidChange.dispose();
    this._onViolation.dispose();
  }
}
