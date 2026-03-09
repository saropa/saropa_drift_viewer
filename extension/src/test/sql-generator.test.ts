import * as assert from 'assert';
import { PendingChange } from '../editing/change-tracker';
import { generateSql } from '../editing/sql-generator';

describe('generateSql', () => {
  it('should return a comment for empty changes', () => {
    const sql = generateSql([]);
    assert.ok(sql.includes('No pending changes'));
  });

  it('should generate UPDATE for cell changes', () => {
    const changes: PendingChange[] = [
      {
        kind: 'cell', id: '1', table: 'users', pkColumn: 'id',
        pkValue: 42, column: 'name', oldValue: 'Alice',
        newValue: 'Alice Smith', timestamp: 0,
      },
    ];
    const sql = generateSql(changes);
    assert.ok(sql.includes('UPDATE "users" SET "name" = \'Alice Smith\' WHERE "id" = 42;'));
  });

  it('should generate INSERT for row inserts', () => {
    const changes: PendingChange[] = [
      {
        kind: 'insert', id: '2', table: 'posts',
        values: { title: 'New Post', author_id: 42 }, timestamp: 0,
      },
    ];
    const sql = generateSql(changes);
    assert.ok(sql.includes('INSERT INTO "posts"'));
    assert.ok(sql.includes('"title"'));
    assert.ok(sql.includes("'New Post'"));
    assert.ok(sql.includes('42'));
  });

  it('should generate DELETE for row deletes', () => {
    const changes: PendingChange[] = [
      {
        kind: 'delete', id: '3', table: 'users',
        pkColumn: 'id', pkValue: 99, timestamp: 0,
      },
    ];
    const sql = generateSql(changes);
    assert.ok(sql.includes('DELETE FROM "users" WHERE "id" = 99;'));
  });

  it('should handle NULL values', () => {
    const changes: PendingChange[] = [
      {
        kind: 'cell', id: '4', table: 'users', pkColumn: 'id',
        pkValue: 1, column: 'email', oldValue: 'old@x.com',
        newValue: null, timestamp: 0,
      },
    ];
    const sql = generateSql(changes);
    assert.ok(sql.includes('SET "email" = NULL'));
  });

  it('should handle boolean values as 0/1', () => {
    const changes: PendingChange[] = [
      {
        kind: 'cell', id: '5', table: 'posts', pkColumn: 'id',
        pkValue: 7, column: 'published', oldValue: false,
        newValue: true, timestamp: 0,
      },
    ];
    const sql = generateSql(changes);
    assert.ok(sql.includes('SET "published" = 1'));
  });

  it('should escape single quotes in string values', () => {
    const changes: PendingChange[] = [
      {
        kind: 'cell', id: '6', table: 'users', pkColumn: 'id',
        pkValue: 1, column: 'bio', oldValue: '',
        newValue: "it's a test", timestamp: 0,
      },
    ];
    const sql = generateSql(changes);
    assert.ok(sql.includes("'it''s a test'"));
  });

  it('should group changes by table', () => {
    const changes: PendingChange[] = [
      {
        kind: 'cell', id: '7', table: 'users', pkColumn: 'id',
        pkValue: 1, column: 'name', oldValue: 'A',
        newValue: 'B', timestamp: 0,
      },
      {
        kind: 'delete', id: '8', table: 'posts',
        pkColumn: 'id', pkValue: 5, timestamp: 0,
      },
      {
        kind: 'cell', id: '9', table: 'users', pkColumn: 'id',
        pkValue: 2, column: 'name', oldValue: 'C',
        newValue: 'D', timestamp: 0,
      },
    ];
    const sql = generateSql(changes);
    // users section should appear before posts
    const usersIdx = sql.indexOf('-- users:');
    const postsIdx = sql.indexOf('-- posts:');
    assert.ok(usersIdx >= 0, 'Should have users section');
    assert.ok(postsIdx >= 0, 'Should have posts section');
    assert.ok(usersIdx < postsIdx, 'users should appear before posts');
    // Both users UPDATEs should be in the users section
    assert.ok(sql.includes('-- users: 2 change(s)'));
    assert.ok(sql.includes('-- posts: 1 change(s)'));
  });

  it('should include header comment with change count', () => {
    const changes: PendingChange[] = [
      {
        kind: 'delete', id: '10', table: 't',
        pkColumn: 'id', pkValue: 1, timestamp: 0,
      },
    ];
    const sql = generateSql(changes);
    assert.ok(sql.includes('Generated SQL (1 change(s))'));
    assert.ok(sql.includes('Review carefully'));
  });

  it('should handle string PK values', () => {
    const changes: PendingChange[] = [
      {
        kind: 'cell', id: '11', table: 'config', pkColumn: 'key',
        pkValue: 'theme', column: 'value', oldValue: 'light',
        newValue: 'dark', timestamp: 0,
      },
    ];
    const sql = generateSql(changes);
    assert.ok(sql.includes("WHERE \"key\" = 'theme'"));
  });

  it('should handle undefined values as NULL', () => {
    const changes: PendingChange[] = [
      {
        kind: 'cell', id: '12', table: 't', pkColumn: 'id',
        pkValue: 1, column: 'c', oldValue: 'x',
        newValue: undefined, timestamp: 0,
      },
    ];
    const sql = generateSql(changes);
    assert.ok(sql.includes('SET "c" = NULL'));
  });

  it('should handle INSERT with null values', () => {
    const changes: PendingChange[] = [
      {
        kind: 'insert', id: '13', table: 'users',
        values: { name: 'Alice', email: null }, timestamp: 0,
      },
    ];
    const sql = generateSql(changes);
    assert.ok(sql.includes("'Alice'"));
    assert.ok(sql.includes('NULL'));
  });
});
