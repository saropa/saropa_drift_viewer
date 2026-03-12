/**
 * Maps invariant violations to VS Code diagnostics on Dart source files.
 */

import * as vscode from 'vscode';
import type { InvariantManager } from './invariant-manager';
import type { IInvariant } from './invariant-types';

/** Cached file info for diagnostic mapping. */
interface DartFileCache {
  uri: vscode.Uri;
  text: string;
  tableLines: Map<string, number>;
}

/**
 * Creates VS Code diagnostics for invariant violations.
 * Maps violations to the Dart table definition files.
 */
export class InvariantDiagnostics implements vscode.Disposable {
  private readonly _collection: vscode.DiagnosticCollection;
  private readonly _disposables: vscode.Disposable[] = [];
  private _fileCache: DartFileCache[] = [];
  private _cacheValid = false;

  constructor(private readonly _manager: InvariantManager) {
    this._collection = vscode.languages.createDiagnosticCollection(
      'driftInvariants',
    );

    this._disposables.push(
      this._collection,
      _manager.onDidChange(() => this._updateDiagnostics()),
      vscode.workspace.onDidChangeTextDocument(() => {
        this._cacheValid = false;
      }),
      vscode.workspace.onDidCreateFiles(() => {
        this._cacheValid = false;
      }),
      vscode.workspace.onDidDeleteFiles(() => {
        this._cacheValid = false;
      }),
    );
  }

  /** Force a refresh of diagnostics. */
  async refresh(): Promise<void> {
    this._cacheValid = false;
    await this._updateDiagnostics();
  }

  private async _updateDiagnostics(): Promise<void> {
    this._collection.clear();

    const failedInvariants = this._manager.invariants.filter(
      (inv) => inv.enabled && inv.lastResult && !inv.lastResult.passed,
    );

    if (failedInvariants.length === 0) return;

    await this._ensureCache();

    const diagnosticsByFile = new Map<string, vscode.Diagnostic[]>();

    for (const inv of failedInvariants) {
      const location = this._findTableLocation(inv.table);
      if (!location) continue;

      const diag = this._createDiagnostic(inv, location.range);
      const key = location.uri.toString();
      const existing = diagnosticsByFile.get(key) ?? [];
      existing.push(diag);
      diagnosticsByFile.set(key, existing);
    }

    for (const [uriStr, diags] of diagnosticsByFile) {
      this._collection.set(vscode.Uri.parse(uriStr), diags);
    }
  }

  private _createDiagnostic(
    inv: IInvariant,
    range: vscode.Range,
  ): vscode.Diagnostic {
    const result = inv.lastResult!;
    let message: string;

    if (result.error) {
      message = `Invariant query failed: ${inv.name} — ${result.error}`;
    } else if (result.violationCount === 1) {
      message = `Data invariant failed: ${inv.name} (1 violation)`;
    } else {
      message = `Data invariant failed: ${inv.name} (${result.violationCount} violations)`;
    }

    const severity = this._mapSeverity(inv.severity);
    const diag = new vscode.Diagnostic(range, message, severity);

    diag.source = 'Saropa Drift Advisor';
    diag.code = {
      value: 'invariant-violation',
      target: vscode.Uri.parse(
        `command:driftViewer.viewInvariantViolations?${encodeURIComponent(JSON.stringify(inv.id))}`,
      ),
    };

    if (result.violatingRows.length > 0) {
      const preview = result.violatingRows
        .slice(0, 3)
        .map((row) => JSON.stringify(row))
        .join(', ');
      const more = result.violationCount > 3 ? '...' : '';
      diag.relatedInformation = [
        new vscode.DiagnosticRelatedInformation(
          new vscode.Location(vscode.Uri.parse(''), range),
          `Violations: [${preview}${more}]`,
        ),
      ];
    }

    return diag;
  }

  private _mapSeverity(
    severity: 'error' | 'warning' | 'info',
  ): vscode.DiagnosticSeverity {
    switch (severity) {
      case 'error':
        return vscode.DiagnosticSeverity.Error;
      case 'warning':
        return vscode.DiagnosticSeverity.Warning;
      case 'info':
        return vscode.DiagnosticSeverity.Information;
    }
  }

  private _findTableLocation(
    tableName: string,
  ): { uri: vscode.Uri; range: vscode.Range } | null {
    for (const file of this._fileCache) {
      const line = file.tableLines.get(tableName);
      if (line !== undefined) {
        return {
          uri: file.uri,
          range: new vscode.Range(line, 0, line, 999),
        };
      }
    }
    return null;
  }

  private async _ensureCache(): Promise<void> {
    if (this._cacheValid) return;

    this._fileCache = [];
    const dartUris = await vscode.workspace.findFiles(
      '**/*.dart',
      '**/build/**',
    );

    for (const uri of dartUris) {
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        const text = doc.getText();
        const tableLines = this._findTableLines(text);

        if (tableLines.size > 0) {
          this._fileCache.push({ uri, text, tableLines });
        }
      } catch {
        // Skip files that can't be read
      }
    }

    this._cacheValid = true;
  }

  private _findTableLines(text: string): Map<string, number> {
    const tableLines = new Map<string, number>();
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = /class\s+(\w+)\s+extends\s+\w*Table\b/.exec(line);
      if (match) {
        const className = match[1];
        const snakeName = this._pascalToSnake(className);
        tableLines.set(snakeName, i);
      }
    }

    return tableLines;
  }

  private _pascalToSnake(name: string): string {
    return name
      .replace(/([a-z\d])([A-Z])/g, '$1_$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .toLowerCase();
  }

  /** Clear all invariant diagnostics. */
  clear(): void {
    this._collection.clear();
  }

  dispose(): void {
    for (const d of this._disposables) {
      d.dispose();
    }
  }
}

/**
 * Code action provider for invariant violation diagnostics.
 */
export class InvariantCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  constructor(private readonly _manager: InvariantManager) {}

  provideCodeActions(
    _document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diag of context.diagnostics) {
      if (diag.source !== 'Saropa Drift Advisor') continue;
      if (
        typeof diag.code === 'object' &&
        'value' in diag.code &&
        diag.code.value === 'invariant-violation'
      ) {
        const viewAction = new vscode.CodeAction(
          'View Violating Rows',
          vscode.CodeActionKind.QuickFix,
        );
        viewAction.command = {
          command: 'driftViewer.manageInvariants',
          title: 'View Violations',
        };
        viewAction.diagnostics = [diag];
        actions.push(viewAction);

        const runAction = new vscode.CodeAction(
          'Re-check Invariant',
          vscode.CodeActionKind.QuickFix,
        );
        runAction.command = {
          command: 'driftViewer.runAllInvariants',
          title: 'Run Check',
        };
        runAction.diagnostics = [diag];
        actions.push(runAction);

        const disableAction = new vscode.CodeAction(
          'Disable This Invariant',
          vscode.CodeActionKind.QuickFix,
        );
        disableAction.command = {
          command: 'driftViewer.toggleInvariant',
          title: 'Toggle Invariant',
          arguments: [this._extractInvariantId(diag)],
        };
        disableAction.diagnostics = [diag];
        actions.push(disableAction);
      }
    }

    return actions;
  }

  private _extractInvariantId(diag: vscode.Diagnostic): string | undefined {
    if (typeof diag.code === 'object' && 'target' in diag.code) {
      const target = diag.code.target;
      if (target) {
        const match = /viewInvariantViolations\?(.+)$/.exec(target.toString());
        if (match) {
          try {
            return JSON.parse(decodeURIComponent(match[1]));
          } catch {
            return undefined;
          }
        }
      }
    }
    return undefined;
  }
}
