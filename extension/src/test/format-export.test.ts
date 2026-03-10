import * as assert from 'assert';
import {
  formatExport,
  formatJson,
  formatCsv,
  formatSqlInsert,
  formatDart,
  formatMarkdown,
  formatKey,
  fileExtension,
  sqlLiteral,
  dartLiteral,
} from '../export/format-export';
import type { IExportOptions } from '../export/format-export-types';

function opts(
  overrides: Partial<IExportOptions> = {},
): IExportOptions {
  return {
    table: 'users',
    columns: ['id', 'name'],
    rows: [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ],
    format: 'json',
    ...overrides,
  };
}

describe('formatJson', () => {
  it('should produce valid JSON with all rows', () => {
    const result = formatJson(opts());
    const parsed = JSON.parse(result);
    assert.strictEqual(parsed.length, 2);
    assert.strictEqual(parsed[0].id, 1);
    assert.strictEqual(parsed[1].name, 'Bob');
  });

  it('should handle empty table', () => {
    const result = formatJson(opts({ rows: [] }));
    assert.strictEqual(result, '[]');
  });

  it('should handle null values', () => {
    const result = formatJson(opts({ rows: [{ id: 1, name: null }] }));
    const parsed = JSON.parse(result);
    assert.strictEqual(parsed[0].name, null);
  });
});

describe('formatCsv', () => {
  it('should produce header and data rows', () => {
    const result = formatCsv(opts());
    const lines = result.split('\n');
    assert.strictEqual(lines[0], 'id,name');
    assert.strictEqual(lines[1], '1,Alice');
    assert.strictEqual(lines[2], '2,Bob');
  });

  it('should escape commas in values', () => {
    const result = formatCsv(opts({
      rows: [{ id: 1, name: 'Al,ice' }],
    }));
    assert.ok(result.includes('"Al,ice"'));
  });

  it('should escape quotes in values', () => {
    const result = formatCsv(opts({
      rows: [{ id: 1, name: 'say "hi"' }],
    }));
    assert.ok(result.includes('"say ""hi"""'));
  });

  it('should handle newlines in values', () => {
    const result = formatCsv(opts({
      rows: [{ id: 1, name: 'line1\nline2' }],
    }));
    assert.ok(result.includes('"line1\nline2"'));
  });

  it('should handle empty table', () => {
    const result = formatCsv(opts({ rows: [] }));
    assert.strictEqual(result, 'id,name');
  });
});

describe('formatSqlInsert', () => {
  it('should produce INSERT statements', () => {
    const result = formatSqlInsert(opts());
    const lines = result.split('\n');
    assert.strictEqual(lines.length, 2);
    assert.strictEqual(
      lines[0],
      'INSERT INTO "users" ("id", "name") VALUES (1, \'Alice\');',
    );
  });

  it('should render NULL for null values', () => {
    const result = formatSqlInsert(opts({
      rows: [{ id: 1, name: null }],
    }));
    assert.ok(result.includes('NULL'));
  });

  it('should escape single quotes', () => {
    const result = formatSqlInsert(opts({
      rows: [{ id: 1, name: "O'Brien" }],
    }));
    assert.ok(result.includes("'O''Brien'"));
  });

  it('should leave numbers unquoted', () => {
    const result = formatSqlInsert(opts({
      rows: [{ id: 42, name: 'x' }],
    }));
    assert.ok(result.includes('VALUES (42,'));
  });

  it('should handle empty table', () => {
    const result = formatSqlInsert(opts({ rows: [] }));
    assert.strictEqual(result, '');
  });
});

describe('formatDart', () => {
  it('should produce Dart Map literal', () => {
    const result = formatDart(opts());
    assert.ok(result.startsWith('const users = <Map<String, Object?>>'));
    assert.ok(result.includes("'id': 1"));
    assert.ok(result.includes("'name': 'Alice'"));
  });

  it('should render null literal', () => {
    const result = formatDart(opts({
      rows: [{ id: 1, name: null }],
    }));
    assert.ok(result.includes("'name': null"));
  });

  it('should escape single quotes in strings', () => {
    const result = formatDart(opts({
      rows: [{ id: 1, name: "it's" }],
    }));
    assert.ok(result.includes("'name': 'it\\'s'"));
  });

  it('should escape backslashes', () => {
    const result = formatDart(opts({
      rows: [{ id: 1, name: 'a\\b' }],
    }));
    assert.ok(result.includes("'name': 'a\\\\b'"));
  });

  it('should handle empty table', () => {
    const result = formatDart(opts({ rows: [] }));
    assert.strictEqual(
      result,
      'const users = <Map<String, Object?>>[];',
    );
  });

  it('should handle single row', () => {
    const result = formatDart(opts({
      rows: [{ id: 1, name: 'Alice' }],
    }));
    assert.ok(result.includes("  {'id': 1, 'name': 'Alice'},"));
  });

  it('should escape column names with special chars', () => {
    const result = formatDart(opts({
      columns: ['id', "it's"],
      rows: [{ 'id': 1, "it's": 'val' }],
    }));
    assert.ok(result.includes("'it\\'s':"));
  });
});

