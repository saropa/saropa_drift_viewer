import type { ColumnMetadata, ForeignKey } from '../api-types';
import type {
  IConstraintDraft,
  IConstraintTestResult,
} from './constraint-types';

function esc(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderExisting(
  columns: ColumnMetadata[],
  fks: ForeignKey[],
): string {
  const items: string[] = [];
  const pkCols = columns.filter((c) => c.pk).map((c) => c.name);
  if (pkCols.length > 0) {
    items.push(
      `<div class="existing">\u2713 PRIMARY KEY (${esc(pkCols.join(', '))})</div>`,
    );
  }
  for (const fk of fks) {
    items.push(
      `<div class="existing">\u2713 FK ${esc(fk.fromColumn)}`
      + ` \u2192 ${esc(fk.toTable)}.${esc(fk.toColumn)}</div>`,
    );
  }
  if (items.length === 0) {
    items.push('<div class="muted">None</div>');
  }
  return `<h3>Existing Constraints</h3>\n${items.join('\n')}`;
}

function renderDraft(
  draft: IConstraintDraft,
  index: number,
  columns: ColumnMetadata[],
  result?: IConstraintTestResult,
): string {
  const kindLabel = draft.kind === 'not_null'
    ? 'NOT NULL' : draft.kind.toUpperCase();
  const inputHtml = renderDraftInput(draft, index, columns);
  const statusHtml = renderStatus(result);
  return `<div class="card">
  <div class="card-header">
    <span class="card-index">${index + 1}.</span>
    <span class="card-kind">${kindLabel}</span>
    <button class="btn btn-danger btn-sm"
      data-action="removeConstraint"
      data-id="${esc(draft.id)}">Remove</button>
  </div>
  ${inputHtml}
  ${statusHtml}
  <div class="card-actions">
    <button class="btn" data-action="testConstraint"
      data-id="${esc(draft.id)}">Test</button>
  </div>
</div>`;
}

function renderDraftInput(
  draft: IConstraintDraft,
  index: number,
  columns: ColumnMetadata[],
): string {
  switch (draft.kind) {
    case 'unique': {
      const options = columns.map((c) => {
        const sel = (draft.columns ?? []).includes(c.name)
          ? ' selected' : '';
        return `<option value="${esc(c.name)}"${sel}>`
          + `${esc(c.name)}</option>`;
      }).join('');
      return `<label>Column(s):</label>
<select class="input" multiple data-input="columns"
  data-index="${index}">${options}</select>`;
    }
    case 'check':
      return `<label>Expression:</label>
<input class="input" type="text" data-input="expression"
  data-index="${index}"
  value="${esc(draft.expression ?? '')}"
  placeholder="age >= 0 AND age <= 150" />`;
    case 'not_null': {
      const options = columns.map((c) => {
        const sel = draft.column === c.name ? ' selected' : '';
        return `<option value="${esc(c.name)}"${sel}>`
          + `${esc(c.name)}</option>`;
      }).join('');
      return `<label>Column:</label>
<select class="input" data-input="column"
  data-index="${index}">${options}</select>`;
    }
  }
}

function renderStatus(
  result?: IConstraintTestResult,
): string {
  if (!result) return '<div class="status muted">Not tested</div>';
  if (result.valid) {
    return '<div class="status status-ok">'
      + '\u2713 0 violations found</div>';
  }
  const rows = result.violations.map((v) => {
    const vals = Object.entries(v.values)
      .map(([k, val]) => `${esc(k)}=${esc(val)}`)
      .join(', ');
    return `<div class="violation">PK ${esc(v.rowPk)}: ${vals}</div>`;
  }).join('\n');
  return `<div class="status status-warn">`
    + `\u26a0 ${result.violationCount} violation(s) found</div>\n${rows}`;
}

/** Build the full HTML for the Constraint Wizard webview. */
export function buildConstraintWizardHtml(
  table: string,
  columns: ColumnMetadata[],
  fks: ForeignKey[],
  drafts: IConstraintDraft[],
  results: Map<string, IConstraintTestResult>,
): string {
  const existingHtml = renderExisting(columns, fks);
  const draftsHtml = drafts.length > 0
    ? drafts.map((d, i) => renderDraft(
      d, i, columns, results.get(d.id),
    )).join('\n')
    : '<div class="muted">No constraints designed yet.</div>';

  const body = `
<h2>Constraint Wizard \u2014 ${esc(table)}</h2>
${existingHtml}
<h3>Design New Constraints
  <button class="btn btn-sm" data-action="showAddMenu">+ Add</button>
</h3>
<div id="add-menu" class="add-menu hidden">
  <button class="btn btn-sm" data-action="addConstraint"
    data-kind="unique">UNIQUE</button>
  <button class="btn btn-sm" data-action="addConstraint"
    data-kind="check">CHECK</button>
  <button class="btn btn-sm" data-action="addConstraint"
    data-kind="not_null">NOT NULL</button>
</div>
<div class="drafts">${draftsHtml}</div>
<div class="toolbar">
  <button class="btn" data-action="testAll"
    ${drafts.length === 0 ? 'disabled' : ''}>Test All</button>
  <button class="btn" data-action="generateDart"
    ${drafts.length === 0 ? 'disabled' : ''}>Generate Dart</button>
  <button class="btn" data-action="generateSql"
    ${drafts.length === 0 ? 'disabled' : ''}>Generate SQL</button>
</div>`;

  return wrapHtml(body);
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
  h3 { margin-top: 20px; display: flex; align-items: center; gap: 8px; }
  .btn {
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
    border: none;
    padding: 4px 10px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
  }
  .btn:hover {
    background: var(--vscode-button-hoverBackground, #1177bb);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .btn-sm { padding: 2px 8px; font-size: 11px; }
  .btn-danger {
    background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
  }
  .add-menu { margin-bottom: 12px; display: flex; gap: 6px; }
  .hidden { display: none !important; }
  .existing {
    padding: 4px 0;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 13px;
  }
  .muted { opacity: 0.6; font-style: italic; }
  .card {
    border: 1px solid var(--vscode-panel-border, #444);
    border-radius: 6px;
    padding: 12px;
    margin: 8px 0;
  }
  .card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .card-index { font-weight: bold; }
  .card-kind {
    font-weight: 600;
    font-family: var(--vscode-editor-font-family, monospace);
  }
  .card-header .btn { margin-left: auto; }
  .card-actions { margin-top: 8px; }
  label {
    display: block;
    font-size: 12px;
    margin-bottom: 4px;
    opacity: 0.8;
  }
  .input {
    width: 100%;
    box-sizing: border-box;
    padding: 4px 8px;
    font-size: 13px;
    font-family: var(--vscode-editor-font-family, monospace);
    background: var(--vscode-input-background, #333);
    color: var(--vscode-input-foreground, #ccc);
    border: 1px solid var(--vscode-input-border, #555);
    border-radius: 3px;
  }
  select.input { min-height: 28px; }  select[multiple].input { min-height: 60px; }
  .status { margin-top: 8px; font-size: 13px; }
  .status-ok { color: #28a745; }  .status-warn { color: #e0a800; }
  .violation {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    padding: 2px 0 2px 16px;
    opacity: 0.85;
  }
  .toolbar {
    margin-top: 20px;
    display: flex;
    gap: 8px;
    border-top: 1px solid var(--vscode-panel-border, #444);
    padding-top: 12px;
  }
</style>
</head>
<body>
${body}
<script>
  const vscode = acquireVsCodeApi();

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const action = btn.dataset.action;

    if (action === 'showAddMenu') {
      const menu = document.getElementById('add-menu');
      if (menu) menu.classList.toggle('hidden');
      return;
    }

    const msg = { command: action };
    if (btn.dataset.id) msg.id = btn.dataset.id;
    if (btn.dataset.kind) msg.kind = btn.dataset.kind;
    vscode.postMessage(msg);
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el.dataset || !el.dataset.input) return;
    const index = Number(el.dataset.index);
    const msg = { command: 'updateConstraint', index: index };

    if (el.dataset.input === 'columns') {
      msg.columns = Array.from(el.selectedOptions).map(o => o.value);
    } else if (el.dataset.input === 'expression') {
      msg.expression = el.value;
    } else if (el.dataset.input === 'column') {
      msg.column = el.value;
    }
    vscode.postMessage(msg);
  });
</script>
</body>
</html>`;
}
