import * as vscode from 'vscode';
import { IChangedRow, ITableDiff } from './snapshot-store';

function esc(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderTableRows(
  columns: string[],
  rows: Record<string, unknown>[],
  cssClass: string,
): string {
  if (rows.length === 0) return '';
  const header = columns.map((c) => `<th>${esc(c)}</th>`).join('');
  const body = rows
    .map((row) => {
      const cells = columns
        .map((c) => `<td>${esc(row[c])}</td>`)
        .join('');
      return `<tr class="${cssClass}">${cells}</tr>`;
    })
    .join('\n');
  return `<table><tr>${header}</tr>\n${body}</table>`;
}

function renderChangedRows(
  columns: string[],
  changedRows: IChangedRow[],
): string {
  if (changedRows.length === 0) return '';
  const header = columns.map((c) => `<th>${esc(c)}</th>`).join('');
  const body = changedRows
    .map((cr) => {
      const cells = columns
        .map((c) => {
          const isChanged = cr.changedColumns.includes(c);
          const cls = isChanged ? ' class="cell-changed"' : '';
          const val = isChanged
            ? `${esc(cr.before[c])} → ${esc(cr.after[c])}`
            : esc(cr.after[c]);
          return `<td${cls}>${val}</td>`;
        })
        .join('');
      return `<tr class="changed">${cells}</tr>`;
    })
    .join('\n');
  return `<table><tr>${header}</tr>\n${body}</table>`;
}

/** Build self-contained HTML for a table diff. */
export function buildDiffHtml(
  tableName: string,
  diff: ITableDiff,
): string {
  const sections: string[] = [];

  const countDelta = diff.currentRowCount - diff.snapshotRowCount;
  const deltaStr = countDelta > 0 ? `+${countDelta}` : String(countDelta);

  sections.push(`<h2>${esc(tableName)}</h2>`);
  sections.push(
    `<p class="summary">${diff.snapshotRowCount} → `
    + `${diff.currentRowCount} rows (${deltaStr})</p>`,
  );

  const badges: string[] = [];
  if (diff.addedRows.length > 0) {
    badges.push(`<span class="badge added">${diff.addedRows.length} added</span>`);
  }
  if (diff.removedRows.length > 0) {
    badges.push(`<span class="badge removed">${diff.removedRows.length} removed</span>`);
  }
  if (diff.changedRows.length > 0) {
    badges.push(`<span class="badge changed">${diff.changedRows.length} changed</span>`);
  }
  if (badges.length > 0) {
    sections.push(`<p>${badges.join(' ')}</p>`);
  }

  if (diff.addedRows.length > 0) {
    sections.push('<h3>Added Rows</h3>');
    sections.push(renderTableRows(diff.columns, diff.addedRows, 'added'));
  }

  if (diff.removedRows.length > 0) {
    sections.push('<h3>Removed Rows</h3>');
    sections.push(renderTableRows(diff.columns, diff.removedRows, 'removed'));
  }

  if (diff.changedRows.length > 0) {
    sections.push('<h3>Changed Rows</h3>');
    sections.push(renderChangedRows(diff.columns, diff.changedRows));
  }

  const noChanges =
    diff.addedRows.length === 0
    && diff.removedRows.length === 0
    && diff.changedRows.length === 0;
  if (noChanges) {
    sections.push('<p class="no-changes">No row-level changes detected.</p>');
  }

  return wrapHtml(sections.join('\n'));
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
  h3 { margin-top: 20px; }
  table {
    border-collapse: collapse;
    width: 100%;
    margin-top: 8px;
    font-size: 13px;
  }
  th, td {
    border: 1px solid var(--vscode-panel-border, #444);
    padding: 4px 8px;
    text-align: left;
  }
  th {
    background: var(--vscode-editor-inactiveSelectionBackground, #333);
    font-weight: 600;
  }
  tr.added td {
    background: rgba(40, 167, 69, 0.15);
    border-left: 3px solid #28a745;
  }
  tr.removed td {
    background: rgba(220, 53, 69, 0.15);
    border-left: 3px solid #dc3545;
  }
  tr.changed td {
    background: rgba(255, 193, 7, 0.08);
  }
  td.cell-changed {
    background: rgba(255, 193, 7, 0.25);
    font-weight: 600;
  }
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 12px;
    margin-right: 6px;
  }
  .badge.added { background: rgba(40, 167, 69, 0.3); }
  .badge.removed { background: rgba(220, 53, 69, 0.3); }
  .badge.changed { background: rgba(255, 193, 7, 0.3); }
  .summary { font-size: 14px; opacity: 0.8; }
  .no-changes { font-style: italic; opacity: 0.6; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

/** Singleton webview panel for snapshot diff visualization. */
export class SnapshotDiffPanel {
  private static _currentPanel: SnapshotDiffPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];

  static createOrShow(tableName: string, diff: ITableDiff): void {
    const column = vscode.ViewColumn.Beside;
    if (SnapshotDiffPanel._currentPanel) {
      SnapshotDiffPanel._currentPanel._panel.reveal(column);
      SnapshotDiffPanel._currentPanel._update(tableName, diff);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'driftSnapshotDiff',
      `Diff: ${tableName}`,
      column,
      { enableScripts: false },
    );
    SnapshotDiffPanel._currentPanel = new SnapshotDiffPanel(
      panel, tableName, diff,
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    tableName: string,
    diff: ITableDiff,
  ) {
    this._panel = panel;
    this._panel.onDidDispose(
      () => this._dispose(), null, this._disposables,
    );
    this._update(tableName, diff);
  }

  private _update(tableName: string, diff: ITableDiff): void {
    this._panel.title = `Diff: ${tableName}`;
    this._panel.webview.html = buildDiffHtml(tableName, diff);
  }

  private _dispose(): void {
    SnapshotDiffPanel._currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
  }
}
