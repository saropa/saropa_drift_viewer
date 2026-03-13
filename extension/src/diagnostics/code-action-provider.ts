/**
 * VS Code code action provider that delegates to the diagnostic manager.
 * Provides quick fixes for Drift Advisor diagnostics.
 */

import * as vscode from 'vscode';

/** Minimal interface for code action delegation (avoids circular dependency). */
export interface ICodeActionDelegate {
  provideCodeActions(
    diagnostic: vscode.Diagnostic,
    document: vscode.TextDocument,
  ): vscode.CodeAction[];
}

/**
 * Code action provider that delegates to registered diagnostic providers.
 */
export class DiagnosticCodeActionProvider implements vscode.CodeActionProvider {
  constructor(private readonly _manager: ICodeActionDelegate) {}

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diag of context.diagnostics) {
      if (diag.source !== 'Drift Advisor') {
        continue;
      }
      const providerActions = this._manager.provideCodeActions(diag, document);
      for (const action of providerActions) {
        action.diagnostics = [diag];
        actions.push(action);
      }
    }

    return actions;
  }
}
