import * as vscode from 'vscode';
import * as path from 'path';
import type { IDriftDatasetsConfig } from './dataset-types';

/** Reads `.drift-datasets.json` for table groups and named dataset paths. */
export class DatasetConfig {
  private _config: IDriftDatasetsConfig | null = null;

  async load(
    workspaceRoot: string,
  ): Promise<IDriftDatasetsConfig | null> {
    const configPath = path.join(
      workspaceRoot,
      '.drift-datasets.json',
    );
    try {
      const raw = await vscode.workspace.fs.readFile(
        vscode.Uri.file(configPath),
      );
      this._config = JSON.parse(
        Buffer.from(raw).toString(),
      ) as IDriftDatasetsConfig;
      return this._config;
    } catch {
      return null;
    }
  }

  getGroups(): Record<string, string[]> {
    return this._config?.groups ?? {};
  }

  getDatasetPaths(): Record<string, string> {
    return this._config?.datasets ?? {};
  }
}
