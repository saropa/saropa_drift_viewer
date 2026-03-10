/**
 * Singleton webview panel for Database Size Analytics.
 * Follows the SchemaDiffPanel pattern.
 */

import * as vscode from 'vscode';
import type { ISizeAnalytics } from '../api-types';
import { buildSizeHtml } from './size-html';

/** Singleton panel showing database size breakdown. */
export class SizePanel {
  private static _currentPanel: SizePanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];
  private _data: ISizeAnalytics;

  static createOrShow(data: ISizeAnalytics): void {
    const column = vscode.ViewColumn.Beside;

    if (SizePanel._currentPanel) {
      SizePanel._currentPanel._update(data);
      SizePanel._currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'driftSize',
      'Size Analytics',
      column,
      { enableScripts: true },
    );
    SizePanel._currentPanel = new SizePanel(panel, data);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    data: ISizeAnalytics,
  ) {
    this._panel = panel;
    this._data = data;

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

  private _update(data: ISizeAnalytics): void {
    this._data = data;
    this._panel.title = 'Size Analytics';
    this._render();
  }

  private _render(): void {
    this._panel.webview.html = buildSizeHtml(this._data);
  }

  private _handleMessage(msg: { command: string }): void {
    switch (msg.command) {
      case 'copyReport':
        vscode.env.clipboard.writeText(
          JSON.stringify(this._data, null, 2),
        );
        break;
    }
  }

  private _dispose(): void {
    SizePanel._currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
  }
}
