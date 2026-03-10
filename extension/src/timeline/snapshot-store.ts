import * as vscode from 'vscode';
import { DriftApiClient } from '../api-client';

/** A single point-in-time capture of one table's data. */
export interface ISnapshotTable {
  rowCount: number;
  columns: string[];
  pkColumns: string[];
  rows: Record<string, unknown>[];
}

/** A full snapshot across all tables. */
export interface ISnapshot {
  id: string;
  timestamp: number;
  tables: Map<string, ISnapshotTable>;
}

/** Row-level diff result for a single table. */
export interface ITableDiff {
  tableName: string;
  columns: string[];
  addedRows: Record<string, unknown>[];
  removedRows: Record<string, unknown>[];
  changedRows: IChangedRow[];
  snapshotRowCount: number;
  currentRowCount: number;
}

/** A row present in both snapshot and current with differing values. */
export interface IChangedRow {
  pkValue: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  changedColumns: string[];
}

/** Convert API row arrays to keyed objects. */
export function rowsToObjects(
  columns: string[],
  rows: unknown[][],
): Record<string, unknown>[] {
  return rows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i++) {
      obj[columns[i]] = row[i];
    }
    return obj;
  });
}

/** Build a stable string key from a row's primary key columns. */
export function pkKey(row: Record<string, unknown>, pkCols: string[]): string {
  return pkCols.map((c) => String(row[c] ?? '')).join('\0');
}

function rowSignature(row: Record<string, unknown>): string {
  return JSON.stringify(row);
}

/** Compute a row-level diff between snapshot and current data. */
export function computeTableDiff(
  tableName: string,
  columns: string[],
  pkColumns: string[],
  snapshotRows: Record<string, unknown>[],
  currentRows: Record<string, unknown>[],
  snapshotRowCount: number,
  currentRowCount: number,
): ITableDiff {
  if (pkColumns.length === 0) {
    return diffBySignature(
      tableName, columns, snapshotRows, currentRows,
      snapshotRowCount, currentRowCount,
    );
  }
  return diffByPk(
    tableName, columns, pkColumns, snapshotRows, currentRows,
    snapshotRowCount, currentRowCount,
  );
}

function diffByPk(
  tableName: string,
  columns: string[],
  pkColumns: string[],
  snapshotRows: Record<string, unknown>[],
  currentRows: Record<string, unknown>[],
  snapshotRowCount: number,
  currentRowCount: number,
): ITableDiff {
  const snapMap = new Map<string, Record<string, unknown>>();
  for (const row of snapshotRows) {
    snapMap.set(pkKey(row, pkColumns), row);
  }

  const addedRows: Record<string, unknown>[] = [];
  const changedRows: IChangedRow[] = [];
  const matchedKeys = new Set<string>();

  for (const row of currentRows) {
    const key = pkKey(row, pkColumns);
    const snapRow = snapMap.get(key);
    if (!snapRow) {
      addedRows.push(row);
      continue;
    }
    matchedKeys.add(key);
    const changed = columns.filter(
      (c) => JSON.stringify(snapRow[c]) !== JSON.stringify(row[c]),
    );
    if (changed.length > 0) {
      changedRows.push({
        pkValue: key,
        before: snapRow,
        after: row,
        changedColumns: changed,
      });
    }
  }

  const removedRows: Record<string, unknown>[] = [];
  for (const row of snapshotRows) {
    if (!matchedKeys.has(pkKey(row, pkColumns))) {
      removedRows.push(row);
    }
  }

  return {
    tableName, columns, addedRows, removedRows, changedRows,
    snapshotRowCount, currentRowCount,
  };
}

function diffBySignature(
  tableName: string,
  columns: string[],
  snapshotRows: Record<string, unknown>[],
  currentRows: Record<string, unknown>[],
  snapshotRowCount: number,
  currentRowCount: number,
): ITableDiff {
  const snapSigs = new Map<string, number>();
  for (const row of snapshotRows) {
    const sig = rowSignature(row);
    snapSigs.set(sig, (snapSigs.get(sig) ?? 0) + 1);
  }

  const addedRows: Record<string, unknown>[] = [];
  for (const row of currentRows) {
    const sig = rowSignature(row);
    const count = snapSigs.get(sig) ?? 0;
    if (count > 0) {
      snapSigs.set(sig, count - 1);
    } else {
      addedRows.push(row);
    }
  }

  const curSigs = new Map<string, number>();
  for (const row of currentRows) {
    const sig = rowSignature(row);
    curSigs.set(sig, (curSigs.get(sig) ?? 0) + 1);
  }

  const removedRows: Record<string, unknown>[] = [];
  for (const row of snapshotRows) {
    const sig = rowSignature(row);
    const count = curSigs.get(sig) ?? 0;
    if (count > 0) {
      curSigs.set(sig, count - 1);
    } else {
      removedRows.push(row);
    }
  }

  return {
    tableName, columns, addedRows, removedRows, changedRows: [],
    snapshotRowCount, currentRowCount,
  };
}

/** Max rows captured per table per snapshot. */
export const ROW_LIMIT = 1000;

/** In-memory store of database snapshots with rolling window. */
export class SnapshotStore {
  private _snapshots: ISnapshot[] = [];
  private readonly _maxSnapshots: number;
  private readonly _minIntervalMs: number;
  private _lastCaptureTime = 0;
  private _capturing = false;

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(maxSnapshots = 20, minIntervalMs = 10_000) {
    this._maxSnapshots = maxSnapshots;
    this._minIntervalMs = minIntervalMs;
  }

  get snapshots(): readonly ISnapshot[] {
    return this._snapshots;
  }

  getById(id: string): ISnapshot | undefined {
    return this._snapshots.find((s) => s.id === id);
  }

  getNewerSnapshot(snapshot: ISnapshot): ISnapshot | undefined {
    const idx = this._snapshots.indexOf(snapshot);
    if (idx < 0 || idx >= this._snapshots.length - 1) return undefined;
    return this._snapshots[idx + 1];
  }

  /** Capture current DB state. Returns null if debounced or busy. */
  async capture(client: DriftApiClient): Promise<ISnapshot | null> {
    const now = Date.now();
    if (now - this._lastCaptureTime < this._minIntervalMs) return null;
    if (this._capturing) return null;

    this._capturing = true;
    try {
      const metadata = await client.schemaMetadata();
      const tables = new Map<string, ISnapshotTable>();

      for (const table of metadata) {
        const pkCols = table.columns
          .filter((c) => c.pk)
          .map((c) => c.name);
        const result = await client.sql(
          `SELECT * FROM "${table.name}" ORDER BY rowid LIMIT ${ROW_LIMIT}`,
        );
        tables.set(table.name, {
          rowCount: table.rowCount,
          columns: result.columns,
          pkColumns: pkCols,
          rows: rowsToObjects(result.columns, result.rows),
        });
      }

      const snapshot: ISnapshot = {
        id: new Date(now).toISOString(),
        timestamp: now,
        tables,
      };

      this._snapshots.push(snapshot);
      if (this._snapshots.length > this._maxSnapshots) {
        this._snapshots.shift();
      }
      this._lastCaptureTime = now;
      this._onDidChange.fire();
      return snapshot;
    } catch {
      return null;
    } finally {
      this._capturing = false;
    }
  }

  clear(): void {
    this._snapshots = [];
    this._onDidChange.fire();
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
