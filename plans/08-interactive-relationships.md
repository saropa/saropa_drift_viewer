# Feature 08: Interactive Table Relationship Explorer

**Effort:** M (Medium) | **Priority:** 5

## Overview

Click on any foreign key value in the table data view to navigate directly to the referenced row in the parent table. FK columns are visually marked with an arrow icon. This turns the data browser into an interactive relationship explorer where developers follow data paths through the schema without writing SQL.

**User value:** Explore data relationships by clicking. "This order has user_id=42 — click to see that user." No SQL required.

## Architecture

### Server-side (Dart)

Add `GET /api/table/{name}/fk-meta` endpoint returning FK metadata for a specific table. Reuses existing `PRAGMA foreign_key_list` logic (already used by `_getDiagramData` at line 1070).

### Client-side (JS)

Modify the table data renderer to detect FK columns and render values as clickable links. When clicked, load the target table filtered to the referenced row.

### VS Code Extension / Flutter

No changes.

### New Files

None.

## Implementation Details

### New Endpoint: `GET /api/table/{name}/fk-meta`

Route constant:

```dart
// Route suffix detected in existing table path handler
// Path: /api/table/{name}/fk-meta
```

Handler:

```dart
Future<void> _sendTableFkMeta(
  HttpResponse response,
  DriftDebugQuery query,
  String tableName,
) async {
  final res = response;
  if (!await _requireKnownTable(res, query, tableName)) return;
  try {
    final fkRows = _normalizeRows(
      await query('PRAGMA foreign_key_list("$tableName")'),
    );
    final fks = fkRows
        .map((r) => <String, dynamic>{
              'fromColumn': r['from'],
              'toTable': r['table'],
              'toColumn': r['to'],
            })
        .toList();
    _setJsonHeaders(res);
    res.write(jsonEncode(fks));
  } on Object catch (error, stack) {
    _logError(error, stack);
    await _sendErrorResponse(res, error);
  } finally {
    await res.close();
  }
}
```

Route registration (in the table path handler area, ~line 630):

```dart
if (suffix.endsWith('/fk-meta')) {
  final tableName = suffix.replaceFirst(RegExp(r'/fk-meta$'), '');
  await _sendTableFkMeta(res, query, tableName);
  return;
}
```

### Response Shape

```json
[
  { "fromColumn": "user_id", "toTable": "users", "toColumn": "id" },
  { "fromColumn": "category_id", "toTable": "categories", "toColumn": "id" }
]
```

### Client-side FK-aware Rendering

```javascript
// Cache FK metadata per table to avoid repeated requests
const fkMetaCache = {};

async function loadFkMeta(tableName) {
  if (fkMetaCache[tableName]) return fkMetaCache[tableName];
  try {
    const r = await fetch(
      "/api/table/" + encodeURIComponent(tableName) + "/fk-meta",
      authOpts(),
    );
    const fks = await r.json();
    fkMetaCache[tableName] = fks;
    return fks;
  } catch (e) {
    return [];
  }
}

// Enhanced table renderer with FK links
async function renderTableDataWithFks(container, tableName, rows) {
  if (!rows || rows.length === 0) return;
  const fks = await loadFkMeta(tableName);
  const fkMap = {};
  (fks || []).forEach((fk) => {
    fkMap[fk.fromColumn] = fk;
  });

  const keys = Object.keys(rows[0]);
  let html =
    '<table style="border-collapse:collapse;width:100%;font-size:12px;">';

  // Header with FK indicators
  html += "<tr>";
  keys.forEach((k) => {
    const fk = fkMap[k];
    const fkLabel = fk
      ? ' <span style="color:var(--muted);font-size:10px;" title="FK to ' +
        esc(fk.toTable) +
        "." +
        esc(fk.toColumn) +
        '">&#8599;</span>'
      : "";
    html +=
      '<th style="border:1px solid var(--border);padding:3px 6px;">' +
      esc(k) +
      fkLabel +
      "</th>";
  });
  html += "</tr>";

  // Rows with clickable FK values
  rows.forEach((row) => {
    html += "<tr>";
    keys.forEach((k) => {
      const val = row[k];
      const fk = fkMap[k];
      if (fk && val != null) {
        html += '<td style="border:1px solid var(--border);padding:3px 6px;">';
        html +=
          '<a href="#" class="fk-link" style="color:var(--link);text-decoration:underline;" ';
        html += 'data-table="' + esc(fk.toTable) + '" ';
        html += 'data-column="' + esc(fk.toColumn) + '" ';
        html += 'data-value="' + esc(String(val)) + '">';
        html += esc(String(val)) + " &#8594;</a></td>";
      } else {
        html +=
          '<td style="border:1px solid var(--border);padding:3px 6px;">' +
          esc(val != null ? String(val) : "") +
          "</td>";
      }
    });
    html += "</tr>";
  });

  html += "</table>";
  container.innerHTML = html;
}
```

