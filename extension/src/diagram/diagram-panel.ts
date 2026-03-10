/**
 * Singleton webview panel for Schema Diagram visualization.
 * Follows the SchemaDiffPanel pattern.
 */

import * as vscode from 'vscode';
import type { IDiagramData } from '../api-types';
import { buildDiagramHtml } from './diagram-html';

/** Singleton panel showing an ER-style schema diagram. */
export class DiagramPanel {
  private static _currentPanel: DiagramPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];
  private _data: IDiagramData;

  static createOrShow(data: IDiagramData): void {
    const column = vscode.ViewColumn.Beside;

    if (DiagramPanel._currentPanel) {
      DiagramPanel._currentPanel._update(data);
      DiagramPanel._currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'driftDiagram',
      'Schema Diagram',
      column,
      { enableScripts: true },
    );
    DiagramPanel._currentPanel = new DiagramPanel(panel, data);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    data: IDiagramData,
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

  private _update(data: IDiagramData): void {
    this._data = data;
    this._panel.title = 'Schema Diagram';
    this._render();
  }

  private _render(): void {
    this._panel.webview.html = buildDiagramHtml(this._data);
  }

  private _handleMessage(msg: { command: string; name?: string }): void {
    switch (msg.command) {
      case 'copyTableName':
        if (msg.name) {
          vscode.env.clipboard.writeText(msg.name);
        }
        break;
    }
  }

  private _dispose(): void {
    DiagramPanel._currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
  }
}
