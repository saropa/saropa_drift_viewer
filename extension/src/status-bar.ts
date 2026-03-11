import * as vscode from 'vscode';
import type { ServerDiscovery } from './server-discovery';
import type { ServerManager } from './server-manager';

export function updateStatusBar(
  item: vscode.StatusBarItem,
  discovery: ServerDiscovery,
  manager: ServerManager,
  discoveryEnabled: boolean,
): void {
  const active = manager.activeServer;
  const count = manager.servers.length;

  if (active && count <= 1) {
    item.text = `$(database) Drift: :${active.port}`;
    item.command = 'driftViewer.openInPanel';
    item.tooltip = `Connected to ${active.host}:${active.port}`;
    item.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.prominentBackground',
    );
  } else if (active && count > 1) {
    item.text = `$(database) Drift: ${count} servers`;
    item.command = 'driftViewer.selectServer';
    item.tooltip = `Active: :${active.port} (${count} servers found)`;
    item.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.prominentBackground',
    );
  } else if (discoveryEnabled && discovery.state === 'searching') {
    item.text = '$(sync~spin) Drift: Searching...';
    item.command = 'driftViewer.retryDiscovery';
    item.tooltip = 'Scanning for Drift debug servers\u2026';
    item.backgroundColor = undefined;
  } else if (!discoveryEnabled) {
    item.text = '$(database) Saropa Drift Advisor';
    item.command = 'driftViewer.openInPanel';
    item.tooltip = 'Open Saropa Drift Advisor in editor panel';
    item.backgroundColor = undefined;
  } else {
    item.text = '$(circle-slash) Drift: Offline';
    item.command = 'driftViewer.retryDiscovery';
    item.tooltip = 'No Drift debug servers found';
    item.backgroundColor = undefined;
  }
  item.show();
}
