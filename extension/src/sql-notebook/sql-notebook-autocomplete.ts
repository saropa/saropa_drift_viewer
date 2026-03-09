/**
 * Inline JS for schema-aware autocomplete in the SQL Notebook textarea.
 *
 * Triggers:
 * - After `FROM` / `JOIN`: table names
 * - After `tableName.`: column names for that table
 * - After `SELECT` / `,`: all columns (prefixed with table name)
 * - Partial word (≥2 chars): SQL keywords + table names
 *
 * Injected into the HTML scaffold by {@link getNotebookHtml}.
 */
export function getAutocompleteJs(): string {
  return `
  // --- Autocomplete ---

  var sqlKeywords = [
    'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
    'ON', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN', 'ORDER', 'BY',
    'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'INSERT', 'INTO', 'VALUES',
    'UPDATE', 'SET', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'TABLE',
    'INDEX', 'AS', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
    'NULL', 'IS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'EXISTS',
    'UNION', 'ALL', 'ASC', 'DESC'
  ];

  var textarea = document.getElementById('sql-input');
  var dropdown = document.getElementById('autocomplete-dropdown');
  var acItems = [];
  var acIndex = -1;

  textarea.addEventListener('input', onAcInput);
  textarea.addEventListener('keydown', onAcKeydown);
  document.addEventListener('click', function (e) {
    if (!dropdown.contains(e.target) && e.target !== textarea) hideDropdown();
  });

  function onAcInput() {
    var text = textarea.value;
    var pos = textarea.selectionStart;
    var before = text.substring(0, pos);

    var suggestions = getAcSuggestions(before);
    if (suggestions.length === 0) { hideDropdown(); return; }

    acItems = suggestions;
    acIndex = 0;
    renderAcDropdown();
  }

  function getAcSuggestions(before) {
    if (!schema) return [];

    if (/(?:FROM|JOIN)\\s+$/i.test(before)) {
      return schema.map(function (t) { return { label: t.name, type: 'table' }; });
    }

    var dotMatch = before.match(/(\\w+)\\.\\s*$/);
    if (dotMatch) {
      var tableName = dotMatch[1];
      var table = schema.find(function (t) {
        return t.name.toLowerCase() === tableName.toLowerCase();
      });
      if (table) {
        return table.columns.map(function (c) { return { label: c.name, type: c.type }; });
      }
    }

    if (/(?:SELECT|,)\\s+$/i.test(before)) {
      var allCols = [];
      for (var i = 0; i < schema.length; i++) {
        for (var j = 0; j < schema[i].columns.length; j++) {
          allCols.push({
            label: schema[i].name + '.' + schema[i].columns[j].name,
            type: schema[i].columns[j].type
          });
        }
      }
      return allCols.slice(0, 30);
    }

    var wordMatch = before.match(/(\\w+)$/);
    if (wordMatch && wordMatch[1].length >= 2) {
      var prefix = wordMatch[1].toLowerCase();
      var results = [];
      for (var k = 0; k < sqlKeywords.length; k++) {
        if (sqlKeywords[k].toLowerCase().startsWith(prefix)) {
          results.push({ label: sqlKeywords[k], type: 'keyword' });
        }
      }
      for (var m = 0; m < schema.length; m++) {
        if (schema[m].name.toLowerCase().startsWith(prefix)) {
          results.push({ label: schema[m].name, type: 'table' });
        }
      }
      return results.slice(0, 15);
    }

    return [];
  }

  function onAcKeydown(e) {
    if (dropdown.style.display === 'none') return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      acIndex = Math.min(acIndex + 1, acItems.length - 1);
      renderAcDropdown();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      acIndex = Math.max(acIndex - 1, 0);
      renderAcDropdown();
    } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      if (acItems.length > 0 && acIndex >= 0) {
        e.preventDefault();
        applyCompletion(acItems[acIndex]);
      }
    } else if (e.key === 'Escape') {
      hideDropdown();
    } else if (e.key === 'Tab') {
      if (acItems.length > 0 && acIndex >= 0) {
        e.preventDefault();
        applyCompletion(acItems[acIndex]);
      }
    }
  }

  function applyCompletion(item) {
    var pos = textarea.selectionStart;
    var text = textarea.value;
    var before = text.substring(0, pos);
    var wordMatch = before.match(/(\\w+)\\.?$/);
    var replaceFrom = wordMatch ? pos - wordMatch[0].length : pos;
    textarea.value = text.substring(0, replaceFrom) + item.label + text.substring(pos);
    textarea.selectionStart = textarea.selectionEnd = replaceFrom + item.label.length;
    hideDropdown();
    textarea.focus();
  }

  function renderAcDropdown() {
    dropdown.style.display = '';
    var html = '';
    for (var i = 0; i < acItems.length; i++) {
      var cls = i === acIndex ? 'ac-item ac-selected' : 'ac-item';
      var badge = acItems[i].type !== 'keyword'
        ? '<span class="ac-type">' + esc(acItems[i].type) + '</span>' : '';
      html += '<div class="' + cls + '" data-idx="' + i + '">'
        + esc(acItems[i].label) + badge + '</div>';
    }
    dropdown.innerHTML = html;

    dropdown.querySelectorAll('.ac-item').forEach(function (el) {
      el.addEventListener('click', function () {
        acIndex = Number(el.dataset.idx);
        applyCompletion(acItems[acIndex]);
      });
    });
  }

  function hideDropdown() {
    dropdown.style.display = 'none';
    acItems = [];
    acIndex = -1;
  }
`;
}
