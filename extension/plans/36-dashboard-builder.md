# Feature 36: Custom Dashboard Builder

## What It Does

A webview panel with a configurable grid layout where users drag-and-drop widgets: live table previews, query result cards, chart panels, stat counters, invariant monitors, and health scores. Save and reload dashboard layouts. Each widget auto-refreshes on generation change. Build your own "mission control" for debugging.

## User Experience

1. Command palette → "Drift Viewer: Open Dashboard" or activity bar icon
2. First launch shows an empty dashboard with an "Add Widget" button:

```
╔═══════════════════════════════════════════════════════════╗
║  DASHBOARD                    [+ Add Widget] [⚙ Layout]  ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  ┌────────────────────┐  ┌────────────────────────────┐  ║
║  │ 📊 users           │  │ 📈 Orders This Hour        │  ║
║  │ Row count: 1,250   │  │                             │  ║
║  │ Last change: 2m ago│  │  ██                         │  ║
║  │                    │  │  ████                       │  ║
║  │ [View] [Watch]     │  │  ██████                     │  ║
║  └────────────────────┘  │  ████████                   │  ║
║                          │  ██████████  47 orders      │  ║
║  ┌────────────────────┐  └────────────────────────────┘  ║
║  │ 🔍 Recent SQL      │                                  ║
║  │                    │  ┌────────────────────────────┐  ║
║  │ SELECT u.name,     │  │ ❤ Health Score              │  ║
║  │   COUNT(o.id)      │  │                             │  ║
║  │ FROM users u       │  │      A-  (87/100)          │  ║
║  │ JOIN orders o ...  │  │                             │  ║
║  │                    │  │ Index: A │ FK: A+ │ Null: B │  ║
║  │ Results: 12 rows   │  └────────────────────────────┘  ║
║  │ [Refresh] [Edit]   │                                  ║
║  └────────────────────┘  ┌────────────────────────────┐  ║
║                          │ 🛡 Invariants: 5/6 passing  │  ║
║  ┌────────────────────┐  │                             │  ║
║  │ 📋 orders (live)   │  │ ❌ Orphaned FK in orders   │  ║
║  │ id | user | total  │  │ ✅ users.email unique      │  ║
║  │ 201| 142  | $49.99 │  │ ✅ balance >= 0            │  ║
║  │ 200| 140  | $29.99 │  │ ✅ ...                     │  ║
║  │ 199| 42   | $89.00 │  └────────────────────────────┘  ║
║  └────────────────────┘                                  ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
```

3. Click "+ Add Widget" → picker with widget types
4. Drag widgets to rearrange, resize by dragging edges
5. Layout auto-saved to workspace state

### Widget Types

| Widget | Data Source | Refresh |
|--------|------------|---------|
| Table Stats | `schemaMetadata()` | On generation change |
| Table Preview | `sql("SELECT * FROM t LIMIT N")` | On generation change |
| Query Result | `sql(custom)` | On generation change or manual |
| Chart | `sql(aggregation)` | On generation change |
| Row Count | `sql("SELECT COUNT(*)")` | On generation change |
| Health Score | Health scorer | Manual or timed |
| Invariant Status | Invariant manager | On generation change |
| DVR Status | DVR recorder status | Continuous |
| Watch Diff | Watch manager | On generation change |
| Custom Text | Static text/notes | Never |

## New Files

```
extension/src/
  dashboard/
    dashboard-panel.ts         # Webview panel lifecycle + message handling
    dashboard-html.ts          # HTML/CSS/JS template with grid layout engine
    dashboard-state.ts         # Persists/restores layout configuration
    widget-registry.ts         # Registry of available widget types
    widget-data-fetcher.ts     # Fetches data for each widget type
    dashboard-types.ts         # Shared interfaces
extension/src/test/
  dashboard-state.test.ts
  widget-data-fetcher.test.ts
```

## Dependencies

- `api-client.ts` — various endpoints depending on widget type
- `generation-watcher.ts` — triggers widget refresh
- Optional: `health/health-scorer.ts` (Feature 30), `invariants/invariant-manager.ts` (Feature 27)

## Architecture

### Dashboard State

```typescript
interface IDashboardLayout {
  version: 1;
  name: string;
  columns: number;            // Grid columns (default 4)
  widgets: IWidgetConfig[];
}

interface IWidgetConfig {
  id: string;
  type: WidgetType;
  title: string;
  gridX: number;              // Column position (0-based)
  gridY: number;              // Row position (0-based)
  gridW: number;              // Width in grid units (1–4)
  gridH: number;              // Height in grid units (1–3)
  config: Record<string, unknown>; // Widget-specific config
}

type WidgetType =
  | 'tableStats'
  | 'tablePreview'
  | 'queryResult'
  | 'chart'
  | 'rowCount'
  | 'healthScore'
  | 'invariantStatus'
  | 'dvrStatus'
  | 'watchDiff'
  | 'customText';

class DashboardState {
  constructor(private readonly _state: vscode.Memento) {}

  save(layout: IDashboardLayout): void {
    this._state.update(`dashboard.${layout.name}`, layout);
    this._state.update('dashboard.current', layout.name);
  }

  load(name?: string): IDashboardLayout | undefined {
    const key = name ?? this._state.get<string>('dashboard.current');
    if (!key) return undefined;
    return this._state.get<IDashboardLayout>(`dashboard.${key}`);
  }

  listSaved(): string[] {
    // Scan workspace state for dashboard.* keys
    // (VS Code Memento doesn't support key enumeration, so maintain a separate list)
    return this._state.get<string[]>('dashboard.list', []);
  }
}
```

