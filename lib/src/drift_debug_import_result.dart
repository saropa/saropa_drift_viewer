/// Result of a data import operation.
///
/// Contains the count of successfully imported rows and any per-row errors.
final class DriftDebugImportResult {
  /// Creates an import result with the given counts and metadata.
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

  /// Returns a JSON-compatible map with keys: imported, errors, format, table.
  Map<String, dynamic> toJson() => <String, dynamic>{
        'imported': imported,
        'errors': errors,
        'format': format,
        'table': table,
      };

  @override
  String toString() =>
      'ImportResult($format, $table: $imported/${errors.length})';
}
