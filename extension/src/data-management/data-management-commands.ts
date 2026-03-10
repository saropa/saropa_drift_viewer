import * as vscode from 'vscode';
import * as path from 'path';
import type { DriftApiClient } from '../api-client';
import type { TableItem } from '../tree/tree-items';
import { DependencySorter } from './dependency-sorter';
import { DataReset } from './data-reset';
import { DatasetConfig } from './dataset-config';
import { DatasetImport } from './dataset-import';
import { DatasetExport } from './dataset-export';
import type { IDriftDataset } from './dataset-types';

const PROGRESS = { location: vscode.ProgressLocation.Notification };

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

/** Register all data management commands on the extension context. */
export function registerDataManagementCommands(
  context: vscode.ExtensionContext,
  client: DriftApiClient,
): void {
  const sorter = new DependencySorter();
  const dataReset = new DataReset(client, sorter);
  const datasetConfig = new DatasetConfig();
  const datasetImport = new DatasetImport(client, sorter, dataReset);
  const datasetExport = new DatasetExport(client);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.clearTable',
      async (item?: TableItem) => {
        try {
          const table =
            item?.table.name ?? (await pickTable(client));
          if (!table) return;

          const preview = await dataReset.previewClear([table]);
          const total = preview.reduce(
            (s, p) => s + p.rowCount, 0,
          );
          const details = preview
            .map((p) => `${p.name}: ${p.rowCount} rows`)
            .join(', ');

          const answer = await vscode.window.showWarningMessage(
            `Clear ${total.toLocaleString()} rows? (${details})`,
            'Clear', 'Cancel',
          );
          if (answer !== 'Clear') return;

          const result = await vscode.window.withProgress(
            { ...PROGRESS, title: `Clearing ${table}\u2026` },
            () => dataReset.clearTable(table),
          );
          vscode.window.showInformationMessage(
            `Cleared ${result.totalDeleted.toLocaleString()} rows from ${result.tables.length} table(s).`,
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Clear failed: ${msg}`);
        }
      },
    ),

    vscode.commands.registerCommand(
      'driftViewer.clearAllTables',
      async () => {
        try {
          const meta = await client.schemaMetadata();
          const total = meta
            .filter((t) => !t.name.startsWith('sqlite_'))
            .reduce((s, t) => s + t.rowCount, 0);

          const answer = await vscode.window.showWarningMessage(
            `Clear ALL data? (${total.toLocaleString()} rows)`,
            'Clear All', 'Cancel',
          );
          if (answer !== 'Clear All') return;

          const result = await vscode.window.withProgress(
            { ...PROGRESS, title: 'Clearing all tables\u2026' },
            () => dataReset.clearAll(),
          );
          vscode.window.showInformationMessage(
            `Cleared ${result.totalDeleted.toLocaleString()} rows.`,
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Clear all failed: ${msg}`);
        }
      },
    ),

    vscode.commands.registerCommand(
      'driftViewer.clearTableGroup',
      async () => {
        try {
          const ws =
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (!ws) return;
          const config = await datasetConfig.load(ws);
          if (!config || Object.keys(config.groups).length === 0) {
            vscode.window.showWarningMessage(
              'No table groups defined. Create a .drift-datasets.json in your workspace root.',
            );
            return;
          }

          const group = await vscode.window.showQuickPick(
            Object.entries(config.groups).map(
              ([name, tables]) => ({
                label: name,
                description: tables.join(', '),
                tables,
              }),
            ),
            { placeHolder: 'Select a group to clear' },
          );
          if (!group) return;

          const preview = await dataReset.previewClear(group.tables);
          const total = preview.reduce(
            (s, p) => s + p.rowCount, 0,
          );
          const answer = await vscode.window.showWarningMessage(
            `Clear group "${group.label}"? (${total.toLocaleString()} rows)`,
            'Clear', 'Cancel',
          );
          if (answer !== 'Clear') return;

          const result = await vscode.window.withProgress(
            { ...PROGRESS, title: `Clearing "${group.label}"\u2026` },
            () => dataReset.clearGroup(group.tables),
          );
          vscode.window.showInformationMessage(
            `Cleared ${result.totalDeleted.toLocaleString()} rows from "${group.label}".`,
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Clear group failed: ${msg}`);
        }
      },
    ),

    vscode.commands.registerCommand(
      'driftViewer.importDataset',
      async () => {
        try {
          const ws =
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          const config = ws ? await datasetConfig.load(ws) : null;
          const datasetPaths = config?.datasets ?? {};

          const options = [
            ...Object.entries(datasetPaths).map(([name, p]) => ({
              label: name, description: p,
              filePath: path.resolve(ws ?? '', p),
            })),
            { label: 'Browse for file\u2026', description: '', filePath: '' },
          ];
          const pick = await vscode.window.showQuickPick(options);
          if (!pick) return;

          let filePath = pick.filePath;
          if (!filePath) {
            const uris = await vscode.window.showOpenDialog({
              filters: { 'Drift Dataset': ['json'] },
            });
            if (!uris?.[0]) return;
            filePath = uris[0].fsPath;
          }

          const raw = await vscode.workspace.fs.readFile(
            vscode.Uri.file(filePath),
          );
          const dataset = JSON.parse(
            Buffer.from(raw).toString(),
          ) as IDriftDataset;

          const validation = await datasetImport.validate(dataset);
          if (!validation.valid) {
            vscode.window.showErrorMessage(
              `Invalid: ${validation.errors.join('; ')}`,
            );
            return;
          }
          if (validation.warnings.length > 0) {
            vscode.window.showWarningMessage(
              `Warnings: ${validation.warnings.join('; ')}`,
            );
          }

          const mode = await vscode.window.showQuickPick([
            { label: 'Append', description: 'Add rows to existing data', value: 'append' as const },
            { label: 'Replace', description: 'Clear target tables first', value: 'replace' as const },
            { label: 'SQL only', description: 'Generate SQL without executing', value: 'sql' as const },
          ]);
          if (!mode) return;

          if (mode.value === 'sql') {
            const sql = datasetImport.toSql(dataset);
            const doc = await vscode.workspace.openTextDocument({
              content: sql, language: 'sql',
            });
            await vscode.window.showTextDocument(doc);
            return;
          }

          const result = await vscode.window.withProgress(
            { ...PROGRESS, title: 'Importing dataset\u2026' },
            () => datasetImport.import(dataset, mode.value),
          );
          vscode.window.showInformationMessage(
            `Imported ${result.totalInserted} rows across ${result.tables.length} tables.`,
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Import failed: ${msg}`);
        }
      },
    ),

    vscode.commands.registerCommand(
      'driftViewer.exportDataset',
      async () => {
        try {
          const meta = await client.schemaMetadata();
          const tables = meta.filter(
            (t) => !t.name.startsWith('sqlite_'),
          );

          const selected = await vscode.window.showQuickPick(
            tables.map((t) => ({
              label: t.name,
              description: `${t.rowCount} rows`,
              picked: true,
            })),
            { canPickMany: true, placeHolder: 'Select tables' },
          );
          if (!selected?.length) return;

          const name = await vscode.window.showInputBox({
            prompt: 'Dataset name',
          });
          if (!name) return;

          const dataset = await vscode.window.withProgress(
            { ...PROGRESS, title: 'Exporting dataset\u2026' },
            () => datasetExport.export(
              selected.map((s) => s.label), name,
            ),
          );
          const json = JSON.stringify(dataset, null, 2);

          const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(
              `${name}.drift-dataset.json`,
            ),
            filters: { 'Drift Dataset': ['json'] },
          });
          if (uri) {
            await vscode.workspace.fs.writeFile(
              uri, Buffer.from(json, 'utf-8'),
            );
            vscode.window.showInformationMessage(
              `Dataset exported: ${uri.fsPath}`,
            );
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Export failed: ${msg}`);
        }
      },
    ),
  );
}
