# Feature 38: Entity Relationship Diagram

## What It Does

Auto-generate an interactive ER diagram from the live schema. Tables render as boxes with column lists, FK relationships as connecting arrows. Drag to rearrange, zoom in/out, export as SVG or PNG. Updates automatically when the schema changes. A visual map of your entire database at a glance.

## User Experience

1. Command palette → "Saropa Drift Advisor: Show ER Diagram" or click the diagram icon in the tree view title bar
2. A webview panel opens with an interactive diagram:

```
╔══════════════════════════════════════════════════════════════════╗
║  ER DIAGRAM                    [Fit] [Zoom+] [Zoom-] [Export ▾] ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║    ┌──────────────┐         ┌──────────────────┐                ║
║    │ users        │         │ orders           │                ║
║    ├──────────────┤         ├──────────────────┤                ║
║    │ 🔑 id  INT   │◄────────│ 🔗 user_id  INT  │                ║
║    │    name TEXT  │         │ 🔑 id       INT  │                ║
║    │    email TEXT │         │    total    REAL │                ║
║    │    age   INT  │         │    status  TEXT  │                ║
║    └──────────────┘         └──────────────────┘                ║
║           ▲                         │                            ║
║           │                         │                            ║
║    ┌──────┴───────┐         ┌───────┴──────────┐                ║
║    │ sessions     │         │ order_items      │                ║
║    ├──────────────┤         ├──────────────────┤                ║
║    │ 🔑 id  INT   │         │ 🔑 id       INT  │                ║
║    │ 🔗 user INT  │         │ 🔗 order_id INT  │                ║
║    │    token TEXT │         │    product TEXT  │                ║
║    │    expires_at │         │    qty     INT   │                ║
║    └──────────────┘         └──────────────────┘                ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```

3. Drag tables to rearrange positions
4. Hover a relationship line to highlight both ends
5. Click a table to see row count and quick actions (View Data, Seed, Profile)
6. Export → SVG, PNG, or Mermaid markdown

### Layout Modes

| Mode | Description |
|------|-------------|
| Auto | Force-directed layout (default) |
| Hierarchical | Parent tables on top, children below |
| Clustered | Group tables with FK relationships together |

## New Files

```
extension/src/
  er-diagram/
    er-diagram-panel.ts        # Webview panel lifecycle + message handling
    er-diagram-html.ts         # HTML/CSS/JS with SVG rendering engine
    er-layout-engine.ts        # Force-directed and hierarchical layout algorithms
    er-diagram-types.ts        # Shared interfaces
    er-export.ts               # SVG/PNG/Mermaid export
extension/src/test/
  er-layout-engine.test.ts
  er-export.test.ts
```

## Dependencies

- `api-client.ts` — `schemaMetadata()`, `tableFkMeta()`
- `generation-watcher.ts` — auto-refresh on schema change

## Architecture

### Layout Engine

Computes node positions using a simple force-directed algorithm:

