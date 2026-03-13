/**
 * Diagnostic codes for query performance (slow queries, N+1, indexes).
 */

import * as vscode from 'vscode';
import type { IDiagnosticCode } from '../diagnostic-types';

export const PERFORMANCE_CODES: Record<string, IDiagnosticCode> = {
  'full-table-scan': {
    code: 'full-table-scan',
    category: 'performance',
    defaultSeverity: vscode.DiagnosticSeverity.Warning,
    messageTemplate: 'Query causes full table scan on "{table}"',
    hasFix: true,
  },
  'temp-btree-sort': {
    code: 'temp-btree-sort',
    category: 'performance',
    defaultSeverity: vscode.DiagnosticSeverity.Information,
    messageTemplate: 'Query uses temporary B-tree for sorting',
    hasFix: false,
  },
  'slow-query-pattern': {
    code: 'slow-query-pattern',
    category: 'performance',
    defaultSeverity: vscode.DiagnosticSeverity.Warning,
    messageTemplate: 'Slow query pattern detected (avg {avgMs}ms)',
    hasFix: false,
  },
  'n-plus-one': {
    code: 'n-plus-one',
    category: 'performance',
    defaultSeverity: vscode.DiagnosticSeverity.Warning,
    messageTemplate:
      'Potential N+1 query pattern: {table} queried {count} times',
    hasFix: false,
  },
  'unindexed-where-clause': {
    code: 'unindexed-where-clause',
    category: 'performance',
    defaultSeverity: vscode.DiagnosticSeverity.Warning,
    messageTemplate:
      'Frequent WHERE on "{table}.{column}" without index ({count} queries)',
    hasFix: true,
  },
  'unindexed-join': {
    code: 'unindexed-join',
    category: 'performance',
    defaultSeverity: vscode.DiagnosticSeverity.Warning,
    messageTemplate: 'JOIN on "{table}.{column}" without index',
    hasFix: true,
  },
};
