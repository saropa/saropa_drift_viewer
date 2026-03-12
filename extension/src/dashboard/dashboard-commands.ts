import * as vscode from 'vscode';
import type { DriftApiClient } from '../api-client';
import type { IHealthScorerProvider } from './dashboard-types';
import { DashboardPanel } from './dashboard-panel';
import { DashboardState } from './dashboard-state';

/** Register dashboard commands. */
export function registerDashboardCommands(
  context: vscode.ExtensionContext,
  client: DriftApiClient,
  healthScorer?: IHealthScorerProvider,
): void {
  const dashboardState = new DashboardState(context.workspaceState);

  context.subscriptions.push(
    vscode.commands.registerCommand('driftViewer.openDashboard', () => {
      const layout = dashboardState.load() ?? DashboardState.createDefault();
      DashboardPanel.createOrShow(
        context.extensionUri,
        client,
        layout,
        dashboardState,
        healthScorer,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('driftViewer.saveDashboard', async () => {
      if (!DashboardPanel.currentPanel) {
        vscode.window.showWarningMessage('No dashboard open to save.');
        return;
      }

      const currentName = dashboardState.getCurrentName() || 'default';
      const name = await vscode.window.showInputBox({
        prompt: 'Dashboard name',
        value: currentName,
        validateInput: (value) => {
          if (!value.trim()) return 'Name is required';
          return null;
        },
      });

      if (name) {
        DashboardPanel.currentPanel.saveAs(name);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('driftViewer.loadDashboard', async () => {
      const saved = dashboardState.listSaved();

      if (saved.length === 0) {
        vscode.window.showInformationMessage('No saved dashboards.');
        return;
      }

      const items = saved.map((name) => ({
        label: name,
        description: dashboardState.getCurrentName() === name ? '(current)' : '',
      }));

      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a dashboard to load',
      });

      if (pick) {
        const layout = dashboardState.load(pick.label);
        if (layout) {
          DashboardPanel.createOrShow(
            context.extensionUri,
            client,
            layout,
            dashboardState,
            healthScorer,
          );
        }
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('driftViewer.deleteDashboard', async () => {
      const saved = dashboardState.listSaved();

      if (saved.length === 0) {
        vscode.window.showInformationMessage('No saved dashboards to delete.');
        return;
      }

      const items = saved.map((name) => ({
        label: name,
        description: dashboardState.getCurrentName() === name ? '(current)' : '',
      }));

      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a dashboard to delete',
      });

      if (pick) {
        const confirm = await vscode.window.showWarningMessage(
          `Delete dashboard "${pick.label}"?`,
          { modal: true },
          'Delete',
        );

        if (confirm === 'Delete') {
          dashboardState.delete(pick.label);
          vscode.window.showInformationMessage(`Dashboard "${pick.label}" deleted.`);
        }
      }
    }),
  );
}
