import * as assert from 'assert';
import type { Anomaly, IndexSuggestion } from '../api-client';
import {
  type DartFileInfo,
  type ServerIssue,
  mapIssuesToDiagnostics,
  mapSeverity,
  mergeServerIssues,
  parseTableColumn,
} from '../linter/issue-mapper';
import { DiagnosticSeverity, Uri } from './vscode-mock';

function makeDartFile(name: string, text: string): DartFileInfo {
  return { uri: Uri.file(name) as any, text };
}

describe('parseTableColumn', () => {
  it('should extract table.column from a message', () => {
    const result = parseTableColumn('45 NULL values in users.deleted_at (10.5%)');
    assert.deepStrictEqual(result, { table: 'users', column: 'deleted_at' });
  });

  it('should return null when no table.column pattern found', () => {
    assert.strictEqual(parseTableColumn('No issues found'), null);
  });

  it('should extract the first occurrence', () => {
    const result = parseTableColumn('posts.author_id -> users.id');
    assert.deepStrictEqual(result, { table: 'posts', column: 'author_id' });
  });

  it('should skip numeric decimals like 10.5', () => {
    const result = parseTableColumn('10.5% NULL rates in users.email');
    assert.deepStrictEqual(result, { table: 'users', column: 'email' });
  });
});

describe('mergeServerIssues', () => {
  it('should convert index suggestions to ServerIssues', () => {
    const suggestions: IndexSuggestion[] = [
      { table: 'users', column: 'email', reason: 'FK target', sql: 'CREATE INDEX idx ON users(email)', priority: 'high' },
    ];
    const result = mergeServerIssues(suggestions, []);

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].source, 'index-suggestion');
    assert.strictEqual(result[0].severity, 'warning');
    assert.strictEqual(result[0].table, 'users');
    assert.strictEqual(result[0].column, 'email');
    assert.strictEqual(result[0].suggestedSql, 'CREATE INDEX idx ON users(email)');
  });

  it('should map low-priority suggestions to info severity', () => {
    const suggestions: IndexSuggestion[] = [
      { table: 'items', column: 'created_at', reason: 'date pattern', sql: 'CREATE INDEX ...', priority: 'low' },
    ];
    const result = mergeServerIssues(suggestions, []);
    assert.strictEqual(result[0].severity, 'info');
  });

  it('should convert anomalies with parseable messages', () => {
    const anomalies: Anomaly[] = [
      { message: '45 NULL values in users.deleted_at (10.5%)', severity: 'warning' },
    ];
    const result = mergeServerIssues([], anomalies);

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].source, 'anomaly');
    assert.strictEqual(result[0].table, 'users');
    assert.strictEqual(result[0].column, 'deleted_at');
  });

  it('should skip anomalies without parseable table.column', () => {
    const anomalies: Anomaly[] = [
      { message: 'General warning about something', severity: 'warning' },
    ];
    const result = mergeServerIssues([], anomalies);
    assert.strictEqual(result.length, 0);
  });
});

describe('mapSeverity', () => {
  it('should map server warning to VS Code Warning', () => {
    assert.strictEqual(mapSeverity('warning'), DiagnosticSeverity.Warning);
  });

  it('should map server error to VS Code Warning (not Error)', () => {
    assert.strictEqual(mapSeverity('error'), DiagnosticSeverity.Warning);
  });

  it('should map server info to VS Code Information', () => {
    assert.strictEqual(mapSeverity('info'), DiagnosticSeverity.Information);
  });

  it('should respect anomalySeverity override for error', () => {
    assert.strictEqual(mapSeverity('warning', 'error'), DiagnosticSeverity.Error);
  });

  it('should respect anomalySeverity override for information', () => {
    assert.strictEqual(mapSeverity('warning', 'information'), DiagnosticSeverity.Information);
  });

  it('should respect anomalySeverity override for hint', () => {
    assert.strictEqual(mapSeverity('warning', 'hint'), DiagnosticSeverity.Hint);
  });
});

describe('mapIssuesToDiagnostics', () => {
  const tableClassFile = makeDartFile(
    'lib/src/tables/users.dart',
    [
      "import 'package:drift/drift.dart';",
      '',
      'class Users extends Table {',
      '  IntColumn get id => integer().autoIncrement()()',
      '  TextColumn get email => text()()',
      '  TextColumn get deletedAt => text().nullable()()',
      '}',
    ].join('\n'),
  );

  it('should map an index suggestion to the column line', () => {
    const issues: ServerIssue[] = [{
      source: 'index-suggestion',
      severity: 'warning',
      table: 'users',
      column: 'email',
      message: 'users.email: FK target',
      suggestedSql: 'CREATE INDEX idx ON users(email)',
    }];

    const result = mapIssuesToDiagnostics(issues, [tableClassFile]);
    const fileKey = tableClassFile.uri.toString();
    const diags = result.get(fileKey);

    assert.ok(diags, 'should have diagnostics for the file');
    assert.strictEqual(diags.length, 1);
    assert.strictEqual(diags[0].range.start.line, 4); // line of `get email =>`
    assert.strictEqual(diags[0].source, 'Saropa Drift Advisor');
    assert.strictEqual(diags[0].code, 'index-suggestion');
    assert.ok(diags[0].relatedInformation);
    assert.strictEqual(diags[0].relatedInformation!.length, 1);
  });

  it('should fall back to table line when column not found', () => {
    const issues: ServerIssue[] = [{
      source: 'index-suggestion',
      severity: 'warning',
      table: 'users',
      column: 'nonexistent',
      message: 'test',
    }];

    const result = mapIssuesToDiagnostics(issues, [tableClassFile]);
    const diags = result.get(tableClassFile.uri.toString());

    assert.ok(diags);
    assert.strictEqual(diags[0].range.start.line, 2); // line of `class Users`
  });

  it('should skip issues with no matching Dart file', () => {
    const issues: ServerIssue[] = [{
      source: 'anomaly',
      severity: 'warning',
      table: 'unknown_table',
      message: 'test',
    }];

    const result = mapIssuesToDiagnostics(issues, [tableClassFile]);
    assert.strictEqual(result.size, 0);
  });

  it('should map snake_case column to camelCase getter', () => {
    const issues: ServerIssue[] = [{
      source: 'anomaly',
      severity: 'warning',
      table: 'users',
      column: 'deleted_at',
      message: 'NULL values in users.deleted_at',
    }];

    const result = mapIssuesToDiagnostics(issues, [tableClassFile]);
    const diags = result.get(tableClassFile.uri.toString());

    assert.ok(diags);
    assert.strictEqual(diags[0].range.start.line, 5); // line of `get deletedAt =>`
  });

  it('should handle multiple issues across files', () => {
    const postsFile = makeDartFile(
      'lib/src/tables/posts.dart',
      [
        'class Posts extends Table {',
        '  IntColumn get id => integer().autoIncrement()()',
        '  IntColumn get authorId => integer()()',
        '}',
      ].join('\n'),
    );

    const issues: ServerIssue[] = [
      {
        source: 'index-suggestion',
        severity: 'warning',
        table: 'users',
        column: 'email',
        message: 'users.email issue',
      },
      {
        source: 'index-suggestion',
        severity: 'info',
        table: 'posts',
        column: 'author_id',
        message: 'posts.author_id issue',
      },
    ];

    const result = mapIssuesToDiagnostics(issues, [tableClassFile, postsFile]);
    assert.strictEqual(result.size, 2);
    assert.strictEqual(result.get(tableClassFile.uri.toString())!.length, 1);
    assert.strictEqual(result.get(postsFile.uri.toString())!.length, 1);
  });
});
