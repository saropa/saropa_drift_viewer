import 'dart:convert';

/// Result of a data import operation.
///
/// Contains the count of successfully imported rows and any per-row errors.
final class DriftDebugImportResult {
  const DriftDebugImportResult({
    required this.imported,
    required this.errors,
    required this.format,
    required this.table,
  });

  /// Number of rows successfully imported.
  final int imported;

  /// Per-row error messages (row index + description).
  final List<String> errors;

  /// Format that was imported ('json', 'csv', or 'sql').
  final String format;

  /// Target table name.
  final String table;

  /// Serializes to the JSON response shape expected by the client.
  Map<String, dynamic> toJson() => <String, dynamic>{
        'imported': imported,
        'errors': errors,
        'format': format,
        'table': table,
      };
}

/// Processes data imports in CSV, JSON, or SQL format.
///
/// Stateless processor: call [processImport] with the parsed request fields
/// and a write-query callback. Used by the `POST /api/import` handler in
/// [_DriftDebugServerImpl] to keep HTTP plumbing separate from import logic.
final class DriftDebugImportProcessor {
  const DriftDebugImportProcessor();

  /// Supported format identifiers.
  static const String formatJson = 'json';
  static const String formatCsv = 'csv';
  static const String formatSql = 'sql';

  /// Imports [data] in the given [format] into [table] using [writeQuery].
  ///
  /// [sqlLiteral] converts a Dart value to a SQL literal string (for quoting).
  /// Returns `null` with an error message via [onFormatError] for unsupported
  /// formats or malformed CSV.
  ///
  /// Throws only on unexpected errors; per-row failures are collected in
  /// [DriftDebugImportResult.errors].
  Future<DriftDebugImportResult> processImport({
    required String format,
    required String data,
    required String table,
    required Future<void> Function(String sql) writeQuery,
    required String Function(Object? value) sqlLiteral,
  }) async {
    switch (format) {
      case formatJson:
        return _importJson(
          data: data,
          table: table,
          writeQuery: writeQuery,
          sqlLiteral: sqlLiteral,
        );
      case formatCsv:
        return _importCsv(
          data: data,
          table: table,
          writeQuery: writeQuery,
          sqlLiteral: sqlLiteral,
        );
      case formatSql:
        return _importSql(data: data, table: table, writeQuery: writeQuery);
      default:
        throw FormatException(
          'Unsupported format: $format. Use json, csv, or sql.',
        );
    }
  }

  Future<DriftDebugImportResult> _importJson({
    required String data,
    required String table,
    required Future<void> Function(String sql) writeQuery,
    required String Function(Object? value) sqlLiteral,
  }) async {
    final rows = jsonDecode(data) as List<dynamic>;
    int imported = 0;
    final errors = <String>[];

    for (int i = 0; i < rows.length; i++) {
      final row = rows[i];
      if (row is! Map) {
        errors.add('Row $i: not an object');
        continue;
      }
      try {
        final keys = row.keys.toList();
        final cols = keys.map((k) => '"$k"').join(', ');
        final vals = keys.map((k) => sqlLiteral(row[k])).join(', ');
        await writeQuery('INSERT INTO "$table" ($cols) VALUES ($vals)');
        imported++;
      } on Object catch (e) {
        errors.add('Row $i: $e');
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
    required String Function(Object? value) sqlLiteral,
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
        if (values.length != headers.length) {
          errors.add(
            'Row $i: column count mismatch '
            '(${values.length} vs ${headers.length})',
          );
          continue;
        }
        final cols = headers.map((h) => '"$h"').join(', ');
        final vals = values.map((v) => sqlLiteral(v)).join(', ');
        await writeQuery('INSERT INTO "$table" ($cols) VALUES ($vals)');
        imported++;
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

  /// Parses CSV text into a list of rows (each a list of field strings).
  ///
  /// Handles quoted fields with embedded commas and escaped quotes (`""`).
  /// Empty lines are skipped.
  static List<List<String>> parseCsvLines(String csv) {
    final result = <List<String>>[];
    final lines = csv.split('\n');
    for (final line in lines) {
      if (line.trim().isEmpty) continue;
      final fields = <String>[];
      var inQuotes = false;
      final current = StringBuffer();
      for (int i = 0; i < line.length; i++) {
        final c = line[i];
        if (c == '"') {
          if (inQuotes && i + 1 < line.length && line[i + 1] == '"') {
            current.write('"');
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (c == ',' && !inQuotes) {
          fields.add(current.toString().trim());
          current.clear();
        } else {
          current.write(c);
        }
      }
      fields.add(current.toString().trim());
      result.add(fields);
    }
    return result;
  }
}
