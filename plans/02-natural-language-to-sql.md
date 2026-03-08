# Feature 02: Natural Language to SQL

**Effort:** M (Medium) | **Priority:** 10

## Overview

Let users type plain English questions like "show me users created in the last 7 days" and have them converted to SQL queries. The conversion uses schema metadata (table/column names and types) plus pattern matching — no external AI API required. This dramatically lowers the barrier for developers unfamiliar with SQL to explore their debug data.

**User value:** Non-SQL developers can query data in plain English. Even SQL-savvy developers save time on common queries.

## Architecture

### Server-side (Dart)
Add one new endpoint `GET /api/schema/metadata` that returns structured metadata (table names, column names, types, primary keys, row counts) optimized for the NL engine. The existing `/api/schema/diagram` (line 1070) returns similar data but lacks types and counts in one call.

### Client-side (JS)
Add a new NL input field in the SQL runner section. Add a `nlToSql()` function (~100 lines) that takes schema metadata and English text, produces SQL using pattern matching and heuristics.

### VS Code Extension / Flutter
No changes.

### New Files
None (all inline in server's `_indexHtml`).

## Implementation Details

### New API Endpoint

**`GET /api/schema/metadata`**

Response:
```json
{
  "tables": [
    {
      "name": "users",
      "columns": [
        { "name": "id", "type": "INTEGER", "pk": true },
        { "name": "email", "type": "TEXT", "pk": false },
        { "name": "created_at", "type": "TEXT", "pk": false }
      ],
      "rowCount": 42
    }
  ]
}
```

### Server-side Handler (Dart)

Add route constants (near line 150):
```dart
static const String _pathApiSchemaMetadata = '/api/schema/metadata';
static const String _pathApiSchemaMetadataAlt = 'api/schema/metadata';
```

Handler (follows pattern of `_sendSchemaDiagram` at line 1126):
```dart
Future<void> _sendSchemaMetadata(
  HttpResponse response,
  DriftDebugQuery query,
) async {
  final res = response;
  try {
    final tableNames = await _getTableNames(query);
    final tables = <Map<String, dynamic>>[];
    for (final tableName in tableNames) {
      final infoRows = _normalizeRows(
        await query('PRAGMA table_info("$tableName")'),
      );
      final columns = infoRows
          .map((r) => <String, dynamic>{
                _jsonKeyName: r['name'] ?? '',
                'type': r['type'] ?? '',
                'pk': (r['pk'] is int) ? r['pk'] != 0 : false,
              })
          .toList();
      final countRows = _normalizeRows(
        await query('SELECT COUNT(*) AS c FROM "$tableName"'),
      );
      final count = _extractCountFromRows(countRows);
      tables.add(<String, dynamic>{
        _jsonKeyName: tableName,
        _jsonKeyColumns: columns,
        'rowCount': count,
      });
    }
    _setJsonHeaders(res);
    res.write(jsonEncode(<String, dynamic>{_jsonKeyTables: tables}));
  } on Object catch (error, stack) {
    _logError(error, stack);
    await _sendErrorResponse(res, error);
  } finally {
    await res.close();
  }
}
```

### Client-side NL Engine (JS)

```javascript
let schemaMeta = null;

async function loadSchemaMeta() {
  if (schemaMeta) return schemaMeta;
  const r = await fetch('/api/schema/metadata', authOpts());
  schemaMeta = await r.json();
  return schemaMeta;
}

function nlToSql(question, meta) {
  const q = question.toLowerCase().trim();
  const tables = meta.tables || [];

  // 1. Identify target table by fuzzy matching
  let target = null;
  for (const t of tables) {
    const name = t.name.toLowerCase();
    const singular = name.endsWith('s') ? name.slice(0, -1) : name;
    if (q.includes(name) || q.includes(singular)) {
      target = t;
      break;
    }
  }
  if (!target && tables.length === 1) target = tables[0];
  if (!target) return { sql: null, error: 'Could not identify a table from your question.' };

  // 2. Detect mentioned columns
  const mentioned = target.columns.filter(
    (c) =>
      q.includes(c.name.toLowerCase().replace(/_/g, ' ')) ||
      q.includes(c.name.toLowerCase()),
  );
  const selectCols =
    mentioned.length > 0
      ? mentioned.map((c) => '"' + c.name + '"').join(', ')
      : '*';

  // 3. Pattern matching for query type
  let sql = '';
  const tn = '"' + target.name + '"';

  if (/how many|count|total number/i.test(q)) {
    sql = 'SELECT COUNT(*) FROM ' + tn;
  } else if (/average|avg|mean/i.test(q)) {
    const numCol =
      mentioned.find((c) => /int|real|num|float/i.test(c.type)) ||
      target.columns.find((c) => /int|real|num|float/i.test(c.type));
    sql = numCol
      ? 'SELECT AVG("' + numCol.name + '") FROM ' + tn
      : 'SELECT * FROM ' + tn + ' LIMIT 50';
  } else if (/sum|total\b/i.test(q) && !/total number/i.test(q)) {
    const numCol =
      mentioned.find((c) => /int|real|num|float/i.test(c.type)) ||
      target.columns.find((c) => /int|real|num|float/i.test(c.type));
    sql = numCol
      ? 'SELECT SUM("' + numCol.name + '") FROM ' + tn
      : 'SELECT * FROM ' + tn + ' LIMIT 50';
  } else if (/max|maximum|highest|largest|biggest/i.test(q)) {
    const numCol =
      mentioned.find((c) => /int|real|num|float/i.test(c.type)) ||
      target.columns.find((c) => /int|real|num|float/i.test(c.type));
    sql = numCol
      ? 'SELECT MAX("' + numCol.name + '") FROM ' + tn
      : 'SELECT * FROM ' + tn + ' ORDER BY 1 DESC LIMIT 1';
  } else if (/min|minimum|lowest|smallest/i.test(q)) {
    const numCol =
      mentioned.find((c) => /int|real|num|float/i.test(c.type)) ||
      target.columns.find((c) => /int|real|num|float/i.test(c.type));
    sql = numCol
      ? 'SELECT MIN("' + numCol.name + '") FROM ' + tn
      : 'SELECT * FROM ' + tn + ' ORDER BY 1 ASC LIMIT 1';
  } else if (/distinct|unique/i.test(q)) {
    const col = mentioned[0] || target.columns[1] || target.columns[0];
    sql = 'SELECT DISTINCT "' + col.name + '" FROM ' + tn;
  } else if (/latest|newest|most recent|last (\d+)/i.test(q)) {
    const dateCol = target.columns.find((c) =>
      /date|time|created|updated/i.test(c.name),
    );
    const match = q.match(/last (\d+)/i);
    const limit = match ? parseInt(match[1]) : 10;
    sql =
      'SELECT ' +
      selectCols +
      ' FROM ' +
      tn +
      (dateCol ? ' ORDER BY "' + dateCol.name + '" DESC' : '') +
      ' LIMIT ' +
      limit;
  } else if (/oldest|earliest|first (\d+)/i.test(q)) {
    const dateCol = target.columns.find((c) =>
      /date|time|created|updated/i.test(c.name),
    );
    const match = q.match(/first (\d+)/i);
    const limit = match ? parseInt(match[1]) : 10;
    sql =
      'SELECT ' +
      selectCols +
      ' FROM ' +
      tn +
      (dateCol ? ' ORDER BY "' + dateCol.name + '" ASC' : '') +
      ' LIMIT ' +
      limit;
  } else if (/group by|per\s+\w+|by\s+\w+/i.test(q)) {
    const groupCol = mentioned[0] || target.columns[1] || target.columns[0];
    sql =
      'SELECT "' +
      groupCol.name +
      '", COUNT(*) AS count FROM ' +
      tn +
      ' GROUP BY "' +
      groupCol.name +
      '" ORDER BY count DESC';
  } else if (/where|with|having|equals?|is\s/i.test(q)) {
    // Try to extract "where column = value" pattern
    sql = 'SELECT ' + selectCols + ' FROM ' + tn + ' LIMIT 50';
  } else {
    sql = 'SELECT ' + selectCols + ' FROM ' + tn + ' LIMIT 50';
  }

  return { sql: sql, table: target.name };
}
```

### UI Additions (HTML in `_indexHtml`)

Add inside `sql-runner-collapsible` div, before the SQL textarea:
```html
<div class="sql-toolbar" style="margin-bottom:0.35rem;">
  <label for="nl-input">Ask in English:</label>
  <input type="text" id="nl-input"
    placeholder="e.g. how many users were created today?"
    style="flex:1;min-width:20rem;" />
  <button type="button" id="nl-convert">Convert to SQL</button>
</div>
```

JS handler:
```javascript
document.getElementById('nl-convert').addEventListener('click', async function () {
  const question = document.getElementById('nl-input').value.trim();
  if (!question) return;
  const btn = this;
  btn.disabled = true;
  btn.textContent = 'Converting...';
  try {
    const meta = await loadSchemaMeta();
    const result = nlToSql(question, meta);
    if (result.sql) {
      document.getElementById('sql-input').value = result.sql;
    } else {
      document.getElementById('sql-error').textContent =
        result.error || 'Could not convert to SQL.';
      document.getElementById('sql-error').style.display = 'block';
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Convert to SQL';
  }
});

// Enter key triggers conversion
document.getElementById('nl-input').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') document.getElementById('nl-convert').click();
});
```

## Effort Estimate

**M (Medium)**
- Server: ~40 lines (one new endpoint, reuses existing helpers)
- Client: ~120 lines JS (NL engine + UI integration)
- HTML: ~10 lines

## Dependencies & Risks

- **Pattern-based NL is limited**: Complex queries (multi-table joins, subqueries) won't parse. Mitigated by clear UX: the converted SQL is editable, and users see it before running.
- **Table name matching**: Fails for non-English names or names that don't appear in the question. Mitigate by trying all tables, scoring by string similarity.
- **Column name matching**: Relies on column names being descriptive. Works well with Drift conventions (`created_at`, `user_id`).
- **No external dependencies**: Zero API keys, zero new packages.
- **Depends on #10 metadata endpoint**: Can share the same endpoint or create independently.

## Testing Strategy

1. **Server test**: `GET /api/schema/metadata` returns tables with columns, types, and counts
2. **NL pattern tests** (manual or console-based):
   - "how many users" → `SELECT COUNT(*) FROM "users"`
   - "latest 5 orders" → `SELECT * FROM "orders" ORDER BY "created_at" DESC LIMIT 5`
   - "average price of items" → `SELECT AVG("price") FROM "items"`
   - "distinct categories" → `SELECT DISTINCT "category" FROM ...`
   - "show me users" → `SELECT * FROM "users" LIMIT 50`
3. **Edge cases**: Single-table DB (auto-detect), no date columns, question doesn't mention any table
4. **UX test**: Enter key triggers conversion, converted SQL appears in textarea for editing
