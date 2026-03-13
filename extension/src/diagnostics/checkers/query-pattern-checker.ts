/**
 * Unindexed WHERE/pattern diagnostics from query intelligence suggestions.
 */

import * as vscode from 'vscode';
import type { IPatternIndexSuggestion } from '../../engines/query-intelligence-types';
import type { IDartFileInfo, IDiagnosticIssue } from '../diagnostic-types';
import { findDartFileForTable } from '../utils/dart-file-utils';

const MIN_PATTERN_COUNT = 3;

/**
 * Append unindexed-where-clause issues for frequent patterns without index.
 */
export function checkQueryPatterns(
  issues: IDiagnosticIssue[],
  suggestions: IPatternIndexSuggestion[],
  dartFiles: IDartFileInfo[],
): void {
  for (const suggestion of suggestions) {
    if (suggestion.usageCount < MIN_PATTERN_COUNT) continue;

    const dartFile = findDartFileForTable(dartFiles, suggestion.table);
    if (!dartFile) continue;

    const dartTable = dartFile.tables.find(
      (t) => t.sqlTableName === suggestion.table,
    );
    const dartCol = dartTable?.columns.find(
      (c) => c.sqlName === suggestion.column,
    );
    const line = dartCol?.line ?? dartTable?.line ?? 0;

    issues.push({
      code: 'unindexed-where-clause',
      message: `Frequent WHERE on "${suggestion.table}.${suggestion.column}" without index (${suggestion.usageCount} queries)`,
      fileUri: dartFile.uri,
      range: new vscode.Range(line, 0, line, 999),
      severity: vscode.DiagnosticSeverity.Warning,
      relatedInfo: [
        new vscode.DiagnosticRelatedInformation(
          new vscode.Location(
            dartFile.uri,
            new vscode.Range(line, 0, line, 999),
          ),
          `Suggested: ${suggestion.sql}`,
        ),
      ],
      data: { sql: suggestion.sql },
    });
  }
}
