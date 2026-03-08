// Import handler extracted from _DriftDebugServerImpl.
// Handles POST /api/import for CSV, JSON, and SQL data import.

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:saropa_drift_viewer/src/drift_debug_import.dart';

import 'server_constants.dart';
import 'server_context.dart';

/// Handles data import API endpoint.
///
/// Example:
/// ```dart
/// final handler = ImportHandler(ctx);
/// await handler.handleImport(request);
/// ```
extension type ImportHandler(ServerContext _ctx) implements Object {
  /// Handles POST /api/import: imports CSV, JSON, or SQL data.
  Future<void> handleImport(HttpRequest request) async {
    final res = request.response;
    final writeQuery = _ctx.writeQuery;

    if (writeQuery == null) {
      res.statusCode = HttpStatus.notImplemented;
      _ctx.setJsonHeaders(res);
      res.write(jsonEncode(<String, String>{
        ServerConstants.jsonKeyError:
            'Import not configured. Pass writeQuery to DriftDebugServer.start().',
      }));
      await res.close();

      return;
    }

    try {
      final builder = BytesBuilder();

      await for (final chunk in request) {
        builder.add(chunk);
      }

      final body = utf8.decode(builder.toBytes());
      final decoded = ServerContext.parseJsonMap(body);

      if (decoded == null) {
        res.statusCode = HttpStatus.badRequest;
        _ctx.setJsonHeaders(res);
        res.write(jsonEncode(<String, String>{
          ServerConstants.jsonKeyError: 'Invalid JSON body',
        }));
        await res.close();

        return;
      }

      final format = decoded['format'] as String?;
      final data = decoded['data'] as String?;
      final table = decoded['table'] as String?;

      if (format == null || data == null || table == null) {
        res.statusCode = HttpStatus.badRequest;
        _ctx.setJsonHeaders(res);
        res.write(jsonEncode(<String, String>{
          ServerConstants.jsonKeyError:
              'Missing required fields: format, data, table',
        }));
        await res.close();

        return;
      }

      // Validate table exists
      final tableNames =
          await ServerContext.getTableNames(_ctx.instrumentedQuery);

      if (!tableNames.contains(table)) {
        res.statusCode = HttpStatus.badRequest;
        _ctx.setJsonHeaders(res);
        res.write(jsonEncode(<String, String>{
          ServerConstants.jsonKeyError: 'Table "$table" not found.',
        }));
        await res.close();

        return;
      }

      const processor = DriftDebugImportProcessor();
      final result = await processor.processImport(
        format: format,
        data: data,
        table: table,
        writeQuery: writeQuery,
        sqlLiteral: ServerContext.sqlLiteral,
      );

      // Bump generation so live-refresh picks up new rows.
      await _ctx.checkDataChange();

      _ctx.setJsonHeaders(res);
      res.write(jsonEncode(result.toJson()));
    } on Object catch (error, stack) {
      _ctx.logError(error, stack);
      res.statusCode = HttpStatus.internalServerError;
      _ctx.setJsonHeaders(res);
      res.write(jsonEncode(<String, String>{
        ServerConstants.jsonKeyError: error.toString(),
      }));
    } finally {
      await res.close();
    }
  }
}
