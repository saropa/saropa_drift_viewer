/**
 * HTML template for the Schema Evolution Timeline webview panel.
 * Uses VS Code theme CSS variables for light/dark support.
 */

import type { ISchemaChange, ISchemaSnapshot } from './schema-timeline-types';
import { diffSchemaSnapshots } from './schema-differ';

function esc(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Build the full HTML document for the schema timeline panel. */
export function buildSchemaTimelineHtml(
  snapshots: readonly ISchemaSnapshot[],
): string {
  if (snapshots.length === 0) {
    return wrapHtml(`<div class="empty">
      <h2>No schema snapshots yet</h2>
      <p>Schema snapshots are captured automatically when the database
      generation changes. Start your app and modify the schema to see
      the timeline.</p>
    </div>`);
  }

  // Pre-compute diffs once (shared by entries + summary)
  const diffs = precomputeDiffs(snapshots);
  const entries = renderEntries(snapshots, diffs);
  const summary = renderSummary(snapshots, diffs);

  return wrapHtml(`
    <div class="header">
      <h2>Schema Evolution Timeline</h2>
      <button id="export-btn" title="Copy timeline as JSON">Export</button>
    </div>
    <div class="timeline">${entries}</div>
    <div class="summary">${summary}</div>
    <script>
      const vscode = acquireVsCodeApi();
      document.getElementById('export-btn')
        .addEventListener('click', () => {
          vscode.postMessage({ command: 'export' });
        });
    </script>
  `);
}

/** Compute diffs between each adjacent pair of snapshots. */
function precomputeDiffs(
  snapshots: readonly ISchemaSnapshot[],
): ISchemaChange[][] {
  const diffs: ISchemaChange[][] = [[]]; // Index 0 = initial (no diff)
  for (let i = 1; i < snapshots.length; i++) {
    diffs.push(diffSchemaSnapshots(snapshots[i - 1], snapshots[i]));
  }
  return diffs;
}

function renderEntries(
  snapshots: readonly ISchemaSnapshot[],
  diffs: ISchemaChange[][],
): string {
  const parts: string[] = [];

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];
    const isCurrent = i === snapshots.length - 1;
    const label = isCurrent ? '(current)' : '';
    const delta = i > 0 ? timeDelta(snapshots[i - 1], snap) : 'Initial';
    const changes = diffs[i];

    parts.push(`
      <div class="entry${isCurrent ? ' current' : ''}">
        <div class="dot"></div>
        <div class="content">
          <div class="gen-header">
            <strong>Gen ${esc(snap.generation)}</strong>
            <span class="time">${esc(formatTime(snap.timestamp))}</span>
            <span class="delta">(${esc(delta)})</span>
            <span class="label">${esc(label)}</span>
          </div>
          ${i === 0 ? renderInitial(snap) : renderChanges(changes)}
        </div>
      </div>
    `);
  }

  return parts.join('');
}

function renderInitial(snap: ISchemaSnapshot): string {
  const names = snap.tables.map((t) => esc(t.name)).join(', ');
  return `<div class="change-list">
    <div class="change add">${snap.tables.length} tables: ${names}</div>
  </div>`;
}

function renderChanges(changes: ISchemaChange[]): string {
  if (changes.length === 0) {
    return '<div class="change-list"><div class="change none">'
      + 'No schema changes (data only)</div></div>';
  }

  const items = changes.map((c) => {
    const cls = changeClass(c.type);
    const icon = changeIcon(c.type);
    const label = changeLabel(c.type);
    const detail = c.detail ? ` ${esc(c.detail)}` : '';
    return `<div class="change ${cls}">${icon} ${label} `
      + `<strong>${esc(c.table)}</strong>:${detail}</div>`;
  });

  return `<div class="change-list">${items.join('')}</div>`;
}

function changeClass(type: ISchemaChange['type']): string {
  if (type.includes('added')) return 'add';
  if (type.includes('dropped') || type.includes('removed')) return 'remove';
  return 'modify';
}

