import * as vscode from 'vscode';
import type { IRowDiff } from './row-differ';
import { RowDiffer } from './row-differ';
import { buildComparatorHtml } from './comparator-html';

/** Singleton webview panel for row-vs-row comparison. */
export class ComparatorPanel {
  private static _currentPanel: ComparatorPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];
  private _diff: IRowDiff;

  static createOrShow(diff: IRowDiff): void {
    const column = vscode.ViewColumn.Beside;

    if (ComparatorPanel._currentPanel) {
      ComparatorPanel._currentPanel._update(diff);
      ComparatorPanel._currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'driftRowComparator',
      'Row Comparator',
      column,
      { enableScripts: true },
    );
    ComparatorPanel._currentPanel = new ComparatorPanel(panel, diff);
  }

  private constructor(panel: vscode.WebviewPanel, diff: IRowDiff) {
    this._panel = panel;
    this._diff = diff;

    this._panel.onDidDispose(
      () => this._dispose(), null, this._disposables,
    );
    this._panel.webview.onDidReceiveMessage(
      (msg) => this._handleMessage(msg),
      null,
      this._disposables,
    );
    this._render();
  }

  private _update(diff: IRowDiff): void {
    this._diff = diff;
    this._panel.title = 'Row Comparator';
    this._render();
  }

  private _render(): void {
    this._panel.webview.html = buildComparatorHtml(this._diff);
  }

  private _handleMessage(msg: { command: string }): void {
    switch (msg.command) {
      case 'copyJson': {
        const data = {
          labelA: this._diff.labelA,
          labelB: this._diff.labelB,
          columns: this._diff.columns,
        };
        vscode.env.clipboard.writeText(JSON.stringify(data, null, 2));
        break;
      }
      case 'swapRows': {
        const swapped = new RowDiffer().diff(
          this._rowFromDiff('B'),
          this._rowFromDiff('A'),
          this._diff.labelB,
          this._diff.labelA,
        );
        this._update(swapped);
        break;
      }
    }
  }

  /** Reconstruct a row object from the current diff columns. */
  private _rowFromDiff(side: 'A' | 'B'): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    for (const c of this._diff.columns) {
      const isOnlyOther = side === 'A' ? c.match === 'only_b' : c.match === 'only_a';
      if (!isOnlyOther) {
        row[c.column] = side === 'A' ? c.valueA : c.valueB;
      }
    }
    return row;
  }

  private _dispose(): void {
    ComparatorPanel._currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
  }
}
