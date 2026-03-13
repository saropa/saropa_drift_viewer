/**
 * Runtime diagnostic provider.
 * Reports runtime issues: data breakpoints, row alerts, connection errors.
 * Event store, event→issue conversion, and connection check live in diagnostics/runtime/.
 */

import * as vscode from 'vscode';
import type { DriftApiClient } from '../../api-client';
import type {
  DiagnosticCategory,
  IDiagnosticContext,
  IDiagnosticIssue,
  IDiagnosticProvider,
} from '../diagnostic-types';
import { checkConnection } from '../runtime/connection-checker';
import { eventToIssue } from '../runtime/event-converter';
import type { IRuntimeEvent } from '../runtime/runtime-event-store';
import { RuntimeEventStore } from '../runtime/runtime-event-store';

export type { IRuntimeEvent } from '../runtime/runtime-event-store';

export class RuntimeProvider implements IDiagnosticProvider {
  readonly id = 'runtime';
  readonly category: DiagnosticCategory = 'runtime';

  private readonly _store = new RuntimeEventStore();
  private _workspaceUri: vscode.Uri | undefined;

  recordBreakpointHit(table: string, message: string): void {
    this._store.addEvent({
      type: 'breakpoint-hit',
      table,
      message,
      timestamp: Date.now(),
    });
  }

  recordRowsInserted(table: string, count: number): void {
    this._store.addEvent({
      type: 'row-inserted',
      table,
      message: `${count} row(s) inserted into "${table}"`,
      timestamp: Date.now(),
      count,
    });
  }

  recordRowsDeleted(table: string, count: number): void {
    this._store.addEvent({
      type: 'row-deleted',
      table,
      message: `${count} row(s) deleted from "${table}"`,
      timestamp: Date.now(),
      count,
    });
  }

  recordConnectionError(message: string): void {
    this._store.addEvent({
      type: 'connection-error',
      message,
      timestamp: Date.now(),
    });
  }

  clearEvents(): void {
    this._store.clearEvents();
  }

  get events(): readonly IRuntimeEvent[] {
    return this._store.events;
  }

  async collectDiagnostics(ctx: IDiagnosticContext): Promise<IDiagnosticIssue[]> {
    const issues: IDiagnosticIssue[] = [];

    this._store.pruneOldEvents();

    if (!this._workspaceUri) {
      const folders = vscode.workspace.workspaceFolders;
      if (folders && folders.length > 0) {
        this._workspaceUri = folders[0].uri;
      }
    }

    if (!this._workspaceUri) {
      return issues;
    }

    for (const event of this._store.events) {
      const issue = eventToIssue(event, this._workspaceUri);
      if (issue) {
        issues.push(issue);
      }
    }

    await checkConnection(
      ctx.client,
      issues,
      this._workspaceUri,
      this._store.hasRecentConnectionError(),
    );

    return issues;
  }

  provideCodeActions(
    diag: vscode.Diagnostic,
    _doc: vscode.TextDocument,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    const code = diag.code as string;

    const disableAction = new vscode.CodeAction(
      `Disable "${code}" rule`,
      vscode.CodeActionKind.QuickFix,
    );
    disableAction.command = {
      command: 'driftViewer.disableDiagnosticRule',
      title: 'Disable Rule',
      arguments: [code],
    };
    actions.push(disableAction);

    if (code === 'data-breakpoint-hit') {
      const addAction = new vscode.CodeAction(
        'Add Data Breakpoint',
        vscode.CodeActionKind.QuickFix,
      );
      addAction.command = {
        command: 'driftViewer.addDataBreakpoint',
        title: 'Add Breakpoint',
      };
      actions.push(addAction);
    }

    if (code === 'row-inserted-alert' || code === 'row-deleted-alert') {
      const data = (diag as vscode.Diagnostic & { data?: { table?: string } }).data;
      if (data?.table) {
        const viewAction = new vscode.CodeAction(
          `View "${data.table}" Table`,
          vscode.CodeActionKind.QuickFix,
        );
        viewAction.command = {
          command: 'driftViewer.viewTableInPanel',
          title: 'View Table',
          arguments: [data.table],
        };
        viewAction.isPreferred = true;
        actions.push(viewAction);
      }

      const clearAction = new vscode.CodeAction(
        'Clear Runtime Alerts',
        vscode.CodeActionKind.QuickFix,
      );
      clearAction.command = {
        command: 'driftViewer.clearRuntimeAlerts',
        title: 'Clear Alerts',
      };
      actions.push(clearAction);
    }

    if (code === 'connection-error') {
      const refreshAction = new vscode.CodeAction(
        'Refresh Connection',
        vscode.CodeActionKind.QuickFix,
      );
      refreshAction.command = {
        command: 'driftViewer.refreshTree',
        title: 'Refresh',
      };
      refreshAction.isPreferred = true;
      actions.push(refreshAction);

      const settingsAction = new vscode.CodeAction(
        'Open Extension Settings',
        vscode.CodeActionKind.QuickFix,
      );
      settingsAction.command = {
        command: 'workbench.action.openSettings',
        title: 'Settings',
        arguments: ['driftViewer'],
      };
      actions.push(settingsAction);
    }

    return actions;
  }

  dispose(): void {
    this._store.clearEvents();
  }
}
