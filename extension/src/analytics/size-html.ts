import type { ISizeAnalytics } from '../api-types';

/** Build the HTML for the size analytics webview panel. */
export function buildSizeHtml(data: ISizeAnalytics): string {
  const used = formatBytes(data.usedSizeBytes);
  const free = formatBytes(data.freeSpaceBytes);
  const total = formatBytes(data.totalSizeBytes);
  const pct = data.totalSizeBytes > 0
    ? Math.round((data.usedSizeBytes / data.totalSizeBytes) * 100)
    : 0;

  const maxRows = Math.max(...data.tables.map((t) => t.rowCount), 1);
  const tableRows = data.tables.map((t) => {
    const barW = Math.max(1, Math.round((t.rowCount / maxRows) * 100));
    const idxList = t.indexes.length > 0
      ? t.indexes.map((i) => esc(i)).join(', ')
      : '<span class="dim">none</span>';
    return `<tr>
      <td>${esc(t.table)}</td>
      <td class="num">${t.rowCount.toLocaleString()}</td>
      <td class="num">${t.columnCount}</td>
      <td class="num">${t.indexCount}</td>
      <td class="bar-cell"><div class="bar" style="width:${barW}%"></div></td>
      <td class="idx">${idxList}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         background: var(--vscode-editor-background); padding: 16px; }
  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
             gap: 12px; margin-bottom: 20px; }
  .card { padding: 12px; border: 1px solid var(--vscode-widget-border);
          border-radius: 6px; text-align: center; }
  .card-value { font-size: 20px; font-weight: bold; }
  .card-label { font-size: 11px; opacity: 0.7; margin-top: 4px; }
  .usage-bar { height: 8px; background: var(--vscode-input-background);
               border-radius: 4px; overflow: hidden; margin-top: 8px; }
  .usage-fill { height: 100%; background: var(--vscode-charts-blue);
                border-radius: 4px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 10px;
           border-bottom: 1px solid var(--vscode-widget-border); }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .bar-cell { width: 120px; }
  .bar { height: 12px; background: var(--vscode-charts-blue); border-radius: 2px; }
  .idx { font-size: 11px; opacity: 0.7; max-width: 200px;
         overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dim { opacity: 0.5; }
  h2 { margin-top: 0; }
  button { cursor: pointer; padding: 4px 10px; margin-top: 12px; }
</style>
</head>
<body>
  <h2>Database Size Analytics</h2>
  <div class="summary">
    <div class="card">
      <div class="card-value">${total}</div>
      <div class="card-label">Total Size</div>
      <div class="usage-bar"><div class="usage-fill" style="width:${pct}%"></div></div>
    </div>
    <div class="card">
      <div class="card-value">${used}</div>
      <div class="card-label">Used</div>
    </div>
    <div class="card">
      <div class="card-value">${free}</div>
      <div class="card-label">Free</div>
    </div>
    <div class="card">
      <div class="card-value">${data.tableCount}</div>
      <div class="card-label">Tables</div>
    </div>
    <div class="card">
      <div class="card-value">${data.pageCount.toLocaleString()}</div>
      <div class="card-label">Pages (${formatBytes(data.pageSize)} each)</div>
    </div>
    <div class="card">
      <div class="card-value">${esc(data.journalMode)}</div>
      <div class="card-label">Journal Mode</div>
    </div>
  </div>

  <h3>Tables by Row Count</h3>
  <table>
    <thead><tr>
      <th>Table</th><th>Rows</th><th>Cols</th>
      <th>Indexes</th><th></th><th>Index Names</th>
    </tr></thead>
    <tbody>${tableRows}</tbody>
  </table>

  <button onclick="post('copyReport')">Copy as JSON</button>
  <script>
    const vscode = acquireVsCodeApi();
    function post(cmd) { vscode.postMessage({ command: cmd }); }
  </script>
</body>
</html>`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
