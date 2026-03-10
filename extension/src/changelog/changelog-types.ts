/** A row that was inserted (present in "to" but not "from"). */
export interface IInsertedRow {
  pk: unknown;
  preview: Record<string, unknown>;
}

/** A row that was updated between snapshots. */
export interface IUpdatedRow {
  pk: unknown;
  changes: IColumnChange[];
}

/** A single column value change. */
export interface IColumnChange {
  column: string;
  oldValue: unknown;
  newValue: unknown;
}

/** A row that was deleted (present in "from" but not "to"). */
export interface IDeletedRow {
  pk: unknown;
  preview: Record<string, unknown>;
}

/** Changes for a single table between two snapshots. */
export interface IChangelogEntry {
  table: string;
  inserts: IInsertedRow[];
  updates: IUpdatedRow[];
  deletes: IDeletedRow[];
}

/** Aggregate counts across all tables. */
export interface IChangelogSummary {
  totalInserts: number;
  totalUpdates: number;
  totalDeletes: number;
  tablesChanged: number;
  tablesUnchanged: number;
}

/** Metadata identifying one snapshot. */
export interface ISnapshotRef {
  name: string;
  timestamp: string;
}

/** Full structured changelog between two snapshots. */
export interface IChangelog {
  fromSnapshot: ISnapshotRef;
  toSnapshot: ISnapshotRef;
  entries: IChangelogEntry[];
  unchangedTables: string[];
  summary: IChangelogSummary;
}
