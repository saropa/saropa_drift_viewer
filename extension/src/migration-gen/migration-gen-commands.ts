/**
 * Registers the Generate Migration command on the extension context.
 * Computes schema diff, prompts for version numbers, and opens
 * generated Dart migration code in a new editor.
 */

import * as vscode from 'vscode';
import type { DriftApiClient } from '../api-client';
import { parseDartTables } from '../schema-diff/dart-parser';
import {
  computeSchemaDiff,
  hasDifferences,
} from '../schema-diff/schema-diff';
import { generateMigrationDart } from './migration-codegen';

/** Register migration-gen commands on the extension context. */
export function registerMigrationGenCommands(
  context: vscode.ExtensionContext,
  client: DriftApiClient,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.generateMigration',
      async () => {
        try {
          const diff = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'Computing schema diff\u2026',
            },
            async () => {
              const dartUris = await vscode.workspace.findFiles(
                '**/*.dart',
                '{**/build/**,.dart_tool/**,**/*.g.dart,**/*.freezed.dart}',
              );
              const tables = [];
              for (const uri of dartUris) {
                const doc =
                  await vscode.workspace.openTextDocument(uri);
                tables.push(
                  ...parseDartTables(
                    doc.getText(), uri.toString(),
                  ),
                );
              }
              const runtime = await client.schemaMetadata();
              return computeSchemaDiff(tables, runtime);
            },
          );

          if (!hasDifferences(diff)) {
            vscode.window.showInformationMessage(
              'Schema is up to date \u2014 no migration needed.',
            );
            return;
          }

          const fromStr = await vscode.window.showInputBox({
            prompt: 'Current schema version',
            placeHolder: 'e.g., 4',
            validateInput: (v) =>
              /^\d+$/.test(v) ? null : 'Enter a number',
          });
          if (!fromStr) return;

          const toStr = await vscode.window.showInputBox({
            prompt: 'Target schema version',
            value: String(parseInt(fromStr) + 1),
            validateInput: (v) =>
              /^\d+$/.test(v) ? null : 'Enter a number',
          });
          if (!toStr) return;

          const dartCode = generateMigrationDart(
            diff, parseInt(fromStr), parseInt(toStr),
          );
          if (!dartCode) return;

          const doc = await vscode.workspace.openTextDocument({
            content: dartCode,
            language: 'dart',
          });
          await vscode.window.showTextDocument(doc);
        } catch (err: unknown) {
          const msg =
            err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `Generate migration failed: ${msg}`,
          );
        }
      },
    ),
  );
}
