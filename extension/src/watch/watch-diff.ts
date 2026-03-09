import { ColumnMetadata } from '../api-client';

/** Result shape returned by DriftApiClient.sql(). */
export interface IWatchResult {
  columns: string[];
  rows: unknown[][];
}

/** Diff between two query results. */
export interface IWatchDiff {
  addedRows: unknown[][];
  removedRows: unknown[][];
  changedRows: IChangedRow[];
  unchangedCount: number;
}

/** A row present in both snapshots but with different cell values. */
export interface IChangedRow {
  pkValue: string;
  currentRow: unknown[];
  changedColumnIndices: number[];
  previousValues: unknown[];
}

/**
 * Detect the primary key column index.
 *
 * Uses schema metadata when available; otherwise falls back to name
 * heuristics (`id`, `_id`) and finally column 0.
 */
export function detectPkIndex(
  columns: string[],
  schemaColumns?: ColumnMetadata[],
): number {
  if (schemaColumns) {
    for (const sc of schemaColumns) {
      if (!sc.pk) continue;
      const idx = columns.indexOf(sc.name);
      if (idx >= 0) return idx;
    }
  }

  for (let i = 0; i < columns.length; i++) {
    const lower = columns[i].toLowerCase();
    if (lower === 'id' || lower === '_id') return i;
  }

  return 0;
}

/** Stringify a row's PK value for use as a map key. */
export function rowKey(row: unknown[], pkIndex: number): string {
  return JSON.stringify(row[pkIndex]);
}

/** Compute the diff between two result sets. */
export function computeDiff(
  previous: IWatchResult | null,
  current: IWatchResult,
  pkIndex: number,
): IWatchDiff {
  if (!previous) {
    return {
      addedRows: current.rows,
      removedRows: [],
      changedRows: [],
      unchangedCount: 0,
    };
  }

  // If columns changed, treat as full replacement
  if (JSON.stringify(previous.columns) !== JSON.stringify(current.columns)) {
    return {
      addedRows: current.rows,
      removedRows: previous.rows,
      changedRows: [],
      unchangedCount: 0,
    };
  }

  const prevMap = new Map<string, unknown[]>();
  for (const row of previous.rows) {
    prevMap.set(rowKey(row, pkIndex), row);
  }

  const addedRows: unknown[][] = [];
  const changedRows: IChangedRow[] = [];
  let unchangedCount = 0;

  for (const row of current.rows) {
    const key = rowKey(row, pkIndex);
    const prev = prevMap.get(key);
    if (!prev) {
      addedRows.push(row);
      continue;
    }
    prevMap.delete(key);

    const changedIndices: number[] = [];
    for (let i = 0; i < row.length; i++) {
      if (JSON.stringify(row[i]) !== JSON.stringify(prev[i])) {
        changedIndices.push(i);
      }
    }

    if (changedIndices.length > 0) {
      changedRows.push({
        pkValue: key,
        currentRow: row,
        changedColumnIndices: changedIndices,
        previousValues: prev,
      });
    } else {
      unchangedCount++;
    }
  }

  const removedRows = [...prevMap.values()];

  return { addedRows, removedRows, changedRows, unchangedCount };
}
