// Helper types extracted from drift_debug_server_io.dart to reduce file size.
// See drift_debug_server_io.dart for usage.

import 'server_constants.dart';

// --- Snapshot (time-travel) ---

/// In-memory snapshot of table state (for time-travel compare). Captured by POST /api/snapshot;
/// GET /api/snapshot/compare diffs current DB vs this snapshot (per-table added/removed/unchanged).
class Snapshot {
  const Snapshot(
      {required this.id, required this.createdAt, required this.tables});
  final String id;
  final DateTime createdAt;
  final Map<String, List<Map<String, dynamic>>> tables;

  @override
  String toString() =>
      'Snapshot(id: $id, createdAt: $createdAt, tables: ${tables.length} tables)';
}

/// A single query timing record for the performance monitor.
class QueryTiming {
  QueryTiming({
    required this.sql,
    required this.durationMs,
    required this.rowCount,
    required this.at,
    this.error,
  });

  final String sql;
  final int durationMs;
  final int rowCount;
  final DateTime at;
  final String? error;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'sql': sql,
        'durationMs': durationMs,
        'rowCount': rowCount,
        'error': error,
        'at': at.toIso8601String(),
      };
}

/// Validated POST /api/sql request body (prefer_extension_type_for_wrapper, require_api_response_validation).
extension type SqlRequestBody(String sql) implements Object {
  /// Validates shape and returns null on invalid (require_api_response_validation).
  static SqlRequestBody? fromJson(Object? decoded) {
    if (decoded is! Map<String, dynamic>) return null;
    final raw = decoded[ServerConstants.jsonKeySql];
    if (raw is! String) return null;
    final trimmedSql = raw.trim();
    if (trimmedSql.isEmpty) return null;
    return SqlRequestBody(trimmedSql);
  }
}
