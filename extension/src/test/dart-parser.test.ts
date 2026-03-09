import * as assert from 'assert';
import {
  extractClassBody,
  parseColumn,
  parseDartTables,
} from '../schema-diff/dart-parser';

describe('extractClassBody', () => {
  it('should extract a simple class body', () => {
    const src = 'class Foo extends Table { int x = 1; }';
    const idx = src.indexOf('{');
    assert.strictEqual(extractClassBody(src, idx).trim(), 'int x = 1;');
  });

  it('should handle nested braces', () => {
    const src = 'class Foo extends Table { void f() { if (true) { } } }';
    const idx = src.indexOf('{');
    const body = extractClassBody(src, idx);
    assert.ok(body.includes('void f()'));
    assert.ok(body.includes('if (true)'));
  });

  it('should skip braces inside single-quoted strings', () => {
    const src = "class Foo extends Table { String s = '{}'; }";
    const idx = src.indexOf('{');
    const body = extractClassBody(src, idx);
    assert.ok(body.includes("'{}'"));
  });

  it('should skip braces inside double-quoted strings', () => {
    const src = 'class Foo extends Table { String s = "{}"; }';
    const idx = src.indexOf('{');
    const body = extractClassBody(src, idx);
    assert.ok(body.includes('"{}'));
  });

  it('should skip braces inside line comments', () => {
    const src = 'class Foo extends Table {\n// { not a brace\nint x = 1;\n}';
    const idx = src.indexOf('{');
    const body = extractClassBody(src, idx);
    assert.ok(body.includes('int x = 1'));
  });

  it('should skip braces inside block comments', () => {
    const src = 'class Foo extends Table { /* { } */ int x = 1; }';
    const idx = src.indexOf('{');
    const body = extractClassBody(src, idx);
    assert.ok(body.includes('int x = 1'));
  });

  it('should skip braces inside triple-quoted strings', () => {
    const src =
      "class Foo extends Table { String s = '''{ }'''; int x = 1; }";
    const idx = src.indexOf('{');
    const body = extractClassBody(src, idx);
    assert.ok(body.includes('int x = 1'));
  });

  it('should handle escaped quotes in strings', () => {
    const src = "class Foo extends Table { String s = 'a\\'b{'; int x = 1; }";
    const idx = src.indexOf('{');
    const body = extractClassBody(src, idx);
    assert.ok(body.includes('int x = 1'));
  });
});

describe('parseColumn', () => {
  it('should parse IntColumn to INTEGER', () => {
    const col = parseColumn('IntColumn', 'userId', 'integer()', 5);
    assert.ok(col);
    assert.strictEqual(col.sqlType, 'INTEGER');
    assert.strictEqual(col.sqlName, 'user_id');
    assert.strictEqual(col.line, 5);
  });

  it('should parse TextColumn to TEXT', () => {
    const col = parseColumn('TextColumn', 'name', 'text()', 0);
    assert.ok(col);
    assert.strictEqual(col.sqlType, 'TEXT');
  });

  it('should parse BoolColumn to INTEGER', () => {
    const col = parseColumn('BoolColumn', 'isActive', 'boolean()', 0);
    assert.ok(col);
    assert.strictEqual(col.sqlType, 'INTEGER');
  });

  it('should parse DateTimeColumn to INTEGER', () => {
    const col = parseColumn('DateTimeColumn', 'createdAt', 'dateTime()', 0);
    assert.ok(col);
    assert.strictEqual(col.sqlType, 'INTEGER');
  });

  it('should parse RealColumn to REAL', () => {
    const col = parseColumn('RealColumn', 'price', 'real()', 0);
    assert.ok(col);
    assert.strictEqual(col.sqlType, 'REAL');
  });

  it('should parse BlobColumn to BLOB', () => {
    const col = parseColumn('BlobColumn', 'data', 'blob()', 0);
    assert.ok(col);
    assert.strictEqual(col.sqlType, 'BLOB');
  });

  it('should parse Int64Column to INTEGER', () => {
    const col = parseColumn('Int64Column', 'bigId', 'int64()', 0);
    assert.ok(col);
    assert.strictEqual(col.sqlType, 'INTEGER');
  });

  it('should detect .nullable()', () => {
    const col = parseColumn('TextColumn', 'bio', 'text().nullable()', 0);
    assert.ok(col);
    assert.strictEqual(col.nullable, true);
  });

  it('should default nullable to false', () => {
    const col = parseColumn('TextColumn', 'name', 'text()', 0);
    assert.ok(col);
    assert.strictEqual(col.nullable, false);
  });

  it('should detect .autoIncrement()', () => {
    const col = parseColumn(
      'IntColumn', 'id', 'integer().autoIncrement()', 0,
    );
    assert.ok(col);
    assert.strictEqual(col.autoIncrement, true);
  });

  it('should detect .named() override', () => {
    const col = parseColumn(
      'TextColumn', 'userName', "text().named('user_login')", 0,
    );
    assert.ok(col);
    assert.strictEqual(col.sqlName, 'user_login');
  });

  it('should convert getter name to snake_case', () => {
    const col = parseColumn('TextColumn', 'firstName', 'text()', 0);
    assert.ok(col);
    assert.strictEqual(col.sqlName, 'first_name');
  });

  it('should return null for unknown column type', () => {
    const col = parseColumn('CustomColumn', 'x', 'custom()', 0);
    assert.strictEqual(col, null);
  });
});

