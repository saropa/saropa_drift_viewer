// Snapshot handler extracted from _DriftDebugServerImpl.
// Handles snapshot create/get/compare/delete.

import 'dart:convert';
import 'dart:io';

import 'server_constants.dart';
import 'server_context.dart';
import 'server_types.dart';

/// Handles snapshot-related API endpoints.
final class SnapshotHandler {
  /// Creates a [SnapshotHandler] with the given [ServerContext].
  SnapshotHandler(this._ctx);

  final ServerContext _ctx;

  /// Handles POST /api/snapshot: captures full table data into
  /// in-memory snapshot.
  Future<void> handleSnapshotCreate(
    HttpResponse response,
    DriftDebugQuery query,
  ) async {
    final res = response;
    try {
      final tables = await ServerContext.getTableNames(query);
      final Map<String, List<Map<String, dynamic>>> data = {};
      for (final table in tables) {
        final List<Map<String, dynamic>> rows =
            await query('SELECT * FROM "$table"');
        data[table] = rows.map((r) => Map<String, dynamic>.from(r)).toList();
      }
      final id = DateTime.now().toUtc().toIso8601String();
      final createdAt = DateTime.now().toUtc();
      final created = Snapshot(id: id, createdAt: createdAt, tables: data);
      _ctx.snapshot = created;
      _ctx.setJsonHeaders(res);
      res.write(jsonEncode(<String, dynamic>{
        ServerConstants.jsonKeyId: created.id,
        ServerConstants.jsonKeyCreatedAt:
            created.createdAt.toUtc().toIso8601String(),
        ServerConstants.jsonKeyTableCount: created.tables.length,
        ServerConstants.jsonKeyTables: created.tables.keys.toList(),
      }));
    } on Object catch (error, stack) {
      _ctx.logError(error, stack);
      res.statusCode = HttpStatus.internalServerError;
      res.headers.contentType = ContentType.json;
      _ctx.setCors(res);
      res.write(jsonEncode(
          <String, String>{ServerConstants.jsonKeyError: error.toString()}));
    } finally {
      await res.close();
    }
  }

  /// Handles GET /api/snapshot: returns snapshot metadata or null.
  Future<void> handleSnapshotGet(HttpResponse response) async {
    final res = response;
    final snap = _ctx.snapshot;
    if (snap == null) {
      res.statusCode = HttpStatus.ok;
      _ctx.setJsonHeaders(res);
      res.write(
          jsonEncode(<String, dynamic>{ServerConstants.jsonKeySnapshot: null}));
      await res.close();

      return;
    }
    final tableCounts = <String, int>{};
    for (final e in snap.tables.entries) {
      tableCounts[e.key] = e.value.length;
    }
    _ctx.setJsonHeaders(res);
    res.write(jsonEncode(<String, dynamic>{
      ServerConstants.jsonKeySnapshot: <String, dynamic>{
        ServerConstants.jsonKeyId: snap.id,
        ServerConstants.jsonKeyCreatedAt:
            snap.createdAt.toUtc().toIso8601String(),
        ServerConstants.jsonKeyTables: snap.tables.keys.toList(),
        ServerConstants.jsonKeyCounts: tableCounts,
      },
    }));
    await res.close();
  }

  /// Handles GET /api/snapshot/compare: diffs current DB vs snapshot.
  Future<void> handleSnapshotCompare(
    HttpResponse response,
    HttpRequest request,
    DriftDebugQuery query,
  ) async {
    final res = response;
    final req = request;
    final snap = _ctx.snapshot;
    if (snap == null) {
      res.statusCode = HttpStatus.badRequest;
      _ctx.setJsonHeaders(res);
      res.write(jsonEncode(<String, String>{
        ServerConstants.jsonKeyError: ServerConstants.errorNoSnapshot,
      }));
      await res.close();

      return;
    }
    try {
      final tablesNow = await ServerContext.getTableNames(query);
      final allTables = <String>{...snap.tables.keys, ...tablesNow};
      final detailed =
          req.uri.queryParameters[ServerConstants.queryParamDetail] ==
              ServerConstants.detailRows;
      final List<Map<String, dynamic>> tableDiffs = [];
      for (final table in allTables.toList()..sort()) {
        final rowsThen = snap.tables[table] ?? [];
        final rowsNowList = tablesNow.contains(table)
            ? ServerContext.normalizeRows(await query('SELECT * FROM "$table"'))
            : <Map<String, dynamic>>[];
        final setThen = rowsThen.map(ServerContext.rowSignature).toSet();
        final setNow = rowsNowList.map(ServerContext.rowSignature).toSet();
        final added = setNow.difference(setThen).length;
        final removed = setThen.difference(setNow).length;
        final inBoth = setThen.intersection(setNow).length;
        final tableDiff = <String, dynamic>{
          ServerConstants.jsonKeyTable: table,
          ServerConstants.jsonKeyCountThen: rowsThen.length,
          ServerConstants.jsonKeyCountNow: rowsNowList.length,
          ServerConstants.jsonKeyAdded: added,
          ServerConstants.jsonKeyRemoved: removed,
          ServerConstants.jsonKeyUnchanged: inBoth,
        };
        if (detailed) {
          await _addRowLevelDiff(
            tableDiff: tableDiff,
            table: table,
            rowsThen: rowsThen,
            rowsNow: rowsNowList,
            query: query,
          );
        }
        tableDiffs.add(tableDiff);
      }
      final body = <String, dynamic>{
        ServerConstants.jsonKeySnapshotId: snap.id,
        ServerConstants.jsonKeySnapshotCreatedAt:
            snap.createdAt.toUtc().toIso8601String(),
        ServerConstants.jsonKeyComparedAt:
            DateTime.now().toUtc().toIso8601String(),
        ServerConstants.jsonKeyTables: tableDiffs,
      };
      if (req.uri.queryParameters[ServerConstants.queryParamFormat] ==
          ServerConstants.formatDownload) {
        res.statusCode = HttpStatus.ok;
        res.headers.contentType = ContentType.json;
        res.headers.set(ServerConstants.headerContentDisposition,
            ServerConstants.attachmentSnapshotDiff);
        _ctx.setCors(res);
        res.write(const JsonEncoder.withIndent('  ').convert(body));
      } else {
        _ctx.setJsonHeaders(res);
        res.write(const JsonEncoder.withIndent('  ').convert(body));
      }
    } on Object catch (error, stack) {
      _ctx.logError(error, stack);
      res.statusCode = HttpStatus.internalServerError;
      res.headers.contentType = ContentType.json;
      _ctx.setCors(res);
      res.write(jsonEncode(
          <String, String>{ServerConstants.jsonKeyError: error.toString()}));
    } finally {
      await res.close();
    }
  }

