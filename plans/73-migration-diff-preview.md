# Feature 12: Migration Diff Preview

**Effort:** M (Medium) | **Priority:** 11

## Overview

Compare two database schemas (main DB vs. compare DB) and auto-generate the ALTER TABLE SQL statements needed to migrate from one to the other. Outputs ready-to-use DDL statements with warnings for SQLite-specific limitations. Helps developers write Drift migrations by showing exactly what changed.

**User value:** "I changed my Drift schema — what SQL do I need in my migration?" Auto-generated, copy-paste ready.

## Architecture

### Server-side (Dart)

Add `GET /api/migration/preview` endpoint. Compares schema from main DB vs. compare DB (requires `queryCompare` to be configured, same dependency as existing `/api/compare/report`). Generates CREATE TABLE, DROP TABLE, ALTER TABLE ADD COLUMN, and advisory comments for unsupported operations.

### Client-side (JS)

Add a "Migration Preview" button in the database compare section. Display generated SQL in a copyable code block.

### VS Code Extension / Flutter

No changes.

### New Files

None.

## Implementation Details

### Route Constants

```dart
static const String _pathApiMigrationPreview = '/api/migration/preview';
static const String _pathApiMigrationPreviewAlt = 'api/migration/preview';
```

### Server Handler

```dart
Future<void> _handleMigrationPreview(
  HttpResponse response,
  DriftDebugQuery query,
) async {
  final res = response;
  final queryB = _queryCompare;

  if (queryB == null) {
    res.statusCode = HttpStatus.notImplemented;
    _setJsonHeaders(res);
    res.write(jsonEncode(<String, String>{
      _jsonKeyError:
          'Migration preview requires queryCompare. '
          'Pass queryCompare to DriftDebugServer.start().',
    }));
    await res.close();

   return;
  }

  try {
    // "A" = current (source), "B" = compare (target/desired state)
    final tablesA = await _getTableNames(query);
    final tablesB = await _getTableNames(queryB);
    final migrations = <String>[];

    // --- New tables (in B but not in A) ---
    for (final table in tablesB) {
      if (tablesA.contains(table)) continue;
      final schemaRows = _normalizeRows(
        await queryB(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='$table'",
        ),
      );
      final createStmt = schemaRows.isNotEmpty
          ? schemaRows.first['sql'] as String?
          : null;
      if (createStmt != null) {
        migrations.add('-- NEW TABLE: $table');
        migrations.add('$createStmt;');
        migrations.add('');
      }
    }

    // --- Dropped tables (in A but not in B) ---
    for (final table in tablesA) {
      if (tablesB.contains(table)) continue;
      migrations.add('-- DROPPED TABLE: $table');
      migrations.add('DROP TABLE IF EXISTS "$table";');
      migrations.add('');
    }

    // --- Modified tables (in both) ---
    for (final table in tablesA) {
      if (!tablesB.contains(table)) continue;

      final colsA = _normalizeRows(
        await query('PRAGMA table_info("$table")'),
      );
      final colsB = _normalizeRows(
        await queryB('PRAGMA table_info("$table")'),
      );

      final colMapA = <String, Map<String, dynamic>>{};
      for (final c in colsA) {
        colMapA[c['name'] as String? ?? ''] = c;
      }
      final colMapB = <String, Map<String, dynamic>>{};
      for (final c in colsB) {
        colMapB[c['name'] as String? ?? ''] = c;
      }

      final tableChanges = <String>[];

      // New columns (in B, not in A)
      for (final colName in colMapB.keys) {
        if (colMapA.containsKey(colName)) continue;
        final col = colMapB[colName]!;
        final type = col['type'] ?? 'TEXT';
        final notNull = col['notnull'] == 1;
        final dfltValue = col['dflt_value'];

        // SQLite requires DEFAULT for NOT NULL columns in ALTER TABLE ADD
        final dflt = dfltValue != null
            ? " DEFAULT $dfltValue"
            : (notNull ? " DEFAULT ''" : '');
        final nn = notNull ? ' NOT NULL' : '';

        tableChanges.add(
          'ALTER TABLE "$table" ADD COLUMN "$colName" $type$nn$dflt;',
        );
      }

      // Removed columns (in A, not in B)
      for (final colName in colMapA.keys) {
        if (colMapB.containsKey(colName)) continue;
        tableChanges.add(
          '-- WARNING: Column "$colName" removed from "$table".',
        );
        tableChanges.add(
          '-- SQLite < 3.35.0: Use table recreation '
          '(CREATE new, INSERT...SELECT, DROP old, ALTER...RENAME).',
        );
        tableChanges.add(
          '-- SQLite >= 3.35.0:',
        );
        tableChanges.add(
          'ALTER TABLE "$table" DROP COLUMN "$colName";',
        );
      }

      // Changed column types (in both, but different type/nullability)
      for (final colName in colMapA.keys) {
        if (!colMapB.containsKey(colName)) continue;
        final a = colMapA[colName]!;
        final b = colMapB[colName]!;
        final typeA = a['type']?.toString() ?? '';
        final typeB = b['type']?.toString() ?? '';
        final nnA = a['notnull'] == 1;
        final nnB = b['notnull'] == 1;

        if (typeA != typeB || nnA != nnB) {
          tableChanges.add(
            '-- WARNING: Column "$colName" in "$table" changed:',
          );
          if (typeA != typeB) {
            tableChanges.add(
              '--   Type: $typeA -> $typeB',
            );
          }
          if (nnA != nnB) {
            tableChanges.add(
              '--   Nullable: ${nnA ? 'NOT NULL' : 'nullable'} '
              '-> ${nnB ? 'NOT NULL' : 'nullable'}',
            );
          }
          tableChanges.add(
            '-- SQLite does not support ALTER COLUMN. '
            'Use table recreation pattern.',
          );
        }
      }

      // Index changes
      final idxA = _normalizeRows(
        await query('PRAGMA index_list("$table")'),
      );
      final idxB = _normalizeRows(
        await queryB('PRAGMA index_list("$table")'),
      );
      final idxNamesA = idxA
          .map((r) => r['name']?.toString() ?? '')
          .where((n) => n.isNotEmpty && !n.startsWith('sqlite_'))
          .toSet();
      final idxNamesB = idxB
          .map((r) => r['name']?.toString() ?? '')
          .where((n) => n.isNotEmpty && !n.startsWith('sqlite_'))
          .toSet();

      // New indexes
      for (final idxName in idxNamesB) {
        if (idxNamesA.contains(idxName)) continue;
        final idxSqlRows = _normalizeRows(
          await queryB(
            "SELECT sql FROM sqlite_master WHERE type='index' AND name='$idxName'",
          ),
        );
        final idxSql = idxSqlRows.isNotEmpty
            ? idxSqlRows.first['sql'] as String?
            : null;
        if (idxSql != null) {
          tableChanges.add('$idxSql;');
        }
      }

      // Dropped indexes
      for (final idxName in idxNamesA) {
        if (idxNamesB.contains(idxName)) continue;
        tableChanges.add('DROP INDEX IF EXISTS "$idxName";');
      }

      if (tableChanges.isNotEmpty) {
        migrations.add('-- MODIFIED TABLE: $table');
        migrations.addAll(tableChanges);
        migrations.add('');
      }
    }

    final migrationSql = migrations.join('\n');

    _setJsonHeaders(res);
    res.write(jsonEncode(<String, dynamic>{
      'migrationSql': migrationSql,
      'changeCount': migrations
          .where((l) => !l.startsWith('--') && l.trim().isNotEmpty)
          .length,
      'hasWarnings': migrations.any((l) => l.contains('WARNING')),
      'generatedAt': DateTime.now().toUtc().toIso8601String(),
    }));
  } on Object catch (error, stack) {
    _logError(error, stack);
    await _sendErrorResponse(res, error);
  } finally {
    await res.close();
  }
}
```

