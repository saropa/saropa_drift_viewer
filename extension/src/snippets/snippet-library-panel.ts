import * as vscode from 'vscode';

import type { DriftApiClient } from '../api-client';
import { buildSnippetLibraryHtml } from './snippet-library-html';
import { SnippetRunner, snippetUuid } from './snippet-runner';
import type { SnippetStore } from './snippet-store';

interface IRunMessage {
  command: 'runSnippet';
  id: string;
  values: Record<string, string>;
}

interface ISaveMessage {
  command: 'saveSnippet';
  snippet: {
    id: string;
    name: string;
    description?: string;
    sql: string;
    category: string;
  };
}

interface IDeleteMessage { command: 'deleteSnippet'; id: string }
interface ISearchMessage { command: 'search'; query: string }
interface IGetMessage { command: 'getSnippet'; id: string }
interface ISimpleMessage { command: 'exportAll' | 'importFile' }

type WebviewMessage =
  | IRunMessage | ISaveMessage | IDeleteMessage
  | ISearchMessage | IGetMessage | ISimpleMessage;

/** Singleton webview panel for the SQL snippet library. */
export class SnippetLibraryPanel {
  private static _currentPanel: SnippetLibraryPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];
  private readonly _runner: SnippetRunner;
  private _cachedTables: string[] = [];

  static createOrShow(
    client: DriftApiClient,
    store: SnippetStore,
  ): void {
    const column = vscode.ViewColumn.Beside;

    if (SnippetLibraryPanel._currentPanel) {
      SnippetLibraryPanel._currentPanel._refresh();
      SnippetLibraryPanel._currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'driftSnippetLibrary',
      'SQL Snippet Library',
      column,
      { enableScripts: true },
    );

    SnippetLibraryPanel._currentPanel =
      new SnippetLibraryPanel(panel, client, store);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly _client: DriftApiClient,
    private readonly _store: SnippetStore,
  ) {
    this._panel = panel;
    this._runner = new SnippetRunner(_client);

    this._panel.onDidDispose(
      () => this._dispose(), null, this._disposables,
    );
    this._panel.webview.onDidReceiveMessage(
      (msg) => { void this._handleMessage(msg as WebviewMessage); },
      null,
      this._disposables,
    );
    this._refresh();
  }

  private async _fetchTables(): Promise<void> {
    try {
      const meta = await this._client.schemaMetadata();
      this._cachedTables = meta.map((t) => t.name);
    } catch {
      // Server may not be running — tables will be empty
    }
  }

  private async _refresh(filter?: string): Promise<void> {
    if (this._cachedTables.length === 0) {
      await this._fetchTables();
    }

    const snippets = filter
      ? this._store.search(filter)
      : this._store.getAll();

    this._panel.webview.html = buildSnippetLibraryHtml({
      snippets,
      categories: this._store.getCategories(),
      tables: this._cachedTables,
    });
  }

  private async _handleMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.command) {
      case 'runSnippet':
        await this._runSnippet(msg);
        break;
      case 'saveSnippet':
        this._saveSnippet(msg);
        break;
      case 'deleteSnippet':
        this._store.delete(msg.id);
        void this._refresh();
        break;
      case 'search':
        void this._refresh(msg.query || undefined);
        break;
      case 'getSnippet':
        this._sendEditForm(msg.id);
        break;
      case 'exportAll':
        await this._exportAll();
        break;
      case 'importFile':
        await this._importFile();
        break;
    }
  }

  private async _runSnippet(msg: IRunMessage): Promise<void> {
    const snippet = this._store.getAll().find((s) => s.id === msg.id);
    if (!snippet) {
      return;
    }

    try {
      const result = await this._runner.run(snippet, msg.values);
      snippet.useCount++;
      snippet.lastUsedAt = new Date().toISOString();
      this._store.save(snippet);

      void this._panel.webview.postMessage({
        command: 'queryResult',
        snippetId: msg.id,
        columns: result.columns,
        rows: result.rows,
      });
    } catch (err) {
      void this._panel.webview.postMessage({
        command: 'error',
        snippetId: msg.id,
        message: String(err),
      });
    }
  }

  private _saveSnippet(msg: ISaveMessage): void {
    const existing = msg.snippet.id
      ? this._store.getAll().find((s) => s.id === msg.snippet.id)
      : undefined;

    const varNames = this._runner.extractVariables(msg.snippet.sql);
    const variables = this._runner.inferVariableTypes(varNames);

    this._store.save({
      id: existing?.id || snippetUuid(),
      name: msg.snippet.name,
      description: msg.snippet.description,
      sql: msg.snippet.sql,
      category: msg.snippet.category,
      variables,
      createdAt: existing?.createdAt || new Date().toISOString(),
      lastUsedAt: existing?.lastUsedAt,
      useCount: existing?.useCount ?? 0,
    });

    void this._refresh();
  }

  private _sendEditForm(id: string): void {
    const snippet = this._store.getAll().find((s) => s.id === id);
    if (snippet) {
      void this._panel.webview.postMessage({
        command: 'editForm',
        snippet,
      });
    }
  }

  private async _exportAll(): Promise<void> {
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file('drift-snippets.json'),
      filters: { 'JSON Files': ['json'] },
    });
    if (!uri) {
      return;
    }
    const content = this._store.exportAll();
    await vscode.workspace.fs.writeFile(
      uri,
      Buffer.from(content, 'utf-8'),
    );
    vscode.window.showInformationMessage(
      `Exported ${this._store.getAll().length} snippets.`,
    );
  }

  private async _importFile(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'JSON Files': ['json'] },
    });
    if (!uris || uris.length === 0) {
      return;
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(uris[0]);
      const json = Buffer.from(bytes).toString('utf-8');
      const added = this._store.importFrom(json);
      vscode.window.showInformationMessage(
        `Imported ${added} new snippet${added === 1 ? '' : 's'}.`,
      );
      void this._refresh();
    } catch (err) {
      vscode.window.showErrorMessage(`Import failed: ${err}`);
    }
  }

  private _dispose(): void {
    SnippetLibraryPanel._currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
  }
}