  /// Adds row-level diff fields to [tableDiff] by comparing
  /// [rowsThen] (snapshot) with [rowsNow] (current) using primary keys.
  Future<void> _addRowLevelDiff({
    required Map<String, dynamic> tableDiff,
    required String table,
    required List<Map<String, dynamic>> rowsThen,
    required List<Map<String, dynamic>> rowsNow,
    required DriftDebugQuery query,
  }) async {
    final pkInfoRows = ServerContext.normalizeRows(
      await query('PRAGMA table_info("$table")'),
    );

    final pkColumns = <String>[];

    for (final r in pkInfoRows) {
      final pk = r[ServerConstants.jsonKeyPk];

      if (pk is int && pk > 0) {
        final name = r[ServerConstants.jsonKeyName];

        if (name is String) {
          pkColumns.add(name);
        }
      }
    }

    if (pkColumns.isEmpty) {
      tableDiff[ServerConstants.jsonKeyHasPk] = false;
      tableDiff[ServerConstants.jsonKeyAddedRows] = <Map<String, dynamic>>[];
      tableDiff[ServerConstants.jsonKeyRemovedRows] = <Map<String, dynamic>>[];
      tableDiff[ServerConstants.jsonKeyChangedRows] = <Map<String, dynamic>>[];

      return;
    }

    final thenByPk = <String, Map<String, dynamic>>{};

    for (final r in rowsThen) {
      thenByPk[ServerContext.compositePkKey(pkColumns, r)] = r;
    }

    final nowByPk = <String, Map<String, dynamic>>{};

    for (final r in rowsNow) {
      nowByPk[ServerContext.compositePkKey(pkColumns, r)] = r;
    }

    final addedRows = rowsNow.where((r) {
      final key = ServerContext.compositePkKey(pkColumns, r);

      return !thenByPk.containsKey(key);
    }).toList();

    final removedRows = rowsThen.where((r) {
      final key = ServerContext.compositePkKey(pkColumns, r);

      return !nowByPk.containsKey(key);
    }).toList();

    final changedRows = <Map<String, dynamic>>[];

    for (final entry in thenByPk.entries) {
      final nowRow = nowByPk[entry.key];

      if (nowRow == null) continue;

      final thenRow = entry.value;
      final changedCols = <String>[];

      for (final col in thenRow.keys) {
        final thenVal = thenRow[col]?.toString() ?? '';
        final nowVal = nowRow[col]?.toString() ?? '';

        if (thenVal != nowVal) {
          changedCols.add(col);
        }
      }

      if (changedCols.isNotEmpty) {
        changedRows.add(<String, dynamic>{
          ServerConstants.jsonKeyPk: entry.key,
          ServerConstants.jsonKeyThen: thenRow,
          ServerConstants.jsonKeyNow: nowRow,
          ServerConstants.jsonKeyChangedColumns: changedCols,
        });
      }
    }

    tableDiff[ServerConstants.jsonKeyHasPk] = true;
    tableDiff[ServerConstants.jsonKeyAddedRows] = addedRows;
    tableDiff[ServerConstants.jsonKeyRemovedRows] = removedRows;
    tableDiff[ServerConstants.jsonKeyChangedRows] = changedRows;
  }

  /// Handles DELETE /api/snapshot: clears the in-memory snapshot.
  Future<void> handleSnapshotDelete(HttpResponse response) async {
    final res = response;
    _ctx.snapshot = null;
    _ctx.setJsonHeaders(res);
    res.write(jsonEncode(<String, String>{
      ServerConstants.jsonKeyOk: ServerConstants.messageSnapshotCleared,
    }));
    await res.close();
  }
}
