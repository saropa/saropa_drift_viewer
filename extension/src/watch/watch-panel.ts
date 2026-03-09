import * as vscode from 'vscode';
import { getWatchHtml } from './watch-html';
import { WatchManager } from './watch-manager';

/**
 * Singleton webview panel that displays all active data watches
 * with live diff highlighting.
 */
export class WatchPanel {
  public static currentPanel: WatchPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _manager: WatchManager;
  private _disposed = false;
  private _disposables: vscode.Disposable[] = [];

  static createOrShow(
    context: vscode.ExtensionContext,
    manager: WatchManager,
  ): void {
    if (WatchPanel.currentPanel) {
      WatchPanel.currentPanel._panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'driftWatch',
      'Watch',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    WatchPanel.currentPanel = new WatchPanel(panel, manager);
    context.subscriptions.push(WatchPanel.currentPanel);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    manager: WatchManager,
  ) {
    this._panel = panel;
    this._manager = manager;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (msg) => this._handleMessage(msg),
      null,
      this._disposables,
    );

    const changeDisposable = this._manager.onDidChange(() => {
      if (!this._disposed) this._postUpdate();
    });
    this._disposables.push(changeDisposable);

    // Set initial HTML scaffold
    this._panel.webview.html = getWatchHtml();

    // Send current state immediately
    this._postUpdate();
  }

  private _handleMessage(msg: { command: string; id?: string }): void {
    switch (msg.command) {
      case 'removeWatch':
        if (msg.id) this._manager.remove(msg.id);
        break;
      case 'pauseWatch':
        if (msg.id) this._manager.setPaused(msg.id, true);
        break;
      case 'resumeWatch':
        if (msg.id) this._manager.setPaused(msg.id, false);
        break;
      case 'clearDiff':
        if (msg.id) this._manager.clearDiff(msg.id);
        break;
    }
  }

  private _postUpdate(): void {
    const entries = this._manager.entries.map((e) => ({
      id: e.id,
      label: e.label,
      pkIndex: e.pkIndex,
      paused: e.paused,
      error: e.error,
      lastChangedAt: e.lastChangedAt,
      currentResult: e.currentResult,
      diff: e.diff,
    }));

    this._panel.webview.postMessage({ command: 'update', entries });

    // Update tab title badge
    const unseen = this._manager.unseenChanges;
    this._panel.title = unseen > 0 ? `Watch (${unseen})` : 'Watch';
    this._manager.resetUnseen();
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    WatchPanel.currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables.length = 0;
  }
}
