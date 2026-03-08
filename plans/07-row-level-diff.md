# Feature 07: Row-Level Diff (Time Travel Enhanced)

**Effort:** M (Medium) | **Priority:** 8

## Overview

Enhance the existing snapshot comparison (`/api/snapshot/compare`, line 1301-1367) to show cell-level colored diffs. Instead of just counts (added/removed/unchanged), show actual rows with per-cell highlighting: additions in green, deletions in red, modifications in yellow with old/new values side by side.

**User value:** See exactly what changed in your database during a debug session — which rows were added, which cells were modified, with full visual diff.

## Architecture

### Server-side (Dart)

Extend `GET /api/snapshot/compare` with an optional `?detail=rows` query parameter. When present, the response includes full row-level diff data (added rows, removed rows, changed rows with per-cell diffs).

### Client-side (JS)

Enhance the snapshot compare UI to render a diff table with color-coded cells. Modify existing compare button handler.

### VS Code Extension / Flutter

No changes.

### New Files

None.

## Implementation Details

### Modified `_handleSnapshotCompare` (extend existing at line 1302)

Add detailed diff mode when `?detail=rows` is present:

```dart
static const String _queryParamDetail = 'detail';
static const String _detailRows = 'rows';

// Inside the existing compare handler, after computing counts:
final bool detailed =
    request.uri.queryParameters[_queryParamDetail] == _detailRows;

if (detailed) {
  // Get PK columns for this table
  final pkInfoRows = _normalizeRows(
    await query('PRAGMA table_info("$table")'),
  );
  final pkColumns = pkInfoRows
      .where((r) => r['pk'] is int && (r['pk'] as int) > 0)
      .map((r) => r['name'] as String)
      .toList();

  if (pkColumns.isNotEmpty) {
    // Build maps keyed by PK composite value
    String pkKey(Map<String, dynamic> row) =>
        pkColumns.map((c) => '${row[c]}').join('|');

    final thenByPk = <String, Map<String, dynamic>>{};
    for (final r in snapshotRows) {
      thenByPk[pkKey(r)] = r;
    }
    final nowByPk = <String, Map<String, dynamic>>{};
    for (final r in currentRows) {
      nowByPk[pkKey(r)] = r;
    }

    // Added: in current but not in snapshot
    final addedRows = currentRows
        .where((r) => !thenByPk.containsKey(pkKey(r)))
        .toList();

    // Removed: in snapshot but not in current
    final removedRows = snapshotRows
        .where((r) => !nowByPk.containsKey(pkKey(r)))
        .toList();

    // Changed: in both, but values differ
    final changedRows = <Map<String, dynamic>>[];
    for (final entry in thenByPk.entries) {
      final nowRow = nowByPk[entry.key];
      if (nowRow == null) continue;
      final thenRow = entry.value;
      final changedCols = <String>[];
      for (final col in thenRow.keys) {
        if ('${thenRow[col]}' != '${nowRow[col]}') {
          changedCols.add(col);
        }
      }

      if (changedCols.isNotEmpty) {
        changedRows.add(<String, dynamic>{
          'pk': entry.key,
          'then': thenRow,
          'now': nowRow,
          'changedColumns': changedCols,
        });
      }
    }

    tableDiff['addedRows'] = addedRows;
    tableDiff['removedRows'] = removedRows;
    tableDiff['changedRows'] = changedRows;
    tableDiff['hasPk'] = true;
  } else {
    tableDiff['hasPk'] = false;
    // Without PK, can only show new/missing rows by signature
    tableDiff['addedRows'] = <Map<String, dynamic>>[];
    tableDiff['removedRows'] = <Map<String, dynamic>>[];
    tableDiff['changedRows'] = <Map<String, dynamic>>[];
  }
}
```

### Enhanced Response Shape (with `?detail=rows`)

```json
{
  "tables": [
    {
      "table": "users",
      "countThen": 5,
      "countNow": 6,
      "added": 1,
      "removed": 0,
      "unchanged": 4,
      "hasPk": true,
      "addedRows": [{ "id": 6, "name": "New User", "email": "new@test.com" }],
      "removedRows": [],
      "changedRows": [
        {
          "pk": "3",
          "then": { "id": 3, "name": "Old Name", "email": "a@b.com" },
          "now": { "id": 3, "name": "New Name", "email": "a@b.com" },
          "changedColumns": ["name"]
        }
      ]
    }
  ]
}
```

### Client-side Diff Renderer

Modify the existing compare button handler (~line 1921) to use `?detail=rows`:

