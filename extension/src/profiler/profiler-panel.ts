/**
 * Singleton webview panel for Column Profiler.
 * Follows the SizePanel pattern.
 */

import * as vscode from 'vscode';
import type { IColumnProfile } from './profiler-types';
import { buildProfilerHtml } from './profiler-html';

/** Singleton panel showing column profile statistics. */
export class ProfilerPanel {
  private static _currentPanel: ProfilerPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];
  private _profile: IColumnProfile;

  static createOrShow(profile: IColumnProfile): void {
    const column = vscode.ViewColumn.Beside;

    if (ProfilerPanel._currentPanel) {
      ProfilerPanel._currentPanel._update(profile);
      ProfilerPanel._currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'driftProfiler',
      `Profile: ${profile.table}.${profile.column}`,
      column,
      { enableScripts: true },
    );
    ProfilerPanel._currentPanel = new ProfilerPanel(panel, profile);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    profile: IColumnProfile,
  ) {
    this._panel = panel;
    this._profile = profile;

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

  private _update(profile: IColumnProfile): void {
    this._profile = profile;
    this._panel.title = `Profile: ${profile.table}.${profile.column}`;
    this._render();
  }

  private _render(): void {
    this._panel.webview.html = buildProfilerHtml(this._profile);
  }

  private _handleMessage(msg: { command: string }): void {
    switch (msg.command) {
      case 'copyJson':
        vscode.env.clipboard.writeText(
          JSON.stringify(this._profile, null, 2),
        );
        break;
    }
  }

  private _dispose(): void {
    ProfilerPanel._currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
  }
}
