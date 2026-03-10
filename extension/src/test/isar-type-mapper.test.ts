import * as assert from 'assert';
import { mapIsarToDrift } from '../isar-gen/isar-type-mapper';
import {
  defaultIsarGenConfig,
  IIsarCollection,
  IIsarEmbedded,
} from '../isar-gen/isar-gen-types';

/** Helper to create a minimal collection. */
function coll(
  className: string,
  fields: IIsarCollection['fields'],
  links: IIsarCollection['links'] = [],
  indexes: IIsarCollection['indexes'] = [],
): IIsarCollection {
  return { className, fields, links, indexes, fileUri: 'test.dart', line: 0 };
}

describe('IsarTypeMapper', () => {
  it('should map Id to integer().autoIncrement()', () => {
    const result = mapIsarToDrift(
      [coll('User', [
        { name: 'id', dartType: 'Id', isNullable: false, isId: true, isIgnored: false, line: 0 },
      ])],
      [],
      defaultIsarGenConfig(),
    );
    const col = result.tables[0].columns[0];
    assert.strictEqual(col.columnType, 'IntColumn');
    assert.ok(col.builderChain.includes('autoIncrement'));
  });

  it('should map String to TextColumn', () => {
    const result = mapIsarToDrift(
      [coll('User', [
        { name: 'id', dartType: 'Id', isNullable: false, isId: true, isIgnored: false, line: 0 },
        { name: 'name', dartType: 'String', isNullable: false, isId: false, isIgnored: false, line: 1 },
      ])],
      [],
      defaultIsarGenConfig(),
    );
    const col = result.tables[0].columns[1];
    assert.strictEqual(col.columnType, 'TextColumn');
    assert.strictEqual(col.builderChain, 'text()');
  });

  it('should map int to IntColumn', () => {
    const result = mapIsarToDrift(
      [coll('User', [
        { name: 'age', dartType: 'int', isNullable: false, isId: false, isIgnored: false, line: 0 },
      ])],
      [],
      defaultIsarGenConfig(),
    );
    assert.strictEqual(result.tables[0].columns[0].columnType, 'IntColumn');
  });

  it('should map double to RealColumn', () => {
    const result = mapIsarToDrift(
      [coll('Item', [
        { name: 'price', dartType: 'double', isNullable: false, isId: false, isIgnored: false, line: 0 },
      ])],
      [],
      defaultIsarGenConfig(),
    );
    assert.strictEqual(result.tables[0].columns[0].columnType, 'RealColumn');
  });

  it('should map bool to BoolColumn', () => {
    const result = mapIsarToDrift(
      [coll('Task', [
        { name: 'done', dartType: 'bool', isNullable: false, isId: false, isIgnored: false, line: 0 },
      ])],
      [],
      defaultIsarGenConfig(),
    );
    assert.strictEqual(result.tables[0].columns[0].columnType, 'BoolColumn');
  });

  it('should map DateTime to DateTimeColumn', () => {
    const result = mapIsarToDrift(
      [coll('Event', [
        { name: 'date', dartType: 'DateTime', isNullable: false, isId: false, isIgnored: false, line: 0 },
      ])],
      [],
      defaultIsarGenConfig(),
    );
    assert.strictEqual(result.tables[0].columns[0].columnType, 'DateTimeColumn');
  });

  it('should add .nullable() for nullable fields', () => {
    const result = mapIsarToDrift(
      [coll('User', [
        { name: 'bio', dartType: 'String', isNullable: true, isId: false, isIgnored: false, line: 0 },
      ])],
      [],
      defaultIsarGenConfig(),
    );
    assert.ok(result.tables[0].columns[0].builderChain.includes('.nullable()'));
  });

  it('should skip @ignore fields', () => {
    const result = mapIsarToDrift(
      [coll('User', [
        { name: 'id', dartType: 'Id', isNullable: false, isId: true, isIgnored: false, line: 0 },
        { name: 'temp', dartType: 'int', isNullable: false, isId: false, isIgnored: true, line: 1 },
      ])],
      [],
      defaultIsarGenConfig(),
    );
    assert.strictEqual(result.tables[0].columns.length, 1);
  });

  it('should map IsarLink to nullable IntColumn FK', () => {
    const result = mapIsarToDrift(
      [coll('Post', [
        { name: 'id', dartType: 'Id', isNullable: false, isId: true, isIgnored: false, line: 0 },
      ], [
        { propertyName: 'author', targetCollection: 'User', isMulti: false, isBacklink: false, line: 1 },
      ])],
      [],
      defaultIsarGenConfig(),
    );
    const fk = result.tables[0].columns.find((c) => c.getterName === 'author_id');
    assert.ok(fk);
    assert.strictEqual(fk.columnType, 'IntColumn');
    assert.ok(fk.builderChain.includes('nullable'));
    assert.ok(fk.comment?.includes('User'));
  });

  it('should create junction table for IsarLinks', () => {
    const result = mapIsarToDrift(
      [coll('Teacher', [
        { name: 'id', dartType: 'Id', isNullable: false, isId: true, isIgnored: false, line: 0 },
      ], [
        { propertyName: 'students', targetCollection: 'Student', isMulti: true, isBacklink: false, line: 1 },
      ])],
      [],
      defaultIsarGenConfig(),
    );
    assert.strictEqual(result.junctionTables.length, 1);
    const jt = result.junctionTables[0];
    assert.strictEqual(jt.tableName, 'teacher_students');
    assert.strictEqual(jt.columns.length, 2);
    assert.ok(jt.isJunctionTable);
  });

  it('should skip @Backlink links', () => {
    const result = mapIsarToDrift(
      [coll('User', [
        { name: 'id', dartType: 'Id', isNullable: false, isId: true, isIgnored: false, line: 0 },
      ], [
        { propertyName: 'posts', targetCollection: 'Post', isMulti: true, isBacklink: true, backlinkTo: 'author', line: 1 },
      ])],
      [],
      defaultIsarGenConfig(),
    );
    assert.strictEqual(result.junctionTables.length, 0);
    assert.strictEqual(result.skippedBacklinks.length, 1);
    assert.ok(result.skippedBacklinks[0].includes('Backlink'));
  });

  it('should map embedded to TextColumn (JSON mode)', () => {
    const embedded: IIsarEmbedded = {
      className: 'Address', fields: [
        { name: 'street', dartType: 'String', isNullable: false, isId: false, isIgnored: false, line: 0 },
      ], fileUri: 'test.dart', line: 0,
    };
    const result = mapIsarToDrift(
      [coll('User', [
        { name: 'address', dartType: 'Address', isNullable: false, isId: false, isIgnored: false, line: 0 },
      ])],
      [embedded],
      { ...defaultIsarGenConfig(), embeddedStrategy: 'json' },
    );
    assert.strictEqual(result.tables[0].columns[0].columnType, 'TextColumn');
    assert.ok(result.tables[0].columns[0].comment?.includes('JSON'));
  });

  it('should flatten embedded fields (flatten mode)', () => {
    const embedded: IIsarEmbedded = {
      className: 'Address', fields: [
        { name: 'street', dartType: 'String', isNullable: false, isId: false, isIgnored: false, line: 0 },
        { name: 'city', dartType: 'String', isNullable: false, isId: false, isIgnored: false, line: 1 },
      ], fileUri: 'test.dart', line: 0,
    };
    const result = mapIsarToDrift(
      [coll('User', [
        { name: 'address', dartType: 'Address', isNullable: false, isId: false, isIgnored: false, line: 0 },
      ])],
      [embedded],
      { ...defaultIsarGenConfig(), embeddedStrategy: 'flatten' },
    );
    assert.strictEqual(result.tables[0].columns.length, 2);
    assert.strictEqual(result.tables[0].columns[0].getterName, 'address_street');
    assert.strictEqual(result.tables[0].columns[1].getterName, 'address_city');
  });

  it('should map ordinal enum to IntColumn', () => {
    const result = mapIsarToDrift(
      [coll('Task', [
        { name: 'priority', dartType: 'Priority', isNullable: false, isId: false, isIgnored: false, enumerated: 'ordinal', line: 0 },
      ])],
      [],
      defaultIsarGenConfig(),
    );
    assert.strictEqual(result.tables[0].columns[0].columnType, 'IntColumn');
  });

  it('should map name enum to TextColumn', () => {
    const result = mapIsarToDrift(
      [coll('Config', [
        { name: 'theme', dartType: 'Theme', isNullable: false, isId: false, isIgnored: false, enumerated: 'name', line: 0 },
      ])],
      [],
      defaultIsarGenConfig(),
    );
    assert.strictEqual(result.tables[0].columns[0].columnType, 'TextColumn');
  });

  it('should warn for List fields', () => {
    const result = mapIsarToDrift(
      [coll('Article', [
        { name: 'tags', dartType: 'List<String>', isNullable: false, isId: false, isIgnored: false, line: 0 },
      ])],
      [],
      defaultIsarGenConfig(),
    );
    assert.strictEqual(result.tables[0].columns[0].columnType, 'TextColumn');
    assert.ok(result.warnings.some((w) => w.includes('tags')));
  });

  it('should map unique indexes', () => {
    const result = mapIsarToDrift(
      [coll('User', [
        { name: 'email', dartType: 'String', isNullable: false, isId: false, isIgnored: false, line: 0 },
      ], [], [
        { properties: ['email'], unique: true, caseSensitive: true, indexType: 'value' },
      ])],
      [],
      defaultIsarGenConfig(),
    );
    assert.strictEqual(result.tables[0].indexes.length, 1);
    assert.ok(result.tables[0].indexes[0].unique);
  });

  it('should use @Name override for collection', () => {
    const result = mapIsarToDrift(
      [coll('UserModel', [
        { name: 'id', dartType: 'Id', isNullable: false, isId: true, isIgnored: false, line: 0 },
      ])],
      [],
      defaultIsarGenConfig(),
    );
    // customName not set → uses className
    assert.strictEqual(result.tables[0].className, 'UserModel');

    const c = coll('UserModel', [
      { name: 'id', dartType: 'Id', isNullable: false, isId: true, isIgnored: false, line: 0 },
    ]);
    c.customName = 'users';
    const result2 = mapIsarToDrift([c], [], defaultIsarGenConfig());
    assert.strictEqual(result2.tables[0].className, 'users');
  });
});
