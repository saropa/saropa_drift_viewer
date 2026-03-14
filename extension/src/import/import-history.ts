/** Import history tracking for undo support (persisted in VS Code workspace state). */

import type * as vscode from 'vscode';
import type {
  ClipboardFormat,
  IClipboardImportResult,
  IImportHistoryEntry,
  ImportStrategy,
} from './clipboard-import-types';

/** Manages import history for undo support across editor sessions. */
export class ImportHistory {
  /** In-memory cache of history entries, keyed by ID */
  private _entries: Map<string, IImportHistoryEntry> = new Map();

  /**
   * Create a new history tracker.
   * Loads existing history from storage on construction.
   *
   * @param _storage - VS Code Memento for persistent storage
   */
  constructor(private readonly _storage: vscode.Memento) {
    this._load();
  }

  /**
   * Record a completed import for potential undo.
   *
   * Creates a history entry with all information needed to reverse
   * the import: inserted IDs and previous values of updated rows.
   *
   * @param table - Table where import was performed
   * @param result - Import result with IDs and updated rows
   * @param strategy - Strategy used (insert, upsert, etc.)
   * @param format - Source data format
   * @returns Generated entry ID for future reference
   */
  recordImport(
    table: string,
    result: IClipboardImportResult,
    strategy: ImportStrategy,
    format: ClipboardFormat,
  ): string {
    const id = this._generateId();

    const entry: IImportHistoryEntry = {
      id,
      table,
      timestamp: new Date(),
      strategy,
      source: 'clipboard',
      format,
      rowCount: result.imported,
      insertedIds: result.insertedIds,
      updatedRows: result.updatedRows,
      canUndo: result.insertedIds.length > 0 || result.updatedRows.length > 0,
    };

    this._entries.set(id, entry);
    this._prune();
    this._save();

    return id;
  }

  /**
   * Get an import history entry by ID.
   *
   * Ensures timestamp is properly deserialized as Date object.
   *
   * @param id - Entry ID from recordImport
   * @returns Entry if found, undefined otherwise
   */
  getEntry(id: string): IImportHistoryEntry | undefined {
    const entry = this._entries.get(id);
    if (entry) {
      entry.timestamp = new Date(entry.timestamp);
    }
    return entry;
  }

  /**
   * Get recent import history entries for a specific table.
   *
   * Useful for showing table-specific undo options or history.
   *
   * @param table - Table name to filter by
   * @param limit - Maximum entries to return (default 10)
   * @returns Entries sorted by timestamp descending (newest first)
   */
  getRecentForTable(table: string, limit = 10): IImportHistoryEntry[] {
    const entries = [...this._entries.values()]
      .filter((e) => e.table === table)
      .map((e) => ({ ...e, timestamp: new Date(e.timestamp) }))
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);

    return entries;
  }

  /**
   * Get all recent import history entries across all tables.
   *
   * @param limit - Maximum entries to return (default 20)
   * @returns Entries sorted by timestamp descending (newest first)
   */
  getRecent(limit = 20): IImportHistoryEntry[] {
    return [...this._entries.values()]
      .map((e) => ({ ...e, timestamp: new Date(e.timestamp) }))
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Mark an import as no longer undoable.
   *
   * Called when the undo would produce incorrect results, such as
   * when the imported rows have been subsequently modified.
   *
   * @param id - Entry ID to mark
   */
  markNotUndoable(id: string): void {
    const entry = this._entries.get(id);
    if (entry) {
      entry.canUndo = false;
      this._save();
    }
  }

  /**
   * Mark imports as not undoable when their rows have been modified.
   *
   * Called when rows are edited or deleted outside the import system.
   * Checks all undoable imports for the table and marks any that
   * reference the affected row IDs as non-undoable.
   *
   * @param table - Table where modifications occurred
   * @param affectedIds - IDs of modified/deleted rows
   */
  markAffectedImports(table: string, affectedIds: (string | number)[]): void {
    const affectedSet = new Set(affectedIds.map(String));
    let changed = false;

    for (const entry of this._entries.values()) {
      if (entry.table !== table || !entry.canUndo) {
        continue;
      }

      const hasAffectedInsert = entry.insertedIds.some((id) =>
        affectedSet.has(String(id)),
      );
      const hasAffectedUpdate = entry.updatedRows.some((u) =>
        affectedSet.has(String(u.id)),
      );

      if (hasAffectedInsert || hasAffectedUpdate) {
        entry.canUndo = false;
        changed = true;
      }
    }

    if (changed) {
      this._save();
    }
  }

  /**
   * Remove an entry after successful undo.
   *
   * Called when undo completes successfully to remove the entry
   * from history (it's no longer relevant).
   *
   * @param id - Entry ID to remove
   */
  removeEntry(id: string): void {
    this._entries.delete(id);
    this._save();
  }

  /**
   * Clear all history entries.
   *
   * Removes all entries from memory and storage. Use with caution
   * as this prevents undo of all previous imports.
   */
  clear(): void {
    this._entries.clear();
    this._save();
  }

  /**
   * Generate a unique ID for a new history entry.
   *
   * Format: imp_<timestamp>_<random>
   * Example: imp_1678901234567_abc123d
   *
   * @returns Unique entry ID
   */
  private _generateId(): string {
    return `imp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * Remove oldest entries when history exceeds maximum size.
   *
   * Keeps the 100 most recent entries to prevent unbounded storage
   * growth while preserving reasonable undo history.
   */
  private _prune(): void {
    const maxEntries = 100;
    if (this._entries.size <= maxEntries) {
      return;
    }

    const sorted = [...this._entries.entries()]
      .sort((a, b) => {
        const aTime = new Date(a[1].timestamp).getTime();
        const bTime = new Date(b[1].timestamp).getTime();
        return bTime - aTime;
      });

    const toKeep = sorted.slice(0, maxEntries);
    this._entries = new Map(toKeep);
  }

  /**
   * Load history from VS Code workspace state.
   *
   * Called on construction to restore history from previous sessions.
   */
  private _load(): void {
    const data = this._storage.get<Record<string, IImportHistoryEntry>>(
      'clipboardImportHistory',
      {},
    );
    this._entries = new Map(Object.entries(data));
  }

  /**
   * Save history to VS Code workspace state.
   *
   * Called after any modification to persist changes across sessions.
   */
  private _save(): void {
    const data: Record<string, IImportHistoryEntry> = {};
    for (const [id, entry] of this._entries) {
      data[id] = {
        ...entry,
        timestamp: entry.timestamp instanceof Date
          ? entry.timestamp
          : new Date(entry.timestamp),
      };
    }
    this._storage.update('clipboardImportHistory', data);
  }
}

export { formatHistoryEntry } from './import-history-format';
