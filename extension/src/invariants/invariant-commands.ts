/**
 * Command registrations for the Data Invariant Checker feature.
 */

import * as vscode from 'vscode';
import type { DriftApiClient } from '../api-client';
import { InvariantManager } from './invariant-manager';
import { InvariantDiagnostics, InvariantCodeActionProvider } from './invariant-diagnostics';
import { InvariantPanel } from './invariant-panel';
import { InvariantStatusBar } from './invariant-status-bar';
import { InvariantTemplates, templateToQuickPickItem } from './invariant-templates';
import type { GenerationWatcher } from '../generation-watcher';

interface InvariantServices {
  manager: InvariantManager;
  diagnostics: InvariantDiagnostics;
  statusBar: InvariantStatusBar;
}

/**
 * Register all invariant-related commands and services.
 * Returns the created services for use in extension.ts.
 */
export function registerInvariantCommands(
  context: vscode.ExtensionContext,
  client: DriftApiClient,
  watcher?: GenerationWatcher,
): InvariantServices {
  const manager = new InvariantManager(client, context.workspaceState);
  const diagnostics = new InvariantDiagnostics(manager);
  const statusBar = new InvariantStatusBar(manager);

  context.subscriptions.push(manager, diagnostics, statusBar);

  // Register code action provider
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { language: 'dart', scheme: 'file' },
      new InvariantCodeActionProvider(manager),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
  );

  // Command: Open invariant manager panel
  context.subscriptions.push(
    vscode.commands.registerCommand('driftViewer.manageInvariants', () => {
      InvariantPanel.createOrShow(context.extensionUri, manager, client);
    }),
  );

  // Command: Add a new invariant
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.addInvariant',
      async (tableArg?: { tableMetadata?: { name: string } }) => {
        let table = tableArg?.tableMetadata?.name;

        if (!table) {
          const tables = await getTableList(client);
          if (tables.length === 0) {
            vscode.window.showWarningMessage('No tables found in database.');
            return;
          }

          const pick = await vscode.window.showQuickPick(
            tables.map((t) => ({ label: t })),
            { placeHolder: 'Select a table' },
          );
          if (!pick) return;
          table = pick.label;
        }

        // Fetch templates with progress indicator
        const allTemplates = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Loading invariant templates...',
            cancellable: false,
          },
          async () => {
            const templates = new InvariantTemplates(client);
            const available = await templates.getTemplatesForTable(table);
            const common = templates.getCommonTemplates(table);
            return [...available, ...common];
          },
        );

        const items = [
          ...allTemplates.map((t) => templateToQuickPickItem(t)),
          {
            label: '$(code) Custom SQL',
            description: 'custom',
            detail: 'Write your own invariant query',
            template: null,
          },
        ];

        const pick = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select an invariant template',
        });
        if (!pick) return;

        if (pick.template) {
          manager.add({
            name: pick.template.name,
            table,
            sql: pick.template.sql,
            expectation: pick.template.expectation,
            severity: pick.template.severity,
            enabled: true,
          });
          vscode.window.showInformationMessage(
            `Added invariant: ${pick.template.name}`,
          );
        } else {
          const name = await vscode.window.showInputBox({
            prompt: 'Invariant name',
          });
          if (!name) return;

          const sql = await vscode.window.showInputBox({
            prompt: 'SQL query (returns violating rows)',
            value: `SELECT * FROM "${table}" WHERE `,
          });
          if (!sql) return;

          manager.add({
            name,
            table,
            sql,
            expectation: 'zero_rows',
            severity: 'warning',
            enabled: true,
          });
          vscode.window.showInformationMessage(`Added invariant: ${name}`);
        }
      },
    ),
  );

  // Command: Run all invariants
  context.subscriptions.push(
    vscode.commands.registerCommand('driftViewer.runAllInvariants', async () => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Running invariant checks...',
          cancellable: false,
        },
        async () => {
          await manager.evaluateAll();
          const summary = manager.getSummary();
          const msg =
            summary.failingCount === 0
              ? `All ${summary.passingCount} invariants passed.`
              : `${summary.failingCount} of ${summary.totalEnabled} invariants failed.`;
          vscode.window.showInformationMessage(msg);
        },
      );
    }),
  );

  // Command: Toggle an invariant
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.toggleInvariant',
      (id?: string) => {
        if (id) {
          manager.toggle(id);
        }
      },
    ),
  );

  // Command: View invariant violations
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.viewInvariantViolations',
      async (id?: string) => {
        if (!id) {
          InvariantPanel.createOrShow(context.extensionUri, manager, client);
          return;
        }

        const inv = manager.get(id);
        if (!inv?.lastResult?.violatingRows.length) {
          vscode.window.showInformationMessage('No violations to display.');
          return;
        }

        const content = JSON.stringify(inv.lastResult.violatingRows, null, 2);
        const doc = await vscode.workspace.openTextDocument({
          content,
          language: 'json',
        });
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
      },
    ),
  );

  // Continuous checking (if enabled)
  const cfg = vscode.workspace.getConfiguration('driftViewer.invariants');
  const continuous = cfg.get<boolean>('continuous', false);

  if (continuous && watcher) {
    context.subscriptions.push(
      watcher.onDidChange(() => {
        manager.evaluateAll().catch(() => {
          /* evaluation failed */
        });
      }),
    );
  }

  // Listen for config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('driftViewer.invariants')) {
        statusBar.refresh();
      }
    }),
  );

  return { manager, diagnostics, statusBar };
}

async function getTableList(client: DriftApiClient): Promise<string[]> {
  try {
    const meta = await client.schemaMetadata();
    return meta.map((t) => t.name);
  } catch {
    return [];
  }
}
