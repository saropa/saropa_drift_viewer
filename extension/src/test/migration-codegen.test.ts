import * as assert from 'assert';
import {
  diffToActions,
  generateMigrationDart,
} from '../migration-gen/migration-codegen';
import { ISchemaDiffResult } from '../schema-diff/schema-diff';
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

function emptyDiff(): ISchemaDiffResult {
  return {
    tablesOnlyInCode: [],
    tablesOnlyInDb: [],
    tableDiffs: [],
  };
}

describe('diffToActions', () => {
  it('should create createTable actions for code-only tables', () => {
    const diff = emptyDiff();
    diff.tablesOnlyInCode = [dartTable({
      columns: [
        dartCol({ sqlName: 'id', sqlType: 'INTEGER' }),
        dartCol({ sqlName: 'name', sqlType: 'TEXT', nullable: true }),
      ],
    })];
    const actions = diffToActions(diff);
    assert.strictEqual(actions.length, 1);
    assert.strictEqual(actions[0].type, 'createTable');
    assert.strictEqual(actions[0].table, 'users');
    assert.strictEqual(actions[0].columns?.length, 2);
  });

  it('should create dropTable actions for db-only tables', () => {
    const diff = emptyDiff();
    diff.tablesOnlyInDb = [dbMeta({ name: 'old_cache' })];
    const actions = diffToActions(diff);
    assert.strictEqual(actions.length, 1);
    assert.strictEqual(actions[0].type, 'dropTable');
    assert.strictEqual(actions[0].table, 'old_cache');
  });

  it('should create addColumn actions for code-only columns', () => {
    const diff = emptyDiff();
    diff.tableDiffs = [{
      tableName: 'users',
      codeTable: dartTable(),
      columnsOnlyInCode: [
        dartCol({ sqlName: 'email', sqlType: 'TEXT', nullable: true }),
      ],
      columnsOnlyInDb: [],
      typeMismatches: [],
      matchedColumns: 1,
    }];
    const actions = diffToActions(diff);
    assert.strictEqual(actions.length, 1);
    assert.strictEqual(actions[0].type, 'addColumn');
    assert.strictEqual(actions[0].column, 'email');
    assert.strictEqual(actions[0].nullable, true);
  });

  it('should create dropColumn actions for db-only columns', () => {
    const diff = emptyDiff();
    diff.tableDiffs = [{
      tableName: 'users',
      codeTable: dartTable(),
      columnsOnlyInCode: [],
      columnsOnlyInDb: [
        { name: 'legacy', type: 'TEXT', pk: false },
      ],
      typeMismatches: [],
      matchedColumns: 1,
    }];
    const actions = diffToActions(diff);
    assert.strictEqual(actions.length, 1);
    assert.strictEqual(actions[0].type, 'dropColumn');
    assert.strictEqual(actions[0].column, 'legacy');
  });

  it('should create changeType actions for type mismatches', () => {
    const diff = emptyDiff();
    diff.tableDiffs = [{
      tableName: 'orders',
      codeTable: dartTable({ sqlTableName: 'orders' }),
      columnsOnlyInCode: [],
      columnsOnlyInDb: [],
      typeMismatches: [{
        columnName: 'total',
        codeType: 'REAL',
        dbType: 'TEXT',
        dartColumn: dartCol({ sqlName: 'total' }),
      }],
      matchedColumns: 1,
    }];
    const actions = diffToActions(diff);
    assert.strictEqual(actions.length, 1);
    assert.strictEqual(actions[0].type, 'changeType');
    assert.strictEqual(actions[0].oldType, 'TEXT');
    assert.strictEqual(actions[0].newType, 'REAL');
  });

  it('should order: creates, alters, drops', () => {
    const diff: ISchemaDiffResult = {
      tablesOnlyInCode: [dartTable({ sqlTableName: 'new_table' })],
      tablesOnlyInDb: [dbMeta({ name: 'old_table' })],
      tableDiffs: [{
        tableName: 'users',
        codeTable: dartTable(),
        columnsOnlyInCode: [
          dartCol({ sqlName: 'phone', sqlType: 'TEXT' }),
        ],
        columnsOnlyInDb: [],
        typeMismatches: [],
        matchedColumns: 1,
      }],
    };
    const actions = diffToActions(diff);
    assert.strictEqual(actions[0].type, 'createTable');
    assert.strictEqual(actions[1].type, 'addColumn');
    assert.strictEqual(actions[2].type, 'dropTable');
  });

  it('should return empty array for empty diff', () => {
    assert.strictEqual(diffToActions(emptyDiff()).length, 0);
  });
});

