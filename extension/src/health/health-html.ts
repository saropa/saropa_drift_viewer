import type {
  IHealthMetric, IHealthScore, IMetricAction, IRecommendation,
} from './health-types';

/** Build HTML for the health score dashboard webview panel. */
export function buildHealthHtml(score: IHealthScore): string {
  if (score.metrics.length === 0) {
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<style>body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
  background: var(--vscode-editor-background); }
.empty { padding: 32px; text-align: center; opacity: 0.6; }</style>
</head><body><div class="empty">No metrics available.</div></body></html>`;
  }

  const gradeClass = gradeColorClass(score.grade);
  const cards = score.metrics.map((m) => buildMetricCard(m)).join('\n');
  const recs = buildRecommendations(score.recommendations);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
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
    margin-bottom: 24px;
  }
  .header h1 { margin: 0; font-size: 18px; }
  .btn {
    padding: 4px 12px;
    border: 1px solid var(--vscode-button-border, var(--vscode-widget-border));
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
  }
  .btn:hover { opacity: 0.9; }
  .btn-group { display: flex; gap: 6px; }
  .overall {
    text-align: center;
    margin-bottom: 28px;
  }
  .overall-grade {
    font-size: 64px;
    font-weight: bold;
    line-height: 1;
  }
  .overall-score {
    font-size: 16px;
    opacity: 0.7;
    margin-top: 4px;
  }
  .grade-a { color: #22c55e; }
  .grade-b { color: #84cc16; }
  .grade-c { color: #eab308; }
  .grade-d { color: #f97316; }
  .grade-f { color: #ef4444; }
  .cards {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin-bottom: 24px;
  }
  .card {
    border: 1px solid var(--vscode-widget-border);
    border-radius: 4px;
    padding: 12px;
    transition: border-color 0.15s;
  }
  .card[data-command] {
    cursor: pointer;
  }
  .card[data-command]:hover {
    border-color: var(--vscode-focusBorder);
  }
  .card-header {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    opacity: 0.7;
    margin-bottom: 8px;
  }
  .card-score {
    font-size: 24px;
    font-weight: bold;
  }
  .card-grade {
    font-size: 14px;
    font-weight: bold;
    margin-left: 6px;
  }
  .card-summary {
    font-size: 12px;
    opacity: 0.7;
    margin-top: 6px;
  }
  .recs {
    border: 1px solid var(--vscode-widget-border);
    border-radius: 4px;
    padding: 12px;
  }
  .recs h2 {
    font-size: 14px;
    margin: 0 0 10px 0;
  }
  .rec {
    font-size: 12px;
    padding: 4px 0;
    display: flex;
    gap: 8px;
  }
  .rec-icon { flex-shrink: 0; width: 16px; text-align: center; }
  .rec-error .rec-icon { color: #ef4444; }
  .rec-warning .rec-icon { color: #eab308; }
  .rec-info .rec-icon { color: #3b82f6; }
  .rec-metric {
    opacity: 0.5;
    font-size: 11px;
    margin-left: auto;
    white-space: nowrap;
  }
  .card-actions {
    display: flex;
    gap: 6px;
    margin-top: 10px;
    flex-wrap: wrap;
  }
  .action-btn {
    padding: 3px 8px;
    font-size: 11px;
    border: 1px solid var(--vscode-button-border, var(--vscode-widget-border));
    background: var(--vscode-button-secondaryBackground, var(--vscode-editor-background));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    border-radius: 3px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .action-btn:hover {
    background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground));
  }
  .action-btn.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-color: var(--vscode-button-background);
  }
  .action-btn.primary:hover {
    opacity: 0.9;
  }
  .rec-action {
    padding: 2px 6px;
    font-size: 10px;
    border: 1px solid var(--vscode-button-border, var(--vscode-widget-border));
    background: var(--vscode-button-secondaryBackground, var(--vscode-editor-background));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    border-radius: 3px;
    cursor: pointer;
    margin-left: 8px;
    flex-shrink: 0;
  }
  .rec-action:hover {
    background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground));
  }
</style>
</head>
<body>
<div class="header">
  <h1>Database Health Score</h1>
  <div class="btn-group">
    <button class="btn" data-action="refresh">Refresh</button>
    <button class="btn" data-action="copyReport">Copy Report</button>
  </div>
</div>

<div class="overall">
  <div class="overall-grade ${gradeClass}">${esc(score.grade)}</div>
  <div class="overall-score">Score: ${score.overall}/100</div>
</div>

<div class="cards">
  ${cards}
</div>

${recs}

<script>
  const vscode = acquireVsCodeApi();
  document.addEventListener('click', (e) => {
    // Handle header button actions (refresh, copyReport)
    const btn = e.target.closest('[data-action]');
    if (btn) {
      vscode.postMessage({ command: btn.dataset.action });
      return;
    }
    // Handle action buttons on cards and recommendations
    const actionBtn = e.target.closest('[data-action-command]');
    if (actionBtn) {
      e.stopPropagation();
      const cmd = actionBtn.dataset.actionCommand;
      let args;
      try {
        args = actionBtn.dataset.args ? JSON.parse(actionBtn.dataset.args) : undefined;
      } catch { args = undefined; }
      vscode.postMessage({ command: 'executeAction', actionCommand: cmd, args });
      return;
    }
    // Handle card click to open linked panel
    const card = e.target.closest('[data-command]');
    if (card) {
      vscode.postMessage({ command: 'openCommand', id: card.dataset.command });
    }
  });
</script>
</body>
</html>`;
}

