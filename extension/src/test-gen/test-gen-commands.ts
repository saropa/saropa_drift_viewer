import * as vscode from 'vscode';
import type { DriftApiClient } from '../api-client';
import type { AssertionType } from './test-gen-types';
import { AssertionInferrer } from './assertion-inferrer';
import { DartTestRenderer } from './dart-test-renderer';

interface ITypePickItem extends vscode.QuickPickItem {
  value: AssertionType;
}

/** Register regression test generator commands. */
export function registerTestGenCommands(
  context: vscode.ExtensionContext,
  client: DriftApiClient,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.generateTests',
      async () => {
        try {
          await generateTests(client);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `Test generation failed: ${msg}`,
          );
        }
      },
    ),
  );
}

async function generateTests(client: DriftApiClient): Promise<void> {
  const meta = await client.schemaMetadata();
  const tables = meta
    .filter((t) => !t.name.startsWith('sqlite_'))
    .map((t) => ({
      label: t.name,
      description: `${t.rowCount} rows`,
      picked: t.rowCount < 10_000,
    }));

  if (tables.length === 0) {
    vscode.window.showInformationMessage('No tables found.');
    return;
  }

  const selectedTables = await vscode.window.showQuickPick(tables, {
    canPickMany: true,
    placeHolder: 'Select tables to test',
  });
  if (!selectedTables || selectedTables.length === 0) return;

  const typeOptions: ITypePickItem[] = [
    { label: 'Row counts', value: 'rowCount', picked: true },
    { label: 'FK integrity', value: 'fkIntegrity', picked: true },
    { label: 'Null constraints', value: 'notNull', picked: true },
    { label: 'Uniqueness', value: 'unique', picked: true },
    { label: 'Value ranges', value: 'valueRange', picked: false },
  ];

  const selectedTypes = await vscode.window.showQuickPick(typeOptions, {
    canPickMany: true,
    placeHolder: 'Select assertion types',
  });
  if (!selectedTypes || selectedTypes.length === 0) return;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Generating regression tests\u2026',
    },
    async () => {
      const inferrer = new AssertionInferrer(client);
      const assertions = await inferrer.infer(
        selectedTables.map((s) => s.label),
        new Set(selectedTypes.map((t) => t.value)),
      );

      const renderer = new DartTestRenderer();
      const dartCode = renderer.render(assertions);

      const doc = await vscode.workspace.openTextDocument({
        content: dartCode,
        language: 'dart',
      });
      await vscode.window.showTextDocument(doc);
    },
  );
}
