/**
 * Singleton webview panel for the Data Sampling Explorer.
 * Delegates sampling execution to SamplingEngine and
 * renders results via sampling-html.
 */

import * as vscode from 'vscode';
import type { ColumnMetadata } from '../api-types';
import { escapeCsvCell } from '../shared-utils';
import { SamplingEngine } from './sampling-engine';
import { buildSamplingHtml } from './sampling-html';
import type { ISamplingConfig, ISamplingResult } from './sampling-types';

interface ISampleMessage {
  command: 'sample';
  config: ISamplingConfig;
}

interface ICopySqlMessage {
  command: 'copySql';
}

interface IExportCsvMessage {
  command: 'exportCsv';
}

type PanelMessage = ISampleMessage | ICopySqlMessage | IExportCsvMessage;

/** Singleton webview panel for data sampling exploration. */
export class SamplingPanel {
  private static _currentPanel: SamplingPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];
  private readonly _engine: SamplingEngine;
  private _table: string;
  private _columns: ColumnMetadata[];
  private _totalRows: number;
  private _lastResult: ISamplingResult | undefined;

  static createOrShow(
    engine: SamplingEngine,
    table: string,
    columns: ColumnMetadata[],
    totalRows: number,
  ): void {
    const column = vscode.ViewColumn.Active;

    if (SamplingPanel._currentPanel) {
      SamplingPanel._currentPanel._update(table, columns, totalRows);
      SamplingPanel._currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'driftSampling',
      `Sample: ${table}`,
      column,
      { enableScripts: true },
    );
    SamplingPanel._currentPanel = new SamplingPanel(
      panel, engine, table, columns, totalRows,
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    engine: SamplingEngine,
    table: string,
    columns: ColumnMetadata[],
    totalRows: number,
  ) {
    this._panel = panel;
    this._engine = engine;
    this._table = table;
    this._columns = columns;
    this._totalRows = totalRows;

    this._panel.onDidDispose(
      () => this._dispose(), null, this._disposables,
    );
    this._panel.webview.onDidReceiveMessage(
      (msg: PanelMessage) => this._handleMessage(msg),
      null,
      this._disposables,
    );
    this._render();
  }

  private _update(
    table: string,
    columns: ColumnMetadata[],
    totalRows: number,
  ): void {
    this._table = table;
    this._columns = columns;
    this._totalRows = totalRows;
    this._lastResult = undefined;
    this._panel.title = `Sample: ${table}`;
    this._render();
  }

  private _render(): void {
    this._panel.webview.html = buildSamplingHtml(
      this._table, this._columns, this._totalRows, this._lastResult,
    );
  }

  private async _handleMessage(msg: PanelMessage): Promise<void> {
    switch (msg.command) {
      case 'sample':
        await this._runSample(msg.config);
        break;
      case 'copySql':
        if (this._lastResult?.sql) {
          await vscode.env.clipboard.writeText(this._lastResult.sql);
        }
        break;
      case 'exportCsv':
        if (this._lastResult) {
          await vscode.env.clipboard.writeText(
            this._buildCsv(this._lastResult),
          );
        }
        break;
    }
  }

  private async _runSample(config: ISamplingConfig): Promise<void> {
    this._panel.webview.html = buildSamplingHtml(
      this._table, this._columns, this._totalRows, undefined, true,
    );

    try {
      this._lastResult = await this._engine.sample(config);
      this._panel.webview.html = buildSamplingHtml(
        this._table, this._columns, this._totalRows, this._lastResult,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._lastResult = undefined;
      this._render();
      vscode.window.showErrorMessage(`Sampling failed: ${message}`);
    }
  }

  private _buildCsv(result: ISamplingResult): string {
    if (result.rows.length === 0) return '';
    const cols = result.columns;
    const header = cols.map((c) => escapeCsvCell(c)).join(',');
    const rows = result.rows.map(
      (row) => cols.map((c) => escapeCsvCell(row[c])).join(','),
    );
    return [header, ...rows].join('\n');
  }

  private _dispose(): void {
    SamplingPanel._currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
  }
}
