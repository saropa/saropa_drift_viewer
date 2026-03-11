import * as vscode from 'vscode';
import type { DriftApiClient } from '../api-client';
import { HealthScorer } from './health-scorer';
import { HealthPanel } from './health-panel';

/** Register the health score command. */
export function registerHealthCommands(
  context: vscode.ExtensionContext,
  client: DriftApiClient,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.healthScore',
      async () => {
        try {
          const scorer = new HealthScorer();
          const score = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'Computing health score\u2026',
            },
            () => scorer.compute(client),
          );
          HealthPanel.createOrShow(score, client);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Health score failed: ${msg}`);
        }
      },
    ),
  );
}
