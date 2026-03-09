/**
 * Inline JS for rendering query results as a sortable, filterable HTML
 * table in the SQL Notebook webview.  Also handles Copy JSON / Copy CSV.
 *
 * Injected into the HTML scaffold by {@link getNotebookHtml}.
 */
export function getResultsJs(): string {
  return `
  // --- Result Table Rendering ---

  function handleQueryResult(msg) {
    setQueryBusy(false);
    var tab = tabs.find(function (t) { return t.id === msg.tabId; });
    if (!tab) return;
    tab.results = msg.rows;
    tab.columns = msg.columns;
    tab.error = null;
    tab.explain = null;
    if (tab.id === activeTabId) {
      sortColumn = -1;
      sortAsc = true;
      filterText = '';
      renderResults(tab);
      setStatus(msg.rows.length + ' rows (' + msg.elapsed + 'ms)');
      enableExportButtons(true);
    }
    addToHistory(tab.sql, msg.rows.length, msg.elapsed);
  }

  function handleQueryError(msg) {
    setQueryBusy(false);
    var tab = tabs.find(function (t) { return t.id === msg.tabId; });
    if (!tab) return;
    tab.error = msg.error;
    tab.results = null;
    tab.columns = null;
    tab.explain = null;
    if (tab.id === activeTabId) {
      renderError(tab.error);
      setStatus('Error');
      enableExportButtons(false);
    }
    addToHistory(tab.sql, 0, 0, msg.error);
  }

  var sortColumn = -1;
  var sortAsc = true;
  var filterText = '';

  function renderResults(tab) {
    var area = resultArea();
    if (!tab.results || !tab.columns) { area.innerHTML = ''; return; }

    var html = '<input type="text" id="result-filter" class="result-filter" '
      + 'placeholder="Filter rows..." value="' + esc(filterText) + '">';

    html += '<div class="table-wrap"><table class="result-table"><thead><tr>';
    for (var i = 0; i < tab.columns.length; i++) {
      var arrow = sortColumn === i ? (sortAsc ? ' \\u25B2' : ' \\u25BC') : '';
      html += '<th data-col="' + i + '">' + esc(tab.columns[i]) + arrow + '</th>';
    }
    html += '</tr></thead><tbody>';

    var rows = tab.results.slice();
    if (filterText) {
      var lower = filterText.toLowerCase();
      rows = rows.filter(function (row) {
        for (var c = 0; c < row.length; c++) {
          if (String(row[c] != null ? row[c] : '').toLowerCase().indexOf(lower) >= 0) return true;
        }
        return false;
      });
    }
    if (sortColumn >= 0) {
      var col = sortColumn;
      var asc = sortAsc;
      rows.sort(function (a, b) {
        var av = a[col], bv = b[col];
        if (av == null && bv == null) return 0;
        if (av == null) return asc ? -1 : 1;
        if (bv == null) return asc ? 1 : -1;
        if (typeof av === 'number' && typeof bv === 'number') return asc ? av - bv : bv - av;
        var sa = String(av), sb = String(bv);
        return asc ? sa.localeCompare(sb) : sb.localeCompare(sa);
      });
    }

    for (var r = 0; r < rows.length; r++) {
      html += '<tr>';
      for (var c = 0; c < rows[r].length; c++) {
        var cell = rows[r][c];
        var s = cell === null ? 'NULL' : String(cell);
        var display = s.length > 100 ? s.substring(0, 100) + '\\u2026' : s;
        var nullClass = cell === null ? ' class="null-cell"' : '';
        html += '<td' + nullClass + ' title="' + esc(s) + '">' + esc(display) + '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    area.innerHTML = html;

    area.querySelectorAll('th[data-col]').forEach(function (th) {
      th.addEventListener('click', function () {
        var c = Number(th.dataset.col);
        if (sortColumn === c) { sortAsc = !sortAsc; }
        else { sortColumn = c; sortAsc = true; }
        renderResults(tab);
      });
    });

    var filterInput = document.getElementById('result-filter');
    if (filterInput) {
      filterInput.addEventListener('input', function (e) {
        filterText = e.target.value;
        renderResults(tab);
      });
      filterInput.focus();
    }
  }

  function renderError(error) {
    resultArea().innerHTML = '<div class="error-message">' + esc(error) + '</div>';
  }

  // --- Copy JSON ---
  document.getElementById('btn-copy-json').addEventListener('click', function () {
    var tab = getActiveTab();
    if (!tab || !tab.results || !tab.columns) return;
    var objs = tab.results.map(function (row) {
      var obj = {};
      for (var i = 0; i < tab.columns.length; i++) {
        obj[tab.columns[i]] = row[i];
      }
      return obj;
    });
    vscode.postMessage({ command: 'copyToClipboard', text: JSON.stringify(objs, null, 2) });
  });

  // --- Copy CSV ---
  document.getElementById('btn-copy-csv').addEventListener('click', function () {
    var tab = getActiveTab();
    if (!tab || !tab.results || !tab.columns) return;
    function csvCell(v) {
      if (v === null || v === undefined) return '';
      var s = String(v);
      if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\\n') >= 0) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }
    var header = tab.columns.map(csvCell).join(',');
    var rows = tab.results.map(function (r) { return r.map(csvCell).join(','); });
    vscode.postMessage({ command: 'copyToClipboard', text: header + '\\n' + rows.join('\\n') });
  });

  function enableExportButtons(enabled) {
    document.getElementById('btn-chart').disabled = !enabled;
    document.getElementById('btn-copy-json').disabled = !enabled;
    document.getElementById('btn-copy-csv').disabled = !enabled;
  }

  function resultArea() { return document.getElementById('result-area'); }

  function setStatus(text) {
    document.getElementById('status-bar').textContent = text;
  }

  function esc(s) {
    return String(s != null ? s : '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
`;
}
