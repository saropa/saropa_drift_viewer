// Analytics handler extracted from _DriftDebugServerImpl.
// Handles index suggestions, size analytics, and anomaly detection.

import 'dart:convert';
import 'dart:io';

import 'server_constants.dart';
import 'server_context.dart';

/// Handles analytics-related API endpoints.
final class AnalyticsHandler {
  /// Creates an [AnalyticsHandler] with the given [ServerContext].
  AnalyticsHandler(this._ctx);

  final ServerContext _ctx;

  /// Analyzes table schemas for missing indexes.
  Future<void> handleIndexSuggestions(
    HttpResponse response,
    DriftDebugQuery query,
  ) async {
    final res = response;

    try {
      final tableNames = await ServerContext.getTableNames(query);
      final suggestions = <Map<String, dynamic>>[];

      for (final tableName in tableNames) {
        final existingIndexRows = ServerContext.normalizeRows(
          await query('PRAGMA index_list("$tableName")'),
        );
        final indexedColumns = <String>{};

        for (final idx in existingIndexRows) {
          final idxName = idx['name'] as String?;
          if (idxName != null) {
            final idxInfoRows = ServerContext.normalizeRows(
              await query('PRAGMA index_info("$idxName")'),
            );

            for (final col in idxInfoRows) {
              final colName = col['name'] as String?;
              if (colName != null) indexedColumns.add(colName);
            }
          }
        }

        // Check foreign keys
        final fkRows = ServerContext.normalizeRows(
          await query('PRAGMA foreign_key_list("$tableName")'),
        );

        for (final fk in fkRows) {
          final fromCol = fk['from'] as String?;

          if (fromCol != null && !indexedColumns.contains(fromCol)) {
            suggestions.add(<String, dynamic>{
              'table': tableName,
              'column': fromCol,
              'reason': 'Foreign key without index '
                  '(references ${fk['table']}.${fk['to']})',
              'sql': 'CREATE INDEX idx_${tableName}_$fromCol '
                  'ON "$tableName"("$fromCol");',
              'priority': 'high',
            });
          }
        }

        // Check column naming patterns
        final colInfoRows = ServerContext.normalizeRows(
          await query('PRAGMA table_info("$tableName")'),
        );

        for (final col in colInfoRows) {
          final colName = col['name'] as String?;
          final pk = col['pk'];
          if (colName != null &&
              !(pk is int && pk > 0) &&
              !indexedColumns.contains(colName)) {
            final alreadySuggested = suggestions.any(
              (s) => s['table'] == tableName && s['column'] == colName,
            );

            if (!alreadySuggested &&
                ServerConstants.reIdSuffix.hasMatch(colName)) {
              suggestions.add(<String, dynamic>{
                'table': tableName,
                'column': colName,
                'reason': 'Column ending in _id \u2014 likely used in '
                    'JOINs/WHERE',
                'sql': 'CREATE INDEX idx_${tableName}_$colName '
                    'ON "$tableName"("$colName");',
                'priority': 'medium',
              });
            }

            if (!alreadySuggested &&
                ServerConstants.reDateTimeSuffix.hasMatch(colName)) {
              suggestions.add(<String, dynamic>{
                'table': tableName,
                'column': colName,
                'reason': 'Date/time column \u2014 often used in '
                    'ORDER BY or range queries',
                'sql': 'CREATE INDEX idx_${tableName}_$colName '
                    'ON "$tableName"("$colName");',
                'priority': 'low',
              });
            }
          }
        }
      }

      const priorityOrder = <String, int>{
        'high': 0,
        'medium': 1,
        'low': 2,
      };

      suggestions.sort(
        (a, b) => (priorityOrder[a['priority']] ?? 3)
            .compareTo(priorityOrder[b['priority']] ?? 3),
      );

      _ctx.setJsonHeaders(res);
      res.write(jsonEncode(<String, dynamic>{
        'suggestions': suggestions,
        'tablesAnalyzed': tableNames.length,
      }));
    } on Object catch (error, stack) {
      _ctx.logError(error, stack);
      res.statusCode = HttpStatus.internalServerError;
      res.headers.contentType = ContentType.json;
      _ctx.setCors(res);
      res.write(jsonEncode(<String, String>{
        ServerConstants.jsonKeyError: error.toString(),
      }));
    } finally {
      await res.close();
    }
  }