### Widget Registry

Maps widget types to their data fetch functions and render templates:

```typescript
interface IWidgetDefinition {
  type: WidgetType;
  label: string;
  icon: string;
  defaultSize: { w: number; h: number };
  configSchema: IConfigField[];    // Fields shown when adding/editing widget
  fetchData: (client: DriftApiClient, config: Record<string, unknown>) => Promise<unknown>;
  renderHtml: (data: unknown, config: Record<string, unknown>) => string;
}

const WIDGET_REGISTRY: IWidgetDefinition[] = [
  {
    type: 'tableStats',
    label: 'Table Stats',
    icon: '📊',
    defaultSize: { w: 1, h: 1 },
    configSchema: [
      { key: 'table', label: 'Table', type: 'tableSelect' },
    ],
    fetchData: async (client, config) => {
      const meta = await client.schemaMetadata();
      return meta.tables.find(t => t.name === config.table);
    },
    renderHtml: (data, config) => {
      const table = data as TableMetadata;
      return `
        <div class="widget-table-stats">
          <h3>${esc(table.name)}</h3>
          <p>Rows: <strong>${table.rowCount.toLocaleString()}</strong></p>
          <p>Columns: ${table.columns.length}</p>
        </div>
      `;
    },
  },

  {
    type: 'queryResult',
    label: 'Query Result',
    icon: '🔍',
    defaultSize: { w: 2, h: 2 },
    configSchema: [
      { key: 'sql', label: 'SQL Query', type: 'text' },
      { key: 'limit', label: 'Max Rows', type: 'number', default: 10 },
    ],
    fetchData: async (client, config) => {
      return client.sql(`${config.sql} LIMIT ${config.limit ?? 10}`);
    },
    renderHtml: (data, _config) => {
      const result = data as { columns: string[]; rows: object[] };
      return renderMiniTable(result.columns, result.rows);
    },
  },

  {
    type: 'rowCount',
    label: 'Row Count',
    icon: '🔢',
    defaultSize: { w: 1, h: 1 },
    configSchema: [
      { key: 'table', label: 'Table', type: 'tableSelect' },
    ],
    fetchData: async (client, config) => {
      const result = await client.sql(`SELECT COUNT(*) AS cnt FROM "${config.table}"`);
      return (result.rows[0] as { cnt: number }).cnt;
    },
    renderHtml: (data, config) => {
      return `
        <div class="widget-counter">
          <span class="counter-value">${(data as number).toLocaleString()}</span>
          <span class="counter-label">${esc(String(config.table))} rows</span>
        </div>
      `;
    },
  },

  {
    type: 'chart',
    label: 'Chart',
    icon: '📈',
    defaultSize: { w: 2, h: 2 },
    configSchema: [
      { key: 'sql', label: 'SQL (first col = label, second = value)', type: 'text' },
      { key: 'chartType', label: 'Chart Type', type: 'select', options: ['bar', 'pie', 'line'] },
    ],
    fetchData: async (client, config) => client.sql(String(config.sql)),
    renderHtml: (data, config) => renderSvgChart(data as { rows: object[] }, String(config.chartType)),
  },

  // ... additional widget types
];
```

### Grid Layout Engine (HTML/JS)

The dashboard uses CSS Grid with drag-and-drop reordering:

```typescript
function getDashboardJs(): string {
  return `
    const GRID_COLS = 4;
    let widgets = [];
    let dragging = null;

    function renderGrid() {
      const grid = document.getElementById('grid');
      grid.style.gridTemplateColumns = 'repeat(' + GRID_COLS + ', 1fr)';
      grid.innerHTML = '';

      for (const w of widgets) {
        const el = document.createElement('div');
        el.className = 'widget';
        el.draggable = true;
        el.dataset.id = w.id;
        el.style.gridColumn = (w.gridX + 1) + ' / span ' + w.gridW;
        el.style.gridRow = (w.gridY + 1) + ' / span ' + w.gridH;
        el.innerHTML = '<div class="widget-header">' +
          '<span class="widget-icon">' + w.icon + '</span>' +
          '<span class="widget-title">' + w.title + '</span>' +
          '<button class="widget-remove" onclick="removeWidget(\\'' + w.id + '\\')">×</button>' +
          '</div>' +
          '<div class="widget-body" id="body-' + w.id + '">' +
          (w.html || '<p class="loading">Loading…</p>') +
          '</div>';

        el.addEventListener('dragstart', onDragStart);
        el.addEventListener('dragover', onDragOver);
        el.addEventListener('drop', onDrop);
        grid.appendChild(el);
      }
    }

    function onDragStart(e) { dragging = e.target.dataset.id; }
    function onDragOver(e) { e.preventDefault(); }
    function onDrop(e) {
      const targetId = e.currentTarget.dataset.id;
      if (dragging && targetId && dragging !== targetId) {
        // Swap positions
        vscode.postMessage({ command: 'swapWidgets', idA: dragging, idB: targetId });
      }
      dragging = null;
    }

    function removeWidget(id) {
      vscode.postMessage({ command: 'removeWidget', id: id });
    }
  `;
}
```

