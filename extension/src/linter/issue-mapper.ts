import * as vscode from 'vscode';
import type { Anomaly, IndexSuggestion } from '../api-client';
import { escapeRegex, snakeToCamel, snakeToPascal } from '../dart-names';

/** Unified issue type merging index suggestions and anomalies. */
export interface ServerIssue {
  source: 'index-suggestion' | 'anomaly';
  severity: 'error' | 'warning' | 'info';
  table: string;
  column?: string;
  message: string;
  suggestedSql?: string;
}

/** A Dart file with its text content and URI, used for source mapping. */
export interface DartFileInfo {
  uri: vscode.Uri;
  text: string;
}

/**
 * Try to extract a `table.column` pair from an anomaly message.
 * Returns null if no pattern found.
 */
export function parseTableColumn(
  message: string,
): { table: string; column: string } | null {
  // Require letter/underscore first char to avoid matching decimals like 10.5
  const match = /\b([a-zA-Z_]\w*)\.([a-zA-Z_]\w*)\b/.exec(message);
  if (!match) return null;
  return { table: match[1], column: match[2] };
}

/** Merge index suggestions and anomalies into a unified issue list. */
export function mergeServerIssues(
  suggestions: IndexSuggestion[],
  anomalies: Anomaly[],
): ServerIssue[] {
  const issues: ServerIssue[] = [];

  for (const s of suggestions) {
    issues.push({
      source: 'index-suggestion',
      severity: s.priority === 'high' ? 'warning' : 'info',
      table: s.table,
      column: s.column,
      message: `${s.table}.${s.column}: ${s.reason}`,
      suggestedSql: s.sql,
    });
  }

  for (const a of anomalies) {
    const parsed = parseTableColumn(a.message);
    if (!parsed) continue; // skip unmappable anomalies
    issues.push({
      source: 'anomaly',
      severity: a.severity,
      table: parsed.table,
      column: parsed.column,
      message: a.message,
    });
  }

  return issues;
}

/** Map a server severity string to a VS Code DiagnosticSeverity. */
export function mapSeverity(
  severity: 'error' | 'warning' | 'info',
  anomalySeverity?: string,
): vscode.DiagnosticSeverity {
  if (anomalySeverity === 'error') return vscode.DiagnosticSeverity.Error;
  if (anomalySeverity === 'information') {
    return vscode.DiagnosticSeverity.Information;
  }
  if (anomalySeverity === 'hint') return vscode.DiagnosticSeverity.Hint;

  // Default mapping: server errors/warnings → VS Code Warning (not Error)
  if (severity === 'error' || severity === 'warning') {
    return vscode.DiagnosticSeverity.Warning;
  }
  return vscode.DiagnosticSeverity.Information;
}

/**
 * Find the line number of a table class definition in file text.
 * Returns -1 if not found.
 */
function findTableLine(text: string, sqlTableName: string): number {
  const className = escapeRegex(snakeToPascal(sqlTableName));
  const pattern = new RegExp(
    `class\\s+${className}\\s+extends\\s+\\w*Table\\b`,
  );
  const match = pattern.exec(text);
  if (!match) return -1;
  return text.substring(0, match.index).split('\n').length - 1;
}

/**
 * Find the line number of a column getter within a file.
 * Searches for `get columnName =>` using both original and camelCase.
 * Returns -1 if not found.
 */
function findColumnLine(text: string, columnName: string): number {
  const camelName = snakeToCamel(columnName);
  const escapedOriginal = escapeRegex(columnName);
  const escapedCamel = escapeRegex(camelName);
  const names =
    camelName !== columnName
      ? `${escapedOriginal}|${escapedCamel}`
      : escapedOriginal;
  const colPattern = new RegExp(`get\\s+(${names})\\s*=>`);
  const match = colPattern.exec(text);
  if (!match) return -1;
  return text.substring(0, match.index).split('\n').length - 1;
}

/**
 * Map server issues to VS Code diagnostics grouped by file URI.
 * Only issues that can be matched to a Dart source location are included.
 */
export function mapIssuesToDiagnostics(
  issues: ServerIssue[],
  dartFiles: DartFileInfo[],
  anomalySeverity?: string,
): Map<string, vscode.Diagnostic[]> {
  const byFile = new Map<string, vscode.Diagnostic[]>();

  for (const issue of issues) {
    for (const file of dartFiles) {
      const tableLine = findTableLine(file.text, issue.table);
      if (tableLine < 0) continue;

      let line = tableLine;
      if (issue.column) {
        const colLine = findColumnLine(file.text, issue.column);
        if (colLine >= 0) line = colLine;
      }

      const range = new vscode.Range(line, 0, line, 999);
      const overrideSev =
        issue.source === 'anomaly' ? anomalySeverity : undefined;
      const severity = mapSeverity(issue.severity, overrideSev);
      const diag = new vscode.Diagnostic(range, issue.message, severity);
      diag.source = 'Saropa Drift Advisor';
      diag.code = issue.source;

      if (issue.suggestedSql) {
        diag.relatedInformation = [
          new vscode.DiagnosticRelatedInformation(
            new vscode.Location(file.uri, range),
            `Suggested fix: ${issue.suggestedSql}`,
          ),
        ];
      }

      const key = file.uri.toString();
      const existing = byFile.get(key) ?? [];
      existing.push(diag);
      byFile.set(key, existing);
      break; // matched — don't search more files for this issue
    }
  }

  return byFile;
}
