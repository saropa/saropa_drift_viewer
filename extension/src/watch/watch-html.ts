/** Generate the HTML content for the watch panel webview. */
export function getWatchHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    margin: 0;
    padding: 8px;
  }

  .empty-state {
    text-align: center;
    padding: 40px 16px;
    color: var(--vscode-descriptionForeground);
  }

  .watch-card {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    margin-bottom: 12px;
    overflow: hidden;
  }

  .watch-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: var(--vscode-editor-lineHighlightBackground);
    border-bottom: 1px solid var(--vscode-panel-border);
  }

  .watch-header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .watch-label {
    font-weight: bold;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .watch-meta {
    font-size: 0.85em;
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
  }

  .watch-actions { display: flex; gap: 4px; }

  .btn {
    cursor: pointer;
    background: none;
    border: 1px solid var(--vscode-button-secondaryBackground);
    color: var(--vscode-textLink-foreground);
    border-radius: 3px;
    padding: 2px 8px;
    font-size: 0.85em;
  }
  .btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .btn-danger { color: var(--vscode-errorForeground); }

  .watch-error {
    padding: 8px 10px;
    color: var(--vscode-errorForeground);
    background: var(--vscode-inputValidation-errorBackground);
    font-family: var(--vscode-editor-font-family);
    font-size: 0.9em;
  }

  .watch-paused .watch-body { opacity: 0.5; }

  .watch-table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--vscode-editor-font-family);
    font-size: var(--vscode-editor-font-size);
  }

  .watch-table th {
    background: var(--vscode-editor-lineHighlightBackground);
    text-align: left;
    padding: 3px 8px;
    border: 1px solid var(--vscode-panel-border);
    font-weight: 600;
    position: sticky;
    top: 0;
  }

  .watch-table td {
    padding: 2px 8px;
    border: 1px solid var(--vscode-panel-border);
    white-space: nowrap;
  }

  .row-added    { background: rgba(0, 200, 0, 0.15); }
  .row-removed  { background: rgba(200, 0, 0, 0.15); text-decoration: line-through; }
  .cell-changed { background: rgba(200, 200, 0, 0.2); font-weight: bold; }

  .watch-summary {
    padding: 4px 10px;
    font-size: 0.85em;
    color: var(--vscode-descriptionForeground);
    border-top: 1px solid var(--vscode-panel-border);
  }

  .table-wrap {
    max-height: 400px;
    overflow: auto;
  }
</style>
</head>
<body>
<div id="container">
  <div id="empty-state" class="empty-state">
    <h2>No active watches</h2>
    <p>Right-click a table in the Database explorer and select <b>Watch Table</b></p>
  </div>
  <div id="watches"></div>
</div>
<script>
  const vscode = acquireVsCodeApi();

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.command === 'update') renderWatches(msg.entries);
  });

  // Event delegation for all watch buttons
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cmd]');
    if (!btn) return;
    vscode.postMessage({ command: btn.dataset.cmd, id: btn.dataset.id });
  });

  function renderWatches(entries) {
    const empty = document.getElementById('empty-state');
    const container = document.getElementById('watches');
    if (!entries || entries.length === 0) {
      empty.style.display = '';
      container.innerHTML = '';
      return;
    }
    empty.style.display = 'none';
    container.innerHTML = entries.map(renderCard).join('');
  }

  function renderCard(entry) {
    const pausedClass = entry.paused ? ' watch-paused' : '';
    const meta = entry.currentResult
      ? entry.currentResult.rows.length + ' rows'
      : '';
    const changed = entry.lastChangedAt
      ? ' · changed ' + formatTime(entry.lastChangedAt)
      : '';

    let body = '';
    if (entry.error) {
      body = '<div class="watch-error">' + esc(entry.error) + '</div>';
    } else if (entry.currentResult) {
      body = renderTable(entry);
    }

    const summary = renderSummary(entry.diff);
    const pauseBtn = entry.paused
      ? btn('Resume', 'resumeWatch', entry.id)
      : btn('Pause', 'pauseWatch', entry.id);

    return '<div class="watch-card' + pausedClass + '">'
      + '<div class="watch-header">'
      + '  <div class="watch-header-left">'
      + '    <span class="watch-label">' + esc(entry.label) + '</span>'
      + '    <span class="watch-meta">' + esc(meta + changed) + '</span>'
      + '  </div>'
      + '  <div class="watch-actions">'
      +      pauseBtn
      +      btn('Clear', 'clearDiff', entry.id)
      +      btn('Remove', 'removeWatch', entry.id, 'btn-danger')
      + '  </div>'
      + '</div>'
      + '<div class="watch-body">' + body + '</div>'
      + (summary ? '<div class="watch-summary">' + summary + '</div>' : '')
      + '</div>';
  }

  function renderTable(entry) {
    const r = entry.currentResult;
    if (!r || r.columns.length === 0) return '';

    const diff = entry.diff;
    const addedKeys = new Set();
    const changedMap = new Map();

    if (diff) {
      for (const row of diff.addedRows) addedKeys.add(JSON.stringify(row[entry.pkIndex]));
      for (const cr of diff.changedRows) changedMap.set(cr.pkValue, new Set(cr.changedColumnIndices));
    }

    let html = '<div class="table-wrap"><table class="watch-table"><thead><tr>';
    for (const col of r.columns) html += '<th>' + esc(col) + '</th>';
    html += '</tr></thead><tbody>';

    for (const row of r.rows) {
      const key = JSON.stringify(row[entry.pkIndex]);
      const isAdded = addedKeys.has(key);
      const changedCols = changedMap.get(key);
      const rowClass = isAdded ? ' class="row-added"' : '';
      html += '<tr' + rowClass + '>';
      for (let i = 0; i < row.length; i++) {
        const cellClass = (!isAdded && changedCols && changedCols.has(i)) ? ' class="cell-changed"' : '';
        html += '<td' + cellClass + '>' + esc(String(row[i] ?? '')) + '</td>';
      }
      html += '</tr>';
    }

    if (diff) {
      for (const row of diff.removedRows) {
        html += '<tr class="row-removed">';
        for (let i = 0; i < row.length; i++) html += '<td>' + esc(String(row[i] ?? '')) + '</td>';
        html += '</tr>';
      }
    }

    html += '</tbody></table></div>';
    return html;
  }

  function renderSummary(diff) {
    if (!diff) return '';
    const parts = [];
    if (diff.addedRows.length) parts.push(diff.addedRows.length + ' added');
    if (diff.removedRows.length) parts.push(diff.removedRows.length + ' removed');
    if (diff.changedRows.length) parts.push(diff.changedRows.length + ' changed');
    if (diff.unchangedCount) parts.push(diff.unchangedCount + ' unchanged');
    return parts.join(' · ');
  }

  function btn(label, command, id, extraClass) {
    const cls = 'btn' + (extraClass ? ' ' + extraClass : '');
    return '<button class="' + cls + '" data-cmd="' + esc(command) + '" data-id="' + esc(id) + '">'
      + label + '</button>';
  }

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatTime(ts) {
    const secs = Math.floor((Date.now() - ts) / 1000);
    if (secs < 5) return 'just now';
    if (secs < 60) return secs + 's ago';
    const mins = Math.floor(secs / 60);
    return mins + 'm ago';
  }
</script>
</body>
</html>`;
}
