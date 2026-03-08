import * as vscode from 'vscode';

export class DriftViewerPanel {
  public static currentPanel: DriftViewerPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposed = false;
  private _disposables: vscode.Disposable[] = [];

  static createOrShow(host: string, port: number): void {
    const column = vscode.ViewColumn.Beside;
    if (DriftViewerPanel.currentPanel) {
      DriftViewerPanel.currentPanel._panel.reveal(column);
   
   return;
    }
    const panel = vscode.window.createWebviewPanel(
      'driftViewer',
      'Drift Viewer',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );
    DriftViewerPanel.currentPanel = new DriftViewerPanel(panel, host, port);
  }

  private constructor(panel: vscode.WebviewPanel, host: string, port: number) {
    this._panel = panel;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Listen for retry messages from the webview
    this._panel.webview.onDidReceiveMessage(
      (msg) => {
        if (msg.command === 'retry') {
          this._loadContent(host, port);
        }
      },
      null,
      this._disposables,
    );

    this._loadContent(host, port);
  }

  private async _loadContent(host: string, port: number): Promise<void> {
    const baseUrl = `http://${host}:${port}`;

    // Show loading state immediately
    this._panel.webview.html = `
      <html><body style="padding:2rem;font-family:system-ui;color:#ccc;">
        <h2>Loading Drift Viewer\u2026</h2>
        <p>Connecting to <code>${baseUrl}</code></p>
      </body></html>`;

    try {
      const resp = await fetch(baseUrl);
      if (this._disposed) return;

      let html = await resp.text();

      // Inject <base> so relative fetch('/api/...') calls resolve to server
      html = html.replace('<head>', `<head><base href="${baseUrl}/">`);

      // Set CSP to allow connections to the debug server
      const csp = [
        `default-src 'none'`,
        `connect-src ${baseUrl}`,
        `style-src 'unsafe-inline'`,
        `script-src 'unsafe-inline'`,
        `img-src ${baseUrl} data:`,
        `font-src ${baseUrl} data:`,
      ].join('; ');
      html = html.replace(
        '<head>',
        `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`,
      );

      this._panel.webview.html = html;
    } catch {
      if (this._disposed) return;
      this._panel.webview.html = `
        <html><body style="padding:2rem;font-family:system-ui;">
          <h2>Cannot connect to Drift debug server</h2>
          <p>Expected server at <code>${baseUrl}</code></p>
          <p>Make sure your Flutter app is running with <code>DriftDebugServer.start()</code>.</p>
          <button onclick="(function(){
            const vscode = acquireVsCodeApi();
            vscode.postMessage({ command: 'retry' });
          })()">Retry</button>
        </body></html>`;
    }
  }

  dispose(): void {
    this._disposed = true;
    DriftViewerPanel.currentPanel = undefined;
    this._panel.dispose();
    this._disposables.forEach((d) => d.dispose());
  }
}
