/**
 * HTML template builder for the Data Invariants webview panel.
 */

import type { IInvariant, IInvariantSummary } from './invariant-types';

/** Build the complete HTML for the invariant manager panel. */
export function buildInvariantHtml(
  invariants: readonly IInvariant[],
  summary: IInvariantSummary,
): string {
  if (invariants.length === 0) {
    return buildEmptyHtml();
  }

  const cards = invariants.map((inv) => buildInvariantCard(inv)).join('\n');
  const statusClass = getStatusClass(summary);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
${getStyles()}
</style>
</head>
<body>
<div class="header">
  <h1>Data Invariants</h1>
  <div class="btn-group">
    <button class="btn" data-action="addRule">+ Add Rule</button>
    <button class="btn primary" data-action="runAll">Run All</button>
  </div>
</div>

<div class="summary ${statusClass}">
  <div class="summary-stat">
    <span class="summary-value">${summary.passingCount}</span>
    <span class="summary-label">Passing</span>
  </div>
  <div class="summary-stat">
    <span class="summary-value">${summary.failingCount}</span>
    <span class="summary-label">Failing</span>
  </div>
  <div class="summary-stat">
    <span class="summary-value">${summary.totalEnabled}</span>
    <span class="summary-label">Total</span>
  </div>
  ${summary.lastCheckTime ? `
  <div class="summary-stat">
    <span class="summary-value">${formatTime(summary.lastCheckTime)}</span>
    <span class="summary-label">Last Check</span>
  </div>
  ` : ''}
</div>

<div class="cards">
  ${cards}
</div>

<script>
${getScript()}
</script>
</body>
</html>`;
}

function buildEmptyHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
${getStyles()}
</style>
</head>
<body>
<div class="header">
  <h1>Data Invariants</h1>
  <div class="btn-group">
    <button class="btn primary" data-action="addRule">+ Add Rule</button>
  </div>
</div>
<div class="empty">
  <div class="empty-icon">$(shield)</div>
  <h2>No invariants defined</h2>
  <p>Data invariants help ensure your database maintains consistency.</p>
  <p>Click "Add Rule" to create your first invariant check.</p>
</div>
<script>
${getScript()}
</script>
</body>
</html>`;
}

function buildInvariantCard(inv: IInvariant): string {
  const status = getInvariantStatus(inv);
  const statusIcon = getStatusIcon(status);
  const statusClass = status;
  const result = inv.lastResult;

  let resultInfo = '';
  if (result) {
    if (result.error) {
      resultInfo = `<div class="result error">Error: ${esc(result.error)}</div>`;
    } else if (result.passed) {
      resultInfo = `<div class="result pass">PASS — checked ${formatTime(result.checkedAt)} (${result.durationMs}ms)</div>`;
    } else {
      const rowText = result.violationCount === 1 ? '1 row' : `${result.violationCount} rows`;
      resultInfo = `<div class="result fail">FAIL (${rowText}) — checked ${formatTime(result.checkedAt)}</div>`;

      if (result.violatingRows.length > 0) {
        const preview = result.violatingRows
          .slice(0, 3)
          .map((row) => {
            const vals = Object.entries(row)
              .slice(0, 3)
              .map(([k, v]) => `${k}: ${formatValue(v)}`)
              .join(', ');
            return vals;
          })
          .join(' | ');
        resultInfo += `<div class="violations">→ ${esc(preview)}${result.violationCount > 3 ? '...' : ''}</div>`;
      }
    }
  }

  return `
<div class="card ${statusClass}" data-id="${esc(inv.id)}">
  <div class="card-header">
    <span class="status-icon">${statusIcon}</span>
    <span class="card-title">${esc(inv.name)}</span>
    <span class="card-table">${esc(inv.table)}</span>
    <span class="card-severity severity-${inv.severity}">${inv.severity}</span>
    <div class="card-actions">
      <button class="icon-btn" data-action="toggle" title="${inv.enabled ? 'Disable' : 'Enable'}">
        ${inv.enabled ? '$(eye)' : '$(eye-closed)'}
      </button>
      <button class="icon-btn" data-action="runOne" title="Run Check">$(play)</button>
      <button class="icon-btn" data-action="edit" title="Edit">$(edit)</button>
      <button class="icon-btn danger" data-action="remove" title="Remove">$(trash)</button>
    </div>
  </div>
  <div class="card-sql">
    <code>${esc(inv.sql)}</code>
  </div>
  <div class="card-expectation">
    Expect: ${inv.expectation === 'zero_rows' ? '0 rows (no violations)' : 'At least 1 row'}
  </div>
  ${resultInfo}
  ${!result && inv.enabled ? '<div class="result pending">Not yet checked</div>' : ''}
  ${!inv.enabled ? '<div class="result disabled">Disabled</div>' : ''}
</div>`;
}

function getInvariantStatus(inv: IInvariant): 'pass' | 'fail' | 'error' | 'pending' | 'disabled' {
  if (!inv.enabled) return 'disabled';
  if (!inv.lastResult) return 'pending';
  if (inv.lastResult.error) return 'error';
  return inv.lastResult.passed ? 'pass' : 'fail';
}

