/**
 * Status bar indicator for invariant status.
 */

import * as vscode from 'vscode';
import type { InvariantManager } from './invariant-manager';

/**
 * Manages the status bar item that shows invariant pass/fail summary.
 */
export class InvariantStatusBar implements vscode.Disposable {
  private readonly _statusItem: vscode.StatusBarItem;
  private readonly _disposables: vscode.Disposable[] = [];

  constructor(private readonly _manager: InvariantManager) {
    this._statusItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      40,
    );
    this._statusItem.command = 'driftViewer.manageInvariants';
    this._statusItem.tooltip = 'Click to manage data invariants';

    this._disposables.push(
      this._statusItem,
      _manager.onDidChange(() => this._update()),
    );

    this._update();
  }

  private _update(): void {
    const summary = this._manager.getSummary();

    if (summary.totalEnabled === 0) {
      this._statusItem.backgroundColor = undefined;
      this._statusItem.color = undefined;
      this._statusItem.hide();
      return;
    }

    const passing = summary.passingCount;
    const total = summary.totalEnabled;

    if (passing === total) {
      this._statusItem.text = `$(check) Invariants: ${passing}/${total}`;
      this._statusItem.backgroundColor = undefined;
      this._statusItem.color = undefined;
    } else if (summary.failingCount > 0) {
      this._statusItem.text = `$(warning) Invariants: ${passing}/${total}`;
      this._statusItem.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground',
      );
      this._statusItem.color = new vscode.ThemeColor(
        'statusBarItem.warningForeground',
      );
    } else {
      this._statusItem.text = `$(question) Invariants: ${passing}/${total}`;
      this._statusItem.backgroundColor = undefined;
      this._statusItem.color = undefined;
    }

    this._statusItem.show();
  }

  /** Force a refresh of the status bar. */
  refresh(): void {
    this._update();
  }

  /** Show the status bar item (even if no invariants). */
  show(): void {
    this._statusItem.show();
  }

  /** Hide the status bar item. */
  hide(): void {
    this._statusItem.hide();
  }

  dispose(): void {
    for (const d of this._disposables) {
      d.dispose();
    }
  }
}
