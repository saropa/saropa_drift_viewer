// Stub implementation when dart:io is not available (e.g. web). The conditional export in
// drift_debug_server.dart selects this file on web and drift_debug_server_io.dart on VM.
// Typedefs are duplicated here so the stub is self-contained and the public API is identical.

/// Callback that runs a single SQL query and returns rows as list of maps (column name → value).
typedef DriftDebugQuery = Future<List<Map<String, dynamic>>> Function(
    String sql);

/// Optional callback for log messages.
typedef DriftDebugOnLog = void Function(String message);

/// Optional callback for errors (and optional stack trace).
typedef DriftDebugOnError = void Function(Object error, StackTrace stack);

/// Optional callback that returns the raw SQLite database file bytes.
typedef DriftDebugGetDatabaseBytes = Future<List<int>> Function();

/// Unsupported-error message when VM (dart:io) is not available.
const String _kUnsupportedMessage =
    'Drift debug server requires dart:io (VM). Not available on web.';

/// Debug-only HTTP server (stub when dart:io unavailable).
///
/// All methods throw or return placeholder values. Use the VM build
/// (drift_debug_server_io.dart) for real functionality.
///
/// On web, do not pass sensitive data (e.g. auth tokens) to [start]—parameters
/// are ignored and [start] only throws; no server is started.
mixin DriftDebugServer {
  /// Stub: always throws [UnsupportedError].
  ///
  /// Throws [UnsupportedError] because dart:io is not available on web.
  static Future<void> start({
    required DriftDebugQuery query,
    bool enabled = true,
    int port = 8642,
    bool loopbackOnly = false,
    String? corsOrigin = '*',
    String? authToken,
    String? basicAuthUser,
    String? basicAuthPassword,
    DriftDebugGetDatabaseBytes? getDatabaseBytes,
    DriftDebugQuery? queryCompare,
    DriftDebugOnLog? onLog,
    DriftDebugOnError? onError,
  }) {
    throw UnsupportedError(_kUnsupportedMessage);
  }

  /// Stub: always returns null (server not running).
  static int? get port => null;

  /// Stub: no-op.
  static Future<void> stop() => Future<void>.value();
}
