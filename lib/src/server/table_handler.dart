// Table data handler extracted from _DriftDebugServerImpl.
// Handles table list, data, columns, count, and FK metadata.

import 'dart:convert';
import 'dart:io';

import 'server_constants.dart';
import 'server_context.dart';

/// Handles table-related API endpoints.
final class TableHandler {
  /// Creates a [TableHandler] with the given [ServerContext].
  TableHandler(this._ctx);

  final ServerContext _ctx;

  /// GET /api/tables — returns JSON array of table names.
  Future<void> sendTableList(
      HttpResponse response, DriftDebugQuery query) async {
    final res = response;
    await _ctx.checkDataChange();
    final List<String> names = await ServerContext.getTableNames(query);
    _ctx.setJsonHeaders(res);
    res.write(jsonEncode(names));
    await res.close();
  }

  /// Returns JSON list of column names for
  /// GET /api/table/<name>/columns.
  Future<void> sendTableColumns(
    HttpResponse response,
    DriftDebugQuery query,
    String tableName,
  ) async {
    final res = response;
    if (!await _ctx.requireKnownTable(res, query, tableName)) return;
    final dynamic rawInfo = await query('PRAGMA table_info("$tableName")');
    final List<Map<String, dynamic>> rows =
        ServerContext.normalizeRows(rawInfo);
    final List<String> columns = rows
        .map((r) => r[ServerConstants.jsonKeyName] as String? ?? '')
        .where((s) => s.isNotEmpty)
        .toList();
    _ctx.setJsonHeaders(res);
    res.write(jsonEncode(columns));
    await res.close();
  }

  /// Returns FK metadata for GET /api/table/<name>/fk-meta.
  Future<void> sendTableFkMeta(
    HttpResponse response,
    DriftDebugQuery query,
    String tableName,
  ) async {
    final res = response;
    if (!await _ctx.requireKnownTable(res, query, tableName)) return;
    try {
      final List<Map<String, dynamic>> fkRows = ServerContext.normalizeRows(
        await query('PRAGMA foreign_key_list("$tableName")'),
      );
      final List<Map<String, dynamic>> fks = fkRows
          .map((r) {
            final fromCol = r[ServerConstants.pragmaFrom] as String?;
            final toTable = r[ServerConstants.jsonKeyTable] as String?;
            final toCol = r[ServerConstants.pragmaTo] as String?;
            if (fromCol == null || toTable == null || toCol == null) {
              return null;
            }
            return <String, dynamic>{
              ServerConstants.fkFromColumn: fromCol,
              ServerConstants.fkToTable: toTable,
              ServerConstants.fkToColumn: toCol,
            };
          })
          .whereType<Map<String, dynamic>>()
          .toList();
      _ctx.setJsonHeaders(res);
      res.write(jsonEncode(fks));
      await res.close();
    } on Object catch (error, stack) {
      _ctx.logError(error, stack);
      await _ctx.sendErrorResponse(res, error);
    }
  }

  /// Returns JSON {"count": N} for GET /api/table/<name>/count.
  Future<void> sendTableCount(
    HttpResponse response,
    DriftDebugQuery query,
    String tableName,
  ) async {
    final res = response;
    if (!await _ctx.requireKnownTable(res, query, tableName)) return;
    final dynamic rawCount =
        await query('SELECT COUNT(*) AS c FROM "$tableName"');
    final List<Map<String, dynamic>> rows =
        ServerContext.normalizeRows(rawCount);
    final int count = ServerContext.extractCountFromRows(rows);
    _ctx.setJsonHeaders(res);
    res.write(jsonEncode(<String, int>{ServerConstants.jsonKeyCount: count}));
    await res.close();
  }

  /// GET /api/table/<name>?limit=&offset= — returns JSON array of rows.
  Future<void> sendTableData({
    required HttpResponse response,
    required DriftDebugQuery query,
    required String tableName,
    required int limit,
    required int offset,
  }) async {
    final res = response;
    if (!await _ctx.requireKnownTable(res, query, tableName)) return;
    final dynamic raw =
        await query('SELECT * FROM "$tableName" LIMIT $limit OFFSET $offset');
    final List<Map<String, dynamic>> data = ServerContext.normalizeRows(raw);
    _ctx.setJsonHeaders(res);
    res.write(const JsonEncoder.withIndent('  ').convert(data));
    await res.close();
  }
}
