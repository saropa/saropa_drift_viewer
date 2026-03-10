import type { IDiagramData, IDiagramTable } from '../api-types';

const BOX_W = 220;
const BOX_GAP = 40;
const COLS = 3;

/** Build HTML for the schema diagram webview panel. */
export function buildDiagramHtml(data: IDiagramData): string {
  if (data.tables.length === 0) {
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<style>body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
  background: var(--vscode-editor-background); }
.empty { padding: 32px; text-align: center; opacity: 0.6; }</style>
</head><body><div class="empty">No tables found.</div></body></html>`;
  }

  const positions = layoutTables(data.tables);
  const boxes = data.tables.map((t, i) => buildTableBox(t, positions[i]));
  const lines = data.foreignKeys.map((fk) => {
    const fromIdx = data.tables.findIndex((t) => t.name === fk.fromTable);
    const toIdx = data.tables.findIndex((t) => t.name === fk.toTable);
    if (fromIdx < 0 || toIdx < 0) return '';
    return buildFkLine(positions[fromIdx], positions[toIdx]);
  });

  const maxX = Math.max(...positions.map((p) => p.x)) + BOX_W + BOX_GAP;
  const maxY = Math.max(...positions.map((p) => p.y + p.h)) + BOX_GAP;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         background: var(--vscode-editor-background); margin: 0; overflow: auto; }
  .canvas { position: relative; min-width: ${maxX}px; min-height: ${maxY}px; }
  .tbl { position: absolute; width: ${BOX_W}px;
         border: 1px solid var(--vscode-widget-border);
         border-radius: 4px; background: var(--vscode-editor-background); }
  .tbl-header { padding: 6px 10px; font-weight: bold; font-size: 13px;
                background: var(--vscode-sideBarSectionHeader-background);
                border-bottom: 1px solid var(--vscode-widget-border);
                border-radius: 4px 4px 0 0; cursor: pointer; }
  .tbl-cols { padding: 4px 0; font-size: 12px; }
  .col-row { display: flex; padding: 2px 10px; gap: 6px; }
  .col-name { flex: 1; }
  .col-type { opacity: 0.6; }
  .pk { font-weight: bold; }
  svg { position: absolute; top: 0; left: 0; pointer-events: none; }
  line { stroke: var(--vscode-charts-blue); stroke-width: 1.5; }
</style>
</head>
<body>
<div class="canvas">
  <svg width="${maxX}" height="${maxY}">${lines.join('')}</svg>
  ${boxes.join('\n')}
</div>
<script>
  const vscode = acquireVsCodeApi();
  document.querySelectorAll('.tbl-header').forEach(el => {
    el.addEventListener('click', () => {
      vscode.postMessage({ command: 'copyTableName', name: el.textContent });
    });
  });
</script>
</body>
</html>`;
}

interface Pos { x: number; y: number; h: number }

function layoutTables(tables: IDiagramTable[]): Pos[] {
  const positions: Pos[] = [];
  let col = 0;
  let row = 0;
  const rowHeights: number[] = [];

  for (const t of tables) {
    const h = 30 + t.columns.length * 24 + 8;
    const x = col * (BOX_W + BOX_GAP) + BOX_GAP;
    const rowY = rowHeights.slice(0, row).reduce((a, b) => a + b, 0);
    const y = rowY + row * BOX_GAP + BOX_GAP;
    positions.push({ x, y, h });

    if (!rowHeights[row] || h > rowHeights[row]) {
      rowHeights[row] = h;
    }
    col++;
    if (col >= COLS) {
      col = 0;
      row++;
    }
  }
  return positions;
}

function buildTableBox(t: IDiagramTable, pos: Pos): string {
  const cols = t.columns.map((c) => {
    const pkCls = c.pk ? ' pk' : '';
    return `<div class="col-row">
      <span class="col-name${pkCls}">${esc(c.name)}${c.pk ? ' \u{1F511}' : ''}</span>
      <span class="col-type">${esc(c.type)}</span>
    </div>`;
  }).join('');

  return `<div class="tbl" style="left:${pos.x}px;top:${pos.y}px">
    <div class="tbl-header">${esc(t.name)}</div>
    <div class="tbl-cols">${cols}</div>
  </div>`;
}

function buildFkLine(from: Pos, to: Pos): string {
  const x1 = from.x + BOX_W;
  const y1 = from.y + from.h / 2;
  const x2 = to.x;
  const y2 = to.y + to.h / 2;
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