### Client-side UI

Add a button in the database compare section (~line 1634):

```html
<button type="button" id="migration-preview">Migration Preview</button>
```

JS:

```javascript
document
  .getElementById("migration-preview")
  .addEventListener("click", function () {
    const btn = this;
    btn.disabled = true;
    btn.textContent = "Generating...";

    fetch("/api/migration/preview", authOpts())
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (data.error) {
          alert("Error: " + data.error);

          return;
        }
        const sql = data.migrationSql || "-- No changes detected.";
        let html =
          '<p class="meta">' + data.changeCount + " statement(s) generated";
        if (data.hasWarnings) html += " (includes warnings)";
        html += "</p>";
        html +=
          '<pre style="font-size:11px;max-height:30vh;overflow:auto;background:var(--bg-pre);padding:0.5rem;border-radius:4px;">' +
          esc(sql) +
          "</pre>";
        html +=
          '<button type="button" onclick="navigator.clipboard.writeText(' +
          JSON.stringify(sql).replace(/"/g, "&quot;") +
          ");this.textContent='Copied!';\">Copy SQL</button>";

        // Show in compare results area
        const container =
          document.getElementById("compare-result") ||
          document.getElementById("sql-result");
        container.innerHTML = html;
        container.style.display = "block";
      })
      .catch(function (e) {
        alert("Error: " + e.message);
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = "Migration Preview";
      });
  });
```

## Effort Estimate

**M (Medium)**

- Server: ~120 lines (schema comparison + DDL generation)
- Client: ~30 lines JS, ~2 lines HTML
- Reuses existing `_queryCompare` infrastructure

## Dependencies & Risks

- **SQLite ALTER TABLE limitations**: Only `ADD COLUMN` is fully supported. `DROP COLUMN` requires SQLite 3.35.0+. `ALTER COLUMN` is not supported at all. Generated SQL includes comments explaining workarounds.
- **Requires `queryCompare`**: Same dependency as existing database diff feature. Returns 501 if not configured.
- **Index comparison**: Auto-generated indexes (`sqlite_autoindex_*`) are excluded to avoid noise.
- **Drift migration pattern**: The generated SQL serves as a guide. Drift's migration system uses Dart code, not raw SQL. Developers would translate the SQL into their `MigrationStrategy`.

## Testing Strategy

1. **New table**: Compare DB has a table not in main — verify `CREATE TABLE` generated
2. **Dropped table**: Main DB has a table not in compare — verify `DROP TABLE` generated
3. **New column**: Compare DB has extra column — verify `ALTER TABLE ADD COLUMN` generated
4. **Removed column**: Main DB has column not in compare — verify warning comment
5. **Type change**: Column type differs — verify warning with old/new types
6. **Index changes**: New/dropped indexes — verify CREATE/DROP INDEX
7. **No changes**: Identical schemas — verify "No changes detected"
8. **NOT NULL without default**: Verify DEFAULT is added for NOT NULL columns in ADD COLUMN
