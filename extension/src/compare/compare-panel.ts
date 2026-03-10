/**
 * Singleton webview panel for Database Comparison visualization.
 * Follows the SchemaDiffPanel pattern.
 */

import * as vscode from 'vscode';
import type { ICompareReport } from '../api-types';
import { buildCompareHtml } from './compare-html';

/** Singleton panel showing database-A-vs-B comparison. */
export class ComparePanel {
  private static _currentPanel: ComparePanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];
  private _report: ICompareReport;

  static createOrShow(report: ICompareReport): void {
    const column = vscode.ViewColumn.Beside;

    if (ComparePanel._currentPanel) {
      ComparePanel._currentPanel._update(report);
      ComparePanel._currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'driftCompare',
      'Database Comparison',
      column,
      { enableScripts: true },
    );
    ComparePanel._currentPanel = new ComparePanel(panel, report);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    report: ICompareReport,
  ) {
    this._panel = panel;
    this._report = report;

    this._panel.onDidDispose(
      () => this._dispose(), null, this._disposables,
    );
    this._panel.webview.onDidReceiveMessage(
      (msg) => this._handleMessage(msg),
      null,
      this._disposables,
    );
    this._render();
  }

  private _update(report: ICompareReport): void {
    this._report = report;
    this._panel.title = 'Database Comparison';
    this._render();
  }

  private _render(): void {
    this._panel.webview.html = buildCompareHtml(this._report);
  }

  private _handleMessage(msg: { command: string }): void {
    switch (msg.command) {
      case 'copyReport':
        vscode.env.clipboard.writeText(
          JSON.stringify(this._report, null, 2),
        );
        break;
    }
  }

  private _dispose(): void {
    ComparePanel._currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
  }
}
