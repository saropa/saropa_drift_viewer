/**
 * WebviewViewProvider for the schema search sidebar panel.
 * Renders a search input + filter buttons; results list with cross-references.
 */

import * as vscode from 'vscode';
import type { DriftApiClient } from '../api-client';
import { SchemaSearchEngine } from './schema-search-engine';
import { getSchemaSearchHtml } from './schema-search-html';
import type { SchemaSearchMessage } from './schema-search-types';

/** Callback to reveal a table in the Database Explorer tree view. */
export type RevealTableFn = (name: string) => Promise<void>;

export class SchemaSearchViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'driftViewer.schemaSearch';

  private readonly _engine: SchemaSearchEngine;
  private _view?: vscode.WebviewView;
  private _searchGen = 0;

  constructor(
    client: DriftApiClient,
    private readonly _revealTable: RevealTableFn,
  ) {
    this._engine = new SchemaSearchEngine(client);
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };

    const nonce = getNonce();
    webviewView.webview.html = getSchemaSearchHtml(nonce);

    webviewView.webview.onDidReceiveMessage(
      (msg: SchemaSearchMessage) => this._handleMessage(msg),
    );
  }

  private async _handleMessage(msg: SchemaSearchMessage): Promise<void> {
    switch (msg.command) {
      case 'search':
        await this._doSearch(msg.query, msg.scope, msg.typeFilter);
        break;
      case 'navigate':
        await this._revealTable(msg.table);
        break;
    }
  }

  private async _doSearch(
    query: string,
    scope: 'all' | 'tables' | 'columns',
    typeFilter?: string,
  ): Promise<void> {
    const gen = ++this._searchGen;
    this._view?.webview.postMessage({ command: 'loading' });
    try {
      const result = await this._engine.search(query, scope, typeFilter);
      if (gen !== this._searchGen) return; // Stale result; discard
      this._view?.webview.postMessage({
        command: 'results',
        result,
        crossRefs: result.crossReferences,
      });
    } catch {
      if (gen !== this._searchGen) return;
      this._view?.webview.postMessage({
        command: 'results',
        result: { query, matches: [], crossReferences: [] },
        crossRefs: [],
      });
    }
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
