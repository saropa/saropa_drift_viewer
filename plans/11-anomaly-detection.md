# Feature 11: AI Data Anomaly Detection

**Effort:** L (Large) | **Priority:** 13

## Overview

Automatically scan tables for data quality issues: NULL values in nullable columns, empty strings, orphaned foreign key references, duplicate rows, and numeric outliers. Results are presented as a prioritized list with severity badges. All analysis runs server-side using pure SQL — no AI/ML libraries needed. The "AI" is heuristic pattern matching.

**User value:** One-click database health check. Find data quality issues before they cause bugs in production.

## Architecture

### Server-side (Dart)

Add `GET /api/analytics/anomalies` endpoint that runs diagnostic SQL queries across all tables and columns.

### Client-side (JS)

Add a collapsible "Data Health" section with an Analyze button and severity-coded results.

### VS Code Extension / Flutter

No changes.

### New Files

None.

## Implementation Details

### Route Constants

```dart
static const String _pathApiAnalyticsAnomalies = '/api/analytics/anomalies';
static const String _pathApiAnalyticsAnomaliesAlt = 'api/analytics/anomalies';
```

### Server Handler

```dart
Future<void> _handleAnomalyDetection(
  HttpResponse response,
  DriftDebugQuery query,
) async {
  final res = response;
  try {
    final tableNames = await _getTableNames(query);
    final anomalies = <Map<String, dynamic>>[];

    for (final tableName in tableNames) {
      final colInfoRows = _normalizeRows(
        await query('PRAGMA table_info("$tableName")'),
      );

      for (final col in colInfoRows) {
        final colName = col['name'] as String?;
        final colType = (col['type'] as String?) ?? '';
        final isNullable = col['notnull'] is int && (col['notnull'] as int) == 0;
        if (colName == null) continue;

        // 1. NULL values in nullable columns
        if (isNullable) {
          final nullCount = _extractCountFromRows(_normalizeRows(
            await query(
              'SELECT COUNT(*) AS c FROM "$tableName" WHERE "$colName" IS NULL',
            ),
          ));
          if (nullCount > 0) {
            final totalCount = _extractCountFromRows(_normalizeRows(
              await query('SELECT COUNT(*) AS c FROM "$tableName"'),
            ));
            final pct = totalCount > 0 ? (nullCount / totalCount * 100) : 0;
            anomalies.add(<String, dynamic>{
              'table': tableName,
              'column': colName,
              'type': 'null_values',
              'severity': pct > 50 ? 'warning' : 'info',
              'count': nullCount,
              'message':
                  '$nullCount NULL value(s) in $tableName.$colName (${pct.toStringAsFixed(1)}%)',
            });
          }
        }

        // 2. Empty strings in text columns
        if (_isTextType(colType)) {
          final emptyCount = _extractCountFromRows(_normalizeRows(
            await query(
              "SELECT COUNT(*) AS c FROM \"$tableName\" WHERE \"$colName\" = ''",
            ),
          ));
          if (emptyCount > 0) {
            anomalies.add(<String, dynamic>{
              'table': tableName,
              'column': colName,
              'type': 'empty_strings',
              'severity': 'warning',
              'count': emptyCount,
              'message':
                  '$emptyCount empty string(s) in $tableName.$colName',
            });
          }
        }

        // 3. Numeric outliers (values where max > 10x avg)
        if (_isNumericType(colType)) {
          final statsRows = _normalizeRows(await query(
            'SELECT AVG("$colName") AS avg_val, '
            'MIN("$colName") AS min_val, '
            'MAX("$colName") AS max_val '
            'FROM "$tableName" WHERE "$colName" IS NOT NULL',
          ));
          if (statsRows.isNotEmpty) {
            final avg = _toDouble(statsRows.first['avg_val']);
            final min = _toDouble(statsRows.first['min_val']);
            final max = _toDouble(statsRows.first['max_val']);
            if (avg != null && min != null && max != null && avg != 0) {
              if (max.abs() > avg.abs() * 10 ||
                  min.abs() > avg.abs() * 10) {
                anomalies.add(<String, dynamic>{
                  'table': tableName,
                  'column': colName,
                  'type': 'potential_outlier',
                  'severity': 'info',
                  'message':
                      'Potential outlier in $tableName.$colName: '
                      'range [$min, $max], avg ${avg.toStringAsFixed(2)}',
                });
              }
            }
          }
        }
      }

      // 4. Orphaned foreign keys
      final fkRows = _normalizeRows(
        await query('PRAGMA foreign_key_list("$tableName")'),
      );
      for (final fk in fkRows) {
        final fromCol = fk['from'] as String?;
        final toTable = fk['table'] as String?;
        final toCol = fk['to'] as String?;
        if (fromCol == null || toTable == null || toCol == null) continue;
        if (!tableNames.contains(toTable)) continue;

        final orphanCount = _extractCountFromRows(_normalizeRows(
          await query(
            'SELECT COUNT(*) AS c FROM "$tableName" t '
            'LEFT JOIN "$toTable" r ON t."$fromCol" = r."$toCol" '
            'WHERE t."$fromCol" IS NOT NULL AND r."$toCol" IS NULL',
          ),
        ));
        if (orphanCount > 0) {
          anomalies.add(<String, dynamic>{
            'table': tableName,
            'column': fromCol,
            'type': 'orphaned_fk',
            'severity': 'error',
            'count': orphanCount,
            'message':
                '$orphanCount orphaned FK(s): $tableName.$fromCol -> $toTable.$toCol',
          });
        }
      }

      // 5. Duplicate rows
      final totalCount = _extractCountFromRows(_normalizeRows(
        await query('SELECT COUNT(*) AS c FROM "$tableName"'),
      ));
      final distinctCount = _extractCountFromRows(_normalizeRows(
        await query(
          'SELECT COUNT(*) AS c FROM (SELECT DISTINCT * FROM "$tableName")',
        ),
      ));
      if (totalCount > distinctCount) {
        anomalies.add(<String, dynamic>{
          'table': tableName,
          'type': 'duplicate_rows',
          'severity': 'warning',
          'count': totalCount - distinctCount,
          'message':
              '${totalCount - distinctCount} duplicate row(s) in $tableName',
        });
      }
    }

    // Sort: errors first, then warnings, then info
    final severityOrder = <String, int>{
      'error': 0,
      'warning': 1,
      'info': 2,
    };
    anomalies.sort((a, b) => (severityOrder[a['severity']] ?? 3)
        .compareTo(severityOrder[b['severity']] ?? 3));

    _setJsonHeaders(res);
    res.write(jsonEncode(<String, dynamic>{
      'anomalies': anomalies,
      'tablesScanned': tableNames.length,
      'analyzedAt': DateTime.now().toUtc().toIso8601String(),
    }));
  } on Object catch (error, stack) {
    _logError(error, stack);
    await _sendErrorResponse(res, error);
  } finally {
    await res.close();
  }
}

static bool _isTextType(String type) =>
    RegExp(r'TEXT|VARCHAR|CHAR|CLOB|STRING', caseSensitive: false)
        .hasMatch(type);

static bool _isNumericType(String type) =>
    RegExp(r'INT|REAL|NUM|FLOAT|DOUBLE|DECIMAL', caseSensitive: false)
        .hasMatch(type);

static double? _toDouble(dynamic value) {
  if (value is double) return value;
  if (value is int) return value.toDouble();
  if (value is String) return double.tryParse(value);
  return null;
}
```

