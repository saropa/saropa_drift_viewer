/**
 * Singleton webview panel for Schema Evolution Timeline.
 * Follows the DiagramPanel pattern.
 */

import * as vscode from 'vscode';
import type { ISchemaSnapshot } from './schema-timeline-types';
import type { SchemaTracker } from './schema-tracker';
import { buildSchemaTimelineHtml } from './schema-timeline-html';

/** Singleton panel showing schema evolution over time. */
export class SchemaTimelinePanel {
  private static _currentPanel: SchemaTimelinePanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];
  private _snapshots: readonly ISchemaSnapshot[];

  static createOrShow(
    snapshots: readonly ISchemaSnapshot[],
    tracker: SchemaTracker,
  ): void {
    const column = vscode.ViewColumn.Beside;

    if (SchemaTimelinePanel._currentPanel) {
      SchemaTimelinePanel._currentPanel._update(snapshots);
      SchemaTimelinePanel._currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'driftSchemaTimeline',
      'Schema Timeline',
      column,
      { enableScripts: true },
    );

    SchemaTimelinePanel._currentPanel =
      new SchemaTimelinePanel(panel, snapshots, tracker);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    snapshots: readonly ISchemaSnapshot[],
    tracker: SchemaTracker,
  ) {
    this._panel = panel;
    this._snapshots = snapshots;

    this._panel.onDidDispose(
      () => this._dispose(), null, this._disposables,
    );
    this._panel.webview.onDidReceiveMessage(
      (msg) => this._handleMessage(msg),
      null,
      this._disposables,
    );

    this._disposables.push(
      tracker.onDidUpdate((updated) => this._update(updated)),
    );

    this._render();
  }

  private _update(snapshots: readonly ISchemaSnapshot[]): void {
    this._snapshots = snapshots;
    this._render();
  }

  private _render(): void {
    this._panel.webview.html = buildSchemaTimelineHtml(this._snapshots);
  }

  private _handleMessage(msg: { command: string }): void {
    switch (msg.command) {
      case 'export':
        vscode.env.clipboard.writeText(
          JSON.stringify(this._snapshots, null, 2),
        );
        vscode.window.showInformationMessage(
          'Schema timeline copied to clipboard.',
        );
        break;
    }
  }

  private _dispose(): void {
    SchemaTimelinePanel._currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
  }
}
