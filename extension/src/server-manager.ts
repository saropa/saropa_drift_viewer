import * as vscode from 'vscode';
import { DriftApiClient } from './api-client';
import { IServerInfo, ServerDiscovery } from './server-discovery';

const WORKSPACE_KEY = 'driftViewer.lastKnownPorts';

/** Manages active server selection, client reconfiguration, and persistence. */
export class ServerManager {
  private readonly _onDidChangeActive = new vscode.EventEmitter<IServerInfo | undefined>();
  readonly onDidChangeActive = this._onDidChangeActive.event;

  private _activeServer: IServerInfo | undefined;
  private _picking = false; // Guards against concurrent QuickPick dialogs
  private readonly _discovery: ServerDiscovery;
  private readonly _client: DriftApiClient;
  private readonly _workspaceState: vscode.Memento;
  private readonly _disposable: vscode.Disposable;

  constructor(
    discovery: ServerDiscovery,
    client: DriftApiClient,
    workspaceState: vscode.Memento,
  ) {
    this._discovery = discovery;
    this._client = client;
    this._workspaceState = workspaceState;
    this._disposable = discovery.onDidChangeServers((servers) =>
      this._onServersChanged(servers),
    );
  }

  get activeServer(): IServerInfo | undefined {
    return this._activeServer;
  }

  get servers(): IServerInfo[] {
    return this._discovery.servers;
  }

  /** Show QuickPick for manual server selection. */
  async selectServer(): Promise<void> {
    const servers = this.servers;
    if (servers.length === 0) {
      vscode.window.showWarningMessage('No Drift debug servers found.');
      return;
    }
    if (servers.length === 1) {
      this._setActive(servers[0]);
      return;
    }
    if (this._picking) return; // QuickPick already open

    this._picking = true;
    try {
      const items = servers.map((s) => ({
        label: `:${s.port}`,
        description: s.port === this._activeServer?.port ? '(active)' : '',
        server: s,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a Drift debug server',
      });
      if (picked) {
        this._setActive(picked.server);
      }
    } finally {
      this._picking = false;
    }
  }

  dispose(): void {
    this._disposable.dispose();
    this._onDidChangeActive.dispose();
  }

  private _onServersChanged(servers: IServerInfo[]): void {
    this._persistKnownPorts(servers);
    const activeStillAlive = servers.some(
      (s) => s.port === this._activeServer?.port,
    );

    if (this._activeServer && activeStillAlive) {
      // Active server still alive — no action needed
      return;
    }

    if (this._activeServer && !activeStillAlive) {
      // Active server died
      if (servers.length === 1) {
        this._setActive(servers[0]);
      } else if (servers.length > 1) {
        this.selectServer();
      } else {
        this._setActive(undefined);
      }
      return;
    }

    // No active server yet
    if (servers.length === 1) {
      this._setActive(servers[0]);
    } else if (servers.length > 1) {
      this.selectServer();
    }
  }

  private _setActive(server: IServerInfo | undefined): void {
    this._activeServer = server;
    if (server) {
      this._client.reconfigure(server.host, server.port);
    }
    this._onDidChangeActive.fire(server);
  }

  private _persistKnownPorts(servers: IServerInfo[]): void {
    const ports = servers.map((s) => s.port);
    this._workspaceState.update(WORKSPACE_KEY, ports);
  }
}