```typescript
interface IErNode {
  table: string;
  x: number;
  y: number;
  width: number;
  height: number;
  columns: IErColumn[];
  rowCount: number;
}

interface IErEdge {
  from: { table: string; column: string };
  to: { table: string; column: string };
}

interface IErColumn {
  name: string;
  type: string;
  pk: boolean;
  fk: boolean;
  nullable: boolean;
}

class ErLayoutEngine {
  layout(
    tables: TableMetadata[],
    fks: IFkContext[],
    mode: 'auto' | 'hierarchical' | 'clustered',
  ): { nodes: IErNode[]; edges: IErEdge[] } {
    const nodes = tables.map(t => this._createNode(t));
    const edges = fks.map(fk => ({
      from: { table: fk.fromTable, column: fk.fromColumn },
      to: { table: fk.toTable, column: fk.toColumn },
    }));

    switch (mode) {
      case 'auto':
        return { nodes: this._forceDirected(nodes, edges), edges };
      case 'hierarchical':
        return { nodes: this._hierarchical(nodes, edges), edges };
      case 'clustered':
        return { nodes: this._clustered(nodes, edges), edges };
    }
  }

  private _forceDirected(nodes: IErNode[], edges: IErEdge[]): IErNode[] {
    // Simple spring/repulsion simulation
    const ITERATIONS = 100;
    const REPULSION = 5000;
    const SPRING_LENGTH = 200;
    const SPRING_STRENGTH = 0.01;

    // Initialize with grid positions
    const cols = Math.ceil(Math.sqrt(nodes.length));
    nodes.forEach((n, i) => {
      n.x = (i % cols) * 300;
      n.y = Math.floor(i / cols) * 250;
    });

    for (let iter = 0; iter < ITERATIONS; iter++) {
      // Repulsion between all pairs
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const force = REPULSION / (dist * dist);
          nodes[i].x -= (dx / dist) * force;
          nodes[i].y -= (dy / dist) * force;
          nodes[j].x += (dx / dist) * force;
          nodes[j].y += (dy / dist) * force;
        }
      }

      // Spring attraction along edges
      for (const edge of edges) {
        const a = nodes.find(n => n.table === edge.from.table)!;
        const b = nodes.find(n => n.table === edge.to.table)!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const force = (dist - SPRING_LENGTH) * SPRING_STRENGTH;
        a.x += (dx / dist) * force;
        a.y += (dy / dist) * force;
        b.x -= (dx / dist) * force;
        b.y -= (dy / dist) * force;
      }
    }

    return nodes;
  }

  private _hierarchical(nodes: IErNode[], edges: IErEdge[]): IErNode[] {
    // Topological layers: root tables (no FK out) at top
    const depths = new Map<string, number>();
    // ... BFS from root tables, assign layer per depth
    // Position: x = index within layer * spacing, y = depth * layerHeight
    return nodes;
  }

  private _clustered(nodes: IErNode[], edges: IErEdge[]): IErNode[] {
    // Union-find to group connected components
    // Layout each cluster as a sub-graph, then arrange clusters
    return nodes;
  }
}
```

### SVG Renderer (in webview JS)

```typescript
function getErDiagramJs(): string {
  return `
    let nodes = [];
    let edges = [];
    let dragTarget = null;
    let offset = { x: 0, y: 0 };
    let zoom = 1;
    let pan = { x: 0, y: 0 };

    function renderDiagram() {
      const svg = document.getElementById('er-svg');
      svg.innerHTML = '';

      // Render edges first (behind nodes)
      for (const edge of edges) {
        const fromNode = nodes.find(n => n.table === edge.from.table);
        const toNode = nodes.find(n => n.table === edge.to.table);
        if (!fromNode || !toNode) continue;

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const fromY = fromNode.y + getColumnY(fromNode, edge.from.column);
        const toY = toNode.y + getColumnY(toNode, edge.to.column);
        const d = bezierPath(
          fromNode.x + fromNode.width, fromY,
          toNode.x, toY
        );
        line.setAttribute('d', d);
        line.setAttribute('class', 'er-edge');
        line.setAttribute('marker-end', 'url(#arrowhead)');
        svg.appendChild(line);
      }

      // Render nodes
      for (const node of nodes) {
        const g = renderTableNode(node);
        svg.appendChild(g);
      }
    }

    function renderTableNode(node) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('transform', 'translate(' + node.x + ',' + node.y + ')');
      g.setAttribute('class', 'er-node');
      g.dataset.table = node.table;

      // Background rect
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('width', String(node.width));
      rect.setAttribute('height', String(node.height));
      rect.setAttribute('rx', '6');
      g.appendChild(rect);

      // Header
      const header = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      header.setAttribute('x', '10');
      header.setAttribute('y', '22');
      header.setAttribute('class', 'er-table-name');
      header.textContent = node.table + ' (' + node.rowCount + ')';
      g.appendChild(header);

      // Columns
      node.columns.forEach((col, i) => {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', '10');
        text.setAttribute('y', String(44 + i * 20));
        text.setAttribute('class', 'er-column' + (col.pk ? ' pk' : '') + (col.fk ? ' fk' : ''));
        const icon = col.pk ? '🔑 ' : col.fk ? '🔗 ' : '   ';
        text.textContent = icon + col.name + '  ' + col.type;
        g.appendChild(text);
      });

      // Make draggable
      g.addEventListener('mousedown', (e) => {
        dragTarget = node;
        offset = { x: e.clientX - node.x, y: e.clientY - node.y };
      });

      return g;
    }
  `;
}
```

