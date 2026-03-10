import * as assert from 'assert';
import { DartTestRenderer, escDart, dartString } from '../test-gen/dart-test-renderer';
import type { IAssertion } from '../test-gen/test-gen-types';

function renderer(): DartTestRenderer {
  return new DartTestRenderer();
}

describe('DartTestRenderer', () => {
  it('should render boilerplate with no assertions', () => {
    const code = renderer().render([]);

    assert.ok(code.includes("import 'package:flutter_test/flutter_test.dart'"));
    assert.ok(code.includes('void main()'));
    assert.ok(code.includes('Future<List<Map<String, dynamic>>>'));
    assert.ok(!code.includes("group("));
  });

  it('should group row count assertions', () => {
    const assertions: IAssertion[] = [
      {
        type: 'rowCount',
        table: 'users',
        sql: 'SELECT COUNT(*) AS cnt FROM "users"',
        expectation: 'equals 42',
        reason: 'Current row count is 42',
        confidence: 'high',
      },
    ];
    const code = renderer().render(assertions);

    assert.ok(code.includes("group('Row counts'"));
    assert.ok(code.includes("test('users has 42 rows'"));
    assert.ok(code.includes("expect(result.first['cnt'], 42)"));
  });

  it('should render FK integrity assertions', () => {
    const assertions: IAssertion[] = [
      {
        type: 'fkIntegrity',
        table: 'orders',
        column: 'user_id',
        sql: 'SELECT a.rowid FROM "orders" a LEFT JOIN "users" b ON a."user_id" = b."id" WHERE b."id" IS NULL AND a."user_id" IS NOT NULL',
        expectation: 'is empty',
        reason: 'FK: orders.user_id -> users.id',
        confidence: 'high',
      },
    ];
    const code = renderer().render(assertions);

    assert.ok(code.includes("group('FK integrity'"));
    assert.ok(code.includes('expect(result, isEmpty'));
    assert.ok(code.includes('FK: orders.user_id -> users.id'));
  });

  it('should render not-null assertions', () => {
    const assertions: IAssertion[] = [
      {
        type: 'notNull',
        table: 'users',
        column: 'email',
        sql: 'SELECT COUNT(*) AS cnt FROM "users" WHERE "email" IS NULL',
        expectation: 'equals 0',
        reason: 'Currently 0% null (100 rows)',
        confidence: 'high',
      },
    ];
    const code = renderer().render(assertions);

    assert.ok(code.includes("group('Null constraints'"));
    assert.ok(code.includes("test('users.email is never null'"));
    assert.ok(code.includes("expect(result.first['cnt'], 0)"));
  });

  it('should render uniqueness assertions', () => {
    const assertions: IAssertion[] = [
      {
        type: 'unique',
        table: 'users',
        column: 'email',
        sql: 'SELECT "email", COUNT(*) AS cnt FROM "users" GROUP BY "email" HAVING cnt > 1',
        expectation: 'is empty',
        reason: 'All 100 values are unique',
        confidence: 'high',
      },
    ];
    const code = renderer().render(assertions);

    assert.ok(code.includes("group('Uniqueness'"));
    assert.ok(code.includes("test('users.email is unique'"));
    assert.ok(code.includes('expect(result, isEmpty'));
  });

  it('should render value range assertions', () => {
    const assertions: IAssertion[] = [
      {
        type: 'valueRange',
        table: 'orders',
        column: 'total',
        sql: 'SELECT * FROM "orders" WHERE "total" < 5 OR "total" > 100',
        expectation: 'is empty',
        reason: 'Current range: [5, 100]',
        confidence: 'medium',
      },
    ];
    const code = renderer().render(assertions);

    assert.ok(code.includes("group('Value ranges'"));
    assert.ok(code.includes("test('orders.total stays within range'"));
  });

  it('should group multiple types separately', () => {
    const assertions: IAssertion[] = [
      {
        type: 'rowCount',
        table: 'a',
        sql: 'SELECT COUNT(*) AS cnt FROM "a"',
        expectation: 'equals 5',
        reason: 'Count',
        confidence: 'high',
      },
      {
        type: 'notNull',
        table: 'a',
        column: 'x',
        sql: 'SELECT COUNT(*) AS cnt FROM "a" WHERE "x" IS NULL',
        expectation: 'equals 0',
        reason: 'No nulls',
        confidence: 'high',
      },
    ];
    const code = renderer().render(assertions);

    assert.ok(code.includes("group('Row counts'"));
    assert.ok(code.includes("group('Null constraints'"));
  });
});

describe('escDart', () => {
  it('should escape single quotes', () => {
    assert.strictEqual(escDart("it's"), "it\\'s");
  });

  it('should escape dollar signs', () => {
    assert.strictEqual(escDart('$var'), '\\$var');
  });

  it('should escape backslashes', () => {
    assert.strictEqual(escDart('a\\b'), 'a\\\\b');
  });

  it('should handle combined escapes', () => {
    assert.strictEqual(escDart("it's $100\\ok"), "it\\'s \\$100\\\\ok");
  });
});

describe('dartString', () => {
  it('should wrap in single quotes', () => {
    assert.strictEqual(dartString('hello'), "'hello'");
  });

  it('should escape content', () => {
    assert.strictEqual(dartString("it's"), "'it\\'s'");
  });
});
