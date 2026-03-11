# Feature 10: Database Size Analytics

**Effort:** S (Small) | **Priority:** 3

## Overview

Show database-level and per-table storage metrics: total size, page count, page size, free space, journal mode, and per-table row counts with column/index counts. Helps developers understand database bloat and identify storage-heavy tables — important for mobile apps where database size affects app size and performance.

**User value:** "My app's DB is 12 MB — which table is eating all that space?" Answer in one click.

## Architecture

### Server-side (Dart)
Add `GET /api/analytics/size` endpoint that runs SQLite PRAGMA queries for database and table metrics.

### Client-side (JS)
Add a collapsible "Database Size" section with an Analyze button, summary stats, and per-table breakdown.

### VS Code Extension / Flutter
No changes.

### New Files
None.

## Implementation Details

### Route Constants

```dart
static const String _pathApiAnalyticsSize = '/api/analytics/size';
static const String _pathApiAnalyticsSizeAlt = 'api/analytics/size';
```

### Server Handler

```dart
Future<void> _handleSizeAnalytics(
  HttpResponse response,
  DriftDebugQuery query,
) async {
  final res = response;
  try {
    // Database-level stats via PRAGMAs
    int pragmaInt(List<Map<String, dynamic>> rows) {
      if (rows.isEmpty) return 0;
      final v = rows.first.values.first;
      return v is int ? v : int.tryParse('$v') ?? 0;
    }

    final pageSize = pragmaInt(
      _normalizeRows(await query('PRAGMA page_size')),
    );
    final pageCount = pragmaInt(
      _normalizeRows(await query('PRAGMA page_count')),
    );
    final freelistCount = pragmaInt(
      _normalizeRows(await query('PRAGMA freelist_count')),
    );

    final journalModeRows = _normalizeRows(
      await query('PRAGMA journal_mode'),
    );
    final journalMode = journalModeRows.isNotEmpty
        ? (journalModeRows.first.values.first?.toString() ?? 'unknown')
        : 'unknown';

    final totalSizeBytes = pageSize * pageCount;
    final freeSpaceBytes = pageSize * freelistCount;

    // Per-table stats
    final tableNames = await _getTableNames(query);
    final tableStats = <Map<String, dynamic>>[];

    for (final tableName in tableNames) {
      final countRows = _normalizeRows(
        await query('SELECT COUNT(*) AS c FROM "$tableName"'),
      );
      final rowCount = _extractCountFromRows(countRows);

      final colInfoRows = _normalizeRows(
        await query('PRAGMA table_info("$tableName")'),
      );

      final indexRows = _normalizeRows(
        await query('PRAGMA index_list("$tableName")'),
      );
      final indexNames = indexRows
          .map((r) => r['name']?.toString() ?? '')
          .where((n) => n.isNotEmpty)
          .toList();

      tableStats.add(<String, dynamic>{
        'table': tableName,
        'rowCount': rowCount,
        'columnCount': colInfoRows.length,
        'indexCount': indexNames.length,
        'indexes': indexNames,
      });
    }

    // Sort tables by row count descending
    tableStats.sort((a, b) =>
        (b['rowCount'] as int).compareTo(a['rowCount'] as int));

    _setJsonHeaders(res);
    res.write(jsonEncode(<String, dynamic>{
      'pageSize': pageSize,
      'pageCount': pageCount,
      'freelistCount': freelistCount,
      'totalSizeBytes': totalSizeBytes,
      'freeSpaceBytes': freeSpaceBytes,
      'usedSizeBytes': totalSizeBytes - freeSpaceBytes,
      'journalMode': journalMode,
      'tableCount': tableNames.length,
      'tables': tableStats,
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
  "pageSize": 4096,
  "pageCount": 256,
  "freelistCount": 10,
  "totalSizeBytes": 1048576,
  "freeSpaceBytes": 40960,
  "usedSizeBytes": 1007616,
  "journalMode": "wal",
  "tableCount": 5,
  "tables": [
    {
      "table": "events",
      "rowCount": 15000,
      "columnCount": 8,
      "indexCount": 2,
      "indexes": ["idx_events_user_id", "sqlite_autoindex_events_1"]
    },
    {
      "table": "users",
      "rowCount": 42,
      "columnCount": 5,
      "indexCount": 1,
      "indexes": ["sqlite_autoindex_users_1"]
    }
  ]
}
```

### Client-side UI

HTML:
```html
<div class="collapsible-header" id="size-toggle">Database size analytics</div>
<div id="size-collapsible" class="collapsible-body collapsed">
  <button type="button" id="size-analyze">Analyze</button>
  <div id="size-results" style="display:none;"></div>
</div>
```

JS:
```javascript
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(2) + ' MB';
}

document.getElementById('size-analyze').addEventListener('click', function () {
  const btn = this;
  const container = document.getElementById('size-results');
  btn.disabled = true;
  btn.textContent = 'Analyzing...';

  fetch('/api/analytics/size', authOpts())
    .then(function (r) { return r.json(); })
    .then(function (data) {
      let html = '<div style="margin:0.5rem 0;">';

      // Summary cards
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
      html += '<div style="font-size:1.2rem;font-weight:bold;">' + data.pageCount + ' x ' + data.pageSize + '</div></div>';
      html += '</div>';

      // Per-table breakdown
      html += '<table style="border-collapse:collapse;width:100%;font-size:12px;">';
      html += '<tr><th style="border:1px solid var(--border);padding:4px;">Table</th>';
      html += '<th style="border:1px solid var(--border);padding:4px;">Rows</th>';
      html += '<th style="border:1px solid var(--border);padding:4px;">Columns</th>';
      html += '<th style="border:1px solid var(--border);padding:4px;">Indexes</th></tr>';

      var maxRows = Math.max(...(data.tables || []).map(function (t) { return t.rowCount; }), 1);
      (data.tables || []).forEach(function (t) {
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
    .catch(function (e) {
      container.innerHTML = '<p class="meta" style="color:#e57373;">Error: ' + esc(e.message) + '</p>';
      container.style.display = 'block';
    })
    .finally(function () {
      btn.disabled = false;
      btn.textContent = 'Analyze';
    });
});
```

## Effort Estimate

**S (Small)**
- Server: ~50 lines (PRAGMA queries + aggregation)
- Client: ~60 lines JS, ~5 lines HTML
- Uses well-documented, stable SQLite PRAGMAs

## Dependencies & Risks

- **PRAGMA support**: `page_size`, `page_count`, `freelist_count`, `journal_mode` are standard SQLite PRAGMAs. Should work through Drift's `customSelect`.
- **Per-table size**: SQLite doesn't expose per-table page counts natively. Row count is the best proxy. A future enhancement could use `dbstat` virtual table if available.
- **Empty database**: All values will be 0 — renders cleanly.
- **No new dependencies**.

## Testing Strategy

1. **Server test**: Mock PRAGMA queries to return known values, verify JSON response structure
2. **Table sorting**: Verify tables sorted by row count descending
3. **Empty database**: 0 pages, 0 rows — verify clean rendering
4. **Manual**: Run against example app database, verify total size matches file system size
5. **Format**: Verify `formatBytes` correctly shows B, KB, MB for different sizes
