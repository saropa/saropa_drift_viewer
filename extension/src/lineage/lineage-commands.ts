import * as vscode from 'vscode';
import type { DriftApiClient } from '../api-client';
import type { TableItem } from '../tree/tree-items';
import { LineageTracer } from './lineage-tracer';
import { LineagePanel } from './lineage-panel';

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

/** Register the traceLineage command. */
export function registerLineageCommands(
  context: vscode.ExtensionContext,
  client: DriftApiClient,
): void {
  const tracer = new LineageTracer(client);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.traceLineage',
      async (item?: TableItem) => {
        try {
          await traceLineage(client, tracer, item);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Lineage trace failed: ${msg}`);
        }
      },
    ),
  );
}

async function traceLineage(
  client: DriftApiClient,
  tracer: LineageTracer,
  item?: TableItem,
): Promise<void> {
  const table = item?.table.name ?? (await pickTable(client));
  if (!table) return;

  const meta = await client.schemaMetadata();
  const tableMeta = meta.find((t) => t.name === table);
  if (!tableMeta) return;

  const pkCol = tableMeta.columns.find((c) => c.pk)?.name ?? 'rowid';
  const pkInput = await vscode.window.showInputBox({
    prompt: `Enter ${pkCol} value to trace in "${table}"`,
    validateInput: (v) => (v.trim() ? null : 'Enter a primary key value'),
  });
  if (!pkInput) return;

  const pkValue = /^-?\d+(\.\d+)?$/.test(pkInput)
    ? Number(pkInput)
    : pkInput;

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Tracing data lineage\u2026',
    },
    () => tracer.trace(table, pkCol, pkValue, 3, 'both'),
  );

  LineagePanel.createOrShow(tracer, result);
}
