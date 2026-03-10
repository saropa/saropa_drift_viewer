/**
 * HTML template for the Column Profiler webview panel.
 * Self-contained with inline CSS/JS. Uses VS Code theme variables.
 */

import type {
  IColumnProfile,
  IHistogramBucket,
  IPattern,
  IProfileAnomaly,
  ITopValue,
} from './profiler-types';

function esc(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmt(n: number, decimals = 1): string {
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(decimals);
}

function renderCard(label: string, value: string): string {
  return `<div class="card">
  <div class="card-value">${esc(value)}</div>
  <div class="card-label">${esc(label)}</div>
</div>`;
}

function renderSummary(p: IColumnProfile): string {
  const nullLabel = `${p.nullCount.toLocaleString()} (${fmt(p.nullPercentage)}%)`;
  return `<div class="summary">
  ${renderCard('Total Rows', p.totalRows.toLocaleString())}
  ${renderCard('Non-Null', p.nonNullCount.toLocaleString())}
  ${renderCard('Null', nullLabel)}
  ${renderCard('Distinct', p.distinctCount.toLocaleString())}
</div>`;
}

function renderNumericStats(p: IColumnProfile): string {
  if (p.min === undefined) return '';
  return `<h3>Numeric Statistics</h3>
<div class="stats-grid">
  <div><span class="stat-label">Min</span><span class="stat-value">${fmt(p.min)}</span></div>
  <div><span class="stat-label">Max</span><span class="stat-value">${fmt(p.max ?? 0)}</span></div>
  <div><span class="stat-label">Mean</span><span class="stat-value">${fmt(p.mean ?? 0)}</span></div>
  <div><span class="stat-label">Median</span><span class="stat-value">${p.median !== undefined ? fmt(p.median) : 'N/A'}</span></div>
  <div><span class="stat-label">Std Dev</span><span class="stat-value">${p.stdDev !== undefined ? fmt(p.stdDev, 2) : 'N/A'}</span></div>
</div>`;
}

function renderTextStats(p: IColumnProfile): string {
  if (p.minLength === undefined) return '';
  return `<h3>Text Statistics</h3>
<div class="stats-grid">
  <div><span class="stat-label">Min Length</span><span class="stat-value">${p.minLength}</span></div>
  <div><span class="stat-label">Max Length</span><span class="stat-value">${p.maxLength}</span></div>
  <div><span class="stat-label">Avg Length</span><span class="stat-value">${fmt(p.avgLength ?? 0, 1)}</span></div>
  <div><span class="stat-label">Empty Strings</span><span class="stat-value">${p.emptyCount}</span></div>
</div>`;
}

function renderHistogram(
  title: string,
  bins: IHistogramBucket[],
): string {
  if (bins.length === 0) return '';
  const maxCount = Math.max(...bins.map((b) => b.count));
  const rows = bins.map((bin) => {
    const w = maxCount > 0
      ? Math.max(2, Math.round((bin.count / maxCount) * 200))
      : 0;
    const label = bin.bucketMin === bin.bucketMax
      ? fmt(bin.bucketMin)
      : `${fmt(bin.bucketMin)}\u2013${fmt(bin.bucketMax)}`;
    return `<div class="hist-row">
  <span class="hist-label">${esc(label)}</span>
  <div class="hist-bar" style="width:${w}px"></div>
  <span class="hist-count">${bin.count.toLocaleString()} (${fmt(bin.percentage)}%)</span>
</div>`;
  }).join('\n');
  return `<h3>${esc(title)}</h3>\n<div class="histogram">${rows}</div>`;
}

function renderTopValues(values: ITopValue[]): string {
  if (values.length === 0) return '';
  const rows = values.map((v, i) =>
    `<tr>
  <td class="num">${i + 1}</td>
  <td>${esc(v.value)}</td>
  <td class="num">${v.count.toLocaleString()}</td>
  <td class="num">${fmt(v.percentage)}%</td>
</tr>`,
  ).join('\n');
  return `<h3>Top Values</h3>
<table><thead><tr><th>#</th><th>Value</th><th>Count</th><th>%</th></tr></thead>
<tbody>${rows}</tbody></table>`;
}

function renderPatterns(patterns: IPattern[]): string {
  if (patterns.length === 0) return '';
  const rows = patterns.map((p) =>
    `<tr>
  <td>${esc(p.pattern)}</td>
  <td class="num">${p.count.toLocaleString()}</td>
  <td class="num">${fmt(p.percentage)}%</td>
</tr>`,
  ).join('\n');
  return `<h3>Pattern Breakdown</h3>
<table><thead><tr><th>Pattern</th><th>Count</th><th>%</th></tr></thead>
<tbody>${rows}</tbody></table>`;
}

function renderAnomalies(anomalies: IProfileAnomaly[]): string {
  if (anomalies.length === 0) return '';
  const items = anomalies.map((a) => {
    const cls = a.severity === 'warning' ? 'alert-warn' : 'alert-info';
    const icon = a.severity === 'warning' ? '\u26a0' : '\u2139';
    return `<div class="alert ${cls}">${icon} ${esc(a.message)}</div>`;
  }).join('\n');
  return `<h3>Anomalies</h3>\n${items}`;
}

/** Build complete HTML for the column profiler webview. */
export function buildProfilerHtml(profile: IColumnProfile): string {
  const typeLabel = profile.isNumeric ? 'Numeric' : 'Text';
  const heading = `${esc(profile.table)}.${esc(profile.column)}`
    + ` <span class="type-badge">${esc(profile.type)} (${typeLabel})</span>`;

  let body = `<h2>${heading}</h2>\n`;
  body += `<div class="toolbar">
  <button class="copy-btn" data-action="copyJson">Copy as JSON</button>
</div>\n`;
  body += renderSummary(profile);

  if (profile.isNumeric) {
    body += renderNumericStats(profile);
    body += renderHistogram('Value Distribution', profile.histogram ?? []);
  } else {
    body += renderTextStats(profile);
    body += renderHistogram(
      'Length Distribution', profile.lengthHistogram ?? [],
    );
    body += renderPatterns(profile.patterns ?? []);
  }

  body += renderTopValues(profile.topValues);
  body += renderAnomalies(profile.anomalies);

  return wrapHtml(body);
}

function wrapHtml(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { font-family: var(--vscode-font-family, sans-serif);
    color: var(--vscode-editor-foreground, #ccc);
    background: var(--vscode-editor-background, #1e1e1e); padding: 16px; line-height: 1.4; }
  h2 { margin-top: 0; }
  h3 { margin-top: 20px; margin-bottom: 8px; }
  .type-badge { font-size: 12px; opacity: 0.6; font-weight: normal; }
  .toolbar { margin-bottom: 12px; }
  .copy-btn { background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff); border: none;
    padding: 4px 10px; border-radius: 3px; cursor: pointer; font-size: 12px; }
  .copy-btn:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 10px; margin-bottom: 16px; }
  .card { padding: 10px; border: 1px solid var(--vscode-widget-border, #444);
    border-radius: 6px; text-align: center; }
  .card-value { font-size: 18px; font-weight: bold; }
  .card-label { font-size: 11px; opacity: 0.7; margin-top: 2px; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 8px; }
  .stats-grid > div { padding: 6px 10px;
    background: var(--vscode-editor-inactiveSelectionBackground, #333); border-radius: 4px; }
  .stat-label { font-size: 11px; opacity: 0.7; display: block; }
  .stat-value { font-size: 15px; font-weight: 600;
    font-variant-numeric: tabular-nums; }
  .histogram { margin-bottom: 12px; }
  .hist-row { display: flex; align-items: center; margin: 3px 0; }
  .hist-label { width: 80px; font-size: 12px; text-align: right;
    margin-right: 8px; flex-shrink: 0;
    font-variant-numeric: tabular-nums; }
  .hist-bar { height: 16px; background: var(--vscode-charts-blue, #1f77b4);
    border-radius: 2px; margin-right: 8px; flex-shrink: 0; }
  .hist-count { font-size: 12px; opacity: 0.7;
    font-variant-numeric: tabular-nums; white-space: nowrap; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th, td { text-align: left; padding: 5px 10px;
    border-bottom: 1px solid var(--vscode-widget-border, #444); }
  th { font-size: 11px; opacity: 0.7; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .alert { padding: 8px 12px; border-radius: 4px; margin: 6px 0; font-size: 13px; }
  .alert-warn { background: rgba(224,168,0,0.12);
    border-left: 4px solid #e0a800; }
  .alert-info { background: rgba(30,136,229,0.12);
    border-left: 4px solid #1e88e5; }
</style>
</head>
<body>
${body}
<script>
  const vscode = acquireVsCodeApi();
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    vscode.postMessage({ command: btn.dataset.action });
  });
</script>
</body>
</html>`;
}
