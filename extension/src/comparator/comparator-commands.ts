import * as vscode from 'vscode';
import type { DriftApiClient } from '../api-client';
import type { TableItem } from '../tree/tree-items';
import { rowsToObjects } from '../timeline/snapshot-store';
import { RowDiffer } from './row-differ';
import { ComparatorPanel } from './comparator-panel';

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

/** Quote a PK value for use in a WHERE clause. */
function sqlLiteral(value: string): string {
  // If it looks numeric, use as-is
  if (/^-?\d+(\.\d+)?$/.test(value)) return value;
  // Otherwise, quote as a string (escape single quotes)
  return `'${value.replace(/'/g, "''")}'`;
}

/** Register the compareRows command. */
export function registerComparatorCommands(
  context: vscode.ExtensionContext,
  client: DriftApiClient,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.compareRows',
      async (item?: TableItem) => {
        try {
          await compareRows(client, item);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Compare failed: ${msg}`);
        }
      },
    ),
  );
}

async function compareRows(
  client: DriftApiClient,
  item?: TableItem,
): Promise<void> {
  // Row A — table + PK
  const tableA = item?.table.name ?? (await pickTable(client));
  if (!tableA) return;
  const pkA = await vscode.window.showInputBox({
    prompt: `Row A: Primary key value in "${tableA}"`,
    validateInput: (v) => v.trim() ? null : 'Enter a primary key value',
  });
  if (!pkA) return;

  // Row B — same or different table
  const scope = await vscode.window.showQuickPick(
    [
      { label: `Same table (${tableA})`, value: 'same' },
      { label: 'Different table', value: 'different' },
    ],
    { placeHolder: 'Compare with...' },
  );
  if (!scope) return;

  const tableB =
    scope.value === 'same' ? tableA : (await pickTable(client));
  if (!tableB) return;
  const pkB = await vscode.window.showInputBox({
    prompt: `Row B: Primary key value in "${tableB}"`,
    validateInput: (v) => v.trim() ? null : 'Enter a primary key value',
  });
  if (!pkB) return;

  // Fetch rows
  const { pkColA, pkColB, rowA, rowB } = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Comparing rows\u2026' },
    async () => {
      const meta = await client.schemaMetadata();
      const findPk = (table: string): string =>
        meta.find((t) => t.name === table)
          ?.columns.find((c) => c.pk)?.name ?? 'id';

      const colA = findPk(tableA);
      const colB = findPk(tableB);

      const [resultA, resultB] = await Promise.all([
        client.sql(
          `SELECT * FROM "${tableA}" WHERE "${colA}" = ${sqlLiteral(pkA)} LIMIT 1`,
        ),
        client.sql(
          `SELECT * FROM "${tableB}" WHERE "${colB}" = ${sqlLiteral(pkB)} LIMIT 1`,
        ),
      ]);

      return {
        pkColA: colA,
        pkColB: colB,
        rowA: rowsToObjects(resultA.columns, resultA.rows),
        rowB: rowsToObjects(resultB.columns, resultB.rows),
      };
    },
  );

  if (rowA.length === 0) {
    vscode.window.showWarningMessage(
      `Row not found: ${tableA}.${pkColA}=${pkA}`,
    );
    return;
  }
  if (rowB.length === 0) {
    vscode.window.showWarningMessage(
      `Row not found: ${tableB}.${pkColB}=${pkB}`,
    );
    return;
  }

  const differ = new RowDiffer();
  const diff = differ.diff(
    rowA[0],
    rowB[0],
    `${tableA}.${pkColA}=${pkA}`,
    `${tableB}.${pkColB}=${pkB}`,
  );

  ComparatorPanel.createOrShow(diff);
}
