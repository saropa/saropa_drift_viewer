/**
 * Diagnostic codes for runtime issues (breakpoints, alerts, connection).
 */

import * as vscode from 'vscode';
import type { IDiagnosticCode } from '../diagnostic-types';

export const RUNTIME_CODES: Record<string, IDiagnosticCode> = {
  'data-breakpoint-hit': {
    code: 'data-breakpoint-hit',
    category: 'runtime',
    defaultSeverity: vscode.DiagnosticSeverity.Warning,
    messageTemplate: 'Data breakpoint fired: {message}',
    hasFix: false,
  },
  'row-inserted-alert': {
    code: 'row-inserted-alert',
    category: 'runtime',
    defaultSeverity: vscode.DiagnosticSeverity.Information,
    messageTemplate: '{count} row(s) inserted into "{table}"',
    hasFix: false,
  },
  'row-deleted-alert': {
    code: 'row-deleted-alert',
    category: 'runtime',
    defaultSeverity: vscode.DiagnosticSeverity.Information,
    messageTemplate: '{count} row(s) deleted from "{table}"',
    hasFix: false,
  },
  'connection-error': {
    code: 'connection-error',
    category: 'runtime',
    defaultSeverity: vscode.DiagnosticSeverity.Error,
    messageTemplate: 'Failed to connect to Drift server: {message}',
    hasFix: true,
  },
};
