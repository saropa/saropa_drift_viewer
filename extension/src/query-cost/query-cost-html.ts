/**
 * HTML template for the Query Cost Analysis webview panel.
 * Uses VS Code theme CSS variables for light/dark support.
 */

import type {
  IParsedPlan,
  IPlanNode,
  IPlanWarning,
  IIndexSuggestion,
  IPerformanceSummary,
} from './query-cost-types';

function esc(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nodeClass(node: IPlanNode): string {
  if (node.isFullScan) return 'node-scan';
  switch (node.operation) {
    case 'search': return 'node-search';
    case 'scan': return 'node-scan';
    case 'use_temp_btree': return 'node-temp';
    default: return 'node-other';
  }
}

function nodeBadge(node: IPlanNode): string {
  if (node.isFullScan) return 'FULL SCAN';
  switch (node.operation) {
    case 'search': return 'INDEX';
    case 'use_temp_btree': return 'TEMP';
    default: return '';
  }
}

function renderNode(node: IPlanNode): string {
  const cls = nodeClass(node);
  const badge = nodeBadge(node);
  const badgeHtml = badge
    ? ` <span class="badge ${cls}">${badge}</span>`
    : '';
  const tableInfo = node.table ? ` <span class="table-name">${esc(node.table)}</span>` : '';
  const indexInfo = node.index ? ` <span class="index-name">via ${esc(node.index)}</span>` : '';
  const children = node.children.map((c) => renderNode(c)).join('\n');
  return `<div class="node ${cls}">
  <div class="node-detail">${esc(node.detail)}${badgeHtml}${tableInfo}${indexInfo}</div>
  ${children}
</div>`;
}

function renderWarnings(warnings: IPlanWarning[]): string {
  if (warnings.length === 0) return '';
  const items = warnings
    .map((w) => {
      const icon = w.severity === 'warning' ? '&#9888;' : '&#8505;';
      const cls = w.severity === 'warning' ? 'warn-warning' : 'warn-info';
      return `<div class="warning ${cls}">
  <span class="warn-icon">${icon}</span>
  <span class="warn-msg">${esc(w.message)}</span>
  ${w.suggestion ? `<span class="warn-suggestion">${esc(w.suggestion)}</span>` : ''}
</div>`;
    })
    .join('\n');
  return `<h3>Warnings</h3>\n${items}`;
}

function renderSummary(summary: IPerformanceSummary): string {
  return `<h3>Performance Summary</h3>
<div class="summary">
  <div class="summary-item ${summary.scanCount > 0 ? 'summary-bad' : 'summary-good'}">
    ${summary.scanCount > 0 ? '&#9888;' : '&#10003;'}
    ${summary.scanCount} full table scan${summary.scanCount !== 1 ? 's' : ''}
  </div>
  <div class="summary-item summary-good">
    &#10003; ${summary.indexCount} index${summary.indexCount !== 1 ? 'es' : ''} used
  </div>
  ${summary.tempBTreeCount > 0
    ? `<div class="summary-item summary-info">
    &#8505; ${summary.tempBTreeCount} temporary sort${summary.tempBTreeCount !== 1 ? 's' : ''}
  </div>`
    : ''}
  <div class="summary-item summary-neutral">
    ${summary.totalNodes} total operation${summary.totalNodes !== 1 ? 's' : ''}
  </div>
</div>`;
}

function renderSuggestions(suggestions: IIndexSuggestion[]): string {
  if (suggestions.length === 0) return '';
  const items = suggestions
    .map(
      (s, i) => `<div class="suggestion">
  <div class="suggestion-header">
    <span class="suggestion-impact impact-${s.impact}">${esc(s.impact.toUpperCase())}</span>
    <span class="suggestion-reason">${esc(s.reason)}</span>
  </div>
  <code class="suggestion-sql">${esc(s.sql)}</code>
  <div class="suggestion-actions">
    <button class="copy-btn" data-action="copySuggestion" data-index="${i}">Copy</button>
    <button class="run-btn" data-action="runSuggestion" data-index="${i}">Run</button>
  </div>
</div>`,
    )
    .join('\n');
  return `<h3>Suggestions</h3>\n${items}`;
}

/** Build self-contained HTML for the query cost analysis panel. */
export function buildQueryCostHtml(
  sql: string,
  plan: IParsedPlan,
  suggestions: IIndexSuggestion[],
): string {
  const tree = plan.nodes.map((n) => renderNode(n)).join('\n');
  const warningsHtml = renderWarnings(plan.warnings);
  const summaryHtml = renderSummary(plan.summary);
  const suggestionsHtml = renderSuggestions(suggestions);

  const body = `
<h2>Query Cost Analysis</h2>
<div class="toolbar">
  <button class="copy-btn" data-action="copySql">Copy SQL</button>
  <button class="copy-btn" data-action="copyPlan">Copy Plan</button>
  <button class="copy-btn" data-action="reanalyze">Re-analyze</button>
</div>
<div class="sql-block"><code>${esc(sql)}</code></div>
<h3>Execution Plan</h3>
<div class="tree">${tree}</div>
${warningsHtml}
${summaryHtml}
${suggestionsHtml}`;

  return wrapHtml(body);
}

/** Build a text representation of the plan tree for clipboard. */
export function buildPlanText(
  nodes: IPlanNode[],
  indent: string = '',
): string {
  return nodes
    .map((n) => {
      const line = `${indent}${n.detail}`;
      const childText = buildPlanText(n.children, indent + '  ');
      return childText ? `${line}\n${childText}` : line;
    })
    .join('\n');
}

function wrapHtml(body: string): string {
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
  h2 { margin-top: 0; }
  h3 { margin-top: 20px; margin-bottom: 8px; }
  .toolbar { margin-bottom: 12px; display: flex; gap: 6px; }
  .copy-btn, .run-btn {
    border: none;
    padding: 4px 10px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
  }
  .copy-btn {
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
  }
  .copy-btn:hover {
    background: var(--vscode-button-hoverBackground, #1177bb);
  }
  .run-btn {
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #fff);
  }
  .run-btn:hover {
    background: var(--vscode-button-secondaryHoverBackground, #505357);
  }
  .sql-block {
    background: var(--vscode-editor-inactiveSelectionBackground, #333);
    padding: 8px 12px;
    border-radius: 4px;
    margin-bottom: 16px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 13px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .tree { margin-bottom: 16px; }
  .node {
    margin: 4px 0 4px 16px;
    padding: 6px 10px;
    border-radius: 4px;
  }
  .node:first-child { margin-left: 0; }
  .node-detail {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 13px;
  }
  .node-search { border-left: 4px solid #28a745; background: rgba(40,167,69,0.08); }
  .node-scan   { border-left: 4px solid #dc3545; background: rgba(220,53,69,0.08); }
  .node-temp   { border-left: 4px solid #e0a800; background: rgba(224,168,0,0.08); }
  .node-other  { border-left: 4px solid var(--vscode-panel-border, #444); }
  .badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 8px;
    font-size: 11px;
    margin-left: 8px;
    font-weight: 600;
  }
  .badge.node-search { color: #28a745; }
  .badge.node-scan   { color: #dc3545; }
  .badge.node-temp   { color: #e0a800; }
  .table-name, .index-name {
    font-size: 11px;
    opacity: 0.6;
    margin-left: 6px;
  }
  .warning {
    padding: 6px 10px;
    margin: 4px 0;
    border-radius: 4px;
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .warn-warning { background: rgba(220,53,69,0.08); }
  .warn-info { background: rgba(224,168,0,0.08); }
  .warn-icon { font-size: 14px; }
  .warn-msg { font-size: 13px; }
  .warn-suggestion {
    font-size: 12px;
    opacity: 0.7;
    display: block;
    margin-top: 2px;
  }
  .summary { margin-bottom: 16px; }
  .summary-item {
    padding: 4px 0;
    font-size: 13px;
  }
  .summary-bad { color: #dc3545; }
  .summary-good { color: #28a745; }
  .summary-info { color: #e0a800; }
  .summary-neutral { opacity: 0.7; }
  .suggestion {
    margin: 8px 0;
    padding: 10px 12px;
    background: var(--vscode-editor-inactiveSelectionBackground, #333);
    border-radius: 4px;
  }
  .suggestion-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  .suggestion-impact {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 8px;
    font-size: 11px;
    font-weight: 600;
  }
  .impact-high { color: #dc3545; background: rgba(220,53,69,0.15); }
  .impact-medium { color: #e0a800; background: rgba(224,168,0,0.15); }
  .impact-low { color: #28a745; background: rgba(40,167,69,0.15); }
  .suggestion-reason {
    font-size: 12px;
    opacity: 0.7;
  }
  .suggestion-sql {
    font-size: 13px;
    display: block;
    margin-bottom: 8px;
    font-family: var(--vscode-editor-font-family, monospace);
  }
  .suggestion-actions {
    display: flex;
    gap: 6px;
  }
</style>
</head>
<body>
${body}
<script>
  var vscode = acquireVsCodeApi();
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.dataset.action;
    var index = btn.dataset.index;
    vscode.postMessage({
      command: action,
      index: index !== undefined ? Number(index) : undefined,
    });
  });
</script>
</body>
</html>`;
}