function changeIcon(type: ISchemaChange['type']): string {
  if (type.includes('added')) return '+';
  if (type.includes('dropped') || type.includes('removed')) return '-';
  return '~';
}

function changeLabel(type: ISchemaChange['type']): string {
  const labels: Record<string, string> = {
    table_added: 'Added table',
    table_dropped: 'Dropped table',
    column_added: 'Added column in',
    column_removed: 'Removed column in',
    column_type_changed: 'Type changed in',
    fk_added: 'Added FK in',
    fk_removed: 'Removed FK in',
  };
  return labels[type] ?? type;
}

function renderSummary(
  snapshots: readonly ISchemaSnapshot[],
  diffs: ISchemaChange[][],
): string {
  let added = 0, dropped = 0, modified = 0, fkChanges = 0;

  for (let i = 1; i < snapshots.length; i++) {
    for (const c of diffs[i]) {
      if (c.type === 'table_added') added++;
      else if (c.type === 'table_dropped') dropped++;
      else if (c.type === 'fk_added' || c.type === 'fk_removed') fkChanges++;
      else modified++;
    }
  }

  const parts: string[] = [];
  if (added) parts.push(`${added} table${added !== 1 ? 's' : ''} added`);
  if (dropped) parts.push(`${dropped} dropped`);
  if (modified) parts.push(`${modified} column change${modified !== 1 ? 's' : ''}`);
  if (fkChanges) parts.push(`${fkChanges} FK change${fkChanges !== 1 ? 's' : ''}`);

  const text = parts.length > 0 ? parts.join(', ') : 'No changes';
  return `<div class="summary-text">${snapshots.length} snapshots — ${text}</div>`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}

function timeDelta(prev: ISchemaSnapshot, curr: ISchemaSnapshot): string {
  const ms = new Date(curr.timestamp).getTime()
    - new Date(prev.timestamp).getTime();
  if (isNaN(ms) || ms < 0) return '?';
  if (ms < 1000) return '<1s';
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
}

function wrapHtml(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-editor-foreground);
    background: var(--vscode-editor-background);
    padding: 16px;
    margin: 0;
  }
  .empty { text-align: center; margin-top: 60px; opacity: 0.7; }
  .header {
    display: flex; align-items: center;
    justify-content: space-between; margin-bottom: 16px;
  }
  .header h2 { margin: 0; }
  .header button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none; padding: 4px 12px; cursor: pointer; border-radius: 2px;
  }
  .header button:hover {
    background: var(--vscode-button-hoverBackground);
  }
  .timeline { position: relative; padding-left: 24px; }
  .timeline::before {
    content: ''; position: absolute; left: 8px; top: 0; bottom: 0;
    width: 2px; background: var(--vscode-editorLineNumber-foreground);
  }
  .entry { position: relative; margin-bottom: 16px; }
  .dot {
    position: absolute; left: -20px; top: 4px;
    width: 10px; height: 10px; border-radius: 50%;
    background: var(--vscode-editorLineNumber-foreground);
    border: 2px solid var(--vscode-editor-background);
  }
  .entry.current .dot {
    background: var(--vscode-terminal-ansiGreen);
  }
  .gen-header { margin-bottom: 4px; }
  .time { opacity: 0.7; margin-left: 8px; }
  .delta { opacity: 0.5; font-size: 0.9em; }
  .label { color: var(--vscode-terminal-ansiGreen); margin-left: 4px; }
  .change-list { margin-left: 4px; }
  .change { padding: 2px 0; font-size: 0.95em; }
  .change.add { color: var(--vscode-terminal-ansiGreen); }
  .change.remove { color: var(--vscode-terminal-ansiRed); }
  .change.modify { color: var(--vscode-terminal-ansiYellow); }
  .change.none { opacity: 0.5; font-style: italic; }
  .summary {
    margin-top: 16px; padding-top: 12px;
    border-top: 1px solid var(--vscode-editorLineNumber-foreground);
  }
  .summary-text { opacity: 0.7; }
</style>
</head>
<body>${body}</body>
</html>`;
}
