/**
 * Multi-step import wizard using VS Code native QuickPick + file picker.
 * No webview panel needed.
 */

import * as vscode from 'vscode';
import type { DriftApiClient } from '../api-client';

const FORMAT_OPTIONS: vscode.QuickPickItem[] = [
  { label: 'JSON', description: 'Array of objects' },
  { label: 'CSV', description: 'Header row + data rows' },
  { label: 'SQL', description: 'INSERT statements' },
];

const FILE_FILTERS: Record<string, Record<string, string[]>> = {
  json: { JSON: ['json'] },
  csv: { CSV: ['csv', 'tsv'] },
  sql: { SQL: ['sql'] },
};

/** Run the import wizard. Returns when complete or cancelled. */
export async function runImportWizard(
  client: DriftApiClient,
): Promise<void> {
  // Step 1: pick format
  const formatPick = await vscode.window.showQuickPick(FORMAT_OPTIONS, {
    title: 'Import Data (1/3): Select format',
    placeHolder: 'Choose import format',
  });
  if (!formatPick) return;
  const format = formatPick.label.toLowerCase();

  // Step 2: pick file
  const fileUris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    title: 'Import Data (2/3): Select file',
    filters: FILE_FILTERS[format] ?? {},
  });
  if (!fileUris || fileUris.length === 0) return;

  let data: string;
  try {
    const fileBytes = await vscode.workspace.fs.readFile(fileUris[0]);
    data = Buffer.from(fileBytes).toString('utf-8');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Failed to read file: ${msg}`);
    return;
  }

  // Step 3: pick target table
  let tableItems: vscode.QuickPickItem[];
  try {
    const tables = await client.schemaMetadata();
    tableItems = tables.map((t) => ({
      label: t.name,
      description: `${t.rowCount} rows`,
    }));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Failed to load tables: ${msg}`);
    return;
  }

  const tablePick = await vscode.window.showQuickPick(tableItems, {
    title: 'Import Data (3/3): Select target table',
    placeHolder: 'Choose table to import into',
  });
  if (!tablePick) return;

  // Execute import
  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Importing into ${tablePick.label}\u2026`,
      },
      () => client.importData(format, tablePick.label, data),
    );
    const msg = `Imported ${result.imported} rows into ${result.table}.`;
    if (result.errors.length > 0) {
      const errMsg = result.errors.slice(0, 5).join('\n');
      const suffix = result.errors.length > 5
        ? `\n...and ${result.errors.length - 5} more`
        : '';
      vscode.window.showWarningMessage(
        `${msg} ${result.errors.length} error(s):\n${errMsg}${suffix}`,
      );
    } else {
      vscode.window.showInformationMessage(msg);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Import failed: ${msg}`);
  }
}