### Export

```typescript
class ErExport {
  toSvg(nodes: IErNode[], edges: IErEdge[]): string {
    // Serialize the SVG element to string
    // Include embedded styles for standalone viewing
    return svgString;
  }

  toPng(svgString: string, width: number, height: number): Buffer {
    // Render SVG to canvas, export as PNG
    // (Done in webview, sent back as base64)
    return pngBuffer;
  }

  toMermaid(nodes: IErNode[], edges: IErEdge[]): string {
    const lines = ['erDiagram'];
    for (const node of nodes) {
      lines.push(`    ${node.table} {`);
      for (const col of node.columns) {
        const key = col.pk ? 'PK' : col.fk ? 'FK' : '';
        lines.push(`        ${col.type} ${col.name} ${key}`.trimEnd());
      }
      lines.push('    }');
    }
    for (const edge of edges) {
      lines.push(`    ${edge.to.table} ||--o{ ${edge.from.table} : "${edge.from.column}"`);
    }
    return lines.join('\n');
  }
}
```

### Webview Message Protocol

Webview → Extension:
```typescript
{ command: 'nodesMoved', positions: { table: string; x: number; y: number }[] }
{ command: 'export', format: 'svg' | 'png' | 'mermaid' }
{ command: 'changeLayout', mode: 'auto' | 'hierarchical' | 'clustered' }
{ command: 'tableAction', table: string, action: 'viewData' | 'seed' | 'profile' }
```

Extension → Webview:
```typescript
{ command: 'init', nodes: IErNode[], edges: IErEdge[] }
{ command: 'update', nodes: IErNode[], edges: IErEdge[] }
{ command: 'exported', format: string, data: string }
```

## Server-Side Changes

None. Uses existing `schemaMetadata()` and `tableFkMeta()`.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.showErDiagram",
        "title": "Saropa Drift Advisor: Show ER Diagram",
        "icon": "$(type-hierarchy)"
      }
    ],
    "menus": {
      "view/title": [{
        "command": "driftViewer.showErDiagram",
        "when": "view == driftViewer.databaseExplorer && driftViewer.serverConnected",
        "group": "navigation"
      }]
    }
  }
}
```

## Wiring in extension.ts

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.showErDiagram', async () => {
    const meta = await client.schemaMetadata();
    const allFks: IFkContext[] = [];
    for (const table of meta.tables) {
      if (table.name.startsWith('sqlite_')) continue;
      const fks = await client.tableFkMeta(table.name);
      for (const fk of fks) {
        allFks.push({
          fromTable: table.name,
          fromColumn: fk.from,
          toTable: fk.table,
          toColumn: fk.to,
        });
      }
    }

    const engine = new ErLayoutEngine();
    const layout = engine.layout(meta.tables, allFks, 'auto');
    ErDiagramPanel.createOrShow(context.extensionUri, layout);
  })
);

watcher.onDidChange(async () => {
  if (ErDiagramPanel.currentPanel) {
    // Re-fetch and update
    ErDiagramPanel.currentPanel.refresh(client);
  }
});
```

## Testing

- `er-layout-engine.test.ts`:
  - Single table with no FKs → centered node
  - Two tables with FK → nodes positioned apart with edge
  - Hierarchical mode → parent above child
  - Clustered mode → connected tables grouped together
  - No overlapping nodes after layout
  - Empty schema → empty result
- `er-export.test.ts`:
  - SVG output is valid XML
  - Mermaid output has correct `erDiagram` syntax
  - All tables and relationships represented in exports
  - Column types and PK/FK markers present

## Known Limitations

- Force-directed layout is non-deterministic — positions vary on each render
- No support for self-referencing FKs (e.g., `parent_id` → same table)
- Large schemas (50+ tables) may produce cluttered diagrams
- PNG export requires webview (can't run headless)
- No persistent layout positions — rearrangements lost on panel close
- Column display truncated at 10 columns per table to avoid giant boxes
- No support for composite foreign keys
- Zoom/pan is mouse-only — no keyboard shortcuts
