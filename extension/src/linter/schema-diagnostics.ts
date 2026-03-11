import * as vscode from 'vscode';
import type { DriftApiClient } from '../api-client';
import {
  type DartFileInfo,
  mapIssuesToDiagnostics,
  mergeServerIssues,
} from './issue-mapper';

/** Minimum interval between refreshes (ms). */
const DEBOUNCE_MS = 5_000;

/**
 * Fetches schema issues from the debug server and maps them to
 * VS Code diagnostics on Dart table/column definitions.
 */
export class SchemaDiagnostics {
  private _lastRefresh = 0;
  private _pending = false;

  constructor(
    private readonly _client: DriftApiClient,
    private readonly _diagnostics: vscode.DiagnosticCollection,
  ) {}

  /** Trigger a debounced refresh of diagnostics. */
  async refresh(): Promise<void> {
    const now = Date.now();
    if (now - this._lastRefresh < DEBOUNCE_MS) {
      if (!this._pending) {
        this._pending = true;
        const delay = DEBOUNCE_MS - (now - this._lastRefresh);
        setTimeout(() => {
          this._pending = false;
          this.refresh();
        }, delay);
      }
      return;
    }
    this._lastRefresh = now;

    const cfg = vscode.workspace.getConfiguration('driftViewer');
    if (!cfg.get<boolean>('linter.enabled', true)) {
      this._diagnostics.clear();
      return;
    }

    try {
      const [suggestions, anomalies] = await Promise.all([
        this._client.indexSuggestions(),
        this._client.anomalies(),
      ]);

      const issues = mergeServerIssues(suggestions, anomalies);
      if (issues.length === 0) {
        this._diagnostics.clear();
        return;
      }

      const dartUris = await vscode.workspace.findFiles(
        '**/*.dart',
        '**/build/**',
      );
      const dartFiles: DartFileInfo[] = [];
      for (const uri of dartUris) {
        const doc = await vscode.workspace.openTextDocument(uri);
        dartFiles.push({ uri, text: doc.getText() });
      }

      const anomalySeverity = cfg.get<string>(
        'linter.anomalySeverity',
        'warning',
      );
      const mapped = mapIssuesToDiagnostics(
        issues,
        dartFiles,
        anomalySeverity,
      );

      this._diagnostics.clear();
      for (const [uriStr, diags] of mapped) {
        this._diagnostics.set(vscode.Uri.parse(uriStr), diags);
      }
    } catch {
      // Server unreachable — clear stale diagnostics
      this._diagnostics.clear();
    }
  }

  /** Clear all diagnostics (e.g. on server disconnect). */
  clear(): void {
    this._diagnostics.clear();
  }
}

/**
 * Provides "Copy CREATE INDEX SQL" quick-fix code actions
 * for index-suggestion diagnostics.
 */
export class DriftCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    _document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const diag of context.diagnostics) {
      if (diag.source !== 'Saropa Drift Advisor') continue;
      if (diag.code !== 'index-suggestion') continue;
      if (!diag.relatedInformation?.[0]) continue;

      const sql = diag.relatedInformation[0].message.replace(
        /^Suggested fix: /,
        '',
      );
      const action = new vscode.CodeAction(
        'Copy CREATE INDEX SQL',
        vscode.CodeActionKind.QuickFix,
      );
      action.command = {
        command: 'driftViewer.copySuggestedSql',
        title: 'Copy SQL',
        arguments: [sql],
      };
      action.diagnostics = [diag];
      actions.push(action);
    }
    return actions;
  }
}
