# Feature 35: Multi-Server Federation

## What It Does

When multiple Drift debug servers are running (different apps, microservices, or test instances on ports 8642–8649), show them all in a unified dashboard. Compare schemas across servers, run the same query against multiple databases simultaneously, and see results side-by-side. Debug cross-service data issues without switching contexts.

## User Experience

### 1. Unified Tree View

The existing tree view gains server-level grouping:

```
DRIFT VIEWER — DATABASE EXPLORER
─────────────────────────────────
▼ 🟢 localhost:8642 (User Service)
│  ▶ users (1,250 rows)
│  ▶ roles (5 rows)
│  ▶ sessions (320 rows)
│
▼ 🟢 localhost:8643 (Order Service)
│  ▶ orders (3,400 rows)
│  ▶ order_items (12,800 rows)
│  ▶ products (89 rows)
│
▼ 🔴 localhost:8644 (Payment Service — disconnected)
```

### 2. Cross-Server Query

Command palette → "Drift Viewer: Cross-Server Query"

```
╔═══════════════════════════════════════════════════════════╗
║  CROSS-SERVER QUERY                                       ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  SQL: SELECT COUNT(*) AS cnt FROM "users"                ║
║                                                           ║
║  Run against:                                             ║
║    ☑ localhost:8642 (User Service)                       ║
║    ☑ localhost:8643 (Order Service)                      ║
║    ☐ localhost:8644 (Payment Service — offline)          ║
║                                                           ║
║  [Run All]                                               ║
║                                                           ║
║  ┌─ Results ─────────────────────────────────────────┐   ║
║  │                                                    │   ║
║  │  localhost:8642    │ localhost:8643                 │   ║
║  │  ─────────────────│────────────────                │   ║
║  │  cnt: 1250        │ cnt: 0 (table not found)      │   ║
║  │  ✓ 2.1ms          │ ✗ error                       │   ║
║  │                                                    │   ║
║  └────────────────────────────────────────────────────┘   ║
╚═══════════════════════════════════════════════════════════╝
```

### 3. Schema Comparison

Command palette → "Drift Viewer: Compare Server Schemas"

```
╔═══════════════════════════════════════════════════════════╗
║  SCHEMA COMPARISON                                        ║
║  localhost:8642 vs localhost:8643                         ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  ┌─ Shared Tables ───────────────────────────────────┐   ║
║  │  (none)                                            │   ║
║  └────────────────────────────────────────────────────┘   ║
║                                                           ║
║  ┌─ Only in :8642 ──────────────────────────────────┐    ║
║  │  users (6 columns, 1,250 rows)                    │   ║
║  │  roles (3 columns, 5 rows)                        │   ║
║  │  sessions (5 columns, 320 rows)                   │   ║
║  └────────────────────────────────────────────────────┘   ║
║                                                           ║
║  ┌─ Only in :8643 ──────────────────────────────────┐    ║
║  │  orders (5 columns, 3,400 rows)                   │   ║
║  │  order_items (4 columns, 12,800 rows)             │   ║
║  │  products (6 columns, 89 rows)                    │   ║
║  └────────────────────────────────────────────────────┘   ║
╚═══════════════════════════════════════════════════════════╝
```

### 4. Synchronized Watch

Watch the same query across servers — see diffs between them in real time.

## New Files

```
extension/src/
  federation/
    federation-manager.ts      # Manages multiple DriftApiClient instances
    federation-tree-provider.ts# Multi-server tree view data provider
    cross-query-panel.ts       # Webview for cross-server queries
    cross-query-html.ts        # HTML template
    schema-compare-panel.ts    # Webview for schema comparison
    schema-compare-html.ts     # HTML template
extension/src/test/
  federation-manager.test.ts
  cross-query-panel.test.ts
```

## Dependencies

- `api-client.ts` — creates one `DriftApiClient` per server
- `server-discovery.ts` — discovers all running servers
- `server-manager.ts` — current server selection logic (extended)
- `tree/drift-tree-provider.ts` — extended for multi-server grouping

## Architecture

### Federation Manager

Maintains a pool of API clients, one per discovered server:

