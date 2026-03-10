/**
 * HTML template for the Data Sampling Explorer webview panel.
 * Uses VS Code theme CSS variables for light/dark support.
 */

import type { ColumnMetadata } from '../api-types';
import type { ISamplingResult } from './sampling-types';

function esc(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderColumnOptions(columns: ColumnMetadata[]): string {
  return columns
    .map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`)
    .join('\n');
}

function renderResultTable(result: ISamplingResult): string {
  if (result.rows.length === 0) {
    return '<div class="empty">No rows returned.</div>';
  }

  const pct = result.totalRows > 0
    ? ((result.sampledRows / result.totalRows) * 100).toFixed(1)
    : '0';

  let html = `<div class="summary">${result.sampledRows} rows`
    + ` (${pct}% of ${result.totalRows}) in ${result.durationMs}ms</div>`;

  if (result.stats && result.stats.length > 0) {
    html += renderCohortTable(result);
  } else {
    html += renderDataTable(result);
  }

  html += `<div class="toolbar">
    <button class="btn" data-action="exportCsv">Export CSV</button>
    <button class="btn" data-action="copySql">Copy SQL</button>
  </div>`;

  return html;
}

function renderDataTable(result: ISamplingResult): string {
  const cols = result.columns;
  const header = cols.map((c) => `<th>${esc(c)}</th>`).join('');

  const bodyRows = result.rows.slice(0, 200).map((row) => {
    const cells = cols.map((c) => `<td>${esc(row[c])}</td>`).join('');
    return `<tr>${cells}</tr>`;
  }).join('\n');

  let html = `<div class="table-scroll">
    <table><thead><tr>${header}</tr></thead>
    <tbody>${bodyRows}</tbody></table></div>`;

  if (result.rows.length > 200) {
    html += `<div class="truncated">Showing 200 of ${result.rows.length}`
      + ` rows. Export CSV for full data.</div>`;
  }

  return html;
}

function renderCohortTable(result: ISamplingResult): string {
  const stats = result.stats!;
  const hasNumeric = stats.some((s) => s.numericStats !== undefined);
  const numCol = hasNumeric ? stats.find((s) => s.numericStats)!
    .numericStats!.column : '';

  let header = '<th>Cohort</th><th>Count</th><th>%</th>';
  if (hasNumeric) {
    header += `<th>Avg ${esc(numCol)}</th>`
      + `<th>Min ${esc(numCol)}</th><th>Max ${esc(numCol)}</th>`;
  }

  const bodyRows = stats.map((s) => {
    let cells = `<td>${esc(s.cohortValue)}</td>`
      + `<td class="num">${s.count.toLocaleString()}</td>`
      + `<td class="num">${s.percentage.toFixed(1)}%</td>`;
    if (hasNumeric && s.numericStats) {
      cells += `<td class="num">${fmtNum(s.numericStats.avg)}</td>`
        + `<td class="num">${fmtNum(s.numericStats.min)}</td>`
        + `<td class="num">${fmtNum(s.numericStats.max)}</td>`;
    } else if (hasNumeric) {
      cells += '<td></td><td></td><td></td>';
    }
    return `<tr>${cells}</tr>`;
  }).join('\n');

  return `<div class="table-scroll">
    <table><thead><tr>${header}</tr></thead>
    <tbody>${bodyRows}</tbody></table></div>`;
}

function fmtNum(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return Number.isInteger(value)
    ? value.toLocaleString()
    : value.toFixed(2);
}

/** Build the complete HTML for the sampling panel. */
export function buildSamplingHtml(
  table: string,
  columns: ColumnMetadata[],
  totalRows: number,
  result?: ISamplingResult,
  searching?: boolean,
): string {
  const colOpts = renderColumnOptions(columns);

  const resultsHtml = searching
    ? '<div class="searching">Sampling\u2026</div>'
    : result ? renderResultTable(result) : '';

  const body = `
<h2>Data Sampling \u2014 ${esc(table)}
  <span class="badge">${totalRows.toLocaleString()} rows</span></h2>
<div class="sample-form">
  <div class="options-row">
    <label>Mode:</label>
    <label><input type="radio" name="mode" value="random" checked />
      Random</label>
    <label><input type="radio" name="mode" value="stratified" />
      Stratified</label>
    <label><input type="radio" name="mode" value="percentile" />
      Percentile</label>
    <label><input type="radio" name="mode" value="cohort" />
      Cohort</label>
  </div>
  <div class="options-row">
    <label>Size:</label>
    <input id="sampleSize" type="number" value="50" min="1" max="10000" />
  </div>
  <div class="options-row mode-opt" data-modes="stratified">
    <label>Group by:</label>
    <select id="stratifyCol">${colOpts}</select>
  </div>
  <div class="options-row mode-opt" data-modes="percentile">
    <label>Column:</label>
    <select id="percentileCol">${colOpts}</select>
    <label>Range:</label>
    <input id="pMin" type="number" value="90" min="0" max="100" />
    <span>\u2013</span>
    <input id="pMax" type="number" value="100" min="0" max="100" />
  </div>
  <div class="options-row mode-opt" data-modes="cohort">
    <label>Column:</label>
    <select id="cohortCol">${colOpts}</select>
  </div>
  <button class="btn primary" data-action="sample">Sample</button>
</div>
<div id="results">${resultsHtml}</div>`;

  return wrapHtml(body, table);
}

function wrapHtml(body: string, table: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body {
    font-family: var(--vscode-font-family, sans-serif);
    color: var(--vscode-editor-foreground, #ccc);
    background: var(--vscode-editor-background, #1e1e1e);
    padding: 16px;
    line-height: 1.4;
  }
  h2 { margin-top: 0; display: flex; align-items: center; gap: 8px; }
  .badge {
    display: inline-block; padding: 1px 7px; border-radius: 10px;
    font-size: 11px; font-weight: 600;
    background: var(--vscode-badge-background, #4d4d4d);
    color: var(--vscode-badge-foreground, #fff);
  }
  .sample-form { margin-bottom: 16px; }
  .options-row {
    display: flex; gap: 8px; align-items: center;
    margin-bottom: 6px; font-size: 13px;
  }
  .options-row > label:first-child { font-weight: 600; min-width: 60px; }
  .mode-opt { display: none; } .mode-opt.visible { display: flex; }
  input[type="number"], select {
    padding: 4px 6px;
    background: var(--vscode-input-background, #333);
    color: var(--vscode-input-foreground, #ccc);
    border: 1px solid var(--vscode-input-border, #555);
    border-radius: 3px;
  }
  input[type="number"] { width: 70px; }
  .btn {
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #ccc);
    border: none; padding: 4px 12px; border-radius: 3px;
    cursor: pointer; font-size: 12px; margin-right: 6px;
  }
  .btn:hover { background: var(--vscode-button-secondaryHoverBackground, #505357); }
  .btn.primary {
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff); margin-top: 8px;
  }
  .btn.primary:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
  .summary { margin-bottom: 8px; font-size: 13px; opacity: 0.8; }
  .empty, .searching { padding: 20px; text-align: center; opacity: 0.6; }
  .searching { font-style: italic; }
  .toolbar { margin-top: 8px; }
  .truncated { font-size: 12px; opacity: 0.6; margin-top: 4px; }
  .table-scroll { overflow-x: auto; }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    font-family: var(--vscode-editor-font-family, monospace);
  }
  th {
    text-align: left;
    padding: 6px 8px;
    background: var(--vscode-editor-inactiveSelectionBackground, #333);
    border-bottom: 1px solid var(--vscode-panel-border, #444);
    white-space: nowrap;
  }
  td {
    padding: 4px 8px;
    border-bottom: 1px solid var(--vscode-panel-border, #333);
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  td.num { text-align: right; }
  tr:hover { background: var(--vscode-list-hoverBackground, #2a2d2e); }
</style>
</head>
<body>
${body}
<script>
  const vscode = acquireVsCodeApi();
  const table = ${JSON.stringify(table)};

  function updateModeVisibility() {
    const mode = document.querySelector('input[name="mode"]:checked').value;
    document.querySelectorAll('.mode-opt').forEach(el => {
      const modes = el.dataset.modes.split(',');
      el.classList.toggle('visible', modes.includes(mode));
    });
  }
  updateModeVisibility();

  document.querySelectorAll('input[name="mode"]').forEach(r => {
    r.addEventListener('change', updateModeVisibility);
  });

  function buildConfig() {
    const mode = document.querySelector('input[name="mode"]:checked').value;
    const sampleSize = parseInt(document.getElementById('sampleSize').value, 10) || 50;
    const config = { table, mode, sampleSize };

    if (mode === 'stratified') {
      config.stratifyColumn = document.getElementById('stratifyCol').value;
    } else if (mode === 'percentile') {
      config.percentileColumn = document.getElementById('percentileCol').value;
      config.percentileMin = parseInt(document.getElementById('pMin').value, 10) || 0;
      config.percentileMax = parseInt(document.getElementById('pMax').value, 10) || 100;
    } else if (mode === 'cohort') {
      config.cohortColumn = document.getElementById('cohortCol').value;
    }

    return config;
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'sample') {
      vscode.postMessage({ command: 'sample', config: buildConfig() });
    } else if (action === 'copySql') {
      vscode.postMessage({ command: 'copySql' });
    } else if (action === 'exportCsv') {
      vscode.postMessage({ command: 'exportCsv' });
    }
  });
</script>
</body>
</html>`;
}
