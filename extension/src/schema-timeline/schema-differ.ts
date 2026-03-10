import type {
  ISchemaChange, ISchemaSnapshot, ITableSnapshot,
} from './schema-timeline-types';

/** Compares two schema snapshots and returns structured changes. */
export function diffSchemaSnapshots(
  before: ISchemaSnapshot,
  after: ISchemaSnapshot,
): ISchemaChange[] {
  const changes: ISchemaChange[] = [];
  const beforeTables = new Map(before.tables.map((t) => [t.name, t]));
  const afterTables = new Map(after.tables.map((t) => [t.name, t]));

  for (const [name, table] of afterTables) {
    if (!beforeTables.has(name)) {
      changes.push({
        type: 'table_added',
        table: name,
        detail: `${table.columns.length} columns`,
      });
    }
  }

  for (const [name] of beforeTables) {
    if (!afterTables.has(name)) {
      changes.push({ type: 'table_dropped', table: name, detail: '' });
    }
  }

  for (const [name, afterTable] of afterTables) {
    const beforeTable = beforeTables.get(name);
    if (!beforeTable) {
      continue;
    }
    diffColumns(name, beforeTable, afterTable, changes);
    diffForeignKeys(name, beforeTable, afterTable, changes);
  }

  return changes;
}

function diffColumns(
  table: string,
  before: ITableSnapshot,
  after: ITableSnapshot,
  changes: ISchemaChange[],
): void {
  const beforeCols = new Map(before.columns.map((c) => [c.name, c]));
  const afterCols = new Map(after.columns.map((c) => [c.name, c]));

  for (const [colName, col] of afterCols) {
    const prev = beforeCols.get(colName);
    if (!prev) {
      changes.push({
        type: 'column_added',
        table,
        detail: `"${colName}" (${col.type})`,
      });
    } else if (prev.type !== col.type) {
      changes.push({
        type: 'column_type_changed',
        table,
        detail: `"${colName}" ${prev.type} → ${col.type}`,
      });
    }
  }

  for (const [colName] of beforeCols) {
    if (!afterCols.has(colName)) {
      changes.push({
        type: 'column_removed',
        table,
        detail: `"${colName}"`,
      });
    }
  }
}

function diffForeignKeys(
  table: string,
  before: ITableSnapshot,
  after: ITableSnapshot,
  changes: ISchemaChange[],
): void {
  const fkKey = (f: { fromColumn: string; toTable: string; toColumn: string }) =>
    `${f.fromColumn}->${f.toTable}.${f.toColumn}`;

  const beforeKeys = new Set(before.fks.map(fkKey));
  const afterKeys = new Set(after.fks.map(fkKey));

  for (const fk of after.fks) {
    if (!beforeKeys.has(fkKey(fk))) {
      changes.push({
        type: 'fk_added',
        table,
        detail: `${table}.${fk.fromColumn} → ${fk.toTable}.${fk.toColumn}`,
      });
    }
  }

  for (const fk of before.fks) {
    if (!afterKeys.has(fkKey(fk))) {
      changes.push({
        type: 'fk_removed',
        table,
        detail: `${table}.${fk.fromColumn} → ${fk.toTable}.${fk.toColumn}`,
      });
    }
  }
}