```typescript
interface IFederatedServer {
  id: string;
  host: string;
  port: number;
  label: string;              // User-assigned label or auto "Server :port"
  client: DriftApiClient;
  status: 'connected' | 'disconnected' | 'error';
  lastSeen: number;
  metadata?: {
    tables: TableMetadata[];
    totalRows: number;
  };
}

class FederationManager implements vscode.Disposable {
  private _servers = new Map<string, IFederatedServer>();

  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(
    private readonly _discovery: ServerDiscovery,
  ) {
    // Listen to discovery events
    _discovery.onDidDiscover((server) => this._addServer(server));
    _discovery.onDidLose((server) => this._markDisconnected(server));
  }

  private _addServer(info: { host: string; port: number }): void {
    const id = `${info.host}:${info.port}`;
    if (this._servers.has(id)) {
      this._servers.get(id)!.status = 'connected';
      this._servers.get(id)!.lastSeen = Date.now();
    } else {
      const client = new DriftApiClient();
      client.reconfigure(`http://${info.host}:${info.port}`);

      this._servers.set(id, {
        id,
        host: info.host,
        port: info.port,
        label: `Server :${info.port}`,
        client,
        status: 'connected',
        lastSeen: Date.now(),
      });
    }
    this._onDidChange.fire();
  }

  async refreshMetadata(): Promise<void> {
    for (const server of this._servers.values()) {
      if (server.status !== 'connected') continue;
      try {
        const meta = await server.client.schemaMetadata();
        server.metadata = {
          tables: meta.tables,
          totalRows: meta.tables.reduce((s, t) => s + t.rowCount, 0),
        };
      } catch {
        server.status = 'error';
      }
    }
    this._onDidChange.fire();
  }

  async runQueryAcross(
    sql: string,
    serverIds: string[],
  ): Promise<Map<string, ICrossQueryResult>> {
    const results = new Map<string, ICrossQueryResult>();

    await Promise.all(serverIds.map(async (id) => {
      const server = this._servers.get(id);
      if (!server || server.status !== 'connected') {
        results.set(id, { serverId: id, error: 'Not connected', rows: [], durationMs: 0 });
        return;
      }
      const start = Date.now();
      try {
        const result = await server.client.sql(sql);
        results.set(id, {
          serverId: id,
          rows: result.rows,
          columns: result.columns,
          durationMs: Date.now() - start,
        });
      } catch (err) {
        results.set(id, {
          serverId: id,
          error: String(err),
          rows: [],
          durationMs: Date.now() - start,
        });
      }
    }));

    return results;
  }

  async compareSchemas(
    serverIdA: string,
    serverIdB: string,
  ): Promise<ISchemaComparison> {
    const serverA = this._servers.get(serverIdA)!;
    const serverB = this._servers.get(serverIdB)!;

    const [metaA, metaB] = await Promise.all([
      serverA.client.schemaMetadata(),
      serverB.client.schemaMetadata(),
    ]);

    const tablesA = new Map(metaA.tables.map(t => [t.name, t]));
    const tablesB = new Map(metaB.tables.map(t => [t.name, t]));

    const shared: ITableComparison[] = [];
    const onlyA: TableMetadata[] = [];
    const onlyB: TableMetadata[] = [];

    for (const [name, tableA] of tablesA) {
      const tableB = tablesB.get(name);
      if (tableB) {
        shared.push(this._compareTables(tableA, tableB));
      } else {
        onlyA.push(tableA);
      }
    }
    for (const [name, tableB] of tablesB) {
      if (!tablesA.has(name)) onlyB.push(tableB);
    }

    return { serverA: serverIdA, serverB: serverIdB, shared, onlyA, onlyB };
  }

  get servers(): readonly IFederatedServer[] {
    return [...this._servers.values()];
  }

  get connectedServers(): readonly IFederatedServer[] {
    return this.servers.filter(s => s.status === 'connected');
  }
}
```

### Multi-Server Tree Provider

Extends the existing tree to show server groupings:

```typescript
class FederationTreeProvider implements vscode.TreeDataProvider<FederationTreeItem> {
  getChildren(element?: FederationTreeItem): vscode.ProviderResult<FederationTreeItem[]> {
    if (!element) {
      // Root: list servers
      return this._manager.servers.map(s => new ServerItem(s));
    }
    if (element instanceof ServerItem) {
      // Server children: list tables
      return element.server.metadata?.tables.map(t => new FederatedTableItem(element.server, t)) ?? [];
    }
    if (element instanceof FederatedTableItem) {
      // Table children: list columns
      return element.table.columns.map(c => new FederatedColumnItem(element.server, element.table, c));
    }
    return [];
  }
}

