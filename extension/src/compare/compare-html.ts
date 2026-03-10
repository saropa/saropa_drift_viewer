import type { ICompareReport } from '../api-types';

/** Build the HTML for the database comparison webview panel. */
export function buildCompareHtml(report: ICompareReport): string {
  const schemaBadge = report.schemaSame
    ? '<span class="badge ok">Schema Match</span>'
    : '<span class="badge warn">Schema Differs</span>';

  const schemaDiffBlock = report.schemaDiff
    ? `<details class="schema-diff">
        <summary>Schema Diff</summary>
        <div class="diff-pair">
          <div><h4>Database A</h4><pre>${esc(report.schemaDiff.a)}</pre></div>
          <div><h4>Database B</h4><pre>${esc(report.schemaDiff.b)}</pre></div>
        </div>
       </details>`
    : '';

  const onlyInA = report.tablesOnlyInA.length > 0
    ? `<section><h3>Only in A (${report.tablesOnlyInA.length})</h3>
       <ul>${report.tablesOnlyInA.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>`
    : '';

  const onlyInB = report.tablesOnlyInB.length > 0
    ? `<section><h3>Only in B (${report.tablesOnlyInB.length})</h3>
       <ul>${report.tablesOnlyInB.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>`
    : '';

  const rows = report.tableCounts
    .filter((t) => !t.onlyInA && !t.onlyInB)
    .map((t) => {
      const cls = t.diff > 0 ? 'pos' : t.diff < 0 ? 'neg' : '';
      const sign = t.diff > 0 ? '+' : '';
      return `<tr>
        <td>${esc(t.table)}</td>
        <td class="num">${t.countA}</td>
        <td class="num">${t.countB}</td>
        <td class="num ${cls}">${sign}${t.diff}</td>
      </tr>`;
    })
    .join('');

  const countTable = rows
    ? `<table>
        <thead><tr><th>Table</th><th>A</th><th>B</th><th>Diff</th></tr></thead>
        <tbody>${rows}</tbody>
       </table>`
    : '<p>No shared tables to compare.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         background: var(--vscode-editor-background); padding: 16px; }
  .badge { padding: 4px 10px; border-radius: 4px; font-weight: bold; }
  .ok { background: var(--vscode-testing-iconPassed); color: #fff; }
  .warn { background: var(--vscode-testing-iconFailed); color: #fff; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { text-align: left; padding: 6px 10px;
           border-bottom: 1px solid var(--vscode-widget-border); }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .pos { color: var(--vscode-testing-iconFailed); }
  .neg { color: var(--vscode-charts-blue); }
  .schema-diff { margin-top: 12px; }
  .diff-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  pre { white-space: pre-wrap; font-size: 12px;
        background: var(--vscode-textCodeBlock-background); padding: 8px; }
  h3 { margin-top: 16px; }
  ul { margin: 4px 0; }
  .footer { margin-top: 16px; font-size: 11px; opacity: 0.7; }
  button { cursor: pointer; padding: 4px 10px; margin-top: 8px; }
</style>
</head>
<body>
  <h2>Database Comparison ${schemaBadge}</h2>
  ${schemaDiffBlock}
  ${onlyInA}
  ${onlyInB}
  <h3>Row Counts</h3>
  ${countTable}
  <div class="footer">Generated ${esc(report.generatedAt)}</div>
  <button onclick="post('copyReport')">Copy as JSON</button>
  <script>
    const vscode = acquireVsCodeApi();
    function post(cmd) { vscode.postMessage({ command: cmd }); }
  </script>
</body>
</html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
