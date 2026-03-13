/**
 * Diagnostic codes for Drift/SQLite best practices.
 */

import * as vscode from 'vscode';
import type { IDiagnosticCode } from '../diagnostic-types';

export const BEST_PRACTICE_CODES: Record<string, IDiagnosticCode> = {
  'missing-migration': {
    code: 'missing-migration',
    category: 'bestPractices',
    defaultSeverity: vscode.DiagnosticSeverity.Warning,
    messageTemplate: 'Schema changes detected but no migration found',
    hasFix: true,
  },
  'autoincrement-not-pk': {
    code: 'autoincrement-not-pk',
    category: 'bestPractices',
    defaultSeverity: vscode.DiagnosticSeverity.Error,
    messageTemplate:
      'Column "{table}.{column}" uses autoIncrement but is not primary key',
    hasFix: false,
  },
  'text-pk': {
    code: 'text-pk',
    category: 'bestPractices',
    defaultSeverity: vscode.DiagnosticSeverity.Warning,
    messageTemplate:
      'Table "{table}" uses TEXT primary key (INTEGER recommended)',
    hasFix: false,
  },
  'blob-column-large': {
    code: 'blob-column-large',
    category: 'bestPractices',
    defaultSeverity: vscode.DiagnosticSeverity.Information,
    messageTemplate:
      'BLOB column "{table}.{column}" may cause memory issues with large data',
    hasFix: false,
  },
  'no-foreign-keys': {
    code: 'no-foreign-keys',
    category: 'bestPractices',
    defaultSeverity: vscode.DiagnosticSeverity.Information,
    messageTemplate: 'Table "{table}" has no foreign key relationships',
    hasFix: false,
  },
  'circular-fk': {
    code: 'circular-fk',
    category: 'bestPractices',
    defaultSeverity: vscode.DiagnosticSeverity.Warning,
    messageTemplate: 'Circular foreign key relationship detected: {path}',
    hasFix: false,
  },
  'cascade-risk': {
    code: 'cascade-risk',
    category: 'bestPractices',
    defaultSeverity: vscode.DiagnosticSeverity.Warning,
    messageTemplate:
      'Deleting from "{table}" would cascade to {count} dependent rows',
    hasFix: false,
  },
  'unused-index': {
    code: 'unused-index',
    category: 'bestPractices',
    defaultSeverity: vscode.DiagnosticSeverity.Information,
    messageTemplate: 'Index "{indexName}" on "{table}" appears unused',
    hasFix: false,
  },
  'duplicate-index': {
    code: 'duplicate-index',
    category: 'bestPractices',
    defaultSeverity: vscode.DiagnosticSeverity.Warning,
    messageTemplate:
      'Index "{index1}" and "{index2}" on "{table}" have identical columns',
    hasFix: false,
  },
};
