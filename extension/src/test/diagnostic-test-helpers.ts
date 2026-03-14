/**
 * Shared test helpers for diagnostic provider tests.
 */

import {
  Range,
  Uri,
} from './vscode-mock-classes';
import type { IDartFileInfo, IDiagnosticIssue, IDiagnosticProvider } from '../diagnostics/diagnostic-types';
import type { IDartTable } from '../schema-diff/dart-schema';

/** Create a mock Dart file with the given table name and columns. */
export function createDartFile(
  tableName: string,
  columns: string[],
): IDartFileInfo {
  const dartColumns = columns.map((name, idx) => ({
    dartName: name,
    sqlName: name,
    dartType: name === 'id' || name.endsWith('_id') ? 'IntColumn' : 'TextColumn',
    sqlType: name === 'id' || name.endsWith('_id') ? 'INTEGER' : 'TEXT',
    nullable: false,
    autoIncrement: name === 'id',
    line: 10 + idx,
  }));

  const dartTable: IDartTable = {
    dartClassName: tableName.charAt(0).toUpperCase() + tableName.slice(1),
    sqlTableName: tableName,
    columns: dartColumns,
    fileUri: `file:///lib/database/${tableName}.dart`,
    line: 5,
  };

  return {
    uri: Uri.parse(`file:///lib/database/${tableName}.dart`) as any,
    text: `class ${dartTable.dartClassName} extends Table {}`,
    tables: [dartTable],
  };
}

/** Create a mock diagnostic provider. */
export function createMockProvider(
  id: string,
  category: 'schema' | 'performance' | 'dataQuality' | 'bestPractices' | 'naming' | 'runtime',
  issues: IDiagnosticIssue[],
): IDiagnosticProvider {
  return {
    id,
    category,
    collectDiagnostics: () => Promise.resolve(issues),
    dispose: () => {},
  };
}

/** Create a mock diagnostic issue. */
export function createMockIssue(
  code: string,
  message: string,
  line: number,
): IDiagnosticIssue {
  return {
    code,
    message,
    fileUri: Uri.parse('file:///test/tables.dart') as any,
    range: new Range(line, 0, line, 100) as any,
  };
}
