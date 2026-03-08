# Feature 05: Smart Index Suggestions

**Effort:** M (Medium) | **Priority:** 6

## Overview

Analyze table schemas to suggest missing indexes. Examines foreign key columns without indexes, columns with naming patterns suggesting frequent query use (`*_id`, `*_at`, `*_date`), and existing index coverage. Returns ready-to-use `CREATE INDEX` statements.

**User value:** Catch missing indexes during debug before they become production performance issues. Zero effort — just click "Analyze".

## Architecture

### Server-side (Dart)

Add `GET /api/index-suggestions` endpoint that queries `PRAGMA index_list`, `PRAGMA index_info`, `PRAGMA table_info`, and `PRAGMA foreign_key_list` for each table.

### Client-side (JS)

Add a collapsible "Index Suggestions" section with an Analyze button and results display.

### VS Code Extension / Flutter

No changes.

### New Files

None.

## Implementation Details

### Route Constants

```dart
static const String _pathApiIndexSuggestions = '/api/index-suggestions';
static const String _pathApiIndexSuggestionsAlt = 'api/index-suggestions';
```

### Server Handler

```dart
Future<void> _handleIndexSuggestions(
  HttpResponse response,
  DriftDebugQuery query,
) async {
  final res = response;
  try {
    final tableNames = await _getTableNames(query);
    final suggestions = <Map<String, dynamic>>[];

    for (final tableName in tableNames) {
      // Get existing indexed columns
      final existingIndexRows = _normalizeRows(
        await query('PRAGMA index_list("$tableName")'),
      );
      final indexedColumns = <String>{};
      for (final idx in existingIndexRows) {
        final idxName = idx['name'] as String?;
        if (idxName == null) continue;
        final idxInfoRows = _normalizeRows(
          await query('PRAGMA index_info("$idxName")'),
        );
        for (final col in idxInfoRows) {
          final colName = col['name'] as String?;
          if (colName != null) indexedColumns.add(colName);
        }
      }

      // Check foreign keys — these columns should always be indexed
      final fkRows = _normalizeRows(
        await query('PRAGMA foreign_key_list("$tableName")'),
      );
      for (final fk in fkRows) {
        final fromCol = fk['from'] as String?;
        if (fromCol != null && !indexedColumns.contains(fromCol)) {
          suggestions.add(<String, dynamic>{
            'table': tableName,
            'column': fromCol,
            'reason':
                'Foreign key without index (references ${fk['table']}.${fk['to']})',
            'sql':
                'CREATE INDEX idx_${tableName}_$fromCol ON "$tableName"("$fromCol");',
            'priority': 'high',
          });
        }
      }

      // Check column naming patterns
      final colInfoRows = _normalizeRows(
        await query('PRAGMA table_info("$tableName")'),
      );
      for (final col in colInfoRows) {
        final colName = col['name'] as String?;
        final pk = col['pk'];
        if (colName == null) continue;
        if (pk is int && pk > 0) continue; // Skip PKs
        if (indexedColumns.contains(colName)) continue; // Skip indexed

        // Columns ending in _id likely used in JOINs/WHERE
        if (RegExp(r'_id$', caseSensitive: false).hasMatch(colName)) {
          // Skip if already suggested as FK
          final alreadySuggested = suggestions.any(
            (s) => s['table'] == tableName && s['column'] == colName,
          );
          if (!alreadySuggested) {
            suggestions.add(<String, dynamic>{
              'table': tableName,
              'column': colName,
              'reason': 'Column ending in _id — likely used in JOINs/WHERE',
              'sql':
                  'CREATE INDEX idx_${tableName}_$colName ON "$tableName"("$colName");',
              'priority': 'medium',
            });
          }
        }

        // Date/time columns often used in ORDER BY or range queries
        if (RegExp(
          r'(created|updated|deleted|date|time|_at)$',
          caseSensitive: false,
        ).hasMatch(colName)) {
          suggestions.add(<String, dynamic>{
            'table': tableName,
            'column': colName,
            'reason': 'Date/time column — often used in ORDER BY or range queries',
            'sql':
                'CREATE INDEX idx_${tableName}_$colName ON "$tableName"("$colName");',
            'priority': 'low',
          });
        }
      }
    }

    // Sort by priority
    final priorityOrder = {'high': 0, 'medium': 1, 'low': 2};
    suggestions.sort((a, b) => (priorityOrder[a['priority']] ?? 3)
        .compareTo(priorityOrder[b['priority']] ?? 3));

    _setJsonHeaders(res);
    res.write(jsonEncode(<String, dynamic>{
      'suggestions': suggestions,
      'tablesAnalyzed': tableNames.length,
      'existingIndexCount': 0, // Could aggregate
    }));
  } on Object catch (error, stack) {
    _logError(error, stack);
    await _sendErrorResponse(res, error);
  } finally {
    await res.close();
  }
}
```

### Response Shape

