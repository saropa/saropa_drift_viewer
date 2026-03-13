/**
 * Connection health check: add connection-error diagnostic if server unreachable.
 */

import * as vscode from 'vscode';
import type { DriftApiClient } from '../../api-client';
import type { IDiagnosticIssue } from '../diagnostic-types';

/**
 * If the client fails to reach the server and hasRecentConnectionError is false,
 * push a connection-error issue. Caller should pass true if connection errors
 * were already recorded recently (e.g. via RuntimeEventStore).
 */
export async function checkConnection(
  client: DriftApiClient,
  issues: IDiagnosticIssue[],
  workspaceUri: vscode.Uri,
  hasRecentConnectionError: boolean,
): Promise<void> {
  try {
    await client.generation(0);
  } catch (err) {
    if (!hasRecentConnectionError) {
      const message = err instanceof Error ? err.message : 'Unknown connection error';
      issues.push({
        code: 'connection-error',
        message: `Failed to connect to Drift server: ${message}`,
        fileUri: workspaceUri,
        range: new vscode.Range(0, 0, 0, 0),
        severity: vscode.DiagnosticSeverity.Error,
      });
    }
  }
}
