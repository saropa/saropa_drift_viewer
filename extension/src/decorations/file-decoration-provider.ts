import * as vscode from 'vscode';
import { DriftApiClient } from '../api-client';
import { TableNameMapper } from '../codelens/table-name-mapper';

const TABLE_CLASS_RE = /^\s*class\s+(\w+)\s+extends\s+Table\b/gm;

/** Format a row count as a short badge label. */
export function formatBadge(n: number): string {
  // Use 999_500 threshold so rounding doesn't produce "1000K"
  if (n >= 999_500) return `${Math.round(n / 1_000_000)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/**
 * Scan workspace `.dart` files for `class X extends Table` declarations
 * and map each SQL table name to its source file path.
 */
export async function buildTableFileMap(
  mapper: TableNameMapper,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const uris = await vscode.workspace.findFiles('**/*.dart', '**/.*');

  for (const uri of uris) {
    const doc = await vscode.workspace.openTextDocument(uri);
    const text = doc.getText();
    TABLE_CLASS_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TABLE_CLASS_RE.exec(text)) !== null) {
      const sqlName = mapper.resolve(m[1]);
      if (sqlName) {
        result.set(sqlName, uri.fsPath);
      }
    }
  }

  return result;
}

interface FileAggregation {
  totalRows: number;
  lines: string[];
}

/**
 * Shows row-count badges on `.dart` files that define Drift tables.
 */
export class DriftFileDecorationProvider
  implements vscode.FileDecorationProvider
{
  private readonly _onDidChange =
    new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();
  readonly onDidChangeFileDecorations = this._onDidChange.event;

  private _decorations = new Map<string, vscode.FileDecoration>();

  provideFileDecoration(
    uri: vscode.Uri,
  ): vscode.FileDecoration | undefined {
    return this._decorations.get(uri.toString());
  }

  /**
   * Refresh badge decorations from live server data.
   *
   * @param client       API client for schema metadata
   * @param tableFileMap SQL table name to file path mapping
   */
  async refresh(
    client: DriftApiClient,
    tableFileMap: Map<string, string>,
  ): Promise<void> {
    const tables = await client.schemaMetadata();

    const perFile = new Map<string, FileAggregation>();
    for (const t of tables) {
      const path = tableFileMap.get(t.name);
      if (!path) continue;
      const entry = perFile.get(path) ?? { totalRows: 0, lines: [] };
      entry.totalRows += t.rowCount;
      entry.lines.push(`${t.name}: ${t.rowCount.toLocaleString()} rows`);
      perFile.set(path, entry);
    }

    const stale = new Set(this._decorations.keys());
    this._decorations.clear();
    const changed: vscode.Uri[] = [];

    for (const [path, data] of perFile) {
      const uri = vscode.Uri.file(path);
      const key = uri.toString();
      stale.delete(key);
      this._decorations.set(
        key,
        new vscode.FileDecoration(
          formatBadge(data.totalRows),
          data.lines.join('\n'),
        ),
      );
      changed.push(uri);
    }

    for (const key of stale) {
      changed.push(vscode.Uri.parse(key));
    }

    if (changed.length > 0) {
      this._onDidChange.fire(changed);
    }
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
