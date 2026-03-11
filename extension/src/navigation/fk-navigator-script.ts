/**
 * Inline JS injected into the Saropa Drift Advisor webview to render FK links.
 * Kept as a single template string so it can be injected via <script> tag.
 *
 * Extracted to its own file to keep fk-navigator.ts under 300 lines.
 */
export const FK_NAVIGATION_SCRIPT = `
(function() {
  var vscodeApi = window._vscodeApi || (window._vscodeApi = acquireVsCodeApi());
  var fkColumnMap = {};
  var pendingRequests = {};

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function getTableName(table) {
    return table.dataset.tableName ||
      (table.closest('[data-table-name]') || {}).dataset?.tableName ||
      '';
  }

  function getHeaderIndex(table, colName) {
    var ths = table.querySelectorAll('thead th');
    for (var i = 0; i < ths.length; i++) {
      if (ths[i].textContent.trim() === colName) return i;
    }
    return -1;
  }

  function applyFkLinks() {
    document.querySelectorAll('table').forEach(function(table) {
      var name = getTableName(table);
      if (!name) return;
      var links = fkColumnMap[name];
      if (!links) {
        if (!pendingRequests[name]) {
          pendingRequests[name] = true;
          vscodeApi.postMessage({ command: 'fkGetColumns', table: name });
        }
        return;
      }
      links.forEach(function(fk) {
        var idx = getHeaderIndex(table, fk.fromColumn);
        if (idx < 0) return;
        table.querySelectorAll('tbody tr').forEach(function(tr) {
          var td = tr.children[idx];
          if (!td || td.querySelector('a.fk-link')) return;
          var val = td.textContent.trim();
          if (!val || val === 'NULL' || val === 'null') return;
          var a = document.createElement('a');
          a.className = 'fk-link';
          a.href = '#';
          a.textContent = val;
          a.title = fk.toTable + '.' + fk.toColumn + ' = ' + val;
          a.style.cssText = 'color:#4fc3f7;text-decoration:underline;cursor:pointer;';
          a.addEventListener('click', function(e) {
            e.preventDefault();
            vscodeApi.postMessage({
              command: 'fkNavigate',
              toTable: fk.toTable,
              toColumn: fk.toColumn,
              value: val,
            });
          });
          td.textContent = '';
          td.appendChild(a);
        });
      });
    });
  }

  function renderBreadcrumbs(entries, canBack, canForward) {
    var bar = document.getElementById('fk-breadcrumbs');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'fk-breadcrumbs';
      bar.style.cssText =
        'position:sticky;top:0;z-index:100;padding:6px 12px;' +
        'font-size:13px;font-family:system-ui,sans-serif;display:none;' +
        'border-bottom:1px solid rgba(128,128,128,0.3);' +
        'background:var(--vscode-editor-background,#1e1e1e);';
      document.body.prepend(bar);
    }
    if (!entries || entries.length === 0) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';
    bar.style.alignItems = 'center';
    bar.style.gap = '8px';
    var html = '';
    html += '<button class="fk-nav-btn" data-dir="back"' +
      (canBack ? '' : ' disabled') +
      ' style="border:none;background:none;cursor:pointer;color:' +
      (canBack ? '#4fc3f7' : '#666') + ';font-size:14px;">&larr;</button>';
    html += '<button class="fk-nav-btn" data-dir="forward"' +
      (canForward ? '' : ' disabled') +
      ' style="border:none;background:none;cursor:pointer;color:' +
      (canForward ? '#4fc3f7' : '#666') + ';font-size:14px;">&rarr;</button>';
    html += '<span style="color:#ccc;">';
    entries.forEach(function(e, i) {
      if (i > 0) html += ' &rsaquo; ';
      html += esc(e.table);
      if (e.filter) html += ' (' + esc(e.filter.column) + '=' + esc(e.filter.value) + ')';
    });
    html += '</span>';
    bar.innerHTML = html;
    bar.querySelectorAll('.fk-nav-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var dir = btn.getAttribute('data-dir');
        vscodeApi.postMessage({ command: dir === 'back' ? 'fkBack' : 'fkForward' });
      });
    });
  }

  function renderNavigatedTable(table, filter, columns, rows) {
    var overlay = document.getElementById('fk-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'fk-overlay';
      overlay.style.cssText =
        'position:absolute;top:0;left:0;right:0;min-height:100vh;z-index:50;' +
        'background:var(--vscode-editor-background,#1e1e1e);padding:16px;';
      document.body.style.position = 'relative';
      document.body.appendChild(overlay);
    }
    overlay.style.display = 'block';
    var html = '<h3 style="color:#ccc;margin:0 0 12px;font-family:system-ui;">' +
      esc(table);
    if (filter) html += ' WHERE ' + esc(filter.column) + ' = ' + esc(filter.value);
    html += '</h3>';
    html += '<table data-table-name="' + esc(table) +
      '" style="border-collapse:collapse;width:100%;color:#ccc;font-size:13px;">';
    html += '<thead><tr>';
    columns.forEach(function(c) {
      html += '<th style="text-align:left;padding:4px 8px;' +
        'border-bottom:1px solid #555;">' + esc(c) + '</th>';
    });
    html += '</tr></thead><tbody>';
    rows.forEach(function(row) {
      html += '<tr>';
      row.forEach(function(val) {
        var display = val === null ? 'NULL' : String(val);
        html += '<td style="padding:4px 8px;' +
          'border-bottom:1px solid #333;">' + esc(display) + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    overlay.innerHTML = html;
    applyFkLinks();
  }

  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (msg.command === 'fkColumns') {
      delete pendingRequests[msg.table];
      fkColumnMap[msg.table] = msg.fkColumns || [];
      applyFkLinks();
    }
    if (msg.command === 'fkNavigated') {
      renderNavigatedTable(msg.table, msg.filter, msg.columns, msg.rows);
    }
    if (msg.command === 'fkBreadcrumbs') {
      renderBreadcrumbs(msg.entries, msg.canBack, msg.canForward);
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyFkLinks);
  } else {
    applyFkLinks();
  }

  var observer = new MutationObserver(function() { applyFkLinks(); });
  observer.observe(document.body, { childList: true, subtree: true });
})();
`;
