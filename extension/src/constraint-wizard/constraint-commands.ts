import * as vscode from 'vscode';
import type { DriftApiClient } from '../api-client';
import type { TableItem } from '../tree/tree-items';
import { ConstraintWizardPanel } from './constraint-wizard-panel';

/** Register constraint wizard commands on the extension context. */
export function registerConstraintWizardCommands(
  context: vscode.ExtensionContext,
  client: DriftApiClient,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.constraintWizard',
      async (item?: TableItem) => {
        try {
          const table = item?.table.name ?? await pickTable(client);
          if (!table) return;
          const meta = await client.schemaMetadata();
          const tableMeta = meta.find((t) => t.name === table);
          if (!tableMeta) return;
          const fks = await client.tableFkMeta(table);
          ConstraintWizardPanel.createOrShow(client, tableMeta, fks);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `Constraint wizard failed: ${msg}`,
          );
        }
      },
    ),
  );
}

async function pickTable(
  client: DriftApiClient,
): Promise<string | undefined> {
  const meta = await client.schemaMetadata();
  const names = meta
    .filter((t) => !t.name.startsWith('sqlite_'))
    .map((t) => t.name)
    .sort();
  return vscode.window.showQuickPick(names, {
    placeHolder: 'Select a table',
  });
}
