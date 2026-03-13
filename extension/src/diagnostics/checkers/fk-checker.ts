/**
 * Foreign key index checks: missing indexes on FK columns.
 */

import * as vscode from 'vscode';
import type { IndexSuggestion } from '../../api-types';
import type { IDartFileInfo, IDiagnosticIssue } from '../diagnostic-types';
import { findDartFileForTable } from '../utils/dart-file-utils';

/**
 * Report missing-fk-index for each suggestion; map to Dart file/column location.
 */
export function checkMissingFkIndexes(
  issues: IDiagnosticIssue[],
  suggestions: IndexSuggestion[],
  dartFiles: IDartFileInfo[],
): void {
  for (const suggestion of suggestions) {
    const dartFile = findDartFileForTable(dartFiles, suggestion.table);
    if (!dartFile) continue;

    const dartTable = dartFile.tables.find(
      (t) => t.sqlTableName.toLowerCase() === suggestion.table.toLowerCase(),
    );
    const dartCol = dartTable?.columns.find(
      (c) => c.sqlName.toLowerCase() === suggestion.column.toLowerCase(),
    );
    const line = dartCol?.line ?? dartTable?.line ?? 0;

    issues.push({
      code: 'missing-fk-index',
      message: `FK column "${suggestion.table}.${suggestion.column}" lacks an index`,
      fileUri: dartFile.uri,
      range: new vscode.Range(line, 0, line, 999),
      severity:
        suggestion.priority === 'high'
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Information,
      relatedInfo: [
        new vscode.DiagnosticRelatedInformation(
          new vscode.Location(
            dartFile.uri,
            new vscode.Range(line, 0, line, 999),
          ),
          `Suggested: ${suggestion.sql}`,
        ),
      ],
    });
  }
}