```json
{
  "suggestions": [
    {
      "table": "orders",
      "column": "user_id",
      "reason": "Foreign key without index (references users.id)",
      "sql": "CREATE INDEX idx_orders_user_id ON \"orders\"(\"user_id\");",
      "priority": "high"
    },
    {
      "table": "orders",
      "column": "created_at",
      "reason": "Date/time column — often used in ORDER BY or range queries",
      "sql": "CREATE INDEX idx_orders_created_at ON \"orders\"(\"created_at\");",
      "priority": "low"
    }
  ],
  "tablesAnalyzed": 5
}
```

### Client-side UI

HTML:

```html
<div class="collapsible-header" id="index-toggle">Index suggestions</div>
<div id="index-collapsible" class="collapsible-body collapsed">
  <p class="meta">
    Analyze tables for missing indexes based on schema patterns.
  </p>
  <button type="button" id="index-analyze">Analyze</button>
  <div id="index-results" style="display:none;"></div>
</div>
```

JS:

```javascript
document.getElementById("index-analyze").addEventListener("click", function () {
  const btn = this;
  const container = document.getElementById("index-results");
  btn.disabled = true;
  btn.textContent = "Analyzing...";
  container.style.display = "none";

  fetch("/api/index-suggestions", authOpts())
    .then((r) => r.json())
    .then((data) => {
      const suggestions = data.suggestions || [];
      if (suggestions.length === 0) {
        container.innerHTML =
          '<p class="meta" style="color:#7cb342;">No index suggestions — schema looks good!</p>';
        container.style.display = "block";

        return;
      }

      const priorityColors = {
        high: "#e57373",
        medium: "#ffb74d",
        low: "#7cb342",
      };
      let html =
        '<p class="meta">' +
        suggestions.length +
        " suggestion(s) across " +
        data.tablesAnalyzed +
        " tables:</p>";
      html +=
        '<table style="border-collapse:collapse;width:100%;font-size:12px;">';
      html +=
        '<tr><th style="border:1px solid var(--border);padding:4px;">Priority</th><th style="border:1px solid var(--border);padding:4px;">Table.Column</th><th style="border:1px solid var(--border);padding:4px;">Reason</th><th style="border:1px solid var(--border);padding:4px;">SQL</th></tr>';
      suggestions.forEach((s) => {
        const color = priorityColors[s.priority] || "var(--fg)";
        html += "<tr>";
        html +=
          '<td style="border:1px solid var(--border);padding:4px;color:' +
          color +
          ';font-weight:bold;">' +
          esc(s.priority).toUpperCase() +
          "</td>";
        html +=
          '<td style="border:1px solid var(--border);padding:4px;">' +
          esc(s.table) +
          "." +
          esc(s.column) +
          "</td>";
        html +=
          '<td style="border:1px solid var(--border);padding:4px;">' +
          esc(s.reason) +
          "</td>";
        html +=
          '<td style="border:1px solid var(--border);padding:4px;"><code style="font-size:11px;cursor:pointer;" title="Click to copy" onclick="navigator.clipboard.writeText(this.textContent)">' +
          esc(s.sql) +
          "</code></td>";
        html += "</tr>";
      });
      html += "</table>";
      container.innerHTML = html;
      container.style.display = "block";
    })
    .catch((e) => {
      container.innerHTML =
        '<p class="meta" style="color:#e57373;">Error: ' +
        esc(e.message) +
        "</p>";
      container.style.display = "block";
    })
    .finally(() => {
      btn.disabled = false;
      btn.textContent = "Analyze";
    });
});
```

## Effort Estimate

**M (Medium)**

- Server: ~80 lines (PRAGMA queries + analysis logic)
- Client: ~50 lines JS, ~10 lines HTML
- Requires understanding of SQLite PRAGMA commands

## Dependencies & Risks

- **PRAGMA support**: `PRAGMA index_list`, `PRAGMA index_info`, and `PRAGMA foreign_key_list` should work through most query callbacks including Drift's `customSelect`. If not, error propagates cleanly.
- **False positives**: Small tables where indexes add overhead. Mitigate by noting in the reason text that indexes are most beneficial for tables with many rows.
- **Column naming conventions**: The regex patterns (`_id$`, `_at$`) cover common Dart/Flutter conventions. Non-standard names won't be caught, which is acceptable.
- **Heuristic-only**: This is pattern-based, not query-log-based. Feature #13 (Performance Monitor) could feed actual query data into this analysis in a future iteration.

## Testing Strategy

1. **Server test**: Mock query returning tables with FK columns but no indexes — verify suggestions generated
2. **PK exclusion**: Verify primary key columns are never suggested
3. **Already indexed**: Mock a column that has an index — verify it's excluded
4. **No suggestions**: Clean schema with all FKs indexed — verify empty response with positive message
5. **Manual**: Run against a real Drift database with intentional missing indexes
6. **Copy-to-clipboard**: Click the SQL code — verify it copies correctly
