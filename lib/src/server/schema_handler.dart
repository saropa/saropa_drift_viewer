// Schema handler extracted from _DriftDebugServerImpl.
// Handles schema dump, diagram, metadata, full dump, and database download.

import 'dart:convert';
import 'dart:io';

import 'server_constants.dart';
import 'server_context.dart';

/// Handles schema-related API endpoints.
final class SchemaHandler {
  /// Creates a [SchemaHandler] with the given [ServerContext].
  SchemaHandler(this._ctx);

  final ServerContext _ctx;

  /// Sends schema-only SQL dump (CREATE statements, no data).
  Future<void> sendSchemaDump(
      HttpResponse response, DriftDebugQuery query) async {
    final res = response;
    final String schema = await ServerContext.getSchemaSql(query);

    res.statusCode = HttpStatus.ok;
    _ctx.setAttachmentHeaders(res, ServerConstants.attachmentSchemaSql);
    res.write(schema);
    await res.close();
  }

  /// Returns diagram data: tables with columns and foreign keys.
  Future<Map<String, dynamic>> getDiagramData(DriftDebugQuery query) async {
    final List<String> tableNames = await ServerContext.getTableNames(query);
    final List<Map<String, dynamic>> tables = [];
    final List<Map<String, dynamic>> foreignKeys = [];

    for (final tableName in tableNames) {
      final List<Map<String, dynamic>> infoRows =
          await query('PRAGMA table_info("$tableName")');
      final List<Map<String, dynamic>> columns = infoRows.map((r) {
        final name = r['name'];
        final type = r['type'];
        final pk = r['pk'];

        return <String, dynamic>{
          ServerConstants.jsonKeyName: name is String? ? name ?? '' : '',
          ServerConstants.jsonKeyType: type is String? ? type ?? '' : '',
          ServerConstants.jsonKeyPk: pk is int ? pk != 0 : false,
        };
      }).toList();

      tables.add(<String, dynamic>{
        ServerConstants.jsonKeyName: tableName,
        ServerConstants.jsonKeyColumns: columns,
      });

      try {
        final dynamic rawFk =
            await query('PRAGMA foreign_key_list("$tableName")');
        final List<Map<String, dynamic>> fkRows =
            ServerContext.normalizeRows(rawFk);

        for (final r in fkRows) {
          final toTable = r[ServerConstants.jsonKeyTable] as String?;
          final fromCol = r[ServerConstants.pragmaFrom] as String?;
          final toCol = r[ServerConstants.pragmaTo] as String?;

          if (toTable != null &&
              toTable.isNotEmpty &&
              fromCol != null &&
              toCol != null) {
            foreignKeys.add(<String, dynamic>{
              ServerConstants.fkFromTable: tableName,
              ServerConstants.fkFromColumn: fromCol,
              ServerConstants.fkToTable: toTable,
              ServerConstants.fkToColumn: toCol,
            });
          }
        }
      } on Object catch (error, stack) {
        _ctx.logError(error, stack);
      }
    }

    return <String, dynamic>{
      ServerConstants.jsonKeyTables: tables,
      ServerConstants.jsonKeyForeignKeys: foreignKeys,
    };
  }

