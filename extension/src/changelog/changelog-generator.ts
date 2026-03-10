import { pkKey } from '../timeline/snapshot-store';
import type { ISnapshotTable } from '../timeline/snapshot-store';
import type {
  IChangelog,
  IChangelogEntry,
  IColumnChange,
  IDeletedRow,
  IInsertedRow,
  ISnapshotRef,
  IUpdatedRow,
} from './changelog-types';

/** Max preview columns shown for inserted/deleted rows. */
const PREVIEW_COLS = 5;

/** Build a structured changelog between two snapshot states. */
export class ChangelogGenerator {
  generate(
    fromRef: ISnapshotRef,
    toRef: ISnapshotRef,
    fromTables: Map<string, ISnapshotTable>,
    toTables: Map<string, ISnapshotTable>,
  ): IChangelog {
    const allNames = new Set([...fromTables.keys(), ...toTables.keys()]);
    const entries: IChangelogEntry[] = [];
    const unchangedTables: string[] = [];

    for (const name of [...allNames].sort()) {
      if (name.startsWith('sqlite_')) continue;

      const from = fromTables.get(name);
      const to = toTables.get(name);
      const entry = this._diffTable(name, from, to);

      if (this._isEmpty(entry)) {
        unchangedTables.push(name);
      } else {
        entries.push(entry);
      }
    }

    let totalInserts = 0;
    let totalUpdates = 0;
    let totalDeletes = 0;
    for (const e of entries) {
      totalInserts += e.inserts.length;
      totalUpdates += e.updates.length;
      totalDeletes += e.deletes.length;
    }

    return {
      fromSnapshot: fromRef,
      toSnapshot: toRef,
      entries,
      unchangedTables,
      summary: {
        totalInserts,
        totalUpdates,
        totalDeletes,
        tablesChanged: entries.length,
        tablesUnchanged: unchangedTables.length,
      },
    };
  }

  private _diffTable(
    name: string,
    from: ISnapshotTable | undefined,
    to: ISnapshotTable | undefined,
  ): IChangelogEntry {
    const empty: IChangelogEntry = {
      table: name,
      inserts: [],
      updates: [],
      deletes: [],
    };

    if (!from && !to) return empty;

    // Entire table added
    if (!from && to) {
      const preview = to.columns.slice(0, PREVIEW_COLS);
      return {
        table: name,
        inserts: to.rows.map((r) =>
          this._insertedRow(r, to.pkColumns, preview),
        ),
        updates: [],
        deletes: [],
      };
    }

    // Entire table removed
    if (from && !to) {
      const preview = from.columns.slice(0, PREVIEW_COLS);
      return {
        table: name,
        inserts: [],
        updates: [],
        deletes: from.rows.map((r) =>
          this._deletedRow(r, from.pkColumns, preview),
        ),
      };
    }

    // Both exist — diff rows
    return this._diffRows(name, from!, to!);
  }

  private _diffRows(
    name: string,
    from: ISnapshotTable,
    to: ISnapshotTable,
  ): IChangelogEntry {
    const pkCols =
      from.pkColumns.length > 0 ? from.pkColumns : to.pkColumns;
    const cols = from.columns.length > 0 ? from.columns : to.columns;
    const previewCols = cols.slice(0, PREVIEW_COLS);

    const mapFrom = this._buildPkMap(from.rows, pkCols);
    const mapTo = this._buildPkMap(to.rows, pkCols);

    const inserts: IInsertedRow[] = [];
    const updates: IUpdatedRow[] = [];
    const deletes: IDeletedRow[] = [];

    // Inserts: in "to" but not "from"
    for (const [pk, row] of mapTo) {
      if (!mapFrom.has(pk)) {
        inserts.push(this._insertedRow(row, pkCols, previewCols));
      }
    }

    // Deletes: in "from" but not "to"
    for (const [pk, row] of mapFrom) {
      if (!mapTo.has(pk)) {
        deletes.push(this._deletedRow(row, pkCols, previewCols));
      }
    }

    // Updates: in both but different
    for (const [pk, toRow] of mapTo) {
      const fromRow = mapFrom.get(pk);
      if (!fromRow) continue;

      const changes = this._detectChanges(fromRow, toRow, pkCols);
      if (changes.length > 0) {
        updates.push({ pk: this._pkValue(toRow, pkCols), changes });
      }
    }

    return { table: name, inserts, updates, deletes };
  }

  private _buildPkMap(
    rows: Record<string, unknown>[],
    pkCols: string[],
  ): Map<string, Record<string, unknown>> {
    const map = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const key =
        pkCols.length > 0 ? pkKey(row, pkCols) : JSON.stringify(row);
      map.set(key, row);
    }
    return map;
  }

  private _pkValue(
    row: Record<string, unknown>,
    pkCols: string[],
  ): unknown {
    if (pkCols.length === 1) return row[pkCols[0]];
    return pkCols.map((c) => row[c]);
  }

  private _detectChanges(
    fromRow: Record<string, unknown>,
    toRow: Record<string, unknown>,
    pkCols: string[],
  ): IColumnChange[] {
    const pkSet = new Set(pkCols);
    const allCols = new Set([
      ...Object.keys(fromRow),
      ...Object.keys(toRow),
    ]);
    const changes: IColumnChange[] = [];

    for (const col of allCols) {
      if (pkSet.has(col)) continue;
      const oldVal = fromRow[col];
      const newVal = toRow[col];
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changes.push({ column: col, oldValue: oldVal, newValue: newVal });
      }
    }

    return changes;
  }

  private _insertedRow(
    row: Record<string, unknown>,
    pkCols: string[],
    previewCols: string[],
  ): IInsertedRow {
    return {
      pk: this._pkValue(row, pkCols),
      preview: this._buildPreview(row, previewCols),
    };
  }

  private _deletedRow(
    row: Record<string, unknown>,
    pkCols: string[],
    previewCols: string[],
  ): IDeletedRow {
    return {
      pk: this._pkValue(row, pkCols),
      preview: this._buildPreview(row, previewCols),
    };
  }

  private _buildPreview(
    row: Record<string, unknown>,
    cols: string[],
  ): Record<string, unknown> {
    const preview: Record<string, unknown> = {};
    for (const c of cols) {
      if (c in row) preview[c] = row[c];
    }
    return preview;
  }

  private _isEmpty(entry: IChangelogEntry): boolean {
    return (
      entry.inserts.length === 0 &&
      entry.updates.length === 0 &&
      entry.deletes.length === 0
    );
  }
}
