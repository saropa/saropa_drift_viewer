import 'dart:convert';

import 'drift_debug_import_result.dart';

export 'drift_debug_import_result.dart';

/// Processes data imports in CSV, JSON, or SQL format.
///
/// Stateless processor: call [processImport] with the parsed
/// request fields and a write-query callback. Used by the
/// `POST /api/import` handler to keep HTTP plumbing separate
/// from import logic.
final class DriftDebugImportProcessor {
  /// Creates a stateless import processor.
  const DriftDebugImportProcessor();

  /// Supported format identifiers.
  static const String formatJson = 'json';

  /// CSV format identifier.
  static const String formatCsv = 'csv';

  /// Raw SQL format identifier.
  static const String formatSql = 'sql';

  /// BOM (Byte Order Mark) code unit for UTF-8.
  static const int _bomCodeUnit = 0xFEFF;

  /// Imports [data] in the given [format] into [table].
  ///
  /// [writeQuery] executes a single SQL write statement.
  /// [sqlLiteral] converts a Dart value to a SQL literal
  /// string (for quoting).
  ///
  /// Throws [FormatException] for unsupported formats or
  /// malformed CSV. Per-row failures are collected in
  /// [DriftDebugImportResult.errors].
  ///
  /// Returns a [DriftDebugImportResult] with the count of
  /// imported rows and any per-row error messages.
  Future<DriftDebugImportResult> processImport({
    required String format,
    required String data,
    required String table,
    required Future<void> Function(String sql) writeQuery,
    required String Function(dynamic value) sqlLiteral,
  }) async {
    switch (format) {
      case formatJson:
        return await _importJson(
          data: data,
          table: table,
          writeQuery: writeQuery,
          sqlLiteral: sqlLiteral,
        );

      case formatCsv:
        return await _importCsv(
          data: data,
          table: table,
          writeQuery: writeQuery,
          sqlLiteral: sqlLiteral,
        );

      case formatSql:
        return await _importSql(
          data: data,
          table: table,
          writeQuery: writeQuery,
        );

      default:
        throw FormatException(
          'Unsupported format: $format. Use json, csv, or sql.',
        );
    }
  }

  /// Parses a JSON array of objects and inserts each as a table
  /// row via [writeQuery]. Validates that the top-level value
  /// is a list and that each element is a map.
  Future<DriftDebugImportResult> _importJson({
    required String data,
    required String table,
    required Future<void> Function(String sql) writeQuery,
    required String Function(dynamic value) sqlLiteral,
  }) async {
    // Decode the raw JSON string into a Dart object.
    final dynamic decoded;

    try {
      decoded = jsonDecode(data);
    } on FormatException catch (e, st) {
      return Error.throwWithStackTrace(
        FormatException('Invalid JSON: ${e.message}'),
        st,
      );
    }

    if (decoded is! List) {
      throw const FormatException(
        'JSON data must be an array of objects.',
      );
    }
    int imported = 0;
    final errors = <String>[];

    // Iterate rows, building an INSERT for each map entry.
    for (final (i, row) in decoded.indexed) {
      if (row is Map) {
        try {
          final keys = row.keys.toList();
          final cols = keys.map(_escapeIdentifier).join(', ');
          final vals = keys.map((k) => sqlLiteral(row[k])).join(', ');

          await writeQuery(
            'INSERT INTO "$table" ($cols) VALUES ($vals)',
          );
          imported++;
        } on Object catch (e) {
          errors.add('Row $i: $e');
        }
      } else {
        errors.add('Row $i: not an object');
      }
    }

    return DriftDebugImportResult(
      imported: imported,
      errors: errors,
      format: formatJson,
      table: table,
    );
  }

  Future<DriftDebugImportResult> _importCsv({
    required String data,
    required String table,
    required Future<void> Function(String sql) writeQuery,
    required String Function(dynamic value) sqlLiteral,
  }) async {
    final lines = parseCsvLines(data);

    if (lines.length < 2) {
      throw const FormatException(
        'CSV must have a header row and at least one data row.',
      );
    }

    final headers = lines[0];
    int imported = 0;
    final errors = <String>[];

    for (int i = 1; i < lines.length; i++) {
      try {
        final values = lines[i];

        if (values.length == headers.length) {
          final cols = headers.map(_escapeIdentifier).join(', ');
          final vals = values.map((v) => sqlLiteral(v)).join(', ');

          await writeQuery(
            'INSERT INTO "$table" ($cols) VALUES ($vals)',
          );
          imported++;
        } else {
          final colCount = values.length;
          final headerCount = headers.length;

          errors.add(
            'Row $i: column count mismatch ($colCount vs $headerCount)',
          );
        }
      } on Object catch (e) {
        errors.add('Row $i: $e');
      }
    }

    return DriftDebugImportResult(
      imported: imported,
      errors: errors,
      format: formatCsv,
      table: table,
    );
  }

  Future<DriftDebugImportResult> _importSql({
    required String data,
    required String table,
    required Future<void> Function(String sql) writeQuery,
  }) async {
    final statements =
        data.split(';').map((s) => s.trim()).where((s) => s.isNotEmpty);
    int imported = 0;
    final errors = <String>[];

    for (final stmt in statements) {
      try {
        await writeQuery('$stmt;');
        imported++;
      } on Object catch (e) {
        errors.add('Statement error: $e');
      }
    }

    return DriftDebugImportResult(
      imported: imported,
      errors: errors,
      format: formatSql,
      table: table,
    );
  }

  /// Wraps a SQL identifier in double quotes, escaping any
  /// embedded double-quote characters by doubling them.
  static String _escapeIdentifier(dynamic name) {
    final escaped = name.toString().replaceAll('"', '""');

    return '"$escaped"';
  }

  /// Parses CSV text into rows (each a list of field strings).
  ///
  /// Handles quoted fields with embedded commas, escaped
  /// quotes (`""`), CR+LF line endings, and UTF-8 BOM.
  /// Empty lines are skipped.
  ///
  /// Returns a list of rows where each row is a list of
  /// trimmed field values.
  static List<List<String>> parseCsvLines(String csv) {
    // Strip BOM and normalize line endings.
    String normalized = csv;

    if (normalized.isNotEmpty && normalized.codeUnitAt(0) == _bomCodeUnit) {
      normalized = normalized.substring(1);
    }
    normalized = normalized.replaceAll('\r\n', '\n').replaceAll('\r', '\n');

    final result = <List<String>>[];
    final lines = normalized.split('\n');
    final current = StringBuffer();

    for (final line in lines) {
      if (line.trim().isNotEmpty) {
        final fields = <String>[];
        bool isInQuotes = false;

        current.clear();

        int charIndex = 0;

        while (charIndex < line.length) {
          final c = line[charIndex];

          if (c == '"') {
            if (isInQuotes &&
                charIndex + 1 < line.length &&
                line[charIndex + 1] == '"') {
              current.write('"');
              charIndex++;
            } else {
              isInQuotes = !isInQuotes;
            }
          } else if (c == ',' && !isInQuotes) {
            fields.add(current.toString().trim());
            current.clear();
          } else {
            current.write(c);
          }
          charIndex++;
        }

        fields.add(current.toString().trim());
        result.add(fields);
      }
    }

    return result;
  }

  @override
  String toString() => 'DriftDebugImportProcessor()';
}