describe('formatMarkdown', () => {
  it('should produce header, separator, and rows', () => {
    const result = formatMarkdown(opts());
    const lines = result.split('\n');
    assert.strictEqual(lines[0], '| id | name |');
    assert.strictEqual(lines[1], '|---|---|');
    assert.strictEqual(lines[2], '| 1 | Alice |');
    assert.strictEqual(lines[3], '| 2 | Bob |');
  });

  it('should escape pipe characters in values', () => {
    const result = formatMarkdown(opts({
      rows: [{ id: 1, name: 'a|b' }],
    }));
    assert.ok(result.includes('a\\|b'));
  });

  it('should replace newlines with spaces', () => {
    const result = formatMarkdown(opts({
      rows: [{ id: 1, name: 'line1\nline2' }],
    }));
    assert.ok(result.includes('line1 line2'));
    assert.ok(!result.split('|---')[1].includes('\n|'));
  });

  it('should handle null values', () => {
    const result = formatMarkdown(opts({
      rows: [{ id: 1, name: null }],
    }));
    assert.ok(result.includes('| 1 |  |'));
  });

  it('should handle empty table', () => {
    const result = formatMarkdown(opts({ rows: [] }));
    const lines = result.split('\n');
    assert.strictEqual(lines.length, 2);
  });
});

describe('formatExport dispatch', () => {
  it('should dispatch to correct formatter', () => {
    const o = opts({ format: 'markdown' });
    const result = formatExport(o);
    assert.ok(result.startsWith('| id'));
  });
});

describe('sqlLiteral', () => {
  it('should return NULL for null', () => {
    assert.strictEqual(sqlLiteral(null), 'NULL');
  });
  it('should return NULL for undefined', () => {
    assert.strictEqual(sqlLiteral(undefined), 'NULL');
  });
  it('should return number as-is', () => {
    assert.strictEqual(sqlLiteral(42), '42');
  });
  it('should quote strings', () => {
    assert.strictEqual(sqlLiteral('hello'), "'hello'");
  });
  it('should escape single quotes', () => {
    assert.strictEqual(sqlLiteral("it's"), "'it''s'");
  });
});

describe('dartLiteral', () => {
  it('should return null for null', () => {
    assert.strictEqual(dartLiteral(null), 'null');
  });
  it('should return number as-is', () => {
    assert.strictEqual(dartLiteral(3.14), '3.14');
  });
  it('should return boolean as-is', () => {
    assert.strictEqual(dartLiteral(true), 'true');
  });
  it('should quote and escape strings', () => {
    assert.strictEqual(dartLiteral("it's"), "'it\\'s'");
  });
  it('should escape backslashes', () => {
    assert.strictEqual(dartLiteral('a\\b'), "'a\\\\b'");
  });
});

describe('formatKey', () => {
  it('should map known labels', () => {
    assert.strictEqual(formatKey('JSON'), 'json');
    assert.strictEqual(formatKey('CSV'), 'csv');
    assert.strictEqual(formatKey('SQL INSERT'), 'sql');
    assert.strictEqual(formatKey('Dart'), 'dart');
    assert.strictEqual(formatKey('Markdown'), 'markdown');
  });
  it('should default to json for unknown', () => {
    assert.strictEqual(formatKey('???'), 'json');
  });
});

describe('fileExtension', () => {
  it('should return correct extensions', () => {
    assert.strictEqual(fileExtension('json'), 'json');
    assert.strictEqual(fileExtension('csv'), 'csv');
    assert.strictEqual(fileExtension('sql'), 'sql');
    assert.strictEqual(fileExtension('dart'), 'dart');
    assert.strictEqual(fileExtension('markdown'), 'md');
  });
});

describe('unicode support', () => {
  it('should preserve unicode in all formats', () => {
    const o = opts({ rows: [{ id: 1, name: '\u{1F600} caf\u00E9' }] });
    for (const fmt of ['json', 'csv', 'sql', 'dart', 'markdown'] as const) {
      const result = formatExport({ ...o, format: fmt });
      assert.ok(
        result.includes('caf\u00E9'),
        `${fmt} should preserve unicode`,
      );
    }
  });
});
