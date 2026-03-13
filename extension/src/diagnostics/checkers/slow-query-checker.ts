/**
 * Slow query diagnostics: map slow queries to Dart file locations.
 */

import * as vscode from 'vscode';
import type { PerformanceData } from '../../api-types';
import type { IDartFileInfo, IDiagnosticIssue } from '../diagnostic-types';
import { findDartFileForTable } from '../utils/dart-file-utils';
import { extractTableFromSql, truncateSql } from '../utils/sql-utils';

const SLOW_QUERY_THRESHOLD_MS = 100;
const MAX_SLOW_QUERY_DIAGNOSTICS = 10;

/**
 * Append slow-query-pattern issues for queries over the threshold.
 * Only reports when a matching Dart file/table is found.
 */
export function checkSlowQueries(
  issues: IDiagnosticIssue[],
  perfData: PerformanceData,
  dartFiles: IDartFileInfo[],
): void {
  const slowQueries = perfData.slowQueries ?? [];
  let count = 0;

  for (const query of slowQueries) {
    if (count >= MAX_SLOW_QUERY_DIAGNOSTICS) break;
    if (query.durationMs < SLOW_QUERY_THRESHOLD_MS) continue;

    const tableMatch = extractTableFromSql(query.sql);
    if (!tableMatch) continue;

    const dartFile = findDartFileForTable(dartFiles, tableMatch);
    if (!dartFile) continue;

    const dartTable = dartFile.tables.find(
      (t) => t.sqlTableName === tableMatch,
    );
    const line = dartTable?.line ?? 0;

    const truncatedSql = truncateSql(query.sql, 60);

    issues.push({
      code: 'slow-query-pattern',
      message: `Slow query (${query.durationMs.toFixed(0)}ms): ${truncatedSql}`,
      fileUri: dartFile.uri,
      range: new vscode.Range(line, 0, line, 999),
      severity: vscode.DiagnosticSeverity.Warning,
      data: { sql: query.sql, durationMs: query.durationMs },
    });

    count++;
  }
}