  /// Handles GET /api/analytics/size: database-level and per-table
  /// storage metrics.
  Future<void> handleSizeAnalytics(
    HttpResponse response,
    DriftDebugQuery query,
  ) async {
    final res = response;

    try {
      int pragmaInt(List<Map<String, dynamic>> rows) {
        if (rows.isEmpty) return 0;

        final v = rows.first.values.firstOrNull;

        return v is int ? v : int.tryParse('$v') ?? 0;
      }

      final pageSize = pragmaInt(
        ServerContext.normalizeRows(await query('PRAGMA page_size')),
      );
      final pageCount = pragmaInt(
        ServerContext.normalizeRows(await query('PRAGMA page_count')),
      );
      final freelistCount = pragmaInt(
        ServerContext.normalizeRows(await query('PRAGMA freelist_count')),
      );

      final journalModeRows = ServerContext.normalizeRows(
        await query('PRAGMA journal_mode'),
      );
      final journalMode = journalModeRows.isNotEmpty
          ? (journalModeRows.first.values.firstOrNull?.toString() ?? 'unknown')
          : 'unknown';

      final totalSizeBytes = pageSize * pageCount;
      final freeSpaceBytes = pageSize * freelistCount;

      final tableNames = await ServerContext.getTableNames(query);
      final tableStats = <Map<String, dynamic>>[];

      for (final tableName in tableNames) {
        final countRows = ServerContext.normalizeRows(
          await query('SELECT COUNT(*) AS '
              '${ServerConstants.jsonKeyCountColumn} '
              'FROM "$tableName"'),
        );
        final rowCount = ServerContext.extractCountFromRows(countRows);

        final colInfoRows = ServerContext.normalizeRows(
          await query('PRAGMA table_info("$tableName")'),
        );

        final indexRows = ServerContext.normalizeRows(
          await query('PRAGMA index_list("$tableName")'),
        );
        final indexNames = indexRows
            .map((r) => r[ServerConstants.jsonKeyName]?.toString() ?? '')
            .where((n) => n.isNotEmpty)
            .toList();

        tableStats.add(<String, dynamic>{
          ServerConstants.jsonKeyTable: tableName,
          ServerConstants.jsonKeyRowCount: rowCount,
          'columnCount': colInfoRows.length,
          'indexCount': indexNames.length,
          'indexes': indexNames,
        });
      }

      tableStats.sort((a, b) =>
          ((b[ServerConstants.jsonKeyRowCount] as int?) ?? 0)
              .compareTo((a[ServerConstants.jsonKeyRowCount] as int?) ?? 0));

      _ctx.setJsonHeaders(res);
      res.write(jsonEncode(<String, dynamic>{
        'pageSize': pageSize,
        'pageCount': pageCount,
        'freelistCount': freelistCount,
        'totalSizeBytes': totalSizeBytes,
        'freeSpaceBytes': freeSpaceBytes,
        'usedSizeBytes': totalSizeBytes - freeSpaceBytes,
        'journalMode': journalMode,
        ServerConstants.jsonKeyTableCount: tableNames.length,
        ServerConstants.jsonKeyTables: tableStats,
      }));
    } on Object catch (error, stack) {
      _ctx.logError(error, stack);
      res.statusCode = HttpStatus.internalServerError;
      res.headers.contentType = ContentType.json;
      _ctx.setCors(res);
      res.write(jsonEncode(<String, String>{
        ServerConstants.jsonKeyError: error.toString(),
      }));
    } finally {
      await res.close();
    }
  }

  /// Scans all tables for data quality anomalies.
  Future<void> handleAnomalyDetection(
    HttpResponse response,
    DriftDebugQuery query,
  ) async {
    final res = response;

    try {
      final tableNames = await ServerContext.getTableNames(query);
      final anomalies = <Map<String, dynamic>>[];

      for (final tableName in tableNames) {
        final colInfoRows = ServerContext.normalizeRows(
          await query('PRAGMA table_info("$tableName")'),
        );

        final tableRowCount = ServerContext.extractCountFromRows(
          ServerContext.normalizeRows(
            await query('SELECT COUNT(*) AS c FROM "$tableName"'),
          ),
        );

        for (final col in colInfoRows) {
          final colName = col['name'] as String?;
          final colType = (col['type'] as String?) ?? '';
          final isNullable = col['notnull'] == 0;
          if (colName != null) {
            if (isNullable) {
              await _detectNullValues(
                  query: query, tableName: tableName, colName: colName, tableRowCount: tableRowCount, anomalies: anomalies);
            }
            if (ServerContext.isTextType(colType)) {
              await _detectEmptyStrings(query: query, tableName: tableName, colName: colName, anomalies: anomalies);
            }
            if (ServerContext.isNumericType(colType)) {
              await _detectNumericOutliers(query: query, tableName: tableName, colName: colName, anomalies: anomalies);
            }
          }
        }

        await _detectOrphanedForeignKeys(
            query: query, tableName: tableName, tableNames: tableNames, anomalies: anomalies);
        await _detectDuplicateRows(query: query, tableName: tableName, tableRowCount: tableRowCount, anomalies: anomalies);
      }

      ServerContext.sortAnomaliesBySeverity(anomalies);

      _ctx.setJsonHeaders(res);
      res.write(jsonEncode(<String, dynamic>{
        'anomalies': anomalies,
        'tablesScanned': tableNames.length,
        'analyzedAt': DateTime.now().toUtc().toIso8601String(),
      }));
    } on Object catch (error, stack) {
      _ctx.logError(error, stack);
      res.statusCode = HttpStatus.internalServerError;
      res.headers.contentType = ContentType.json;
      _ctx.setCors(res);
      res.write(jsonEncode(<String, String>{
        ServerConstants.jsonKeyError: error.toString(),
      }));
    } finally {
      await res.close();
    }
  }

