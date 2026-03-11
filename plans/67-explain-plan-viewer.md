# Feature 04: Query EXPLAIN Plan Viewer

**Effort:** S (Small) | **Priority:** 1

## Overview

Visualize SQLite's `EXPLAIN QUERY PLAN` output as a structured tree, helping developers understand query execution — whether indexes are used, table scans occur, etc. This is critical for catching performance issues in Flutter apps with complex Drift queries.

**User value:** One-click insight into query performance. See exactly which indexes are used (or missing) without leaving the viewer.

## Architecture

### Server-side (Dart)

Add `POST /api/sql/explain` endpoint that prepends `EXPLAIN QUERY PLAN` to the user's SQL and returns structured results. Validates the underlying SQL is read-only before explaining.

### Client-side (JS)

Add an "Explain" button next to the existing "Run" button in the SQL runner. Display results as an indented tree with performance warnings.

### VS Code Extension / Flutter

No changes.

### New Files

None.

## Implementation Details

### New Route Constants (near line 150)

```dart
static const String _pathApiSqlExplain = '/api/sql/explain';
static const String _pathApiSqlExplainAlt = 'api/sql/explain';
```

### Route Registration (in `_onRequest()`, ~line 660)

Add before the existing `POST /api/sql` handler:

```dart
if (req.method == _methodPost &&
    (path == _pathApiSqlExplain || path == _pathApiSqlExplainAlt)) {
  await _handleExplainSql(req, query);
  return;
}
```

### Server Handler

```dart
Future<void> _handleExplainSql(
  HttpRequest request,
  DriftDebugQuery query,
) async {
  final res = request.response;
  String body;
  try {
    final builder = BytesBuilder();
    await for (final chunk in request) {
      builder.add(chunk);
    }
    body = utf8.decode(builder.toBytes());
  } on Object catch (error, stack) {
    _logError(error, stack);
    res.statusCode = HttpStatus.badRequest;
    _setJsonHeaders(res);
    res.write(jsonEncode(<String, String>{
      _jsonKeyError: _errorInvalidRequestBody,
    }));
    await res.close();

   return;
  }

  final result = _parseSqlBody(request, body);
  final bodyObj = result.body;
  if (bodyObj == null) {
    res.statusCode = HttpStatus.badRequest;
    _setJsonHeaders(res);
    res.write(jsonEncode(<String, String>{
      _jsonKeyError: result.error ?? _errorInvalidJson,
    }));
    await res.close();

   return;
  }

  final String sql = bodyObj.sql;
  if (!_isReadOnlySql(sql)) {
    res.statusCode = HttpStatus.badRequest;
    _setJsonHeaders(res);
    res.write(jsonEncode(<String, String>{
      _jsonKeyError: _errorReadOnlyOnly,
    }));
    await res.close();

   return;
  }

  try {
    final explainSql = 'EXPLAIN QUERY PLAN $sql';
    final dynamic raw = await query(explainSql);
    final rows = _normalizeRows(raw);
    _setJsonHeaders(res);
    res.write(jsonEncode(<String, dynamic>{
      _jsonKeyRows: rows,
      _jsonKeySql: explainSql,
    }));
  } on Object catch (error, stack) {
    _logError(error, stack);
    res.statusCode = HttpStatus.internalServerError;
    _setJsonHeaders(res);
    res.write(jsonEncode(<String, String>{
      _jsonKeyError: error.toString(),
    }));
  } finally {
    await res.close();
  }
}
```

### Response Shape

```json
{
  "sql": "EXPLAIN QUERY PLAN SELECT * FROM users WHERE email = 'test@example.com'",
  "rows": [
    { "id": 0, "parent": 0, "notused": 0, "detail": "SCAN users" },
    {
      "id": 0,
      "parent": 0,
      "notused": 0,
      "detail": "SEARCH users USING INDEX idx_email (email=?)"
    }
  ]
}
```

### Client-side UI

Add "Explain" button in SQL toolbar (after Run button, ~line 1583):

```html
<button type="button" id="sql-explain">Explain</button>
```

