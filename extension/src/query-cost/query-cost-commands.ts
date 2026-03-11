/**
 * Register query cost analyzer commands on the extension context.
 */

import * as vscode from 'vscode';
import type { DriftApiClient } from '../api-client';
import { QueryCostPanel } from './query-cost-panel';

export function registerQueryCostCommands(
  context: vscode.ExtensionContext,
  client: DriftApiClient,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.analyzeQueryCost',
      async () => {
        const sql = await vscode.window.showInputBox({
          prompt: 'SQL query to analyze',
          placeHolder: 'SELECT ...',
        });
        if (!sql) return;

        try {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'Analyzing query cost\u2026',
            },
            () => QueryCostPanel.createOrShow(client, sql),
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `Query cost analysis failed: ${msg}`,
          );
        }
      },
    ),
  );
}
