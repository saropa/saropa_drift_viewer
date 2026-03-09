import * as assert from 'assert';
import {
  computeSchemaDiff,
  generateMigrationSql,
  ISchemaDiffResult,
} from '../schema-diff/schema-diff';
import { IDartColumn, IDartTable } from '../schema-diff/dart-schema';
import { TableMetadata } from '../api-client';

function dartCol(overrides: Partial<IDartColumn> = {}): IDartColumn {
  return {
    dartName: 'id',
    sqlName: 'id',
    dartType: 'IntColumn',
    sqlType: 'INTEGER',
    nullable: false,
    autoIncrement: false,
    line: 0,
    ...overrides,
  };
}

function dartTable(overrides: Partial<IDartTable> = {}): IDartTable {
  return {
    dartClassName: 'Users',
    sqlTableName: 'users',
    columns: [dartCol()],
    fileUri: 'file:///test.dart',
    line: 0,
    ...overrides,
  };
}

function dbMeta(overrides: Partial<TableMetadata> = {}): TableMetadata {
  return {
    name: 'users',
    columns: [{ name: 'id', type: 'INTEGER', pk: true }],
    rowCount: 10,
    ...overrides,
  };
}

describe('computeSchemaDiff', () => {
  it('should identify tables only in code', () => {
    const result = computeSchemaDiff([dartTable()], []);
    assert.strictEqual(result.tablesOnlyInCode.length, 1);
    assert.strictEqual(result.tablesOnlyInCode[0].sqlTableName, 'users');
    assert.strictEqual(result.tablesOnlyInDb.length, 0);
    assert.strictEqual(result.tableDiffs.length, 0);
  });

  it('should identify tables only in DB', () => {
    const result = computeSchemaDiff([], [dbMeta()]);
    assert.strictEqual(result.tablesOnlyInDb.length, 1);
    assert.strictEqual(result.tablesOnlyInDb[0].name, 'users');
    assert.strictEqual(result.tablesOnlyInCode.length, 0);
  });

  it('should match tables in both', () => {
    const result = computeSchemaDiff([dartTable()], [dbMeta()]);
    assert.strictEqual(result.tableDiffs.length, 1);
    assert.strictEqual(result.tableDiffs[0].tableName, 'users');
    assert.strictEqual(result.tablesOnlyInCode.length, 0);
    assert.strictEqual(result.tablesOnlyInDb.length, 0);
  });

  it('should identify columns only in code', () => {
    const code = dartTable({
      columns: [
        dartCol(),
        dartCol({ dartName: 'name', sqlName: 'name', sqlType: 'TEXT' }),
      ],
    });
    const db = dbMeta();
    const result = computeSchemaDiff([code], [db]);
    assert.strictEqual(result.tableDiffs[0].columnsOnlyInCode.length, 1);
    assert.strictEqual(
      result.tableDiffs[0].columnsOnlyInCode[0].sqlName, 'name',
    );
  });

  it('should identify columns only in DB', () => {
    const code = dartTable({ columns: [dartCol()] });
    const db = dbMeta({
      columns: [
        { name: 'id', type: 'INTEGER', pk: true },
        { name: 'extra', type: 'TEXT', pk: false },
      ],
    });
    const result = computeSchemaDiff([code], [db]);
    assert.strictEqual(result.tableDiffs[0].columnsOnlyInDb.length, 1);
    assert.strictEqual(result.tableDiffs[0].columnsOnlyInDb[0].name, 'extra');
  });

  it('should detect type mismatches', () => {
    const code = dartTable({
      columns: [
        dartCol({
          dartName: 'createdAt',
          sqlName: 'created_at',
          sqlType: 'INTEGER',
        }),
      ],
    });
    const db = dbMeta({
      columns: [{ name: 'created_at', type: 'TEXT', pk: false }],
    });
    const result = computeSchemaDiff([code], [db]);
    assert.strictEqual(result.tableDiffs[0].typeMismatches.length, 1);
    assert.strictEqual(
      result.tableDiffs[0].typeMismatches[0].codeType, 'INTEGER',
    );
    assert.strictEqual(
      result.tableDiffs[0].typeMismatches[0].dbType, 'TEXT',
    );
  });

  it('should handle case-insensitive table matching', () => {
    const code = dartTable({ sqlTableName: 'Users' });
    const db = dbMeta({ name: 'users' });
    const result = computeSchemaDiff([code], [db]);
    assert.strictEqual(result.tableDiffs.length, 1);
    assert.strictEqual(result.tablesOnlyInCode.length, 0);
  });

  it('should handle case-insensitive column matching', () => {
    const code = dartTable({
      columns: [dartCol({ sqlName: 'UserName', sqlType: 'TEXT' })],
    });
    const db = dbMeta({
      columns: [{ name: 'username', type: 'TEXT', pk: false }],
    });
    const result = computeSchemaDiff([code], [db]);
    assert.strictEqual(result.tableDiffs[0].matchedColumns, 1);
    assert.strictEqual(result.tableDiffs[0].columnsOnlyInCode.length, 0);
  });

  it('should handle empty inputs', () => {
    const result = computeSchemaDiff([], []);
    assert.strictEqual(result.tablesOnlyInCode.length, 0);
    assert.strictEqual(result.tablesOnlyInDb.length, 0);
    assert.strictEqual(result.tableDiffs.length, 0);
  });

  it('should count matched columns correctly', () => {
    const code = dartTable({
      columns: [
        dartCol({ sqlName: 'id' }),
        dartCol({ sqlName: 'name', sqlType: 'TEXT' }),
      ],
    });
    const db = dbMeta({
      columns: [
        { name: 'id', type: 'INTEGER', pk: true },
        { name: 'name', type: 'TEXT', pk: false },
      ],
    });
    const result = computeSchemaDiff([code], [db]);
    assert.strictEqual(result.tableDiffs[0].matchedColumns, 2);
  });
});

