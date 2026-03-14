/**
 * Webview panel for clipboard import: parse, map columns, validate, execute.
 * Coordinates ClipboardParser, ImportValidator, ImportExecutor, ImportHistory.
 */

import * as vscode from 'vscode';
import type { DriftApiClient } from '../api-client';
import type { ColumnMetadata } from '../api-types';
import { buildClipboardImportHtml } from './clipboard-import-html';
import {
  executeImportFlow,
  runValidation,
} from './clipboard-import-actions';
import { autoMapColumns, ClipboardParser } from './clipboard-parser';
import type { PanelMessage } from './clipboard-import-messages';
import type {
  IClipboardImportState,
  IColumnMapping,
  IImportOptions,
} from './clipboard-import-types';
import { ImportExecutor } from './import-executor';
import { ImportHistory } from './import-history';
import { ImportValidator } from './import-validator';
import { captureSchemaSnapshot } from './schema-freshness';

/** Singleton webview panel for clipboard import: parse → map → validate → import → history. */
export class ClipboardImportPanel {
  /** Singleton instance of the current panel */
  private static _currentPanel: ClipboardImportPanel | undefined;

  /** VS Code webview panel instance */
  private readonly _panel: vscode.WebviewPanel;
  /** Disposables to clean up on panel close */
  private readonly _disposables: vscode.Disposable[] = [];
  /** API client for database operations */
  private readonly _client: DriftApiClient;
  /** History tracker for undo support */
  private readonly _history: ImportHistory;
  /** Executor for database import operations */
  private readonly _executor: ImportExecutor;
  /** Validator for pre-import data checking */
  private readonly _validator: ImportValidator;

  /** Current state of the import panel */
  private _state: IClipboardImportState;

  /** Create or reveal panel; reads clipboard, parses, auto-maps columns. */
  static async createOrShow(
    client: DriftApiClient,
    storage: vscode.Memento,
    table: string,
    tableColumns: ColumnMetadata[],
  ): Promise<void> {
    const clipboardText = await vscode.env.clipboard.readText();

    if (!clipboardText.trim()) {
      vscode.window.showWarningMessage('Clipboard is empty');
      return;
    }

    const parser = new ClipboardParser();
    let parsed;
    try {
      parsed = parser.parse(clipboardText);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to parse clipboard: ${message}`);
      return;
    }

    if (parsed.rows.length === 0) {
      vscode.window.showWarningMessage('No data rows found in clipboard (only headers)');
      return;
    }

    const mapping = autoMapColumns(
      parsed.headers,
      tableColumns.map((c) => c.name),
    );

    const state: IClipboardImportState = {
      table,
      tableColumns,
      parsed,
      mapping,
      options: {
        strategy: 'insert',
        matchBy: 'pk',
        continueOnError: false,
      },
      schemaSnapshot: captureSchemaSnapshot(table, tableColumns),
    };

    const column = vscode.ViewColumn.Active;

    if (ClipboardImportPanel._currentPanel) {
      ClipboardImportPanel._currentPanel._state = state;
      ClipboardImportPanel._currentPanel._render();
      ClipboardImportPanel._currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'driftClipboardImport',
      `Import: ${table}`,
      column,
      { enableScripts: true },
    );

    ClipboardImportPanel._currentPanel = new ClipboardImportPanel(
      panel,
      client,
      storage,
      state,
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    client: DriftApiClient,
    storage: vscode.Memento,
    state: IClipboardImportState,
  ) {
    this._panel = panel;
    this._client = client;
    this._state = state;
    this._history = new ImportHistory(storage);
    this._executor = new ImportExecutor(client);
    this._validator = new ImportValidator(client);

    this._panel.onDidDispose(
      () => this._dispose(),
      null,
      this._disposables,
    );

    this._panel.webview.onDidReceiveMessage(
      (msg: PanelMessage) => this._handleMessage(msg),
      null,
      this._disposables,
    );

    this._render();
  }

  private _render(loading = false, error?: string, success?: { imported: number; skipped: number }): void {
    this._panel.webview.html = buildClipboardImportHtml(
      this._state,
      loading,
      error,
      success,
    );
  }

  private async _handleMessage(msg: PanelMessage): Promise<void> {
    switch (msg.command) {
      case 'cancel':
        this._panel.dispose();
        break;

      case 'updateMapping':
        this._updateMapping(msg.index, msg.tableColumn);
        break;

      case 'updateStrategy':
        this._state.options.strategy = msg.strategy;
        this._state.validationResults = undefined;
        this._state.dryRunResults = undefined;
        this._render();
        break;

      case 'updateMatchBy':
        this._state.options.matchBy = msg.matchBy === 'pk' ? 'pk' : [msg.matchBy];
        this._render();
        break;

      case 'updateContinueOnError':
        this._state.options.continueOnError = msg.continueOnError;
        this._render();
        break;

      case 'validate':
        await this._runValidation();
        break;

      case 'import':
        await this._runImport();
        break;
    }
  }

  private _updateMapping(index: number, tableColumn: string | null): void {
    if (index >= 0 && index < this._state.mapping.length) {
      this._state.mapping[index].tableColumn = tableColumn;
      this._state.validationResults = undefined;
      this._state.dryRunResults = undefined;
      this._render();
    }
  }

  private async _runValidation(): Promise<void> {
    this._render(true); // Loading state until results applied
    try {
      const results = await runValidation(
        this._client,
        this._validator,
        this._state.table,
        this._state.parsed,
        this._state.mapping,
        this._state.tableColumns,
        this._state.options,
      );
      this._state.validationResults = results;
      this._state.dryRunResults = undefined;
      this._render();

      const errorCount = ImportValidator.countErrors(results);
      const rowCount = results.length;
      if (errorCount === 0) {
        vscode.window.showInformationMessage(
          `Validation passed: ${rowCount} rows ready to import`,
        );
      } else {
        vscode.window.showWarningMessage(
          `Validation found ${errorCount} error(s) in ${results.filter((r) => r.errors.length > 0).length} rows`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._render(false, `Validation failed: ${message}`);
    }
  }

  /** Execute import: freshness check, then dry run or import; update state and show messages. */
  private async _runImport(): Promise<void> {
    this._render(true); // Loading state until outcome applied
    try {
      const confirmProceed = async (changes: string[]) =>
        (await vscode.window.showWarningMessage(
          `Schema has changed:\n${changes.join('\n')}\n\nContinue anyway?`,
          'Continue',
          'Cancel',
        )) === 'Continue';

      const outcome = await executeImportFlow(
        this._client,
        this._state,
        this._executor,
        this._history,
        confirmProceed,
      );

      if (outcome.action === 'cancelled') {
        this._render();
        return;
      }
      if (outcome.action === 'dryRun') {
        this._state.dryRunResults = outcome.dryRunResults;
        this._state.validationResults = outcome.dryRunResults.validationErrors;
        this._render();
        return;
      }
      if (outcome.action === 'success') {
        this._render(false, undefined, {
          imported: outcome.imported,
          skipped: outcome.skipped,
        });
        const msg = outcome.skipped > 0
          ? `Imported ${outcome.imported} rows, skipped ${outcome.skipped}`
          : `Imported ${outcome.imported} rows into ${this._state.table}`;
        vscode.window.showInformationMessage(msg);
      } else {
        this._render(false, outcome.message);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._render(false, message);
    }
  }

  private _dispose(): void {
    ClipboardImportPanel._currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
  }
}