function getStatusIcon(status: string): string {
  switch (status) {
    case 'pass': return '✅';
    case 'fail': return '❌';
    case 'error': return '⚠️';
    case 'disabled': return '⏸';
    default: return '⏳';
  }
}

function getStatusClass(summary: IInvariantSummary): string {
  if (summary.totalEnabled === 0) return 'status-empty';
  if (summary.failingCount > 0) return 'status-fail';
  if (summary.passingCount === summary.totalEnabled) return 'status-pass';
  return 'status-pending';
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

function formatValue(value: unknown): string {
  if (value === null) return 'NULL';
  if (typeof value === 'string') return `"${value.slice(0, 20)}${value.length > 20 ? '...' : ''}"`;
  return String(value);
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getStyles(): string {
  return `
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    margin: 0;
    padding: 16px;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  .header h1 {
    margin: 0;
    font-size: 18px;
  }
  .btn-group {
    display: flex;
    gap: 8px;
  }
  .btn {
    padding: 6px 12px;
    border: 1px solid var(--vscode-button-border, var(--vscode-widget-border));
    background: var(--vscode-button-secondaryBackground, var(--vscode-editor-background));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
  }
  .btn:hover {
    background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground));
  }
  .btn.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-color: var(--vscode-button-background);
  }
  .btn.primary:hover {
    opacity: 0.9;
  }
  .summary {
    display: flex;
    gap: 24px;
    padding: 12px 16px;
    border-radius: 4px;
    margin-bottom: 16px;
    background: var(--vscode-editor-inactiveSelectionBackground);
  }
  .summary.status-pass { border-left: 3px solid #22c55e; }
  .summary.status-fail { border-left: 3px solid #ef4444; }
  .summary.status-pending { border-left: 3px solid #eab308; }
  .summary-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .summary-value {
    font-size: 20px;
    font-weight: bold;
  }
  .summary-label {
    font-size: 11px;
    opacity: 0.7;
    text-transform: uppercase;
  }
  .empty {
    text-align: center;
    padding: 48px 24px;
    opacity: 0.8;
  }
  .empty-icon {
    font-size: 48px;
    margin-bottom: 16px;
  }
  .empty h2 {
    margin: 0 0 8px 0;
    font-size: 16px;
  }
  .empty p {
    margin: 4px 0;
    font-size: 13px;
  }
  .cards {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .card {
    border: 1px solid var(--vscode-widget-border);
    border-radius: 4px;
    padding: 12px;
    background: var(--vscode-editor-background);
  }
  .card.pass { border-left: 3px solid #22c55e; }
  .card.fail { border-left: 3px solid #ef4444; }
  .card.error { border-left: 3px solid #f97316; }
  .card.pending { border-left: 3px solid #eab308; }
  .card.disabled { opacity: 0.5; }
  .card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .status-icon {
    font-size: 14px;
  }
  .card-title {
    font-weight: 600;
    flex: 1;
  }
  .card-table {
    font-size: 11px;
    padding: 2px 6px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    border-radius: 3px;
  }
  .card-severity {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 3px;
    text-transform: uppercase;
  }
  .severity-error { background: #ef4444; color: white; }
  .severity-warning { background: #eab308; color: black; }
  .severity-info { background: #3b82f6; color: white; }
  .card-actions {
    display: flex;
    gap: 4px;
  }
  .icon-btn {
    padding: 4px 6px;
    border: none;
    background: transparent;
    color: var(--vscode-foreground);
    cursor: pointer;
    border-radius: 3px;
    font-size: 12px;
  }
  .icon-btn:hover {
    background: var(--vscode-list-hoverBackground);
  }
  .icon-btn.danger:hover {
    background: #ef4444;
    color: white;
  }
  .card-sql {
    background: var(--vscode-textBlockQuote-background);
    padding: 8px;
    border-radius: 3px;
    margin-bottom: 8px;
    overflow-x: auto;
  }
  .card-sql code {
    font-family: var(--vscode-editor-font-family);
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .card-expectation {
    font-size: 11px;
    opacity: 0.7;
    margin-bottom: 8px;
  }
  .result {
    font-size: 12px;
    padding: 4px 8px;
    border-radius: 3px;
  }
  .result.pass { color: #22c55e; }
  .result.fail { color: #ef4444; }
  .result.error { color: #f97316; }
  .result.pending { color: #eab308; }
  .result.disabled { color: var(--vscode-disabledForeground); }
  .violations {
    font-size: 11px;
    opacity: 0.8;
    margin-top: 4px;
    padding-left: 8px;
    border-left: 2px solid #ef4444;
  }
`;
}

function getScript(): string {
  return `
  const vscode = acquireVsCodeApi();

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const card = btn.closest('.card');
    const id = card ? card.dataset.id : undefined;

    vscode.postMessage({ command: action, id });
  });
`;
}
