import * as vscode from 'vscode';
import type { DriftApiClient } from '../api-client';
import type { GenerationWatcher } from '../generation-watcher';
import type { ISchemaSnapshot, ITableSnapshot } from './schema-timeline-types';

const STATE_KEY = 'schema.timeline';
const MAX_SNAPSHOTS = 100;

/** Captures schema snapshots on generation change and persists them. */
export class SchemaTracker implements vscode.Disposable {
  private _snapshots: ISchemaSnapshot[];
  private _capturing = false;
  private readonly _disposable: vscode.Disposable;

  private readonly _onDidUpdate =
    new vscode.EventEmitter<readonly ISchemaSnapshot[]>();
  readonly onDidUpdate = this._onDidUpdate.event;

  constructor(
    private readonly _client: DriftApiClient,
    private readonly _state: vscode.Memento,
    watcher: GenerationWatcher,
  ) {
    this._snapshots = _state.get<ISchemaSnapshot[]>(STATE_KEY, []);

    this._disposable = watcher.onDidChange(async () => {
      await this._capture(watcher.generation);
    });
  }

  private async _capture(generation: number): Promise<void> {
    if (this._capturing) {
      return;
    }
    this._capturing = true;
    try {
      const diagram = await this._client.schemaDiagram();
      const tables: ITableSnapshot[] = [];

      for (const table of diagram.tables) {
        if (table.name.startsWith('sqlite_')) {
          continue;
        }

        const tableFks = diagram.foreignKeys
          .filter((fk) => fk.fromTable === table.name)
          .map((fk) => ({
            fromColumn: fk.fromColumn,
            toTable: fk.toTable,
            toColumn: fk.toColumn,
          }));

        tables.push({
          name: table.name,
          columns: table.columns.map((c) => ({
            name: c.name,
            type: c.type,
            pk: c.pk !== 0,
          })),
          fks: tableFks,
        });
      }

      const snapshot: ISchemaSnapshot = {
        generation,
        timestamp: new Date().toISOString(),
        tables,
      };

      this._snapshots.push(snapshot);

      if (this._snapshots.length > MAX_SNAPSHOTS) {
        this._snapshots = this._snapshots.slice(-MAX_SNAPSHOTS);
      }

      this._state.update(STATE_KEY, this._snapshots);
      this._onDidUpdate.fire(this._snapshots);
    } catch {
      // Server unreachable — skip this capture
    } finally {
      this._capturing = false;
    }
  }

  /** Returns all captured snapshots. */
  getAll(): readonly ISchemaSnapshot[] {
    return this._snapshots;
  }

  /** Clears all stored snapshots. */
  clear(): void {
    this._snapshots = [];
    this._state.update(STATE_KEY, this._snapshots);
    this._onDidUpdate.fire(this._snapshots);
  }

  dispose(): void {
    this._disposable.dispose();
    this._onDidUpdate.dispose();
  }
}
