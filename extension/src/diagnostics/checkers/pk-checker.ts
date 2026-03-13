/**
 * Primary key checks: no primary key, TEXT primary key.
 */

import * as vscode from 'vscode';
import type { TableMetadata } from '../../api-types';
import type { IDartTable } from '../../schema-diff/dart-schema';
import type { IDartFileInfo, IDiagnosticIssue } from '../diagnostic-types';

/**
 * Report when table has no primary key in Dart or DB.
 */
export function checkMissingPrimaryKey(
  issues: IDiagnosticIssue[],
  file: IDartFileInfo,
  dartTable: IDartTable,
  dbTable: TableMetadata | undefined,
): void {
  if (!dbTable) return;

  const hasPkInDart = dartTable.columns.some((c) => c.autoIncrement);
  const hasPkInDb = dbTable.columns.some((c) => c.pk);

  if (!hasPkInDart && !hasPkInDb) {
    issues.push({
      code: 'no-primary-key',
      message: `Table "${dartTable.sqlTableName}" has no primary key`,
      fileUri: file.uri,
      range: new vscode.Range(dartTable.line, 0, dartTable.line, 999),
      severity: vscode.DiagnosticSeverity.Warning,
    });
  }
}

/**
 * Report when table uses TEXT primary key (INTEGER recommended).
 */
export function checkTextPrimaryKey(
  issues: IDiagnosticIssue[],
  file: IDartFileInfo,
  dartTable: IDartTable,
  dbTable: TableMetadata | undefined,
): void {
  if (!dbTable) return;

  const pkCol = dbTable.columns.find((c) => c.pk);
  if (pkCol && pkCol.type === 'TEXT') {
    const dartCol = dartTable.columns.find((c) => c.sqlName === pkCol.name);
    const line = dartCol?.line ?? dartTable.line;

    issues.push({
      code: 'text-pk',
      message: `Table "${dartTable.sqlTableName}" uses TEXT primary key (INTEGER recommended for performance)`,
      fileUri: file.uri,
      range: new vscode.Range(line, 0, line, 999),
      severity: vscode.DiagnosticSeverity.Warning,
    });
  }
}
