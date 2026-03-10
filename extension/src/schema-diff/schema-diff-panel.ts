/**
 * Singleton webview panel for Schema Diff visualization.
 * Follows the ExplainPanel pattern: receives precomputed data, renders HTML.
 */

import * as vscode from 'vscode';
import { ISchemaDiffResult } from './schema-diff';
import { buildSchemaDiffHtml } from './schema-diff-html';
import { generateMigrationDart } from '../migration-gen/migration-codegen';

/** Singleton panel showing code-vs-runtime schema diff. */
export class SchemaDiffPanel {
  private static _currentPanel: SchemaDiffPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];
  private _diff: ISchemaDiffResult;
  private _migrationSql: string;
  private _fullSchemaSql: string;

  static createOrShow(
    diff: ISchemaDiffResult,
    migrationSql: string,
    fullSchemaSql: string,
  ): void {
    const column = vscode.ViewColumn.Beside;

    if (SchemaDiffPanel._currentPanel) {
      SchemaDiffPanel._currentPanel._update(
        diff, migrationSql, fullSchemaSql,
      );
      SchemaDiffPanel._currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'driftSchemaDiff',
      'Schema Diff',
      column,
      { enableScripts: true },
    );
    SchemaDiffPanel._currentPanel = new SchemaDiffPanel(
      panel, diff, migrationSql, fullSchemaSql,
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    diff: ISchemaDiffResult,
    migrationSql: string,
    fullSchemaSql: string,
  ) {
    this._panel = panel;
    this._diff = diff;
    this._migrationSql = migrationSql;
    this._fullSchemaSql = fullSchemaSql;

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

  private _update(
    diff: ISchemaDiffResult,
    migrationSql: string,
    fullSchemaSql: string,
  ): void {
    this._diff = diff;
    this._migrationSql = migrationSql;
    this._fullSchemaSql = fullSchemaSql;
    this._panel.title = 'Schema Diff';
    this._render();
  }

  private _render(): void {
    this._panel.webview.html = buildSchemaDiffHtml(
      this._diff, this._migrationSql, this._fullSchemaSql,
    );
  }

  private _handleMessage(
    msg: { command: string; fileUri?: string; line?: number },
  ): void {
    switch (msg.command) {
      case 'copyMigrationSql':
        vscode.env.clipboard.writeText(this._migrationSql);
        break;
      case 'copyFullSchemaSql':
        vscode.env.clipboard.writeText(this._fullSchemaSql);
        break;
      case 'generateMigration':
        this._promptAndGenerate();
        break;
      case 'navigate':
        if (msg.fileUri && msg.line !== undefined) {
          const uri = vscode.Uri.parse(msg.fileUri);
          const pos = new vscode.Position(msg.line, 0);
          const sel = new vscode.Range(pos, pos);
          vscode.window.showTextDocument(uri, { selection: sel });
        }
        break;
    }
  }

  private async _promptAndGenerate(): Promise<void> {
    const fromStr = await vscode.window.showInputBox({
      prompt: 'Current schema version',
      placeHolder: 'e.g., 4',
      validateInput: (v) =>
        /^\d+$/.test(v) ? null : 'Enter a number',
    });
    if (!fromStr) return;

    const toStr = await vscode.window.showInputBox({
      prompt: 'Target schema version',
      value: String(parseInt(fromStr) + 1),
      validateInput: (v) =>
        /^\d+$/.test(v) ? null : 'Enter a number',
    });
    if (!toStr) return;

    const dartCode = generateMigrationDart(
      this._diff, parseInt(fromStr), parseInt(toStr),
    );
    if (!dartCode) {
      vscode.window.showInformationMessage(
        'No migration actions — schema is up to date.',
      );
      return;
    }

    const doc = await vscode.workspace.openTextDocument({
      content: dartCode,
      language: 'dart',
    });
    await vscode.window.showTextDocument(
      doc, vscode.ViewColumn.Beside,
    );
  }

  private _dispose(): void {
    SchemaDiffPanel._currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
  }
}
