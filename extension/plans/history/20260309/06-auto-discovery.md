# Feature 6: Server Auto-Discovery

## What It Does

Automatically detects running Drift debug servers by scanning ports. No more manually configuring `driftViewer.port`. Just start your Flutter app and the extension finds it.

## User Experience

1. Install extension, open your Flutter project
2. Run your app (which calls `DriftDebugServer.start()`)
3. Status bar shows: `$(sync~spin) Drift: Searching...`
4. A few seconds later: `$(database) Drift: :8642` (green)
5. Notification: "Drift debug server detected on port 8642" with "Open Panel" button
6. If the app stops: `$(circle-slash) Drift: Offline`
7. If multiple apps running: `$(database) Drift: 2 servers` — click to pick one

## New Files

```
extension/src/
  server-discovery.ts       # Port scanning, health checks, polling loop
  server-manager.ts         # Active server selection, multi-server management
extension/src/test/
  server-discovery.test.ts
  server-manager.test.ts
```

## Dependencies

Requires `api-client.ts` from Feature 1 (just the `health()` call pattern).

## Discovery Algorithm

### Port Scanning

Scan a configurable range of ports in parallel:

```typescript
async function scanPorts(host: string, ports: number[]): Promise<number[]> {
  const results = await Promise.allSettled(
    ports.map(port => checkHealth(host, port, 2000))
  );
  return ports.filter((_, i) => results[i].status === 'fulfilled' && results[i].value);
}

async function checkHealth(host: string, port: number, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`http://${host}:${port}/api/health`, { signal: controller.signal });
    const body = await resp.json();
    return body?.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
```

### Polling State Machine

| State | Interval | Trigger |
|-------|----------|---------|
| **Searching** | 3s | No servers known |
| **Connected** | 15s | At least one server alive |
| **Backoff** | 30s | Multiple empty scans in a row |

- On server found: transition to Connected, fire notification
- On server lost (2 consecutive misses): remove, maybe transition to Searching
- On 5+ empty scans: transition to Backoff

### Graceful Disappearance

A server failing one health check is not immediately removed. It needs 2 consecutive failures (handles app hot-reload, brief network hiccups).

## Multi-Server Management

```typescript
interface ServerInfo {
  host: string;
  port: number;
  firstSeen: number;
  lastSeen: number;
  missedPolls: number;
}

class ServerManager {
  private _activeServer: ServerInfo | undefined;
  readonly onDidChangeActive: Event<ServerInfo | undefined>;

  get servers(): ServerInfo[] { ... }
  get activeServer(): ServerInfo | undefined { ... }

  async selectServer(): Promise<void> {
    // QuickPick if multiple servers
  }
}
```

**Auto-selection rules:**
- 1 server found: auto-select
- Multiple found, none active: show QuickPick
- Active server dies, 1 remaining: auto-switch
- Active server dies, multiple remaining: show QuickPick

## Status Bar

| State | Icon | Text | Color | Click Action |
|-------|------|------|-------|-------------|
| Searching | `$(sync~spin)` | `Drift: Searching...` | default | Retry |
| Connected (1) | `$(database)` | `Drift: :8642` | green | Open panel |
| Connected (N) | `$(database)` | `Drift: 2 servers` | green | Select server |
| Offline | `$(circle-slash)` | `Drift: Offline` | default | Retry |

## Notifications

```typescript
// Server found
vscode.window.showInformationMessage(
  `Drift debug server detected on port ${port}`,
  'Open Panel', 'Dismiss'
);

// Server lost
vscode.window.showWarningMessage(
  `Drift debug server on port ${port} is no longer responding`
);
```

Throttled: max 1 notification per port per 60 seconds (handles hot-reload churn).

## Persistence

Use `context.workspaceState` (per-workspace):

```typescript
// Save on every successful scan
context.workspaceState.update('driftViewer.lastKnownPorts', [8642]);

// Restore on activation — include in first scan for faster reconnection
const lastPorts = context.workspaceState.get<number[]>('driftViewer.lastKnownPorts', []);
```

## Integration with Existing Code

Replace the static `getServerConfig()`:

```typescript
// Before (static)
function getServerConfig() {
  const cfg = vscode.workspace.getConfiguration('driftViewer');
  return { host: cfg.get('host', '127.0.0.1'), port: cfg.get('port', 8642) };
}

// After (dynamic)
function getServerConfig(serverManager: ServerManager) {
  const active = serverManager.activeServer;
  if (active) return { host: active.host, port: active.port };
  // Fallback to manual config
  const cfg = vscode.workspace.getConfiguration('driftViewer');
  return { host: cfg.get('host', '127.0.0.1'), port: cfg.get('port', 8642) };
}
```

All features (tree view, CodeLens, SQL notebook, etc.) use `getServerConfig(serverManager)` instead of reading config directly.

## Secondary Validation

To avoid false positives (non-Drift services on the same port), after `/api/health` succeeds, also check `/api/schema/metadata` returns the expected JSON shape:

```typescript
async function validateDriftServer(host: string, port: number): Promise<boolean> {
  try {
    const resp = await fetch(`http://${host}:${port}/api/schema/metadata`);
    const data = await resp.json();
    return Array.isArray(data?.tables);
  } catch {
    return false;
  }
}
```

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      { "command": "driftViewer.selectServer", "title": "Drift Viewer: Select Server" },
      { "command": "driftViewer.retryDiscovery", "title": "Drift Viewer: Retry Server Discovery" }
    ],
    "configuration": {
      "properties": {
        "driftViewer.discovery.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Automatically scan for running Drift debug servers."
        },
        "driftViewer.discovery.portRangeStart": {
          "type": "number",
          "default": 8642,
          "description": "Start of port range to scan."
        },
        "driftViewer.discovery.portRangeEnd": {
          "type": "number",
          "default": 8649,
          "description": "End of port range to scan (inclusive)."
        }
      }
    }
  }
}
```

## Wiring in extension.ts

```typescript
const discovery = new ServerDiscovery(getDiscoveryConfig());
const serverManager = new ServerManager(discovery, context.workspaceState);

if (cfg.get('discovery.enabled', true)) {
  discovery.start();
}

// Dynamic status bar
serverManager.onDidChangeActive(() => updateStatusBar(statusItem, serverManager));
discovery.onDidChangeServers(() => updateStatusBar(statusItem, serverManager));

// All features use serverManager for host/port
const { host, port } = getServerConfig(serverManager);
```

## Testing

- `server-discovery.test.ts`: mock `fetch` to simulate healthy/unhealthy ports, test state transitions (searching -> connected -> backoff), test graceful disappearance (2 consecutive misses)
- `server-manager.test.ts`: test auto-selection, multi-server QuickPick, persistence

## Known Limitations

- Only scans localhost (configurable host, but no network/mDNS discovery)
- Default range is 8 ports (8642-8649); wider ranges take longer
- Cannot detect servers behind SSH tunnels or on remote machines without manual config
- If a non-Drift service responds with `{"ok": true}` on `/api/health`, secondary validation via `/api/schema/metadata` mitigates but doesn't eliminate false positives