```javascript
// Change existing fetch URL:
fetch("/api/snapshot/compare?detail=rows", authOpts());

// New rendering function:
function renderRowDiff(container, tables) {
  let html = "";
  tables.forEach(function (t) {
    html += '<h4 style="margin:0.5rem 0 0.25rem;">' + esc(t.table) + "</h4>";
    html +=
      '<p class="meta">Then: ' +
      t.countThen +
      " rows | Now: " +
      t.countNow +
      " rows</p>";

    if (!t.hasPk) {
      html +=
        '<p class="meta" style="color:var(--muted);">No primary key — showing counts only.</p>';
      html +=
        '<p class="meta">Added: ' +
        t.added +
        " | Removed: " +
        t.removed +
        " | Unchanged: " +
        t.unchanged +
        "</p>";

      return;
    }

    // Added rows
    if (t.addedRows && t.addedRows.length > 0) {
      html +=
        '<p class="meta" style="color:#7cb342;">+ ' +
        t.addedRows.length +
        " added:</p>";
      html += renderDiffRows(t.addedRows, "added");
    }

    // Removed rows
    if (t.removedRows && t.removedRows.length > 0) {
      html +=
        '<p class="meta" style="color:#e57373;">- ' +
        t.removedRows.length +
        " removed:</p>";
      html += renderDiffRows(t.removedRows, "removed");
    }

    // Changed rows
    if (t.changedRows && t.changedRows.length > 0) {
      html +=
        '<p class="meta" style="color:#ffb74d;">~ ' +
        t.changedRows.length +
        " changed:</p>";
      t.changedRows.forEach(function (cr) {
        const keys = Object.keys(cr.now);
        const changed = new Set(cr.changedColumns || []);
        html +=
          '<table style="border-collapse:collapse;width:100%;font-size:11px;margin-bottom:0.4rem;">';
        html +=
          "<tr>" +
          keys
            .map(function (k) {
              return (
                '<th style="border:1px solid var(--border);padding:2px 4px;' +
                (changed.has(k) ? "background:rgba(255,183,77,0.2);" : "") +
                '">' +
                esc(k) +
                "</th>"
              );
            })
            .join("") +
          "</tr>";

        // "Then" row (old values)
        html +=
          "<tr>" +
          keys
            .map(function (k) {
              const isChanged = changed.has(k);
              return (
                '<td style="border:1px solid var(--border);padding:2px 4px;' +
                (isChanged
                  ? "background:rgba(229,115,115,0.2);text-decoration:line-through;"
                  : "") +
                '">' +
                esc(String(cr.then[k] != null ? cr.then[k] : "")) +
                "</td>"
              );
            })
            .join("") +
          "</tr>";

        // "Now" row (new values)
        html +=
          "<tr>" +
          keys
            .map(function (k) {
              const isChanged = changed.has(k);
              return (
                '<td style="border:1px solid var(--border);padding:2px 4px;' +
                (isChanged
                  ? "background:rgba(124,179,66,0.2);font-weight:bold;"
                  : "") +
                '">' +
                esc(String(cr.now[k] != null ? cr.now[k] : "")) +
                "</td>"
              );
            })
            .join("") +
          "</tr>";

        html += "</table>";
      });
    }

    if (
      (!t.addedRows || t.addedRows.length === 0) &&
      (!t.removedRows || t.removedRows.length === 0) &&
      (!t.changedRows || t.changedRows.length === 0)
    ) {
      html += '<p class="meta" style="color:#7cb342;">No changes detected.</p>';
    }
  });
  container.innerHTML = html;
}

function renderDiffRows(rows, type) {
  if (rows.length === 0) return "";
  const keys = Object.keys(rows[0]);
  const bgColor =
    type === "added" ? "rgba(124,179,66,0.15)" : "rgba(229,115,115,0.15)";
  let html =
    '<table style="border-collapse:collapse;width:100%;font-size:11px;margin-bottom:0.3rem;">';
  html +=
    "<tr>" +
    keys
      .map(function (k) {
        return (
          '<th style="border:1px solid var(--border);padding:2px 4px;">' +
          esc(k) +
          "</th>"
        );
      })
      .join("") +
    "</tr>";
  rows.forEach(function (r) {
    html +=
      '<tr style="background:' +
      bgColor +
      ';">' +
      keys
        .map(function (k) {
          return (
            '<td style="border:1px solid var(--border);padding:2px 4px;">' +
            esc(String(r[k] != null ? r[k] : "")) +
            "</td>"
          );
        })
        .join("") +
      "</tr>";
  });
  html += "</table>";
  return html;
}
```

## Effort Estimate

**M (Medium)**

- Server: ~60 lines extending existing handler
- Client: ~80 lines JS for diff rendering
- Builds on existing snapshot infrastructure
- PK-based matching is the key algorithm

## Dependencies & Risks

- **Tables without primary keys**: Cannot detect changed rows, only added/removed by signature. Clearly indicated in UI with "No primary key" message.
- **Composite primary keys**: Handled by joining PK column values with `|` separator. Edge case: PK value containing `|` character. Mitigate by using a less common separator or JSON-encoding.
- **Large tables with many changes**: Response could be large. Add `?maxRows=100` parameter to limit detailed diff output per table.
- **Memory**: Full row data for both snapshot and current is already stored by the existing snapshot feature.
- **Backward compatible**: Default response (without `?detail=rows`) remains unchanged.

## Testing Strategy

1. **Server test**: Take snapshot, modify mock query to return different data, compare with `?detail=rows` — verify `changedColumns` is correct
2. **Added rows**: Add rows after snapshot, verify they appear in `addedRows`
3. **Removed rows**: Remove rows after snapshot, verify they appear in `removedRows`
4. **Changed rows**: Modify a single column value, verify `changedColumns` contains only that column
5. **Composite PK**: Table with multi-column PK — verify matching works
6. **No PK**: Table without PK — verify `hasPk: false` and empty row arrays
7. **No changes**: Identical data — verify "No changes detected" message
8. **Visual**: Verify color coding in dark and light themes
