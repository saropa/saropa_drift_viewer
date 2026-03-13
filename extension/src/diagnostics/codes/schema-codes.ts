/**
 * Diagnostic codes for schema quality (Dart/DB alignment, PK, FK, etc.).
 */

import * as vscode from 'vscode';
import type { IDiagnosticCode } from '../diagnostic-types';

export const SCHEMA_CODES: Record<string, IDiagnosticCode> = {
  'no-primary-key': {
    code: 'no-primary-key',
    category: 'schema',
    defaultSeverity: vscode.DiagnosticSeverity.Warning,
    messageTemplate: 'Table "{table}" has no primary key',
    hasFix: true,
  },
  'missing-fk-index': {
    code: 'missing-fk-index',
    category: 'schema',
    defaultSeverity: vscode.DiagnosticSeverity.Warning,
    messageTemplate: 'FK column "{table}.{column}" lacks an index',
    hasFix: true,
  },
  'orphaned-fk': {
    code: 'orphaned-fk',
    category: 'schema',
    defaultSeverity: vscode.DiagnosticSeverity.Error,
    messageTemplate: 'Orphaned FK values in "{table}.{column}" ({count} rows)',
    hasFix: true,
  },
  'fk-type-mismatch': {
    code: 'fk-type-mismatch',
    category: 'schema',
    defaultSeverity: vscode.DiagnosticSeverity.Error,
    messageTemplate:
      'FK "{table}.{column}" type ({type}) doesn\'t match target "{toTable}.{toColumn}" ({toType})',
    hasFix: false,
  },
  'column-type-drift': {
    code: 'column-type-drift',
    category: 'schema',
    defaultSeverity: vscode.DiagnosticSeverity.Warning,
    messageTemplate:
      'Column "{table}.{column}" type mismatch: Dart={dartType}, DB={dbType}',
    hasFix: false,
  },
  'missing-table-in-db': {
    code: 'missing-table-in-db',
    category: 'schema',
    defaultSeverity: vscode.DiagnosticSeverity.Error,
    messageTemplate: 'Table "{table}" defined in Dart but missing from database',
    hasFix: true,
  },
  'missing-column-in-db': {
    code: 'missing-column-in-db',
    category: 'schema',
    defaultSeverity: vscode.DiagnosticSeverity.Error,
    messageTemplate:
      'Column "{table}.{column}" defined in Dart but missing from database',
    hasFix: true,
  },
  'extra-column-in-db': {
    code: 'extra-column-in-db',
    category: 'schema',
    defaultSeverity: vscode.DiagnosticSeverity.Information,
    messageTemplate:
      'Column "{table}.{column}" exists in database but not in Dart',
    hasFix: false,
  },
  'extra-table-in-db': {
    code: 'extra-table-in-db',
    category: 'schema',
    defaultSeverity: vscode.DiagnosticSeverity.Information,
    messageTemplate: 'Table "{table}" exists in database but not in Dart',
    hasFix: false,
  },
  'nullable-mismatch': {
    code: 'nullable-mismatch',
    category: 'schema',
    defaultSeverity: vscode.DiagnosticSeverity.Warning,
    messageTemplate:
      'Column "{table}.{column}" nullability mismatch: Dart={dartNullable}, DB={dbNullable}',
    hasFix: false,
  },
  'anomaly': {
    code: 'anomaly',
    category: 'schema',
    defaultSeverity: vscode.DiagnosticSeverity.Warning,
    messageTemplate: '{message}',
    hasFix: false,
  },
};
