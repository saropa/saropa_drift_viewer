import * as assert from 'assert';
import { generateDriftSource } from '../isar-gen/isar-drift-codegen';
import {
  defaultIsarGenConfig,
  IIsarMappingResult,
} from '../isar-gen/isar-gen-types';

/** Minimal mapping result helper. */
function result(
  overrides: Partial<IIsarMappingResult> = {},
): IIsarMappingResult {
  return {
    tables: [],
    junctionTables: [],
    warnings: [],
    skippedBacklinks: [],
    ...overrides,
  };
}

describe('IsarDriftCodegen', () => {
  it('should include drift import header', () => {
    const src = generateDriftSource(result(), defaultIsarGenConfig());
    assert.ok(src.includes("import 'package:drift/drift.dart';"));
  });

  it('should include generation comment header', () => {
    const src = generateDriftSource(result(), defaultIsarGenConfig());
    assert.ok(src.includes('Generated from Isar schema'));
  });

  it('should generate a simple table class', () => {
    const src = generateDriftSource(
      result({
        tables: [{
          className: 'User',
          columns: [
            { getterName: 'id', columnType: 'IntColumn', builderChain: 'integer().autoIncrement()' },
            { getterName: 'name', columnType: 'TextColumn', builderChain: 'text()' },
          ],
          primaryKeyColumns: ['id'],
          indexes: [],
          isJunctionTable: false,
          sourceCollection: 'User',
        }],
      }),
      defaultIsarGenConfig(),
    );
    assert.ok(src.includes('class UserTable extends Table'));
    assert.ok(src.includes('IntColumn get id => integer().autoIncrement()'));
    assert.ok(src.includes('TextColumn get name => text()'));
  });

  it('should generate nullable column', () => {
    const src = generateDriftSource(
      result({
        tables: [{
          className: 'Post',
          columns: [
            { getterName: 'subtitle', columnType: 'TextColumn', builderChain: 'text.nullable()' },
          ],
          primaryKeyColumns: [],
          indexes: [],
          isJunctionTable: false,
        }],
      }),
      defaultIsarGenConfig(),
    );
    assert.ok(src.includes('text.nullable()'));
  });

  it('should generate FK comment for IsarLink columns', () => {
    const config = defaultIsarGenConfig();
    const src = generateDriftSource(
      result({
        tables: [{
          className: 'Post',
          columns: [
            { getterName: 'author_id', columnType: 'IntColumn', builderChain: 'integer().nullable()', comment: 'FK → User.id (from IsarLink)' },
          ],
          primaryKeyColumns: [],
          indexes: [],
          isJunctionTable: false,
        }],
      }),
      config,
    );
    assert.ok(src.includes('FK'));
    assert.ok(src.includes('User.id'));
  });

  it('should generate junction table for IsarLinks', () => {
    const src = generateDriftSource(
      result({
        junctionTables: [{
          className: 'teacher_students',
          tableName: 'teacher_students',
          columns: [
            { getterName: 'teacher_id', columnType: 'IntColumn', builderChain: 'integer()' },
            { getterName: 'student_id', columnType: 'IntColumn', builderChain: 'integer()' },
          ],
          primaryKeyColumns: ['teacher_id', 'student_id'],
          indexes: [],
          isJunctionTable: true,
          sourceCollection: 'Teacher',
        }],
      }),
      defaultIsarGenConfig(),
    );
    assert.ok(src.includes('class TeacherStudents extends Table'));
    assert.ok(src.includes("get tableName => 'teacher_students'"));
    assert.ok(src.includes('get primaryKey => {teacherId, studentId}'));
  });

  it('should generate uniqueKeys for unique indexes', () => {
    const src = generateDriftSource(
      result({
        tables: [{
          className: 'User',
          columns: [
            { getterName: 'email', columnType: 'TextColumn', builderChain: 'text()' },
          ],
          primaryKeyColumns: [],
          indexes: [{ columns: ['email'], unique: true }],
          isJunctionTable: false,
        }],
      }),
      defaultIsarGenConfig(),
    );
    assert.ok(src.includes('uniqueKeys'));
    assert.ok(src.includes('{email}'));
  });

  it('should omit comments when includeComments is false', () => {
    const config = { ...defaultIsarGenConfig(), includeComments: false };
    const src = generateDriftSource(
      result({
        tables: [{
          className: 'User',
          columns: [
            { getterName: 'name', columnType: 'TextColumn', builderChain: 'text()', comment: 'some comment' },
          ],
          primaryKeyColumns: [],
          indexes: [],
          isJunctionTable: false,
          sourceCollection: 'User',
        }],
      }),
      config,
    );
    assert.ok(!src.includes('some comment'));
    // Should also not include the @collection doc comment
    assert.ok(!src.includes('Generated from Isar @collection'));
  });

  it('should append warnings as comments', () => {
    const src = generateDriftSource(
      result({
        warnings: ['List<int> on scores serialized as JSON'],
      }),
      defaultIsarGenConfig(),
    );
    assert.ok(src.includes('WARNING: List<int>'));
  });

  it('should append skipped backlinks as comments', () => {
    const src = generateDriftSource(
      result({
        skippedBacklinks: ['User.posts (@Backlink)'],
      }),
      defaultIsarGenConfig(),
    );
    assert.ok(src.includes('SKIPPED: User.posts'));
  });

  it('should handle empty collection (no fields)', () => {
    const src = generateDriftSource(
      result({
        tables: [{
          className: 'Empty',
          columns: [],
          primaryKeyColumns: [],
          indexes: [],
          isJunctionTable: false,
        }],
      }),
      defaultIsarGenConfig(),
    );
    assert.ok(src.includes('class EmptyTable extends Table'));
    assert.ok(src.includes('}'));
  });
});
