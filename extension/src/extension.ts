import * as vscode from 'vscode';

/** Opens the Drift debug viewer URL (host/port from settings) in the default browser. */
export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('driftViewer.openInBrowser', async () => {
      const cfg = vscode.workspace.getConfiguration('driftViewer');
      const host = cfg.get<string>('host', '127.0.0.1') ?? '127.0.0.1';
      const port = cfg.get<number>('port', 8642) ?? 8642;
      const url = `http://${host}:${port}`;
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }),
  );
}

export function deactivate(): void {}