describe('generateMigrationSql', () => {
  it('should generate CREATE TABLE for code-only tables', () => {
    const diff: ISchemaDiffResult = {
      tablesOnlyInCode: [dartTable({
        columns: [
          dartCol({ sqlName: 'id', sqlType: 'INTEGER' }),
          dartCol({ sqlName: 'name', sqlType: 'TEXT' }),
        ],
      })],
      tablesOnlyInDb: [],
      tableDiffs: [],
    };
    const sql = generateMigrationSql(diff);
    assert.ok(sql.includes('CREATE TABLE "users"'));
    assert.ok(sql.includes('"id" INTEGER'));
    assert.ok(sql.includes('"name" TEXT'));
  });

  it('should generate commented DROP TABLE for db-only tables', () => {
    const diff: ISchemaDiffResult = {
      tablesOnlyInCode: [],
      tablesOnlyInDb: [dbMeta({ name: 'old_cache' })],
      tableDiffs: [],
    };
    const sql = generateMigrationSql(diff);
    assert.ok(sql.includes('-- DROP TABLE IF EXISTS "old_cache"'));
    assert.ok(sql.includes('review before running'));
  });

  it('should generate ALTER TABLE ADD COLUMN', () => {
    const diff: ISchemaDiffResult = {
      tablesOnlyInCode: [],
      tablesOnlyInDb: [],
      tableDiffs: [{
        tableName: 'users',
        codeTable: dartTable(),
        columnsOnlyInCode: [
          dartCol({ sqlName: 'email', sqlType: 'TEXT' }),
        ],
        columnsOnlyInDb: [],
        typeMismatches: [],
        matchedColumns: 1,
      }],
    };
    const sql = generateMigrationSql(diff);
    assert.ok(sql.includes('ALTER TABLE "users" ADD COLUMN "email" TEXT'));
  });

  it('should generate comment for orphaned columns', () => {
    const diff: ISchemaDiffResult = {
      tablesOnlyInCode: [],
      tablesOnlyInDb: [],
      tableDiffs: [{
        tableName: 'users',
        codeTable: dartTable(),
        columnsOnlyInCode: [],
        columnsOnlyInDb: [
          { name: 'old_field', type: 'TEXT', pk: false },
        ],
        typeMismatches: [],
        matchedColumns: 1,
      }],
    };
    const sql = generateMigrationSql(diff);
    assert.ok(sql.includes('Orphaned column "old_field"'));
    assert.ok(sql.includes('not in code'));
  });

  it('should generate comment for type mismatches', () => {
    const diff: ISchemaDiffResult = {
      tablesOnlyInCode: [],
      tablesOnlyInDb: [],
      tableDiffs: [{
        tableName: 'posts',
        codeTable: dartTable({ sqlTableName: 'posts' }),
        columnsOnlyInCode: [],
        columnsOnlyInDb: [],
        typeMismatches: [{
          columnName: 'created_at',
          codeType: 'INTEGER',
          dbType: 'TEXT',
          dartColumn: dartCol({ sqlName: 'created_at' }),
        }],
        matchedColumns: 1,
      }],
    };
    const sql = generateMigrationSql(diff);
    assert.ok(sql.includes('Type mismatch'));
    assert.ok(sql.includes('"posts"."created_at"'));
    assert.ok(sql.includes('TEXT in DB'));
    assert.ok(sql.includes('code expects INTEGER'));
  });

  it('should return empty string when no diffs', () => {
    const diff: ISchemaDiffResult = {
      tablesOnlyInCode: [],
      tablesOnlyInDb: [],
      tableDiffs: [],
    };
    const sql = generateMigrationSql(diff);
    assert.strictEqual(sql, '');
  });
});