JS handler:

```javascript
document.getElementById("sql-explain").addEventListener("click", function () {
  const sql = document.getElementById("sql-input").value.trim();
  if (!sql) return;
  const btn = this;
  const orig = btn.textContent;
  btn.textContent = "Explaining...";
  btn.disabled = true;
  const errorEl = document.getElementById("sql-error");
  const resultEl = document.getElementById("sql-result");
  errorEl.style.display = "none";
  resultEl.style.display = "none";

  fetch(
    "/api/sql/explain",
    authOpts({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql: sql }),
    }),
  )
    .then((r) => r.json().then((d) => ({ ok: r.ok, data: d })))
    .then(({ ok, data }) => {
      if (!ok) {
        errorEl.textContent = data.error;
        errorEl.style.display = "block";

        return;
      }
      const rows = data.rows || [];
      let html =
        '<p class="meta" style="font-weight:bold;">EXPLAIN QUERY PLAN</p>';
      html +=
        '<pre style="font-family:monospace;font-size:12px;line-height:1.6;">';

      let hasScan = false;
      let hasIndex = false;
      rows.forEach((r) => {
        const detail = r.detail || JSON.stringify(r);
        const indent = "  ".repeat(r.id || 0);
        let icon = "   ";
        let style = "";
        if (/\bSCAN\b/.test(detail)) {
          icon = "!! ";
          style = ' style="color:#e57373;"';
          hasScan = true;
        } else if (/SEARCH.*INDEX/.test(detail)) {
          icon = "OK ";
          style = ' style="color:#7cb342;"';
          hasIndex = true;
        } else if (/USING.*INDEX/.test(detail)) {
          icon = "OK ";
          style = ' style="color:#7cb342;"';
          hasIndex = true;
        }
        html +=
          "<span" + style + ">" + icon + indent + esc(detail) + "</span>\n";
      });

      html += "</pre>";

      if (hasScan) {
        html += '<p class="meta" style="color:#e57373;margin-top:0.3rem;">';
        html +=
          "Warning: Full table scan detected. Consider adding an index on the filtered/sorted column.</p>";
      }

      if (hasIndex && !hasScan) {
        html += '<p class="meta" style="color:#7cb342;margin-top:0.3rem;">';
        html += "Good: Query uses index(es) for efficient lookup.</p>";
      }

      resultEl.innerHTML = html;
      resultEl.style.display = "block";
    })
    .catch((e) => {
      errorEl.textContent = e.message;
      errorEl.style.display = "block";
    })
    .finally(() => {
      btn.disabled = false;
      btn.textContent = orig;
    });
});
```

## Effort Estimate

**S (Small)**

- Server: ~50 lines (one new handler reusing existing `_parseSqlBody`, `_isReadOnlySql`, `_normalizeRows`)
- Client: ~50 lines JS
- HTML: 1 button
- Follows existing SQL runner pattern exactly

## Dependencies & Risks

- **`EXPLAIN QUERY PLAN`** is SQLite-specific — fully appropriate since this tool targets SQLite.
- **Query callback support**: Some Drift `customSelect` implementations may not handle `EXPLAIN QUERY PLAN`. The error propagates cleanly as a 500 response.
- **Output format**: SQLite's EXPLAIN QUERY PLAN returns `id`, `parent`, `notused`, `detail` columns. These are stable across SQLite versions.
- **Read-only safety**: Validates underlying SQL is read-only before prepending EXPLAIN, preventing abuse.

## Testing Strategy

1. **Server test**: `POST /api/sql/explain` with `{"sql": "SELECT * FROM items"}` — verify response has `rows` with `detail` fields
2. **Rejection test**: `POST /api/sql/explain` with `{"sql": "DELETE FROM items"}` — verify 400 error
3. **Manual**: Write a query with and without an index on the filtered column:
   - `SELECT * FROM users WHERE email = 'test'` — should show SCAN (warning) if no index
   - After adding index, should show SEARCH USING INDEX (green)
4. **Empty result**: Explain a trivial query like `SELECT 1` — verify it renders without error
