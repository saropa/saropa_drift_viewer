/**
 * Dart file discovery and parsing for diagnostic context.
 * Finds *.dart files in the workspace and extracts table definitions.
 */

import * as vscode from 'vscode';
import { parseDartTables } from '../schema-diff/dart-parser';
import type { IDartFileInfo } from './diagnostic-types';

/**
 * Find all Dart files (excluding build/) and parse table definitions.
 * Used by DiagnosticManager to build context for providers.
 */
export async function parseDartFilesInWorkspace(): Promise<IDartFileInfo[]> {
  const dartUris = await vscode.workspace.findFiles(
    '**/*.dart',
    '**/build/**',
  );
  const files: IDartFileInfo[] = [];

  for (const uri of dartUris) {
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const text = doc.getText();
      const tables = parseDartTables(text, uri.toString());

      if (tables.length > 0) {
        files.push({ uri, text, tables });
      }
    } catch {
      // Skip files that can't be read
    }
  }

  return files;
}
