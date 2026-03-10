/**
 * Scans the workspace for Dart files containing Isar collection or
 * embedded annotations, and lets the user pick which to include.
 */

import * as vscode from 'vscode';

/** Exclude generated code and build artifacts. */
const EXCLUDE_PATTERN =
  '{**/build/**,.dart_tool/**,**/*.g.dart,**/*.freezed.dart}';

/** Quick check for Isar markers without full parsing. */
export const MARKER_RE =
  /@(?:collection|Collection\(\)|embedded|Embedded\(\))/;

/** Matches `@collection` or `@Collection()` annotations. */
export const COLLECTION_COUNT_RE = /@(?:collection|Collection\(\))/g;

/** Matches `@embedded` or `@Embedded()` annotations. */
export const EMBEDDED_COUNT_RE = /@(?:embedded|Embedded\(\))/g;

/** Counts of markers found in a file (for display purposes). */
export interface IIsarFileInfo {
  uri: vscode.Uri;
  collectionCount: number;
  embeddedCount: number;
}

/** QuickPick item with URI attached. */
interface IIsarFilePickItem extends vscode.QuickPickItem {
  uri: vscode.Uri;
}

/** Scan workspace for files containing Isar annotations. */
async function findIsarFiles(): Promise<IIsarFileInfo[]> {
  const dartUris = await vscode.workspace.findFiles(
    '**/*.dart',
    EXCLUDE_PATTERN,
  );

  const results: IIsarFileInfo[] = [];
  for (const uri of dartUris) {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(bytes).toString('utf-8');
    if (!MARKER_RE.test(text)) continue;

    const collectionCount =
      (text.match(COLLECTION_COUNT_RE) ?? []).length;
    const embeddedCount =
      (text.match(EMBEDDED_COUNT_RE) ?? []).length;

    results.push({ uri, collectionCount, embeddedCount });
  }

  return results;
}

/** Format a description string from collection/embedded counts. */
export function formatDescription(info: IIsarFileInfo): string {
  const parts: string[] = [];
  if (info.collectionCount > 0) {
    parts.push(
      `${info.collectionCount} collection${info.collectionCount > 1 ? 's' : ''}`,
    );
  }
  if (info.embeddedCount > 0) {
    parts.push(
      `${info.embeddedCount} embedded`,
    );
  }
  return parts.join(', ');
}

/**
 * Scan workspace for Isar files and present a multi-select QuickPick.
 * Returns selected URIs or `undefined` if cancelled / nothing found.
 */
export async function scanWorkspaceForIsarFiles():
  Promise<vscode.Uri[] | undefined> {

  const files = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Scanning workspace for Isar collections\u2026',
    },
    () => findIsarFiles(),
  );

  if (files.length === 0) {
    vscode.window.showInformationMessage(
      'No Dart files with @collection or @embedded found in workspace.',
    );
    return undefined;
  }

  const items: IIsarFilePickItem[] = files.map((f) => ({
    label: vscode.workspace.asRelativePath(f.uri),
    description: formatDescription(f),
    picked: true,
    uri: f.uri,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: `Select Isar files (${files.length} found)`,
  });

  if (!selected?.length) return undefined;
  return selected.map((s) => s.uri);
}