describe('parseDartTables', () => {
  it('should find a simple table class', () => {
    const source = `
class Users extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get name => text()();
}
`;
    const tables = parseDartTables(source, 'file:///test.dart');
    assert.strictEqual(tables.length, 1);
    assert.strictEqual(tables[0].dartClassName, 'Users');
    assert.strictEqual(tables[0].sqlTableName, 'users');
    assert.strictEqual(tables[0].columns.length, 2);
    assert.strictEqual(tables[0].fileUri, 'file:///test.dart');
  });

  it('should extract multiple tables from one file', () => {
    const source = `
class Users extends Table {
  IntColumn get id => integer()();
}
class Posts extends Table {
  IntColumn get id => integer()();
}
`;
    const tables = parseDartTables(source, 'file:///test.dart');
    assert.strictEqual(tables.length, 2);
    assert.strictEqual(tables[0].dartClassName, 'Users');
    assert.strictEqual(tables[1].dartClassName, 'Posts');
  });

  it('should detect tableName getter override', () => {
    const source = `
class UserAccounts extends Table {
  IntColumn get id => integer()();

  @override
  String get tableName => 'app_users';
}
`;
    const tables = parseDartTables(source, 'file:///test.dart');
    assert.strictEqual(tables.length, 1);
    assert.strictEqual(tables[0].sqlTableName, 'app_users');
  });

  it('should use default snake_case when no override', () => {
    const source = `
class UserSettings extends Table {
  IntColumn get id => integer()();
}
`;
    const tables = parseDartTables(source, 'file:///test.dart');
    assert.strictEqual(tables[0].sqlTableName, 'user_settings');
  });

  it('should handle table with no columns', () => {
    const source = `
class EmptyTable extends Table {
  // No columns yet
}
`;
    const tables = parseDartTables(source, 'file:///test.dart');
    assert.strictEqual(tables.length, 1);
    assert.strictEqual(tables[0].columns.length, 0);
  });

  it('should skip non-Table classes', () => {
    const source = `
class MyWidget extends StatelessWidget {
  IntColumn get id => integer()();
}
class Users extends Table {
  IntColumn get id => integer()();
}
`;
    const tables = parseDartTables(source, 'file:///test.dart');
    assert.strictEqual(tables.length, 1);
    assert.strictEqual(tables[0].dartClassName, 'Users');
  });

  it('should compute correct line numbers', () => {
    const source = `// line 0
// line 1
class Users extends Table {
  IntColumn get id => integer()();
  TextColumn get name => text()();
}
`;
    const tables = parseDartTables(source, 'file:///test.dart');
    assert.strictEqual(tables[0].line, 2);
    assert.strictEqual(tables[0].columns[0].line, 3);
    assert.strictEqual(tables[0].columns[1].line, 4);
  });

  it('should handle .withDefault in builder chain', () => {
    const source = `
class Users extends Table {
  IntColumn get age => integer().withDefault(const Constant(0))();
}
`;
    const tables = parseDartTables(source, 'file:///test.dart');
    assert.strictEqual(tables[0].columns.length, 1);
    assert.strictEqual(tables[0].columns[0].sqlType, 'INTEGER');
  });

  it('should handle .nullable() with other modifiers', () => {
    const source = `
class Users extends Table {
  TextColumn get bio => text().nullable().withLength(max: 500)();
}
`;
    const tables = parseDartTables(source, 'file:///test.dart');
    assert.strictEqual(tables[0].columns[0].nullable, true);
    assert.strictEqual(tables[0].columns[0].sqlType, 'TEXT');
  });

  it('should handle double-quoted tableName override', () => {
    const source = `
class Accounts extends Table {
  IntColumn get id => integer()();

  @override
  String get tableName => "custom_accounts";
}
`;
    const tables = parseDartTables(source, 'file:///test.dart');
    assert.strictEqual(tables[0].sqlTableName, 'custom_accounts');
  });

  it('should return consistent results on repeated calls', () => {
    const source = `
class Users extends Table {
  IntColumn get id => integer()();
}
`;
    const first = parseDartTables(source, 'file:///a.dart');
    const second = parseDartTables(source, 'file:///b.dart');
    assert.strictEqual(first.length, 1);
    assert.strictEqual(second.length, 1);
    assert.strictEqual(second[0].fileUri, 'file:///b.dart');
  });
});
