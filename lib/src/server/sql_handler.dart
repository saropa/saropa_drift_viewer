// SQL handler extracted from _DriftDebugServerImpl.
// Handles POST /api/sql, POST /api/sql/explain, and SQL validation.

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'server_constants.dart';
import 'server_context.dart';
import 'server_types.dart';

/// Handles SQL execution and explain plan endpoints.
final class SqlHandler {
  /// Creates a [SqlHandler] with the given [ServerContext].
  SqlHandler(this._ctx);

  final ServerContext _ctx;

  /// Handles POST /api/sql: body {"sql": "SELECT ..."}.
  /// Validates read-only; returns {"rows": [...]}.
  Future<void> handleRunSql(HttpRequest request, DriftDebugQuery query) async {
    final sql = await _readAndValidateSqlBody(request);
    if (sql == null) return;
    final res = request.response;
    try {
      final dynamic raw = await query(sql);
      final List<Map<String, dynamic>> rows = ServerContext.normalizeRows(raw);
      _ctx.setJsonHeaders(res);
      res.write(
          jsonEncode(<String, dynamic>{ServerConstants.jsonKeyRows: rows}));
    } on Object catch (error, stack) {
      _ctx.logError(error, stack);
      res.statusCode = HttpStatus.internalServerError;
      _ctx.setJsonHeaders(res);
      res.write(jsonEncode(
          <String, String>{ServerConstants.jsonKeyError: error.toString()}));
    } finally {
      await res.close();
    }
  }

  /// Handles POST /api/sql/explain: body {"sql": "SELECT ..."}.
  /// Prepends EXPLAIN QUERY PLAN; returns {"rows": [...], "sql": "..."}.
  Future<void> handleExplainSql(
      HttpRequest request, DriftDebugQuery query) async {
    final sql = await _readAndValidateSqlBody(request);
    if (sql == null) return;
    final res = request.response;
    try {
      final explainSql = 'EXPLAIN QUERY PLAN $sql';
      final dynamic raw = await query(explainSql);
      final rows = ServerContext.normalizeRows(raw);
      _ctx.setJsonHeaders(res);
      res.write(jsonEncode(<String, dynamic>{
        ServerConstants.jsonKeyRows: rows,
        ServerConstants.jsonKeySql: explainSql,
      }));
    } on Object catch (error, stack) {
      _ctx.logError(error, stack);
      res.statusCode = HttpStatus.internalServerError;
      _ctx.setJsonHeaders(res);
      res.write(jsonEncode(
          <String, String>{ServerConstants.jsonKeyError: error.toString()}));
    } finally {
      await res.close();
    }
  }

  /// Validates that [sql] is read-only: single statement, SELECT or
  /// WITH...SELECT only. Rejects INSERT/UPDATE/DELETE and DDL.
  bool isReadOnlySql(String sql) {
    final trimmed = sql.trim();
    if (trimmed.isEmpty) return false;
    final noLineComments = trimmed.replaceAll(RegExp(r'--[^\n]*'), ' ');
    final noBlockComments =
        noLineComments.replaceAll(RegExp(r'/\*[\s\S]*?\*/'), ' ');
    final noSingleQuotes =
        noBlockComments.replaceAllMapped(RegExp(r"'(?:[^']|'')*'"), (_) => '?');
    final noStrings =
        noSingleQuotes.replaceAllMapped(RegExp(r'"(?:[^"]|"")*"'), (_) => '?');
    final sqlNoStrings = noStrings.trim();
    final firstSemicolon = sqlNoStrings.indexOf(';');
    if (firstSemicolon >= 0 &&
        firstSemicolon + ServerConstants.indexAfterSemicolon <=
            sqlNoStrings.length &&
        firstSemicolon <
            sqlNoStrings.length - ServerConstants.indexAfterSemicolon) {
      final after = ServerContext.safeSubstring(sqlNoStrings,
              start: firstSemicolon + ServerConstants.indexAfterSemicolon)
          .trim();
      if (after.isNotEmpty) return false;
    }
    final withoutTrailingSemicolon = sqlNoStrings.endsWith(';')
        ? ServerContext.safeSubstring(sqlNoStrings, start: 0,
                end: sqlNoStrings.length - ServerConstants.indexAfterSemicolon)
            .trim()
        : sqlNoStrings;
    final upper = withoutTrailingSemicolon.toUpperCase();
    const selectPrefix = 'SELECT ';
    const withPrefix = 'WITH ';
    if (!upper.startsWith(selectPrefix) && !upper.startsWith(withPrefix)) {
      return false;
    }
    const forbidden = <String>{
      'INSERT',
      'UPDATE',
      'DELETE',
      'REPLACE',
      'TRUNCATE',
      'CREATE',
      'ALTER',
      'DROP',
      'ATTACH',
      'DETACH',
      'PRAGMA',
      'VACUUM',
      'ANALYZE',
      'REINDEX',
    };
    final words = RegExp(r'\b\w+\b');
    for (final match in words.allMatches(upper)) {
      final word = match.group(0);
      if (word != null && forbidden.contains(word)) return false;
    }

    return true;
  }

