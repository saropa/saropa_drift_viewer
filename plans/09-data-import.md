# Feature 09: Data Import (Debug Only) — COMPLETED

**Effort:** L (Large) | **Priority:** 14 | **Status:** Implemented

## Overview

Allow importing CSV, JSON, or SQL files into the database during debug sessions. Developers can seed test data, restore from exports, or load fixtures without restarting the app. Restricted to debug mode with clear warnings since it modifies the database.

**User value:** Quickly load test data or restore a previous export. Round-trip: export CSV, modify in a spreadsheet, import back.

## Architecture

### Server-side (Dart)

Add `POST /api/import` endpoint. Requires a new optional `DriftDebugWriteQuery` callback parameter in `DriftDebugServer.start()` that is only used by import. If not provided, import returns 501 Not Implemented.

### Client-side (JS)

Add import UI with file picker, format selector, table target, preview, and confirmation.

### VS Code Extension / Flutter

No changes.

### New Files

None, but requires changes to the public API surface:

- `lib/src/drift_debug_server_io.dart` — New handler + writeQuery field
- `lib/src/drift_debug_server_stub.dart` — Add writeQuery parameter (stub throws)
- `lib/src/start_drift_viewer_extension.dart` — Add optional writeQuery parameter

## Implementation Details

### New Typedef

```dart
/// Optional callback for write queries (INSERT/UPDATE/DELETE).
/// Separated from [DriftDebugQuery] to enforce read-only by default.
/// Debug-only: used exclusively by the import endpoint.
typedef DriftDebugWriteQuery = Future<void> Function(String sql);
```

### New Parameter in `start()`

Add to `_DriftDebugServerImpl`:

```dart
DriftDebugWriteQuery? _writeQuery;
```

Add to `start()` signature:

```dart
static Future<void> start({
  required DriftDebugQuery query,
  required bool enabled,
  // ... existing params ...
  DriftDebugWriteQuery? writeQuery, // NEW
}) async {
  // ... existing logic ...
  _instance._writeQuery = writeQuery;
}
```

### New Endpoint: `POST /api/import`

