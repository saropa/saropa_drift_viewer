/**
 * Singleton webview panel for the Isar-to-Drift Schema Generator.
 * Shows mapping preview and configuration options; generates Drift code.
 */

import * as vscode from 'vscode';
import type {
  IIsarCollection,
  IIsarEmbedded,
  IIsarGenConfig,
  IsarGenWebviewMessage,
} from './isar-gen-types';
import { defaultIsarGenConfig } from './isar-gen-types';
import { mapIsarToDrift } from './isar-type-mapper';
import { generateDriftSource } from './isar-drift-codegen';
import { buildIsarGenHtml } from './isar-gen-html';

/** Singleton webview panel for Isar-to-Drift generation. */
export class IsarGenPanel {
  private static _currentPanel: IsarGenPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];
  private readonly _collections: IIsarCollection[];
  private readonly _embeddeds: IIsarEmbedded[];
  private _config: IIsarGenConfig;

  static createOrShow(
    collections: IIsarCollection[],
    embeddeds: IIsarEmbedded[],
  ): void {
    const column = vscode.ViewColumn.Beside;

    if (IsarGenPanel._currentPanel) {
      IsarGenPanel._currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'driftIsarGen',
      'Isar to Drift',
      column,
      { enableScripts: true },
    );
    IsarGenPanel._currentPanel = new IsarGenPanel(
      panel, collections, embeddeds,
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    collections: IIsarCollection[],
    embeddeds: IIsarEmbedded[],
  ) {
    this._panel = panel;
    this._collections = collections;
    this._embeddeds = embeddeds;
    this._config = defaultIsarGenConfig();

    this._panel.onDidDispose(
      () => this._dispose(), null, this._disposables,
    );
    this._panel.webview.onDidReceiveMessage(
      (msg: IsarGenWebviewMessage) => this._handleMessage(msg),
      null,
      this._disposables,
    );
    this._render();
  }

  private _getMappingResult() {
    return mapIsarToDrift(
      this._collections, this._embeddeds, this._config,
    );
  }

  private _render(): void {
    this._panel.webview.html = buildIsarGenHtml(
      this._collections,
      this._embeddeds,
      this._config,
      this._getMappingResult(),
    );
  }

  private async _handleMessage(
    msg: IsarGenWebviewMessage,
  ): Promise<void> {
    try {
      switch (msg.command) {
        case 'updateConfig':
          this._config = { ...this._config, ...msg.config };
          this._render();
          return;
        case 'generate':
          return await this._openGenerated();
        case 'copy':
          return await this._copyToClipboard();
        case 'save':
          return await this._saveToFile();
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Isar-to-Drift: ${m}`);
    }
  }

  private _generateSource(): string {
    return generateDriftSource(this._getMappingResult(), this._config);
  }

  private async _openGenerated(): Promise<void> {
    const content = this._generateSource();
    const doc = await vscode.workspace.openTextDocument({
      content,
      language: 'dart',
    });
    await vscode.window.showTextDocument(
      doc, vscode.ViewColumn.Beside,
    );
  }

  private async _copyToClipboard(): Promise<void> {
    await vscode.env.clipboard.writeText(this._generateSource());
    vscode.window.showInformationMessage(
      'Drift table code copied to clipboard.',
    );
  }

  private async _saveToFile(): Promise<void> {
    const uri = await vscode.window.showSaveDialog({
      filters: { 'Dart': ['dart'] },
      defaultUri: vscode.Uri.file('drift_tables.dart'),
    });
    if (!uri) return;
    const content = this._generateSource();
    await vscode.workspace.fs.writeFile(
      uri,
      Buffer.from(content, 'utf-8'),
    );
    vscode.window.showInformationMessage(
      `Drift tables saved to ${uri.fsPath}`,
    );
  }

  private _dispose(): void {
    IsarGenPanel._currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
  }
}
