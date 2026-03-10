import * as vscode from 'vscode';
import type { ILineageResult } from './lineage-types';
import { LineageTracer, generateDeleteSql } from './lineage-tracer';
import { buildLineageHtml } from './lineage-html';

/** Singleton webview panel for data lineage visualization. */
export class LineagePanel {
  private static _currentPanel: LineagePanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];
  private readonly _tracer: LineageTracer;
  private _result: ILineageResult;

  static createOrShow(
    tracer: LineageTracer, result: ILineageResult,
  ): void {
    const column = vscode.ViewColumn.Beside;

    if (LineagePanel._currentPanel) {
      LineagePanel._currentPanel._update(result);
      LineagePanel._currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'driftLineage',
      'Data Lineage',
      column,
      { enableScripts: true },
    );
    LineagePanel._currentPanel = new LineagePanel(
      panel, tracer, result,
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    tracer: LineageTracer,
    result: ILineageResult,
  ) {
    this._panel = panel;
    this._tracer = tracer;
    this._result = result;

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

  private _update(result: ILineageResult): void {
    this._result = result;
    this._panel.title = `Lineage: ${result.root.table}.${result.root.pkColumn}=${result.root.pkValue}`;
    this._render();
  }

  private _render(): void {
    this._panel.webview.html = buildLineageHtml(this._result);
  }

  private async _handleMessage(
    msg: Record<string, unknown>,
  ): Promise<void> {
    switch (msg['command']) {
      case 'trace':
        await this._retrace(msg);
        break;
      case 'generateDelete': {
        const sql = generateDeleteSql(this._result);
        this._panel.webview.postMessage({ command: 'deleteSql', sql });
        break;
      }
      case 'exportJson':
        await vscode.env.clipboard.writeText(
          JSON.stringify(this._result, null, 2),
        );
        vscode.window.showInformationMessage('Lineage JSON copied.');
        break;
    }
  }

  private async _retrace(
    msg: Record<string, unknown>,
  ): Promise<void> {
    this._panel.webview.postMessage({ command: 'loading' });
    try {
      const result = await this._tracer.trace(
        String(msg['table']),
        String(msg['pkColumn']),
        msg['pkValue'],
        Number(msg['depth']) || 3,
        (msg['direction'] as 'both' | 'up' | 'down') || 'both',
      );
      this._update(result);
    } catch (err: unknown) {
      const text = err instanceof Error ? err.message : String(err);
      this._panel.webview.postMessage({
        command: 'error', message: text,
      });
    }
  }

  private _dispose(): void {
    LineagePanel._currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
  }
}
