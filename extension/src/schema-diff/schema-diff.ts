/**
 * Diff algorithm: compare parsed Dart schema against runtime SQLite schema.
 * Also generates migration SQL from the diff result.
 */

import { IDartColumn, IDartTable } from './dart-schema';
import { ColumnMetadata, TableMetadata } from '../api-client';

/** A type mismatch between code and runtime for a single column. */
export interface ITypeMismatch {
  columnName: string;
  codeType: string;
  dbType: string;
  dartColumn: IDartColumn;
}

/** Diff result for a single table that exists in both code and DB. */
export interface ITableColumnDiff {
  tableName: string;
  codeTable: IDartTable;
  columnsOnlyInCode: IDartColumn[];
  columnsOnlyInDb: ColumnMetadata[];
  typeMismatches: ITypeMismatch[];
  matchedColumns: number;
}

/** Full schema diff result across all tables. */
export interface ISchemaDiffResult {
  tablesOnlyInCode: IDartTable[];
  tablesOnlyInDb: TableMetadata[];
  tableDiffs: ITableColumnDiff[];
}

/** Whether the diff contains any actionable differences. */
export function hasDifferences(diff: ISchemaDiffResult): boolean {
  if (diff.tablesOnlyInCode.length > 0) return true;
  if (diff.tablesOnlyInDb.length > 0) return true;
  return diff.tableDiffs.some(
    (td) =>
      td.columnsOnlyInCode.length > 0
      || td.columnsOnlyInDb.length > 0
      || td.typeMismatches.length > 0,
  );
}

/** Compare parsed Dart tables against runtime schema metadata. */
export function computeSchemaDiff(
  codeTables: IDartTable[],
  runtimeTables: TableMetadata[],
): ISchemaDiffResult {
  const codeMap = new Map<string, IDartTable>();
  for (const t of codeTables) {
    codeMap.set(t.sqlTableName.toLowerCase(), t);
  }

  const dbMap = new Map<string, TableMetadata>();
  for (const t of runtimeTables) {
    dbMap.set(t.name.toLowerCase(), t);
  }

  const tablesOnlyInCode: IDartTable[] = [];
  const tableDiffs: ITableColumnDiff[] = [];

  for (const [key, codeTable] of codeMap) {
    const dbTable = dbMap.get(key);
    if (!dbTable) {
      tablesOnlyInCode.push(codeTable);
      continue;
    }
    tableDiffs.push(diffColumns(codeTable, dbTable));
  }

  const tablesOnlyInDb: TableMetadata[] = [];
  for (const [key, dbTable] of dbMap) {
    if (!codeMap.has(key)) {
      tablesOnlyInDb.push(dbTable);
    }
  }

  return { tablesOnlyInCode, tablesOnlyInDb, tableDiffs };
}

/** Diff columns for a table that exists in both code and DB. */
function diffColumns(
  codeTable: IDartTable,
  dbTable: TableMetadata,
): ITableColumnDiff {
  const codeColMap = new Map<string, IDartColumn>();
  for (const c of codeTable.columns) {
    codeColMap.set(c.sqlName.toLowerCase(), c);
  }

  const dbColMap = new Map<string, ColumnMetadata>();
  for (const c of dbTable.columns) {
    dbColMap.set(c.name.toLowerCase(), c);
  }

  const columnsOnlyInCode: IDartColumn[] = [];
  const typeMismatches: ITypeMismatch[] = [];
  let matchedColumns = 0;

  for (const [key, codeCol] of codeColMap) {
    const dbCol = dbColMap.get(key);
    if (!dbCol) {
      columnsOnlyInCode.push(codeCol);
      continue;
    }
    matchedColumns++;
    if (codeCol.sqlType.toUpperCase() !== dbCol.type.toUpperCase()) {
      typeMismatches.push({
        columnName: codeCol.sqlName,
        codeType: codeCol.sqlType,
        dbType: dbCol.type,
        dartColumn: codeCol,
      });
    }
  }

  const columnsOnlyInDb: ColumnMetadata[] = [];
  for (const [key, dbCol] of dbColMap) {
    if (!codeColMap.has(key)) {
      columnsOnlyInDb.push(dbCol);
    }
  }

  return {
    tableName: dbTable.name,
    codeTable,
    columnsOnlyInCode,
    columnsOnlyInDb,
    typeMismatches,
    matchedColumns,
  };
}

/** Generate migration SQL statements from a diff result. */
export function generateMigrationSql(diff: ISchemaDiffResult): string {
  const lines: string[] = [];

  for (const table of diff.tablesOnlyInCode) {
    const cols = table.columns
      .map((c) => `  "${c.sqlName}" ${c.sqlType}`)
      .join(',\n');
    lines.push(`CREATE TABLE "${table.sqlTableName}" (\n${cols}\n);`);
    lines.push('');
  }

  for (const table of diff.tablesOnlyInDb) {
    lines.push(
      `-- DROP TABLE IF EXISTS "${table.name}";`
      + ' -- review before running',
    );
  }

  for (const td of diff.tableDiffs) {
    for (const col of td.columnsOnlyInCode) {
      lines.push(
        `ALTER TABLE "${td.tableName}"`
        + ` ADD COLUMN "${col.sqlName}" ${col.sqlType};`,
      );
    }
    for (const col of td.columnsOnlyInDb) {
      lines.push(
        `-- Orphaned column "${col.name}" in "${td.tableName}"`
        + ' -- not in code',
      );
    }
    for (const m of td.typeMismatches) {
      lines.push(
        `-- Type mismatch: "${td.tableName}"."${m.columnName}"`
        + ` is ${m.dbType} in DB, code expects ${m.codeType}`,
      );
    }
  }

  return lines.join('\n');
}

/** Generate CREATE TABLE statements for all Dart-defined tables. */
export function generateFullSchemaSql(
  codeTables: IDartTable[],
): string {
  if (codeTables.length === 0) return '';

  return codeTables
    .map((table) => {
      const cols = table.columns
        .map((c) => `  "${c.sqlName}" ${c.sqlType}`)
        .join(',\n');
      return `CREATE TABLE "${table.sqlTableName}" (\n${cols}\n);`;
    })
    .join('\n\n');
}