describe('generateMigrationDart', () => {
  it('should generate CREATE TABLE with columns', () => {
    const diff = emptyDiff();
    diff.tablesOnlyInCode = [dartTable({
      sqlTableName: 'audit_log',
      columns: [
        dartCol({ sqlName: 'id', sqlType: 'INTEGER', autoIncrement: true }),
        dartCol({ sqlName: 'action', sqlType: 'TEXT' }),
      ],
    })];
    const code = generateMigrationDart(diff, 4, 5);
    assert.ok(code.includes("import 'package:drift/drift.dart'"));
    assert.ok(code.includes('v4 to v5'));
    assert.ok(code.includes('CREATE TABLE "audit_log"'));
    assert.ok(code.includes('"id" INTEGER PRIMARY KEY'));
    assert.ok(code.includes('"action" TEXT NOT NULL'));
  });

  it('should generate ALTER TABLE ADD COLUMN', () => {
    const diff = emptyDiff();
    diff.tableDiffs = [{
      tableName: 'users',
      codeTable: dartTable(),
      columnsOnlyInCode: [
        dartCol({ sqlName: 'email', sqlType: 'TEXT', nullable: true }),
      ],
      columnsOnlyInDb: [],
      typeMismatches: [],
      matchedColumns: 1,
    }];
    const code = generateMigrationDart(diff, 1, 2);
    assert.ok(code.includes('ALTER TABLE "users"'));
    assert.ok(code.includes('ADD COLUMN "email" TEXT'));
  });

  it('should generate DROP COLUMN with SQLite warning', () => {
    const diff = emptyDiff();
    diff.tableDiffs = [{
      tableName: 'users',
      codeTable: dartTable(),
      columnsOnlyInCode: [],
      columnsOnlyInDb: [
        { name: 'old_field', type: 'TEXT', pk: false },
      ],
      typeMismatches: [],
      matchedColumns: 1,
    }];
    const code = generateMigrationDart(diff, 1, 2);
    assert.ok(code.includes('DROP COLUMN "old_field"'));
    assert.ok(code.includes('SQLite < 3.35'));
  });

  it('should generate DROP TABLE with data warning', () => {
    const diff = emptyDiff();
    diff.tablesOnlyInDb = [dbMeta({ name: 'legacy' })];
    const code = generateMigrationDart(diff, 2, 3);
    assert.ok(code.includes('DROP TABLE IF EXISTS "legacy"'));
    assert.ok(code.includes('WARNING'));
  });

  it('should generate type change warning comment', () => {
    const diff = emptyDiff();
    diff.tableDiffs = [{
      tableName: 'orders',
      codeTable: dartTable({ sqlTableName: 'orders' }),
      columnsOnlyInCode: [],
      columnsOnlyInDb: [],
      typeMismatches: [{
        columnName: 'total',
        codeType: 'REAL',
        dbType: 'TEXT',
        dartColumn: dartCol({ sqlName: 'total' }),
      }],
      matchedColumns: 1,
    }];
    const code = generateMigrationDart(diff, 1, 2);
    assert.ok(code.includes('Type change: orders.total'));
    assert.ok(code.includes('ALTER COLUMN'));
  });

  it('should return empty string for empty diff', () => {
    assert.strictEqual(generateMigrationDart(emptyDiff(), 1, 2), '');
  });

  it('should handle multiple changes together', () => {
    const diff: ISchemaDiffResult = {
      tablesOnlyInCode: [dartTable({
        sqlTableName: 'audit',
        columns: [dartCol({ sqlName: 'id', sqlType: 'INTEGER' })],
      })],
      tablesOnlyInDb: [dbMeta({ name: 'cache' })],
      tableDiffs: [{
        tableName: 'users',
        codeTable: dartTable(),
        columnsOnlyInCode: [
          dartCol({ sqlName: 'phone', sqlType: 'TEXT', nullable: true }),
        ],
        columnsOnlyInDb: [],
        typeMismatches: [],
        matchedColumns: 1,
      }],
    };
    const code = generateMigrationDart(diff, 3, 4);
    assert.ok(code.includes('CREATE TABLE "audit"'));
    assert.ok(code.includes('ADD COLUMN "phone"'));
    assert.ok(code.includes('DROP TABLE IF EXISTS "cache"'));
  });

  it('should add NOT NULL default for non-nullable add column', () => {
    const diff = emptyDiff();
    diff.tableDiffs = [{
      tableName: 'users',
      codeTable: dartTable(),
      columnsOnlyInCode: [
        dartCol({
          sqlName: 'status',
          sqlType: 'TEXT',
          nullable: false,
        }),
      ],
      columnsOnlyInDb: [],
      typeMismatches: [],
      matchedColumns: 1,
    }];
    const code = generateMigrationDart(diff, 1, 2);
    assert.ok(code.includes("NOT NULL DEFAULT ''"));
  });
});
