import * as assert from 'assert';
import { ConstraintCodegen } from '../constraint-wizard/constraint-codegen';
import type {
  IConstraintDraft,
} from '../constraint-wizard/constraint-types';

describe('ConstraintCodegen', () => {
  const codegen = new ConstraintCodegen();

  it('should generate CREATE UNIQUE INDEX in Dart', () => {
    const dart = codegen.generateDart([
      { id: 'c1', kind: 'unique', table: 'users', columns: ['email'] },
    ]);
    assert.ok(dart.includes('CREATE UNIQUE INDEX'));
    assert.ok(dart.includes('"uq_users_email"'));
    assert.ok(dart.includes('ON "users"("email")'));
    assert.ok(dart.includes('customStatement'));
  });

  it('should generate CREATE UNIQUE INDEX in SQL', () => {
    const sql = codegen.generateSql([
      { id: 'c1', kind: 'unique', table: 'users', columns: ['email'] },
    ]);
    assert.ok(sql.includes('CREATE UNIQUE INDEX'));
    assert.ok(sql.includes('"uq_users_email"'));
    assert.ok(sql.includes('ON "users"("email")'));
  });

  it('should generate comment for CHECK in Dart', () => {
    const dart = codegen.generateDart([
      {
        id: 'c2', kind: 'check', table: 'users',
        expression: 'age >= 0',
      },
    ]);
    assert.ok(dart.includes('SQLite does not support'));
    assert.ok(dart.includes('age >= 0'));
  });

  it('should generate comment for CHECK in SQL', () => {
    const sql = codegen.generateSql([
      {
        id: 'c2', kind: 'check', table: 'users',
        expression: 'age >= 0',
      },
    ]);
    assert.ok(sql.includes('CHECK: age >= 0'));
    assert.ok(sql.includes('Requires table recreation'));
  });

  it('should generate comment for NOT NULL in Dart', () => {
    const dart = codegen.generateDart([
      { id: 'c3', kind: 'not_null', table: 'users', column: 'phone' },
    ]);
    assert.ok(dart.includes('SQLite does not support'));
    assert.ok(dart.includes('"phone"'));
  });

  it('should generate comment for NOT NULL in SQL', () => {
    const sql = codegen.generateSql([
      { id: 'c3', kind: 'not_null', table: 'users', column: 'phone' },
    ]);
    assert.ok(sql.includes('NOT NULL on "phone"'));
    assert.ok(sql.includes('Requires table recreation'));
  });

  it('should combine multiple constraints', () => {
    const drafts: IConstraintDraft[] = [
      { id: 'c1', kind: 'unique', table: 'users', columns: ['email'] },
      { id: 'c2', kind: 'check', table: 'users', expression: 'age>0' },
      { id: 'c3', kind: 'not_null', table: 'users', column: 'phone' },
    ];
    const dart = codegen.generateDart(drafts);
    assert.ok(dart.includes('3 new constraint(s)'));
    assert.ok(dart.includes('CREATE UNIQUE INDEX'));
    assert.ok(dart.includes('CHECK expression'));
    assert.ok(dart.includes('"phone"'));
  });

  it('should properly quote column names', () => {
    const sql = codegen.generateSql([
      {
        id: 'c1', kind: 'unique', table: 'my table',
        columns: ['my col'],
      },
    ]);
    assert.ok(sql.includes('"my col"'));
    assert.ok(sql.includes('"my table"'));
  });
});