  /// Validated POST /api/sql request body. Checks Content-Type then
  /// decodes and validates.
  ({SqlRequestBody? body, String? error}) parseSqlBody(
      HttpRequest request, String body) {
    final contentType = request.headers.contentType?.mimeType;
    if (contentType != 'application/json') {
      return (body: null, error: 'Content-Type must be application/json');
    }
    Object? decoded;
    try {
      decoded = jsonDecode(body);
    } on Object catch (error, stack) {
      _ctx.logError(error, stack);
      return (body: null, error: ServerConstants.errorInvalidJson);
    }
    if (decoded is! Map<String, dynamic>) {
      return (body: null, error: ServerConstants.errorInvalidJson);
    }
    final rawSql = decoded[ServerConstants.jsonKeySql];
    if (rawSql is! String || rawSql.trim().isEmpty) {
      return (body: null, error: ServerConstants.errorMissingSql);
    }
    final bodyObj = SqlRequestBody.fromJson(decoded);
    if (bodyObj == null) {
      return (body: null, error: ServerConstants.errorMissingSql);
    }
    return (body: bodyObj, error: null);
  }

  /// Reads, parses, and validates a POST SQL request body. Returns the
  /// validated read-only SQL string, or null if validation failed (error
  /// response already sent and closed).
  Future<String?> _readAndValidateSqlBody(HttpRequest request) async {
    final res = request.response;
    String body;
    try {
      final builder = BytesBuilder();
      await for (final chunk in request) {
        builder.add(chunk);
      }

      body = utf8.decode(builder.toBytes());
    } on Object catch (error, stack) {
      _ctx.logError(error, stack);
      res.statusCode = HttpStatus.badRequest;
      _ctx.setJsonHeaders(res);
      res.write(jsonEncode(<String, String>{
        ServerConstants.jsonKeyError: ServerConstants.errorInvalidRequestBody,
      }));
      await res.close();
      return null;
    }
    final result = parseSqlBody(request, body);
    final bodyObj = result.body;
    if (bodyObj == null) {
      res.statusCode = HttpStatus.badRequest;
      _ctx.setJsonHeaders(res);
      res.write(jsonEncode(<String, String>{
        ServerConstants.jsonKeyError:
            result.error ?? ServerConstants.errorInvalidJson,
      }));
      await res.close();
      return null;
    }
    final String sql = bodyObj.sql;
    if (!isReadOnlySql(sql)) {
      res.statusCode = HttpStatus.badRequest;
      _ctx.setJsonHeaders(res);
      res.write(jsonEncode(<String, String>{
        ServerConstants.jsonKeyError: ServerConstants.errorReadOnlyOnly,
      }));
      await res.close();
      return null;
    }
    return sql;
  }
}