function buildMetricCard(m: IHealthMetric): string {
  const gc = gradeColorClass(m.grade);
  const cmdAttr = m.linkedCommand ? ` data-command="${esc(m.linkedCommand)}"` : '';
  const actionsHtml = buildActions(m.actions);
  return `<div class="card"${cmdAttr}>
    <div class="card-header">${esc(m.name)}</div>
    <span class="card-score">${m.score}/100</span>
    <span class="card-grade ${gc}">${esc(m.grade)}</span>
    <div class="card-summary">${esc(m.summary)}</div>
    ${actionsHtml}
  </div>`;
}

function buildActions(actions?: IMetricAction[]): string {
  if (!actions || actions.length === 0) return '';
  const buttons = actions.map((a, i) => {
    const cls = i === 0 && a.label.toLowerCase().includes('fix') ? 'action-btn primary' : 'action-btn';
    const icon = a.icon ? `${a.icon} ` : '';
    const argsAttr = a.args ? ` data-args='${esc(JSON.stringify(a.args))}'` : '';
    return `<button class="${cls}" data-action-command="${esc(a.command)}"${argsAttr}>${icon}${esc(a.label)}</button>`;
  }).join('\n    ');
  return `<div class="card-actions">\n    ${buttons}\n  </div>`;
}

function buildRecommendations(recs: IRecommendation[]): string {
  if (recs.length === 0) {
    return `<div class="recs"><h2>Recommendations</h2>
      <div style="opacity:0.6;font-size:12px">No issues found. Great job!</div></div>`;
  }
  const items = recs.map((r) => {
    const icon = r.severity === 'error' ? '\u2716' : r.severity === 'warning' ? '\u26A0' : '\u2139';
    const actionBtn = buildRecAction(r.action);
    return `<div class="rec rec-${esc(r.severity)}">
      <span class="rec-icon">${icon}</span>
      <span>${esc(r.message)}</span>
      ${actionBtn}
      <span class="rec-metric">${esc(r.metric)}</span>
    </div>`;
  }).join('\n');
  return `<div class="recs"><h2>Recommendations</h2>${items}</div>`;
}

function buildRecAction(action?: IMetricAction): string {
  if (!action) return '';
  const argsAttr = action.args ? ` data-args='${esc(JSON.stringify(action.args))}'` : '';
  return `<button class="rec-action" data-action-command="${esc(action.command)}"${argsAttr}>Fix</button>`;
}

function gradeColorClass(grade: string): string {
  const letter = grade.charAt(0).toUpperCase();
  if (letter === 'A') return 'grade-a';
  if (letter === 'B') return 'grade-b';
  if (letter === 'C') return 'grade-c';
  if (letter === 'D') return 'grade-d';
  return 'grade-f';
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
