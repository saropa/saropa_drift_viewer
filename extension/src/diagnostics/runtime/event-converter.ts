/**
 * Convert runtime events to diagnostic issues.
 */

import * as vscode from 'vscode';
import type { IDiagnosticIssue } from '../diagnostic-types';
import type { IRuntimeEvent } from './runtime-event-store';

/**
 * Map a single runtime event to a diagnostic issue, or undefined if not mappable.
 */
export function eventToIssue(
  event: IRuntimeEvent,
  workspaceUri: vscode.Uri,
): IDiagnosticIssue | undefined {
  const baseRange = new vscode.Range(0, 0, 0, 0);

  switch (event.type) {
    case 'breakpoint-hit':
      return {
        code: 'data-breakpoint-hit',
        message: `Data breakpoint fired: ${event.message}`,
        fileUri: workspaceUri,
        range: baseRange,
        severity: vscode.DiagnosticSeverity.Warning,
        data: { table: event.table },
      };

    case 'row-inserted':
      return {
        code: 'row-inserted-alert',
        message: event.message,
        fileUri: workspaceUri,
        range: baseRange,
        severity: vscode.DiagnosticSeverity.Information,
        data: { table: event.table, count: event.count },
      };

    case 'row-deleted':
      return {
        code: 'row-deleted-alert',
        message: event.message,
        fileUri: workspaceUri,
        range: baseRange,
        severity: vscode.DiagnosticSeverity.Information,
        data: { table: event.table, count: event.count },
      };

    case 'connection-error':
      return {
        code: 'connection-error',
        message: event.message,
        fileUri: workspaceUri,
        range: baseRange,
        severity: vscode.DiagnosticSeverity.Error,
      };

    default:
      return undefined;
  }
}
