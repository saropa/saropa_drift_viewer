/**
 * Column-level schema drift: missing/extra columns, type mismatch.
 */

import * as vscode from 'vscode';
import type { ColumnMetadata, TableMetadata } from '../../api-types';
import { DART_TO_SQL_TYPE } from '../../schema-diff/dart-schema';
import type { IDartTable } from '../../schema-diff/dart-schema';
import type { IDartFileInfo, IDiagnosticIssue } from '../diagnostic-types';

/**
 * Report missing column in DB, type drift, and extra column in DB.
 */
export function checkColumnDrift(
  issues: IDiagnosticIssue[],
  file: IDartFileInfo,
  dartTable: IDartTable,
  dbTable: TableMetadata | undefined,
): void {
  if (!dbTable) return;

  const dbColMap = new Map<string, ColumnMetadata>();
  for (const col of dbTable.columns) {
    dbColMap.set(col.name, col);
  }

  for (const dartCol of dartTable.columns) {
    const dbCol = dbColMap.get(dartCol.sqlName);
    const line = dartCol.line >= 0 ? dartCol.line : dartTable.line;

    if (!dbCol) {
      issues.push({
        code: 'missing-column-in-db',
        message: `Column "${dartTable.sqlTableName}.${dartCol.sqlName}" defined in Dart but missing from database`,
        fileUri: file.uri,
        range: new vscode.Range(line, 0, line, 999),
        severity: vscode.DiagnosticSeverity.Error,
      });
      continue;
    }

    const expectedType = DART_TO_SQL_TYPE[dartCol.dartType];
    if (expectedType && dbCol.type !== expectedType) {
      issues.push({
        code: 'column-type-drift',
        message: `Column "${dartTable.sqlTableName}.${dartCol.sqlName}" type mismatch: Dart=${expectedType}, DB=${dbCol.type}`,
        fileUri: file.uri,
        range: new vscode.Range(line, 0, line, 999),
        severity: vscode.DiagnosticSeverity.Warning,
      });
    }
  }

  for (const dbCol of dbTable.columns) {
    const dartCol = dartTable.columns.find((c) => c.sqlName === dbCol.name);
    if (!dartCol) {
      issues.push({
        code: 'extra-column-in-db',
        message: `Column "${dartTable.sqlTableName}.${dbCol.name}" exists in database but not in Dart`,
        fileUri: file.uri,
        range: new vscode.Range(dartTable.line, 0, dartTable.line, 999),
        severity: vscode.DiagnosticSeverity.Information,
      });
    }
  }
}
