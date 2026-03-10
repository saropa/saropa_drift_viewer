/** Builds the HTML/CSS/JS for the schema search sidebar webview. */

export function getSchemaSearchHtml(nonce: string): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    color: var(--vscode-foreground); padding: 8px; }
  .search-box { display: flex; gap: 4px; margin-bottom: 6px; }
  .search-box input { flex: 1; padding: 4px 6px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px;
    outline: none; font-size: var(--vscode-font-size); }
  .search-box input:focus { border-color: var(--vscode-focusBorder); }
  .filters { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px; }
  .filters button { padding: 2px 8px; font-size: 11px; cursor: pointer;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: 1px solid transparent; border-radius: 2px; }
  .filters button.active { background: var(--vscode-button-background);
    color: var(--vscode-button-foreground); }
  .filters button:hover { opacity: 0.9; }
  .sep { width: 1px; background: var(--vscode-widget-border, #555); margin: 0 2px; }
  .results { list-style: none; }
  .result-item { padding: 3px 4px; cursor: pointer; border-radius: 2px; }
  .result-item:hover { background: var(--vscode-list-hoverBackground); }
  .result-table { font-weight: 600; }
  .result-col { padding-left: 14px; }
  .result-type { opacity: 0.7; margin-left: 4px; font-size: 11px; }
  .result-meta { font-size: 11px; opacity: 0.6; }
  .cross-ref { padding-left: 24px; font-size: 11px; opacity: 0.7; }
  .cross-ref .warn { color: var(--vscode-editorWarning-foreground, #cca700); }
  .empty { opacity: 0.6; font-style: italic; padding: 8px 0; }
  .status { font-size: 11px; opacity: 0.6; margin-bottom: 4px; }
  .loading { opacity: 0.6; font-style: italic; padding: 8px 0; }
  @keyframes pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }
  .loading { animation: pulse 1.2s ease-in-out infinite; }
</style>
</head>
<body>
<div class="search-box">
  <input id="query" type="text" placeholder="Search schema..." />
</div>
<div class="filters">
  <button class="scope-btn active" data-scope="all">All</button>
  <button class="scope-btn" data-scope="tables">Tables</button>
  <button class="scope-btn" data-scope="columns">Columns</button>
  <div class="sep"></div>
  <button class="type-btn active" data-type="">Any</button>
  <button class="type-btn" data-type="TEXT">TEXT</button>
  <button class="type-btn" data-type="INTEGER">INT</button>
  <button class="type-btn" data-type="REAL">REAL</button>
  <button class="type-btn" data-type="BLOB">BLOB</button>
</div>
<div id="status" class="status"></div>
<ul id="results" class="results"></ul>
<script nonce="${nonce}">
(function() {
  const vscode = acquireVsCodeApi();
  const queryEl = document.getElementById('query');
  const resultsEl = document.getElementById('results');
  const statusEl = document.getElementById('status');
  let scope = 'all';
  let typeFilter = '';
  let debounceTimer;

  document.querySelectorAll('.scope-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.scope-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      scope = btn.dataset.scope;
      doSearch();
    });
  });

  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      typeFilter = btn.dataset.type;
      doSearch();
    });
  });

  queryEl.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(doSearch, 200);
  });

  function doSearch() {
    const msg = { command: 'search', query: queryEl.value, scope, typeFilter: typeFilter || undefined };
    vscode.postMessage(msg);
  }

  window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.command === 'loading') {
      statusEl.textContent = '';
      resultsEl.innerHTML = '<li class="loading">Searching\u2026</li>';
    } else if (msg.command === 'results') {
      renderResults(msg.result, msg.crossRefs);
    }
  });

  function renderResults(result, crossRefs) {
    statusEl.textContent = result.matches.length
      ? result.matches.length + ' match' + (result.matches.length !== 1 ? 'es' : '')
      : '';
    resultsEl.innerHTML = '';
    if (result.matches.length === 0) {
      resultsEl.innerHTML = '<li class="empty">No matches</li>';
      return;
    }
    const refMap = {};
    for (const ref of (crossRefs || [])) refMap[ref.columnName] = ref;

    let lastTable = '';
    for (const m of result.matches) {
      if (m.type === 'table') {
        lastTable = m.table;
        const li = document.createElement('li');
        li.className = 'result-item result-table';
        li.innerHTML = esc(m.table) + ' <span class="result-meta">' +
          m.columnCount + ' cols, ' + m.rowCount + ' rows</span>';
        li.addEventListener('click', () =>
          vscode.postMessage({ command: 'navigate', table: m.table }));
        resultsEl.appendChild(li);
      } else {
        if (m.table !== lastTable) {
          lastTable = m.table;
          const hdr = document.createElement('li');
          hdr.className = 'result-item result-table';
          hdr.textContent = m.table;
          hdr.addEventListener('click', () =>
            vscode.postMessage({ command: 'navigate', table: m.table }));
          resultsEl.appendChild(hdr);
        }
        const li = document.createElement('li');
        li.className = 'result-item result-col';
        li.innerHTML = (m.isPk ? '&#x1f511; ' : '') +
          esc(m.column) + '<span class="result-type">' + esc(m.columnType) + '</span>';
        li.addEventListener('click', () =>
          vscode.postMessage({ command: 'navigate', table: m.table }));
        resultsEl.appendChild(li);

        if (m.alsoIn && m.alsoIn.length > 0) {
          const ref = refMap[m.column];
          const xli = document.createElement('li');
          xli.className = 'cross-ref';
          let html = 'also in: ' + m.alsoIn.map(esc).join(', ');
          if (ref && ref.missingFks.length > 0) {
            const missing = ref.missingFks
              .filter(fk => fk.from === m.table || fk.to === m.table)
              .length;
            if (missing > 0) html += ' <span class="warn">\u26a0 no FK</span>';
          }
          xli.innerHTML = html;
          resultsEl.appendChild(xli);
        }
      }
    }
  }

  function esc(s) {
    const d = document.createElement('span');
    d.textContent = s || '';
    return d.innerHTML;
  }

  // Initial search (empty query = browse all)
  doSearch();
})();
</script>
</body>
</html>`;
}
