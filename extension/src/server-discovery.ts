import * as vscode from 'vscode';

/** Discovered server info. */
export interface IServerInfo {
  host: string;
  port: number;
  firstSeen: number;
  lastSeen: number;
  missedPolls: number;
}

/** Configuration for server discovery. */
export interface IDiscoveryConfig {
  host: string;
  portRangeStart: number;
  portRangeEnd: number;
  /** Extra ports to include in scans (e.g., last-known ports from workspace state). */
  additionalPorts?: number[];
}

/** Polling state machine states. */
export type DiscoveryState = 'searching' | 'connected' | 'backoff';

const SEARCH_INTERVAL = 3000;
const CONNECTED_INTERVAL = 15000;
const BACKOFF_INTERVAL = 30000;
const HEALTH_TIMEOUT_MS = 2000;
const MISS_THRESHOLD = 2;
const BACKOFF_THRESHOLD = 5;
const NOTIFY_THROTTLE_MS = 60000;

/** Scans a port range for running Drift debug servers. */
export class ServerDiscovery {
  private readonly _onDidChangeServers = new vscode.EventEmitter<IServerInfo[]>();
  readonly onDidChangeServers = this._onDidChangeServers.event;

  private readonly _config: IDiscoveryConfig;
  private _servers = new Map<number, IServerInfo>();
  private _state: DiscoveryState = 'searching';
  private _emptyScans = 0;
  private _running = false;
  private _pollId = 0; // Incremented on stop/retry to cancel stale polls
  private _pollTimeout: ReturnType<typeof setTimeout> | undefined;
  private _notifiedAt = new Map<number, number>();

  constructor(config: IDiscoveryConfig) {
    this._config = config;
  }

  get state(): DiscoveryState {
    return this._state;
  }

  get servers(): IServerInfo[] {
    return [...this._servers.values()];
  }

  start(): void {
    if (this._running) return;
    this._running = true;
    this._poll(this._pollId);
  }

  stop(): void {
    this._running = false;
    this._pollId++;
    if (this._pollTimeout !== undefined) {
      clearTimeout(this._pollTimeout);
      this._pollTimeout = undefined;
    }
  }

  /** Force immediate re-scan from searching state. */
  retry(): void {
    this.stop();
    this._state = 'searching';
    this._emptyScans = 0;
    this.start();
  }

  dispose(): void {
    this.stop();
    this._onDidChangeServers.dispose();
  }

  private async _poll(id: number): Promise<void> {
    if (!this._running || id !== this._pollId) return;

    try {
      const alivePorts = await this._scanPorts();
      if (!this._running || id !== this._pollId) return;
      this._updateServers(alivePorts);
    } catch {
      if (!this._running || id !== this._pollId) return;
      this._updateServers([]);
    }

    if (this._running && id === this._pollId) {
      this._pollTimeout = setTimeout(
        () => this._poll(id), this._getInterval(),
      );
    }
  }

  private async _scanPorts(): Promise<number[]> {
    const { host, portRangeStart, portRangeEnd, additionalPorts } = this._config;
    const portSet = new Set<number>();
    for (let p = portRangeStart; p <= portRangeEnd; p++) {
      portSet.add(p);
    }
    if (additionalPorts) {
      for (const p of additionalPorts) portSet.add(p);
    }
    const ports = [...portSet];

    const results = await Promise.allSettled(
      ports.map((port) => this._checkHealth(host, port)),
    );

    const alive: number[] = [];
    for (let i = 0; i < ports.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled' && r.value) {
        alive.push(ports[i]);
      }
    }
    return alive;
  }

  private async _checkHealth(
    host: string,
    port: number,
  ): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const resp = await fetch(`http://${host}:${port}/api/health`, {
        signal: controller.signal,
      });
      const body = (await resp.json()) as { ok?: boolean };
      if (body?.ok !== true) return false;
      return this._validateServer(host, port, controller.signal);
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Secondary validation: confirm /api/schema/metadata returns expected shape. */
  private async _validateServer(
    host: string,
    port: number,
    signal: AbortSignal,
  ): Promise<boolean> {
    try {
      const resp = await fetch(
        `http://${host}:${port}/api/schema/metadata`, { signal },
      );
      const data: unknown = await resp.json();
      return Array.isArray(data);
    } catch {
      return false;
    }
  }

  private _updateServers(alivePorts: number[]): void {
    const now = Date.now();
    const aliveSet = new Set(alivePorts);
    let changed = false;

    // Update or add alive servers
    for (const port of alivePorts) {
      const existing = this._servers.get(port);
      if (existing) {
        existing.lastSeen = now;
        existing.missedPolls = 0;
      } else {
        this._servers.set(port, {
          host: this._config.host,
          port,
          firstSeen: now,
          lastSeen: now,
          missedPolls: 0,
        });
        this._maybeNotify(port, 'found');
        changed = true;
      }
    }

    // Increment misses for servers not in alive set
    for (const [port, info] of this._servers) {
      if (!aliveSet.has(port)) {
        info.missedPolls++;
        if (info.missedPolls >= MISS_THRESHOLD) {
          this._servers.delete(port);
          this._maybeNotify(port, 'lost');
          changed = true;
        }
      }
    }

    // State transitions
    if (this._servers.size > 0) {
      this._state = 'connected';
      this._emptyScans = 0;
    } else if (alivePorts.length === 0) {
      this._emptyScans++;
      this._state = this._emptyScans >= BACKOFF_THRESHOLD ? 'backoff' : 'searching';
    }

    if (changed) {
      this._onDidChangeServers.fire(this.servers);
    }
  }

  private _getInterval(): number {
    switch (this._state) {
      case 'searching': return SEARCH_INTERVAL;
      case 'connected': return CONNECTED_INTERVAL;
      case 'backoff': return BACKOFF_INTERVAL;
    }
  }

  private _maybeNotify(port: number, event: 'found' | 'lost'): void {
    const now = Date.now();
    const last = this._notifiedAt.get(port);
    if (last !== undefined && now - last < NOTIFY_THROTTLE_MS) return;
    this._notifiedAt.set(port, now);

    if (event === 'found') {
      vscode.window.showInformationMessage(
        `Drift debug server detected on port ${port}`,
        'Open Panel',
        'Dismiss',
      );
    } else {
      vscode.window.showWarningMessage(
        `Drift debug server on port ${port} is no longer responding`,
      );
    }
  }
}
