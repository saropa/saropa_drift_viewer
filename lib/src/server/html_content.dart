/// Inline HTML/JS/CSS for the single-page viewer UI.
abstract final class HtmlContent {
  static const String indexHtml = '''
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Drift DB</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; margin: 1rem; background: var(--bg); color: var(--fg); max-width: 100%; overflow-x: hidden; }
    body.theme-light { --bg: #f5f5f5; --fg: #1a1a1a; --bg-pre: #e8e8e8; --border: #ccc; --muted: #666; --link: #1565c0; --highlight-bg: #fff3cd; --highlight-fg: #856404; }
    body.theme-dark, body { --bg: #1a1a1a; --fg: #e0e0e0; --bg-pre: #252525; --border: #444; --muted: #888; --link: #7eb8da; --highlight-bg: #5a4a32; --highlight-fg: #f0e0c0; }
    h1 { font-size: 1.25rem; }
    ul { list-style: none; padding: 0; }
    li { margin: 0.25rem 0; }
    a { color: var(--link); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .content-wrap { max-width: 100%; min-width: 0; }
    pre { background: var(--bg-pre); padding: 1rem; overflow: auto; font-size: 12px; border-radius: 6px; max-height: 70vh; white-space: pre-wrap; word-break: break-word; margin: 0; color: var(--fg); border: 1px solid var(--border); }
    .meta { color: var(--muted); font-size: 0.875rem; margin-bottom: 0.5rem; }
    .search-bar { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; flex-wrap: wrap; }
    .search-bar input, .search-bar select, .search-bar button { padding: 0.35rem 0.5rem; background: var(--bg-pre); border: 1px solid var(--border); color: var(--fg); border-radius: 4px; }
    .search-bar input { min-width: 12rem; }
    .search-bar label { color: var(--muted); font-size: 0.875rem; }
    .highlight { background: var(--highlight-bg); color: var(--highlight-fg); border-radius: 2px; }
    .search-section { margin-bottom: 1rem; }
    .search-section h2 { font-size: 1rem; color: var(--muted); margin: 0 0 0.25rem 0; }
    .toolbar { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 0.5rem; }
    .collapsible-header { cursor: pointer; user-select: none; padding: 0.25rem 0; color: var(--link); }
    .collapsible-header:hover { text-decoration: underline; }
    .collapsible-body { margin-top: 0.25rem; }
    .collapsible-body.collapsed { display: none; }
    .sql-runner { margin-bottom: 1rem; }
    .sql-runner .sql-toolbar { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.35rem; }
    .sql-runner .sql-toolbar select, .sql-runner .sql-toolbar button { padding: 0.35rem 0.5rem; background: var(--bg-pre); border: 1px solid var(--border); color: var(--fg); border-radius: 4px; }
    .sql-runner textarea { width: 100%; min-height: 4rem; font-family: ui-monospace, monospace; font-size: 13px; padding: 0.5rem; background: var(--bg-pre); border: 1px solid var(--border); color: var(--fg); border-radius: 4px; resize: vertical; }
    .sql-runner .sql-result { margin-top: 0.5rem; }
    .sql-runner .sql-result pre { max-height: 50vh; }
    .sql-runner .sql-result table { border-collapse: collapse; width: 100%; font-size: 12px; background: var(--bg-pre); border: 1px solid var(--border); }
    .sql-runner .sql-result th, .sql-runner .sql-result td { border: 1px solid var(--border); padding: 0.35rem 0.5rem; text-align: left; }
    .sql-runner .sql-result th { font-weight: 600; }
    .sql-runner .sql-error { color: #e57373; margin-top: 0.35rem; font-size: 0.875rem; }
    .sql-runner .sql-result, .sql-runner .sql-error { transition: opacity 0.15s ease; }
    .diff-result { transition: opacity 0.2s ease; }
    #live-indicator { font-size: 0.75rem; margin-left: 0.5rem; }
    body.theme-dark #live-indicator { color: #7cb342; }
    body.theme-light #live-indicator { color: #558b2f; }
    #diagram-container { min-height: 200px; }
    .diagram-table rect { fill: var(--bg-pre); stroke: var(--border); stroke-width: 1.5; }
    .diagram-table:hover rect { stroke: var(--link); }
    .diagram-table { cursor: pointer; }
    .diagram-table .diagram-name { font-weight: 600; font-size: 13px; }
    .diagram-table .diagram-col { font-size: 11px; fill: var(--muted); }
    .diagram-link { stroke: var(--muted); stroke-width: 1; fill: none; }
    .chart-bar { fill: var(--link); }
    .chart-bar:hover { fill: var(--fg); }
    .chart-label { font-size: 10px; fill: var(--muted); }
    .chart-axis { stroke: var(--border); stroke-width: 1; }
    .chart-axis-label { font-size: 11px; fill: var(--muted); }
    .chart-line { stroke: var(--link); stroke-width: 2; fill: none; }
    .chart-dot { fill: var(--link); }
    .chart-dot:hover { fill: var(--fg); r: 5; }
    .chart-slice { stroke: var(--bg); stroke-width: 2; cursor: pointer; }
    .chart-slice:hover { opacity: 0.8; }
    .chart-legend { font-size: 11px; fill: var(--fg); }
  </style>
</head>
<body>
  <h1>Drift tables <button type="button" id="theme-toggle" title="Toggle light/dark">Theme</button> <button type="button" id="share-btn" title="Share current view with your team" style="font-size:11px;">Share</button> <span id="live-indicator" class="meta" title="Table view updates when data changes">● Live</span></h1>
  <div class="collapsible-header sql-runner" id="sql-runner-toggle">▼ Run SQL (read-only)</div>
  <div id="sql-runner-collapsible" class="collapsible-body collapsed sql-runner">
    <div class="sql-toolbar">
      <label for="sql-template">Template:</label>
      <select id="sql-template">
        <option value="custom">Custom</option>
        <option value="select-star-limit">SELECT * FROM table LIMIT 10</option>
        <option value="select-star">SELECT * FROM table</option>
        <option value="count">SELECT COUNT(*) FROM table</option>
        <option value="select-fields">SELECT columns FROM table LIMIT 10</option>
      </select>
      <label for="sql-table">Table:</label>
      <select id="sql-table"><option value="">—</option></select>
      <label for="sql-fields">Fields:</label>
      <select id="sql-fields" multiple title="Hold Ctrl/Cmd to pick multiple"><option value="">—</option></select>
      <button type="button" id="sql-apply-template">Apply template</button>
      <button type="button" id="sql-run">Run</button>
      <button type="button" id="sql-explain">Explain</button>
      <label for="sql-history">History:</label>
      <select id="sql-history" title="Recent queries — select to reuse"><option value="">— Recent —</option></select>
    </div>
    <div class="sql-toolbar" style="margin-top:0;">
      <label for="sql-bookmarks">Bookmarks:</label>
      <select id="sql-bookmarks" title="Saved queries" style="max-width:14rem;"><option value="">— Bookmarks —</option></select>
      <button type="button" id="sql-bookmark-save" title="Save current query as bookmark">Save</button>
      <button type="button" id="sql-bookmark-delete" title="Delete selected bookmark">Del</button>
      <button type="button" id="sql-bookmark-export" title="Export bookmarks as JSON">Export</button>
      <button type="button" id="sql-bookmark-import" title="Import bookmarks from JSON">Import</button>
      <label for="sql-result-format">Show as:</label>
      <select id="sql-result-format"><option value="table">Table</option><option value="json">JSON</option></select>
    </div>
    <div class="sql-toolbar" style="margin-bottom:0.35rem;">
      <label for="nl-input">Ask in English:</label>
      <input type="text" id="nl-input" placeholder="e.g. how many users were created today?" style="flex:1;min-width:20rem;" />
      <button type="button" id="nl-convert">Convert to SQL</button>
    </div>
    <textarea id="sql-input" placeholder="SELECT * FROM my_table LIMIT 10"></textarea>
    <div id="sql-error" class="sql-error" style="display: none;"></div>
    <div id="sql-result" class="sql-result" style="display: none;"></div>
    <div id="chart-controls" class="sql-toolbar" style="display:none;margin-top:0.5rem;">
      <label for="chart-type">Chart:</label>
      <select id="chart-type">
        <option value="none">None</option>
        <option value="bar">Bar</option>
        <option value="pie">Pie</option>
        <option value="line">Line / Time series</option>
        <option value="histogram">Histogram</option>
      </select>
      <label for="chart-x">X / Label:</label>
      <select id="chart-x"></select>
      <label for="chart-y">Y / Value:</label>
      <select id="chart-y"></select>
      <button type="button" id="chart-render">Render</button>
    </div>
    <div id="chart-container" style="display:none;margin-top:0.5rem;"></div>
  </div>
  <div class="search-bar">
    <label for="search-input">Search:</label>
    <input type="text" id="search-input" placeholder="Search…" />
    <label for="search-scope">in</label>
    <select id="search-scope">
      <option value="schema">Schema only</option>
      <option value="data">DB data only</option>
      <option value="both">Both</option>
    </select>
    <label for="row-filter">Filter rows:</label>
    <input type="text" id="row-filter" placeholder="Column value…" title="Client-side filter on current table" />
  </div>
  <div id="pagination-bar" class="toolbar" style="display: none;">
    <label>Limit</label>
    <select id="pagination-limit"></select>
    <label>Offset</label>
    <input type="number" id="pagination-offset" min="0" step="200" style="width: 5rem;" />
    <button type="button" id="pagination-prev">Prev</button>
    <button type="button" id="pagination-next">Next</button>
    <button type="button" id="pagination-apply">Apply</button>
  </div>
  <p id="tables-loading" class="meta">Loading tables…</p>
  <p class="meta"><a href="/api/schema" id="export-schema" download="schema.sql">Export schema (no data)</a> · <a href="#" id="export-dump">Export full dump (schema + data)</a><span id="export-dump-status" class="meta"></span> · <a href="#" id="export-database">Download database (raw .sqlite)</a><span id="export-database-status" class="meta"></span> · <a href="#" id="export-csv">Export table as CSV</a><span id="export-csv-status" class="meta"></span></p>
  <div class="collapsible-header" id="snapshot-toggle">▼ Snapshot / time travel</div>
  <div id="snapshot-collapsible" class="collapsible-body collapsed">
    <p class="meta">Capture current DB state, then compare to now to see what changed.</p>
    <div class="toolbar">
      <button type="button" id="snapshot-take">Take snapshot</button>
      <button type="button" id="snapshot-compare" disabled title="Take a snapshot first">Compare to now</button>
      <a href="#" id="snapshot-export-diff" style="display: none;">Export diff (JSON)</a>
      <button type="button" id="snapshot-clear" style="display: none;">Clear snapshot</button>
    </div>
    <p id="snapshot-status" class="meta"></p>
    <pre id="snapshot-compare-result" class="meta diff-result" style="display: none; max-height: 40vh;"></pre>
  </div>
  <div class="collapsible-header" id="compare-toggle">▼ Database diff</div>
  <div id="compare-collapsible" class="collapsible-body collapsed">
    <p class="meta">Compare this DB with another (e.g. staging). Requires queryCompare at startup.</p>
    <div class="toolbar">
      <button type="button" id="compare-view">View diff report</button>
      <a href="/api/compare/report?format=download" id="compare-export">Export diff report</a>
      <button type="button" id="migration-preview">Migration Preview</button>
    </div>
    <p id="compare-status" class="meta"></p>
    <pre id="compare-result" class="meta diff-result" style="display: none; max-height: 40vh;"></pre>
  </div>
  <div class="collapsible-header" id="index-toggle">▼ Index suggestions</div>
  <div id="index-collapsible" class="collapsible-body collapsed">
    <p class="meta">Analyze tables for missing indexes based on schema patterns.</p>
    <button type="button" id="index-analyze">Analyze</button>
    <div id="index-results" style="display:none;"></div>
  </div>
  <div class="collapsible-header" id="size-toggle">▼ Database size analytics</div>
  <div id="size-collapsible" class="collapsible-body collapsed">
    <p class="meta">Analyze database storage: total size, page stats, and per-table breakdown.</p>
    <button type="button" id="size-analyze">Analyze</button>
    <div id="size-results" style="display:none;"></div>
  </div>
  <div class="collapsible-header" id="perf-toggle">▼ Query performance</div>
  <div id="perf-collapsible" class="collapsible-body collapsed">
    <p class="meta">Track query execution times, identify slow queries, and view patterns.</p>
    <div class="toolbar">
      <button type="button" id="perf-refresh">Refresh</button>
      <button type="button" id="perf-clear">Clear</button>
    </div>
    <div id="perf-results" style="display:none;"></div>
  </div>
  <div class="collapsible-header" id="anomaly-toggle">▼ Data health</div>
  <div id="anomaly-collapsible" class="collapsible-body collapsed">
    <p class="meta">Scan all tables for data quality issues: NULLs, empty strings, orphaned FKs, duplicates, outliers.</p>
    <button type="button" id="anomaly-analyze">Scan for anomalies</button>
    <div id="anomaly-results" style="display:none;"></div>
  </div>
  <div class="collapsible-header" id="import-toggle">▼ Import data (debug only)</div>
  <div id="import-collapsible" class="collapsible-body collapsed">
    <p class="meta" style="color:#e57373;font-weight:bold;">Warning: This modifies the database. Debug use only.</p>
    <div class="sql-runner">
      <div class="sql-toolbar">
        <label>Table:</label>
        <select id="import-table"></select>
        <label>Format:</label>
        <select id="import-format">
          <option value="json">JSON</option>
          <option value="csv">CSV</option>
          <option value="sql">SQL</option>
        </select>
      </div>
      <div class="sql-toolbar" style="margin-top:0.25rem;">
        <input type="file" id="import-file" accept=".json,.csv,.sql" />
        <button type="button" id="import-run" disabled>Import</button>
      </div>
    </div>
    <pre id="import-preview" class="meta" style="display:none;max-height:15vh;overflow:auto;font-size:11px;"></pre>
    <p id="import-status" class="meta"></p>
  </div>
  <div class="collapsible-header" id="schema-toggle">▼ Schema</div>
  <div id="schema-collapsible" class="collapsible-body collapsed"><pre id="schema-inline-pre" class="meta">Loading…</pre></div>
  <div class="collapsible-header" id="diagram-toggle">▼ Schema diagram</div>
  <div id="diagram-collapsible" class="collapsible-body collapsed">
    <p class="meta">Tables and relationships. Click a table to view its data.</p>
    <div id="diagram-container"></div>
  </div>
  <ul id="tables"></ul>
  <div id="content" class="content-wrap"></div>
  <script>
    var DRIFT_VIEWER_AUTH_TOKEN = "";
    function authOpts(o) {
      o = o || {}; o.headers = o.headers || {};
      if (DRIFT_VIEWER_AUTH_TOKEN) o.headers['Authorization'] = 'Bearer ' + DRIFT_VIEWER_AUTH_TOKEN;
      return o;
    }
    // --- Natural language to SQL ---
    var schemaMeta = null;
    async function loadSchemaMeta() {
      if (schemaMeta) return schemaMeta;
      var r = await fetch('/api/schema/metadata', authOpts());
      if (!r.ok) throw new Error('Failed to load schema metadata (HTTP ' + r.status + ')');
      schemaMeta = await r.json();
      return schemaMeta;
    }
    function nlToSql(question, meta) {
      var q = question.toLowerCase().trim();
      var tables = meta.tables || [];
      var target = null;
      for (var i = 0; i < tables.length; i++) {
        var t = tables[i];
        var name = t.name.toLowerCase();
        var singular = name.endsWith('s') ? name.slice(0, -1) : name;
        if (q.includes(name) || q.includes(singular)) { target = t; break; }
      }

      if (!target && tables.length === 1) target = tables[0];
      if (!target) return { sql: null, error: 'Could not identify a table from your question.' };
      var mentioned = target.columns.filter(function (c) {
        return q.includes(c.name.toLowerCase().replace(/_/g, ' ')) || q.includes(c.name.toLowerCase());
      });
      var selectCols = mentioned.length > 0
        ? mentioned.map(function (c) { return '"' + c.name + '"'; }).join(', ')
        : '*';
      var sql = '';
      var tn = '"' + target.name + '"';
      if (/how many|count|total number/i.test(q)) {
        sql = 'SELECT COUNT(*) FROM ' + tn;
      } else if (/average|avg|mean/i.test(q)) {
        var numCol = (mentioned.find(function (c) { return /int|real|num|float/i.test(c.type); })) ||
          target.columns.find(function (c) { return /int|real|num|float/i.test(c.type); });
        sql = numCol ? 'SELECT AVG("' + numCol.name + '") FROM ' + tn : 'SELECT * FROM ' + tn + ' LIMIT 50';
      } else if (/sum|total\b/i.test(q) && !/total number/i.test(q)) {
        var numCol = (mentioned.find(function (c) { return /int|real|num|float/i.test(c.type); })) ||
          target.columns.find(function (c) { return /int|real|num|float/i.test(c.type); });
        sql = numCol ? 'SELECT SUM("' + numCol.name + '") FROM ' + tn : 'SELECT * FROM ' + tn + ' LIMIT 50';
      } else if (/max|maximum|highest|largest|biggest/i.test(q)) {
        var numCol = (mentioned.find(function (c) { return /int|real|num|float/i.test(c.type); })) ||
          target.columns.find(function (c) { return /int|real|num|float/i.test(c.type); });
        sql = numCol ? 'SELECT MAX("' + numCol.name + '") FROM ' + tn : 'SELECT * FROM ' + tn + ' ORDER BY 1 DESC LIMIT 1';
      } else if (/min|minimum|lowest|smallest/i.test(q)) {
        var numCol = (mentioned.find(function (c) { return /int|real|num|float/i.test(c.type); })) ||
          target.columns.find(function (c) { return /int|real|num|float/i.test(c.type); });
        sql = numCol ? 'SELECT MIN("' + numCol.name + '") FROM ' + tn : 'SELECT * FROM ' + tn + ' ORDER BY 1 ASC LIMIT 1';
      } else if (/distinct|unique/i.test(q)) {
        var col = mentioned[0] || target.columns[1] || target.columns[0];
        sql = 'SELECT DISTINCT "' + col.name + '" FROM ' + tn;
      } else if (/latest|newest|most recent|last (\d+)/i.test(q)) {
        var dateCol = target.columns.find(function (c) { return /date|time|created|updated/i.test(c.name); });
        var match = q.match(/last (\d+)/i);
        var limit = match ? parseInt(match[1]) : 10;
        sql = 'SELECT ' + selectCols + ' FROM ' + tn + (dateCol ? ' ORDER BY "' + dateCol.name + '" DESC' : '') + ' LIMIT ' + limit;
      } else if (/oldest|earliest|first (\d+)/i.test(q)) {
        var dateCol = target.columns.find(function (c) { return /date|time|created|updated/i.test(c.name); });
        var match2 = q.match(/first (\d+)/i);
        var limit = match2 ? parseInt(match2[1]) : 10;
        sql = 'SELECT ' + selectCols + ' FROM ' + tn + (dateCol ? ' ORDER BY "' + dateCol.name + '" ASC' : '') + ' LIMIT ' + limit;
      } else if (/group by|per\s+\w+|by\s+\w+/i.test(q)) {
        var groupCol = mentioned[0] || target.columns[1] || target.columns[0];
        sql = 'SELECT "' + groupCol.name + '", COUNT(*) AS count FROM ' + tn + ' GROUP BY "' + groupCol.name + '" ORDER BY count DESC';
      } else {
        sql = 'SELECT ' + selectCols + ' FROM ' + tn + ' LIMIT 50';
      }
      return { sql: sql, table: target.name };
    }

    function esc(s) {
      if (s == null) return '';
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }
    function escapeRe(s) {
      return s.replace(/[\\\\^\$*+?.()|[\\]{}]/g, '\\\\\$&');
    }
    function highlightText(text, term) {
      if (!term || term.length === 0) return esc(text);
      const re = new RegExp('(' + escapeRe(term) + ')', 'gi');
      var result = '';
      var lastEnd = 0;
      var match;
      while ((match = re.exec(text)) !== null) {
        result += esc(text.slice(lastEnd, match.index)) + '<span class="highlight">' + esc(match[1]) + '</span>';
        lastEnd = re.lastIndex;
      }
      result += esc(text.slice(lastEnd));
      return result;
    }
    function renderDiffRows(rows, type) {
      if (rows.length === 0) return '';
      var keys = Object.keys(rows[0]);
      var bgColor = type === 'added' ? 'rgba(124,179,66,0.15)' : 'rgba(229,115,115,0.15)';
      var html = '<table style="border-collapse:collapse;width:100%;font-size:11px;margin-bottom:0.3rem;">';
      html += '<tr>' + keys.map(function(k) {
        return '<th style="border:1px solid var(--border);padding:2px 4px;">' + esc(k) + '</th>';
      }).join('') + '</tr>';
      rows.forEach(function(r) {
        html += '<tr style="background:' + bgColor + ';">' + keys.map(function(k) {
          return '<td style="border:1px solid var(--border);padding:2px 4px;">' + esc(String(r[k] != null ? r[k] : '')) + '</td>';
        }).join('') + '</tr>';
      });
      html += '</table>';
      return html;
    }
    function renderRowDiff(container, tables) {
      var html = '';
      tables.forEach(function(t) {
        html += '<h4 style="margin:0.5rem 0 0.25rem;">' + esc(t.table) + '</h4>';
        html += '<p class="meta">Then: ' + t.countThen + ' rows | Now: ' + t.countNow + ' rows</p>';
        if (!t.hasPk) {
          html += '<p class="meta" style="color:var(--muted);">No primary key \u2014 showing counts only.</p>';
          html += '<p class="meta">Added: ' + t.added + ' | Removed: ' + t.removed + ' | Unchanged: ' + t.unchanged + '</p>';
       
   return;
        }
        if (t.addedRows && t.addedRows.length > 0) {
          html += '<p class="meta" style="color:#7cb342;">+ ' + t.addedRows.length + ' added:</p>';
          html += renderDiffRows(t.addedRows, 'added');
        }
        if (t.removedRows && t.removedRows.length > 0) {
          html += '<p class="meta" style="color:#e57373;">- ' + t.removedRows.length + ' removed:</p>';
          html += renderDiffRows(t.removedRows, 'removed');
        }
        if (t.changedRows && t.changedRows.length > 0) {
          html += '<p class="meta" style="color:#ffb74d;">~ ' + t.changedRows.length + ' changed:</p>';
          t.changedRows.forEach(function(cr) {
            var keys = Object.keys(cr.now);
            var changed = new Set(cr.changedColumns || []);
            html += '<table style="border-collapse:collapse;width:100%;font-size:11px;margin-bottom:0.4rem;">';
            html += '<tr>' + keys.map(function(k) {
              return '<th style="border:1px solid var(--border);padding:2px 4px;' + (changed.has(k) ? 'background:rgba(255,183,77,0.2);' : '') + '">' + esc(k) + '</th>';
            }).join('') + '</tr>';
            html += '<tr>' + keys.map(function(k) {
              var isChanged = changed.has(k);
              return '<td style="border:1px solid var(--border);padding:2px 4px;' + (isChanged ? 'background:rgba(229,115,115,0.2);text-decoration:line-through;' : '') + '">' + esc(String(cr.then[k] != null ? cr.then[k] : '')) + '</td>';
            }).join('') + '</tr>';
            html += '<tr>' + keys.map(function(k) {
              var isChanged = changed.has(k);
              return '<td style="border:1px solid var(--border);padding:2px 4px;' + (isChanged ? 'background:rgba(124,179,66,0.2);font-weight:bold;' : '') + '">' + esc(String(cr.now[k] != null ? cr.now[k] : '')) + '</td>';
            }).join('') + '</tr>';
            html += '</table>';
          });
        }
        if ((!t.addedRows || t.addedRows.length === 0) && (!t.removedRows || t.removedRows.length === 0) && (!t.changedRows || t.changedRows.length === 0)) {
          html += '<p class="meta" style="color:#7cb342;">No changes detected.</p>';
        }
      });
      container.innerHTML = html;
    }
    const THEME_KEY = 'drift-viewer-theme';
    // SQL runner query history: persist the last N successful SQL statements (not results)
    // so repeat checks are quick while keeping localStorage small.
    const SQL_HISTORY_KEY = 'drift-viewer-sql-history';
    const SQL_HISTORY_MAX = 20;
    const LIMIT_OPTIONS = [50, 200, 500, 1000];
    let cachedSchema = null;
    let currentTableName = null;
    let currentTableJson = null;
    let lastRenderedSchema = null;
    let lastRenderedData = null;
    let limit = 200;
    let offset = 0;
    let tableCounts = {};
    let rowFilter = '';
    let lastGeneration = 0;
    let refreshInFlight = false;
    let sqlHistory = [];
    const BOOKMARKS_KEY = 'drift-viewer-sql-bookmarks';
    let sqlBookmarks = [];

    function loadSqlHistory() {
      sqlHistory = [];
      try {
        const raw = localStorage.getItem(SQL_HISTORY_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return;
        sqlHistory = parsed
          .map((h) => {
            const sql = h && typeof h.sql === 'string' ? h.sql.trim() : '';
            if (!sql) return null;
            const rowCount = h && typeof h.rowCount === 'number' ? h.rowCount : null;
            const at = h && typeof h.at === 'string' ? h.at : null;
            return { sql: sql, rowCount: rowCount, at: at };
          })
          .filter(Boolean)
          .slice(0, SQL_HISTORY_MAX);
      } catch (e) { sqlHistory = []; }
    }
    function saveSqlHistory() {
      try {
        localStorage.setItem(SQL_HISTORY_KEY, JSON.stringify(sqlHistory));
      } catch (e) {}
    }
    function refreshHistoryDropdown(sel) {
      if (!sel) return;
      const cur = sel.value;
      sel.innerHTML = '<option value="">— Recent —</option>' + sqlHistory.map((h, i) => {
        const preview = h.sql.length > 50 ? h.sql.slice(0, 47) + '…' : h.sql;
        const rows = h.rowCount != null ? (h.rowCount + ' row(s)') : '';
        const at = h.at ? new Date(h.at).toLocaleString() : '';
        const label = [rows, at, preview].filter(Boolean).join(' · ');
        return '<option value="' + i + '" title="' + esc(h.sql) + '">' + esc(label) + '</option>';
      }).join('');
      if (cur !== '' && parseInt(cur, 10) < sqlHistory.length) sel.value = cur;
    }
    function pushSqlHistory(sql, rowCount) {
      sql = (sql || '').trim();
      if (!sql) return;
      const at = new Date().toISOString();
      sqlHistory = [{ sql: sql, rowCount: rowCount, at: at }].concat(sqlHistory.filter(h => h.sql !== sql));
      sqlHistory = sqlHistory.slice(0, SQL_HISTORY_MAX);
      saveSqlHistory();
    }

    // --- Shared: bind a dropdown so selecting an item loads its .sql into the input ---
    function bindDropdownToInput(sel, items, inputEl) {
      if (!sel || !inputEl) return;
      sel.addEventListener('change', function() {
        const idx = parseInt(this.value, 10);
        if (!isNaN(idx) && items[idx]) inputEl.value = items[idx].sql;
      });
    }

    // --- Bookmarks: localStorage CRUD ---
    function loadBookmarks() {
      sqlBookmarks = [];
      try {
        const raw = localStorage.getItem(BOOKMARKS_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return;
        sqlBookmarks = parsed
          .map(function(b) {
            const name = b && typeof b.name === 'string' ? b.name.trim() : '';
            const sql = b && typeof b.sql === 'string' ? b.sql.trim() : '';
            if (!name || !sql) return null;
            const createdAt = b && typeof b.createdAt === 'string' ? b.createdAt : null;
            return { name: name, sql: sql, createdAt: createdAt };
          })
          .filter(Boolean);
      } catch (e) { sqlBookmarks = []; }
    }
    function saveBookmarks() {
      try {
        localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(sqlBookmarks));
      } catch (e) {}
    }
    function refreshBookmarksDropdown(sel) {
      if (!sel) return;
      const cur = sel.value;
      sel.innerHTML = '<option value="">— Bookmarks (' + sqlBookmarks.length + ') —</option>' +
        sqlBookmarks.map(function(b, i) {
          return '<option value="' + i + '" title="' + esc(b.sql) + '">' + esc(b.name) + '</option>';
        }).join('');
      if (cur !== '' && parseInt(cur, 10) < sqlBookmarks.length) sel.value = cur;
    }
    function addBookmark(inputEl, bookmarksSel) {
      const sql = inputEl.value.trim();
      if (!sql) return;
      const name = prompt('Bookmark name:', sql.slice(0, 40));
      if (!name) return;
      sqlBookmarks.unshift({ name: name, sql: sql, createdAt: new Date().toISOString() });
      saveBookmarks();
      refreshBookmarksDropdown(bookmarksSel);
    }
    function deleteBookmark(bookmarksSel) {
      const idx = parseInt(bookmarksSel.value, 10);
      if (isNaN(idx) || !sqlBookmarks[idx]) return;
      if (!confirm('Delete bookmark "' + sqlBookmarks[idx].name + '"?')) return;
      sqlBookmarks.splice(idx, 1);
      saveBookmarks();
      refreshBookmarksDropdown(bookmarksSel);
    }
    function exportBookmarks() {
      if (sqlBookmarks.length === 0) { alert('No bookmarks to export.'); return; }
      const blob = new Blob([JSON.stringify(sqlBookmarks, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'drift-viewer-bookmarks.json';
      a.click();
      URL.revokeObjectURL(url);
    }
    function importBookmarks(bookmarksSel) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = function() {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function() {
          try {
            const imported = JSON.parse(reader.result);
            if (!Array.isArray(imported)) throw new Error('Expected JSON array');
            let newCount = 0;
            imported.forEach(function(b) {
              if (b.name && b.sql && !sqlBookmarks.some(function(e) { return e.sql === b.sql; })) {
                sqlBookmarks.push({ name: b.name, sql: b.sql, createdAt: b.createdAt || new Date().toISOString() });
                newCount++;
              }
            });
            saveBookmarks();
            refreshBookmarksDropdown(bookmarksSel);
            alert('Imported ' + newCount + ' new bookmark(s). ' + (imported.length - newCount) + ' duplicate(s) skipped.');
          } catch (e) {
            alert('Invalid bookmark file: ' + e.message);
          }
        };
        reader.readAsText(file);
      };
      input.click();
    }

    function initTheme() {
      const saved = localStorage.getItem(THEME_KEY);
      const dark = saved !== 'light';
      document.body.classList.toggle('theme-light', !dark);
      document.body.classList.toggle('theme-dark', dark);
      document.getElementById('theme-toggle').textContent = dark ? 'Dark' : 'Light';
    }
    document.getElementById('theme-toggle').addEventListener('click', function() {
      const isLight = document.body.classList.contains('theme-light');
      document.body.classList.toggle('theme-light', isLight);
      document.body.classList.toggle('theme-dark', !isLight);
      localStorage.setItem(THEME_KEY, isLight ? 'dark' : 'light');
      document.getElementById('theme-toggle').textContent = isLight ? 'Dark' : 'Light';
    });
    initTheme();

    if (DRIFT_VIEWER_AUTH_TOKEN) {
      var schemaLink = document.getElementById('export-schema');
      if (schemaLink) schemaLink.href = '/api/schema';
    }

    document.getElementById('schema-toggle').addEventListener('click', function() {
      const el = document.getElementById('schema-collapsible');
      const isCollapsed = el.classList.contains('collapsed');
      el.classList.toggle('collapsed', !isCollapsed);
      this.textContent = isCollapsed ? '▲ Schema' : '▼ Schema';
      if (isCollapsed && cachedSchema === null) {
        fetch('/api/schema', authOpts()).then(r => r.text()).then(schema => {
          cachedSchema = schema;
          document.getElementById('schema-inline-pre').textContent = schema;
        }).catch(() => { document.getElementById('schema-inline-pre').textContent = 'Failed to load.'; });
      }
    });

    (function initDiagram() {
      const toggle = document.getElementById('diagram-toggle');
      const collapsible = document.getElementById('diagram-collapsible');
      const container = document.getElementById('diagram-container');
      if (!toggle || !collapsible || !container) return;
      const BOX_W = 200;
      const BOX_H = 160;
      const PAD = 12;
      const COLS = 4;
      let diagramData = null;

      function tablePos(index) {
        const row = Math.floor(index / COLS);
        const col = index % COLS;
        return { x: col * (BOX_W + PAD) + PAD, y: row * (BOX_H + PAD) + PAD };
      }

      function renderDiagram(data) {
        const tables = data.tables || [];
        const fks = data.foreignKeys || [];
        if (tables.length === 0) {
          container.innerHTML = '<p class="meta">No tables.</p>';
       
   return;
        }
        const rows = Math.ceil(tables.length / COLS);
        const width = COLS * (BOX_W + PAD) + PAD;
        const height = rows * (BOX_H + PAD) + PAD;
        const nameToIndex = {};
        tables.forEach((t, i) => { nameToIndex[t.name] = i; });
        const getCenter = (index, side) => {
          const p = tablePos(index);
          const cx = p.x + BOX_W / 2;
          const cy = p.y + BOX_H / 2;
          if (side === 'right') return { x: p.x + BOX_W, y: cy };
          if (side === 'left') return { x: p.x, y: cy };
          return { x: cx, y: cy };
        };

        let svg = '<svg width="' + width + '" height="' + height + '" xmlns="http://www.w3.org/2000/svg">';
        svg += '<g class="diagram-links">';
        fks.forEach(function(fk) {
          const iFrom = nameToIndex[fk.fromTable];
          const iTo = nameToIndex[fk.toTable];
          if (iFrom == null || iTo == null) return;
          const from = getCenter(iFrom, 'right');
          const to = getCenter(iTo, 'left');
          const mid = (from.x + to.x) / 2;
          svg += '<path class="diagram-link" d="M' + from.x + ',' + from.y + ' C' + mid + ',' + from.y + ' ' + mid + ',' + to.y + ' ' + to.x + ',' + to.y + '" />';
        });
        svg += '</g><g class="diagram-tables">';
        tables.forEach(function(t, i) {
          const p = tablePos(i);
          const cols = (t.columns || []).slice(0, 6);
          const name = esc(t.name);
          let body = cols.map(function(c) {
            const pk = c.pk ? ' <tspan class="diagram-pk">PK</tspan>' : '';
            return '<tspan class="diagram-col" x="' + (p.x + 8) + '" dy="16">' + esc(c.name) + (c.type ? ' ' + esc(c.type) : '') + pk + '</tspan>';
          }).join('');
          if ((t.columns || []).length > 6) body += '<tspan class="diagram-col" x="' + (p.x + 8) + '" dy="16">…</tspan>';
          svg += '<g class="diagram-table" data-table="' + name + '" transform="translate(' + p.x + ',' + p.y + ')">';
          svg += '<rect width="' + BOX_W + '" height="' + BOX_H + '" rx="4"/>';
          svg += '<text class="diagram-name" x="8" y="22" style="fill: var(--link);">' + name + '</text>';
          svg += '<text x="8" y="38">' + body + '</text>';
          svg += '</g>';
        });
        svg += '</g></svg>';
        container.innerHTML = svg;

        container.querySelectorAll('.diagram-table').forEach(function(g) {
          g.addEventListener('click', function() {
            const name = this.getAttribute('data-table');
            if (name) loadTable(name);
          });
        });
      }

      toggle.addEventListener('click', function() {
        const isCollapsed = collapsible.classList.contains('collapsed');
        collapsible.classList.toggle('collapsed', !isCollapsed);
        this.textContent = isCollapsed ? '▲ Schema diagram' : '▼ Schema diagram';
        if (isCollapsed && diagramData === null) {
          container.innerHTML = '<p class="meta">Loading…</p>';
          fetch('/api/schema/diagram', authOpts())
            .then(r => r.json())
            .then(function(data) {
              diagramData = data;
              renderDiagram(data);
            })
            .catch(function(e) {
              container.innerHTML = '<p class="meta">Failed to load diagram: ' + esc(String(e)) + '</p>';
            });
        } else if (isCollapsed && diagramData) {
          renderDiagram(diagramData);
        }
      });
    })();

    (function initSnapshot() {
      const toggle = document.getElementById('snapshot-toggle');
      const collapsible = document.getElementById('snapshot-collapsible');
      const takeBtn = document.getElementById('snapshot-take');
      const compareBtn = document.getElementById('snapshot-compare');
      const exportLink = document.getElementById('snapshot-export-diff');
      const clearBtn = document.getElementById('snapshot-clear');
      const statusEl = document.getElementById('snapshot-status');
      const resultPre = document.getElementById('snapshot-compare-result');
      function updateSnapshotUI(hasSnapshot, createdAt) {
        compareBtn.disabled = !hasSnapshot;
        exportLink.style.display = hasSnapshot ? '' : 'none';
        clearBtn.style.display = hasSnapshot ? '' : 'none';
        if (exportLink.style.display !== 'none' && DRIFT_VIEWER_AUTH_TOKEN) {
          exportLink.href = '/api/snapshot/compare?detail=rows&format=download';
        } else if (hasSnapshot) exportLink.href = '/api/snapshot/compare?detail=rows&format=download';
        statusEl.textContent = hasSnapshot ? ('Snapshot: ' + (createdAt || '')) : 'No snapshot.';
      }
      function refreshSnapshotStatus() {
        fetch('/api/snapshot', authOpts()).then(r => r.json()).then(function(data) {
          const snap = data.snapshot;
          updateSnapshotUI(!!snap, snap ? snap.createdAt : null);
        }).catch(function() { updateSnapshotUI(false); });
      }

      if (toggle && collapsible) {
        toggle.addEventListener('click', function() {
          const isCollapsed = collapsible.classList.contains('collapsed');
          collapsible.classList.toggle('collapsed', !isCollapsed);
          this.textContent = isCollapsed ? '▲ Snapshot / time travel' : '▼ Snapshot / time travel';
          if (isCollapsed) refreshSnapshotStatus();
        });
      }

      if (takeBtn) takeBtn.addEventListener('click', function() {
        takeBtn.disabled = true;
        statusEl.textContent = 'Capturing…';
        fetch('/api/snapshot', authOpts({ method: 'POST' }))
          .then(r => r.json().then(function(d) { return { ok: r.ok, data: d }; }))
          .then(function(o) {
            if (o.ok) {
              updateSnapshotUI(true, o.data.createdAt);
              statusEl.textContent = 'Snapshot saved at ' + o.data.createdAt;
            } else statusEl.textContent = o.data.error || 'Failed';
          })
          .catch(function(e) { statusEl.textContent = 'Error: ' + e.message; })
          .finally(function() { takeBtn.disabled = false; });
      });
      if (compareBtn) compareBtn.addEventListener('click', function() {
        compareBtn.disabled = true;
        resultPre.style.display = 'none';
        statusEl.textContent = 'Comparing…';
        fetch('/api/snapshot/compare?detail=rows', authOpts())
          .then(r => r.json().then(function(d) { return { ok: r.ok, data: d }; }))
          .then(function(o) {
            if (o.ok) {
              if (o.data.tables) {
                renderRowDiff(resultPre, o.data.tables);
              } else {
                resultPre.textContent = JSON.stringify(o.data, null, 2);
              }
              resultPre.style.display = 'block';
              statusEl.textContent = '';
            } else {
              statusEl.textContent = o.data.error || 'Compare failed';
            }
          })
          .catch(function(e) { statusEl.textContent = 'Error: ' + e.message; })
          .finally(function() { compareBtn.disabled = false; });
      });
      if (clearBtn) clearBtn.addEventListener('click', function() {
        clearBtn.disabled = true;
        statusEl.textContent = 'Clearing…';
        fetch('/api/snapshot', authOpts({ method: 'DELETE' }))
          .then(function() { updateSnapshotUI(false); resultPre.style.display = 'none'; refreshSnapshotStatus(); })
          .catch(function(e) { statusEl.textContent = 'Error: ' + e.message; })
          .finally(function() { clearBtn.disabled = false; });
      });
      refreshSnapshotStatus();
    })();

    (function initCompare() {
      const toggle = document.getElementById('compare-toggle');
      const collapsible = document.getElementById('compare-collapsible');
      const viewBtn = document.getElementById('compare-view');
      const exportLink = document.getElementById('compare-export');
      const statusEl = document.getElementById('compare-status');
      const resultPre = document.getElementById('compare-result');
      if (DRIFT_VIEWER_AUTH_TOKEN && exportLink) {
        exportLink.href = '/api/compare/report?format=download';
      }

      if (toggle && collapsible) {
        toggle.addEventListener('click', function() {
          const isCollapsed = collapsible.classList.contains('collapsed');
          collapsible.classList.toggle('collapsed', !isCollapsed);
          this.textContent = isCollapsed ? '▲ Database diff' : '▼ Database diff';
        });
      }

      if (viewBtn) viewBtn.addEventListener('click', function() {
        viewBtn.disabled = true;
        resultPre.style.display = 'none';
        statusEl.textContent = 'Loading…';
        fetch('/api/compare/report', authOpts())
          .then(r => r.json().then(function(d) { return { status: r.status, data: d }; }))
          .then(function(o) {
            if (o.status === 501) {
              statusEl.textContent = 'Database compare not configured. Pass queryCompare to DriftDebugServer.start to compare with another DB (e.g. staging).';
            } else if (o.status >= 400) {
              statusEl.textContent = o.data.error || 'Request failed';
            } else {
              resultPre.textContent = JSON.stringify(o.data, null, 2);
              resultPre.style.display = 'block';
              statusEl.textContent = '';
            }
          })
          .catch(function(e) { statusEl.textContent = 'Error: ' + e.message; })
          .finally(function() { viewBtn.disabled = false; });
      });
    })();

    (function initMigrationPreview() {
      var btn = document.getElementById('migration-preview');
      var statusEl = document.getElementById('compare-status');
      var resultPre = document.getElementById('compare-result');
      if (!btn) return;
      btn.addEventListener('click', function() {
        btn.disabled = true;
        btn.textContent = 'Generating…';
        resultPre.style.display = 'none';
        statusEl.textContent = '';
        fetch('/api/migration/preview', authOpts())
          .then(function(r) { return r.json().then(function(d) { return { status: r.status, data: d }; }); })
          .then(function(o) {
            if (o.status === 501) {
              statusEl.textContent = 'Migration preview requires queryCompare. Pass queryCompare to DriftDebugServer.start().';
           
   return;
            }
            if (o.status >= 400) {
              statusEl.textContent = o.data.error || 'Request failed';
           
   return;
            }
            var sql = o.data.migrationSql || '-- No changes detected.';
            var html = '<p class="meta">' + o.data.changeCount + ' statement(s) generated';
            if (o.data.hasWarnings) html += ' (includes warnings)';
            html += '</p>';
            html += '<pre style="font-size:11px;max-height:30vh;overflow:auto;background:var(--bg-pre);padding:0.5rem;border-radius:4px;">' + esc(sql) + '</pre>';
            html += '<button type="button" id="migration-copy-sql">Copy SQL</button>';
            resultPre.innerHTML = html;
            resultPre.style.display = 'block';
            statusEl.textContent = '';
            var copyBtn = document.getElementById('migration-copy-sql');
            if (copyBtn) copyBtn.addEventListener('click', function() {
              navigator.clipboard.writeText(sql);
              this.textContent = 'Copied!';
            });
          })
          .catch(function(e) { statusEl.textContent = 'Error: ' + e.message; })
          .finally(function() {
            btn.disabled = false;
            btn.textContent = 'Migration Preview';
          });
      });
    })();

    (function initIndexSuggestions() {
      const toggle = document.getElementById('index-toggle');
      const collapsible = document.getElementById('index-collapsible');
      const btn = document.getElementById('index-analyze');
      const container = document.getElementById('index-results');
      if (toggle && collapsible) {
        toggle.addEventListener('click', function() {
          const isCollapsed = collapsible.classList.contains('collapsed');
          collapsible.classList.toggle('collapsed', !isCollapsed);
          this.textContent = isCollapsed ? '▲ Index suggestions' : '▼ Index suggestions';
        });
      }

      if (btn) btn.addEventListener('click', function() {
        btn.disabled = true;
        btn.textContent = 'Analyzing…';
        container.style.display = 'none';
        fetch('/api/index-suggestions', authOpts())
          .then(function(r) {
            if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Request failed'); });
            return r.json();
          })
          .then(function(data) {
            var suggestions = data.suggestions || [];
            if (suggestions.length === 0) {
              container.innerHTML = '<p class="meta" style="color:#7cb342;">No index suggestions — schema looks good!</p>';
              container.style.display = 'block';
           
   return;
            }
            var priorityColors = { high: '#e57373', medium: '#ffb74d', low: '#7cb342' };
            var html = '<p class="meta">' + suggestions.length + ' suggestion(s) across ' + data.tablesAnalyzed + ' tables:</p>';
            html += '<table style="border-collapse:collapse;width:100%;font-size:12px;">';
            html += '<tr><th style="border:1px solid var(--border);padding:4px;">Priority</th><th style="border:1px solid var(--border);padding:4px;">Table.Column</th><th style="border:1px solid var(--border);padding:4px;">Reason</th><th style="border:1px solid var(--border);padding:4px;">SQL</th></tr>';
            suggestions.forEach(function(s) {
              var color = priorityColors[s.priority] || 'var(--fg)';
              html += '<tr>';
              html += '<td style="border:1px solid var(--border);padding:4px;color:' + color + ';font-weight:bold;">' + esc(s.priority).toUpperCase() + '</td>';
              html += '<td style="border:1px solid var(--border);padding:4px;">' + esc(s.table) + '.' + esc(s.column) + '</td>';
              html += '<td style="border:1px solid var(--border);padding:4px;">' + esc(s.reason) + '</td>';
              html += '<td style="border:1px solid var(--border);padding:4px;"><code style="font-size:11px;cursor:pointer;" title="Click to copy" onclick="navigator.clipboard.writeText(this.textContent)">' + esc(s.sql) + '</code></td>';
              html += '</tr>';
            });
            html += '</table>';
            container.innerHTML = html;
            container.style.display = 'block';
          })
          .catch(function(e) {
            container.innerHTML = '<p class="meta" style="color:#e57373;">Error: ' + esc(e.message) + '</p>';
            container.style.display = 'block';
          })
          .finally(function() {
            btn.disabled = false;
            btn.textContent = 'Analyze';
          });
      });
    })();

    (function initSizeAnalytics() {
      const toggle = document.getElementById('size-toggle');
      const collapsible = document.getElementById('size-collapsible');
      const btn = document.getElementById('size-analyze');
      const container = document.getElementById('size-results');
      function formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(2) + ' MB';
      }

      if (toggle && collapsible) {
        toggle.addEventListener('click', function() {
          const isCollapsed = collapsible.classList.contains('collapsed');
          collapsible.classList.toggle('collapsed', !isCollapsed);
          this.textContent = isCollapsed ? '▲ Database size analytics' : '▼ Database size analytics';
        });
      }

      if (btn) btn.addEventListener('click', function() {
        btn.disabled = true;
        btn.textContent = 'Analyzing…';
        container.style.display = 'none';
        fetch('/api/analytics/size', authOpts())
          .then(function(r) {
            if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Request failed'); });
            return r.json();
          })
          .then(function(data) {
            var html = '<div style="margin:0.5rem 0;">';
            html += '<div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:0.5rem;">';
            html += '<div style="padding:0.5rem;border:1px solid var(--border);border-radius:4px;">';
            html += '<div class="meta">Total Size</div>';
            html += '<div style="font-size:1.2rem;font-weight:bold;">' + formatBytes(data.totalSizeBytes) + '</div></div>';
            html += '<div style="padding:0.5rem;border:1px solid var(--border);border-radius:4px;">';
            html += '<div class="meta">Used</div>';
            html += '<div style="font-size:1.2rem;font-weight:bold;">' + formatBytes(data.usedSizeBytes) + '</div></div>';
            html += '<div style="padding:0.5rem;border:1px solid var(--border);border-radius:4px;">';
            html += '<div class="meta">Free</div>';
            html += '<div style="font-size:1.2rem;font-weight:bold;">' + formatBytes(data.freeSpaceBytes) + '</div></div>';
            html += '<div style="padding:0.5rem;border:1px solid var(--border);border-radius:4px;">';
            html += '<div class="meta">Journal</div>';
            html += '<div style="font-size:1.2rem;font-weight:bold;">' + esc(data.journalMode) + '</div></div>';
            html += '<div style="padding:0.5rem;border:1px solid var(--border);border-radius:4px;">';
            html += '<div class="meta">Pages</div>';
            html += '<div style="font-size:1.2rem;font-weight:bold;">' + data.pageCount + ' × ' + data.pageSize + '</div></div>';
            html += '</div>';
            html += '<table style="border-collapse:collapse;width:100%;font-size:12px;">';
            html += '<tr><th style="border:1px solid var(--border);padding:4px;">Table</th>';
            html += '<th style="border:1px solid var(--border);padding:4px;">Rows</th>';
            html += '<th style="border:1px solid var(--border);padding:4px;">Columns</th>';
            html += '<th style="border:1px solid var(--border);padding:4px;">Indexes</th></tr>';
            var maxRows = Math.max.apply(null, (data.tables || []).map(function(t) { return t.rowCount; }).concat([1]));
            (data.tables || []).forEach(function(t) {
              var barWidth = Math.max(1, (t.rowCount / maxRows) * 100);
              html += '<tr>';
              html += '<td style="border:1px solid var(--border);padding:4px;">' + esc(t.table) + '</td>';
              html += '<td style="border:1px solid var(--border);padding:4px;">';
              html += '<div style="background:var(--link);height:12px;width:' + barWidth + '%;opacity:0.3;display:inline-block;vertical-align:middle;margin-right:4px;"></div>';
              html += t.rowCount.toLocaleString() + '</td>';
              html += '<td style="border:1px solid var(--border);padding:4px;">' + t.columnCount + '</td>';
              html += '<td style="border:1px solid var(--border);padding:4px;">' + t.indexCount;
              if (t.indexes.length > 0) html += ' <span class="meta">(' + t.indexes.map(esc).join(', ') + ')</span>';
              html += '</td></tr>';
            });
            html += '</table></div>';
            container.innerHTML = html;
            container.style.display = 'block';
          })
          .catch(function(e) {
            container.innerHTML = '<p class="meta" style="color:#e57373;">Error: ' + esc(e.message) + '</p>';
            container.style.display = 'block';
          })
          .finally(function() {
            btn.disabled = false;
            btn.textContent = 'Analyze';
          });
      });
    })();

    (function initAnomalyDetection() {
      const toggle = document.getElementById('anomaly-toggle');
      const collapsible = document.getElementById('anomaly-collapsible');
      const btn = document.getElementById('anomaly-analyze');
      const container = document.getElementById('anomaly-results');
      if (toggle && collapsible) {
        toggle.addEventListener('click', function() {
          const isCollapsed = collapsible.classList.contains('collapsed');
          collapsible.classList.toggle('collapsed', !isCollapsed);
          this.textContent = isCollapsed ? '▲ Data health' : '▼ Data health';
        });
      }

      if (btn) btn.addEventListener('click', function() {
        btn.disabled = true;
        btn.textContent = 'Scanning\u2026';
        container.style.display = 'none';
        fetch('/api/analytics/anomalies', authOpts())
          .then(function(r) {
            if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Request failed'); });
            return r.json();
          })
          .then(function(data) {
            var anomalies = data.anomalies || [];
            if (anomalies.length === 0) {
              container.innerHTML = '<p class="meta" style="color:#7cb342;">No anomalies detected across ' + data.tablesScanned + ' tables. Data looks clean!</p>';
              container.style.display = 'block';
           
   return;
            }
            var icons = { error: '!!', warning: '!', info: 'i' };
            var colors = { error: '#e57373', warning: '#ffb74d', info: '#7cb342' };
            var html = '<p class="meta">' + anomalies.length + ' finding(s) across ' + data.tablesScanned + ' tables:</p>';
            anomalies.forEach(function(a) {
              var color = colors[a.severity] || 'var(--fg)';
              var icon = icons[a.severity] || '';
              html += '<div style="padding:0.3rem 0.5rem;margin:0.2rem 0;border-left:3px solid ' + color + ';background:rgba(0,0,0,0.1);">';
              html += '<span style="color:' + color + ';font-weight:bold;">[' + icon + '] ' + esc(a.severity).toUpperCase() + '</span> ';
              html += esc(a.message);
              if (a.count) html += ' <span class="meta">(' + a.count + ')</span>';
              html += '</div>';
            });
            container.innerHTML = html;
            container.style.display = 'block';
          })
          .catch(function(e) {
            container.innerHTML = '<p class="meta" style="color:#e57373;">Error: ' + esc(e.message) + '</p>';
            container.style.display = 'block';
          })
          .finally(function() {
            btn.disabled = false;
            btn.textContent = 'Scan for anomalies';
          });
      });
    })();

    document.getElementById('export-csv').addEventListener('click', function(e) {
      e.preventDefault();
      if (!currentTableName || !currentTableJson || currentTableJson.length === 0) {
        document.getElementById('export-csv-status').textContent = ' Select a table with data first.';
     
   return;
      }
      const statusEl = document.getElementById('export-csv-status');
      statusEl.textContent = ' Preparing…';
      try {
        const keys = Object.keys(currentTableJson[0]);
        const rowToCsv = (row) => keys.map(k => {
          const v = row[k];
          if (v == null) return '';
          const s = String(v);
          return s.includes(',') || s.includes('"') || s.includes('\\n') ? '"' + s.replace(/"/g, '""') + '"' : s;
        }).join(',');
        const csv = [keys.join(','), ...currentTableJson.map(rowToCsv)].join('\\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = currentTableName + '.csv';
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        statusEl.textContent = ' Failed: ' + err.message;
     
   return;
      }
      statusEl.textContent = '';
    });

    function getScope() { return document.getElementById('search-scope').value; }
    function getSearchTerm() { return (document.getElementById('search-input').value || '').trim(); }
    function getRowFilter() { return (document.getElementById('row-filter').value || '').trim(); }
    function filterRows(data) {
      const term = getRowFilter();
      if (!term || !data || data.length === 0) return data || [];
      const lower = term.toLowerCase();
      return data.filter(row => Object.values(row).some(v => v != null && String(v).toLowerCase().includes(lower)));
    }

    function applySearch() {
      const term = getSearchTerm();
      const scope = getScope();
      const schemaPre = document.getElementById('schema-pre');
      if (schemaPre && lastRenderedSchema !== null && (scope === 'schema' || scope === 'both')) {
        schemaPre.innerHTML = term ? highlightText(lastRenderedSchema, term) : esc(lastRenderedSchema);
      }
      var contentPre = document.getElementById('content-pre');
      if (contentPre && lastRenderedSchema !== null && scope === 'schema') {
        contentPre.innerHTML = term ? highlightText(lastRenderedSchema, term) : esc(lastRenderedSchema);
      }
      var dataTable = document.getElementById('data-table');
      if (dataTable && term && (scope === 'data' || scope === 'both')) {
        dataTable.querySelectorAll('td').forEach(function(td) {
          if (!td.querySelector('.fk-link')) {
            var text = td.textContent || '';
            td.innerHTML = highlightText(text, term);
          }
        });
      }
    }

    document.getElementById('search-input').addEventListener('input', applySearch);
    document.getElementById('search-input').addEventListener('keyup', applySearch);
    document.getElementById('row-filter').addEventListener('input', function() { if (currentTableName && currentTableJson) renderTableView(currentTableName, currentTableJson); });
    document.getElementById('row-filter').addEventListener('keyup', function() { if (currentTableName && currentTableJson) renderTableView(currentTableName, currentTableJson); });
    document.getElementById('search-scope').addEventListener('change', function() {
      const scope = getScope();
      const content = document.getElementById('content');
      const paginationBar = document.getElementById('pagination-bar');
      if (scope === 'both') {
        loadBothView();
        paginationBar.style.display = (currentTableName ? 'flex' : 'none');
      } else if (scope === 'schema') {
        loadSchemaView();
        paginationBar.style.display = 'none';
      } else if (currentTableName) {
        renderTableView(currentTableName, currentTableJson);
        paginationBar.style.display = 'flex';
      } else {
        content.innerHTML = '';
        lastRenderedSchema = null;
        lastRenderedData = null;
        paginationBar.style.display = 'none';
      }
      applySearch();
    });

    document.getElementById('export-dump').addEventListener('click', function(e) {
      e.preventDefault();
      const link = this;
      const statusEl = document.getElementById('export-dump-status');
      const origText = link.textContent;
      link.textContent = 'Preparing dump…';
      statusEl.textContent = '';
      fetch('/api/dump', authOpts())
        .then(r => { if (!r.ok) throw new Error(r.statusText); return r.blob(); })
        .then(blob => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'dump.sql';
          a.click();
          URL.revokeObjectURL(url);
        })
        .catch(err => { statusEl.textContent = ' Failed: ' + err.message; })
        .finally(() => { link.textContent = origText; });
    });

    // Download raw SQLite file (GET /api/database). Requires getDatabaseBytes at server start; 501 → show "Not configured".
    document.getElementById('export-database').addEventListener('click', function(e) {
      e.preventDefault();
      const link = this;
      const statusEl = document.getElementById('export-database-status');
      const origText = link.textContent;
      link.textContent = 'Preparing…';
      statusEl.textContent = '';
      fetch('/api/database', authOpts())
        .then(r => {
          if (r.status === 501) return r.json().then(j => { throw new Error(j.error || 'Not configured'); });
          if (!r.ok) throw new Error(r.statusText);
          return r.blob();
        })
        .then(blob => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'database.sqlite';
          a.click();
          URL.revokeObjectURL(url);
        })
        .catch(err => { statusEl.textContent = ' ' + err.message; })
        .finally(() => { link.textContent = origText; });
    });

    function setupPagination() {
      const bar = document.getElementById('pagination-bar');
      const limitSel = document.getElementById('pagination-limit');
      limitSel.innerHTML = LIMIT_OPTIONS.map(n => '<option value="' + n + '"' + (n === limit ? ' selected' : '') + '>' + n + '</option>').join('');
      document.getElementById('pagination-offset').value = offset;
      bar.style.display = getScope() === 'schema' ? 'none' : 'flex';
    }
    document.getElementById('pagination-limit').addEventListener('change', function() { limit = parseInt(this.value, 10); loadTable(currentTableName); });
    document.getElementById('pagination-offset').addEventListener('change', function() { offset = parseInt(this.value, 10) || 0; });
    document.getElementById('pagination-prev').addEventListener('click', function() { offset = Math.max(0, offset - limit); document.getElementById('pagination-offset').value = offset; loadTable(currentTableName); });
    document.getElementById('pagination-next').addEventListener('click', function() { offset = offset + limit; document.getElementById('pagination-offset').value = offset; loadTable(currentTableName); });
    document.getElementById('pagination-apply').addEventListener('click', function() { offset = parseInt(document.getElementById('pagination-offset').value, 10) || 0; loadTable(currentTableName); });

    function loadSchemaView() {
      const content = document.getElementById('content');
      content.innerHTML = '<p class="meta">Loading schema…</p>';
      if (cachedSchema !== null) {
        renderSchemaContent(content, cachedSchema);
        applySearch();
     
   return;
      }
      fetch('/api/schema', authOpts())
        .then(r => r.text())
        .then(schema => {
          cachedSchema = schema;
          renderSchemaContent(content, schema);
          applySearch();
        })
        .catch(e => { content.innerHTML = '<p class="meta">Error</p><pre>' + esc(String(e)) + '</pre>'; });
    }

    function renderSchemaContent(container, schema) {
      lastRenderedData = null;
      lastRenderedSchema = schema;
      const scope = getScope();
      if (scope === 'both') {
        container.innerHTML = '<div class="search-section"><h2>Schema</h2><pre id="schema-pre">' + esc(schema) + '</pre></div><div class="search-section" id="both-data-section"><h2>Table data</h2><p class="meta">Select a table above to load data.</p></div>';
        const dataSection = document.getElementById('both-data-section');
        if (currentTableName && currentTableJson !== null) {
          const filtered = filterRows(currentTableJson);
          const jsonStr = JSON.stringify(filtered, null, 2);
          lastRenderedData = jsonStr;
          const metaText = rowCountText(currentTableName) + (getRowFilter() ? ' (filtered: ' + filtered.length + ' of ' + currentTableJson.length + ')' : '');
          var fkMap = {};
          var cachedFks = fkMetaCache[currentTableName] || [];
          cachedFks.forEach(function(fk) { fkMap[fk.fromColumn] = fk; });
          dataSection.innerHTML = '<h2>Table data: ' + esc(currentTableName) + '</h2><p class="meta">' + metaText + '</p>' + buildDataTableHtml(filtered, fkMap);
        }
      } else {
        container.innerHTML = '<p class="meta">Schema</p><pre id="content-pre">' + esc(schema) + '</pre>';
      }
    }

    function loadBothView() {
      const content = document.getElementById('content');
      content.innerHTML = '<p class="meta">Loading…</p>';
      (cachedSchema !== null ? Promise.resolve(cachedSchema) : fetch('/api/schema', authOpts()).then(r => r.text()))
      .then(schema => {
        if (cachedSchema === null) cachedSchema = schema;
        lastRenderedSchema = schema;
        let dataHtml = '';
        if (currentTableName && currentTableJson !== null) {
          const filtered = filterRows(currentTableJson);
          const jsonStr = JSON.stringify(filtered, null, 2);
          lastRenderedData = jsonStr;
          const metaText = rowCountText(currentTableName) + (getRowFilter() ? ' (filtered: ' + filtered.length + ' of ' + currentTableJson.length + ')' : '');
          var fkMap = {};
          var cachedFks = fkMetaCache[currentTableName] || [];
          cachedFks.forEach(function(fk) { fkMap[fk.fromColumn] = fk; });
          dataHtml = '<p class="meta">' + metaText + '</p>' + buildDataTableHtml(filtered, fkMap);
        } else {
          lastRenderedData = null;
          dataHtml = '<p class="meta">Select a table above to load data.</p>';
        }
        content.innerHTML = '<div class="search-section"><h2>Schema</h2><pre id="schema-pre">' + esc(schema) + '</pre></div><div class="search-section" id="both-data-section"><h2>Table data</h2>' + dataHtml + '</div>';
        applySearch();
      }).catch(e => { content.innerHTML = '<p class="meta">Error</p><pre>' + esc(String(e)) + '</pre>'; });
    }

    // --- FK relationship explorer: data, navigation, breadcrumb ---
    const fkMetaCache = {};
    const navHistory = [];

    function loadFkMeta(tableName) {
      if (fkMetaCache[tableName]) return Promise.resolve(fkMetaCache[tableName]);
      return fetch('/api/table/' + encodeURIComponent(tableName) + '/fk-meta', authOpts())
        .then(function(r) { return r.json(); })
        .then(function(fks) { fkMetaCache[tableName] = fks; return fks; })
        .catch(function() { return []; });
    }

    function buildFkSqlValue(value) {
      var isNumeric = !isNaN(value) && value.trim() !== '';
      return isNumeric ? value : "'" + value.replace(/'/g, "''") + "'";
    }

    function navigateToFk(table, column, value) {
      navHistory.push({ table: currentTableName, offset: offset, filter: document.getElementById('row-filter').value });
      var sqlInput = document.getElementById('sql-input');
      sqlInput.value = 'SELECT * FROM "' + table + '" WHERE "' + column + '" = ' + buildFkSqlValue(value);
      var toggle = document.getElementById('sql-runner-toggle');
      var collapsible = document.getElementById('sql-runner-collapsible');
      if (collapsible && collapsible.classList.contains('collapsed')) { toggle.click(); }
      document.getElementById('sql-run').click();
      currentTableName = table;
      renderBreadcrumb();
    }

    function renderBreadcrumb() {
      var el = document.getElementById('nav-breadcrumb');
      if (!el) {
        el = document.createElement('div');
        el.id = 'nav-breadcrumb';
        el.style.cssText = 'font-size:11px;margin:0.3rem 0;color:var(--muted);';
        document.getElementById('content').prepend(el);
      }

      if (navHistory.length === 0) { el.style.display = 'none'; return; }
      var html = '<a href="#" id="nav-back" style="color:var(--link);">&#8592; Back</a> | Path: ';
      html += navHistory.map(function(h) { return esc(h.table); }).join(' &#8594; ');
      html += ' &#8594; <strong>' + esc(currentTableName || '') + '</strong>';
      el.innerHTML = html;
      el.style.display = 'block';
      var backBtn = document.getElementById('nav-back');
      if (backBtn) backBtn.onclick = function(e) {
        e.preventDefault();
        var prev = navHistory.pop();
        if (prev) {
          offset = prev.offset || 0;
          loadTable(prev.table);
          if (prev.filter) document.getElementById('row-filter').value = prev.filter;
          renderBreadcrumb();
        }
      };
    }

    function buildDataTableHtml(filtered, fkMap) {
      if (!filtered || filtered.length === 0) return '<p class="meta">No rows.</p>';
      var keys = Object.keys(filtered[0]);
      var html = '<table id="data-table"><thead><tr>';
      keys.forEach(function(k) {
        var fk = fkMap[k];
        var fkLabel = fk ? ' <span style="color:var(--muted);font-size:10px;" title="FK to ' + esc(fk.toTable) + '.' + esc(fk.toColumn) + '">&#8599;</span>' : '';
        html += '<th>' + esc(k) + fkLabel + '</th>';
      });
      html += '</tr></thead><tbody>';
      filtered.forEach(function(row) {
        html += '<tr>';
        keys.forEach(function(k) {
          var val = row[k];
          var fk = fkMap[k];
          if (fk && val != null) {
            html += '<td><a href="#" class="fk-link" style="color:var(--link);text-decoration:underline;" ';
            html += 'data-table="' + esc(fk.toTable) + '" ';
            html += 'data-column="' + esc(fk.toColumn) + '" ';
            html += 'data-value="' + esc(String(val)) + '">' ;
            html += esc(String(val)) + ' &#8594;</a></td>';
          } else {
            html += '<td>' + esc(val != null ? String(val) : '') + '</td>';
          }
        });
        html += '</tr>';
      });
      html += '</tbody></table>';
      return html;
    }

    function renderTableView(name, data) {
      const content = document.getElementById('content');
      const scope = getScope();
      const filtered = filterRows(data);
      const jsonStr = JSON.stringify(filtered, null, 2);
      lastRenderedData = jsonStr;
      const metaText = rowCountText(name) + (getRowFilter() ? ' (filtered: ' + filtered.length + ' of ' + data.length + ')' : '');
      // Show loading hint while FK metadata is being fetched for the first time
      if (!fkMetaCache[name] && scope !== 'both') {
        content.innerHTML = '<p class="meta">' + metaText + '</p><p class="meta">Loading\u2026</p>';
      }
      function renderDataHtml(fkMap) {
        var tableHtml = buildDataTableHtml(filtered, fkMap);
        if (scope === 'both') {
          lastRenderedSchema = cachedSchema;
          if (cachedSchema === null) {
            fetch('/api/schema', authOpts()).then(function(r) { return r.text(); }).then(function(schema) {
              cachedSchema = schema;
              lastRenderedSchema = schema;
              content.innerHTML = '<div class="search-section"><h2>Schema</h2><pre id="schema-pre">' + esc(schema) + '</pre></div><div class="search-section" id="both-data-section"><h2>Table data: ' + esc(name) + '</h2><p class="meta">' + metaText + '</p>' + tableHtml + '</div>';
              applySearch();
              renderBreadcrumb();
            });
          } else {
            var dataSection = document.getElementById('both-data-section');
            if (dataSection) {
              dataSection.innerHTML = '<h2>Table data: ' + esc(name) + '</h2><p class="meta">' + metaText + '</p>' + tableHtml;
            }
            applySearch();
            renderBreadcrumb();
          }
        } else {
          lastRenderedSchema = null;
          content.innerHTML = '<p class="meta">' + metaText + '</p>' + tableHtml;
          applySearch();
          renderBreadcrumb();
        }
      }
      loadFkMeta(name).then(function(fks) {
        var fkMap = {};
        (fks || []).forEach(function(fk) { fkMap[fk.fromColumn] = fk; });
        renderDataHtml(fkMap);
      });
    }

    document.addEventListener('click', function(e) {
      var link = e.target.closest('.fk-link');
      if (!link) return;
      e.preventDefault();
      navigateToFk(link.dataset.table, link.dataset.column, link.dataset.value);
    });

    function rowCountText(name) {
      const total = tableCounts[name];
      const len = (currentTableJson && currentTableJson.length) || 0;
      if (total == null) return esc(name) + ' (up to ' + limit + ' rows)';
      const rangeText = len > 0 ? ('showing ' + (offset + 1) + '–' + (offset + len)) : 'no rows in this range';
      return esc(name) + ' (' + total + ' row' + (total !== 1 ? 's' : '') + '; ' + rangeText + ')';
    }

    function loadTable(name) {
      currentTableName = name;
      const content = document.getElementById('content');
      const scope = getScope();
      if (scope === 'both' && cachedSchema !== null) {
        content.innerHTML = '<p class="meta">Loading ' + esc(name) + '…</p>';
      } else if (scope !== 'both') {
        content.innerHTML = '<p class="meta">' + esc(name) + '</p><p class="meta">Loading…</p>';
      }
      fetch('/api/table/' + encodeURIComponent(name) + '?limit=' + limit + '&offset=' + offset, authOpts())
        .then(r => r.json())
        .then(data => {
          if (currentTableName !== name) return;
          currentTableJson = data;
          setupPagination();
          renderTableView(name, data);
          fetch('/api/table/' + encodeURIComponent(name) + '/count', authOpts())
            .then(r => r.json())
            .then(o => {
              if (currentTableName !== name) return;
              tableCounts[name] = o.count;
              renderTableView(name, data);
            })
            .catch(() => {});
        })
        .catch(e => {
          if (currentTableName !== name) return;
          content.innerHTML = '<p class="meta">Error</p><pre>' + esc(String(e)) + '</pre>';
        });
    }

    function renderTableList(tables) {
      const ul = document.getElementById('tables');
      ul.innerHTML = '';
      tables.forEach(t => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = '#' + encodeURIComponent(t);
        a.textContent = (tableCounts[t] != null) ? (t + ' (' + tableCounts[t] + ' rows)') : t;
        a.onclick = e => { e.preventDefault(); loadTable(t); };
        li.appendChild(a);
        ul.appendChild(li);
      });
      const sqlTableSel = document.getElementById('sql-table');
      if (sqlTableSel) {
        sqlTableSel.innerHTML = '<option value="">—</option>' + tables.map(t => '<option value="' + esc(t) + '">' + esc(t) + '</option>').join('');
      }
      const importTableSel = document.getElementById('import-table');
      if (importTableSel) {
        importTableSel.innerHTML = tables.map(t => '<option value="' + esc(t) + '">' + esc(t) + (tableCounts[t] != null ? ' (' + tableCounts[t] + ' rows)' : '') + '</option>').join('');
      }
    }

    // --- Chart rendering (pure SVG, no dependencies) ---
    var CHART_COLORS = [
      '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f',
      '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'
    ];

    function renderBarChart(container, data, xKey, yKey) {
      var W = 600, H = 300, PAD = 50;
      var vals = data.map(function(d) { return Number(d[yKey]) || 0; });
      var maxVal = Math.max.apply(null, vals.concat([1]));
      var barW = Math.max(4, (W - PAD * 2) / data.length - 2);
      var svg = '<svg width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg">';
      svg += '<line class="chart-axis" x1="' + PAD + '" y1="' + (H - PAD) + '" x2="' + (W - PAD) + '" y2="' + (H - PAD) + '"/>';
      svg += '<line class="chart-axis" x1="' + PAD + '" y1="' + PAD + '" x2="' + PAD + '" y2="' + (H - PAD) + '"/>';
      for (var i = 0; i <= 4; i++) {
        var v = (maxVal / 4 * i).toFixed(maxVal > 100 ? 0 : 1);
        var y = H - PAD - (i / 4) * (H - PAD * 2);
        svg += '<text class="chart-axis-label" x="' + (PAD - 4) + '" y="' + (y + 3) + '" text-anchor="end">' + v + '</text>';
      }
      data.forEach(function(d, i) {
        var val = Number(d[yKey]) || 0;
        var bh = (val / maxVal) * (H - PAD * 2);
        var x = PAD + i * (barW + 2);
        var by = H - PAD - bh;
        svg += '<rect class="chart-bar" x="' + x + '" y="' + by + '" width="' + barW + '" height="' + bh + '">';
        svg += '<title>' + esc(String(d[xKey])) + ': ' + val + '</title></rect>';
        if (data.length <= 20) {
          svg += '<text class="chart-label" x="' + (x + barW / 2) + '" y="' + (H - PAD + 14) + '" text-anchor="middle" transform="rotate(-45,' + (x + barW / 2) + ',' + (H - PAD + 14) + ')">' + esc(String(d[xKey]).slice(0, 12)) + '</text>';
        }
      });
      svg += '</svg>';
      container.innerHTML = svg;
      container.style.display = 'block';
    }

    function renderPieChart(container, data, labelKey, valueKey) {
      var W = 500, H = 350, R = 130, CX = 200, CY = H / 2;
      var vals = data.map(function(d) { return Math.max(0, Number(d[valueKey]) || 0); });
      var total = vals.reduce(function(a, b) { return a + b; }, 0) || 1;
      var threshold = total * 0.02;
      var significant = [];
      var otherVal = 0;
      data.forEach(function(d, i) {
        if (vals[i] >= threshold) significant.push({ label: d[labelKey], value: vals[i] });
        else otherVal += vals[i];
      });
      if (otherVal > 0) significant.push({ label: 'Other', value: otherVal });
      var svg = '<svg width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg">';
      var angle = 0;
      significant.forEach(function(d, i) {
        var sweep = (d.value / total) * 2 * Math.PI;
        var color = CHART_COLORS[i % CHART_COLORS.length];
        var pct = (d.value / total * 100).toFixed(1);
        var tip = '<title>' + esc(String(d.label)) + ': ' + d.value + ' (' + pct + '%)</title>';
        if (sweep >= 2 * Math.PI - 0.001) {
          // Full circle — SVG arc degenerates when start ≈ end; use <circle> instead
          svg += '<circle class="chart-slice" cx="' + CX + '" cy="' + CY + '" r="' + R + '" fill="' + color + '">' + tip + '</circle>';
        } else {
          var x1 = CX + R * Math.cos(angle);
          var y1 = CY + R * Math.sin(angle);
          var x2 = CX + R * Math.cos(angle + sweep);
          var y2 = CY + R * Math.sin(angle + sweep);
          var large = sweep > Math.PI ? 1 : 0;
          svg += '<path class="chart-slice" d="M' + CX + ',' + CY + ' L' + x1 + ',' + y1 + ' A' + R + ',' + R + ' 0 ' + large + ' 1 ' + x2 + ',' + y2 + ' Z" fill="' + color + '">' + tip + '</path>';
        }
        angle += sweep;
      });
      significant.forEach(function(d, i) {
        var ly = 20 + i * 18;
        var lx = CX + R + 30;
        var color = CHART_COLORS[i % CHART_COLORS.length];
        svg += '<rect x="' + lx + '" y="' + (ly - 8) + '" width="10" height="10" fill="' + color + '"/>';
        svg += '<text class="chart-legend" x="' + (lx + 14) + '" y="' + ly + '">' + esc(String(d.label).slice(0, 20)) + ' (' + d.value + ')</text>';
      });
      svg += '</svg>';
      container.innerHTML = svg;
      container.style.display = 'block';
    }

    function renderLineChart(container, data, xKey, yKey) {
      var W = 600, H = 300, PAD = 50;
      var vals = data.map(function(d) { return Number(d[yKey]) || 0; });
      var maxVal = Math.max.apply(null, vals.concat([1]));
      var minVal = Math.min.apply(null, vals.concat([0]));
      var range = maxVal - minVal || 1;
      var stepX = (W - PAD * 2) / Math.max(data.length - 1, 1);
      var svg = '<svg width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg">';
      svg += '<line class="chart-axis" x1="' + PAD + '" y1="' + (H - PAD) + '" x2="' + (W - PAD) + '" y2="' + (H - PAD) + '"/>';
      svg += '<line class="chart-axis" x1="' + PAD + '" y1="' + PAD + '" x2="' + PAD + '" y2="' + (H - PAD) + '"/>';
      var points = data.map(function(d, i) {
        var x = PAD + i * stepX;
        var y = H - PAD - ((Number(d[yKey]) || 0) - minVal) / range * (H - PAD * 2);
        return x + ',' + y;
      });
      svg += '<polygon points="' + PAD + ',' + (H - PAD) + ' ' + points.join(' ') + ' ' + (PAD + (data.length - 1) * stepX) + ',' + (H - PAD) + '" fill="var(--link)" opacity="0.1"/>';
      svg += '<polyline class="chart-line" points="' + points.join(' ') + '"/>';
      data.forEach(function(d, i) {
        var x = PAD + i * stepX;
        var y = H - PAD - ((Number(d[yKey]) || 0) - minVal) / range * (H - PAD * 2);
        svg += '<circle class="chart-dot" cx="' + x + '" cy="' + y + '" r="3"><title>' + esc(String(d[xKey])) + ': ' + d[yKey] + '</title></circle>';
      });
      svg += '</svg>';
      container.innerHTML = svg;
      container.style.display = 'block';
    }

    function renderHistogram(container, data, valueKey, bins) {
      bins = bins || 10;
      var vals = data.map(function(d) { return Number(d[valueKey]); }).filter(function(v) { return isFinite(v); });
      if (vals.length === 0) { container.innerHTML = '<p class="meta">No numeric data.</p>'; container.style.display = 'block'; return; }
      var min = Math.min.apply(null, vals);
      var max = Math.max.apply(null, vals);
      var binWidth = (max - min) / bins || 1;
      var counts = new Array(bins).fill(0);
      vals.forEach(function(v) {
        var idx = Math.min(Math.floor((v - min) / binWidth), bins - 1);
        counts[idx]++;
      });
      var histData = counts.map(function(c, i) {
        return { label: (min + i * binWidth).toFixed(1) + '-' + (min + (i + 1) * binWidth).toFixed(1), value: c };
      });
      renderBarChart(container, histData, 'label', 'value');
    }

    document.getElementById('chart-render').addEventListener('click', function() {
      var type = document.getElementById('chart-type').value;
      var xKey = document.getElementById('chart-x').value;
      var yKey = document.getElementById('chart-y').value;
      var container = document.getElementById('chart-container');
      var rows = window._chartRows || [];
      if (type === 'none' || rows.length === 0) { container.style.display = 'none'; return; }
      var chartData = rows;
      if (rows.length > 500) {
        var nth = Math.ceil(rows.length / 500);
        chartData = rows.filter(function(_, i) { return i % nth === 0; });
      }

      if (type === 'bar') renderBarChart(container, chartData, xKey, yKey);
      else if (type === 'pie') renderPieChart(container, chartData, xKey, yKey);
      else if (type === 'line') renderLineChart(container, chartData, xKey, yKey);
      else if (type === 'histogram') renderHistogram(container, chartData, yKey);
    });

    (function initSqlRunner() {
      const toggle = document.getElementById('sql-runner-toggle');
      const collapsible = document.getElementById('sql-runner-collapsible');
      const templateSel = document.getElementById('sql-template');
      const tableSel = document.getElementById('sql-table');
      const fieldsSel = document.getElementById('sql-fields');
      const applyBtn = document.getElementById('sql-apply-template');
      const runBtn = document.getElementById('sql-run');
      const explainBtn = document.getElementById('sql-explain');
      const historySel = document.getElementById('sql-history');
      const formatSel = document.getElementById('sql-result-format');
      const inputEl = document.getElementById('sql-input');
      const errorEl = document.getElementById('sql-error');
      const resultEl = document.getElementById('sql-result');
      const bookmarksSel = document.getElementById('sql-bookmarks');
      const bookmarkSaveBtn = document.getElementById('sql-bookmark-save');
      const bookmarkDeleteBtn = document.getElementById('sql-bookmark-delete');
      const bookmarkExportBtn = document.getElementById('sql-bookmark-export');
      const bookmarkImportBtn = document.getElementById('sql-bookmark-import');
      loadSqlHistory();
      refreshHistoryDropdown(historySel);
      loadBookmarks();
      refreshBookmarksDropdown(bookmarksSel);
      bindDropdownToInput(historySel, sqlHistory, inputEl);
      bindDropdownToInput(bookmarksSel, sqlBookmarks, inputEl);
      if (bookmarkSaveBtn) bookmarkSaveBtn.addEventListener('click', function() { addBookmark(inputEl, bookmarksSel); });
      if (bookmarkDeleteBtn) bookmarkDeleteBtn.addEventListener('click', function() { deleteBookmark(bookmarksSel); });
      if (bookmarkExportBtn) bookmarkExportBtn.addEventListener('click', exportBookmarks);
      if (bookmarkImportBtn) bookmarkImportBtn.addEventListener('click', function() { importBookmarks(bookmarksSel); });

      if (!toggle || !collapsible) return;

      toggle.addEventListener('click', function() {
        const isCollapsed = collapsible.classList.contains('collapsed');
        collapsible.classList.toggle('collapsed', !isCollapsed);
        this.textContent = isCollapsed ? '▲ Run SQL (read-only)' : '▼ Run SQL (read-only)';
      });

      const TEMPLATES = {
        'select-star-limit': function(t, cols) { return 'SELECT * FROM "' + t + '" LIMIT 10'; },
        'select-star': function(t, cols) { return 'SELECT * FROM "' + t + '"'; },
        'count': function(t, cols) { return 'SELECT COUNT(*) FROM "' + t + '"'; },
        'select-fields': function(t, cols) {
          const list = (cols && cols.length) ? cols.map(c => '"' + c + '"').join(', ') : '*';
          return 'SELECT ' + list + ' FROM "' + t + '" LIMIT 10';
        }
      };

      function getSelectedFields() {
        const opts = fieldsSel ? Array.from(fieldsSel.selectedOptions || []) : [];
        return opts.map(o => o.value).filter(Boolean);
      }

      function applyTemplate() {
        const table = (tableSel && tableSel.value) || '';
        const templateId = (templateSel && templateSel.value) || 'custom';
        if (templateId === 'custom') return;
        const fn = TEMPLATES[templateId];
        if (!fn) return;
        const cols = getSelectedFields();
        const sql = table ? fn(table, cols) : ('SELECT * FROM "' + (table || 'table_name') + '" LIMIT 10');
        if (inputEl) inputEl.value = sql;
      }

      if (applyBtn) applyBtn.addEventListener('click', applyTemplate);
      if (templateSel) templateSel.addEventListener('change', applyTemplate);

      if (tableSel) {
        tableSel.addEventListener('change', function() {
          const name = this.value;
          fieldsSel.innerHTML = '<option value="">—</option>';
          if (!name) return;
          fieldsSel.innerHTML = '<option value="">Loading…</option>';
          const requestedTable = name;
          fetch('/api/table/' + encodeURIComponent(name) + '/columns', authOpts())
            .then(r => r.json())
            .then(cols => {
              if (tableSel.value !== requestedTable) return;
              if (Array.isArray(cols)) {
                fieldsSel.innerHTML = '<option value="">—</option>' + cols.map(c => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('');
              } else {
                fieldsSel.innerHTML = '<option value="">—</option>';
              }
            })
            .catch(() => {
              if (tableSel.value !== requestedTable) return;
              fieldsSel.innerHTML = '<option value="">—</option>';
            });
        });
      }

      // Shared: clear previous results and hide chart controls before any SQL operation.
      function clearSqlResults() {
        errorEl.style.display = 'none';
        resultEl.style.display = 'none';
        resultEl.innerHTML = '';
        document.getElementById('chart-controls').style.display = 'none';
        document.getElementById('chart-container').style.display = 'none';
      }
      // Shared: disable both Run and Explain buttons to prevent concurrent requests.
      function setSqlButtonsDisabled(disabled) {
        if (runBtn) runBtn.disabled = disabled;
        if (explainBtn) explainBtn.disabled = disabled;
      }

      if (runBtn && inputEl && errorEl && resultEl) {
        runBtn.addEventListener('click', function() {
          const sql = inputEl.value.trim();
          clearSqlResults();
          if (!sql) {
            errorEl.textContent = 'Enter a SELECT query.';
            errorEl.style.display = 'block';
         
   return;
          }
          const runBtnOrigText = runBtn.textContent;
          runBtn.textContent = 'Running\u2026';
          setSqlButtonsDisabled(true);
          fetch('/api/sql', authOpts({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql: sql })
          }))
            .then(r => r.json().then(data => ({ ok: r.ok, data: data })))
            .then(({ ok, data }) => {
              if (!ok) {
                errorEl.textContent = data.error || 'Request failed';
                errorEl.style.display = 'block';
             
   return;
              }
              const rows = data.rows || [];
              const asTable = formatSel && formatSel.value === 'table';
              if (asTable && rows.length > 0) {
                const keys = Object.keys(rows[0]);
                let html = '<p class="meta">' + rows.length + ' row(s)</p><table><thead><tr>' + keys.map(k => '<th>' + esc(k) + '</th>').join('') + '</tr></thead><tbody>';
                rows.forEach(row => {
                  html += '<tr>' + keys.map(k => '<td>' + esc(row[k] != null ? String(row[k]) : '') + '</td>').join('') + '</tr>';
                });
                html += '</tbody></table>';
                resultEl.innerHTML = html;
              } else {
                resultEl.innerHTML = '<p class="meta">' + rows.length + ' row(s)</p><pre>' + esc(JSON.stringify(rows, null, 2)) + '</pre>';
              }
              resultEl.style.display = 'block';
              // Show chart controls when results available
              var chartControls = document.getElementById('chart-controls');
              if (rows.length > 0) {
                var keys2 = Object.keys(rows[0]);
                var xSel = document.getElementById('chart-x');
                var ySel = document.getElementById('chart-y');
                xSel.innerHTML = keys2.map(function(k) { return '<option>' + esc(k) + '</option>'; }).join('');
                ySel.innerHTML = keys2.map(function(k) { return '<option>' + esc(k) + '</option>'; }).join('');
                chartControls.style.display = 'flex';
                window._chartRows = rows;
              } else {
                chartControls.style.display = 'none';
                document.getElementById('chart-container').style.display = 'none';
              }
              pushSqlHistory(sql, rows.length);
              refreshHistoryDropdown(historySel);
            })
            .catch(e => {
              errorEl.textContent = e.message || String(e);
              errorEl.style.display = 'block';
            })
            .finally(() => {
              setSqlButtonsDisabled(false);
              runBtn.textContent = runBtnOrigText;
            });
        });
      }

      if (explainBtn && inputEl && errorEl && resultEl) {
        explainBtn.addEventListener('click', function() {
          const sql = inputEl.value.trim();
          clearSqlResults();
          if (!sql) {
            errorEl.textContent = 'Enter a SELECT query.';
            errorEl.style.display = 'block';
         
   return;
          }
          const explainOrigText = explainBtn.textContent;
          explainBtn.textContent = 'Explaining\u2026';
          setSqlButtonsDisabled(true);
          fetch('/api/sql/explain', authOpts({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql: sql })
          }))
            .then(r => r.json().then(d => ({ ok: r.ok, data: d })))
            .then(({ ok, data }) => {
              if (!ok) {
                errorEl.textContent = data.error || 'Request failed';
                errorEl.style.display = 'block';
             
   return;
              }
              const rows = data.rows || [];
              // Build parent-to-depth map for tree indentation
              var depthMap = {};
              rows.forEach(function(r) {
                var pid = r.parent || 0;
                depthMap[r.id] = (depthMap[pid] != null ? depthMap[pid] + 1 : 0);
              });
              let html = '<p class="meta" style="font-weight:bold;">EXPLAIN QUERY PLAN</p>';
              html += '<pre style="font-family:monospace;font-size:12px;line-height:1.6;">';
              let hasScan = false;
              let hasIndex = false;
              rows.forEach(function(r) {
                const detail = r.detail || JSON.stringify(r);
                const depth = depthMap[r.id] || 0;
                const indent = '  '.repeat(depth);
                let icon = '   ';
                let style = '';
                if (/\\bSCAN\\b/.test(detail)) {
                  icon = '!! ';
                  style = ' style="color:#e57373;"';
                  hasScan = true;
                } else if (/\\bSEARCH\\b.*\\bINDEX\\b/.test(detail)) {
                  icon = 'OK ';
                  style = ' style="color:#7cb342;"';
                  hasIndex = true;
                } else if (/\\bUSING\\b.*\\bINDEX\\b/.test(detail)) {
                  icon = 'OK ';
                  style = ' style="color:#7cb342;"';
                  hasIndex = true;
                }
                html += '<span' + style + '>' + icon + indent + esc(detail) + '</span>\\n';
              });
              html += '</pre>';
              if (hasScan) {
                html += '<p class="meta" style="color:#e57373;margin-top:0.3rem;">';
                html += 'Warning: Full table scan detected. Consider adding an index on the filtered/sorted column.</p>';
              }
              if (hasIndex && !hasScan) {
                html += '<p class="meta" style="color:#7cb342;margin-top:0.3rem;">';
                html += 'Good: Query uses index(es) for efficient lookup.</p>';
              }
              resultEl.innerHTML = html;
              resultEl.style.display = 'block';
            })
            .catch(e => {
              errorEl.textContent = e.message || String(e);
              errorEl.style.display = 'block';
            })
            .finally(() => {
              setSqlButtonsDisabled(false);
              explainBtn.textContent = explainOrigText;
            });
        });
      }
    })();

    // Shared: render table list and kick off count fetches (used by initial load and live refresh).
    function applyTableListAndCounts(tables) {
      renderTableList(tables);
      tables.forEach(t => {
        fetch('/api/table/' + encodeURIComponent(t) + '/count', authOpts())
          .then(r => r.json())
          .then(o => { tableCounts[t] = o.count; renderTableList(tables); })
          .catch(() => {});
      });
    }
    function refreshOnGenerationChange() {
      if (refreshInFlight) return;
      refreshInFlight = true;
      const liveEl = document.getElementById('live-indicator');
      if (liveEl) liveEl.textContent = 'Updating…';
      fetch('/api/tables', authOpts())
        .then(r => r.json())
        .then(tables => {
          applyTableListAndCounts(tables);
          if (currentTableName) loadTable(currentTableName);
        })
        .catch(() => {})
        .finally(() => {
          refreshInFlight = false;
          if (liveEl) liveEl.textContent = '● Live';
        });
    }
    // Long-poll /api/generation?since=N; when generation changes, refresh table list and current table.
    function pollGeneration() {
      fetch('/api/generation?since=' + lastGeneration, authOpts())
        .then(r => r.json())
        .then(data => {
          const g = data.generation;
          if (g !== lastGeneration) {
            lastGeneration = g;
            refreshOnGenerationChange();
          }
          pollGeneration();
        })
        .catch(() => { setTimeout(pollGeneration, 2000); });
    }
    // --- NL-to-SQL event handlers ---
    document.getElementById('nl-convert').addEventListener('click', async function () {
      var question = document.getElementById('nl-input').value.trim();
      if (!question) return;
      var btn = this;
      btn.disabled = true;
      btn.textContent = 'Converting...';
      try {
        var meta = await loadSchemaMeta();
        var result = nlToSql(question, meta);
        if (result.sql) {
          document.getElementById('sql-input').value = result.sql;
          document.getElementById('sql-error').style.display = 'none';
        } else {
          document.getElementById('sql-error').textContent = result.error || 'Could not convert to SQL.';
          document.getElementById('sql-error').style.display = 'block';
        }
      } catch (err) {
        document.getElementById('sql-error').textContent = 'Error: ' + (err.message || err);
        document.getElementById('sql-error').style.display = 'block';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Convert to SQL';
      }
    });
    document.getElementById('nl-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') document.getElementById('nl-convert').click();
    });

    fetch('/api/tables', authOpts())
      .then(r => r.json())
      .then(tables => {
        const loadingEl = document.getElementById('tables-loading');
        loadingEl.style.display = 'none';
        applyTableListAndCounts(tables);
        pollGeneration();
        // Deep link: URL hash #TableName (e.g. from IDE extension) auto-loads that table.
        var hash = '';
        if (location.hash && location.hash.length > 1) {
          try { hash = decodeURIComponent(location.hash.slice(1)); } catch (e) { }
        }
        if (hash && tables.indexOf(hash) >= 0) loadTable(hash);
      })
      .catch(e => { document.getElementById('tables-loading').textContent = 'Failed to load tables: ' + e; });

    // --- Collaborative session: capture, share, restore ---
    function captureViewerState() {
      return {
        currentTable: currentTableName,
        sqlInput: document.getElementById('sql-input').value,
        searchTerm: document.getElementById('search-input')
          ? document.getElementById('search-input').value
          : '',
        theme: localStorage.getItem(THEME_KEY),
        limit: limit,
        offset: offset,
        timestamp: new Date().toISOString(),
      };
    }

    function copyShareUrl(shareUrl, expiresAt) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareUrl)
          .then(function () {
            alert('Share URL copied to clipboard!\\n\\n' + shareUrl +
              '\\n\\nExpires: ' + new Date(expiresAt).toLocaleString());
          })
          .catch(function () {
            prompt('Copy this share URL:', shareUrl);
          });
      } else {
        prompt('Copy this share URL:', shareUrl);
      }
    }

    function createShareSession() {
      var note = prompt('Add a note for your team (optional):');
      if (note === null) return;
      var btn = document.getElementById('share-btn');
      btn.disabled = true;
      btn.textContent = 'Sharing\\u2026';
      var state = captureViewerState();
      if (note) state.note = note;

      fetch('/api/session/share', authOpts({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      }))
        .then(function (r) {
          if (!r.ok) throw new Error('Server error ' + r.status);
          return r.json();
        })
        .then(function (data) {
          copyShareUrl(location.origin + location.pathname + data.url, data.expiresAt);
        })
        .catch(function (e) {
          alert('Failed to create share: ' + e.message);
        })
        .finally(function () {
          btn.disabled = false;
          btn.textContent = 'Share';
        });
    }

    document.getElementById('share-btn').addEventListener('click', createShareSession);

    function applySessionState(state) {
      if (state.currentTable) {
        setTimeout(function () { loadTable(state.currentTable); }, 500);
      }

      if (state.sqlInput) {
        document.getElementById('sql-input').value = state.sqlInput;
      }

      if (state.searchTerm && document.getElementById('search-input')) {
        document.getElementById('search-input').value = state.searchTerm;
      }

      if (state.limit) limit = state.limit;
      if (state.offset) offset = state.offset;
    }

    function renderSessionInfoBar(state, createdAt) {
      var infoBar = document.createElement('div');
      infoBar.style.cssText =
        'background:var(--link);color:var(--bg);padding:0.3rem 0.5rem;font-size:12px;text-align:center;';
      var info = 'Shared session';
      if (state.note) info += ': "' + esc(state.note) + '"';
      info += ' (created ' + new Date(createdAt).toLocaleString() + ')';
      infoBar.textContent = info;
      document.body.prepend(infoBar);
    }

    function renderSessionAnnotations(annotations) {
      if (!annotations || annotations.length === 0) return;
      var annoEl = document.createElement('div');
      annoEl.style.cssText =
        'background:var(--bg-pre);padding:0.3rem 0.5rem;font-size:11px;border-left:3px solid var(--link);margin:0.3rem 0;';
      var annoHtml = '<strong>Annotations:</strong><br>';
      annotations.forEach(function (a) {
        annoHtml += '<span class="meta">[' + esc(a.author) + ' at ' +
          new Date(a.at).toLocaleTimeString() + ']</span> ' +
          esc(a.text) + '<br>';
      });
      annoEl.innerHTML = annoHtml;
      document.body.children[1]
        ? document.body.insertBefore(annoEl, document.body.children[1])
        : document.body.appendChild(annoEl);
    }

    function restoreSession() {
      var params = new URLSearchParams(location.search);
      var sessionId = params.get('session');
      if (!sessionId) return;

      fetch('/api/session/' + encodeURIComponent(sessionId), authOpts())
        .then(function (r) {
          if (!r.ok) throw new Error('Session expired or not found');
          return r.json();
        })
        .then(function (data) {
          var state = data.state || {};
          applySessionState(state);
          renderSessionInfoBar(state, data.createdAt);
          renderSessionAnnotations(data.annotations);
        })
        .catch(function (e) {
          console.warn('Session restore failed:', e.message);
        });
    }

    restoreSession();

    (function initPerformance() {
      const toggle = document.getElementById('perf-toggle');
      const collapsible = document.getElementById('perf-collapsible');
      const refreshBtn = document.getElementById('perf-refresh');
      const clearBtn = document.getElementById('perf-clear');
      const container = document.getElementById('perf-results');
      let perfLoaded = false;

      function fetchPerformance() {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Loading\u2026';
        container.style.display = 'none';
        fetch('/api/analytics/performance', authOpts())
          .then(function(r) {
            if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Request failed'); });
            return r.json();
          })
          .then(function(data) {
            perfLoaded = true;
            if (data.totalQueries === 0) {
              container.innerHTML = '<p class="meta">No queries recorded yet. Browse some tables, then refresh.</p>';
            } else {
              container.innerHTML = renderPerformance(data);
            }
            container.style.display = 'block';
          })
          .catch(function(e) {
            container.innerHTML = '<p class="meta" style="color:#e57373;">Error: ' + esc(e.message) + '</p>';
            container.style.display = 'block';
          })
          .finally(function() {
            refreshBtn.disabled = false;
            refreshBtn.textContent = 'Refresh';
          });
      }

      function renderPerformance(data) {
        var html = '<div style="display:flex;gap:1rem;flex-wrap:wrap;margin:0.3rem 0;">';
        html += '<div class="meta">Total: ' + esc(String(data.totalQueries)) + ' queries</div>';
        html += '<div class="meta">Total time: ' + esc(String(data.totalDurationMs)) + ' ms</div>';
        html += '<div class="meta">Avg: ' + esc(String(data.avgDurationMs)) + ' ms</div>';
        html += '</div>';

        if (data.slowQueries && data.slowQueries.length > 0) {
          html += '<p class="meta" style="color:#e57373;font-weight:bold;">Slow queries (&gt;100ms):</p>';
          html += '<table style="border-collapse:collapse;width:100%;font-size:12px;">';
          html += '<tr><th style="border:1px solid var(--border);padding:4px;">Duration</th>';
          html += '<th style="border:1px solid var(--border);padding:4px;">Rows</th>';
          html += '<th style="border:1px solid var(--border);padding:4px;">Time</th>';
          html += '<th style="border:1px solid var(--border);padding:4px;">SQL</th></tr>';
          data.slowQueries.forEach(function(q) {
            var sql = q.sql || '';
            html += '<tr>';
            html += '<td style="border:1px solid var(--border);padding:4px;color:#e57373;font-weight:bold;">' + esc(String(q.durationMs)) + ' ms</td>';
            html += '<td style="border:1px solid var(--border);padding:4px;">' + esc(String(q.rowCount)) + '</td>';
            html += '<td style="border:1px solid var(--border);padding:4px;font-size:11px;">' + esc(q.at) + '</td>';
            html += '<td style="border:1px solid var(--border);padding:4px;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(sql) + '">' + esc(sql.length > 80 ? sql.slice(0, 80) + '\u2026' : sql) + '</td>';
            html += '</tr>';
          });
          html += '</table>';
        }

        if (data.queryPatterns && data.queryPatterns.length > 0) {
          html += '<p class="meta" style="margin-top:0.5rem;">Most time-consuming patterns:</p>';
          html += '<table style="border-collapse:collapse;width:100%;font-size:12px;">';
          html += '<tr><th style="border:1px solid var(--border);padding:4px;">Total ms</th>';
          html += '<th style="border:1px solid var(--border);padding:4px;">Count</th>';
          html += '<th style="border:1px solid var(--border);padding:4px;">Avg ms</th>';
          html += '<th style="border:1px solid var(--border);padding:4px;">Max ms</th>';
          html += '<th style="border:1px solid var(--border);padding:4px;">Pattern</th></tr>';
          data.queryPatterns.forEach(function(p) {
            var pattern = p.pattern || '';
            html += '<tr>';
            html += '<td style="border:1px solid var(--border);padding:4px;">' + esc(String(p.totalMs)) + '</td>';
            html += '<td style="border:1px solid var(--border);padding:4px;">' + esc(String(p.count)) + '</td>';
            html += '<td style="border:1px solid var(--border);padding:4px;">' + esc(String(p.avgMs)) + '</td>';
            html += '<td style="border:1px solid var(--border);padding:4px;">' + esc(String(p.maxMs)) + '</td>';
            html += '<td style="border:1px solid var(--border);padding:4px;" title="' + esc(pattern) + '">' + esc(pattern.length > 60 ? pattern.slice(0, 60) + '\u2026' : pattern) + '</td>';
            html += '</tr>';
          });
          html += '</table>';
        }

        if (data.recentQueries && data.recentQueries.length > 0) {
          html += '<p class="meta" style="margin-top:0.5rem;">Recent queries (newest first):</p>';
          html += '<table style="border-collapse:collapse;width:100%;font-size:12px;">';
          html += '<tr><th style="border:1px solid var(--border);padding:4px;">ms</th>';
          html += '<th style="border:1px solid var(--border);padding:4px;">Rows</th>';
          html += '<th style="border:1px solid var(--border);padding:4px;">SQL</th></tr>';
          data.recentQueries.forEach(function(q) {
            var sql = q.sql || '';
            var color = q.durationMs > 100 ? '#e57373' : (q.durationMs > 50 ? '#ffb74d' : 'var(--fg)');
            html += '<tr>';
            html += '<td style="border:1px solid var(--border);padding:4px;color:' + color + ';">' + esc(String(q.durationMs)) + '</td>';
            html += '<td style="border:1px solid var(--border);padding:4px;">' + esc(String(q.rowCount)) + '</td>';
            html += '<td style="border:1px solid var(--border);padding:4px;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(sql) + '">' + esc(sql.length > 80 ? sql.slice(0, 80) + '\u2026' : sql) + '</td>';
            html += '</tr>';
          });
          html += '</table>';
        }

        return html;
      }

      if (toggle && collapsible) {
        toggle.addEventListener('click', function() {
          const isCollapsed = collapsible.classList.contains('collapsed');
          collapsible.classList.toggle('collapsed', !isCollapsed);
          this.textContent = isCollapsed ? '\u25B2 Query performance' : '\u25BC Query performance';
          if (isCollapsed && !perfLoaded) fetchPerformance();
        });
      }

      if (refreshBtn) refreshBtn.addEventListener('click', fetchPerformance);

      if (clearBtn) clearBtn.addEventListener('click', function() {
        clearBtn.disabled = true;
        clearBtn.textContent = 'Clearing\u2026';
        fetch('/api/analytics/performance', authOpts({ method: 'DELETE' }))
          .then(function(r) {
            if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Clear failed'); });
            container.innerHTML = '<p class="meta">Performance history cleared.</p>';
            container.style.display = 'block';
            perfLoaded = false;
          })
          .catch(function(e) {
            container.innerHTML = '<p class="meta" style="color:#e57373;">Error: ' + esc(e.message) + '</p>';
            container.style.display = 'block';
          })
          .finally(function() {
            clearBtn.disabled = false;
            clearBtn.textContent = 'Clear';
          });
      });
    })();

  </script>
</body>
</html>
''';
}