### FK Navigation with Breadcrumb Trail

```javascript
// Navigation history for breadcrumb
const navHistory = [];

// Event delegation for FK clicks
document.addEventListener("click", function (e) {
  const link = e.target.closest(".fk-link");
  if (!link) return;
  e.preventDefault();

  const table = link.dataset.table;
  const column = link.dataset.column;
  const value = link.dataset.value;

  // Push current state to history
  navHistory.push({
    table: currentTableName,
    offset: offset,
    filter: document.getElementById("row-filter").value,
  });

  // Navigate: load the target table and set a filter via SQL
  const isNumeric = !isNaN(value) && value.trim() !== "";
  const sqlValue = isNumeric ? value : "'" + value.replace(/'/g, "''") + "'";
  document.getElementById("sql-input").value =
    'SELECT * FROM "' + table + '" WHERE "' + column + '" = ' + sqlValue;
  document.getElementById("sql-run").click();

  // Also update table selection
  loadTable(table);

  // Update breadcrumb
  renderBreadcrumb();
});

function renderBreadcrumb() {
  let el = document.getElementById("nav-breadcrumb");
  if (!el) {
    el = document.createElement("div");
    el.id = "nav-breadcrumb";
    el.style.cssText = "font-size:11px;margin:0.3rem 0;color:var(--muted);";
    document.getElementById("content").prepend(el);
  }

  if (navHistory.length === 0) {
    el.style.display = "none";

    return;
  }

  let html =
    '<a href="#" id="nav-back" style="color:var(--link);">&#8592; Back</a> | Path: ';
  html += navHistory.map((h) => esc(h.table)).join(" &#8594; ");
  html += " &#8594; <strong>" + esc(currentTableName || "") + "</strong>";
  el.innerHTML = html;
  el.style.display = "block";

  document.getElementById("nav-back").addEventListener("click", function (e) {
    e.preventDefault();
    const prev = navHistory.pop();
    if (prev) {
      loadTable(prev.table);
      if (prev.filter)
        document.getElementById("row-filter").value = prev.filter;
      renderBreadcrumb();
    }
  });
}
```

## Effort Estimate

**M (Medium)**

- Server: ~25 lines (one small endpoint reusing existing PRAGMA pattern)
- Client: ~100 lines JS (FK-aware rendering, navigation, breadcrumb)
- HTML: ~5 lines
- Key complexity: integration with existing table rendering and navigation state

## Dependencies & Risks

- **Only declared FKs**: Tables using implicit FK patterns (`user_id` without `FOREIGN KEY` constraint) won't be detected. Could add a heuristic fallback using column naming patterns (combine with Feature #05 Smart Index Suggestions).
- **Self-referential FKs**: `parent_id` on the same table could create navigation loops. The breadcrumb trail makes this visible, and the Back button provides an escape.
- **Performance**: FK metadata is cached per table, so repeated navigation doesn't trigger extra requests.
- **SQL injection via FK values**: Values are properly escaped (numeric check + single-quote escaping). Table/column names come from PRAGMA output, not user input.

## Testing Strategy

1. **Server test**: `GET /api/table/orders/fk-meta` returns FK metadata for a table with declared foreign keys
2. **No FKs**: Table without foreign keys returns empty array, no link icons shown
3. **Navigation**: Click FK value, verify target table loads with correct filter
4. **Breadcrumb**: Navigate 3 levels deep, verify breadcrumb shows full path
5. **Back button**: Click Back, verify previous table and state restored
6. **Self-referential**: Table with `parent_id` FK to itself — verify navigation works without infinite loop
7. **Composite FK**: Table with multi-column foreign key — should show links on each column
