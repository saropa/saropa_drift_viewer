/**
 * Diagnostic codes for naming conventions and SQL reserved words.
 */

import * as vscode from 'vscode';
import type { IDiagnosticCode } from '../diagnostic-types';

export const NAMING_CODES: Record<string, IDiagnosticCode> = {
  'table-name-case': {
    code: 'table-name-case',
    category: 'naming',
    defaultSeverity: vscode.DiagnosticSeverity.Hint,
    messageTemplate: 'Table "{table}" doesn\'t follow snake_case convention',
    hasFix: true,
  },
  'column-name-case': {
    code: 'column-name-case',
    category: 'naming',
    defaultSeverity: vscode.DiagnosticSeverity.Hint,
    messageTemplate:
      'Column "{table}.{column}" doesn\'t follow snake_case convention',
    hasFix: true,
  },
  'reserved-word': {
    code: 'reserved-word',
    category: 'naming',
    defaultSeverity: vscode.DiagnosticSeverity.Warning,
    messageTemplate: 'Column "{table}.{column}" uses SQL reserved word',
    hasFix: false,
  },
  'getter-table-mismatch': {
    code: 'getter-table-mismatch',
    category: 'naming',
    defaultSeverity: vscode.DiagnosticSeverity.Information,
    messageTemplate:
      'Dart getter "{getter}" maps to unexpected SQL name "{sqlName}"',
    hasFix: false,
  },
};

/** SQL reserved words that should trigger warnings. */
export const SQL_RESERVED_WORDS = new Set([
  'add', 'all', 'alter', 'and', 'as', 'asc', 'between', 'by', 'case', 'check',
  'column', 'constraint', 'create', 'cross', 'current', 'current_date',
  'current_time', 'current_timestamp', 'default', 'delete', 'desc', 'distinct',
  'drop', 'else', 'end', 'escape', 'except', 'exists', 'false', 'for',
  'foreign', 'from', 'full', 'group', 'having', 'in', 'index', 'inner',
  'insert', 'intersect', 'into', 'is', 'join', 'key', 'left', 'like', 'limit',
  'natural', 'not', 'null', 'offset', 'on', 'or', 'order', 'outer', 'primary',
  'references', 'right', 'select', 'set', 'table', 'then', 'to', 'true',
  'union', 'unique', 'update', 'using', 'values', 'when', 'where', 'with',
]);

/** Check if a name is a SQL reserved word. */
export function isSqlReservedWord(name: string): boolean {
  return SQL_RESERVED_WORDS.has(name.toLowerCase());
}

/** Check if a name follows snake_case convention. */
export function isSnakeCase(name: string): boolean {
  return /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(name);
}
