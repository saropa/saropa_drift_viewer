/**
 * Singleton webview panel for Query Cost Analysis.
 * Runs EXPLAIN QUERY PLAN, parses results, suggests indexes,
 * and lets users create indexes directly.
 */

import * as vscode from 'vscode';
import type { DriftApiClient } from '../api-client';
import type { IParsedPlan, IIndexSuggestion } from './query-cost-types';
import { buildQueryCostHtml, buildPlanText } from './query-cost-html';
import { ExplainParser } from './explain-parser';
import { IndexSuggester } from './index-suggester';

export class QueryCostPanel {
  private static _currentPanel: QueryCostPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];
  private readonly _client: DriftApiClient;
  private _sql = '';
  private _plan: IParsedPlan = {
    nodes: [],
    warnings: [],
    summary: { scanCount: 0, indexCount: 0, tempBTreeCount: 0, totalNodes: 0 },
  };
  private _suggestions: IIndexSuggestion[] = [];
  private _busy = false;

  static async createOrShow(
    client: DriftApiClient,
    sql: string,
  ): Promise<void> {
    const column = vscode.ViewColumn.Beside;

    if (QueryCostPanel._currentPanel) {
      QueryCostPanel._currentPanel._panel.reveal(column);
      await QueryCostPanel._currentPanel._analyze(sql);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'driftQueryCost',
      'Query Cost Analysis',
      column,
      { enableScripts: true },
    );
    QueryCostPanel._currentPanel = new QueryCostPanel(panel, client);
    await QueryCostPanel._currentPanel._analyze(sql);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    client: DriftApiClient,
  ) {
    this._panel = panel;
    this._client = client;

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
  }

  private async _analyze(sql: string): Promise<void> {
    if (this._busy) return;
    this._busy = true;
    try {
      const parser = new ExplainParser();
      const suggester = new IndexSuggester(this._client);
      const plan = await parser.explain(this._client, sql);
      const suggestions = await suggester.suggest(sql, plan);
      this._sql = sql;
      this._plan = plan;
      this._suggestions = suggestions;
      this._render();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Query cost analysis failed: ${msg}`);
    } finally {
      this._busy = false;
    }
  }

  private _render(): void {
    this._panel.webview.html = buildQueryCostHtml(
      this._sql,
      this._plan,
      this._suggestions,
    );
  }

  private _handleMessage(
    msg: { command: string; index?: number },
  ): void {
    switch (msg.command) {
      case 'copySql':
        vscode.env.clipboard.writeText(this._sql);
        break;
      case 'copyPlan':
        vscode.env.clipboard.writeText(buildPlanText(this._plan.nodes));
        break;
      case 'copySuggestion':
        if (
          msg.index !== undefined
          && msg.index >= 0
          && msg.index < this._suggestions.length
        ) {
          vscode.env.clipboard.writeText(this._suggestions[msg.index].sql);
        }
        break;
      case 'runSuggestion':
        if (
          msg.index !== undefined
          && msg.index >= 0
          && msg.index < this._suggestions.length
        ) {
          this._runSuggestion(msg.index);
        }
        break;
      case 'reanalyze':
        this._analyze(this._sql);
        break;
    }
  }

  private async _runSuggestion(index: number): Promise<void> {
    if (this._busy) return;
    this._busy = true;
    const ddl = this._suggestions[index].sql;
    try {
      await this._client.sql(ddl);
      vscode.window.showInformationMessage('Index created successfully.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to create index: ${msg}`);
    } finally {
      this._busy = false;
    }
    // Re-analyze to reflect the new index
    await this._analyze(this._sql);
  }

  private _dispose(): void {
    QueryCostPanel._currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
  }
}