class ServerItem extends vscode.TreeItem {
  constructor(public readonly server: IFederatedServer) {
    super(server.label, vscode.TreeItemCollapsibleState.Expanded);
    this.description = `${server.host}:${server.port}`;
    this.iconPath = new vscode.ThemeIcon(
      server.status === 'connected' ? 'circle-filled' : 'circle-outline',
      server.status === 'connected'
        ? new vscode.ThemeColor('testing.iconPassed')
        : new vscode.ThemeColor('testing.iconFailed')
    );
    this.contextValue = 'federatedServer';
  }
}
```

### Cross-Query Result

```typescript
interface ICrossQueryResult {
  serverId: string;
  rows: Record<string, unknown>[];
  columns?: string[];
  durationMs: number;
  error?: string;
}
```

### Webview Message Protocol

**Cross-Query Panel:**

Webview → Extension:
```typescript
{ command: 'runQuery', sql: string, serverIds: string[] }
{ command: 'copyResult', serverId: string }
```

Extension → Webview:
```typescript
{ command: 'init', servers: { id: string; label: string; status: string }[] }
{ command: 'results', results: { serverId: string; rows: object[]; error?: string; durationMs: number }[] }
```

## Server-Side Changes

None. Each server is queried independently via the existing API. The federation is purely an extension-side concept.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.crossServerQuery",
        "title": "Drift Viewer: Cross-Server Query",
        "icon": "$(server-environment)"
      },
      {
        "command": "driftViewer.compareServerSchemas",
        "title": "Drift Viewer: Compare Server Schemas"
      },
      {
        "command": "driftViewer.labelServer",
        "title": "Drift Viewer: Label Server"
      }
    ],
    "menus": {
      "view/title": [{
        "command": "driftViewer.crossServerQuery",
        "when": "view == driftViewer.databaseExplorer && driftViewer.serverConnected",
        "group": "navigation"
      }],
      "view/item/context": [{
        "command": "driftViewer.labelServer",
        "when": "viewItem == federatedServer",
        "group": "inline"
      }]
    },
    "configuration": {
      "properties": {
        "driftViewer.federation.enabled": {
          "type": "boolean",
          "default": false,
          "description": "Enable multi-server federation (groups discovered servers in tree view)."
        },
        "driftViewer.federation.refreshIntervalMs": {
          "type": "number",
          "default": 5000,
          "description": "Interval for refreshing server metadata (ms)."
        }
      }
    }
  }
}
```

## Wiring in extension.ts

```typescript
const fedConfig = vscode.workspace.getConfiguration('driftViewer.federation');
if (fedConfig.get('enabled', false)) {
  const fedManager = new FederationManager(discovery);
  const fedTreeProvider = new FederationTreeProvider(fedManager);

  context.subscriptions.push(
    fedManager,
    vscode.window.createTreeView('driftViewer.databaseExplorer', {
      treeDataProvider: fedTreeProvider,
      showCollapseAll: true,
    }),

    vscode.commands.registerCommand('driftViewer.crossServerQuery', async () => {
      const connected = fedManager.connectedServers;
      if (connected.length < 2) {
        vscode.window.showWarningMessage('Need at least 2 connected servers for cross-server queries.');
        return;
      }
      CrossQueryPanel.createOrShow(context.extensionUri, fedManager);
    }),

    vscode.commands.registerCommand('driftViewer.compareServerSchemas', async () => {
      const connected = fedManager.connectedServers;
      if (connected.length < 2) {
        vscode.window.showWarningMessage('Need at least 2 connected servers.');
        return;
      }

      const pickA = await vscode.window.showQuickPick(
        connected.map(s => ({ label: s.label, description: `${s.host}:${s.port}`, server: s })),
        { placeHolder: 'Select first server' }
      );
      if (!pickA) return;

      const pickB = await vscode.window.showQuickPick(
        connected.filter(s => s.id !== pickA.server.id).map(s => ({ label: s.label, description: `${s.host}:${s.port}`, server: s })),
        { placeHolder: 'Select second server' }
      );
      if (!pickB) return;

      const comparison = await fedManager.compareSchemas(pickA.server.id, pickB.server.id);
      SchemaComparePanel.createOrShow(context.extensionUri, comparison);
    }),

    vscode.commands.registerCommand('driftViewer.labelServer', async (item: ServerItem) => {
      const label = await vscode.window.showInputBox({
        prompt: 'Label for this server',
        value: item.server.label,
      });
      if (label) {
        fedManager.setLabel(item.server.id, label);
      }
    })
  );
}
```

## Testing

- `federation-manager.test.ts`:
  - Server discovery adds to pool
  - Server loss marks disconnected
  - `runQueryAcross` executes on all selected servers in parallel
  - Error on one server doesn't block others
  - `compareSchemas` correctly identifies shared/only-A/only-B tables
  - Metadata refresh updates row counts
  - Disconnected servers excluded from connected list
- `cross-query-panel.test.ts`:
  - Results display for multiple servers side-by-side
  - Error results display error message instead of table

## Known Limitations

- Federation is opt-in (`federation.enabled: false` by default) to avoid confusion with single-server usage
- Server labels are stored in workspace state — not synced across machines
- Cross-server queries run independently — no actual cross-database JOIN support
- Schema comparison is table-level only — doesn't compare column definitions in shared tables (use schema-diff for that)
- No authentication federation — each server may have different auth tokens
- Discovery only scans the configured port range — servers outside that range aren't found
- Metadata refresh polls all servers — may be slow with many servers
- No "primary server" concept — all servers are peers
- Synchronized watch creates N watchers × M servers — can be expensive
