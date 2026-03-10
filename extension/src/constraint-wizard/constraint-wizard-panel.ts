import * as vscode from 'vscode';
import type { DriftApiClient } from '../api-client';
import type { ColumnMetadata, ForeignKey, TableMetadata } from '../api-types';
import { ConstraintCodegen } from './constraint-codegen';
import { ConstraintValidator } from './constraint-validator';
import type {
  ConstraintWizardMessage,
  IConstraintDraft,
  IConstraintTestResult,
} from './constraint-types';
import { buildConstraintWizardHtml } from './constraint-wizard-html';

let _nextId = 1;

/** Singleton webview panel for the Constraint Wizard. */
export class ConstraintWizardPanel {
  private static _currentPanel: ConstraintWizardPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];
  private readonly _validator: ConstraintValidator;
  private readonly _codegen = new ConstraintCodegen();
  private readonly _table: string;
  private readonly _columns: ColumnMetadata[];
  private readonly _fks: ForeignKey[];
  private _drafts: IConstraintDraft[] = [];
  private _results = new Map<string, IConstraintTestResult>();
  private _busy = false;

  static createOrShow(
    client: DriftApiClient,
    tableMeta: TableMetadata,
    fks: ForeignKey[],
  ): void {
    const column = vscode.ViewColumn.Beside;

    if (ConstraintWizardPanel._currentPanel) {
      ConstraintWizardPanel._currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'driftConstraintWizard',
      `Constraint Wizard: ${tableMeta.name}`,
      column,
      { enableScripts: true },
    );
    ConstraintWizardPanel._currentPanel = new ConstraintWizardPanel(
      panel, client, tableMeta, fks,
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    client: DriftApiClient,
    tableMeta: TableMetadata,
    fks: ForeignKey[],
  ) {
    this._panel = panel;
    this._validator = new ConstraintValidator(client);
    this._table = tableMeta.name;
    this._columns = tableMeta.columns;
    this._fks = fks;

    this._panel.onDidDispose(
      () => this._dispose(), null, this._disposables,
    );
    this._panel.webview.onDidReceiveMessage(
      (msg: ConstraintWizardMessage) => this._handleMessage(msg),
      null,
      this._disposables,
    );
    this._render();
  }

  private _render(): void {
    this._panel.webview.html = buildConstraintWizardHtml(
      this._table, this._columns, this._fks,
      this._drafts, this._results,
    );
  }

  private async _handleMessage(
    msg: ConstraintWizardMessage,
  ): Promise<void> {
    if (this._busy) return;
    try {
      switch (msg.command) {
        case 'addConstraint':
          return this._addConstraint(msg.kind);
        case 'removeConstraint':
          return this._removeConstraint(msg.id);
        case 'updateConstraint':
          return this._updateConstraint(msg);
        case 'testConstraint':
          return await this._testConstraint(msg.id);
        case 'testAll':
          return await this._testAll();
        case 'generateDart':
          return await this._openCode('dart');
        case 'generateSql':
          return await this._openCode('sql');
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Constraint wizard: ${m}`);
    }
  }

  private _addConstraint(
    kind: IConstraintDraft['kind'],
  ): void {
    const draft: IConstraintDraft = {
      id: `cw_${_nextId++}`,
      kind,
      table: this._table,
    };
    if (kind === 'unique') draft.columns = [];
    if (kind === 'check') draft.expression = '';
    if (kind === 'not_null' && this._columns.length > 0) {
      draft.column = this._columns[0].name;
    }
    this._drafts.push(draft);
    this._render();
  }

  private _removeConstraint(id: string): void {
    this._drafts = this._drafts.filter((d) => d.id !== id);
    this._results.delete(id);
    this._render();
  }

  private _updateConstraint(
    msg: { index: number; columns?: string[];
      expression?: string; column?: string },
  ): void {
    const idx = msg.index;
    const draft = this._drafts[idx];
    if (!draft) return;
    if (msg.columns !== undefined) draft.columns = msg.columns;
    if (msg.expression !== undefined) draft.expression = msg.expression;
    if (msg.column !== undefined) draft.column = msg.column;
  }

  private async _testConstraint(id: string): Promise<void> {
    const draft = this._drafts.find((d) => d.id === id);
    if (!draft) return;
    this._busy = true;
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification,
          title: 'Testing constraint\u2026' },
        async () => {
          const result = await this._validator.test(draft);
          this._results.set(id, result);
        },
      );
      this._render();
    } finally {
      this._busy = false;
    }
  }

  private async _testAll(): Promise<void> {
    this._busy = true;
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification,
          title: 'Testing all constraints\u2026' },
        async (progress) => {
          for (let i = 0; i < this._drafts.length; i++) {
            progress.report({
              increment: 100 / this._drafts.length,
              message: `(${i + 1}/${this._drafts.length})`,
            });
            const draft = this._drafts[i];
            const result = await this._validator.test(draft);
            this._results.set(draft.id, result);
          }
        },
      );
      this._render();
    } finally {
      this._busy = false;
    }
  }

  private async _openCode(
    mode: 'dart' | 'sql',
  ): Promise<void> {
    if (this._drafts.length === 0) return;
    const content = mode === 'dart'
      ? this._codegen.generateDart(this._drafts)
      : this._codegen.generateSql(this._drafts);
    const language = mode === 'dart' ? 'dart' : 'sql';
    const doc = await vscode.workspace.openTextDocument({
      content, language,
    });
    await vscode.window.showTextDocument(
      doc, vscode.ViewColumn.Beside,
    );
  }

  private _dispose(): void {
    ConstraintWizardPanel._currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
  }
}