  /// Sends JSON diagram data for GET /api/schema/diagram.
  Future<void> sendSchemaDiagram(
      HttpResponse response, DriftDebugQuery query) async {
    final res = response;

    try {
      final Map<String, dynamic> data = await getDiagramData(query);

      _ctx.setJsonHeaders(res);
      res.write(const JsonEncoder.withIndent('  ').convert(data));
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

  /// Sends schema metadata for GET /api/schema/metadata.
  Future<void> sendSchemaMetadata(
    HttpResponse response,
    DriftDebugQuery query,
  ) async {
    final res = response;

    try {
      final tableNames = await ServerContext.getTableNames(query);
      final tables = <Map<String, dynamic>>[];

      for (final tableName in tableNames) {
        final infoRows = ServerContext.normalizeRows(
          await query('PRAGMA table_info("$tableName")'),
        );
        final columns = infoRows
            .map((r) => <String, dynamic>{
                  ServerConstants.jsonKeyName:
                      r[ServerConstants.jsonKeyName] ?? '',
                  ServerConstants.jsonKeyType:
                      r[ServerConstants.jsonKeyType] ?? '',
                  ServerConstants.jsonKeyPk:
                      (r[ServerConstants.jsonKeyPk] is int)
                          ? r[ServerConstants.jsonKeyPk] != 0
                          : false,
                })
            .toList();
        final countRows = ServerContext.normalizeRows(
          await query(
            'SELECT COUNT(*) AS '
            '${ServerConstants.jsonKeyCountColumn} '
            'FROM "$tableName"',
          ),
        );
        final count = ServerContext.extractCountFromRows(countRows);

        tables.add(<String, dynamic>{
          ServerConstants.jsonKeyName: tableName,
          ServerConstants.jsonKeyColumns: columns,
          ServerConstants.jsonKeyRowCount: count,
        });
      }

      _ctx.setJsonHeaders(res);
      res.write(
          jsonEncode(<String, dynamic>{ServerConstants.jsonKeyTables: tables}));
      await res.close();
    } on Object catch (error, stack) {
      _ctx.logError(error, stack);
      await _ctx.sendErrorResponse(res, error);
    }
  }

  /// Builds full dump SQL: schema + INSERT statements for every row.
  Future<String> getFullDumpSql(DriftDebugQuery query) async {
    final buffer = StringBuffer();
    final schema = await ServerContext.getSchemaSql(query);

    buffer.writeln(schema);
    buffer.writeln('-- Data dump');
    final tables = await ServerContext.getTableNames(query);

    for (final table in tables) {
      final dynamic raw = await query('SELECT * FROM "$table"');
      final List<Map<String, dynamic>> rows = ServerContext.normalizeRows(raw);

      if (rows.isNotEmpty) {
        final firstRow = rows.firstOrNull;

        if (firstRow != null) {
          final keys = firstRow.keys.toList();

          if (keys.isNotEmpty) {
            final colList = keys.map((k) => '"$k"').join(', ');

            for (final row in rows) {
              final values = keys
                  .map(
                    (k) => ServerContext.sqlLiteral(row[k]),
                  )
                  .join(', ');

              buffer.writeln(
                'INSERT INTO "$table" '
                '($colList) VALUES ($values);',
              );
            }
          }
        }
      }
    }

    return buffer.toString();
  }

  /// Sends full dump (schema + data) as downloadable SQL file.
  Future<void> sendFullDump(
      HttpResponse response, DriftDebugQuery query) async {
    final res = response;
    final String dump = await getFullDumpSql(query);

    res.statusCode = HttpStatus.ok;
    _ctx.setAttachmentHeaders(res, ServerConstants.attachmentDumpSql);
    res.write(dump);
    await res.close();
  }

  /// Sends the raw SQLite database file when getDatabaseBytes is
  /// configured.
  Future<void> sendDatabaseFile(HttpResponse response) async {
    final res = response;
    final getBytes = _ctx.getDatabaseBytes;

    if (getBytes == null) {
      res.statusCode = HttpStatus.notImplemented;
      _ctx.setJsonHeaders(res);
      res.write(jsonEncode(<String, String>{
        ServerConstants.jsonKeyError:
            ServerConstants.errorDatabaseDownloadNotConfigured,
      }));
      await res.close();

      return;
    }
    try {
      final bytes = await getBytes();

      res.statusCode = HttpStatus.ok;
      res.headers.contentType = ContentType(
          ServerConstants.contentTypeApplicationOctetStream,
          ServerConstants.contentTypeOctetStream);
      res.headers.set(ServerConstants.headerContentDisposition,
          ServerConstants.attachmentDatabaseSqlite);
      _ctx.setCors(res);
      res.add(bytes);
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
}