### Response Shape

```json
{
  "anomalies": [
    {
      "table": "orders",
      "column": "user_id",
      "type": "orphaned_fk",
      "severity": "error",
      "count": 3,
      "message": "3 orphaned FK(s): orders.user_id -> users.id"
    },
    {
      "table": "users",
      "column": "bio",
      "type": "empty_strings",
      "severity": "warning",
      "count": 15,
      "message": "15 empty string(s) in users.bio"
    }
  ],
  "tablesScanned": 5,
  "analyzedAt": "2026-03-07T12:00:00.000Z"
}
```

### Client-side UI

```javascript
document
  .getElementById("anomaly-analyze")
  .addEventListener("click", function () {
    const btn = this;
    const container = document.getElementById("anomaly-results");
    btn.disabled = true;
    btn.textContent = "Scanning...";

    fetch("/api/analytics/anomalies", authOpts())
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        const anomalies = data.anomalies || [];
        if (anomalies.length === 0) {
          container.innerHTML =
            '<p class="meta" style="color:#7cb342;">No anomalies detected across ' +
            data.tablesScanned +
            " tables. Data looks clean!</p>";
          container.style.display = "block";

          return;
        }

        const icons = { error: "!!", warning: "!", info: "i" };
        const colors = {
          error: "#e57373",
          warning: "#ffb74d",
          info: "#7cb342",
        };

        let html =
          '<p class="meta">' +
          anomalies.length +
          " finding(s) across " +
          data.tablesScanned +
          " tables:</p>";
        anomalies.forEach(function (a) {
          var color = colors[a.severity] || "var(--fg)";
          var icon = icons[a.severity] || "";
          html +=
            '<div style="padding:0.3rem 0.5rem;margin:0.2rem 0;border-left:3px solid ' +
            color +
            ';background:rgba(0,0,0,0.1);">';
          html +=
            '<span style="color:' +
            color +
            ';font-weight:bold;">[' +
            icon +
            "] " +
            esc(a.severity).toUpperCase() +
            "</span> ";
          html += esc(a.message);
          if (a.count) html += ' <span class="meta">(' + a.count + ")</span>";
          html += "</div>";
        });
        container.innerHTML = html;
        container.style.display = "block";
      })
      .catch(function (e) {
        container.innerHTML =
          '<p class="meta" style="color:#e57373;">Error: ' +
          esc(e.message) +
          "</p>";
        container.style.display = "block";
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = "Scan for anomalies";
      });
  });
```

## Effort Estimate

**L (Large)**

- Server: ~150 lines (5 diagnostic checks per table, each with SQL + logic)
- Client: ~60 lines JS, ~10 lines HTML
- Performance concern: O(tables x columns x checks) queries

## Dependencies & Risks

- **Performance**: Many queries per table per column. For a schema with 20 tables and 10 columns each, that's ~200+ queries. Mitigate with:
  - Optional `?tables=users,orders` parameter to limit scope
  - Timeout protection
  - Progress indication
- **`SELECT DISTINCT *`**: Can be slow on large tables. Consider `LIMIT 10000` sampling.
- **Orphaned FK LEFT JOIN**: Performance depends on indexes. May be slow without FK column indexes (which Feature #05 would suggest adding).
- **False positives**: NULLs and empty strings may be intentional. Severity is "info" or "warning", not "error", to reflect this.
- **No new dependencies**.

## Testing Strategy

1. **Server test**: Mock queries returning data with known anomalies (NULLs, empty strings, orphaned FKs, duplicates)
2. **Clean data**: All checks pass — verify empty anomalies array
3. **Orphaned FK**: Insert a row with FK pointing to non-existent parent — verify detection
4. **Duplicate detection**: Insert identical rows — verify count
5. **Outlier detection**: Insert one extreme value — verify it's flagged
6. **Performance**: Test with mock of 20 tables — verify response time is acceptable
7. **Manual**: Run against a real database with intentional data quality issues
