/**
 * Webview panel for managing data invariants.
 * Follows the singleton pattern used by HealthPanel.
 */

import * as vscode from 'vscode';
import type { DriftApiClient } from '../api-client';
import type { InvariantManager } from './invariant-manager';
import type { IInvariantWebviewMessage } from './invariant-types';
import { buildInvariantHtml } from './invariant-html';
import {
  InvariantTemplates,
  templateToQuickPickItem,
} from './invariant-templates';

/** Singleton webview panel for managing data invariants. */
export class InvariantPanel {
  private static _currentPanel: InvariantPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];

  static createOrShow(
    extensionUri: vscode.Uri,
    manager: InvariantManager,
    client: DriftApiClient,
  ): void {
    const column = vscode.ViewColumn.Beside;

    if (InvariantPanel._currentPanel) {
      InvariantPanel._currentPanel._render();
      InvariantPanel._currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'driftInvariants',
      'Data Invariants',
      column,
      { enableScripts: true },
    );

    InvariantPanel._currentPanel = new InvariantPanel(
      panel,
      manager,
      client,
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly _manager: InvariantManager,
    private readonly _client: DriftApiClient,
  ) {
    this._panel = panel;

    this._panel.onDidDispose(
      () => this._dispose(),
      null,
      this._disposables,
    );

    this._panel.webview.onDidReceiveMessage(
      (msg) => this._handleMessage(msg),
      null,
      this._disposables,
    );

    this._disposables.push(
      this._manager.onDidChange(() => this._render()),
    );

    this._render();
  }

  private _render(): void {
    const summary = this._manager.getSummary();
    this._panel.webview.html = buildInvariantHtml(
      this._manager.invariants,
      summary,
    );
  }

  private async _handleMessage(msg: IInvariantWebviewMessage): Promise<void> {
    switch (msg.command) {
      case 'refresh':
        this._render();
        break;

      case 'runAll':
        await this._runAll();
        break;

      case 'runOne':
        if (msg.id) {
          await this._manager.evaluateOne(msg.id);
        }
        break;

      case 'addRule':
        await this._promptAddRule();
        break;

      case 'edit':
        if (msg.id) {
          await this._promptEditRule(msg.id);
        }
        break;

      case 'remove':
        if (msg.id) {
          await this._promptRemoveRule(msg.id);
        }
        break;

      case 'toggle':
        if (msg.id) {
          this._manager.toggle(msg.id);
        }
        break;

      case 'viewViolations':
        if (msg.id) {
          await this._showViolations(msg.id);
        }
        break;
    }
  }

  private async _runAll(): Promise<void> {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Running invariant checks...',
        cancellable: false,
      },
      async () => {
        await this._manager.evaluateAll();
      },
    );
  }

  private async _promptAddRule(): Promise<void> {
    const tables = await this._getTableList();
    if (tables.length === 0) {
      vscode.window.showWarningMessage('No tables found in database.');
      return;
    }

    const tablePick = await vscode.window.showQuickPick(
      tables.map((t) => ({ label: t, table: t })),
      { placeHolder: 'Select a table for the invariant' },
    );
    if (!tablePick) return;

    const table = tablePick.table;

    // Fetch templates with progress indicator (can be slow for tables with many FKs)
    const allTemplates = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Loading invariant templates...',
        cancellable: false,
      },
      async () => {
        const templates = new InvariantTemplates(this._client);
        const available = await templates.getTemplatesForTable(table);
        const common = templates.getCommonTemplates(table);
        return [...available, ...common];
      },
    );

    const items = [
      ...allTemplates.map((t) => templateToQuickPickItem(t)),
      {
        label: '$(code) Custom SQL',
        description: 'custom',
        detail: 'Write your own invariant query',
        template: null,
      },
    ];

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select an invariant template',
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!pick) return;

    if (pick.template) {
      this._manager.add({
        name: pick.template.name,
        table,
        sql: pick.template.sql,
        expectation: pick.template.expectation,
        severity: pick.template.severity,
        enabled: true,
      });
      vscode.window.showInformationMessage(`Added invariant: ${pick.template.name}`);
    } else {
      await this._promptCustomRule(table);
    }
  }

  private async _promptCustomRule(table: string): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: 'Invariant name',
      placeHolder: 'e.g., "Users must have email"',
    });
    if (!name) return;

    const sql = await vscode.window.showInputBox({
      prompt: 'SQL query (should return violating rows)',
      placeHolder: `SELECT * FROM "${table}" WHERE ...`,
      value: `SELECT * FROM "${table}" WHERE `,
    });
    if (!sql) return;

    const expectation = await vscode.window.showQuickPick(
      [
        { label: 'Zero rows (violations are errors)', value: 'zero_rows' as const },
        { label: 'At least one row (empty is error)', value: 'non_zero' as const },
      ],
      { placeHolder: 'What should the query return to pass?' },
    );
    if (!expectation) return;

    const severity = await vscode.window.showQuickPick(
      [
        { label: '$(error) Error', value: 'error' as const },
        { label: '$(warning) Warning', value: 'warning' as const },
        { label: '$(info) Info', value: 'info' as const },
      ],
      { placeHolder: 'Severity level for violations' },
    );
    if (!severity) return;

    this._manager.add({
      name,
      table,
      sql,
      expectation: expectation.value,
      severity: severity.value,
      enabled: true,
    });
    vscode.window.showInformationMessage(`Added invariant: ${name}`);
  }

  private async _promptEditRule(id: string): Promise<void> {
    const inv = this._manager.get(id);
    if (!inv) return;

    const name = await vscode.window.showInputBox({
      prompt: 'Invariant name',
      value: inv.name,
    });
    if (name === undefined) return;

    const sql = await vscode.window.showInputBox({
      prompt: 'SQL query',
      value: inv.sql,
    });
    if (sql === undefined) return;

    const expectation = await vscode.window.showQuickPick(
      [
        { label: 'Zero rows (violations are errors)', value: 'zero_rows' as const, picked: inv.expectation === 'zero_rows' },
        { label: 'At least one row (empty is error)', value: 'non_zero' as const, picked: inv.expectation === 'non_zero' },
      ],
      { placeHolder: 'What should the query return to pass?' },
    );
    if (!expectation) return;

    const severity = await vscode.window.showQuickPick(
      [
        { label: '$(error) Error', value: 'error' as const, picked: inv.severity === 'error' },
        { label: '$(warning) Warning', value: 'warning' as const, picked: inv.severity === 'warning' },
        { label: '$(info) Info', value: 'info' as const, picked: inv.severity === 'info' },
      ],
      { placeHolder: 'Severity level for violations' },
    );
    if (!severity) return;

    this._manager.update(id, {
      name: name || inv.name,
      sql: sql || inv.sql,
      expectation: expectation.value,
      severity: severity.value,
    });
    vscode.window.showInformationMessage(`Updated invariant: ${name || inv.name}`);
  }

  private async _promptRemoveRule(id: string): Promise<void> {
    const inv = this._manager.get(id);
    if (!inv) return;

    const confirm = await vscode.window.showWarningMessage(
      `Remove invariant "${inv.name}"?`,
      { modal: true },
      'Remove',
    );
    if (confirm !== 'Remove') return;

    this._manager.remove(id);
    vscode.window.showInformationMessage(`Removed invariant: ${inv.name}`);
  }

  private async _showViolations(id: string): Promise<void> {
    const inv = this._manager.get(id);
    if (!inv?.lastResult?.violatingRows.length) {
      vscode.window.showInformationMessage('No violations to display.');
      return;
    }

    const violations = inv.lastResult.violatingRows;
    const content = JSON.stringify(violations, null, 2);

    const doc = await vscode.workspace.openTextDocument({
      content,
      language: 'json',
    });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
  }

  private async _getTableList(): Promise<string[]> {
    try {
      const meta = await this._client.schemaMetadata();
      return meta.map((t) => t.name);
    } catch {
      return [];
    }
  }

  private _dispose(): void {
    InvariantPanel._currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
  }
}
