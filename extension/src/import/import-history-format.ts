/** Formatting utilities for import history entries. */

import type { IImportHistoryEntry } from './clipboard-import-types';

/**
 * Format an import history entry for display in UI.
 *
 * @param entry - History entry to format
 * @returns Formatted string like "10:30: imported 5 rows into users (can undo)"
 */
export function formatHistoryEntry(entry: IImportHistoryEntry): string {
  const date = entry.timestamp instanceof Date
    ? entry.timestamp
    : new Date(entry.timestamp);

  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const action = entry.strategy === 'upsert' ? 'upserted' : 'imported';
  const undoStatus = entry.canUndo ? '(can undo)' : '(cannot undo)';

  return `${time}: ${action} ${entry.rowCount} rows into ${entry.table} ${undoStatus}`;
}
