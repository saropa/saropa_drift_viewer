/**
 * Singleton webview panel for Database Health Score dashboard.
 * Follows the DiagramPanel / SizePanel pattern.
 */

import * as vscode from 'vscode';
import type { DriftApiClient } from '../api-client';
import type { IHealthScore } from './health-types';
import { buildHealthHtml } from './health-html';
import { HealthScorer } from './health-scorer';

/** Singleton panel showing the database health score dashboard. */
export class HealthPanel {
  private static _currentPanel: HealthPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];
  private _score: IHealthScore;
  private readonly _client: DriftApiClient;

  static createOrShow(score: IHealthScore, client: DriftApiClient): void {
    const column = vscode.ViewColumn.Beside;

    if (HealthPanel._currentPanel) {
      HealthPanel._currentPanel._update(score);
      HealthPanel._currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'driftHealthScore',
      'Database Health Score',
      column,
      { enableScripts: true },
    );
    HealthPanel._currentPanel = new HealthPanel(panel, score, client);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    score: IHealthScore,
    client: DriftApiClient,
  ) {
    this._panel = panel;
    this._score = score;
    this._client = client;

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

  private _update(score: IHealthScore): void {
    this._score = score;
    this._panel.title = 'Database Health Score';
    this._render();
  }

  private _render(): void {
    this._panel.webview.html = buildHealthHtml(this._score);
  }

  private _handleMessage(
    msg: { command: string; id?: string; actionCommand?: string; args?: unknown },
  ): void {
    switch (msg.command) {
      case 'refresh':
        this._refresh();
        break;
      case 'openCommand':
        if (msg.id) {
          vscode.commands.executeCommand(msg.id);
        }
        break;
      case 'copyReport':
        vscode.env.clipboard.writeText(
          JSON.stringify(this._score, null, 2),
        );
        break;
      case 'executeAction':
        if (msg.actionCommand) {
          vscode.commands.executeCommand(msg.actionCommand, msg.args);
        }
        break;
    }
  }

  private async _refresh(): Promise<void> {
    try {
      const scorer = new HealthScorer();
      const score = await scorer.compute(this._client);
      this._update(score);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Health score refresh failed: ${msg}`);
    }
  }

  private _dispose(): void {
    HealthPanel._currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
  }
}