  Future<void> _detectNullValues({
    required DriftDebugQuery query,
    required String tableName,
    required String colName,
    required int tableRowCount,
    required List<Map<String, dynamic>> anomalies,
  }) async {
    final nullCount = ServerContext.extractCountFromRows(
      ServerContext.normalizeRows(
        await query(
          'SELECT COUNT(*) AS c FROM "$tableName" '
          'WHERE "$colName" IS NULL',
        ),
      ),
    );
    if (nullCount == 0) return;

    final pct = tableRowCount > 0 ? (nullCount / tableRowCount * 100) : 0;

    anomalies.add(<String, dynamic>{
      'table': tableName,
      'column': colName,
      'type': 'null_values',
      'severity': pct > 50 ? 'warning' : 'info',
      'count': nullCount,
      'message': '$nullCount NULL value(s) in $tableName.$colName '
          '(${pct.toStringAsFixed(1)}%)',
    });
  }

  Future<void> _detectEmptyStrings({
    required DriftDebugQuery query,
    required String tableName,
    required String colName,
    required List<Map<String, dynamic>> anomalies,
  }) async {
    final emptyCount = ServerContext.extractCountFromRows(
      ServerContext.normalizeRows(
        await query(
          "SELECT COUNT(*) AS c FROM \"$tableName\" "
          "WHERE \"$colName\" = ''",
        ),
      ),
    );
    if (emptyCount == 0) return;

    anomalies.add(<String, dynamic>{
      'table': tableName,
      'column': colName,
      'type': 'empty_strings',
      'severity': 'warning',
      'count': emptyCount,
      'message': '$emptyCount empty string(s) in $tableName.$colName',
    });
  }

  Future<void> _detectNumericOutliers({
    required DriftDebugQuery query,
    required String tableName,
    required String colName,
    required List<Map<String, dynamic>> anomalies,
  }) async {
    final statsRows = ServerContext.normalizeRows(await query(
      'SELECT AVG("$colName") AS avg_val, '
      'MIN("$colName") AS min_val, '
      'MAX("$colName") AS max_val '
      'FROM "$tableName" WHERE "$colName" IS NOT NULL',
    ));
    if (statsRows.isEmpty) return;

    final avg = ServerContext.toDouble(statsRows.first['avg_val']);
    final min = ServerContext.toDouble(statsRows.first['min_val']);
    final max = ServerContext.toDouble(statsRows.first['max_val']);
    if (avg == null || min == null || max == null || avg == 0) {
      return;
    }

    if (max.abs() > avg.abs() * 10 || min.abs() > avg.abs() * 10) {
      anomalies.add(<String, dynamic>{
        'table': tableName,
        'column': colName,
        'type': 'potential_outlier',
        'severity': 'info',
        'message': 'Potential outlier in $tableName.$colName: '
            'range [$min, $max], avg '
            '${avg.toStringAsFixed(2)}',
      });
    }
  }

  Future<void> _detectOrphanedForeignKeys({
    required DriftDebugQuery query,
    required String tableName,
    required List<String> tableNames,
    required List<Map<String, dynamic>> anomalies,
  }) async {
    final fkRows = ServerContext.normalizeRows(
      await query('PRAGMA foreign_key_list("$tableName")'),
    );

    for (final fk in fkRows) {
      final fromCol = fk['from'] as String?;
      final toTable = fk['table'] as String?;
      final toCol = fk['to'] as String?;
      if (fromCol != null &&
          toTable != null &&
          toCol != null &&
          tableNames.contains(toTable)) {
        final orphanCount = ServerContext.extractCountFromRows(
          ServerContext.normalizeRows(
            await query(
              'SELECT COUNT(*) AS c FROM "$tableName" t '
              'LEFT JOIN "$toTable" r '
              'ON t."$fromCol" = r."$toCol" '
              'WHERE t."$fromCol" IS NOT NULL '
              'AND r."$toCol" IS NULL',
            ),
          ),
        );

        if (orphanCount > 0) {
          anomalies.add(<String, dynamic>{
            'table': tableName,
            'column': fromCol,
            'type': 'orphaned_fk',
            'severity': 'error',
            'count': orphanCount,
            'message': '$orphanCount orphaned FK(s): '
                '$tableName.$fromCol -> $toTable.$toCol',
          });
        }
      }
    }
  }

  Future<void> _detectDuplicateRows({
    required DriftDebugQuery query,
    required String tableName,
    required int tableRowCount,
    required List<Map<String, dynamic>> anomalies,
  }) async {
    final distinctCount = ServerContext.extractCountFromRows(
      ServerContext.normalizeRows(
        await query(
          'SELECT COUNT(*) AS c FROM '
          '(SELECT DISTINCT * FROM "$tableName")',
        ),
      ),
    );

    if (tableRowCount > distinctCount) {
      anomalies.add(<String, dynamic>{
        'table': tableName,
        'type': 'duplicate_rows',
        'severity': 'warning',
        'count': tableRowCount - distinctCount,
        'message': '${tableRowCount - distinctCount} duplicate '
            'row(s) in $tableName',
      });
    }
  }
}
