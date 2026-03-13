/**
 * Table-level schema checks: missing table in DB, extra table in DB.
 */

import * as vscode from 'vscode';
import type { TableMetadata } from '../../api-types';
import type { IDartTable } from '../../schema-diff/dart-schema';
import type { IDartFileInfo, IDiagnosticIssue } from '../diagnostic-types';

/**
 * Report when a Dart table has no matching database table.
 */
export function checkMissingTableInDb(
  issues: IDiagnosticIssue[],
  file: IDartFileInfo,
  dartTable: IDartTable,
  dbTable: TableMetadata | undefined,
): void {
  if (!dbTable) {
    issues.push({
      code: 'missing-table-in-db',
      message: `Table "${dartTable.sqlTableName}" defined in Dart but missing from database`,
      fileUri: file.uri,
      range: new vscode.Range(dartTable.line, 0, dartTable.line, 999),
      severity: vscode.DiagnosticSeverity.Error,
    });
  }
}

/**
 * Report when the database has tables not defined in any Dart file.
 */
export function checkExtraTablesInDb(
  issues: IDiagnosticIssue[],
  dbTableMap: Map<string, TableMetadata>,
  dartFiles: IDartFileInfo[],
): void {
  const dartTableNames = new Set<string>();
  for (const file of dartFiles) {
    for (const table of file.tables) {
      dartTableNames.add(table.sqlTableName);
    }
  }

  dbTableMap.forEach((_, tableName) => {
    if (!dartTableNames.has(tableName)) {
      const firstFile = dartFiles[0];
      if (firstFile) {
        issues.push({
          code: 'extra-table-in-db',
          message: `Table "${tableName}" exists in database but not in Dart`,
          fileUri: firstFile.uri,
          range: new vscode.Range(0, 0, 0, 999),
          severity: vscode.DiagnosticSeverity.Information,
        });
      }
    }
  });
}
