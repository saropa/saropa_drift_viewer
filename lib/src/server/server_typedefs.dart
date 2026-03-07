// Typedefs extracted from drift_debug_server_io.dart
// to avoid circular imports between the main server
// file and helper modules (e.g. ServerContext).
// Both drift_debug_server_io.dart and
// drift_debug_server_stub.dart re-export these so
// the public API stays unchanged.

/// Callback that runs a single SQL query and returns
/// rows as list of maps (column name -> value).
///
/// Used by [DriftDebugServer.start] to list tables
/// and fetch table data. Implement with your Drift
/// database's `customSelect` or any SQLite executor.
/// The server only sends allow-listed queries (e.g.
/// table names from sqlite_master, SELECT with
/// limit/offset). Each row must be a map from column
/// name (string) to value (dynamic; null allowed).
typedef DriftDebugQuery
    = Future<List<Map<String, dynamic>>> Function(
  String sql,
);

/// Optional callback for log messages (e.g. startup
/// banner when the server binds).
///
/// Pass as the `onLog` parameter to
/// [DriftDebugServer.start]. Use
/// [DriftDebugErrorLogger.logCallback] or
/// [DriftDebugErrorLogger.callbacks] for a ready-made
/// implementation.
typedef DriftDebugOnLog = void Function(String message);

/// Optional callback for errors (and optional stack
/// trace).
///
/// Pass as the `onError` parameter to
/// [DriftDebugServer.start]. Use
/// [DriftDebugErrorLogger.errorCallback] or
/// [DriftDebugErrorLogger.callbacks] for a defensive
/// implementation that never throws.
typedef DriftDebugOnError = void Function(
  Object error,
  StackTrace stack,
);

/// Optional callback that returns the raw SQLite
/// database file bytes.
///
/// Pass as `getDatabaseBytes` to
/// [DriftDebugServer.start] to enable "Download
/// database" in the UI (GET /api/database). Typical
/// implementation:
/// `() => File(yourDbPath).readAsBytes()`.
/// The downloaded file can be opened in DB Browser
/// for SQLite or similar tools. Returning an empty
/// list is valid (e.g. in-memory DB); the server
/// responds with 200 and zero-length body.
typedef DriftDebugGetDatabaseBytes
    = Future<List<int>> Function();

/// Optional callback for write queries
/// (INSERT/UPDATE/DELETE).
///
/// Separated from [DriftDebugQuery] to enforce
/// read-only by default. Debug-only: used exclusively
/// by the import endpoint (`POST /api/import`). Pass
/// as `writeQuery` to [DriftDebugServer.start] to
/// enable data import in the UI. If not provided, the
/// import endpoint returns 501 Not Implemented.
typedef DriftDebugWriteQuery
    = Future<void> Function(String sql);
