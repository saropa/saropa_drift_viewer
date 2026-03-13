/**
 * Convert schema anomalies (e.g. orphaned FK) to diagnostic issues.
 */

import * as vscode from 'vscode';
import type { Anomaly } from '../../api-types';
import type { IDartFileInfo, IDiagnosticIssue } from '../diagnostic-types';
import { findDartFileForTable } from '../utils/dart-file-utils';

/**
 * Map each anomaly to an issue (orphaned-fk or anomaly) at the table location.
 */
export function checkAnomalies(
  issues: IDiagnosticIssue[],
  anomalies: Anomaly[],
  dartFiles: IDartFileInfo[],
): void {
  for (const anomaly of anomalies) {
    const match = anomaly.message.match(/(\w+)\.(\w+)/);
    if (!match) continue;

    const [, tableName] = match;
    const dartFile = findDartFileForTable(dartFiles, tableName);
    if (!dartFile) continue;

    const dartTable = dartFile.tables.find(
      (t) => t.sqlTableName.toLowerCase() === tableName.toLowerCase(),
    );
    const line = dartTable?.line ?? 0;

    const code = anomaly.severity === 'error' ? 'orphaned-fk' : 'anomaly';
    const severity =
      anomaly.severity === 'error'
        ? vscode.DiagnosticSeverity.Error
        : anomaly.severity === 'warning'
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Information;

    issues.push({
      code,
      message: anomaly.message,
      fileUri: dartFile.uri,
      range: new vscode.Range(line, 0, line, 999),
      severity,
    });
  }
}