### Data Fetcher

Fetches data for all widgets on refresh:

```typescript
class WidgetDataFetcher {
  constructor(private readonly _client: DriftApiClient) {}

  async fetchAll(
    widgets: IWidgetConfig[],
  ): Promise<Map<string, unknown>> {
    const results = new Map<string, unknown>();

    await Promise.all(widgets.map(async (widget) => {
      const def = WIDGET_REGISTRY.find(w => w.type === widget.type);
      if (!def) return;
      try {
        const data = await def.fetchData(this._client, widget.config);
        results.set(widget.id, data);
      } catch (err) {
        results.set(widget.id, { error: String(err) });
      }
    }));

    return results;
  }
}
```

### Webview Message Protocol

Webview → Extension:
```typescript
{ command: 'addWidget', type: WidgetType, config: Record<string, unknown> }
{ command: 'removeWidget', id: string }
{ command: 'swapWidgets', idA: string, idB: string }
{ command: 'resizeWidget', id: string, w: number, h: number }
{ command: 'editWidget', id: string, config: Record<string, unknown> }
{ command: 'refreshAll' }
{ command: 'saveLayout', name: string }
{ command: 'loadLayout', name: string }
```

Extension → Webview:
```typescript
{ command: 'init', layout: IDashboardLayout, widgetTypes: { type: string; label: string; icon: string }[] }
{ command: 'updateWidget', id: string, html: string }
{ command: 'updateAll', updates: { id: string; html: string }[] }
{ command: 'layoutChanged', layout: IDashboardLayout }
```

## Server-Side Changes

None. Uses existing API endpoints based on widget type.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.openDashboard",
        "title": "Drift Viewer: Open Dashboard",
        "icon": "$(dashboard)"
      },
      {
        "command": "driftViewer.saveDashboard",
        "title": "Drift Viewer: Save Dashboard Layout"
      },
      {
        "command": "driftViewer.loadDashboard",
        "title": "Drift Viewer: Load Dashboard Layout"
      }
    ],
    "menus": {
      "view/title": [{
        "command": "driftViewer.openDashboard",
        "when": "view == driftViewer.databaseExplorer && driftViewer.serverConnected",
        "group": "navigation"
      }]
    }
  }
}
```

## Wiring in extension.ts

```typescript
const dashboardState = new DashboardState(context.workspaceState);

context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.openDashboard', () => {
    const layout = dashboardState.load() ?? {
      version: 1,
      name: 'default',
      columns: 4,
      widgets: [],
    };
    DashboardPanel.createOrShow(context.extensionUri, client, layout, dashboardState);
  }),

  vscode.commands.registerCommand('driftViewer.saveDashboard', async () => {
    const name = await vscode.window.showInputBox({
      prompt: 'Dashboard name',
      value: 'default',
    });
    if (name && DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.saveAs(name);
    }
  }),

  vscode.commands.registerCommand('driftViewer.loadDashboard', async () => {
    const saved = dashboardState.listSaved();
    if (saved.length === 0) {
      vscode.window.showInformationMessage('No saved dashboards.');
      return;
    }
    const pick = await vscode.window.showQuickPick(saved);
    if (pick) {
      const layout = dashboardState.load(pick);
      if (layout) DashboardPanel.createOrShow(context.extensionUri, client, layout, dashboardState);
    }
  })
);

// Auto-refresh dashboard on generation change
watcher.onDidChange(async () => {
  if (DashboardPanel.currentPanel) {
    DashboardPanel.currentPanel.refreshAll();
  }
});
```

## Testing

- `dashboard-state.test.ts`:
  - Save and load round-trip
  - List saved dashboards
  - Missing dashboard returns undefined
  - Multiple dashboards with different names
- `widget-data-fetcher.test.ts`:
  - Each widget type fetches correct endpoint
  - Error in one widget doesn't block others
  - Result map has all widget IDs

## Known Limitations

- Grid layout is simple (CSS Grid) — no overlapping widgets or free-form positioning
- Drag-and-drop is swap-based, not true free-drag (simplicity tradeoff)
- No per-widget refresh intervals — all widgets refresh on generation change
- Chart rendering is basic inline SVG — no interactive tooltips or zoom
- Widget config UI is basic quick-picks — no visual config editor
- Dashboard names must be manually entered — no auto-naming
- Widget types that depend on other features (health score, invariants) require those features to be active
- No import/export of dashboard configurations (workspace state only)
- Maximum ~12 widgets before the panel becomes cluttered
- No responsive breakpoints — fixed 4-column grid regardless of panel width
