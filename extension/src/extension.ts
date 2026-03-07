import * as vscode from 'vscode';
import { DriftViewerPanel } from './panel';

function getServerConfig(): { host: string; port: number } {
  const cfg = vscode.workspace.getConfiguration('driftViewer');
  return {
    host: cfg.get<string>('host', '127.0.0.1') ?? '127.0.0.1',
    port: cfg.get<number>('port', 8642) ?? 8642,
  };
}

export function activate(context: vscode.ExtensionContext): void {
  // Open in browser (existing)
  context.subscriptions.push(
    vscode.commands.registerCommand('driftViewer.openInBrowser', async () => {
      const { host, port } = getServerConfig();
      await vscode.env.openExternal(vscode.Uri.parse(`http://${host}:${port}`));
    }),
  );

  // Open in editor panel
  context.subscriptions.push(
    vscode.commands.registerCommand('driftViewer.openInPanel', () => {
      const { host, port } = getServerConfig();
      DriftViewerPanel.createOrShow(host, port);
    }),
  );

  // Status bar item
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.text = '$(database) Drift Viewer';
  statusItem.command = 'driftViewer.openInPanel';
  statusItem.tooltip = 'Open Drift Viewer in editor panel';
  statusItem.show();
  context.subscriptions.push(statusItem);
}

export function deactivate(): void {}