```dart
static const String _pathApiImport = '/api/import';
static const String _pathApiImportAlt = 'api/import';

Future<void> _handleImport(HttpRequest request) async {
  final res = request.response;
  final writeQuery = _writeQuery;

  if (writeQuery == null) {
    res.statusCode = HttpStatus.notImplemented;
    _setJsonHeaders(res);
    res.write(jsonEncode(<String, String>{
      _jsonKeyError:
          'Import not configured. Pass writeQuery to DriftDebugServer.start().',
    }));
    await res.close();

   return;
  }

  try {
    final builder = BytesBuilder();
    await for (final chunk in request) {
      builder.add(chunk);
    }
    final body = utf8.decode(builder.toBytes());
    final decoded = jsonDecode(body) as Map<String, dynamic>;
    final format = decoded['format'] as String?;
    final data = decoded['data'] as String?;
    final table = decoded['table'] as String?;

    if (format == null || data == null || table == null) {
      res.statusCode = HttpStatus.badRequest;
      _setJsonHeaders(res);
      res.write(jsonEncode(<String, String>{
        _jsonKeyError: 'Missing required fields: format, data, table',
      }));
      await res.close();

   return;
    }

    // Validate table exists
    final tableNames = await _getTableNames(_query!);
    if (!tableNames.contains(table)) {
      res.statusCode = HttpStatus.badRequest;
      _setJsonHeaders(res);
      res.write(jsonEncode(<String, String>{
        _jsonKeyError: 'Table "$table" not found.',
      }));
      await res.close();

   return;
    }

    int imported = 0;
    final errors = <String>[];

    if (format == 'json') {
      final rows = jsonDecode(data) as List<dynamic>;
      for (int i = 0; i < rows.length; i++) {
        final row = rows[i];
        if (row is! Map) {
          errors.add('Row $i: not an object');
          continue;
        }
        try {
          final keys = row.keys.toList();
          final cols = keys.map((k) => '"$k"').join(', ');
          final vals = keys.map((k) => _sqlLiteral(row[k])).join(', ');
          await writeQuery('INSERT INTO "$table" ($cols) VALUES ($vals)');
          imported++;
        } on Object catch (e) {
          errors.add('Row $i: $e');
        }
      }
    } else if (format == 'csv') {
      final lines = _parseCsvLines(data);
      if (lines.length < 2) {
        res.statusCode = HttpStatus.badRequest;
        _setJsonHeaders(res);
        res.write(jsonEncode(<String, String>{
          _jsonKeyError: 'CSV must have a header row and at least one data row.',
        }));
        await res.close();

   return;
      }
      final headers = lines[0];
      for (int i = 1; i < lines.length; i++) {
        try {
          final values = lines[i];
          if (values.length != headers.length) {
            errors.add('Row $i: column count mismatch (${values.length} vs ${headers.length})');
            continue;
          }
          final cols = headers.map((h) => '"$h"').join(', ');
          final vals = values.map((v) => _sqlLiteral(v)).join(', ');
          await writeQuery('INSERT INTO "$table" ($cols) VALUES ($vals)');
          imported++;
        } on Object catch (e) {
          errors.add('Row $i: $e');
        }
      }
    } else if (format == 'sql') {
      final statements = data
          .split(';')
          .map((s) => s.trim())
          .where((s) => s.isNotEmpty);
      for (final stmt in statements) {
        try {
          await writeQuery('$stmt;');
          imported++;
        } on Object catch (e) {
          errors.add('Statement error: $e');
        }
      }
    } else {
      res.statusCode = HttpStatus.badRequest;
      _setJsonHeaders(res);
      res.write(jsonEncode(<String, String>{
        _jsonKeyError: 'Unsupported format: $format. Use json, csv, or sql.',
      }));
      await res.close();

   return;
    }

    _setJsonHeaders(res);
    res.write(jsonEncode(<String, dynamic>{
      'imported': imported,
      'errors': errors,
      'format': format,
      'table': table,
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

### Helper: SQL Literal Escaping

```dart
static String _sqlLiteral(dynamic value) {
  if (value == null) return 'NULL';
  if (value is int || value is double) return '$value';
  if (value is bool) return value ? '1' : '0';
  final str = value.toString().replaceAll("'", "''");
  return "'$str'";
}
```

### Helper: CSV Parser (handles quoted fields)

```dart
static List<List<String>> _parseCsvLines(String csv) {
  final result = <List<String>>[];
  final lines = csv.split('\n');
  for (final line in lines) {
    if (line.trim().isEmpty) continue;
    final fields = <String>[];
    var inQuotes = false;
    final current = StringBuffer();
    for (int i = 0; i < line.length; i++) {
      final c = line[i];
      if (c == '"') {
        if (inQuotes && i + 1 < line.length && line[i + 1] == '"') {
          current.write('"');
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c == ',' && !inQuotes) {
        fields.add(current.toString().trim());
        current.clear();
      } else {
        current.write(c);
      }
    }
    fields.add(current.toString().trim());
    result.add(fields);
  }
  return result;
}
```

### Client-side UI

```html
<div class="collapsible-header" id="import-toggle">
  Import data (debug only)
</div>
<div id="import-collapsible" class="collapsible-body collapsed">
  <p class="meta" style="color:#e57373;font-weight:bold;">
    Warning: This modifies the database. Debug use only.
  </p>
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
  <pre
    id="import-preview"
    class="meta"
    style="display:none;max-height:15vh;overflow:auto;font-size:11px;"
  ></pre>
  <p id="import-status" class="meta"></p>
</div>
```

### JS Handler

```javascript
// Populate table selector from existing table list
function populateImportTables() {
  const sel = document.getElementById("import-table");
  if (!sel) return;
  sel.innerHTML = tableCounts
    .map(function (t) {
      return (
        '<option value="' +
        esc(t.name) +
        '">' +
        esc(t.name) +
        " (" +
        t.count +
        " rows)</option>"
      );
    })
    .join("");
}

// File selection with preview
document.getElementById("import-file").addEventListener("change", function () {
  const file = this.files[0];
  const preview = document.getElementById("import-preview");
  const importBtn = document.getElementById("import-run");
  if (!file) {
    preview.style.display = "none";
    importBtn.disabled = true;

    return;
  }
  const reader = new FileReader();
  reader.onload = function () {
    const text = reader.result;
    preview.textContent =
      text.slice(0, 2000) +
      (text.length > 2000 ? "\n... (" + text.length + " chars total)" : "");
    preview.style.display = "block";
    importBtn.disabled = false;
    window._importData = text;
  };
  reader.readAsText(file);
});

// Import execution
document.getElementById("import-run").addEventListener("click", function () {
  const table = document.getElementById("import-table").value;
  const format = document.getElementById("import-format").value;
  const data = window._importData;
  if (!data || !table) return;

  if (
    !confirm(
      "Import " +
        format.toUpperCase() +
        ' data into "' +
        table +
        '"?\nThis will INSERT rows into the table.',
    )
  )
    return;

  const btn = this;
  const status = document.getElementById("import-status");
  btn.disabled = true;
  btn.textContent = "Importing...";
  status.textContent = "";

  fetch(
    "/api/import",
    authOpts({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table: table, format: format, data: data }),
    }),
  )
    .then(function (r) {
      return r.json();
    })
    .then(function (result) {
      if (result.error) {
        status.textContent = "Error: " + result.error;
        status.style.color = "#e57373";
      } else {
        status.textContent =
          "Imported " +
          result.imported +
          " row(s)." +
          (result.errors && result.errors.length > 0
            ? " Errors: " + result.errors.length
            : "");
        status.style.color =
          result.errors && result.errors.length > 0 ? "#ffb74d" : "#7cb342";
        // Refresh table data
        if (currentTableName === table) loadTable(table);
      }
    })
    .catch(function (e) {
      status.textContent = "Error: " + e.message;
      status.style.color = "#e57373";
    })
    .finally(function () {
      btn.disabled = false;
      btn.textContent = "Import";
    });
});
```

## Effort Estimate

**L (Large)**

- Server: ~120 lines (handler + CSV parser + SQL literal helper)
- Client: ~80 lines JS, ~20 lines HTML
- Public API change: new `writeQuery` parameter in `start()`
- Stub file update required
- CSV parser handles edge cases (quoted fields, embedded commas)

## Dependencies & Risks

- **CRITICAL: Write access**: The `writeQuery` callback bypasses read-only safety. Must be:
  - Clearly documented as debug-only
  - Opt-in (returns 501 if not configured)
  - Separate from the read query callback
- **CSV parsing**: Naive splitting on commas fails for quoted fields. The state-machine parser handles `"field with, comma"` correctly.
- **SQL injection**: Table names are validated against `sqlite_master` allow-list. Column names come from the imported data, which could be malicious. Mitigate by quoting all identifiers.
- **Large files**: 10MB+ imports could be slow. The UI shows a preview and the server processes synchronously. Consider adding a row limit.
- **Public API change**: Adding `writeQuery` to `start()` requires updating:
  - `drift_debug_server_stub.dart` (add parameter, still throws)
  - `start_drift_viewer_extension.dart` (add optional forwarding)

## Testing Strategy

1. **501 without writeQuery**: Start server without writeQuery, POST /api/import — verify 501
2. **JSON import**: Configure writeQuery, import `[{"name":"test"}]` — verify `imported: 1`
3. **CSV import**: Import `name,age\ntest,25` — verify INSERT generated correctly
4. **SQL import**: Import `INSERT INTO items (name) VALUES ('test')` — verify execution
5. **Invalid table**: Import into non-existent table — verify 400 error
6. **Malformed data**: Import invalid JSON — verify error message
7. **CSV with quotes**: Import CSV with `"field, with comma"` — verify correct parsing
8. **Manual round-trip**: Export table as CSV, modify, import back, verify data
