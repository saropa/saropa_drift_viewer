/**
 * Registers the Isar-to-Drift schema generation command.
 * No server connection needed — operates on workspace files only.
 */

import * as vscode from 'vscode';
import { parseIsarCollections } from './isar-parser';
import { parseIsarJsonSchema } from './isar-json-parser';
import { IsarGenPanel } from './isar-gen-panel';
import type { IIsarCollection, IIsarEmbedded } from './isar-gen-types';

/** Prompt user to pick Isar source files or JSON schema. */
async function pickIsarFiles(): Promise<vscode.Uri[] | undefined> {
  return vscode.window.showOpenDialog({
    canSelectMany: true,
    filters: {
      'Dart / JSON': ['dart', 'json'],
    },
    openLabel: 'Select Isar Files',
  });
}

/** Read and parse selected files into collections + embeddeds. */
async function parseFiles(
  uris: vscode.Uri[],
): Promise<{ collections: IIsarCollection[]; embeddeds: IIsarEmbedded[] }> {
  const allCollections: IIsarCollection[] = [];
  const allEmbeddeds: IIsarEmbedded[] = [];

  for (const uri of uris) {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(bytes).toString('utf-8');
    const path = uri.fsPath;

    if (path.endsWith('.json')) {
      const result = parseIsarJsonSchema(text);
      allCollections.push(...result.collections);
      allEmbeddeds.push(...result.embeddeds);
    } else {
      const result = parseIsarCollections(text, path);
      allCollections.push(...result.collections);
      allEmbeddeds.push(...result.embeddeds);
    }
  }

  return { collections: allCollections, embeddeds: allEmbeddeds };
}

/** Register the isarToDrift command. */
export function registerIsarGenCommands(
  context: vscode.ExtensionContext,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.isarToDrift',
      async () => {
        try {
          const uris = await pickIsarFiles();
          if (!uris || uris.length === 0) return;

          const { collections, embeddeds } = await parseFiles(uris);
          if (collections.length === 0) {
            vscode.window.showWarningMessage(
              'No Isar @collection classes found in selected files.',
            );
            return;
          }

          IsarGenPanel.createOrShow(collections, embeddeds);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `Isar-to-Drift generation failed: ${msg}`,
          );
        }
      },
    ),
  );
}
