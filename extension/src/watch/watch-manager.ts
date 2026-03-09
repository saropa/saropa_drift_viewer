import * as vscode from 'vscode';
import { ColumnMetadata, DriftApiClient } from '../api-client';
import {
  computeDiff,
  detectPkIndex,
  IWatchDiff,
  IWatchResult,
} from './watch-diff';

/** Full runtime state of a single watch. */
export interface IWatchEntry {
  id: string;
  label: string;
  sql: string;
  pkIndex: number;
  columns: string[];
  previousResult: IWatchResult | null;
  currentResult: IWatchResult | null;
  diff: IWatchDiff | null;
  paused: boolean;
  error: string | null;
  createdAt: number;
  lastChangedAt: number;
}

/** Minimal shape persisted in workspaceState. */
interface IPersistedWatch {
  id: string;
  label: string;
  sql: string;
}

const STORAGE_KEY = 'driftViewer.watchList';

type ChangeListener = () => void;

export class WatchManager {
  private readonly _client: DriftApiClient;
  private readonly _state: vscode.Memento;
  private _entries: IWatchEntry[] = [];
  private _listeners: ChangeListener[] = [];
  private _refreshing = false;
  private _unseenChanges = 0;

  constructor(client: DriftApiClient, workspaceState: vscode.Memento) {
    this._client = client;
    this._state = workspaceState;
  }

  /** Subscribe to entry state changes. Returns a disposable. */
  onDidChange(listener: ChangeListener): { dispose: () => void } {
    this._listeners.push(listener);
    return {
      dispose: () => {
        const idx = this._listeners.indexOf(listener);
        if (idx >= 0) this._listeners.splice(idx, 1);
      },
    };
  }

  /** All current watch entries (read-only view). */
  get entries(): readonly IWatchEntry[] {
    return this._entries;
  }

  /** Number of unseen diff changes since panel was last viewed. */
  get unseenChanges(): number {
    return this._unseenChanges;
  }

  resetUnseen(): void {
    this._unseenChanges = 0;
  }

  /**
   * Add a new watch. Runs the initial query immediately.
   * Returns the entry ID, or `undefined` if the limit was reached.
   */
  async add(
    sql: string,
    label: string,
    schemaColumns?: ColumnMetadata[],
  ): Promise<string | undefined> {
    const max = vscode.workspace
      .getConfiguration('driftViewer')
      .get<number>('watch.maxWatchers', 10) ?? 10;

    if (this._entries.length >= max) {
      vscode.window.showWarningMessage(
        `Maximum of ${max} watchers reached. Remove one before adding another.`,
      );
      return undefined;
    }

    const entry = await this._createEntry(sql, label, schemaColumns);
    this._entries.push(entry);
    this._persist();
    this._fireListeners();
    return entry.id;
  }

  /** Remove a watch by ID. */
  remove(id: string): void {
    const idx = this._entries.findIndex((e) => e.id === id);
    if (idx < 0) return;
    this._entries.splice(idx, 1);
    this._persist();
    this._fireListeners();
  }

  /** Pause or resume a watch. */
  setPaused(id: string, paused: boolean): void {
    const entry = this._entries.find((e) => e.id === id);
    if (!entry) return;
    entry.paused = paused;
    this._fireListeners();
  }

  /** Clear the diff for a watch (user acknowledged changes). */
  clearDiff(id: string): void {
    const entry = this._entries.find((e) => e.id === id);
    if (!entry) return;
    entry.diff = null;
    this._fireListeners();
  }

  /** Re-run all active (non-paused) watches. */
  async refresh(): Promise<void> {
    if (this._refreshing || this._entries.length === 0) return;
    this._refreshing = true;

    try {
      const changedEntries: IWatchEntry[] = [];

      for (const entry of this._entries) {
        if (entry.paused) continue;

        try {
          const result = await this._client.sql(entry.sql);
          const diff = computeDiff(entry.currentResult, result, entry.pkIndex);
          const hasChanges =
            diff.addedRows.length > 0 ||
            diff.removedRows.length > 0 ||
            diff.changedRows.length > 0;

          entry.previousResult = entry.currentResult;
          entry.currentResult = result;
          entry.columns = result.columns;
          entry.diff = diff;
          entry.error = null;

          if (hasChanges) {
            entry.lastChangedAt = Date.now();
            this._unseenChanges++;
            changedEntries.push(entry);
          }
        } catch (err) {
          entry.error = err instanceof Error ? err.message : String(err);
        }
      }

      if (changedEntries.length > 0) {
        this._showNotifications(changedEntries);
      }

      this._fireListeners();
    } finally {
      this._refreshing = false;
    }
  }

  /** Restore persisted watches from workspaceState (batched). */
  async restore(): Promise<void> {
    const stored = this._state.get<IPersistedWatch[]>(STORAGE_KEY, []);
    if (stored.length === 0) return;

    for (const pw of stored) {
      const entry = await this._createEntry(pw.sql, pw.label);
      this._entries.push(entry);
    }
    this._fireListeners();
  }

  /** Create a single entry without persisting or notifying. */
  private async _createEntry(
    sql: string,
    label: string,
    schemaColumns?: ColumnMetadata[],
  ): Promise<IWatchEntry> {
    const id = `w_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const entry: IWatchEntry = {
      id,
      label,
      sql,
      pkIndex: 0,
      columns: [],
      previousResult: null,
      currentResult: null,
      diff: null,
      paused: false,
      error: null,
      createdAt: Date.now(),
      lastChangedAt: 0,
    };

    try {
      const result = await this._client.sql(sql);
      entry.columns = result.columns;
      entry.pkIndex = detectPkIndex(result.columns, schemaColumns);
      entry.currentResult = result;
      entry.diff = computeDiff(null, result, entry.pkIndex);
    } catch (err) {
      entry.error = err instanceof Error ? err.message : String(err);
    }

    return entry;
  }

  private _persist(): void {
    const data: IPersistedWatch[] = this._entries.map((e) => ({
      id: e.id,
      label: e.label,
      sql: e.sql,
    }));
    this._state.update(STORAGE_KEY, data);
  }

  private _fireListeners(): void {
    for (const listener of this._listeners) {
      listener();
    }
  }

  private _showNotifications(entries: IWatchEntry[]): void {
    const enabled = vscode.workspace
      .getConfiguration('driftViewer')
      .get<boolean>('watch.notifications', false);
    if (!enabled) return;

    for (const entry of entries) {
      if (!entry.diff) continue;
      const { addedRows, removedRows, changedRows } = entry.diff;
      const parts: string[] = [];
      if (addedRows.length > 0) parts.push(`${addedRows.length} added`);
      if (removedRows.length > 0) parts.push(`${removedRows.length} removed`);
      if (changedRows.length > 0) parts.push(`${changedRows.length} changed`);
      if (parts.length > 0) {
        vscode.window.showInformationMessage(
          `Drift Watch: ${entry.label} — ${parts.join(', ')}`,
        );
      }
    }
  }
}
