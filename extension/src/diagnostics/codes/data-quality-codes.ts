/**
 * Diagnostic codes for data quality (nulls, constraints, skew).
 */

import * as vscode from 'vscode';
import type { IDiagnosticCode } from '../diagnostic-types';

export const DATA_QUALITY_CODES: Record<string, IDiagnosticCode> = {
  'high-null-rate': {
    code: 'high-null-rate',
    category: 'dataQuality',
    defaultSeverity: vscode.DiagnosticSeverity.Warning,
    messageTemplate: 'Column "{table}.{column}" has {pct}% NULL values',
    hasFix: false,
  },
  'unique-violation': {
    code: 'unique-violation',
    category: 'dataQuality',
    defaultSeverity: vscode.DiagnosticSeverity.Error,
    messageTemplate:
      'UNIQUE constraint on "{table}.{columns}" has {count} violations',
    hasFix: false,
  },
  'check-violation': {
    code: 'check-violation',
    category: 'dataQuality',
    defaultSeverity: vscode.DiagnosticSeverity.Error,
    messageTemplate:
      'CHECK constraint on "{table}" has {count} violations: {expr}',
    hasFix: false,
  },
  'not-null-violation': {
    code: 'not-null-violation',
    category: 'dataQuality',
    defaultSeverity: vscode.DiagnosticSeverity.Error,
    messageTemplate:
      'NOT NULL on "{table}.{column}" has {count} NULL values',
    hasFix: false,
  },
  'outlier-detected': {
    code: 'outlier-detected',
    category: 'dataQuality',
    defaultSeverity: vscode.DiagnosticSeverity.Information,
    messageTemplate:
      'Column "{table}.{column}" has {count} statistical outliers',
    hasFix: false,
  },
  'empty-table': {
    code: 'empty-table',
    category: 'dataQuality',
    defaultSeverity: vscode.DiagnosticSeverity.Information,
    messageTemplate: 'Table "{table}" is empty (0 rows)',
    hasFix: false,
  },
  'data-skew': {
    code: 'data-skew',
    category: 'dataQuality',
    defaultSeverity: vscode.DiagnosticSeverity.Warning,
    messageTemplate:
      'Table "{table}" has {pct}% of all database rows (data skew)',
    hasFix: false,
  },
};
