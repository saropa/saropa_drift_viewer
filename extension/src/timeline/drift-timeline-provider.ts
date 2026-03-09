import * as vscode from 'vscode';
import { ISnapshot, SnapshotStore } from './snapshot-store';

/** Format a timestamp as a relative time string. */
export function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

/**
 * Provides database snapshot history in VS Code's Timeline panel.
 *
 * When a `.dart` file defining a Drift table is selected, timeline entries
 * show row count changes over time.
 */
export class DriftTimelineProvider implements vscode.TimelineProvider {
  readonly id = 'driftViewer.timeline';
  readonly label = 'Drift Database';

  private readonly _onDidChange =
    new vscode.EventEmitter<vscode.TimelineChangeEvent | undefined>();
  readonly onDidChange = this._onDidChange.event;

  /** Reverse map: filePath → SQL table names defined in that file. */
  private _fileToTables = new Map<string, string[]>();

  private readonly _storeListener: vscode.Disposable;

  constructor(private readonly _store: SnapshotStore) {
    this._storeListener = _store.onDidChange(() =>
      this._onDidChange.fire(undefined),
    );
  }

  /** Rebuild the reverse map from the extension's tableFileMap. */
  updateFileToTables(tableFileMap: Map<string, string>): void {
    this._fileToTables.clear();
    for (const [tableName, filePath] of tableFileMap) {
      const normalised = filePath.replace(/\\/g, '/');
      const existing = this._fileToTables.get(normalised) ?? [];
      existing.push(tableName);
      this._fileToTables.set(normalised, existing);
    }
  }

  async provideTimeline(
    uri: vscode.Uri,
    _options: vscode.TimelineOptions,
    _token: vscode.CancellationToken,
  ): Promise<vscode.Timeline> {
    const fsPath = uri.fsPath.replace(/\\/g, '/');
    const tables = this._fileToTables.get(fsPath);
    if (!tables || tables.length === 0) return { items: [] };

    const snapshots = [...this._store.snapshots].reverse();
    const items: vscode.TimelineItem[] = [];

    for (const snapshot of snapshots) {
      for (const tableName of tables) {
        const tableData = snapshot.tables.get(tableName);
        if (!tableData) continue;

        const delta = this._computeDelta(tableName, snapshot);
        const label = `${tableName}: ${tableData.rowCount} rows${delta}`;

        const item = new vscode.TimelineItem(label, snapshot.timestamp);
        item.id = `${snapshot.id}:${tableName}`;
        item.description = formatRelativeTime(snapshot.timestamp);
        item.iconPath = new vscode.ThemeIcon('history');
        item.command = {
          command: 'driftViewer.showSnapshotDiff',
          title: 'Show Diff',
          arguments: [snapshot.id, tableName],
        };
        items.push(item);
      }
    }

    return { items };
  }

  private _computeDelta(
    tableName: string,
    snapshot: ISnapshot,
  ): string {
    const newer = this._store.getNewerSnapshot(snapshot);
    if (!newer) return ' (latest)';

    const oldCount = snapshot.tables.get(tableName)?.rowCount ?? 0;
    const newCount = newer.tables.get(tableName)?.rowCount ?? 0;
    const diff = newCount - oldCount;

    if (diff > 0) return ` (+${diff})`;
    if (diff < 0) return ` (${diff})`;
    return ' (unchanged)';
  }

  dispose(): void {
    this._storeListener.dispose();
    this._onDidChange.dispose();
  }
}
